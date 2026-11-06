from datetime import datetime, timezone, timedelta
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent / "fall_detection_lstm"
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi import UploadFile, File, HTTPException, Header, Request
import tempfile
import uuid
import os
import re
import secrets
import hashlib
import hmac
import cv2
import numpy as np
import torch
from ultralytics import YOLO
from lstm_model import LSTMClassifier
try:
    from pywebpush import webpush, WebPushException
except ImportError:
    webpush = None
    WebPushException = Exception


DATA_DIR = ROOT / "data"
EVENTS_FILE = DATA_DIR / "events.json"
PUSH_FILE = DATA_DIR / "push_subscriptions.json"
CAMERAS_FILE = DATA_DIR / "cameras.json"
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
DATA_DIR.mkdir(exist_ok=True)
ANALYSIS_DIR = DATA_DIR / "analysis_results"
ANALYSIS_DIR.mkdir(exist_ok=True)
pose_model = YOLO(str(PROJECT_ROOT / "yolov8n-pose.pt"))
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
fall_model = LSTMClassifier(input_dim=3, hidden_dim=64, output_dim=2).to(device)
fall_model.load_state_dict(torch.load(PROJECT_ROOT / "lstm_fall_model.pth", map_location=device))
fall_model.eval()


class FallEvent(BaseModel):
    person_id: str = "unknown"
    camera_id: str = "camera_01"
    confidence: float = Field(ge=0, le=1)
    message: str = "PhÃ¡t hiá»‡n ngÆ°á»i ngÃ£"


app = FastAPI(title="Fall Detection API", version="0.1.0")
from fastapi.staticfiles import StaticFiles
app.mount("/analysis-results", StaticFiles(directory=ANALYSIS_DIR), name="analysis-results")

class EventSocketManager:
    def __init__(self): self.connections = []
    async def connect(self, websocket):
        await websocket.accept(); self.connections.append(websocket)
    def disconnect(self, websocket):
        if websocket in self.connections: self.connections.remove(websocket)
    async def broadcast(self, payload):
        for websocket in self.connections.copy():
            try: await websocket.send_json(payload)
            except Exception: self.disconnect(websocket)

event_sockets = EventSocketManager()

