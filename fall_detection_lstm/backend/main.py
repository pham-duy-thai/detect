from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Literal
from collections import deque
import asyncio
import ctypes
import json
import sys
import time

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
WEB_ROOT = PROJECT_ROOT.parent / "frontend"
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi import UploadFile, File, HTTPException, Header, Request
from fastapi.responses import FileResponse
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
from fall_postprocess import FallPostProcessor
from fall_fusion import decide_fall, summarize_clip
from contact_identity import normalize_contact
from ablation import summarize_variants
from primary_person import infer_primary_person_pose, select_primary_person
try:
    from pywebpush import webpush, WebPushException
except ImportError:
    webpush = None
    WebPushException = Exception


DATA_DIR = Path(os.environ.get("FALLGUARD_DATA_DIR", str(ROOT / "data"))).resolve()
EVENTS_FILE = DATA_DIR / "events.json"
PUSH_FILE = DATA_DIR / "push_subscriptions.json"
CAMERAS_FILE = DATA_DIR / "cameras.json"
APP_SETTINGS_FILE = DATA_DIR / "app_settings.json"
AUDIT_FILE = DATA_DIR / "audit_logs.json"
INCIDENT_MEDIA_DIR = DATA_DIR / "incident_media"
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)
INCIDENT_MEDIA_DIR.mkdir(exist_ok=True)
AVATAR_DIR = DATA_DIR / "avatars"
AVATAR_DIR.mkdir(exist_ok=True)
ANALYSIS_DIR = DATA_DIR / "analysis_results"
ANALYSIS_DIR.mkdir(exist_ok=True)
POSE_MODEL_PATH = Path(os.environ.get("FALL_POSE_MODEL", str(PROJECT_ROOT / "yolov8n-pose.pt")))
pose_model = YOLO(str(POSE_MODEL_PATH))
PERSON_DETECTOR_PATH = os.environ.get("FALL_PERSON_DETECTOR")
person_detector = YOLO(PERSON_DETECTOR_PATH) if PERSON_DETECTOR_PATH else None
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
fall_model = LSTMClassifier(input_dim=3, hidden_dim=64, output_dim=2).to(device)
fall_model.load_state_dict(torch.load(PROJECT_ROOT / "lstm_fall_model_fallandnofall.pth", map_location=device))
fall_model.eval()


class FallEvent(BaseModel):
    person_id: str = "unknown"
    camera_id: str = "camera_01"
    confidence: float = Field(ge=0, le=1)
    confidence_kind: Literal["lstm_score", "pose_keypoint_quality"] | None = None
    message: str = "Ph\u00e1t hi\u1ec7n ng\u01b0\u1eddi t\u00e9 ng\u00e3"


app = FastAPI(title="Fall Detection API", version="0.1.0")
from fastapi.staticfiles import StaticFiles
app.mount("/analysis-results", StaticFiles(directory=ANALYSIS_DIR), name="analysis-results")
app.mount("/user-avatars", StaticFiles(directory=AVATAR_DIR), name="user-avatars")

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
camera_health_state: dict[str, dict] = {}
live_frame_buffers: dict[str, deque] = {}
_previous_cpu_times: tuple[int, int, int] | None = None

def cpu_load_percent() -> float | None:
    global _previous_cpu_times
    if os.name == "nt":
        class FileTime(ctypes.Structure):
            _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]
        idle, kernel, user = FileTime(), FileTime(), FileTime()
        if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            return None
        current = tuple((part.high << 32) | part.low for part in (idle, kernel, user))
    else:
        if not hasattr(os, "getloadavg"): return None
        return round(min(100.0, os.getloadavg()[0] / max(1, os.cpu_count() or 1) * 100), 1)
    previous = _previous_cpu_times
    _previous_cpu_times = current
    if previous is None: return None
    idle_delta, kernel_delta, user_delta = (now - before for now, before in zip(current, previous))
    total = kernel_delta + user_delta
    return round(max(0.0, min(100.0, (total - idle_delta) / total * 100)), 1) if total else 0.0
live_decision_streams: dict[str, "FallDecisionStream"] = {}
last_fall_alert: dict[str, datetime] = {}
PRIMARY_PERSON_CONFIDENCE = 0.20
PRIMARY_PERSON_CENTER_REGION = (0.15, 0.10, 0.85, 0.92)
POSE_CANDIDATE_CONFIDENCE = 0.05



class AuthRegister(BaseModel):
    email: str = Field(min_length=5, max_length=254)  # Email or Vietnamese phone number.
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=128)

class AuthApproval(BaseModel):
    approved: bool

class AuthLogin(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

class AuthProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

class AuthUserCreate(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=128)
    role: str = Field(default="viewer", pattern="^(admin|viewer)$")

class AuthUserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    email: str | None = Field(default=None, min_length=5, max_length=254)
    password: str | None = Field(default=None, min_length=10, max_length=128)
    role: str | None = Field(default=None, pattern="^(admin|viewer)$")

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
    try:
        return normalize_contact(email)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error

def ensure_admin_account() -> None:
    if read_json_list(USERS_FILE):
        return
    bootstrap_password = os.getenv("FALLGUARD_ADMIN_PASSWORD")
    if not bootstrap_password:
        raise RuntimeError("No users found. Set FALLGUARD_ADMIN_PASSWORD to bootstrap admin@gmail.com.")
    if len(bootstrap_password) < 10 or not re.search(r"[A-Za-z]", bootstrap_password) or not re.search(r"[0-9]", bootstrap_password):
        raise RuntimeError("FALLGUARD_ADMIN_PASSWORD must be 10+ characters and contain letters and numbers.")
    admin = {"id": secrets.token_hex(16), "email": "admin@gmail.com", "name": "Admin", "role": "admin", "status": "approved",
             **password_hash(bootstrap_password), "created_at": datetime.now(timezone.utc).isoformat()}
    write_json_list(USERS_FILE, [admin])

def reset_admin_password_if_requested() -> None:
    password = os.getenv("FALLGUARD_ADMIN_RESET_PASSWORD")
    if not password:
        return
    if len(password) < 10 or not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        raise RuntimeError("FALLGUARD_ADMIN_RESET_PASSWORD must be 10+ characters and contain letters and numbers.")
    users = read_json_list(USERS_FILE)
    admin = next((user for user in users if user.get("email", "").lower() == "admin@gmail.com"), None)
    if not admin:
        raise RuntimeError("Cannot reset admin password: admin@gmail.com was not found.")
    admin.update(password_hash(password))
    admin["role"] = "admin"
    admin["status"] = "approved"
    write_json_list(USERS_FILE, users)
    write_json_list(SESSIONS_FILE, [session for session in read_json_list(SESSIONS_FILE)
                                    if session.get("user_id") != admin["id"]])

def password_hash(password: str, salt: str | None = None) -> dict:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 310000)
    return {"salt": salt, "password_hash": digest.hex()}

def public_user(user: dict) -> dict:
    is_admin_account = user.get("email", "").lower() == "admin@gmail.com"
    return {"id": user["id"], "email": user["email"], "contact_type": "phone" if user["email"].startswith("+84") else "email", "name": user["name"],
            "created_at": user["created_at"], "role": "admin" if is_admin_account else user.get("role", "guest"),
            "status": "approved" if is_admin_account else user.get("status", "approved"),
            "avatar_url": user.get("avatar_url")}

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
    if user.get("status", "approved") != "approved":
        raise HTTPException(403, "Tài khoản chưa được quản trị viên duyệt.")
    return user

def require_admin_user(authorization: str | None) -> dict:
    user = get_session_user(authorization)
    role = "admin" if user.get("email", "").lower() == "admin@gmail.com" else user.get("role", "guest")
    if role != "admin":
        raise HTTPException(403, "Chỉ quản trị viên mới được quản lý tài khoản.")
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
            user = get_session_user(request.headers.get("authorization"))
            if path.startswith("/api/auth/users") or path.startswith("/api/admin/"):
                role = "admin" if user.get("email", "").lower() == "admin@gmail.com" else user.get("role", "guest")
                if role != "admin":
                    raise HTTPException(403, "Chỉ quản trị viên mới được quản lý tài khoản.")
        except HTTPException as error:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=error.status_code, content={"detail": error.detail})
    return await call_next(request)

ensure_admin_account()
reset_admin_password_if_requested()

@app.get("/api/auth/config")
def auth_config() -> dict:
    return {"registration_open": True, "approval_required": True}

@app.post("/api/auth/register", status_code=201)
def register_user(payload: AuthRegister) -> dict:
    email = normalize_email(payload.email)
    users = read_json_list(USERS_FILE)
    if email == "admin@gmail.com":
        raise HTTPException(409, "Email này đã được dùng cho tài khoản quản trị.")
    if len(payload.password) < 10 or not re.search(r"[A-Za-z]", payload.password) or not re.search(r"[0-9]", payload.password):
        raise HTTPException(422, "Password must be at least 10 characters and include letters and numbers")
    if any(normalize_email(user.get("email", "")) == email for user in users):
        raise HTTPException(409, "Email này đã được đăng ký.")
    user = {"id": secrets.token_hex(16), "email": email, "name": payload.name.strip(), "role": "guest", "status": "pending",
            **password_hash(payload.password), "created_at": datetime.now(timezone.utc).isoformat()}
    users.append(user)
    write_json_list(USERS_FILE, users)
    record_audit("account.registered", {"email": email})
    return {"status": "pending", "message": "Đã gửi yêu cầu. Vui lòng chờ quản trị viên duyệt tài khoản."}

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
    if user.get("status", "approved") != "approved":
        state = user.get("status", "pending")
        detail = "Tài khoản đang chờ quản trị viên duyệt." if state == "pending" else "Yêu cầu tài khoản đã bị từ chối. Hãy liên hệ quản trị viên."
        raise HTTPException(403, detail)
    record_audit("auth.login", {"user_id": user.get("id"), "email": email})
    return create_session(user)

