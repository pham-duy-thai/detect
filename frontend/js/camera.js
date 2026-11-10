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
          <div class="section-title"><div><span class="section-kicker">THIẾT BỊ</span><h2>Camera giám sát</h2><p class="muted">Chỉ webcam của thiết bị đang mở trang có thể truyền hình ảnh để phân tích. Nguồn IP/RTSP cũ được giữ trong cấu hình nhưng chưa hoạt động.</p></div><span class="live-label"><i></i> REALTIME</span></div>
          <div class="camera-cards">${cameras.map(camera => `
            <article class="camera-card">
              <div class="camera-preview ${camera.enabled ? "configured" : "not-configured"}">
                <div class="scan-line"></div><span class="camera-badge ${healthById[camera.id]?.online ? "on" : ""}"><i></i>${camera.source !== "0" ? "CHƯA HỖ TRỢ" : healthById[camera.id]?.online ? `ONLINE · ${Number(healthById[camera.id].fps||0).toFixed(1)} FPS` : camera.enabled ? "OFFLINE" : "ĐANG TẮT"}</span>
                <span class="camera-preview-glyph">◉</span><span class="camera-name">${escapeCameraHtml(camera.name)}</span>
              </div>
                <div class="camera-info"><div class="camera-meta"><b>${escapeCameraHtml(camera.location || "Chưa thiết lập vị trí")}</b><small>${camera.source === "0" ? "Webcam trình duyệt" : "IP/RTSP chưa hỗ trợ"} <span>·</span> ${healthById[camera.id]?.online ? `${Number(healthById[camera.id].latency_ms||0).toFixed(0)} ms · ${Number(healthById[camera.id].fps||0).toFixed(1)} FPS` : camera.enabled ? "Chưa nhận khung hình gần đây" : "Thiết bị đang tắt"}</small></div>${canManageCameras ? `<button class="outline-button" data-edit-camera="${escapeCameraHtml(camera.id)}" type="button">Sửa</button>` : ""}<button class="switch ${camera.enabled ? "checked" : ""}" data-toggle="${escapeCameraHtml(camera.id)}" data-source="${escapeCameraHtml(camera.source)}" aria-label="Bật hoặc tắt camera ${escapeCameraHtml(camera.name)}" ${camera.source === "0" ? "" : "disabled title=\"Nguồn IP/RTSP chưa được hỗ trợ\""}><span></span></button>${canManageCameras ? `<button class="delete-camera" data-delete="${escapeCameraHtml(camera.id)}" title="Xóa camera" aria-label="Xóa camera">×</button>` : ""}</div>
            </article>`).join("") || `<div class="empty-state"><span>◉</span><b>Chưa có camera nào</b><p>Thêm webcam để bắt đầu.</p><button class="button" id="open-camera-form">Thêm camera đầu tiên</button></div>`}</div>
        </section>

        <div class="camera-columns">
          <section class="panel video-analysis-panel"><div class="section-title"><div><span class="section-kicker">PHÂN TÍCH BẰNG AI</span><h2>Phân tích video</h2><p class="muted">Video kết quả sẽ được vẽ keypoint và phát hiện các đoạn nghi ngã.</p></div><span class="ai-chip">YOLO POSE <i>+</i> LSTM</span></div>
            <label class="upload-box" for="video-file"><span class="upload-icon">↑</span><b>Chọn video cần phân tích</b><small class="upload-hint">MP4, MOV, AVI hoặc MKV · Tự phân tích sau khi chọn</small></label><input id="video-file" type="file" accept="video/*" hidden>
            <div id="analysis-result" class="analysis-result"><span class="result-placeholder-icon">▧</span><span>Chưa có video được chọn</span></div><button id="analyze" class="button full-button"><span>✦</span> Bắt đầu phân tích</button>
          </section>
          <section class="panel camera-events-panel"><div class="section-title"><div><span class="section-kicker">NHẬT KÝ AN TOÀN</span><h2>Cảnh báo gần đây</h2><p class="muted">Sự kiện mới nhất từ hệ thống.</p></div><a class="text-button" data-page="messages">Xem tất cả <span>→</span></a></div>
            <div class="event-list">${events.slice(0, 5).map(event => `<div class="event"><span class="event-dot danger">!</span><div><b>${escapeCameraHtml(event.message || "Phát hiện hoạt động")}</b><small>${FallGuardTime.formatDateTime(event.created_at)} <span>·</span> ${FallGuardScore.label(event)}</small></div></div>`).join("") || `<div class="empty-events"><span>✓</span><p>Chưa có cảnh báo nào.</p><small>Cảnh báo mới sẽ được lưu tại đây.</small></div>`}</div>
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
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><button class="modal-close" type="button" aria-label="Đóng">×</button><span class="section-kicker">THIẾT LẬP THIẾT BỊ</span><h2>Sửa camera</h2><label>Tên camera<input id="edit-camera-name" maxlength="100" required></label><label>Vị trí lắp đặt<input id="edit-camera-location" maxlength="120"></label><label>Nguồn camera<input id="edit-camera-source" maxlength="500" required></label><small class="muted">Hiện chỉ giá trị 0 (webcam trình duyệt) hoạt động. Đổi nguồn IP/RTSP cũ thành 0 để dùng webcam.</small><p class="auth-form-message" id="edit-camera-error"></p><div class="modal-actions"><button class="modal-cancel" type="button">Hủy</button><button class="button" id="edit-camera-save" type="button">Lưu thay đổi</button></div></div>`;
  document.body.append(modal);
  modal.querySelector("#edit-camera-name").value = camera.name || "";
  modal.querySelector("#edit-camera-location").value = camera.location || "";
  modal.querySelector("#edit-camera-source").value = camera.source || "";
  modal.querySelectorAll(".modal-close, .modal-cancel").forEach(button => button.onclick = () => modal.remove());
  modal.addEventListener("click", event => { if (event.target === modal) modal.remove(); });
  modal.querySelector("#edit-camera-save").onclick = async event => {
    const button = event.currentTarget;
    if (modal.querySelector("#edit-camera-source").value.trim() !== "0") {
      modal.querySelector("#edit-camera-error").textContent = "Nguồn IP/RTSP chưa hoạt động. Nhập 0 để dùng webcam trình duyệt.";
      return;
    }
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
    output.className = `analysis-result ${fell ? "fall" : "safe"}`;
    const detectionTime = Number(result.first_detection_time || 0);
    const resultVideoUrl = result.annotated_video_url;
    const poseFrames = Number(result.pose_frames || 0);
    const summary = result.analysis_summary || {};
    const modelFrames = Number(summary.lstm_max_keypoint_frames ?? poseFrames);
    const sourceLabels = {
      lstm: "LSTM đủ 40 khung",
      lstm_geometry: "LSTM và hình học",
      geometry_fallback: "Suy luận chuyển động keypoint",
      bend_verifying: "Đang theo dõi chân trụ",
      bend_stable: "Cúi người, chân vẫn đứng trụ",
      bend_recovered: "Đã đứng thẳng lại",
      bend_support_lost: "Mất trụ sau khi cúi",
      floor_verifying: "Đang xác minh vị trí đầu và hông",
      floor_fall: "Hạ nhanh và nằm gần sàn",
      floor_lstm: "LSTM nhất quán, có dấu hiệu ngã gần sàn",
      floor_agreement: "LSTM và hình học cùng ủng hộ",
      floor_trajectory: "Xác minh bằng quỹ đạo đầu và hông",
      floor_compact: "Ngã khi thân còn gập",
      lying_without_drop: "Đang nằm, chưa ghi nhận cú rơi",
      lying_drop_verifying: "Đang xác minh cú rơi từ tư thế nằm",
      lying_drop: "Rơi xuống thấp từ tư thế nằm",
    };
    const sourceLabel = sourceLabels[summary.decision_source] || "Đánh giá chuỗi chuyển động";
    const postureMessage = "✓ Không có dấu hiệu ngã";
    const confidenceMessage = !summary.model_ready ? `LSTM ${modelFrames}/40 khung · đã sử dụng hình học để suy luận` : `Điểm Fall cao nhất từ LSTM ${((summary.model_max_fall_probability || 0) * 100).toFixed(1)}%`;
    output.innerHTML = `<div class="fall-video-banner ${fell ? "is-fall" : ""}"><b>${fell ? "⚠ Phát hiện té ngã" : postureMessage}</b><span>${fell ? `Phát hiện tại ${detectionTime.toFixed(1)} giây · ${FallGuardScore.label(result)}` : confidenceMessage}</span></div><div class="video-result-caption">${poseFrames > 0 ? `Keypoint đã được vẽ trên ${poseFrames} khung hình` : "Không phát hiện được người hoặc keypoint trong video"}</div>${resultVideoUrl ? `<video class="video-preview" controls autoplay muted playsinline preload="auto" src="${API_ROOT}${encodeURI(resultVideoUrl).replace(/#/g, "%23")}"></video>` : `<div class="video-unavailable">Video kết quả hiện không khả dụng. Bạn vẫn có thể xem kết luận phân tích ở trên.</div>`}`;
    if (fell) output.querySelector(".fall-video-banner span").textContent = `Phát hiện tại ${detectionTime.toFixed(1)} giây · ${sourceLabel} · ${FallGuardScore.label(result)}`;
    const modelCheck = summary.model_ready
      ? `LSTM: ${summary.model_ready_frames || 0} khung có kết quả, điểm Fall cao nhất ${((summary.model_max_fall_probability || 0) * 100).toFixed(1)}%; ${summary.model_supports_fall ? "ủng hộ Fall" : "chưa đủ bằng chứng Fall"}.`
      : `LSTM: ${modelFrames}/40 khung đủ điểm đặc trưng; chuyển sang hình học để suy luận.`;
    const geometryCheck = `Hình học: ${summary.horizontal_frames || 0} khung ngang; ${summary.rapid_descent_seen ? "có" : "chưa có"} hạ nhanh; ${summary.rapid_tilt_seen ? "có" : "chưa có"} xoay thân nhanh; giữ ngang ${(summary.max_horizontal_duration_s || 0).toFixed(2)} / ${(summary.required_horizontal_duration_s || 0).toFixed(2)} giây. ${summary.geometry_confirmed ? "Đã xác nhận chuỗi chuyển động ngã." : "Chưa đủ chuỗi chuyển động để xác nhận ngã."}`;
    output.insertAdjacentHTML("beforeend", `<details class="analysis-diagnostics"><summary>Phân tích từng thuật toán</summary><ul><li>Keypoint: ${poseFrames} khung hợp lệ để phân tích tư thế.</li><li>${escapeCameraHtml(modelCheck)}</li><li>${escapeCameraHtml(geometryCheck)}</li><li>Nhánh quyết định: ${escapeCameraHtml(sourceLabel)}.</li><li>Kết luận <b>${fell ? "NGÃ" : "KHÔNG NGÃ"}</b>: ${escapeCameraHtml(result.result === "UNCERTAIN" ? "Video đã kết thúc mà chưa xác nhận cú ngã." : summary.reason || "Không có lý do bổ sung.")}</li></ul></details>`);
    const player = output.querySelector("video");
    if (summary.persistent_floor_posture) {
      const item = document.createElement("li");
      item.textContent = `Tư thế gần sàn duy trì ${Number(summary.max_floor_duration_s).toFixed(1)} giây.`;
      output.querySelector(".analysis-diagnostics ul").append(item);
    }
    output.scrollIntoView({ behavior: "smooth", block: "center" });
    if (fell) {
      playFallTone();
      showFallAlert(`Phát hiện té ngã trong video tại ${Number(result.first_detection_time || 0).toFixed(1)} giây`, { event_id: result.event_id, camera_id: "uploaded_video", confidence: result.confidence, confidence_kind: result.confidence_kind });
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