@app.websocket("/ws/events")
async def events_socket(websocket: WebSocket, token: str | None = None):
    try:
        get_session_user(f"Bearer {token}" if token else None)
    except HTTPException:
        await websocket.close(code=1008)
        return
    await event_sockets.connect(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: event_sockets.disconnect(websocket)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

current_status = {
    "state": "OFFLINE",
    "confidence": 0.0,
    "fps": 0.0,
    "camera_id": "camera_01",
    "updated_at": None,
}
live_sequences: dict[str, list[list[float]]] = {}
last_fall_alert: dict[str, datetime] = {}



class AuthRegister(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=128)

class AuthLogin(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

class AuthProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

class AuthUserCreate(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=128)

class AuthPasswordUpdate(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)


def read_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (json.JSONDecodeError, OSError):
        return []

def write_json_list(path: Path, items: list[dict]) -> None:
    path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

def normalize_email(email: str) -> str:
    value = email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise HTTPException(422, "Invalid email address")
    return value

def ensure_admin_account() -> None:
    if read_json_list(USERS_FILE):
        return
    bootstrap_password = os.getenv("FALLGUARD_ADMIN_PASSWORD")
    if not bootstrap_password:
        raise RuntimeError("No users found. Set FALLGUARD_ADMIN_PASSWORD to bootstrap admin@gmail.com.")
    if len(bootstrap_password) < 10 or not re.search(r"[A-Za-z]", bootstrap_password) or not re.search(r"[0-9]", bootstrap_password):
        raise RuntimeError("FALLGUARD_ADMIN_PASSWORD must be 10+ characters and contain letters and numbers.")
    admin = {"id": secrets.token_hex(16), "email": "admin@gmail.com", "name": "Admin",
             **password_hash(bootstrap_password), "created_at": datetime.now(timezone.utc).isoformat()}
    write_json_list(USERS_FILE, [admin])

def password_hash(password: str, salt: str | None = None) -> dict:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 310000)
    return {"salt": salt, "password_hash": digest.hex()}

def public_user(user: dict) -> dict:
    return {"id": user["id"], "email": user["email"], "name": user["name"], "created_at": user["created_at"]}

def bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Invalid or expired session")
    return authorization[7:].strip()

def get_session_user(authorization: str | None) -> dict:
    token = bearer_token(authorization)
    sessions = read_json_list(SESSIONS_FILE)
    now = datetime.now(timezone.utc)
    kept = []
    matched = None
    for session in sessions:
        try:
            if datetime.fromisoformat(session["expires_at"]) > now:
                kept.append(session)
                if hmac.compare_digest(session.get("token_hash", ""), hashlib.sha256(token.encode()).hexdigest()):
                    matched = session
        except (KeyError, ValueError):
            continue
    if len(kept) != len(sessions):
        write_json_list(SESSIONS_FILE, kept)
    if not matched:
        raise HTTPException(401, "Invalid or expired session")
    user = next((u for u in read_json_list(USERS_FILE) if u["id"] == matched["user_id"]), None)
    if not user:
        raise HTTPException(401, "Account not found")
    return user

def create_session(user: dict) -> dict:
    token = secrets.token_urlsafe(48)
    sessions = read_json_list(SESSIONS_FILE)
    sessions.append({"user_id": user["id"], "token_hash": hashlib.sha256(token.encode()).hexdigest(),
                     "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()})
    write_json_list(SESSIONS_FILE, sessions)
    return {"access_token": token, "token_type": "bearer", "expires_in": 604800, "user": public_user(user)}

@app.middleware("http")
async def require_login_for_api(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    public_paths = {"/api/health", "/api/auth/config", "/api/auth/register", "/api/auth/login"}
    if path.startswith("/api/") and path not in public_paths:
        try:
            get_session_user(request.headers.get("authorization"))
        except HTTPException as error:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=error.status_code, content={"detail": error.detail})
    return await call_next(request)

ensure_admin_account()

@app.get("/api/auth/config")
def auth_config() -> dict:
    return {"registration_open": len(read_json_list(USERS_FILE)) == 0}

@app.post("/api/auth/register", status_code=201)
def register_user(payload: AuthRegister) -> dict:
    email = normalize_email(payload.email)
    users = read_json_list(USERS_FILE)
    if users:
        raise HTTPException(403, "Registration is closed. Ask an administrator to create an account.")
    if len(payload.password) < 10 or not re.search(r"[A-Za-z]", payload.password) or not re.search(r"[0-9]", payload.password):
        raise HTTPException(422, "Password must be at least 10 characters and include letters and numbers")
    user = {"id": secrets.token_hex(16), "email": email, "name": payload.name.strip(),
            **password_hash(payload.password), "created_at": datetime.now(timezone.utc).isoformat()}
    users.append(user)
    write_json_list(USERS_FILE, users)
    return create_session(user)

@app.post("/api/auth/login")
def login_user(payload: AuthLogin) -> dict:
    email = normalize_email(payload.email)
    user = next((u for u in read_json_list(USERS_FILE) if u.get("email") == email), None)
    if not user:
        hashlib.pbkdf2_hmac("sha256", payload.password.encode("utf-8"), bytes(16), 310000)
        raise HTTPException(401, "Email or password is incorrect")
    calculated = password_hash(payload.password, user["salt"])["password_hash"]
    if not hmac.compare_digest(calculated, user["password_hash"]):
        raise HTTPException(401, "Email or password is incorrect")
    return create_session(user)

@app.get("/api/auth/me")
def current_user(authorization: str | None = Header(default=None)) -> dict:
    return public_user(get_session_user(authorization))

@app.get("/api/auth/users")
def list_auth_users() -> list[dict]:
    return [public_user(user) for user in read_json_list(USERS_FILE)]

@app.post("/api/auth/users", status_code=201)
def create_auth_user(payload: AuthUserCreate) -> dict:
    email = normalize_email(payload.email)
    if len(payload.password) < 10 or not re.search(r"[A-Za-z]", payload.password) or not re.search(r"[0-9]", payload.password):
        raise HTTPException(422, "Password must be at least 10 characters and include letters and numbers")
    users = read_json_list(USERS_FILE)
    if any(user.get("email") == email for user in users):
        raise HTTPException(409, "An account with this email already exists")
    user = {"id": secrets.token_hex(16), "email": email, "name": payload.name.strip(),
            **password_hash(payload.password), "created_at": datetime.now(timezone.utc).isoformat()}
    users.append(user)
    write_json_list(USERS_FILE, users)
    return public_user(user)

@app.delete("/api/auth/users/{user_id}")
def delete_auth_user(user_id: str, authorization: str | None = Header(default=None)) -> dict:
    current = get_session_user(authorization)
    users = read_json_list(USERS_FILE)
    if user_id == current["id"]:
        raise HTTPException(400, "You cannot delete the account you are using")
    remaining = [user for user in users if user["id"] != user_id]
    if len(remaining) == len(users):
        raise HTTPException(404, "Account not found")
    write_json_list(USERS_FILE, remaining)
    write_json_list(SESSIONS_FILE, [session for session in read_json_list(SESSIONS_FILE) if session.get("user_id") != user_id])
    return {"ok": True}

@app.post("/api/auth/password")
def change_password(payload: AuthPasswordUpdate, authorization: str | None = Header(default=None)) -> dict:
    user = get_session_user(authorization)
    if len(payload.new_password) < 10 or not re.search(r"[A-Za-z]", payload.new_password) or not re.search(r"[0-9]", payload.new_password):
        raise HTTPException(422, "New password must be at least 10 characters and include letters and numbers")
    actual = password_hash(payload.current_password, user["salt"])["password_hash"]
    if not hmac.compare_digest(actual, user["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    user.update(password_hash(payload.new_password))
    users = read_json_list(USERS_FILE)
    for index, item in enumerate(users):
        if item["id"] == user["id"]:
            users[index] = user
            break
    write_json_list(USERS_FILE, users)
    write_json_list(SESSIONS_FILE, [s for s in read_json_list(SESSIONS_FILE) if s["user_id"] != user["id"]])
    return {"ok": True, "message": "Password updated. Please sign in again."}

@app.post("/api/auth/logout")
def logout_user(authorization: str | None = Header(default=None)) -> dict:
    token = bearer_token(authorization)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    sessions = [s for s in read_json_list(SESSIONS_FILE) if not hmac.compare_digest(s.get("token_hash", ""), token_hash)]
    write_json_list(SESSIONS_FILE, sessions)
    return {"ok": True}

@app.patch("/api/auth/me")
def update_current_user(payload: AuthProfileUpdate, authorization: str | None = Header(default=None)) -> dict:
    current = get_session_user(authorization)
    users = read_json_list(USERS_FILE)
    current["name"] = payload.name.strip()
    for index, user in enumerate(users):
        if user["id"] == current["id"]:
            users[index] = current
            break
    write_json_list(USERS_FILE, users)
    return public_user(current)


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict

class Camera(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    source: str = Field(min_length=1, max_length=500)
    location: str = "Unknown"
    enabled: bool = True

class CameraUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    source: str | None = Field(default=None, min_length=1, max_length=500)
    location: str | None = None
    enabled: bool | None = None

def read_cameras() -> list[dict]:
    if not CAMERAS_FILE.exists():
        return [{"id": "camera_01", "name": "Camera phÃ²ng khÃ¡ch", "source": "0", "location": "PhÃ²ng khÃ¡ch", "enabled": True}]
    return json.loads(CAMERAS_FILE.read_text(encoding="utf-8"))

def write_cameras(cameras: list[dict]) -> None:
    CAMERAS_FILE.write_text(json.dumps(cameras, ensure_ascii=False, indent=2), encoding="utf-8")

@app.get("/api/cameras")
def list_cameras() -> list[dict]:
    return read_cameras()

@app.post("/api/cameras", status_code=201)
def create_camera(camera: Camera) -> dict:
    cameras = read_cameras()
    item = {"id": f"camera_{len(cameras) + 1:02d}", **camera.model_dump()}
    cameras.append(item)
    write_cameras(cameras)
    return item

@app.patch("/api/cameras/{camera_id}")
def update_camera(camera_id: str, update: CameraUpdate) -> dict:
    cameras = read_cameras()
    for camera in cameras:
        if camera["id"] == camera_id:
            camera.update({k: v for k, v in update.model_dump().items() if v is not None})
            write_cameras(cameras)
            return camera
    raise HTTPException(404, "Camera not found")

@app.delete("/api/cameras/{camera_id}")
def delete_camera(camera_id: str) -> dict:
    cameras = read_cameras()
    remaining = [camera for camera in cameras if camera["id"] != camera_id]
    if len(remaining) == len(cameras):
        raise HTTPException(404, "Camera not found")
    write_cameras(remaining)
    return {"ok": True, "id": camera_id}

def read_push_subscriptions():
    if not PUSH_FILE.exists(): return []
    return json.loads(PUSH_FILE.read_text(encoding="utf-8"))

def send_push(payload: dict):
    if webpush is None or not os.getenv("VAPID_PRIVATE_KEY"): return
    subscriptions = read_push_subscriptions()
    for subscription in subscriptions:
        try:
            webpush(subscription_info=subscription, data=json.dumps(payload),
                    vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
                    vapid_claims={"sub": os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")})
        except WebPushException:
            pass

@app.get("/api/push/public-key")
def push_public_key():
    return {"publicKey": os.getenv("VAPID_PUBLIC_KEY", "")}

@app.post("/api/push/subscribe")
def push_subscribe(subscription: PushSubscription):
    subscriptions = read_push_subscriptions()
    item = subscription.model_dump()
    if not any(s.get("endpoint") == item["endpoint"] for s in subscriptions):
        subscriptions.append(item)
        PUSH_FILE.write_text(json.dumps(subscriptions, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "devices": len(subscriptions)}


class DetectorStatus(BaseModel):
    state: str
    confidence: float = Field(ge=0, le=1)
    fps: float = Field(ge=0)
    camera_id: str = "camera_01"


def extract_features(kp):
    try:
        mid_shoulder = (kp[5] + kp[6]) / 2
        mid_hip = (kp[11] + kp[12]) / 2
        angle = np.degrees(np.arctan2(mid_hip[1] - mid_shoulder[1], mid_hip[0] - mid_shoulder[0]))
        return [angle, np.linalg.norm(mid_hip - mid_shoulder), np.linalg.norm(kp[0] - mid_hip)]
    except Exception:
        return [90, 0, 0]

SKELETON = [(0, 1), (0, 2), (1, 3), (2, 4), (5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16)]

def draw_keypoints(frame, keypoints, fall=False):
    points = [(int(x), int(y)) for x, y in keypoints]
    color = (40, 50, 235) if fall else (0, 215, 255)
    for a, b in SKELETON:
        cv2.line(frame, points[a], points[b], color, 2, cv2.LINE_AA)
    for point in points:
        cv2.circle(frame, point, 4, color, -1, cv2.LINE_AA)

@app.post("/api/cameras/{camera_id}/frame")
async def analyze_camera_frame(camera_id: str, file: UploadFile = File(...)):
    camera = next((item for item in read_cameras() if item["id"] == camera_id), None)
    if camera is None:
        raise HTTPException(404, "Camera not found")
    if not camera.get("enabled", True):
        raise HTTPException(409, "Camera is disabled")
    started = datetime.now(timezone.utc)
    raw = await file.read()
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "Invalid image frame")
    result = pose_model(image, verbose=False)[0]
    if result.keypoints is None or len(result.keypoints.xy) == 0:
        live_sequences[camera_id] = []
        ended = datetime.now(timezone.utc)
        current_status.update({"state": "NO_PERSON", "confidence": 0.0, "camera_id": camera_id, "fps": 0.0, "updated_at": ended.isoformat()})
        return {"state": "NO_PERSON", "confidence": 0, "keypoints": []}
    keypoints = result.keypoints.xy[0].cpu().numpy()
    sequence = live_sequences.setdefault(camera_id, [])
    sequence.append(extract_features(keypoints))
    live_sequences[camera_id] = sequence[-40:]
    state, confidence = "WARMING_UP", 0.0
    if len(live_sequences[camera_id]) >= 40:
        window = torch.tensor(np.array(live_sequences[camera_id][-40:]), dtype=torch.float32).unsqueeze(0).to(device)
        with torch.no_grad():
            probs = torch.softmax(fall_model(window), dim=1)[0]
        pred = int(torch.argmax(probs).item())
        confidence = float(probs[pred].item())
        state = "FALL" if pred == 1 and confidence >= 0.8 else "NORMAL"
    if state == "FALL":
        now = datetime.now(timezone.utc)
        previous = last_fall_alert.get(camera_id)
        if previous is None or (now - previous).total_seconds() >= 30:
            last_fall_alert[camera_id] = now
            await create_event(FallEvent(person_id="unknown", camera_id=camera_id, confidence=confidence,
                                         message=f"Ph?t hi?n ng??i t? ng? t?i {camera_id}"))
    ended = datetime.now(timezone.utc)
    elapsed = max((ended - started).total_seconds(), 1e-6)
    current_status.update({"state": state, "confidence": confidence, "fps": round(1 / elapsed, 2),
                           "camera_id": camera_id, "updated_at": ended.isoformat()})
    return {"state": state, "confidence": confidence, "keypoints": keypoints.tolist(), "skeleton": SKELETON}


@app.post("/api/analyze-video")
async def analyze_video(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".mp4", ".mov", ".avi", ".mkv")):
        raise HTTPException(400, "Unsupported video format")
    suffix = Path(file.filename).suffix.lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        video_file = tmp.name
    cap = cv2.VideoCapture(video_file)
    if not cap.isOpened():
        cap.release()
        Path(video_file).unlink(missing_ok=True)
        raise HTTPException(400, "Unable to read uploaded video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
    result_name = f"{uuid.uuid4().hex}.mp4"
    result_path = ANALYSIS_DIR / result_name
    writer = cv2.VideoWriter(str(result_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        cap.release()
        Path(video_file).unlink(missing_ok=True)
        raise HTTPException(500, "Unable to create annotated video")
    sequence, predictions = [], []
    frame_index = 0
    last_keypoints = None
    last_state, last_confidence = "NORMAL", 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            result = pose_model(frame, verbose=False)[0]
            if result.keypoints is not None and len(result.keypoints.xy) > 0:
                keypoints = result.keypoints.xy[0].cpu().numpy()
                last_keypoints = keypoints
                sequence.append(extract_features(keypoints))
                if len(sequence) >= 40:
                    window = torch.tensor(np.array(sequence[-40:]), dtype=torch.float32).unsqueeze(0).to(device)
                    with torch.no_grad():
                        probs = torch.softmax(fall_model(window), dim=1)[0]
                    pred = int(torch.argmax(probs).item())
                    last_confidence = float(probs[pred].item())
                    last_state = "FALL" if pred == 1 and last_confidence >= 0.8 else "NORMAL"
                    predictions.append({"frame": frame_index, "time": round(frame_index / fps, 2),
                                        "state": last_state, "confidence": last_confidence})
                draw_keypoints(frame, keypoints, last_state == "FALL")
            else:
                last_keypoints = None
                if sequence:
                    sequence.append(sequence[-1])
                    if len(sequence) > 40:
                        sequence = sequence[-40:]
                    if len(sequence) >= 40:
                        window = torch.tensor(np.array(sequence[-40:]), dtype=torch.float32).unsqueeze(0).to(device)
                        with torch.no_grad():
                            probs = torch.softmax(fall_model(window), dim=1)[0]
                        pred = int(torch.argmax(probs).item())
                        last_confidence = float(probs[pred].item())
                        last_state = "FALL" if pred == 1 and last_confidence >= 0.8 else "NORMAL"
                        predictions.append({"frame": frame_index, "time": round(frame_index / fps, 2),
                                            "state": last_state, "confidence": last_confidence})
            if last_state == "FALL":
                cv2.rectangle(frame, (0, 0), (width, 46), (30, 30, 210), -1)
                cv2.putText(frame, f"FALL DETECTED  {last_confidence:.0%}", (14, 32),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
            writer.write(frame)
            frame_index += 1
    finally:
        cap.release()
        writer.release()
        Path(video_file).unlink(missing_ok=True)
    falls, run = [], []
    for prediction in predictions:
        if prediction["state"] == "FALL" and prediction["confidence"] >= 0.8:
            run.append(prediction)
        else:
            if len(run) >= 5:
                falls.extend(run)
            run = []
    if len(run) >= 5:
        falls.extend(run)
    best = max(predictions, key=lambda item: item["confidence"], default={"confidence": 0.0, "time": None})
    if falls:
        await create_event(FallEvent(person_id="unknown", camera_id="uploaded_video",
                                     confidence=float(max(x["confidence"] for x in falls)),
                                     message="Ph?t hi?n ng??i t? ng? trong video t?i l?n"))
    timeline = predictions[::max(1, len(predictions)//100)]
    return {"result": "FALL" if falls else "NO_FALL", "confidence": best["confidence"],
            "detections": len(falls), "first_detection_time": falls[0]["time"] if falls else None,
            "duration": round(frame_count / fps, 2) if fps else 0,
            "annotated_video_url": f"/analysis-results/{result_name}", "timeline": timeline}


def read_events() -> list[dict]:
    if not EVENTS_FILE.exists():
        return []
    return json.loads(EVENTS_FILE.read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "fall-detection-backend", "detector": current_status}


@app.get("/api/status")
def detector_status() -> dict:
    updated = current_status.get("updated_at")
    if updated:
        try:
            if (datetime.now(timezone.utc) - datetime.fromisoformat(updated)).total_seconds() > 5:
                current_status.update({"state": "OFFLINE", "confidence": 0.0, "fps": 0.0})
        except ValueError:
            pass
    return current_status


@app.post("/api/status")
def update_detector_status(status: DetectorStatus) -> dict:
    from datetime import datetime, timezone, timedelta
    current_status.update(status.model_dump())
    current_status["updated_at"] = datetime.now(timezone.utc).isoformat()
    return current_status


@app.get("/api/events")
def list_events() -> list[dict]:
    return read_events()[::-1]


@app.post("/api/events", status_code=201)
async def create_event(event: FallEvent) -> dict:
    events = read_events()
    saved = {
        "id": len(events) + 1,
        **event.model_dump(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "acknowledged": False,
    }
    events.append(saved)
    EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    send_push({"title": "Cáº£nh bÃ¡o tÃ© ngÃ£", "body": event.message, "confidence": event.confidence})
    await event_sockets.broadcast(saved)
    return saved