@app.get("/api/auth/me")
def current_user(authorization: str | None = Header(default=None)) -> dict:
    return public_user(get_session_user(authorization))

@app.get("/api/auth/users")
def list_auth_users(authorization: str | None = Header(default=None)) -> list[dict]:
    require_admin_user(authorization)
    return [public_user(user) for user in read_json_list(USERS_FILE)]

@app.post("/api/auth/users", status_code=201)
def create_auth_user(payload: AuthUserCreate, authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    email = normalize_email(payload.email)
    if len(payload.password) < 10 or not re.search(r"[A-Za-z]", payload.password) or not re.search(r"[0-9]", payload.password):
        raise HTTPException(422, "Password must be at least 10 characters and include letters and numbers")
    users = read_json_list(USERS_FILE)
    if any(normalize_email(user.get("email", "")) == email for user in users):
        raise HTTPException(409, "An account with this email already exists")
    user = {"id": secrets.token_hex(16), "email": email, "name": payload.name.strip(), "role": payload.role, "status": "approved",
            **password_hash(payload.password), "created_at": datetime.now(timezone.utc).isoformat()}
    users.append(user)
    write_json_list(USERS_FILE, users)
    record_audit("account.created", {"id": user["id"], "email": email})
    return public_user(user)

@app.patch("/api/auth/users/{user_id}")
def update_auth_user(user_id: str, payload: AuthUserUpdate,
                     authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    users = read_json_list(USERS_FILE)
    user = next((item for item in users if item.get("id") == user_id), None)
    if not user:
        raise HTTPException(404, "Không tìm thấy tài khoản.")
    if user.get("role") == "admin" or user.get("email", "").lower() == "admin@gmail.com":
        raise HTTPException(400, "Hãy sửa hồ sơ quản trị trong mục Tài khoản.")
    changes = payload.model_dump(exclude_unset=True)
    if "email" in changes:
        changes["email"] = normalize_email(changes["email"])
        if any(normalize_email(item.get("email", "")) == changes["email"] and item.get("id") != user_id for item in users):
            raise HTTPException(409, "Email này đã được sử dụng.")
    password = changes.pop("password", None)
    if password is not None:
        if not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
            raise HTTPException(422, "Mật khẩu cần có cả chữ và số.")
        user.update(password_hash(password))
        write_json_list(SESSIONS_FILE, [session for session in read_json_list(SESSIONS_FILE)
                                        if session.get("user_id") != user_id])
    user.update(changes)
    write_json_list(USERS_FILE, users)
    record_audit("account.updated", {"id": user_id, "fields": list(changes) + (["password"] if password is not None else [])})
    return public_user(user)

@app.get("/api/auth/requests")
def list_account_requests(authorization: str | None = Header(default=None)) -> list[dict]:
    require_admin_user(authorization)
    return [public_user(user) for user in read_json_list(USERS_FILE) if user.get("status") == "pending"]

@app.patch("/api/auth/users/{user_id}/approval")
def approve_account(user_id: str, decision: AuthApproval,
                    authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    users = read_json_list(USERS_FILE)
    user = next((item for item in users if item.get("id") == user_id), None)
    if not user:
        raise HTTPException(404, "Không tìm thấy tài khoản.")
    if user.get("role") == "admin" or user.get("email", "").lower() == "admin@gmail.com":
        raise HTTPException(400, "Không thể thay đổi trạng thái tài khoản quản trị.")
    user["role"] = "viewer"
    user["status"] = "approved" if decision.approved else "rejected"
    write_json_list(USERS_FILE, users)
    record_audit("account.approval", {"id": user_id, "approved": decision.approved})
    if not decision.approved:
        write_json_list(SESSIONS_FILE, [session for session in read_json_list(SESSIONS_FILE)
                                        if session.get("user_id") != user_id])
    return public_user(user)

@app.delete("/api/auth/users/{user_id}")
def delete_auth_user(user_id: str, authorization: str | None = Header(default=None)) -> dict:
    current = require_admin_user(authorization)
    users = read_json_list(USERS_FILE)
    if user_id == current["id"]:
        raise HTTPException(400, "You cannot delete the account you are using")
    target = next((user for user in users if user.get("id") == user_id), None)
    if target and (target.get("role") == "admin" or target.get("email", "").lower() == "admin@gmail.com"):
        raise HTTPException(400, "The administrator account cannot be deleted here")
    remaining = [user for user in users if user["id"] != user_id]
    if len(remaining) == len(users):
        raise HTTPException(404, "Account not found")
    write_json_list(USERS_FILE, remaining)
    write_json_list(SESSIONS_FILE, [session for session in read_json_list(SESSIONS_FILE) if session.get("user_id") != user_id])
    record_audit("account.deleted", {"id": user_id})
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
    record_audit("auth.password_changed", {"user_id": user["id"]})
    return {"ok": True, "message": "Password updated. Please sign in again."}

@app.post("/api/auth/logout")
def logout_user(authorization: str | None = Header(default=None)) -> dict:
    current = get_session_user(authorization)
    token = bearer_token(authorization)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    sessions = [s for s in read_json_list(SESSIONS_FILE) if not hmac.compare_digest(s.get("token_hash", ""), token_hash)]
    write_json_list(SESSIONS_FILE, sessions)
    record_audit("auth.logout", {"user_id": current["id"]})
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
    record_audit("profile.updated", {"user_id": current["id"], "fields": ["name"]})
    return public_user(current)

@app.post("/api/auth/avatar")
async def update_current_avatar(file: UploadFile = File(...),
                                authorization: str | None = Header(default=None)) -> dict:
    current = get_session_user(authorization)
    extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(file.content_type or "")
    if not extension:
        raise HTTPException(415, "Chỉ nhận ảnh JPG, PNG hoặc WebP.")
    content = await file.read(3 * 1024 * 1024 + 1)
    if not content or len(content) > 3 * 1024 * 1024:
        raise HTTPException(413, "Ảnh đại diện cần nhỏ hơn 3 MB.")
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(415, "Tệp tải lên không phải ảnh hợp lệ.")
    for old_file in AVATAR_DIR.glob(f"{current['id']}.*"):
        old_file.unlink(missing_ok=True)
    filename = f"{current['id']}.{extension}"
    (AVATAR_DIR / filename).write_bytes(content)
    current["avatar_url"] = f"/user-avatars/{filename}"
    users = read_json_list(USERS_FILE)
    for index, item in enumerate(users):
        if item.get("id") == current["id"]:
            users[index] = current
            break
    write_json_list(USERS_FILE, users)
    record_audit("profile.avatar_updated", {"user_id": current["id"]})
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

class AppSettingsUpdate(BaseModel):
    ai: dict | None = None
    contacts: list[dict] | None = None
    channels: dict | None = None
    escalation: dict | None = None

class EventUpdate(BaseModel):
    status: str = Field(pattern="^(unresolved|resolved|false_alarm|emergency_called)$")
    note: str = Field(default="", max_length=500)

def read_app_settings() -> dict:
    if not APP_SETTINGS_FILE.exists():
        return {"ai": {"geometry_confirm_seconds": 0.2, "lstm_confidence_threshold": 0.65, "sensitivity": 0.55, "schedule_enabled": False,
                        "schedule_start": "00:00", "schedule_end": "23:59", "show_skeleton": True,
                        "show_boxes": True, "ignore_zones": [], "priority_camera": None}, "contacts": [],
                "channels": {"push": True, "sms": False, "call": False, "zalo": False}}
    try:
        return json.loads(APP_SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"ai": {}, "contacts": [], "channels": {"push": True, "sms": False, "call": False, "zalo": False}}

def write_app_settings(settings: dict) -> None:
    APP_SETTINGS_FILE.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")

def configured_postprocessor(settings: dict | None = None) -> FallPostProcessor:
    settings = settings if settings is not None else read_app_settings().get("ai", {})
    hold, speed, _, _ = detection_profile(settings)
    return FallPostProcessor(lying_duration_s=hold, velocity_threshold=speed)

def detection_profile(settings: dict) -> tuple[float, float, int, float]:
    # The old multi-second fall_hold_seconds setting does not gate the new
    # strong-transition route. Its replacement is explicit and time based.
    effective_hold = min(1.5, max(0.15, float(settings.get("geometry_confirm_seconds", 0.2))))
    sensitivity = min(0.95, max(0.2, float(settings.get("sensitivity", 0.55))))
    speed_threshold = max(0.35, 1.15 - sensitivity)
    model_votes = 2
    model_span_s = 0.15
    return effective_hold, speed_threshold, model_votes, model_span_s

def point_in_polygon(point: tuple[float, float], polygon: list[list[float]]) -> bool:
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i, vertex in enumerate(polygon):
        xi, yi = float(vertex[0]), float(vertex[1])
        xj, yj = float(polygon[j][0]), float(polygon[j][1])
        if ((yi > y) != (yj > y)) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            inside = not inside
        j = i
    return inside

def person_in_configured_zone(camera_id: str, bbox_xyxy, frame_shape, settings: dict) -> bool:
    zones = settings.get("camera_zones", {})
    zone = zones.get(camera_id) if isinstance(zones, dict) else None
    if not isinstance(zone, dict):
        return True
    try:
        polygon = [(float(point[0]), float(point[1])) for point in zone.get("points", [])]
    except (TypeError, ValueError, IndexError):
        return True
    if len(polygon) < 3 or not all(np.isfinite(point).all() and 0 <= point[0] <= 1 and 0 <= point[1] <= 1 for point in polygon):
        return True
    frame_h, frame_w = frame_shape[:2]
    x1, y1, x2, y2 = map(float, bbox_xyxy)
    anchor = ((x1 + x2) / (2 * frame_w), (y1 + y2) / (2 * frame_h))
    inside = point_in_polygon(anchor, polygon)
    return inside if zone.get("mode") == "include" else not inside

def schedule_is_active(settings: dict) -> bool:
    if not settings.get("schedule_enabled"):
        return True
    now = datetime.now().strftime("%H:%M")
    start, end = settings.get("schedule_start", "00:00"), settings.get("schedule_end", "23:59")
    return start <= now <= end if start <= end else now >= start or now <= end

def record_audit(action: str, detail: dict | None = None) -> None:
    try:
        rows = json.loads(AUDIT_FILE.read_text(encoding="utf-8")) if AUDIT_FILE.exists() else []
    except (OSError, json.JSONDecodeError):
        rows = []
    rows.append({"action": action, "detail": detail or {}, "created_at": datetime.now(timezone.utc).isoformat()})
    AUDIT_FILE.write_text(json.dumps(rows[-500:], ensure_ascii=False, indent=2), encoding="utf-8")

def read_cameras() -> list[dict]:
    if not CAMERAS_FILE.exists():
        return [{"id": "camera_01", "name": "Camera phÃ²ng khÃ¡ch", "source": "0", "location": "PhÃ²ng khÃ¡ch", "enabled": True}]
    return json.loads(CAMERAS_FILE.read_text(encoding="utf-8"))

def write_cameras(cameras: list[dict]) -> None:
    CAMERAS_FILE.write_text(json.dumps(cameras, ensure_ascii=False, indent=2), encoding="utf-8")

@app.get("/api/cameras")
def list_cameras(authorization: str | None = Header(default=None)) -> list[dict]:
    get_session_user(authorization)
    return read_cameras()

@app.get("/api/cameras/health")
def list_camera_health(authorization: str | None = Header(default=None)) -> list[dict]:
    get_session_user(authorization)
    now = time.monotonic()
    result = []
    for camera in read_cameras():
        health = camera_health_state.get(camera["id"], {})
        age = now - health.get("seen_at", 0)
        result.append({"id": camera["id"], "online": bool(camera.get("enabled", True) and age < 5),
                       "fps": health.get("fps", 0), "latency_ms": health.get("latency_ms"),
                       "state": health.get("state", "OFFLINE") if age < 5 else "OFFLINE"})
    return result

@app.get("/api/settings")
def get_app_settings(authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    return read_app_settings()

@app.get("/api/contacts")
def get_emergency_contacts(authorization: str | None = Header(default=None)) -> dict:
    get_session_user(authorization)
    settings = read_app_settings()
    return {"contacts": settings.get("contacts", []), "channels": settings.get("channels", {}),
            "escalation": settings.get("escalation", {})}

@app.get("/api/ai-settings")
def get_ai_settings(authorization: str | None = Header(default=None)) -> dict:
    get_session_user(authorization)
    return read_app_settings().get("ai", {})

@app.put("/api/settings")
def update_app_settings(settings: AppSettingsUpdate,
                        authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    current = read_app_settings()
    values = settings.model_dump(exclude_unset=True)
    if "ai" in values:
        current["ai"] = {**current.get("ai", {}), **(values["ai"] or {})}
    if "contacts" in values:
        current["contacts"] = values["contacts"] or []
    if "channels" in values:
        current["channels"] = values["channels"] or {}
    if "escalation" in values:
        current["escalation"] = values["escalation"] or {}
    write_app_settings(current)
    record_audit("settings.updated", {"keys": list(values)})
    return current

@app.get("/api/audit-logs")
def list_audit_logs(authorization: str | None = Header(default=None)) -> list[dict]:
    require_admin_user(authorization)
    if not AUDIT_FILE.exists(): return []
    try: return json.loads(AUDIT_FILE.read_text(encoding="utf-8"))[::-1]
    except (OSError, json.JSONDecodeError): return []

@app.post("/api/cameras", status_code=201)
def create_camera(camera: Camera, authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    if camera.source != "0":
        raise HTTPException(422, "Hiện chỉ hỗ trợ webcam trình duyệt (source=0); IP/RTSP chưa hoạt động.")
    cameras = read_cameras()
    next_id = 1
    used = {item.get("id") for item in cameras}
    while f"camera_{next_id:02d}" in used:
        next_id += 1
    item = {"id": f"camera_{next_id:02d}", **camera.model_dump()}
    cameras.append(item)
    write_cameras(cameras)
    record_audit("camera.created", {"id": item["id"], "name": item["name"]})
    return item

@app.patch("/api/cameras/{camera_id}")
def update_camera(camera_id: str, update: CameraUpdate,
                  authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    if update.source is not None and update.source != "0":
        raise HTTPException(422, "Hiện chỉ hỗ trợ webcam trình duyệt (source=0); IP/RTSP chưa hoạt động.")
    cameras = read_cameras()
    for camera in cameras:
        if camera["id"] == camera_id:
            camera.update({k: v for k, v in update.model_dump().items() if v is not None})
            write_cameras(cameras)
            record_audit("camera.updated", {"id": camera_id})
            return camera
    raise HTTPException(404, "Camera not found")

@app.delete("/api/cameras/{camera_id}")
def delete_camera(camera_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    cameras = read_cameras()
    remaining = [camera for camera in cameras if camera["id"] != camera_id]
    if len(remaining) == len(cameras):
        raise HTTPException(404, "Camera not found")
    write_cameras(remaining)
    record_audit("camera.deleted", {"id": camera_id})
    return {"ok": True, "id": camera_id}

def read_push_subscriptions():
    if not PUSH_FILE.exists(): return []
    return json.loads(PUSH_FILE.read_text(encoding="utf-8"))

def send_push(payload: dict):
    if not read_app_settings().get("channels", {}).get("push", True): return
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


def model_prediction_consensus(votes: deque[tuple[float, int, float]], prediction: int | None,
                               confidence: float | None, timestamp_s: float,
                               required: int, minimum_span_s: float,
                               min_confidence: float = 0.65,
                               sample_interval_s: float = 0.25) -> bool:
    """Require the same LSTM class over time before comparing it with rules."""
    if prediction is None or confidence is None or not np.isfinite(confidence) or confidence < min_confidence:
        votes.clear()
        return False
    if votes and votes[-1][1] != int(prediction):
        votes.clear()
    if prediction is not None and confidence is not None and np.isfinite(confidence):
        if not votes or timestamp_s - votes[-1][0] >= sample_interval_s:
            votes.append((timestamp_s, int(prediction), float(confidence)))
    matching = [sample for sample in votes if prediction is not None and
                sample[1] == prediction and sample[2] >= min_confidence]
    return (len(matching) >= required and
            matching[-1][0] - matching[0][0] >= minimum_span_s)


class FallDecisionStream:
    """Run the keypoint model and geometric rules as one ordered decision path."""

    def __init__(self, settings: dict):
        self.sequence: deque[list[float]] = deque(maxlen=40)
        self.model_votes: deque[tuple[float, int, float]] = deque(maxlen=9)
        self.postprocessor = configured_postprocessor(settings)
        self.latest_probability: float | None = None
        self.latest_prediction: int | None = None
        self.latest_model_confidence: float | None = None
        self.last_valid_timestamp: float | None = None
        self.last_model_timestamp: float | None = None
        self.bend_support: tuple[float, float, float] | None = None
        self.floor_reference: tuple[float, float, float] | None = None
        self.standing_head_hip: tuple[float, float] | None = None
        self.floor_candidate_since: float | None = None
        self.compact_landing: tuple[float, int] | None = None
        self.on_floor_since: float | None = None
        self.lying_reference: tuple[float, float, float] | None = None
        self.lying_drop_since: float | None = None
        self.lying_drop_confirmed = False
        self.settings = settings

    def reset(self, timestamp_s: float) -> None:
        self.sequence.clear()
        self.model_votes.clear()
        self.latest_probability = None
        self.latest_prediction = None
        self.latest_model_confidence = None
        self.last_valid_timestamp = None
        self.last_model_timestamp = None
        self.bend_support = None
        self.floor_reference = None
        self.standing_head_hip = None
        self.floor_candidate_since = None
        self.compact_landing = None
        self.on_floor_since = None
        self.lying_reference = None
        self.lying_drop_since = None
        self.lying_drop_confirmed = False
        self.postprocessor.update(None, timestamp_s)

    def update(self, keypoints, confidence, timestamp_s: float) -> dict:
        if self.last_valid_timestamp is not None and not 0 < timestamp_s - self.last_valid_timestamp <= 2.0:
            self.reset(timestamp_s)
        self.last_valid_timestamp = timestamp_s
        hold, speed_threshold, required_votes, required_span = detection_profile(self.settings)
        self.postprocessor.lying_duration_s = hold
        self.postprocessor.velocity_threshold = speed_threshold

        # Stage 1: convert this valid pose into the same three features used at train time.
        points = np.asarray(keypoints, dtype=float)
        scores = np.asarray(confidence, dtype=float).reshape(-1)
        model_indices = [0, 5, 6, 11, 12]
        model_pose_valid = bool(len(scores) >= 17 and points.shape[0] >= 17 and
                            np.all(scores[model_indices] >= 0.25) and
                            np.isfinite(points[model_indices, :2]).all() and
                            np.all(np.any(np.abs(points[model_indices, :2]) > 1e-6, axis=1)))
        if self.last_model_timestamp is not None and timestamp_s - self.last_model_timestamp > 1.0:
            self.sequence.clear()
            self.model_votes.clear()
        if model_pose_valid:
            self.sequence.append(extract_features(points))
            self.last_model_timestamp = timestamp_s
        model_ready = bool(model_pose_valid and len(self.sequence) == self.sequence.maxlen)
        probability = None
        prediction = None
        model_confidence = None
        if model_ready:
            window = torch.tensor(np.asarray(self.sequence, dtype=np.float32), dtype=torch.float32).unsqueeze(0).to(device)
            with torch.no_grad():
                probabilities = torch.softmax(fall_model(window), dim=1)[0]
            probability = float(probabilities[1].item())
            prediction = int(torch.argmax(probabilities).item())
            model_confidence = float(probabilities[prediction].item())
            self.latest_probability = probability
            self.latest_prediction = prediction
            self.latest_model_confidence = model_confidence
        model_consensus = model_prediction_consensus(
            self.model_votes, prediction, model_confidence, timestamp_s,
            required=required_votes, minimum_span_s=required_span,
            min_confidence=float(self.settings.get("lstm_confidence_threshold", 0.65)),
        )

        # Stage 2: evaluate geometry and movement from the same pose/timestamp.
        geometry_state = self.postprocessor.update(keypoints, timestamp_s, confidence)
        metrics = self.postprocessor.last_metrics
        geometry_fall = geometry_state == "FALL"
        model_predicts_fall = prediction == 1 if prediction is not None else None
        confidence_threshold = min(0.99, max(0.5, float(self.settings.get("lstm_confidence_threshold", 0.65))))
        model_confident = model_confidence is not None and model_confidence >= confidence_threshold
        agrees = bool(model_ready and model_confident and model_predicts_fall == geometry_fall)
        ratio = metrics.box_ratio if metrics else 0.0
        horizontal = self.postprocessor.last_horizontal_pose
        fusion = decide_fall(
            geometry_state=geometry_state, horizontal=horizontal,
            rapid_tilt=self.postprocessor.horizontal_rapid_tilt_seen if horizontal else self.postprocessor.last_rapid_tilt,
            rapid_descent=self.postprocessor.last_recent_fast_drop,
            transition_descent=self.postprocessor.horizontal_fast_drop_seen,
            horizontal_motion=self.postprocessor.last_horizontal_motion,
            model_ready=model_ready, model_consensus=model_consensus,
            model_predicts_fall=model_predicts_fall,
            model_confident=model_confident,
            geometry_ready=len(self.postprocessor.motion_history) >= 3,
        )
        final_state, verdict = fusion.state, fusion.verdict
        decision_source = fusion.source
        near_floor = False
        floor_duration = 0.0
        if metrics is not None:
            leg_indices = [11, 12, 13, 14, 15, 16]
            legs_visible = bool(np.all(scores[leg_indices] >= 0.25)
                                and np.isfinite(points[leg_indices, :2]).all()
                                and np.all(np.any(points[leg_indices, :2] != 0, axis=1)))
            hips, knees, ankles = points[11:13, 1], points[13:15, 1], points[15:17, 1]
            hip_y = float(np.mean(hips))
            leg_height = float(np.mean(ankles - hips))
            planted = legs_visible and bool(np.all(knees > hips) and np.all(ankles > knees))
            bend_angle = self.postprocessor.bending_angle_degrees
            if planted and metrics.trunk_tilt_degrees < bend_angle / 2:
                self.floor_reference = (float(np.mean(ankles)), metrics.body_height, timestamp_s)
            if self.bend_support is None and planted and metrics.trunk_tilt_degrees >= bend_angle:
                self.bend_support = (timestamp_s, hip_y, leg_height)
            if self.bend_support is not None:
                started, initial_hip_y, initial_leg_height = self.bend_support
                recovered = planted and metrics.trunk_tilt_degrees < bend_angle / 2
                lost_support = (legs_visible and hip_y - initial_hip_y >= 0.35 * initial_leg_height
                                and leg_height <= 0.55 * initial_leg_height)
                if recovered:
                    self.bend_support = None
                    self.postprocessor.update(None, timestamp_s)
                    self.sequence.clear()
                    self.model_votes.clear()
                    final_state, verdict, decision_source = "NORMAL", "NO_FALL", "bend_recovered"
                elif lost_support and (horizontal or fusion.verdict == "FALL"):
                    self.bend_support = None
                    final_state, verdict, decision_source = "FALL", "FALL", "bend_support_lost"
                elif planted and timestamp_s - started >= 2.0:
                    final_state, verdict, decision_source = "BENDING", "NO_FALL", "bend_stable"
                else:
                    final_state, verdict, decision_source = "VERIFYING_FALL", "PENDING", "bend_verifying"
            head = points[:5, :2]
            head_visible = (scores[:5] >= 0.25) & np.isfinite(head).all(axis=1) & np.any(head != 0, axis=1)
            hips_visible = (scores[11:13] >= 0.25) & np.isfinite(points[11:13, :2]).all(axis=1)
            head_y = float(np.median(head[head_visible, 1])) if head_visible.any() else None
            visible_hip_y = float(np.mean(hips[hips_visible])) if hips_visible.any() else None
            if self.floor_reference is not None:
                floor_y, upright_height, last_standing = self.floor_reference
                if last_standing == timestamp_s:
                    self.standing_head_hip = (head_y, visible_hip_y) if head_y is not None and visible_hip_y is not None else None
                tolerance = 0.25 * upright_height
                near_floor = bool(horizontal and head_visible.any() and hips_visible.any()
                                  and abs(head_y - floor_y) <= tolerance
                                  and abs(visible_hip_y - floor_y) <= tolerance)
                recent_standing = timestamp_s - last_standing <= 3.0
                initial_pose = self.standing_head_hip
                leg_vectors = points[15:17, :2] - points[11:13, :2]
                leg_horizontal = legs_visible and bool(np.any(
                    (np.abs(leg_vectors[:, 0]) >= 0.15 * upright_height)
                    & (np.abs(leg_vectors[:, 0]) >= 2 * np.abs(leg_vectors[:, 1]))
                ))
                head_horizontal = False
                if head_visible.any() and np.all(scores[5:7] >= 0.25):
                    head_offset = np.median(head[head_visible], axis=0) - np.mean(points[5:7, :2], axis=0)
                    head_horizontal = bool(abs(head_offset[0]) >= 0.08 * upright_height
                                           and abs(head_offset[0]) >= 2 * abs(head_offset[1]))
                compact_low = bool(
                    not horizontal and not planted and (legs_visible or head_horizontal) and initial_pose is not None
                    and head_y is not None and visible_hip_y is not None
                    and (abs(head_y - floor_y) <= 0.30 * upright_height
                         or leg_horizontal or head_horizontal)
                    and abs(visible_hip_y - floor_y) <= tolerance
                    and head_y - initial_pose[0] >= 0.45 * upright_height
                    and visible_hip_y - initial_pose[1] >= 0.25 * upright_height
                )
                compact_confirmed = False
                if compact_low and recent_standing and (
                    self.compact_landing is not None or (
                        self.postprocessor.last_recent_fast_drop and self.postprocessor.last_rapid_tilt
                    )
                ):
                    started, count = self.compact_landing or (timestamp_s, 0)
                    self.compact_landing = (started, count + 1)
                    compact_confirmed = count >= 2 and timestamp_s - started >= 0.08
                else:
                    self.compact_landing = None
                rapid_descent = self.postprocessor.horizontal_fast_drop_seen
                rapid_tilt = self.postprocessor.horizontal_rapid_tilt_seen
                strong_model = bool(model_consensus and probability is not None
                                    and probability >= max(0.9, confidence_threshold))
                paired_evidence = bool(rapid_descent and rapid_tilt and probability is not None
                                       and probability >= 0.60)
                still_supported = self.bend_support is not None and planted
                if near_floor and recent_standing and not still_supported and initial_pose is not None:
                    head_drop = head_y - initial_pose[0]
                    hip_drop = visible_hip_y - initial_pose[1]
                    if head_drop >= 0.40 * upright_height and hip_drop >= 0.22 * upright_height:
                        if self.floor_candidate_since is None:
                            self.floor_candidate_since = timestamp_s
                    else:
                        self.floor_candidate_since = None
                else:
                    self.floor_candidate_since = None
                trajectory_fall = (self.floor_candidate_since is not None
                                   and timestamp_s - self.floor_candidate_since >= 0.6
                                   and (rapid_descent or rapid_tilt))
                source = None
                if near_floor and recent_standing and not still_supported:
                    if geometry_fall:
                        source = "floor_fall"
                    elif strong_model and (rapid_descent or rapid_tilt):
                        source = "floor_lstm"
                    elif paired_evidence:
                        source = "floor_agreement"
                    elif trajectory_fall:
                        source = "floor_trajectory"
                elif compact_confirmed:
                    source = "floor_compact"
                if (near_floor or compact_low) and (self.on_floor_since is not None or source is not None):
                    if self.on_floor_since is None:
                        self.on_floor_since = timestamp_s
                    floor_duration = timestamp_s - self.on_floor_since
                    final_state, verdict = "FALL", "FALL"
                    decision_source = "floor_persistent" if floor_duration >= 5.0 else source or (
                        "floor_compact" if compact_low else "floor_fall"
                    )
                else:
                    self.on_floor_since = None
            # A clip can start on a bed, without any standing floor reference.
            if horizontal and head_y is not None and visible_hip_y is not None:
                if self.lying_reference is None:
                    self.lying_reference = (head_y, visible_hip_y, timestamp_s)
                reference_head, reference_hip, lying_since = self.lying_reference
                elapsed = timestamp_s - lying_since
                drop = min(head_y - reference_head, visible_hip_y - reference_hip)
                scale = metrics.reference_body_size
                if (scale > 0 and drop >= 0.25 * scale and
                        (self.lying_drop_since is not None or
                         (elapsed >= 0.5 and self.postprocessor.last_recent_fast_drop))):
                    if self.lying_drop_since is None:
                        self.lying_drop_since = timestamp_s
                    duration = timestamp_s - self.lying_drop_since
                    if duration >= hold:
                        self.lying_drop_confirmed = True
                    if self.lying_drop_confirmed:
                        floor_duration = max(floor_duration, duration)
                        final_state, verdict, decision_source = "FALL", "FALL", "lying_drop"
                    elif verdict != "FALL":
                        final_state, verdict, decision_source = "VERIFYING_FALL", "PENDING", "lying_drop_verifying"
                else:
                    self.lying_drop_since = None
                    self.lying_drop_confirmed = False
                    if elapsed >= 0.5 and (scale <= 0 or drop < 0.25 * scale):
                        self.lying_reference = (head_y, visible_hip_y, lying_since)
                    if (elapsed >= 0.5 and self.on_floor_since is None
                            and (self.floor_reference is None or timestamp_s - self.floor_reference[2] > 3.0)):
                        final_state, verdict, decision_source = "LYING", "NO_FALL", "lying_without_drop"
            else:
                self.lying_reference = None
                self.lying_drop_since = None
                self.lying_drop_confirmed = False
        floor_sources = {"floor_fall", "floor_persistent", "floor_lstm", "floor_agreement", "floor_trajectory", "floor_compact"}
        if verdict == "FALL" and decision_source not in floor_sources | {"lying_drop"}:
            final_state, verdict, decision_source = "VERIFYING_FALL", "PENDING", "floor_verifying"
        analysis = {
            "valid_keypoint": True,
            "keypoint_frames": len(self.sequence),
            "model_ready": model_ready,
            "model_pose_valid": bool(model_pose_valid),
            "lstm_threshold": confidence_threshold,
            "lstm_fall_probability": probability,
            "lstm_prediction": "FALL" if prediction == 1 else "NO_FALL" if prediction == 0 else None,
            "lstm_confidence": model_confidence,
            "lstm_confident": model_confident,
            "lstm_consensus": model_consensus,
            "lstm_supports_fall": bool(model_confident and prediction == 1),
            "geometry_state": geometry_state,
            "geometry_verdict": "FALL" if geometry_fall else "UNCERTAIN" if horizontal or self.postprocessor.last_recent_fast_drop or self.postprocessor.last_rapid_tilt else "NO_FALL",
            "algorithms_agree": agrees,
            "decision_source": decision_source,
            "near_estimated_floor": near_floor,
            "floor_duration_s": round(floor_duration, 2),
            "fall_phase": ("ON_FLOOR" if decision_source == "floor_persistent" else
                           "FALLEN" if verdict == "FALL" else
                           "LOSS_OF_BALANCE" if verdict == "PENDING" and final_state == "VERIFYING_FALL" else
                           "STANDING" if final_state == "NORMAL" else final_state),
            "horizontal_pose": horizontal,
            "box_ratio": round(ratio, 3),
            "trunk_tilt_degrees": round(metrics.trunk_tilt_degrees, 1) if metrics else None,
            "downward_speed_body_heights_s": round(metrics.downward_speed_body_heights_s, 3) if metrics else None,
            "rapid_descent": self.postprocessor.last_recent_fast_drop,
            "rapid_tilt": self.postprocessor.last_rapid_tilt,
            "horizontal_rapid_tilt_seen": self.postprocessor.horizontal_rapid_tilt_seen,
            "horizontal_fast_drop_seen": self.postprocessor.horizontal_fast_drop_seen,
            "geometry_transition_evidence": self.postprocessor.horizontal_fast_drop_seen and (self.postprocessor.horizontal_rapid_tilt_seen or self.postprocessor.horizontal_origin_upright),
            "horizontal_motion": self.postprocessor.last_horizontal_motion,
            "horizontal_duration_s": round(metrics.horizontal_duration_s, 2) if metrics else 0.0,
            "required_horizontal_duration_s": round(hold, 2),
            "horizontal_confirm_frames": metrics.horizontal_frames if metrics else 0,
            "rotation_change_degrees": round(metrics.rotation_change_degrees, 1) if metrics else 0.0,
            "normalized_drop": round(metrics.normalized_drop, 3) if metrics else 0.0,
            "recovered_upright": self.postprocessor.upright_since_s is not None and timestamp_s - self.postprocessor.upright_since_s >= 0.35,
            "verdict": verdict,
            "state": final_state,
        }
        analysis["reason"] = {
            "lstm": f"Đã đủ 40 khung keypoint hợp lệ; điểm LSTM ngã {probability:.1%} vượt ngưỡng {confidence_threshold:.0%}." if probability is not None else "LSTM xác nhận ngã.",
            "lstm_geometry": "LSTM đủ 40 khung xác nhận ngã; chuỗi chuyển động hình học cũng ủng hộ.",
            "geometry_fallback": "Chuỗi keypoint hạ nhanh và đổi tư thế đã được xác minh qua nhiều khung hình; kết luận ngã bằng hình học.",
            "geometry_pending": "Đã thấy tư thế ngang nhưng thiếu chuỗi chuyển động rõ để xác nhận ngã; cần xác minh.",
            "transition": "Phát hiện chuyển động nhanh; đang xác minh tư thế sau chuyển động.",
            "lstm_no_fall": "LSTM đủ dữ liệu và chuyển động hiện tại chưa cho thấy ngã.",
            "model_uncertain": "Điểm LSTM chưa vượt ngưỡng quyết định; hình học cũng chưa đủ bằng chứng xác nhận.",
            "warming_up": "Đang thu thập chuỗi chuyển động keypoint để suy luận.",
            "geometry_normal": "Chưa đủ 40 khung cho LSTM; hình học hiện chưa ghi nhận chuỗi chuyển động ngã.",
            "bend_verifying": "Người đang cúi; theo dõi chân trụ và độ hạ của hông trước khi xác nhận ngã.",
            "bend_stable": "Sau 2 giây theo dõi, chân vẫn đứng trụ; tiếp tục quan sát.",
            "bend_recovered": "Người đã đứng thẳng lại và giữ được chân trụ.",
            "bend_support_lost": "Hông hạ rõ rệt và chân mất tư thế chống đỡ sau khi cúi; xác nhận ngã.",
            "floor_verifying": "Có dấu hiệu ngã; đang kiểm tra chuyển động và vị trí đầu, hông so với mức sàn ước tính.",
            "floor_fall": "Hạ nhanh, thân xoay ngang, đầu và hông gần mức sàn ước tính.",
            "floor_lstm": "LSTM dự đoán ngã ổn định với điểm cao; tư thế và chuyển động phù hợp với cú ngã.",
            "floor_agreement": "LSTM và hình học cùng ghi nhận dấu hiệu ngã; đầu và hông gần mức sàn ước tính.",
            "floor_trajectory": "Quỹ đạo xác nhận đầu và hông cùng hạ đáng kể rồi duy trì gần mức sàn ít nhất 0,6 giây.",
            "floor_compact": "Hạ nhanh và xoay thân, hông xuống thấp, có dấu hiệu mất trụ hoặc đầu nghiêng ngang qua nhiều khung dù thân còn gập.",
            "floor_persistent": "Đầu và hông vẫn gần mức sàn ước tính sau ít nhất 5 giây; chưa thấy người đứng dậy.",
            "lying_without_drop": "Người đang nằm; không thấy đầu và hông cùng tụt nhanh xuống thấp hơn.",
            "lying_drop_verifying": "Đầu và hông cùng tụt nhanh từ tư thế nằm; đang xác minh vị trí thấp hơn.",
            "lying_drop": "Đầu và hông cùng tụt nhanh từ tư thế nằm và duy trì ở vị trí thấp hơn.",
        }[decision_source]
        analysis["state"] = final_state
        if decision_source in floor_sources - {"floor_lstm"} | {"lying_drop"}:
            torso_scores = scores[[5, 6, 11, 12]]
            decision_confidence = float(np.clip(np.mean(torso_scores[torso_scores >= 0.25]), 0, 1))
            analysis["confidence_kind"] = "pose_keypoint_quality"
        else:
            decision_confidence = probability or 0.0
            analysis["confidence_kind"] = "lstm_score"
        return {"state": final_state, "confidence": decision_confidence, "analysis": analysis}


def get_live_decision_stream(camera_id: str, settings: dict) -> FallDecisionStream:
    stream = live_decision_streams.get(camera_id)
    if stream is None:
        stream = FallDecisionStream(settings)
        live_decision_streams[camera_id] = stream
    stream.settings = settings
    return stream


def validate_upper_body_keypoints(keypoints, confidence, threshold=0.35):
    """Geometry needs a reliable shoulder/hip pair; the head may be occluded.

    The LSTM separately checks all five feature points, including the nose.
    """
    if keypoints is None or confidence is None:
        return False, "missing_pose_or_confidence"
    points = np.asarray(keypoints)
    conf = np.asarray(confidence).reshape(-1)
    if points.ndim != 2 or points.shape[0] < 17 or points.shape[1] < 2 or len(conf) < 17:
        return False, "incomplete_keypoint_array"
    torso = [5, 6, 11, 12]
    if not np.isfinite(points[torso, :2]).all() or not np.isfinite(conf[torso]).all():
        return False, "non_finite_keypoint"
    reliable = lambda index: conf[index] > threshold and np.any(np.abs(points[index, :2]) > 1e-6)
    if not any(reliable(shoulder) and reliable(hip) for shoulder, hip in ((5, 11), (6, 12))):
        return False, "no_reliable_shoulder_hip_pair"
    return True, "ok"


def validate_person_box_and_hips(keypoints, confidence, frame_shape, threshold=0.35,
                                min_height_ratio=0.20, bbox_xyxy=None):
    """Reject tiny poses using their long extent, allowing horizontal bodies.

    Touching an image edge does not itself invalidate reliable torso points.
    """
    if keypoints is None or confidence is None or frame_shape is None:
        return False, "missing_box_inputs", None
    points = np.asarray(keypoints, dtype=np.float32)
    conf = np.asarray(confidence, dtype=np.float32).reshape(-1)
    frame_height, frame_width = frame_shape[:2]
    if points.ndim != 2 or points.shape[0] < 17 or len(conf) < 17 or frame_height <= 0 or frame_width <= 0:
        return False, "incomplete_box_inputs", None
    valid = (conf[:17] > threshold) & np.isfinite(points[:17, :2]).all(axis=1)
    valid &= ~((np.abs(points[:17, 0]) < 1e-6) & (np.abs(points[:17, 1]) < 1e-6))
    if int(valid.sum()) < 5:
        return False, "too_few_box_points", None
    visible = points[:17, :2][valid]
    if bbox_xyxy is None:
        x1, y1 = visible.min(axis=0)
        x2, y2 = visible.max(axis=0)
    else:
        x1, y1, x2, y2 = map(float, bbox_xyxy)
    box = (float(x1), float(y1), float(x2), float(y2))
    box_height = float(y2 - y1)
    box_width = float(x2 - x1)
    if box_height <= 1 or box_width <= 1 or max(box_height / frame_height, box_width / frame_width) < min_height_ratio:
        return False, "person_extent_too_small", box

    hip_indices = [i for i in (11, 12) if valid[i]]
    if not hip_indices:
        return False, "hip_keypoints_missing", box
    hip_y = float(np.mean(points[hip_indices, 1]))
    hip_x = float(np.mean(points[hip_indices, 0]))
    if not (0 <= hip_y < frame_height and 0 <= hip_x < frame_width):
        return False, "hip_outside_frame", box
    return True, "ok", box

SKELETON = [(0, 1), (0, 2), (1, 3), (2, 4), (5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16)]

def draw_keypoints(frame, keypoints, fall=False):
    points = [(int(x), int(y)) for x, y in keypoints]
    color = (40, 50, 235) if fall else (0, 215, 255)
    for a, b in SKELETON:
        cv2.line(frame, points[a], points[b], color, 2, cv2.LINE_AA)
    for point in points:
        cv2.circle(frame, point, 4, color, -1, cv2.LINE_AA)


def infer_primary_pose(frame, camera_id: str | None = None, settings: dict | None = None):
    """Return only the selected person's (keypoints, confidence, bbox)."""
    settings = settings if settings is not None else read_app_settings().get("ai", {})
    zones = settings.get("camera_zones", {})
    zone = zones.get(camera_id, {}) if isinstance(zones, dict) else {}
    polygon = zone.get("points", []) if zone.get("mode") == "include" else []
    center_region = PRIMARY_PERSON_CENTER_REGION
    center_filter = None
    if len(polygon) >= 3:
        try:
            points = [(float(point[0]), float(point[1])) for point in polygon]
            if all(np.isfinite(point).all() and 0 <= point[0] <= 1 and 0 <= point[1] <= 1 for point in points):
                xs, ys = zip(*points)
                bounds = (min(xs), min(ys), max(xs), max(ys))
                if bounds[0] < bounds[2] and bounds[1] < bounds[3]:
                    center_region = bounds
                    center_filter = lambda point: point_in_polygon(point, points)
        except (TypeError, ValueError, IndexError):
            center_filter = None
    if person_detector is not None:
        pose = infer_primary_person_pose(
            frame,
            person_detector,
            pose_model,
            pose_confidence=POSE_CANDIDATE_CONFIDENCE,
            selection_confidence=PRIMARY_PERSON_CONFIDENCE,
            center_region=center_region,
            center_filter=center_filter,
        )
        if pose is None:
            return None
        return pose.keypoints_xy, pose.keypoint_confidence, pose.detection.xyxy

    # The bundled YOLOv8-Pose model detects and estimates pose jointly. Keep
    # the keypoint set paired with the largest central person detection only.
    result = pose_model(frame, conf=POSE_CANDIDATE_CONFIDENCE, verbose=False)[0]
    selected = select_primary_person(
        result,
        frame.shape,
        confidence_threshold=PRIMARY_PERSON_CONFIDENCE,
        center_region=center_region,
        center_filter=center_filter,
    )
    if result.keypoints is None or selected is None or selected.index >= len(result.keypoints.xy):
        return None
    keypoints = result.keypoints.xy[selected.index].cpu().numpy()
    confidence = result.keypoints.conf[selected.index].cpu().numpy() if result.keypoints.conf is not None else None
    return keypoints, confidence, selected.xyxy

@app.post("/api/cameras/{camera_id}/frame")
async def analyze_camera_frame(camera_id: str, file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    get_session_user(authorization)
    camera = next((item for item in read_cameras() if item["id"] == camera_id), None)
    if camera is None:
        raise HTTPException(404, "Camera not found")
    if not camera.get("enabled", True):
        raise HTTPException(409, "Camera is disabled")
    ai_settings = read_app_settings().get("ai", {})
    if not schedule_is_active(ai_settings):
        timestamp = datetime.now(timezone.utc).isoformat()
        camera_health_state[camera_id] = {"seen_at": time.monotonic(), "state": "SCHEDULED_OFF", "fps": 0, "latency_ms": 0}
        current_status.update({"state": "SCHEDULED_OFF", "confidence": 0.0, "camera_id": camera_id, "fps": 0.0, "updated_at": timestamp})
        return {"state": "SCHEDULED_OFF", "frame_state": "SCHEDULED_OFF", "confidence": 0.0, "keypoints": []}
    started = datetime.now(timezone.utc)
    raw = await file.read()
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "Invalid image frame")
    frame_timestamp = time.monotonic()
    frame_buffer = live_frame_buffers.setdefault(camera_id, deque(maxlen=90))
    frame_buffer.append((frame_timestamp, raw))
    camera_health_state[camera_id] = {"seen_at": time.monotonic(), "state": "PROCESSING", "fps": 0, "latency_ms": None}
    primary_pose = infer_primary_pose(image, camera_id, ai_settings)
    if primary_pose is None:
        stream = get_live_decision_stream(camera_id, ai_settings)
        stream.reset(time.monotonic())
        ended = datetime.now(timezone.utc)
        elapsed = max((ended - started).total_seconds(), 1e-6)
        camera_health_state[camera_id] = {"seen_at": time.monotonic(), "state": "NO_PERSON", "fps": round(1 / elapsed, 2), "latency_ms": round(elapsed * 1000, 1)}
        current_status.update({"state": "NO_PERSON", "confidence": 0.0, "camera_id": camera_id, "fps": 0.0, "updated_at": ended.isoformat()})
        return {"state": "NO_PERSON", "confidence": 0, "keypoints": [],
                "analysis": {"verdict": "NO_FALL", "state": "NO_PERSON", "reason": "Không phát hiện người hoặc pose để phân tích."}}
    keypoints, confidence, primary_bbox = primary_pose
    if not person_in_configured_zone(camera_id, primary_bbox, image.shape, ai_settings):
        stream = get_live_decision_stream(camera_id, ai_settings)
        stream.reset(time.monotonic())
        ended = datetime.now(timezone.utc)
        elapsed = max((ended - started).total_seconds(), 1e-6)
        camera_health_state[camera_id] = {"seen_at": time.monotonic(), "state": "OUTSIDE_ROI", "fps": round(1 / elapsed, 2), "latency_ms": round(elapsed * 1000, 1)}
        current_status.update({"state": "OUTSIDE_ROI", "confidence": 0.0, "camera_id": camera_id, "fps": round(1 / elapsed, 2), "updated_at": ended.isoformat()})
        return {"state": "OUTSIDE_ROI", "frame_state": "OUTSIDE_ROI", "confidence": 0,
                "keypoints": keypoints.tolist(), "analysis": {"verdict": "NO_FALL", "state": "OUTSIDE_ROI",
                "reason": "Người nằm ngoài vùng phân tích đã cấu hình."}}
    valid_pose, invalid_reason = validate_upper_body_keypoints(keypoints, confidence)
    if valid_pose:
        valid_pose, invalid_reason, _ = validate_person_box_and_hips(
            keypoints, confidence, image.shape, bbox_xyxy=primary_bbox
        )
    if not valid_pose:
        stream = get_live_decision_stream(camera_id, ai_settings)
        state = stream.postprocessor.hold_state()
        model_ready = len(stream.sequence) == stream.sequence.maxlen
        analysis = {"valid_keypoint": False, "state": state, "verdict": "PENDING", "model_ready": model_ready,
                    "lstm_fall_probability": stream.latest_probability,
                    "reason": f"Keypoint frame không hợp lệ: {invalid_reason}. Bỏ qua frame để tránh đưa pose lỗi vào chuỗi."}
        ended = datetime.now(timezone.utc)
        elapsed = max((ended - started).total_seconds(), 1e-6)
        camera_health_state[camera_id] = {"seen_at": time.monotonic(), "state": state, "fps": round(1 / elapsed, 2), "latency_ms": round(elapsed * 1000, 1)}
        current_status.update({"state": state, "confidence": 0.0, "camera_id": camera_id,
                               "fps": 0.0, "updated_at": ended.isoformat()})
        return {"state": state, "frame_state": "INVALID_FRAME", "invalid_reason": invalid_reason,
                "confidence": 0, "keypoints": keypoints.tolist(), "analysis": analysis}
    now_monotonic = time.monotonic()
    stream = get_live_decision_stream(camera_id, ai_settings)
    decision = stream.update(keypoints, confidence, now_monotonic)
    state = decision["state"]
    model_confidence = decision["confidence"]
    event_id = None
    if state == "FALL":
        now = datetime.now(timezone.utc)
        previous = last_fall_alert.get(camera_id)
        if previous is None or (now - previous).total_seconds() >= 30:
            last_fall_alert[camera_id] = now
            saved_event = await save_event(FallEvent(person_id="unknown", camera_id=camera_id, confidence=model_confidence,
                                                      confidence_kind=decision["analysis"]["confidence_kind"],
                                                      message=f"Ph\u00e1t hi\u1ec7n ng\u01b0\u1eddi t\u00e9 ng\u00e3 t\u1ea1i {camera_id}"))
            event_id = saved_event["id"]
            asyncio.create_task(finalize_incident_clip(camera_id, event_id, frame_timestamp))
    ended = datetime.now(timezone.utc)
    elapsed = max((ended - started).total_seconds(), 1e-6)
    camera_health_state[camera_id] = {"seen_at": time.monotonic(), "state": state, "fps": round(1 / elapsed, 2), "latency_ms": round(elapsed * 1000, 1)}
    current_status.update({"state": state, "confidence": model_confidence, "fps": round(1 / elapsed, 2),
                           "camera_id": camera_id, "updated_at": ended.isoformat()})
    return {"state": state, "confidence": model_confidence, "keypoints": keypoints.tolist(),
            "selected_bbox": list(primary_bbox), "skeleton": SKELETON, "event_id": event_id,
            "analysis": decision["analysis"]}


@app.post("/api/analyze-video")
async def analyze_video(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    get_session_user(authorization)
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
    result_name = f"{uuid.uuid4().hex}.webm"
    result_path = ANALYSIS_DIR / result_name
    writer = cv2.VideoWriter(str(result_path), cv2.VideoWriter_fourcc(*"VP80"), fps, (width, height))
    if not writer.isOpened():
        cap.release()
        Path(video_file).unlink(missing_ok=True)
        raise HTTPException(500, "Unable to create annotated video")
    predictions = []
    ai_settings = read_app_settings().get("ai", {})
    stream = FallDecisionStream(ai_settings)
    frame_index = 0
    pose_frame_count = 0
    bending_frame_count = 0
    lying_frame_count = 0
    verifying_frame_count = 0
    last_state, last_confidence = "NORMAL", 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            primary_pose = infer_primary_pose(frame, "uploaded_video", ai_settings)
            if primary_pose is not None:
                keypoints, confidence, primary_bbox = primary_pose
                if not person_in_configured_zone("uploaded_video", primary_bbox, frame.shape, ai_settings):
                    stream.reset(frame_index / fps)
                    last_state = "OUTSIDE_ROI"
                    predictions.append({"frame": frame_index, "time": round(frame_index / fps, 2),
                                        "state": last_state, "confidence": 0.0,
                                        "analysis": {"valid_keypoint": False, "verdict": "PENDING", "state": last_state,
                                                     "reason": "Người nằm ngoài vùng phân tích đã cấu hình."}})
                    writer.write(frame)
                    frame_index += 1
                    continue
                valid_pose, invalid_reason = validate_upper_body_keypoints(keypoints, confidence)
                if valid_pose:
                    valid_pose, invalid_reason, _ = validate_person_box_and_hips(
                        keypoints, confidence, frame.shape, bbox_xyxy=primary_bbox
                    )
                if not valid_pose:
                    last_state = stream.postprocessor.hold_state()
                    predictions.append({"frame": frame_index, "time": round(frame_index / fps, 2),
                                        "state": "INVALID_FRAME", "display_state": last_state,
                                        "reason": invalid_reason, "confidence": 0.0,
                                        "analysis": {"valid_keypoint": False, "verdict": "PENDING", "state": last_state,
                                                     "model_ready": len(stream.sequence) == stream.sequence.maxlen,
                                                     "reason": f"Keypoint frame không hợp lệ: {invalid_reason}."}})
                    writer.write(frame)
                    frame_index += 1
                    continue
                pose_frame_count += 1
                timestamp_s = frame_index / fps
                decision = stream.update(keypoints, confidence, timestamp_s)
                last_state = decision["state"]
                last_confidence = decision["confidence"]
                predictions.append({"frame": frame_index, "time": round(frame_index / fps, 2),
                                    "state": last_state, "confidence": last_confidence,
                                    "analysis": decision["analysis"]})
                if last_state == "BENDING":
                    bending_frame_count += 1
                elif last_state == "LYING":
                    lying_frame_count += 1
                elif last_state == "VERIFYING_FALL":
                    verifying_frame_count += 1
                draw_keypoints(frame, keypoints, last_state == "FALL")
            else:
                stream.reset(frame_index / fps)
                last_state = "NO_PERSON"
                predictions.append({"frame": frame_index, "time": round(frame_index / fps, 2),
                                    "state": last_state, "confidence": 0.0,
                                    "analysis": {"valid_keypoint": False, "verdict": "PENDING", "state": last_state,
                                                 "reason": "Không có người/pose hợp lệ trong frame này."}})
            if last_state == "FALL":
                cv2.rectangle(frame, (0, 0), (width, 46), (30, 30, 210), -1)
                cv2.putText(frame, "FALL DETECTED", (14, 32),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
            writer.write(frame)
            frame_index += 1
    finally:
        cap.release()
        writer.release()
        Path(video_file).unlink(missing_ok=True)
    falls, run = [], []
    for prediction in predictions:
        if prediction["state"] == "FALL":
            run.append(prediction)
        else:
            if run:
                falls.extend(run)
            run = []
    if run:
        falls.extend(run)
    best = falls[0] if falls else max(predictions, key=lambda item: item["confidence"], default={"confidence": 0.0, "time": None})
    first_fall_analysis = falls[0].get("analysis", {}) if falls else {}
    frame_analyses = [item["analysis"] for item in predictions if isinstance(item.get("analysis"), dict)]
    model_probabilities = [float(item["lstm_fall_probability"]) for item in frame_analyses
                           if item.get("lstm_fall_probability") is not None]
    last_valid_analysis = next((item for item in reversed(frame_analyses) if item.get("valid_keypoint")), {})
    final_verdict, final_reason = summarize_clip(predictions)
    analysis_summary = {
        "ablation_first_detection_s": summarize_variants(predictions),
        "first_detection_source": first_fall_analysis.get("decision_source"),
        "decision_policy": "temporal_floor_fsm_v3",
        "max_floor_duration_s": max((item.get("floor_duration_s", 0.0) for item in frame_analyses), default=0.0),
        "persistent_floor_posture": any(item.get("fall_phase") == "ON_FLOOR" for item in frame_analyses),
        "decision_source": first_fall_analysis.get("decision_source") if falls else last_valid_analysis.get("decision_source"),
        "keypoint_frames": pose_frame_count,
        "lstm_max_keypoint_frames": max((item.get("keypoint_frames", 0) for item in frame_analyses), default=0),
        "model_ready": bool(model_probabilities),
        "model_ready_frames": sum(bool(item.get("model_ready")) for item in frame_analyses),
        "model_max_fall_probability": max(model_probabilities, default=None),
        "model_supports_fall": any(bool(item.get("lstm_supports_fall")) for item in frame_analyses),
        "rapid_descent_seen": any(bool(item.get("rapid_descent")) for item in frame_analyses),
        "rapid_tilt_seen": any(bool(item.get("rapid_tilt")) for item in frame_analyses),
        "geometry_confirmed": any(item.get("geometry_state") == "FALL" for item in frame_analyses),
        "horizontal_motion_seen": any(bool(item.get("horizontal_motion")) for item in frame_analyses),
        "horizontal_frames": sum(bool(item.get("horizontal_pose")) for item in frame_analyses),
        "max_horizontal_duration_s": max((float(item.get("horizontal_duration_s") or 0) for item in frame_analyses), default=0.0),
        "required_horizontal_duration_s": round(detection_profile(ai_settings)[0], 2),
        "verdict": final_verdict,
        "reason": final_reason,
    }
    video_event_id = None
    if falls:
        video_event = await save_event(FallEvent(person_id="unknown", camera_id="uploaded_video",
                                     confidence=float(best["confidence"]),
                                     confidence_kind=best.get("analysis", {}).get("confidence_kind"),
                                     message="Ph\u00e1t hi\u1ec7n ng\u01b0\u1eddi t\u00e9 ng\u00e3 trong video t\u1ea3i l\u00ean"))
        video_event_id = video_event["id"]
    timeline = predictions[::max(1, len(predictions)//100)]
    return {"result": final_verdict,
            "event_id": video_event_id,
            "postprocess_result": final_verdict,
            "confidence": best["confidence"],
            "confidence_kind": best.get("analysis", {}).get("confidence_kind") if falls else None,
            "analysis_summary": analysis_summary,
            "detections": len(falls), "first_detection_time": falls[0]["time"] if falls else None,
            "duration": round(frame_count / fps, 2) if fps else 0,
            "pose_frames": pose_frame_count,
            "bending_frames": bending_frame_count,
            "annotated_video_url": f"/analysis-results/{result_name}", "timeline": timeline}


def read_events() -> list[dict]:
    if not EVENTS_FILE.exists():
        return []
    return json.loads(EVENTS_FILE.read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    gpu_memory_percent = None
    if torch.cuda.is_available():
        try:
            free, total = torch.cuda.mem_get_info()
            gpu_memory_percent = round((total - free) / total * 100, 1) if total else 0.0
        except Exception:
            pass
    return {"status": "ok", "service": "fall-detection-backend", "detector": current_status,
            "runtime": {"device": str(device), "cuda_available": torch.cuda.is_available(),
                        "logical_cpu_count": os.cpu_count(), "cpu_load_percent": cpu_load_percent(),
                        "gpu_memory_percent": gpu_memory_percent}}


@app.get("/api/status")
def detector_status(authorization: str | None = Header(default=None)) -> dict:
    get_session_user(authorization)
    updated = current_status.get("updated_at")
    if updated:
        try:
            if (datetime.now(timezone.utc) - datetime.fromisoformat(updated)).total_seconds() > 5:
                current_status.update({"state": "OFFLINE", "confidence": 0.0, "fps": 0.0})
        except ValueError:
            pass
    return current_status


@app.post("/api/status")
def update_detector_status(status: DetectorStatus, authorization: str | None = Header(default=None)) -> dict:
    require_admin_user(authorization)
    from datetime import datetime, timezone, timedelta
    current_status.update(status.model_dump())
    current_status["updated_at"] = datetime.now(timezone.utc).isoformat()
    return current_status


@app.get("/api/events")
def list_events(authorization: str | None = Header(default=None)) -> list[dict]:
    get_session_user(authorization)
    return [public_event(event) for event in read_events()[::-1]]

def public_event(event: dict) -> dict:
    result = {key: value for key, value in event.items() if key not in {"clip_file", "snapshot_file"}}
    result["has_clip"] = bool(event.get("clip_file"))
    result["has_snapshot"] = bool(event.get("snapshot_file"))
    return result

@app.get("/api/events/{event_id}/clip")
def get_incident_clip(event_id: int, authorization: str | None = Header(default=None)):
    get_session_user(authorization)
    event = next((item for item in read_events() if item.get("id") == event_id), None)
    filename = Path(event.get("clip_file", "")).name if event else ""
    path = INCIDENT_MEDIA_DIR / filename
    if not filename or not path.is_file(): raise HTTPException(404, "Video sự cố chưa sẵn sàng.")
    return FileResponse(path, media_type="video/webm", filename=f"fallguard-event-{event_id}.webm",
                        headers={"Cache-Control": "private, no-store"})

@app.get("/api/events/{event_id}/snapshot")
def get_incident_snapshot(event_id: int, authorization: str | None = Header(default=None)):
    get_session_user(authorization)
    event = next((item for item in read_events() if item.get("id") == event_id), None)
    filename = Path(event.get("snapshot_file", "")).name if event else ""
    path = INCIDENT_MEDIA_DIR / filename
    if not filename or not path.is_file(): raise HTTPException(404, "Ảnh sự cố chưa sẵn sàng.")
    return FileResponse(path, media_type="image/jpeg", filename=f"fallguard-event-{event_id}.jpg",
                        headers={"Cache-Control": "private, no-store"})

@app.patch("/api/events/{event_id}")
def update_event(event_id: int, update: EventUpdate,
                 authorization: str | None = Header(default=None)) -> dict:
    user = get_session_user(authorization)
    events = read_events()
    item = next((event for event in events if event.get("id") == event_id), None)
    if item is None:
        raise HTTPException(404, "Không tìm thấy sự cố.")
    item["status"] = update.status
    item["note"] = update.note.strip()
    item["updated_at"] = datetime.now(timezone.utc).isoformat()
    item["updated_by"] = user.get("id")
    EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    record_audit("incident.updated", {"id": event_id, "status": update.status})
    return public_event(item)


@app.post("/api/events/{event_id}/acknowledge")
def acknowledge_event(event_id: int, authorization: str | None = Header(default=None)) -> dict:
    user = get_session_user(authorization)
    events = read_events()
    event = next((item for item in events if item.get("id") == event_id), None)
    if event is None:
        raise HTTPException(404, "Không tìm thấy thông báo.")
    viewers = event.setdefault("acknowledged_by", [])
    if user["id"] not in viewers:
        viewers.append(user["id"])
        EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    return public_event(event)


@app.post("/api/events/acknowledge-all")
def acknowledge_all_events(authorization: str | None = Header(default=None)) -> dict:
    user = get_session_user(authorization)
    events = read_events()
    changed = 0
    for event in events:
        viewers = event.setdefault("acknowledged_by", [])
        if user["id"] not in viewers:
            viewers.append(user["id"])
            changed += 1
    if changed:
        EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "acknowledged": changed}


@app.post("/api/events", status_code=201)
async def create_event(event: FallEvent, authorization: str | None = Header(default=None)) -> dict:
    get_session_user(authorization)
    return await save_event(event)

async def save_event(event: FallEvent) -> dict:
    events = read_events()
    saved = {
        "id": max((int(item.get("id", 0)) for item in events), default=0) + 1,
        **event.model_dump(),
        "source": ("uploaded_video" if event.camera_id == "uploaded_video" else
                   "manual" if event.camera_id == "manual" else "live_camera"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "acknowledged": False,
    }
    events.append(saved)
    EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    send_push({"title": "Cáº£nh bÃ¡o tÃ© ngÃ£", "body": event.message, "confidence": event.confidence})
    await event_sockets.broadcast(saved)
    return saved

async def finalize_incident_clip(camera_id: str, event_id: int, trigger_time: float) -> None:
    try:
        await asyncio.sleep(10)
        frames = [(timestamp, raw) for timestamp, raw in live_frame_buffers.get(camera_id, ())
                  if trigger_time - 10 <= timestamp <= trigger_time + 10]
        if not frames:
            return
        decoded = []
        for timestamp, raw in frames:
            image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            if image is not None: decoded.append((timestamp, image))
        if not decoded:
            return
        decoded.sort(key=lambda item: item[0])
        if decoded[0][0] > trigger_time - 5 or decoded[-1][0] < trigger_time + 8:
            return
        height, width = decoded[0][1].shape[:2]
        clip_name = f"event-{event_id}.webm"
        clip_path = INCIDENT_MEDIA_DIR / clip_name
        output_fps = 5.0
        writer = cv2.VideoWriter(str(clip_path), cv2.VideoWriter_fourcc(*"VP80"), output_fps, (width, height))
        if writer.isOpened():
            clip_start, clip_end = max(trigger_time - 10, decoded[0][0]), min(trigger_time + 10, decoded[-1][0])
            ticks = np.arange(clip_start, clip_end, 1.0 / output_fps)
            for tick in ticks:
                _, image = min(decoded, key=lambda item: abs(item[0] - tick))
                if image.shape[:2] != (height, width): image = cv2.resize(image, (width, height))
                writer.write(image)
        writer.release()
        snapshot_name = f"event-{event_id}.jpg"
        closest = min(decoded, key=lambda item: abs(item[0] - trigger_time))[1]
        snapshot_ok = cv2.imwrite(str(INCIDENT_MEDIA_DIR / snapshot_name), closest)
        events = read_events()
        event = next((item for item in events if item.get("id") == event_id), None)
        if event:
            if clip_path.is_file() and clip_path.stat().st_size > 0: event["clip_file"] = clip_name
            if snapshot_ok: event["snapshot_file"] = snapshot_name
            EVENTS_FILE.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
            await event_sockets.broadcast(public_event(event))
    except Exception as error:
        print(f"Could not finalize incident media for event {event_id}: {error}")


# Serve the responsive web app from the same HTTPS origin as the API. This lets
# Safari use camera access and avoids cross-origin API URLs for the PWA.
app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="web-app")

