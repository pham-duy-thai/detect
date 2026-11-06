const API_ROOT = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
const API = `${API_ROOT}/api`;
const escapeCameraHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

async function cameraRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...(window.authHeaders?.() || {}), ...(options.headers || {}) }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Backend không phản hồi.");
  }
  return response.json();
}

async function loadCameras() {
  const content = document.querySelector("#content");
  try {
    const [cameras, status, events, cameraHealth] = await Promise.all([
      cameraRequest("/cameras"), cameraRequest("/status"), cameraRequest("/events"), cameraRequest("/cameras/health")
    ]);
    events.forEach(event=>{const timestamp=FallGuardTime.parseTimestamp(event.created_at);if(timestamp)event.created_at=timestamp.toISOString();});
    const healthById = Object.fromEntries(cameraHealth.map(item=>[item.id,item]));
    const currentUser = window.smartHomeUser?.() || {};
    const canManageCameras = currentUser.role === "admin" || currentUser.email?.toLowerCase() === "admin@gmail.com";
    content.innerHTML = `
      <div class="content camera-page">
        <div class="camera-page-heading"><div><p class="eyebrow">FALLGUARD <span>/</span> CAMERA CENTER</p><h1>Camera & phân tích</h1><p class="welcome-copy">${canManageCameras ? "Quản lý thiết bị và luồng nhận diện." : "Xem trực tiếp camera và phân tích video."}</p></div>${canManageCameras ? '<button class="button" id="open-camera-form"><span>＋</span> Thêm camera</button>' : ""}</div>
        <section class="camera-summary">
          <article class="summary-card"><span class="summary-icon">◉</span><div><small>TỔNG CAMERA</small><b>${cameras.length}</b><span class="summary-note">Thiết bị đã khai báo</span></div></article>
          <article class="summary-card"><span class="summary-icon green">✓</span><div><small>ĐANG TRỰC TUYẾN</small><b>${cameraHealth.filter(item=>item.online).length}/${cameras.length}</b><span class="summary-note">Nhận khung hình trong 5 giây</span></div></article>
          <article class="summary-card"><span class="summary-icon ${status.state === "FALL" ? "red" : "blue"}">⌁</span><div><small>TRẠNG THÁI AI</small><b>${escapeCameraHtml(status.state || "OFFLINE")}</b><span class="summary-note">${status.updated_at ? `Cập nhật ${FallGuardTime.formatTime(status.updated_at)}` : "Đang chờ dữ liệu camera"}</span></div></article>
        </section>

        <section class="panel camera-management-panel">
          <div class="section-title"><div><span class="section-kicker">THIẾT BỊ</span><h2>Camera giám sát</h2><p class="muted">Bật công tắc trên thẻ để mở camera được trình duyệt cấp quyền. RTSP đã lưu địa chỉ nhưng chưa có bộ giải mã luồng ở backend.</p></div><span class="live-label"><i></i> REALTIME</span></div>
          <div class="camera-cards">${cameras.map(camera => `
            <article class="camera-card">
              <div class="camera-preview ${camera.enabled ? "configured" : "not-configured"}">
                <div class="scan-line"></div><span class="camera-badge ${healthById[camera.id]?.online ? "on" : ""}"><i></i>${healthById[camera.id]?.online ? `ONLINE · ${Number(healthById[camera.id].fps||0).toFixed(1)} FPS` : camera.enabled ? "OFFLINE" : "ĐANG TẮT"}</span>
                <span class="camera-preview-glyph">◉</span><span class="camera-name">${escapeCameraHtml(camera.name)}</span>
              </div>
                <div class="camera-info"><div class="camera-meta"><b>${escapeCameraHtml(camera.location || "Chưa thiết lập vị trí")}</b><small>${escapeCameraHtml(camera.source || "Webcam")} <span>·</span> ${healthById[camera.id]?.online ? `${Number(healthById[camera.id].latency_ms||0).toFixed(0)} ms · ${Number(healthById[camera.id].fps||0).toFixed(1)} FPS` : camera.enabled ? "Chưa nhận khung hình gần đây" : "Thiết bị đang tắt"}</small></div>${canManageCameras ? `<button class="outline-button" data-edit-camera="${escapeCameraHtml(camera.id)}" type="button">Sửa</button>` : ""}<button class="switch ${camera.enabled ? "checked" : ""}" data-toggle="${escapeCameraHtml(camera.id)}" aria-label="Bật hoặc tắt camera ${escapeCameraHtml(camera.name)}"><span></span></button>${canManageCameras ? `<button class="delete-camera" data-delete="${escapeCameraHtml(camera.id)}" title="Xóa camera" aria-label="Xóa camera">×</button>` : ""}</div>
            </article>`).join("") || `<div class="empty-state"><span>◉</span><b>Chưa có camera nào</b><p>Thêm webcam hoặc nguồn camera để bắt đầu.</p><button class="button" id="open-camera-form">Thêm camera đầu tiên</button></div>`}</div>
        </section>

        <div class="camera-columns">
          <section class="panel video-analysis-panel"><div class="section-title"><div><span class="section-kicker">PHÂN TÍCH BẰNG AI</span><h2>Phân tích video</h2><p class="muted">Video kết quả sẽ được vẽ keypoint và phát hiện các đoạn nghi ngã.</p></div><span class="ai-chip">YOLO POSE <i>+</i> LSTM</span></div>
            <label class="upload-box" for="video-file"><span class="upload-icon">↑</span><b>Chọn video cần phân tích</b><small class="upload-hint">MP4, MOV, AVI hoặc MKV · Tự phân tích sau khi chọn</small></label><input id="video-file" type="file" accept="video/*" hidden>
            <div id="analysis-result" class="analysis-result"><span class="result-placeholder-icon">▧</span><span>Chưa có video được chọn</span></div><button id="analyze" class="button full-button"><span>✦</span> Bắt đầu phân tích</button>
          </section>
          <section class="panel camera-events-panel"><div class="section-title"><div><span class="section-kicker">NHẬT KÝ AN TOÀN</span><h2>Cảnh báo gần đây</h2><p class="muted">Sự kiện mới nhất từ hệ thống.</p></div><a class="text-button" data-page="messages">Xem tất cả <span>→</span></a></div>
            <div class="event-list">${events.slice(0, 5).map(event => `<div class="event"><span class="event-dot danger">!</span><div><b>${escapeCameraHtml(event.message || "Phát hiện hoạt động")}</b><small>${FallGuardTime.formatDateTime(event.created_at)} <span>·</span> ${Math.round((event.confidence || 0) * 100)}% tin cậy</small></div></div>`).join("") || `<div class="empty-events"><span>✓</span><p>Chưa có cảnh báo nào.</p><small>Cảnh báo mới sẽ được lưu tại đây.</small></div>`}</div>
          </section>
        </div>
      </div>`;
    bindCameraActions(cameras);
  } catch (error) {
    content.innerHTML = `<div class="content"><div class="offline-box"><b>Không kết nối được backend</b><p>${escapeCameraHtml(error.message)}</p><p class="muted">Hãy chạy FastAPI tại ${escapeCameraHtml(API_ROOT)}.</p><button class="button" onclick="loadCameras()">Thử kết nối lại</button></div></div>`;
  }
}

