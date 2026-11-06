document.addEventListener("click", event => {
  if (!event.target.closest("#open-camera-form")) return;
  event.stopImmediatePropagation();
  const modal = document.createElement("div");
  modal.className = "app-modal";
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="camera-modal-title">
      <button class="modal-close" type="button" aria-label="Đóng">×</button>
      <span class="section-kicker">THIẾT LẬP THIẾT BỊ</span>
      <h2 id="camera-modal-title">Thêm camera</h2>
      <p class="muted">Khai báo nguồn hình ảnh để bắt đầu giám sát.</p>
      <label>Tên camera<input id="cm-name" placeholder="Ví dụ: Camera phòng khách" maxlength="80"></label>
      <label>Vị trí<input id="cm-location" placeholder="Ví dụ: Phòng khách"></label>
      <label>Nguồn camera<input id="cm-source" value="0" placeholder="0 hoặc địa chỉ camera"></label>
      <div class="modal-actions"><button class="modal-cancel" type="button">Hủy</button><button class="button" id="cm-save" type="button">Thêm camera</button></div>
    </div>`;
  document.body.append(modal);
  modal.querySelector("#cm-name").focus();
  modal.querySelectorAll(".modal-close, .modal-cancel").forEach(button => button.onclick = () => modal.remove());
  modal.addEventListener("click", click => { if (click.target === modal) modal.remove(); });
  modal.querySelector("#cm-save").onclick = async () => {
    const name = modal.querySelector("#cm-name").value.trim();
    const place = modal.querySelector("#cm-location").value.trim() || "Chưa thiết lập";
    const source = modal.querySelector("#cm-source").value.trim() || "0";
    if (!name) { modal.querySelector("#cm-name").focus(); return; }
    const button = modal.querySelector("#cm-save");
    button.disabled = true;
    button.textContent = "Đang lưu…";
    try {
      const base = (window.FALLGUARD_API_BASE || (window.location.protocol === "https:" ? window.location.origin : `${window.location.protocol}//${window.location.hostname}:8000`)).replace(/\/$/, "");
      const response = await fetch(`${base}/api/cameras`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(window.authHeaders?.() || {}) },
        body: JSON.stringify({ name, location: place, source, enabled: true })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || "Không thể thêm camera.");
      }
      modal.remove();
      if (typeof loadCameras === "function") loadCameras();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Thêm camera";
      alert(error.message);
    }
  };
}, true);
