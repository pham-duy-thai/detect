(() => {
  const state = { events: [], cameras: [], tab: "all", page: 1, focusId: null,
    filters: { query: "", camera: "", status: "", from: "", to: "" }, drafts: new Map(), expanded: new Set(), urls: [] };
  const pageSize = 8;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const icon = name => `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
  const statuses = { unresolved: "Cần xử lý", resolved: "Đã xử lý", false_alarm: "Báo động giả", emergency_called: "Đã liên hệ cấp cứu" };
  const request = (path, options) => window.authRequest(path, options);
  const read = event => event.acknowledged === true || Boolean(window.smartHomeUser?.()?.id && event.acknowledged_by?.includes(window.smartHomeUser().id));
  const cameraName = event => state.cameras.find(camera => camera.id === event.camera_id)?.name ||
    (event.camera_id === "uploaded_video" ? "Video tải lên" : event.camera_id === "manual" ? "Báo động thủ công" : event.camera_id || "Không rõ nguồn");

  function message(text, error = false) {
    const host = document.querySelector("#notice-feedback");
    if (!host) return;
    host.textContent = text;
    host.classList.toggle("is-error", error);
  }

  function shell(root) {
    root.innerHTML = `<div class="content notification-center"><div class="heading notice-heading"><div><p class="eyebrow">CARECAM AI / TRUNG TÂM CẢNH BÁO</p><h1>Thông báo</h1><p class="welcome-copy">Theo dõi cảnh báo, xem lại sự cố và ghi nhận kết quả xử lý.</p></div><div class="notice-heading-actions"><button class="outline-button" id="notice-mark-all" type="button">${icon("done_all")} Đọc tất cả</button><button class="outline-button" id="notice-refresh" type="button" title="Làm mới" aria-label="Làm mới thông báo">${icon("refresh")}</button></div></div>
      <div class="notice-overview" id="notice-overview"></div>
      <section class="notice-panel"><div class="notice-panel-top"><div class="notice-tabs" role="group" aria-label="Lọc thông báo"><button type="button" data-notice-tab="all">Tất cả <span id="notice-total-count">0</span></button><button type="button" data-notice-tab="unread">Chưa đọc <span id="notice-unread-count">0</span></button></div><span class="notice-result-count" id="notice-result-count"></span></div>
      <form id="notice-filters" class="notice-filters"><label class="notice-search">${icon("search")}<span class="sr-only">Tìm thông báo</span><input type="search" name="query" placeholder="Tìm nội dung hoặc camera…" value="${escape(state.filters.query)}"></label><label><span class="sr-only">Camera</span><select name="camera"><option value="">Tất cả nguồn</option>${state.cameras.map(camera => `<option value="${escape(camera.id)}">${escape(camera.name)}</option>`).join("")}<option value="uploaded_video">Video tải lên</option><option value="manual">Báo động thủ công</option></select></label><label><span class="sr-only">Trạng thái xử lý</span><select name="status"><option value="">Tất cả trạng thái</option>${Object.entries(statuses).map(([value, title]) => `<option value="${value}">${title}</option>`).join("")}</select></label><details class="notice-date-filter"><summary>${icon("calendar_month")} Thời gian</summary><div><label>Từ ngày<input type="date" name="from" value="${escape(state.filters.from)}"></label><label>Đến ngày<input type="date" name="to" value="${escape(state.filters.to)}"></label></div></details><button class="notice-icon-button" type="button" id="notice-clear-filters" title="Xóa bộ lọc" aria-label="Xóa bộ lọc">${icon("filter_alt_off")}</button></form>
      <p class="notice-feedback" id="notice-feedback" role="status" aria-live="polite"></p><div class="notice-list" id="notice-list"></div><nav class="notice-pagination" id="notice-pagination" aria-label="Phân trang thông báo"></nav></section></div>`;
    const form = root.querySelector("#notice-filters");
    form.elements.camera.value = state.filters.camera;
    form.elements.status.value = state.filters.status;
    form.onsubmit = event => event.preventDefault();
    const filter = () => {
      state.filters = Object.fromEntries(new FormData(form));
      state.page = 1;
      render();
    };
    form.addEventListener("change", filter);
    form.elements.query.addEventListener("input", filter);
    root.querySelector("#notice-clear-filters").onclick = () => {
      state.filters = { query: "", camera: "", status: "", from: "", to: "" };
      shell(root); render();
    };
    root.querySelectorAll("[data-notice-tab]").forEach(button => button.onclick = () => {
      state.tab = button.dataset.noticeTab; state.page = 1; render();
    });
    root.querySelector("#notice-refresh").onclick = () => show();
    root.querySelector("#notice-mark-all").onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await request("/events/acknowledge-all", { method: "POST" });
        state.events = state.events.map(item => ({ ...item, acknowledged: true }));
        window.dispatchEvent(new CustomEvent("fallguard:notifications-read", { detail: { all: true } }));
        render(); message("Đã đánh dấu tất cả thông báo là đã đọc.");
      } catch (error) { message(error.message, true); button.disabled = false; }
    };
  }

  function card(event) {
    const id = Number(event.id);
    const status = event.status || "unresolved";
    const draft = state.drafts.get(id) || { status, note: event.note || "" };
    const unread = !read(event);
    const handled = ["resolved", "false_alarm"].includes(status);
    return `<article class="notice-card ${unread ? "is-unread" : "is-read"}" data-notice-id="${id}"><div class="notice-card-main"><div class="notice-event-icon ${handled ? "is-handled" : ""}">${icon(handled ? "task_alt" : event.camera_id === "manual" ? "campaign" : "crisis_alert")}</div><div class="notice-card-content"><div class="notice-card-label"><span class="notice-category">${event.camera_id === "manual" ? "Báo động thủ công" : "Cảnh báo té ngã"}</span>${unread ? '<span class="notice-new">Mới</span>' : ""}</div><h2>${escape(event.message || "Phát hiện té ngã")}</h2><div class="notice-metadata"><span>${icon("videocam")}${escape(cameraName(event))}</span><time>${icon("schedule")}${escape(FallGuardTime.formatDateTime(event.created_at))}</time></div><p class="notice-score">${escape(FallGuardScore.label(event))}</p></div><div class="notice-card-state"><span class="notice-status notice-status-${escape(status)}">${statuses[status] || statuses.unresolved}</span>${unread ? `<button class="notice-icon-button" type="button" data-notice-read="${id}" title="Đánh dấu đã đọc" aria-label="Đánh dấu thông báo ${id} đã đọc">${icon("done")}</button>` : `<span class="notice-read-label">${icon("done_all")} Đã đọc</span>`}</div></div>
      <details class="notice-detail" ${state.expanded.has(id) ? "open" : ""}><summary>${icon("tune")} Chi tiết & xử lý ${icon("expand_more")}</summary><div class="notice-detail-body"><form data-notice-update="${id}" class="notice-update-form"><label>Trạng thái<select name="status">${Object.entries(statuses).map(([value, title]) => `<option value="${value}" ${draft.status === value ? "selected" : ""}>${title}</option>`).join("")}</select></label><label>Ghi chú bàn giao<textarea name="note" rows="2" maxlength="500" placeholder="Ghi lại tình trạng và cách xử lý…">${escape(draft.note)}</textarea></label><button class="outline-button" type="submit">${icon("save")} Lưu cập nhật</button></form><div class="notice-media-actions">${event.has_clip ? `<button class="outline-button" type="button" data-notice-media="clip" data-id="${id}">${icon("play_circle")} Xem clip</button>` : ""}${event.has_snapshot ? `<button class="outline-button" type="button" data-notice-media="snapshot" data-id="${id}">${icon("image")} Xem ảnh</button>` : ""}<small>${event.has_clip || event.has_snapshot ? "Hình ảnh được lưu cùng sự cố." : "Chưa có hình ảnh hoặc clip cho sự cố này."}</small></div><div class="notice-media-viewer"></div></div></details></article>`;
  }

  function render() {
    const root = document.querySelector(".notification-center");
    if (!root) return;
    state.urls.forEach(url => URL.revokeObjectURL(url)); state.urls = [];
    const unread = state.events.filter(event => !read(event)).length;
    const unresolved = state.events.filter(event => !event.status || event.status === "unresolved").length;
    root.querySelector("#notice-overview").innerHTML = [
      ["mark_email_unread", "Chưa đọc", unread, "cyan"], ["pending_actions", "Cần xử lý", unresolved, "amber"],
      ["notifications", "Tổng thông báo", state.events.length, "muted"]
    ].map(([symbol, title, count, color]) => `<div class="notice-stat ${color}"><span>${icon(symbol)}</span><div><small>${title}</small><b>${count}</b></div></div>`).join("");
    root.querySelector("#notice-total-count").textContent = state.events.length;
    root.querySelector("#notice-unread-count").textContent = unread;
    root.querySelector("#notice-mark-all").disabled = unread === 0;
    root.querySelectorAll("[data-notice-tab]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.noticeTab === state.tab)));
    const f = state.filters;
    const from = f.from ? new Date(`${f.from}T00:00:00+07:00`) : null;
    const to = f.to ? new Date(`${f.to}T23:59:59.999+07:00`) : null;
    if (from && to && from > to) { message("Ngày bắt đầu cần trước hoặc bằng ngày kết thúc.", true); return; }
    const filtered = state.events.filter(event => {
      const date = FallGuardTime.parseTimestamp(event.created_at);
      return (state.tab !== "unread" || !read(event)) && (!f.camera || event.camera_id === f.camera) &&
        (!f.status || (event.status || "unresolved") === f.status) &&
        (!f.query || `${event.message} ${cameraName(event)}`.toLowerCase().includes(f.query.toLowerCase())) &&
        (!from || date && date >= from) && (!to || date && date <= to);
    });
    message("");
    if (state.focusId !== null) {
      const index = filtered.findIndex(event => Number(event.id) === state.focusId);
      if (index >= 0) state.page = Math.floor(index / pageSize) + 1;
      state.expanded.add(state.focusId);
    }
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * pageSize;
    root.querySelector("#notice-result-count").textContent = `${filtered.length} thông báo`;
    const list = root.querySelector("#notice-list");
    list.innerHTML = filtered.slice(start, start + pageSize).map(card).join("") || `<div class="notice-empty">${icon(state.events.length ? "filter_alt_off" : "notifications_none")}<h2>${state.events.length ? "Không có thông báo phù hợp" : "Chưa có thông báo"}</h2><p>${state.events.length ? "Thử đổi bộ lọc hoặc tìm kiếm nội dung khác." : "Cảnh báo mới từ camera và video sẽ xuất hiện tại đây."}</p></div>`;
    root.querySelector("#notice-pagination").innerHTML = filtered.length ? `<span>${start + 1}–${Math.min(start + pageSize, filtered.length)} / ${filtered.length}</span><div><button type="button" class="notice-icon-button" data-notice-page="${state.page - 1}" aria-label="Trang trước" ${state.page === 1 ? "disabled" : ""}>${icon("chevron_left")}</button><span>${state.page} / ${pages}</span><button type="button" class="notice-icon-button" data-notice-page="${state.page + 1}" aria-label="Trang tiếp theo" ${state.page === pages ? "disabled" : ""}>${icon("chevron_right")}</button></div>` : "";
    root.querySelectorAll("[data-notice-page]").forEach(button => button.onclick = () => { state.page = Number(button.dataset.noticePage); render(); });
    list.querySelectorAll("[data-notice-read]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const id = Number(button.dataset.noticeRead);
        const updated = await request(`/events/${id}/acknowledge`, { method: "POST" });
        state.events = state.events.map(event => Number(event.id) === id ? updated : event);
        window.dispatchEvent(new CustomEvent("fallguard:notifications-read", { detail: { event_id: id } }));
        render();
      } catch (error) { message(error.message, true); button.disabled = false; }
    });
    list.querySelectorAll(".notice-detail").forEach(detail => detail.ontoggle = () => {
      const id = Number(detail.closest("[data-notice-id]").dataset.noticeId);
      if (detail.open) state.expanded.add(id); else state.expanded.delete(id);
    });
    list.querySelectorAll("[data-notice-update]").forEach(form => {
      const id = Number(form.dataset.noticeUpdate);
      form.oninput = () => state.drafts.set(id, Object.fromEntries(new FormData(form)));
      form.onsubmit = async event => {
        event.preventDefault();
        const button = form.querySelector("button[type=submit]"); button.disabled = true;
        try {
          const updated = await request(`/events/${id}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
          state.events = state.events.map(item => Number(item.id) === id ? updated : item);
          state.drafts.delete(id); render(); message("Đã lưu kết quả xử lý sự cố.");
        } catch (error) { message(error.message, true); button.disabled = false; }
      };
    });
    list.querySelectorAll("[data-notice-media]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const base = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
        const response = await fetch(`${base}/api/events/${button.dataset.id}/${button.dataset.noticeMedia}`, { headers: window.authHeaders?.() || {} });
        if (!response.ok) throw new Error("Chưa tải được hình ảnh sự cố. Hãy thử lại.");
        const url = URL.createObjectURL(await response.blob()); state.urls.push(url);
        const media = document.createElement(button.dataset.noticeMedia === "clip" ? "video" : "img");
        media.src = url;
        if (media.tagName === "VIDEO") { media.controls = true; media.playsInline = true; } else media.alt = "Ảnh chụp sự cố";
        button.closest(".notice-detail-body").querySelector(".notice-media-viewer").replaceChildren(media);
      } catch (error) { message(error.message, true); }
      finally { button.disabled = false; }
    });
    if (state.focusId !== null) {
      root.querySelector(`[data-notice-id="${state.focusId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      state.focusId = null;
    }
  }

  async function show() {
    const root = document.querySelector("#content");
    if (!root) return;
    const isOpen = Boolean(root.querySelector("#notice-list"));
    if (!isOpen) root.innerHTML = '<div class="content notification-center-loading" role="status">Đang tải thông báo…</div>';
    try {
      const [events, cameras] = await Promise.all([request("/events"), request("/cameras")]);
      if (!root.querySelector(".notification-center, .notification-center-loading")) return;
      state.events = events.filter(event => event.id != null); state.cameras = cameras;
      if (!isOpen) shell(root);
      render();
    } catch (error) {
      if (root.querySelector(".notification-center")) message(error.message, true);
      else if (root.querySelector(".notification-center-loading")) {
        root.innerHTML = `<div class="content notification-center"><div class="notice-empty">${icon("cloud_off")}<h1>Chưa tải được thông báo</h1><p>${escape(error.message)}</p><button class="outline-button" id="notice-retry" type="button">Thử lại</button></div></div>`;
        root.querySelector("#notice-retry").onclick = () => { root.innerHTML = ""; show(); };
      }
    }
  }

  window.FallGuardNotificationPopup = { async open(anchor) {
    const existing = document.querySelector(".notification-popup-v2");
    if (existing) { existing.remove(); anchor.setAttribute("aria-expanded", "false"); return; }
    document.querySelectorAll(".header-popup").forEach(popup => popup.remove());
    const popup = document.createElement("div");
    popup.className = "header-popup notification-popup notification-popup-v2";
    popup.setAttribute("role", "dialog"); popup.setAttribute("aria-label", "Thông báo gần đây");
    popup.innerHTML = `<div class="notice-popup-head"><div><b>Thông báo</b><small role="status">Đang tải cảnh báo gần đây…</small></div><button class="notice-icon-button" type="button" data-close-notices title="Đóng" aria-label="Đóng thông báo">${icon("close")}</button></div><div class="notice-popup-list"><div class="notice-popup-empty" role="status">Đang tải…</div></div><div class="notice-popup-footer"><a href="#messages" data-page="messages">Xem tất cả thông báo →</a><button class="notice-popup-read-all" type="button" disabled>Đọc tất cả</button></div>`;
    document.body.append(popup);
    const rect = anchor.getBoundingClientRect();
    const availableHeight = Math.max(120, innerHeight - rect.bottom - 24);
    popup.style.top = `${rect.bottom + 10}px`;
    popup.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
    popup.style.maxHeight = `${availableHeight}px`;
    popup.querySelector(".notice-popup-list").style.maxHeight = `${Math.max(60, Math.min(420, availableHeight - 150))}px`;
    anchor.setAttribute("aria-expanded", "true"); anchor.setAttribute("aria-haspopup", "dialog");
    popup.querySelector("[data-close-notices]").onclick = () => { popup.remove(); anchor.setAttribute("aria-expanded", "false"); anchor.focus(); };
    let events = [];
    const renderPopup = () => {
      const unread = events.filter(event => !read(event)).length;
      popup.querySelector(".notice-popup-head small").textContent = unread ? `${unread} thông báo chưa đọc` : "Bạn đã đọc tất cả thông báo";
      popup.querySelector(".notice-popup-read-all").disabled = unread === 0;
      popup.querySelector(".notice-popup-list").innerHTML = events.slice(0, 6).map(event => `<button class="notification-item ${read(event) ? "is-read" : "is-unread"}" type="button" data-open-notice="${Number(event.id)}">${icon("crisis_alert")}<span><b>${escape(event.message || "Phát hiện té ngã")}</b><small>${escape(cameraName(event))} · ${escape(FallGuardTime.formatDateTime(event.created_at))}</small></span><i aria-hidden="true"></i></button>`).join("") || `<div class="notice-popup-empty">${icon("notifications_none")}Chưa có thông báo mới.</div>`;
      popup.querySelectorAll("[data-open-notice]").forEach(button => button.onclick = async () => {
        button.disabled = true;
        try {
          const id = Number(button.dataset.openNotice);
          if (!read(events.find(event => Number(event.id) === id))) {
            await request(`/events/${id}/acknowledge`, { method: "POST" });
            window.dispatchEvent(new CustomEvent("fallguard:notifications-read", { detail: { event_id: id } }));
          }
          window.FallGuardNotifications.openEvent(id);
          anchor.setAttribute("aria-expanded", "false");
        } catch (error) { popup.querySelector(".notice-popup-head small").textContent = error.message; button.disabled = false; }
      });
    };
    try {
      const [items, cameras] = await Promise.all([request("/events"), request("/cameras")]);
      if (!popup.isConnected) return;
      events = items.filter(event => event.id != null); state.cameras = cameras;
      renderPopup();
      popup.querySelector(".notice-popup-read-all").onclick = async event => {
        const button = event.currentTarget; button.disabled = true;
        try {
          await request("/events/acknowledge-all", { method: "POST" });
          events = events.map(item => ({ ...item, acknowledged: true }));
          window.dispatchEvent(new CustomEvent("fallguard:notifications-read", { detail: { all: true } }));
          renderPopup();
        } catch (error) { popup.querySelector(".notice-popup-head small").textContent = error.message; button.disabled = false; }
      };
    } catch (error) {
      if (popup.isConnected) popup.querySelector(".notice-popup-list").innerHTML = `<div class="notice-popup-empty">${icon("cloud_off")}${escape(error.message)}</div>`;
    }
  } };
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const popup = document.querySelector(".notification-popup-v2");
    if (popup) { popup.remove(); const anchor = document.querySelector(".header-bell"); anchor?.setAttribute("aria-expanded", "false"); anchor?.focus(); }
  });
  window.addEventListener("fallguard:notifications-read", event => {
    const id = event.detail?.event_id;
    state.events = state.events.map(item => !id || Number(item.id) === Number(id) ? { ...item, acknowledged: true } : item);
    render();
  });

  window.FallGuardNotifications = { show, openEvent(id) {
    state.focusId = Number(id); state.tab = "all"; state.filters = { query: "", camera: "", status: "", from: "", to: "" };
    document.querySelectorAll(".header-popup").forEach(popup => popup.remove());
    document.querySelector("#content").innerHTML = "";
    window.navigate("messages", document.querySelector('.sidebar [data-page="messages"]'));
  } };
})();
