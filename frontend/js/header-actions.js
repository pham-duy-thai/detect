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
    window.addEventListener("fallguard:notifications-read", refreshAlertIndicator);
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

  function closePopups() {
    document.querySelectorAll(".header-popup").forEach(popup => popup.remove());
    bell?.setAttribute("aria-expanded", "false");
  }
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
    return window.FallGuardNotificationPopup.open(anchor);
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
