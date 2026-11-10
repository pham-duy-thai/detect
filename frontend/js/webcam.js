const webcamStreams = new Map();
const webcamRequests = new Map();
const frameApiBase = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
const keypointSkeleton = [[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];

document.addEventListener("click", async event => {
  const button = event.target.closest(".camera-card [data-toggle]");
  if (!button) return;
  event.stopImmediatePropagation();
  const card = button.closest(".camera-card");
  const id = button.dataset.toggle;
  if (button.dataset.source !== "0") return;
  if (webcamStreams.has(id)) { stopWebcam(id, card); return; }
  if (webcamRequests.has(id)) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Không truy cập được camera. Hãy mở FallGuard bằng Safari/Chrome qua HTTPS hoặc localhost.");
    return;
  }
  const request = new AbortController();
  webcamRequests.set(id, request);
  button.setAttribute("aria-busy", "true");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    if (request.signal.aborted || document.hidden || !card.isConnected) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.className = "webcam-video";
    video.srcObject = stream;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    canvas.className = "keypoint-overlay";
    const context = canvas.getContext("2d");
    const frame = document.createElement("canvas");
    const frameContext = frame.getContext("2d");
    const preview = card.querySelector(".camera-preview");
    preview.querySelector(".webcam-video")?.remove();
    preview.querySelector(".keypoint-overlay")?.remove();
    preview.querySelector(".webcam-state")?.remove();
    preview.prepend(video, canvas);
    const state = document.createElement("span");
    state.className = "webcam-state";
    state.textContent = "Đang kết nối AI…";
    preview.append(state);
    const item = { stream, video, canvas, context, card, request, timer: null, sending: false, lastAlert: 0 };
    webcamStreams.set(id, item);
    button.classList.add("checked");
    button.setAttribute("aria-pressed", "true");
    const activeTrack = stream.getVideoTracks()[0];
    activeTrack?.addEventListener("ended", () => stopWebcam(id, card), { once: true });
    video.addEventListener("error", () => {
      state.textContent = "Không nhận được hình ảnh từ webcam";
      state.className = "webcam-state fall";
    });
    video.addEventListener("loadeddata", () => { state.textContent = "Đang phân tích chuyển động"; }, { once: true });

    const sendFrame = async () => {
      if (item.sending || video.readyState < 2 || !video.videoWidth || !video.videoHeight ||
          document.hidden || webcamStreams.get(id) !== item) return;
      item.sending = true;
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      if (frame.width !== width || frame.height !== height) {
        frame.width = width;
        frame.height = height;
      }
      frameContext.drawImage(video, 0, 0, width, height);
      frame.toBlob(async blob => {
        const uploadRequest = new AbortController();
        const cancelUpload = () => uploadRequest.abort();
        const timeout = setTimeout(cancelUpload, 8000);
        request.signal.addEventListener("abort", cancelUpload, { once: true });
        try {
          if (!blob || request.signal.aborted) return;
          const upload = new FormData();
          upload.append("file", blob, "frame.jpg");
          const response = await fetch(`${frameApiBase}/api/cameras/${encodeURIComponent(id)}/frame`, {
            method: "POST", headers: window.authHeaders?.() || {}, body: upload, signal: uploadRequest.signal
          });
          const result = await response.json();
          if (request.signal.aborted) return;
          if (!response.ok) throw new Error(result.detail || "AI không phản hồi.");
          drawKeypointOverlay(item, result.keypoints || [], result.skeleton || keypointSkeleton,
            result.state === "FALL", frame.width, frame.height, result.selected_bbox);
          const labels = {
            FALL: `⚠ PHÁT HIỆN TÉ NGÃ · ${FallGuardScore.label({...result, confidence_kind: result.analysis?.confidence_kind})}`,
            BENDING: "Đang cúi/nghiêng · chưa xác nhận ngã",
            LYING: "Tư thế nằm/ngang · chưa đủ dấu hiệu xác nhận ngã",
            VERIFYING_FALL: "Đang xác minh chuỗi chuyển động keypoint",
            NO_PERSON: "Không phát hiện người",
            WARMING_UP: "Đang phân tích chuyển động",
            SCHEDULED_OFF: "AI đang tạm dừng theo lịch",
            INVALID_FRAME: "Khung hình chưa đủ dữ liệu · đang bỏ qua",
            OUTSIDE_ROI: "Người đang ngoài vùng phân tích"
          };
          const analysis = result.analysis;
          const baseLabel = analysis?.fall_phase === "ON_FLOOR" && result.frame_state !== "INVALID_FRAME"
            ? "⚠ Vẫn nằm thấp · chưa thấy đứng dậy"
            : labels[result.frame_state] || labels[result.state] || "Đang giám sát an toàn";
          if (analysis && Number.isFinite(analysis.keypoint_frames)) {
            const modelLabel = analysis.model_ready ? `LSTM ${Math.round((analysis.lstm_fall_probability || 0) * 100)}%` : `keypoint ${analysis.keypoint_frames || 0}/40`;
            const geometryLabel = analysis.horizontal_pose ? `ngang ${Number(analysis.horizontal_duration_s || 0).toFixed(1)}s` : "chưa ngang";
            const motionLabel = analysis.rapid_descent ? "rơi nhanh" : analysis.horizontal_motion ? "có cử động" : "chưa thấy cử động/rơi";
            state.textContent = `${baseLabel} · ${modelLabel} · ${geometryLabel} · ${motionLabel}`;
            state.title = analysis.reason || "";
          } else { state.textContent = baseLabel; state.title = analysis?.reason || ""; }
          state.className = `webcam-state ${result.state === "FALL" ? "fall" : ["BENDING", "VERIFYING_FALL", "VERIFYING_MODEL", "UNCERTAIN"].includes(result.state) ? "bending" : result.frame_state === "INVALID_FRAME" ? "invalid" : "safe"}`;
          if (result.state === "FALL" && result.frame_state !== "INVALID_FRAME" && Date.now() - item.lastAlert > 5000) {
            item.lastAlert = Date.now();
            playFallTone();
            showFallAlert(`Phát hiện té ngã qua camera ${id}`, { event_id: result.event_id, camera_id: id, confidence: result.confidence, confidence_kind: result.analysis?.confidence_kind });
          }
        } catch (error) {
          if (request.signal.aborted) return;
          state.textContent = uploadRequest.signal.aborted ? "AI phản hồi chậm · đang thử lại" : error.message || "Mất kết nối AI";
          state.className = "webcam-state fall";
        } finally {
          clearTimeout(timeout);
          request.signal.removeEventListener("abort", cancelUpload);
          item.sending = false;
        }
      }, "image/jpeg", 0.78);
    };
    // A slow request is skipped rather than queued; collect motion more
    // frequently than the previous 700 ms cadence when hardware allows it.
    item.timer = setInterval(sendFrame, 150);
    item.timer.unref?.();
  } catch (error) {
    const cancelled = request.signal.aborted;
    if (webcamStreams.get(id)?.request === request) stopWebcam(id, card);
    else stream?.getTracks().forEach(track => track.stop());
    if (cancelled) return;
    const message = error.name === "NotAllowedError" ? "Bạn chưa cấp quyền camera cho FallGuard." : error.name === "NotFoundError" ? "Không tìm thấy webcam trên thiết bị này." : `Không thể mở webcam: ${error.message}`;
    const state = card?.querySelector(".webcam-state");
    if (state) { state.textContent = message; state.className = "webcam-state fall"; }
    else alert(message);
  } finally {
    if (webcamRequests.get(id) === request) webcamRequests.delete(id);
    button.removeAttribute("aria-busy");
  }
}, true);

