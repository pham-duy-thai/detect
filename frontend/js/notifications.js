(() => {
  const API_ROOT = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
  const API = `${API_ROOT}/api`;
  let socket;
  const eventPageSize = 8;
  let historyEvents = [];

  async function enableDesktopNotifications() {
    if (!("Notification" in window)) {
      alert("Trình duyệt này không hỗ trợ thông báo hệ thống. Cảnh báo vẫn hiện trong FallGuard khi trang đang mở.");
      return false;
    }
    if (Notification.permission === "default") {
      try { await Notification.requestPermission(); }
      catch { alert("Không thể yêu cầu quyền thông báo trên trình duyệt này."); return false; }
    }
    if (Notification.permission !== "granted") {
      alert("Thông báo đang bị chặn. Hãy bật quyền Notifications cho FallGuard trong cài đặt trình duyệt, rồi thử lại.");
      return false;
    }
    return true;
  }

  function systemNotice(event) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    let notice;
    try {
      notice = new Notification("Cảnh báo té ngã - FallGuard", {
        body: `${event.message || "Phát hiện người té ngã"} · Độ tin cậy ${((event.confidence || 0) * 100).toFixed(1)}%`,
        tag: `fall-${event.id || `${event.camera_id || "camera"}-${Date.now()}`}`,
        requireInteraction: true,
      });
    } catch { return; }
    notice.onclick = () => {
      window.focus();
      notice.close();
    };
  }

  function isAcknowledged(event) {
    const userId = window.smartHomeUser?.()?.id;
    return event.acknowledged === true || Boolean(userId && event.acknowledged_by?.includes(userId));
  }

  async function acknowledgeAll() {
    const response = await fetch(`${API}/events/acknowledge-all`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(window.authHeaders?.() || {}) }
    });
    if (!response.ok) throw new Error("Không thể cập nhật trạng thái thông báo.");
    historyEvents = historyEvents.map(event => ({ ...event, acknowledged: true }));
    window.dispatchEvent(new CustomEvent("fallguard:notifications-read"));
    return response.json();
  }

  function toast(event) {
    window.dispatchEvent(new CustomEvent("fallguard:alert", { detail: event }));
    const node = document.createElement("div");
    node.className = "event-toast";
    const title = document.createElement("b");
    title.textContent = "⚠ Cảnh báo té ngã";
    const message = document.createElement("span");
    message.textContent = event.message || "Phát hiện người té ngã";
    const confidence = document.createElement("small");
    confidence.textContent = `Độ tin cậy ${((event.confidence || 0) * 100).toFixed(1)}%`;
    node.append(title, message, confidence);
    document.body.appendChild(node);
    setTimeout(() => node.classList.add("show"), 20);
    setTimeout(() => {
      node.classList.remove("show");
      setTimeout(() => node.remove(), 300);
    }, 7000);
    systemNotice(event);
  }

  async function showEvents() {
    const container = document.querySelector("#content");
    try {
      const response = await fetch(`${API}/events`, { headers: window.authHeaders?.() || {} });
      if (!response.ok) throw new Error("Không tải được thông báo");
      historyEvents = (await response.json()).filter(isFallEvent).map(item=>{const timestamp=FallGuardTime.parseTimestamp(item.created_at);return timestamp?{...item,created_at:timestamp.toISOString()}:item;});
      renderHistoryPage(1);
    } catch {
      container.innerHTML = '<div class="content"><div class="offline-box">Không tải được thông báo. Hãy kiểm tra backend.</div></div>';
    }
  }

  function renderHistoryPage(page) {
    const container = document.querySelector("#content");
    if (!container) return;
    const pageCount = Math.max(1, Math.ceil(historyEvents.length / eventPageSize));
    const currentPage = Math.min(Math.max(1, page), pageCount);
    const start = (currentPage - 1) * eventPageSize;
    const visibleEvents = historyEvents.slice(start, start + eventPageSize);
    const pagination = pageCount > 1 ? `<nav class="events-pagination" aria-label="Phân trang lịch sử cảnh báo"><span class="events-pagination-label">${start + 1}–${Math.min(start + eventPageSize, historyEvents.length)} / ${historyEvents.length} cảnh báo</span><div class="events-pagination-actions"><button type="button" data-events-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>← Trước</button><span class="page-current" aria-current="page">${currentPage}</span><button type="button" data-events-page="${currentPage + 1}" ${currentPage === pageCount ? "disabled" : ""}>Tiếp →</button></div></nav>` : "";
    const unreadCount = historyEvents.filter(event => !isAcknowledged(event)).length;
    container.innerHTML = `<div class="content feature-page"><div class="heading"><div><p class="eyebrow">FALLGUARD / TRUNG TÂM CẢNH BÁO</p><h1>Thông báo</h1><p class="welcome-copy">Theo dõi lịch sử phát hiện té ngã từ camera và video.</p></div><div class="incident-heading-actions"><span class="unread-summary">${unreadCount ? `${unreadCount} chưa đọc` : "Đã đọc tất cả"}</span><button class="outline-button" id="mark-all-events-read" ${unreadCount ? "" : "disabled"}>Đọc tất cả</button><button class="outline-button" id="refresh-events">↻ Làm mới</button></div></div><section class="panel"><div class="section-title"><div><h2>Lịch sử cảnh báo</h2><p class="muted">${historyEvents.length} sự kiện được ghi nhận</p></div></div><div class="event-list">${visibleEvents.length ? visibleEvents.map(eventRow).join("") : '<div class="empty-events"><span>✓</span><p>Chưa có cảnh báo té ngã.</p><small>Sự kiện mới sẽ được lưu tự động.</small></div>'}</div>${pagination}</section></div>`;
    container.querySelector("#refresh-events")?.addEventListener("click", showEvents);
    container.querySelector("#mark-all-events-read")?.addEventListener("click", async buttonEvent => {
      const button = buttonEvent.currentTarget;
      button.disabled = true;
      try { await acknowledgeAll(); renderHistoryPage(currentPage); }
      catch (error) { button.disabled = false; button.title = error.message; }
    });
    container.querySelectorAll("[data-events-page]").forEach(button => button.addEventListener("click", () => renderHistoryPage(Number(button.dataset.eventsPage))));
  }

  function eventRow(event) {
    const message = String(event.message || "Phát hiện người té ngã").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    return `<div class="event ${isAcknowledged(event) ? "is-read" : "is-unread"}"><span class="event-dot danger">!</span><div><b>${message}</b><small>${FallGuardTime.formatDateTime(event.created_at)} · Camera ${event.camera_id} · Độ tin cậy ${((event.confidence || 0) * 100).toFixed(1)}%</small></div><em class="read-status">${isAcknowledged(event) ? "Đã đọc" : "Chưa đọc"}</em></div>`;
  }

  function isFallEvent(event) {
    return event.id != null || /t[eé] ng[aã]|fall/i.test(event.message || "") || event.event_type === "FALL" || event.result === "FALL";
  }

  // Permission prompts must follow a user action; requesting on page load is
  // ignored or blocked by current browsers.
  document.addEventListener("click", event => {
    if (event.target.closest(".camera-card [data-toggle], #analyze")) {
      enableDesktopNotifications();
    }
    if (event.target.closest('[data-page="messages"]')) setTimeout(() => window.showIncidents?.(), 0);
  });

  window.addEventListener("fallguard:notifications-read", () => {
    historyEvents = historyEvents.map(event => ({ ...event, acknowledged: true }));
  });

  function connect() {
    const socketHost = location.protocol === "https:" ? location.host : `${location.hostname}:8000`;
    socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${socketHost}/ws/events?token=${encodeURIComponent(window.authToken?.() || "")}`);
    socket.onmessage = event => {
      try {
        const item = JSON.parse(event.data);
        if (item.event_type === "heartbeat" || item.type === "heartbeat" || item.state === "HEARTBEAT") return;
        if (!isFallEvent(item)) return;
        toast(item);
        window.showEmergencyDialog?.(item);
        if (document.querySelector('[data-page="messages"].active')) window.showIncidents?.();
      } catch (error) {
        console.error("Invalid event notification", error);
      }
    };
    socket.onclose = () => setTimeout(connect, 3000);
    socket.onerror = () => socket.close();
  }

  window.enableFallDesktopNotifications = enableDesktopNotifications;
  window.showEvents = showEvents;
  connect();
})();
