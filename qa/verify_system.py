"""Run the real API against disposable, isolated test data."""
import json
import argparse
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "qa" / "reports"
REPORTS.mkdir(parents=True, exist_ok=True)
RUNTIME = ROOT / "qa" / "runtime" / secrets.token_hex(5)
RUNTIME.mkdir(parents=True)
BASE = "http://127.0.0.1:8011"
results = []


def request(path, payload=None, token=None, method=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode() if payload is not None else None,
                                 headers=headers, method=method or ("POST" if payload is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
            return response.status, json.loads(data) if "application/json" in response.headers.get("Content-Type", "") else data
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def check(name, actual, expected):
    ok = actual == expected
    results.append({"name": name, "passed": ok, "actual": actual, "expected": expected})
    print(f"{'PASS' if ok else 'FAIL'} {name}", flush=True)
    if not ok:
        raise AssertionError(f"{name}: {actual} != {expected}")


def upload_video(path, token):
    return upload_bytes("/api/analyze-video", path.name, path.read_bytes(), "video/mp4", token)


def upload_bytes(endpoint, filename, data, content_type, token):
    boundary = "qa-" + secrets.token_hex(12)
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE + endpoint, data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=180) as response:
        return response.status, json.loads(response.read())


def main(skip_video=False, report_tag=None):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", 8011))
        except OSError as error:
            raise RuntimeError("Port 8011 is already in use; stopping before test writes") from error
    admin_password = secrets.token_urlsafe(18) + "A1"
    password = secrets.token_urlsafe(18) + "A1"
    env = os.environ.copy()
    env.update(FALLGUARD_DATA_DIR=str(RUNTIME), FALLGUARD_ADMIN_PASSWORD=admin_password,
               MPLCONFIGDIR=str(ROOT / ".cache" / "matplotlib"),
               YOLO_CONFIG_DIR=str(ROOT / ".cache" / "ultralytics"), PYTHONUTF8="1")
    env.pop("FALLGUARD_ADMIN_RESET_PASSWORD", None)
    log = (REPORTS / "api-server.log").open("w", encoding="utf-8")
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--app-dir",
                                str(ROOT / "fall_detection_lstm"), "--host", "127.0.0.1", "--port", "8011"],
                               cwd=ROOT, env=env, stdout=log, stderr=log,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    try:
        for _ in range(120):
            if process.poll() is not None:
                raise RuntimeError("Test backend exited; inspect qa/reports/api-server.log")
            try:
                if request("/api/health")[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(0.5)
        else:
            raise RuntimeError("Test backend did not start")
        check("Web application served", request("/")[0], 200)
        check("Anonymous user list blocked", request("/api/auth/users")[0], 401)
        status, login = request("/api/auth/login", {"email": "admin@gmail.com", "password": admin_password})
        check("Admin login", status, 200)
        admin_token = login["access_token"]
        contacts = ["qa-email@example.invalid", "0912345678", "qa-bulk@example.invalid"]
        for contact in contacts:
            status, body = request("/api/auth/register", {"email": contact, "name": "QA " + contact, "password": password})
            check(f"Register {contact}", (status, body.get("status"), "access_token" in body), (201, "pending", False))
            check(f"Pending login blocked {contact}", request("/api/auth/login", {"email": contact, "password": password})[0], 403)
        check("Equivalent phone duplicate blocked", request("/api/auth/register", {
            "email": "+84 912 345 678", "name": "Duplicate", "password": password})[0], 409)
        check("Bad contact rejected", request("/api/auth/register", {
            "email": "1234567890", "name": "Bad", "password": password})[0], 422)
        status, users = request("/api/auth/users", token=admin_token)
        check("All new registrations visible to admin", sum(user["status"] == "pending" for user in users), 3)
        email_user = next(user for user in users if user["email"] == contacts[0])
        phone_user = next(user for user in users if user["email"] == "+84912345678")
        bulk_user = next(user for user in users if user["email"] == contacts[2])
        check("Viewer cannot approve before login", request(f"/api/auth/users/{email_user['id']}/approval", {"approved": True}, method="PATCH")[0], 401)
        for user in (email_user, phone_user):
            check("Admin approval " + user["email"], request(f"/api/auth/users/{user['id']}/approval", {"approved": True}, token=admin_token, method="PATCH")[0], 200)
        status, viewer = request("/api/auth/login", {"email": contacts[0], "password": password})
        check("Approved email login", status, 200)
        viewer_token = viewer["access_token"]
        check("Approved phone login with local format", request("/api/auth/login", {"email": contacts[1], "password": password})[0], 200)
        check("Approved phone login with international format", request("/api/auth/login", {"email": "+84912345678", "password": password})[0], 200)
        check("Viewer cannot list accounts", request("/api/auth/users", token=viewer_token)[0], 403)
        check("Viewer cannot approve accounts", request(f"/api/auth/users/{bulk_user['id']}/approval", {"approved": True}, token=viewer_token, method="PATCH")[0], 403)
        check("Admin rejection", request(f"/api/auth/users/{bulk_user['id']}/approval", {"approved": False}, token=admin_token, method="PATCH")[0], 200)
        check("Rejected login blocked", request("/api/auth/login", {"email": contacts[2], "password": password})[0], 403)
        check("Admin reapproval", request(f"/api/auth/users/{bulk_user['id']}/approval", {"approved": True}, token=admin_token, method="PATCH")[0], 200)
        check("Reapproved login", request("/api/auth/login", {"email": contacts[2], "password": password})[0], 200)
        request(f"/api/auth/users/{email_user['id']}/approval", {"approved": False}, token=admin_token, method="PATCH")
        check("Existing session revoked after rejection", request("/api/auth/me", token=viewer_token)[0] in (401, 403), True)
        check("Wrong password rejected", request("/api/auth/login", {"email": contacts[1], "password": "incorrect"})[0], 401)
        check("RTSP create rejected", request("/api/cameras", {"name": "QA RTSP", "source": "rtsp://example.invalid/stream"}, token=admin_token)[0], 422)
        status, webcam = request("/api/cameras", {"name": "QA webcam", "source": "0"}, token=admin_token)
        check("Browser webcam create allowed", status, 201)
        import cv2
        sample_frame_video = sorted((ROOT / "fall_detection_lstm" / "fallandnofall" / "split_dataset" / "test" / "Fall" / "Raw_Video").glob("*.mp4"))[0]
        capture = cv2.VideoCapture(str(sample_frame_video), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
        ok, frame = capture.read()
        capture.release()
        if not ok:
            raise RuntimeError("Cannot decode camera test frame")
        encoded_ok, jpeg = cv2.imencode(".jpg", frame)
        if not encoded_ok:
            raise RuntimeError("Cannot encode camera test frame")
        status, decision = upload_bytes(f"/api/cameras/{webcam['id']}/frame", "frame.jpg", jpeg.tobytes(), "image/jpeg", admin_token)
        check("Live camera JPEG multipart accepted", status, 200)
        check("Live camera returns decision", "state" in decision and "keypoints" in decision, True)
        created_events = []
        for kind in ("lstm_score", "pose_keypoint_quality"):
            status, event = request("/api/events", {"camera_id": "qa", "confidence": 0.81, "confidence_kind": kind}, token=admin_token)
            check("Event preserves score type " + kind, (status, event.get("confidence_kind")), (201, kind))
            created_events.append(event)
        first_id = created_events[0]["id"]
        status, read_event = request(f"/api/events/{first_id}/acknowledge", token=admin_token, method="POST")
        check("Mark one notification read", status, 200)
        check("Read state belongs to current user", login["user"]["id"] in read_event.get("acknowledged_by", []) and not read_event["acknowledged"], True)
        _, repeat = request(f"/api/events/{first_id}/acknowledge", token=admin_token, method="POST")
        check("Mark read is idempotent", len(repeat["acknowledged_by"]), 1)
        _, events = request("/api/events", token=admin_token)
        untouched = next(item for item in events if item["id"] == created_events[1]["id"])
        check("Reading one does not mark other notifications", bool(untouched.get("acknowledged_by")), False)
        check("Missing notification read returns 404", request("/api/events/999999/acknowledge", token=admin_token, method="POST")[0], 404)
        for label in (() if skip_video else ("Fall", "No_Fall")):
            sample = sorted((ROOT / "fall_detection_lstm" / "fallandnofall" / "split_dataset" / "test" / label / "Raw_Video").glob("*.mp4"))[0]
            status, analysis = upload_video(sample, admin_token)
            check("Real video upload endpoint " + label, status, 200)
            check("Annotated video available " + label, request(analysis["annotated_video_url"], token=admin_token)[0], 200)
            check("Four comparison variants returned " + label,
                  sorted(analysis["analysis_summary"]["ablation_first_detection_s"]),
                  ["fusion", "geometry", "lstm", "strict_agreement"])
            check("Video verdict agrees with diagnostics " + label,
                  analysis["result"], analysis["analysis_summary"]["verdict"])
            check("Floor FSM decision policy returned " + label,
                  analysis["analysis_summary"]["decision_policy"], "temporal_floor_fsm_v3")
            check("Completed video has a final verdict " + label,
                  analysis["result"] in {"FALL", "NO_FALL"}, True)
            check("Postprocess verdict agrees with video " + label,
                  analysis["postprocess_result"], analysis["result"])
            if analysis["result"] == "FALL":
                _, saved_events = request("/api/events", token=admin_token)
                saved = next(item for item in saved_events if item["id"] == analysis["event_id"])
                check("Video and alert preserve the same score type " + label,
                      (saved["confidence"], saved["confidence_kind"]), (analysis["confidence"], analysis["confidence_kind"]))
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
        log.close()
        report_name = f"api-checks-{report_tag}.json" if report_tag else "api-checks-notifications.json" if skip_video else "api-checks.json"
        (REPORTS / report_name).write_text(json.dumps({"checks": results,
            "passed": sum(item["passed"] for item in results), "total": len(results),
            "isolated_data_dir": str(RUNTIME)}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-video", action="store_true", help="Skip full video inference when checking account/notification API changes")
    parser.add_argument("--report-tag")
    args = parser.parse_args()
    main(args.skip_video, args.report_tag)
