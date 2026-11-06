window.openSettings = () => {
  document.querySelectorAll("[data-page]").forEach(item => item.classList.toggle("active", item.dataset.page === "settings"));
  document.querySelector("#breadcrumb").textContent = "Cài đặt";
  const soundEnabled = localStorage.getItem("fallguard_sound_enabled") !== "false";
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const permissionLabel = permission === "granted" ? "Đã bật" : permission === "denied" ? "Đang bị chặn" : permission === "unsupported" ? "Không được hỗ trợ" : "Chưa cấp quyền";
  document.querySelector("#content").innerHTML = `
    <div class="content settings-page">
      <div class="heading"><div><p class="eyebrow">FALLGUARD <span>/</span> TÙY CHỈNH</p><h1>Cài đặt hệ thống</h1><p class="welcome-copy">Điều chỉnh cách ứng dụng gửi cảnh báo trên thiết bị này.</p></div></div>
      <div class="settings-grid">
        <section class="panel preference-card"><span class="setting-symbol">♧</span><span class="section-kicker">THÔNG BÁO TRÌNH DUYỆT</span><h2>Cảnh báo trên thiết bị</h2><p class="muted">Bật quyền thông báo hệ thống nếu trình duyệt và thiết bị hỗ trợ.</p><div class="preference-status"><span>Quyền trình duyệt</span><b class="${permission === "granted" ? "ok" : permission === "denied" ? "warn" : ""}">${permissionLabel}</b></div><button class="button" id="enable-desktop-notifications">${permission === "granted" ? "Kiểm tra quyền thông báo" : "Bật thông báo trình duyệt"}</button><small class="settings-help">Cảnh báo trong ứng dụng cần trang FallGuard đang mở. Push khi đóng PWA chưa được cấu hình.</small></section>
        <section class="panel preference-card"><span class="setting-symbol sound">♫</span><span class="section-kicker">ÂM THANH CẢNH BÁO</span><h2>Âm báo khi phát hiện ngã</h2><p class="muted">Phát âm thanh ngắn khi AI xác nhận một sự kiện té ngã.</p><label class="preference-toggle" for="sound-enabled"><span><b>Âm thanh cảnh báo</b><small>Áp dụng cho camera trực tiếp và video phân tích.</small></span><input type="checkbox" id="sound-enabled" ${soundEnabled ? "checked" : ""}><i></i></label><small class="settings-help">Trình duyệt có thể cần một thao tác của bạn trước khi phát âm thanh.</small></section>
      </div>
      <section class="panel settings-note"><span class="section-kicker">TRẠNG THÁI ỨNG DỤNG</span><h2>Giữ hệ thống sẵn sàng</h2><p class="muted">Để tiếp tục theo dõi realtime, giữ máy chủ và trang FallGuard mở. Camera sẽ dừng khi ẩn trang hoặc chuyển sang mục khác.</p></section>
    </div>`;
  document.querySelector("#sound-enabled").addEventListener("change", event => {
    localStorage.setItem("fallguard_sound_enabled", event.target.checked ? "true" : "false");
  });
  document.querySelector("#enable-desktop-notifications").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (typeof window.enableFallDesktopNotifications === "function") await window.enableFallDesktopNotifications();
    else if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    window.openSettings();
  });
};