function drawKeypointOverlay(item, keypoints, skeleton, fall, sourceWidth, sourceHeight, bbox = null) {
  const { canvas, context } = item;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!keypoints?.length) return;
  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const offsetX = (canvas.width - sourceWidth * scale) / 2;
  const offsetY = (canvas.height - sourceHeight * scale) / 2;
  context.strokeStyle = fall ? "#ff5964" : "#f4c95d";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = 2.5 * ratio;
  if (localStorage.getItem("fallguard_show_boxes") === "true" && bbox?.length === 4) {
    context.strokeStyle = "#50d6a0";
    context.lineWidth = 2 * ratio;
    context.strokeRect(bbox[0] * scale + offsetX, bbox[1] * scale + offsetY,
      (bbox[2] - bbox[0]) * scale, (bbox[3] - bbox[1]) * scale);
    context.strokeStyle = fall ? "#ff5964" : "#f4c95d";
    context.fillStyle = context.strokeStyle;
    context.lineWidth = 2.5 * ratio;
  }
  if (localStorage.getItem("fallguard_show_skeleton") === "false") return;
  for (const [a, b] of skeleton) {
    if (!keypoints[a] || !keypoints[b]) continue;
    context.beginPath();
    context.moveTo(keypoints[a][0] * scale + offsetX, keypoints[a][1] * scale + offsetY);
    context.lineTo(keypoints[b][0] * scale + offsetX, keypoints[b][1] * scale + offsetY);
    context.stroke();
  }
  for (const [x, y] of keypoints) {
    context.beginPath();
    context.arc(x * scale + offsetX, y * scale + offsetY, 3.5 * ratio, 0, Math.PI * 2);
    context.fill();
  }
}

function stopWebcam(id, card) {
  const item = webcamStreams.get(id);
  if (!item) return;
  item.request.abort();
  item.stream.getTracks().forEach(track => track.stop());
  clearInterval(item.timer);
  webcamStreams.delete(id);
  card?.querySelector(".webcam-video")?.remove();
  card?.querySelector(".keypoint-overlay")?.remove();
  card?.querySelector(".webcam-state")?.remove();
  const button = card?.querySelector("[data-toggle]");
  button?.classList.remove("checked");
  button?.setAttribute("aria-pressed", "false");
}

function stopAllWebcams() {
  for (const request of webcamRequests.values()) request.abort();
  for (const [id, item] of webcamStreams) stopWebcam(id, item.card);
}

document.addEventListener("click", event => {
  if (event.target.closest("[data-page]")) stopAllWebcams();
}, true);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopAllWebcams();
});
window.addEventListener("pagehide", stopAllWebcams);

function playFallTone() {
  try {
    if (localStorage.getItem("fallguard_sound_enabled") === "false") return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    const context = new Audio();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.18, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.38);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);
    oscillator.onended = () => context.close();
  } catch { /* Audio can be blocked until the user interacts with the page. */ }
}

function showFallAlert(message, meta = {}) {
  window.showEmergencyDialog?.({ id: meta.event_id, camera_id: meta.camera_id, confidence: meta.confidence || 0, confidence_kind: meta.confidence_kind, message, created_at: new Date().toISOString() });
  document.querySelector(".fall-alert-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "fall-alert-toast";
  toast.setAttribute("role", "alert");
  toast.textContent = `⚠ ${message}`;
  document.body.append(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 7000);
}
