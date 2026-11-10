"""Evaluate the production decision stream on the supplied test split.

CSV mode uses supplied poses, so it measures the decision layer, not YOLO.
Raw mode runs the actual YOLO person/pose extraction before the same decisions.
Labels describe whole clips; no fall-onset timestamps are supplied, so this
script deliberately does not claim to measure detection delay.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "fall_detection_lstm"
sys.path.insert(0, str(PROJECT))
os.environ["FALLGUARD_DATA_DIR"] = str(ROOT / "qa" / "runtime" / "benchmark")
os.environ["FALLGUARD_ADMIN_PASSWORD"] = secrets.token_urlsafe(18) + "A1"
os.environ.pop("FALLGUARD_ADMIN_RESET_PASSWORD", None)
os.environ["MPLCONFIGDIR"] = str(ROOT / ".cache" / "matplotlib")
os.environ["YOLO_CONFIG_DIR"] = str(ROOT / ".cache" / "ultralytics")

import cv2
import numpy as np
import torch
torch.set_num_threads(1)
from backend import main as api
from ablation import summarize_variants

NAMES = ["Nose", "Left Eye", "Right Eye", "Left Ear", "Right Ear", "Left Shoulder",
         "Right Shoulder", "Left Elbow", "Right Elbow", "Left Wrist", "Right Wrist",
         "Left Hip", "Right Hip", "Left Knee", "Right Knee", "Left Ankle", "Right Ankle"]
VARIANTS = ("geometry", "lstm", "strict_agreement", "fusion")


def read_poses(path):
    frames = {}
    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            if row["Keypoint"].strip() not in NAMES:
                continue
            index = NAMES.index(row["Keypoint"].strip())
            frame = frames.setdefault(int(row["Frame"]), np.zeros((17, 3), dtype=np.float32))
            frame[index] = float(row["X"]), float(row["Y"]), float(row.get("Confidence", 1))
    return sorted(frames.items())


def evaluate_clip(csv_path, mode, settings):
    video = csv_path.parent.parent / "Raw_Video" / (csv_path.stem.removesuffix("_keypoints") + ".mp4")
    cap = cv2.VideoCapture(str(video), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    if not cap.isOpened():
        raise RuntimeError(f"Cannot read video: {video.name}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not np.isfinite(fps) or fps <= 0:
        raise ValueError(f"Invalid FPS: {video.name}")
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    stream = api.FallDecisionStream(settings)
    predictions = []
    invalid = Counter()
    started = time.perf_counter()

    def consume(index, points, confidence, bbox=None):
        timestamp = index / fps
        valid, reason = api.validate_upper_body_keypoints(points, confidence)
        if valid:
            valid, reason, _ = api.validate_person_box_and_hips(points, confidence, (height, width, 3), bbox_xyxy=bbox)
        if not valid:
            invalid[reason] += 1
            return
        decision = stream.update(points, confidence, timestamp)
        predictions.append({"time": timestamp, "state": decision["state"], "analysis": decision["analysis"]})

    try:
        if mode == "csv":
            for frame_id, pose in read_poses(csv_path):
                consume(frame_id - 1, pose[:, :2], pose[:, 2])
        else:
            frame_index = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                pose = api.infer_primary_pose(frame, "qa", settings)
                if pose is None:
                    invalid["no_person"] += 1
                    stream.reset(frame_index / fps)
                else:
                    consume(frame_index, *pose)
                frame_index += 1
    finally:
        cap.release()
    elapsed = time.perf_counter() - started
    processed_frames = len(predictions) + sum(invalid.values())
    if mode == "raw" and processed_frames < count - 1:
        raise RuntimeError(f"Incomplete video decode: {processed_frames}/{count} frames in {video.name}")
    return {"video": str(video.relative_to(PROJECT)), "label": csv_path.parent.parent.name,
            "fps": fps, "frames": count, "duration_s": count / fps,
            "valid_pose_frames": len(predictions), "invalid_reasons": dict(invalid),
            "processed_frames": processed_frames,
            "max_lstm_fall_score": max((item["analysis"]["lstm_fall_probability"] for item in predictions if item["analysis"].get("lstm_fall_probability") is not None), default=None),
            "max_qualified_horizontal_duration_s": max((item["analysis"].get("horizontal_duration_s", 0) for item in predictions if item["analysis"].get("geometry_transition_evidence") and item["analysis"].get("horizontal_confirm_frames", 0) >= 3), default=0),
            "elapsed_s": round(elapsed, 3), "processing_fps": round(count / max(elapsed, 1e-9), 2),
            "first_detection_s": summarize_variants(predictions)}


def summarize(rows):
    metrics = {}
    for name in VARIANTS:
        tp = fp = tn = fn = 0
        for row in rows:
            detected = row["first_detection_s"][name] is not None
            if row["label"] == "Fall":
                tp += detected
                fn += not detected
            else:
                fp += detected
                tn += not detected
        recall = tp / (tp + fn) if tp + fn else None
        precision = tp / (tp + fp) if tp + fp else None
        metrics[name] = {"tp": tp, "fp": fp, "tn": tn, "fn": fn,
                         "recall": recall, "precision": precision,
                         "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None,
                         "false_positive_video_rate": fp / (fp + tn) if fp + tn else None}
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("csv", "raw"), default="csv")
    parser.add_argument("--limit-per-class", type=int, default=0)
    parser.add_argument("--split", choices=("val", "test"), default="test")
    parser.add_argument("--tag", default="")
    parser.add_argument("--lstm-threshold", type=float)
    parser.add_argument("--geometry-confirm-seconds", type=float)
    args = parser.parse_args()
    torch.set_num_threads(1)
    settings = api.read_app_settings().get("ai", {})
    if args.lstm_threshold is not None:
        settings["lstm_confidence_threshold"] = args.lstm_threshold
    if args.geometry_confirm_seconds is not None:
        settings["geometry_confirm_seconds"] = args.geometry_confirm_seconds
    paths = []
    for label in ("Fall", "No_Fall"):
        files = sorted((PROJECT / "fallandnofall" / "split_dataset" / args.split / label / "Keypoints_CSV").glob("*.csv"))
        if args.limit_per_class:
            files = [files[int(i)] for i in np.linspace(0, len(files) - 1, min(args.limit_per_class, len(files)), dtype=int)]
        paths.extend(files)
    rows, errors = [], []
    started = time.perf_counter()
    for index, path in enumerate(paths, 1):
        try:
            rows.append(evaluate_clip(path, args.mode, settings))
        except Exception as error:
            errors.append({"file": path.name, "error": str(error)})
        if index % 25 == 0 or args.mode == "raw" or index == len(paths):
            print(f"{args.mode}: {index}/{len(paths)} clips, {time.perf_counter() - started:.1f}s, errors={len(errors)}", flush=True)
    hold = api.detection_profile(settings)[0]
    report = {"mode": args.mode, "split": args.split, "clips": len(rows),
              "class_counts": dict(Counter(row["label"] for row in rows)),
              "settings": settings, "effective_hold_s": hold,
              "clips_shorter_than_hold": sum(row["duration_s"] < hold for row in rows),
              "clips_with_no_valid_pose": sum(row["valid_pose_frames"] == 0 for row in rows),
              "total_video_duration_s": sum(row["duration_s"] for row in rows),
              "elapsed_s": round(time.perf_counter() - started, 2),
              "checkpoint_sha256": hashlib.sha256((PROJECT / "lstm_fall_model_fallandnofall.pth").read_bytes()).hexdigest(),
              "metrics": summarize(rows), "errors": errors, "videos": rows,
              "limitations": ["Clip-level labels only; no verified fall-onset timestamps, so no detection-delay claim.",
                              "Subject/source overlap with training has not been independently verified.",
                              "CSV mode uses supplied poses and is not an end-to-end camera benchmark."]}
    suffix = f"-{args.split}-{args.tag}" if args.tag else f"-{args.split}" if args.split != "test" else ""
    output = ROOT / "qa" / "reports" / f"benchmark-{args.mode}{suffix}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(output), "clips": len(rows), "metrics": report["metrics"],
                      "errors": len(errors)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