function bindCameraActions(cameras) {
  document.querySelector("#open-camera-form")?.addEventListener("click", () => showCameraForm());
  document.querySelectorAll("[data-toggle]").forEach(button => {
    button.addEventListener("click", async () => {
      const camera = cameras.find(item => item.id === button.dataset.toggle);
      if (!camera) return;
      const currentUser = window.smartHomeUser?.() || {};
      if (currentUser.role !== "admin" && currentUser.email?.toLowerCase() !== "admin@gmail.com") return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        await cameraRequest(`/cameras/${encodeURIComponent(camera.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !camera.enabled })
        });
        loadCameras();
      } catch (error) { alert(error.message); }
      finally { button.disabled = false; button.removeAttribute("aria-busy"); }
    });
  });
  document.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Bạn có chắc muốn xóa camera này?")) return;
      try {
        await cameraRequest(`/cameras/${encodeURIComponent(button.dataset.delete)}`, { method: "DELETE" });
        loadCameras();
      } catch (error) { alert(error.message); }
    });
  });
  document.querySelectorAll("[data-edit-camera]").forEach(button => button.addEventListener("click", () => {
    const camera = cameras.find(item => item.id === button.dataset.editCamera);
    if (camera) showCameraEditForm(camera);
  }));
  document.querySelector("#video-file")?.addEventListener("change", event => {
    const hint = document.querySelector(".upload-hint");
    if (hint && event.target.files[0]) hint.textContent = `${event.target.files[0].name} · Đang chuẩn bị phân tích`;
  });
  document.querySelector("#analyze")?.addEventListener("click", analyzeSelectedVideo);
}

function showCameraEditForm(camera) {
  const modal = document.createElement("div");
  modal.className = "app-modal";
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><button class="modal-close" type="button" aria-label="Đóng">×</button><span class="section-kicker">THIẾT LẬP THIẾT BỊ</span><h2>Sửa camera</h2><label>Tên camera<input id="edit-camera-name" maxlength="100" required></label><label>Vị trí lắp đặt<input id="edit-camera-location" maxlength="120"></label><label>Nguồn camera<input id="edit-camera-source" maxlength="500" required></label><small class="muted">Có thể nhập số thiết bị webcam (0), đường dẫn IP hoặc RTSP URL.</small><p class="auth-form-message" id="edit-camera-error"></p><div class="modal-actions"><button class="modal-cancel" type="button">Hủy</button><button class="button" id="edit-camera-save" type="button">Lưu thay đổi</button></div></div>`;
  document.body.append(modal);
  modal.querySelector("#edit-camera-name").value = camera.name || "";
  modal.querySelector("#edit-camera-location").value = camera.location || "";
  modal.querySelector("#edit-camera-source").value = camera.source || "";
  modal.querySelectorAll(".modal-close, .modal-cancel").forEach(button => button.onclick = () => modal.remove());
  modal.addEventListener("click", event => { if (event.target === modal) modal.remove(); });
  modal.querySelector("#edit-camera-save").onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await cameraRequest(`/cameras/${encodeURIComponent(camera.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: modal.querySelector("#edit-camera-name").value.trim(), location: modal.querySelector("#edit-camera-location").value.trim(), source: modal.querySelector("#edit-camera-source").value.trim() }) });
      modal.remove();
      loadCameras();
    } catch (error) { modal.querySelector("#edit-camera-error").textContent = error.message; button.disabled = false; }
  };
}

async function analyzeSelectedVideo() {
  const file = document.querySelector("#video-file")?.files?.[0];
  const output = document.querySelector("#analysis-result");
  const button = document.querySelector("#analyze");
  if (!file) { alert("Vui lòng chọn video cần phân tích."); return; }
  const form = new FormData();
  form.append("file", file);
  button.disabled = true;
  button.innerHTML = '<span class="button-spinner"></span> Đang phân tích video…';
  const hint = document.querySelector(".upload-hint");
  if (hint) hint.textContent = `Đang tải và phân tích ${file.name}…`;
  output.className = "analysis-result loading";
  output.innerHTML = '<span class="button-spinner"></span><span>AI đang nhận diện tư thế và tạo video keypoint. Vui lòng chờ…</span>';
  try {
    const result = await cameraRequest("/analyze-video", { method: "POST", body: form });
    const fell = result.result === "FALL";
    const uncertain = result.result === "UNCERTAIN";
    output.className = `analysis-result ${fell ? "fall" : uncertain ? "uncertain" : "safe"}`;
    const confidence = Number(result.confidence || 0);
    const detectionTime = Number(result.first_detection_time || 0);
    const resultVideoUrl = result.annotated_video_url;
    const poseFrames = Number(result.pose_frames || 0);
    const summary = result.analysis_summary || {};
    const postureMessage = result.postprocess_result === "LYING" ? "Tư thế nằm/ngang · chưa đủ dấu hiệu xác nhận ngã" : result.postprocess_result === "VERIFYING_FALL" ? "Đang đối chiếu các thuật toán" : result.postprocess_result === "BENDING" ? "Đang cúi/nghiêng · chưa xác nhận ngã" : "✓ Chưa phát hiện té ngã";
    const confidenceMessage = !summary.model_ready ? `LSTM chưa đủ 40 khung hình keypoint hợp lệ (hiện có ${poseFrames} khung tổng)` : `Xác suất Fall cao nhất từ LSTM ${((summary.model_max_fall_probability || 0) * 100).toFixed(1)}%`;
    output.innerHTML = `<div class="fall-video-banner ${fell ? "is-fall" : ""}"><b>${fell ? "⚠ Phát hiện té ngã" : postureMessage}</b><span>${fell ? `Phát hiện tại ${detectionTime.toFixed(1)} giây · Độ tin cậy ${(confidence * 100).toFixed(1)}%` : confidenceMessage}</span></div><div class="video-result-caption">${poseFrames > 0 ? `Keypoint đã được vẽ trên ${poseFrames} khung hình` : "Không phát hiện được người hoặc keypoint trong video"}</div>${resultVideoUrl ? `<video class="video-preview" controls autoplay muted playsinline preload="auto" src="${API_ROOT}${encodeURI(resultVideoUrl).replace(/#/g, "%23")}"></video>` : `<div class="video-unavailable">Video kết quả hiện không khả dụng. Bạn vẫn có thể xem kết luận phân tích ở trên.</div>`}`;
    if (fell && !summary.model_ready) output.querySelector(".fall-video-banner span").textContent = `Phát hiện tại ${detectionTime.toFixed(1)} giây · xác nhận từ hình học/chuyển động; LSTM chưa đủ 40 khung hình`;
    const modelCheck = summary.model_ready
      ? `LSTM: ${summary.model_ready_frames || 0} khung có kết quả, xác suất Fall cao nhất ${((summary.model_max_fall_probability || 0) * 100).toFixed(1)}%; ${summary.model_supports_fall ? "ủng hộ Fall" : "chưa đủ bằng chứng Fall"}.`
      : `LSTM: chưa đủ 40 khung hình keypoint hợp lệ (hiện có ${poseFrames}).`;
    const geometryCheck = `Hình học: ${summary.horizontal_frames || 0} khung nằm ngang; ${summary.rapid_descent_seen ? "có" : "chưa có"} cú rơi nhanh; ${summary.horizontal_motion_seen ? "có" : "chưa có"} cử động keypoint; giữ ngang lâu nhất ${(summary.max_horizontal_duration_s || 0).toFixed(1)} / ${(summary.required_horizontal_duration_s || 0).toFixed(1)} giây.`;
    output.insertAdjacentHTML("beforeend", `<details class="analysis-diagnostics"><summary>Phân tích từng thuật toán</summary><ul><li>Keypoint: ${poseFrames} khung hợp lệ.</li><li>${escapeCameraHtml(modelCheck)}</li><li>${escapeCameraHtml(geometryCheck)}</li><li>Kết luận <b>${fell ? "FALL" : "NO_FALL"}</b>: ${escapeCameraHtml(summary.reason || "Không có lý do bổ sung.")}</li></ul></details>`);
    const player = output.querySelector("video");
    output.scrollIntoView({ behavior: "smooth", block: "center" });
    if (fell) {
      playFallTone();
      showFallAlert(`Phát hiện té ngã trong video tại ${Number(result.first_detection_time || 0).toFixed(1)} giây`);
      player?.addEventListener("loadedmetadata", () => {
        player.currentTime = Math.max(0, detectionTime - 1);
        player.play().catch(() => {});
      }, { once: true });
    } else player?.play().catch(() => {});
  } catch (error) {
    output.className = "analysis-result fall";
    output.innerHTML = `<div class="analysis-error"><b>Không thể hoàn tất phân tích</b><span>${escapeCameraHtml(error.message)}</span><button type="button" class="outline-button" id="retry-analysis">Thử lại</button></div>`;
    document.querySelector("#retry-analysis")?.addEventListener("click", analyzeSelectedVideo);
  } finally {
    button.disabled = false;
    button.innerHTML = '<span aria-hidden="true">↻</span> Phân tích video';
    if (hint && file) hint.textContent = `${file.name} · Có thể chọn tệp khác`;
  }
}
