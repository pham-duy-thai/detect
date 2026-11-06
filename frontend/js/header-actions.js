(() => {
  const header = document.querySelector("header");
  if (!header) return;
  const accountButton = header.querySelector(".header-account");
  if (accountButton) {
    accountButton.addEventListener("click", event => {
      event.stopPropagation();
      openMenu(accountButton);
    });
  }
  const bell = header.querySelector(".header-bell");
  if (bell) {
    bell.addEventListener("click", event => {
      event.stopPropagation();
      openNotifications(bell);
    });
    refreshAlertIndicator();
    window.addEventListener("fallguard:alert", () => refreshAlertIndicator());
    window.addEventListener("fallguard:authenticated", () => refreshAlertIndicator());
    window.addEventListener("fallguard:notifications-read", () => setAlertIndicator(false, 0));
  }

  async function refreshAlertIndicator() {
    if (!window.authToken?.()) return;
    try {
      const root = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
      const response = await fetch(`${root}/api/events`, { headers: window.authHeaders?.() || {} });
      if (!response.ok) return;
      const events = (await response.json()).filter(isFallEvent).map(item=>{const timestamp=FallGuardTime.parseTimestamp(item.created_at);return timestamp?{...item,created_at:timestamp.toISOString()}:item;});
      const unread = events.filter(event => !isReadByCurrentUser(event));
      setAlertIndicator(unread.length > 0, unread.length);
    } catch { /* The live notification socket can update the indicator later. */ }
  }

  function setAlertIndicator(active, count = null) {
    const indicator = bell?.querySelector(".notification-indicator");
    const badge = bell?.querySelector(".notification-count");
    if (indicator) indicator.hidden = !active;
    if (badge) { badge.hidden = !active; badge.textContent = count == null ? "!" : count > 99 ? "99+" : String(count); }
    if (bell) bell.setAttribute("aria-label", active ? `Xem ${count ?? "các"} cảnh báo té ngã` : "Chưa có cảnh báo té ngã");
  }

  function closePopups() { document.querySelectorAll(".header-popup").forEach(popup => popup.remove()); }
  function openMenu(anchor) {
    closePopups();
    const popup = document.createElement("div");
    popup.className = "header-popup account-popup";
    const user = window.smartHomeUser?.() || {};
    const userAvatar = user.avatar_url ? `${(window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "")}${user.avatar_url}` : "assets/images/avatar/avatar-1.jpg";
    popup.innerHTML = `<div class="popup-user"><img src="${escapePopupText(userAvatar)}" alt=""><div><b>${escapePopupText(user.name || "Tài khoản")}</b><small>${escapePopupText(user.email || "")}</small></div></div><button data-page="profile">◎ <span>Tài khoản</span></button>${user.role === "admin" || user.email?.toLowerCase() === "admin@gmail.com" ? '<button data-page="account">♙ <span>Quản lý tài khoản</span></button>' : ""}<button data-page="settings">⚙ <span>Cài đặt</span></button><hr><button class="logout-action">↪ <span>Đăng xuất</span></button>`;
    document.body.append(popup);
    position(popup, anchor);
    popup.querySelector(".logout-action").onclick = () => window.logout?.();
  }
  async function openNotifications(anchor) {
    closePopups();
    const popup = document.createElement("div");
    popup.className = "header-popup notification-popup";
    popup.innerHTML = '<div class="popup-title"><b>Thông báo té ngã</b><div class="popup-actions"><a data-page="messages">Xem tất cả</a><button type="button" class="mark-all-read">Đánh dấu đã xem tất cả</button></div></div><div class="popup-loading">Đang tải…</div>';
    document.body.append(popup);
    position(popup, anchor);
    try {
      const response = await fetch((window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "") + "/api/events", { headers: window.authHeaders?.() || {} });
      if (!response.ok) throw new Error("Không thể tải thông báo");
      const events = (await response.json()).filter(isFallEvent).map(item=>{const timestamp=FallGuardTime.parseTimestamp(item.created_at);return timestamp?{...item,created_at:timestamp.toISOString()}:item;});
      const unread = events.filter(event => !isReadByCurrentUser(event));
      const host = popup.querySelector(".popup-loading");
      setAlertIndicator(unread.length > 0, unread.length);
      host.innerHTML = events.slice(0, 5).map(event => `<div class="popup-event ${isReadByCurrentUser(event) ? "is-read" : "is-unread"}"><span>!</span><div><b>${escapePopupText(event.message || "Phát hiện té ngã")}</b><small>${FallGuardTime.formatDateTime(event.created_at)}</small></div><em>${isReadByCurrentUser(event) ? "Đã xem" : "Mới"}</em></div>`).join("") || '<p class="muted popup-empty">Chưa phát hiện té ngã.</p>';
      popup.querySelector(".mark-all-read")?.addEventListener("click", async buttonEvent => {
        const button = buttonEvent.currentTarget;
        button.disabled = true;
        try {
          const result = await fetch(`${(window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "")}/api/events/acknowledge-all`, {
            method: "POST", headers: { "Content-Type": "application/json", ...(window.authHeaders?.() || {}) }
          });
          if (!result.ok) throw new Error("Không thể cập nhật trạng thái thông báo.");
          const acknowledged = await result.json();
          window.dispatchEvent(new CustomEvent("fallguard:notifications-read", { detail: acknowledged }));
          popup.querySelectorAll(".popup-event").forEach(row => {
            row.classList.remove("is-unread"); row.classList.add("is-read");
            const badge = row.querySelector("em"); if (badge) badge.textContent = "Đã xem";
          });
          setAlertIndicator(false, 0);
          button.textContent = "Đã đánh dấu đã xem";
          refreshAlertIndicator();
        } catch (error) {
          button.disabled = false;
          button.title = error.message;
        }
      });
    } catch { popup.querySelector(".popup-loading").textContent = "Không kết nối được backend."; }
  }
  function isFallEvent(event) {
    return event.id != null || /t[eé] ng[aã]|fall/i.test(event.message || "") || event.event_type === "FALL" || event.result === "FALL";
  }
  function isReadByCurrentUser(event) {
    const userId = window.smartHomeUser?.()?.id;
    return event.acknowledged === true || Boolean(userId && event.acknowledged_by?.includes(userId));
  }
  function position(popup, anchor) {
    const rect = anchor.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 12}px`;
    popup.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
  }
  function escapePopupText(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  document.addEventListener("click", event => {
    if (!event.target.closest(".header-popup") && !event.target.closest(".header-bell") && !event.target.closest(".header-account")) closePopups();
  });
})();
