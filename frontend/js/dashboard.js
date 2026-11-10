async function renderDashboard() {
  const content = document.querySelector("#content");
  try {
    const [cameras, status, events, aiSettings, health, contactsResult] = await Promise.all([
      apiGet("/cameras"), apiGet("/status"), apiGet("/events"), apiGet("/ai-settings"), apiGet("/health"),
      apiGet("/contacts").catch(()=>({contacts:[]}))
    ]);
    events.forEach(event=>{const timestamp=FallGuardTime.parseTimestamp(event.created_at);if(timestamp)event.created_at=timestamp.toISOString();});
    const contacts = contactsResult.contacts || [];
    if (localStorage.getItem("fallguard_show_skeleton") === null) localStorage.setItem("fallguard_show_skeleton", aiSettings.show_skeleton === false ? "false" : "true");
    if (localStorage.getItem("fallguard_show_boxes") === null) localStorage.setItem("fallguard_show_boxes", aiSettings.show_boxes === true ? "true" : "false");
    const falls = events.filter(item => item.id != null || item.result === "FALL" || item.event_type === "FALL");
    const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    const initials = value => escape(String(value || "C").slice(0, 1).toUpperCase());
    const isFall = status.state === "FALL";

    content.innerHTML = `
      <div class="content dashboard-page">
        <div class="dashboard-welcome">
          <div>
            <p class="eyebrow">FALLGUARD <span>/</span> TRUNG TÂM GIÁM SÁT</p>
            <h1>Giám sát an toàn</h1>
            <p class="welcome-copy">Theo dõi camera và nhận cảnh báo té ngã theo thời gian thực.</p>
          </div>
          <div class="monitoring-pill ${isFall ? "is-alert" : ""}"><i></i>${isFall ? "Đang có cảnh báo" : "Hệ thống sẵn sàng"}</div>
        </div>

        <section class="dashboard-stats" aria-label="Tổng quan hệ thống">
          <article class="dash-stat"><span class="dash-icon icon-blue">◉</span><div><small>TỔNG CAMERA</small><b>${cameras.length}</b><em>${cameras.filter(camera => camera.enabled).length} camera đã kích hoạt</em></div></article>
          <article class="dash-stat"><span class="dash-icon icon-green">✓</span><div><small>TRẠNG THÁI AI</small><b>${escape(status.state || "OFFLINE")}</b><em>${status.updated_at ? `Cập nhật ${FallGuardTime.formatTime(status.updated_at)}` : "Bật camera để bắt đầu phân tích"}</em></div></article>
          <article class="dash-stat"><span class="dash-icon icon-red">!</span><div><small>CẢNH BÁO TÉ NGÃ</small><b>${falls.length}</b><em>Sự kiện đã ghi nhận</em></div></article>
          <article class="dash-stat"><span class="dash-icon icon-violet">↗</span><div><small>TỐC ĐỘ XỬ LÝ</small><b>${Number(status.fps || 0).toFixed(1)} <small class="stat-unit">FPS</small></b><em>${escape(status.camera_id || "Chưa chọn camera")}</em></div></article>
        </section>

        <div class="dashboard-main">
          <section class="panel dashboard-camera-panel">
            <div class="section-title"><div><span class="section-kicker">GIÁM SÁT TRỰC TIẾP</span><h2>Camera của bạn</h2><p class="muted">Bật camera để xem hình ảnh và chạy nhận diện AI.</p></div><a class="text-button" data-page="devices">Quản lý camera <span>→</span></a></div>
            <div class="live-grid">${cameras.map(camera => `
              <article class="camera-card live-card ${status.state === "FALL" && status.camera_id === camera.id ? "is-critical" : ""}">
                <div class="live-preview camera-preview ${camera.enabled ? "preview-ready" : "preview-offline"}">
                  <span class="live-status ${status.state === "FALL" && status.camera_id === camera.id ? "alert-state" : camera.enabled ? "online" : ""}"><i></i>${status.state === "FALL" && status.camera_id === camera.id ? "FALL DETECTED!" : camera.enabled ? "SẴN SÀNG" : "ĐANG TẮT"}</span>
                  <span class="live-illustration">${camera.enabled ? "◉" : "○"}</span>
                  <span class="live-title">${escape(camera.name)}</span>
                  ${status.state === "FALL" && status.camera_id === camera.id ? '<span class="fall-floating-banner">FALL DETECTED</span>' : ""}
                  <div class="camera-hover-controls"><button type="button" data-fullscreen-camera title="Toàn màn hình">⛶</button><button type="button" data-camera-skeleton title="Bật/tắt khung xương">⌘</button><button type="button" disabled title="Intercom chưa được kết nối">◖))</button></div>
                </div>
                <div class="live-info"><div><b>${escape(camera.location || "Chưa thiết lập vị trí")}</b><small>${camera.enabled ? "Camera sẵn sàng giám sát" : "Bật camera để bắt đầu"}</small></div><button class="switch ${camera.enabled ? "checked" : ""}" data-toggle="${escape(camera.id)}" aria-label="Bật hoặc tắt ${escape(camera.name)}"><span></span></button></div>
              </article>`).join("") || `<div class="empty-state"><span>◉</span><b>Chưa có camera</b><p>Thêm camera để bắt đầu giám sát không gian của bạn.</p><a class="button" data-page="devices">Thiết lập camera</a></div>`}</div>
          </section>

          <section class="panel recent-panel">
            <div class="section-title"><div><span class="section-kicker">CẬP NHẬT MỚI</span><h2>Cảnh báo gần đây</h2><p class="muted">Các sự kiện được hệ thống ghi nhận.</p></div><a class="text-button" data-page="messages">Tất cả <span>→</span></a></div>
            <div class="event-list">${events.slice(0, 5).map(event => `
              <div class="event"><span class="event-dot danger">!</span><div><b>${escape(event.message || "Sự kiện hệ thống")}</b><small>${FallGuardTime.formatDateTime(event.created_at)} <span>·</span> ${FallGuardScore.label(event)}</small></div></div>`).join("") || `<div class="empty-events"><span>✓</span><p>Chưa có cảnh báo nào.</p><small>Các sự kiện mới sẽ xuất hiện tại đây.</small></div>`}</div>
          </section>
        </div>
      </div>`;
    const apiRoot = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
    const recentAlert = events.find(event=>!(["resolved","false_alarm","emergency_called"].includes(event.status))) || events[0];
    const alertIsActive=Boolean(recentAlert&&!(["resolved","false_alarm","emergency_called"].includes(recentAlert.status)));
    const alertArea = document.createElement("section");
    alertArea.className = `live-alert-card ${alertIsActive ? "urgent" : recentAlert ? "history-alert" : "empty-alert"}`;
    const phone = contacts.find(contact=>contact.phone)?.phone?.replace(/[^\d+]/g, "") || "";
    alertArea.innerHTML = recentAlert ? `<div class="live-alert-top"><span class="alert-priority"><i></i> LIVE ALERT</span><time id="alert-age" data-created="${escape(recentAlert.created_at)}">Đang tính thời gian</time></div><div class="live-alert-body"><div class="alert-snapshot" id="latest-snapshot">${recentAlert.has_snapshot ? '<span class="material-symbols-rounded">image</span>' : '<span class="material-symbols-rounded">warning</span>'}</div><div class="alert-description"><b>${escape(recentAlert.message || "Phát hiện té ngã")}</b><small>${escape(cameras.find(camera=>camera.id===recentAlert.camera_id)?.name || recentAlert.camera_id || "Sự cố hệ thống")} · ${FallGuardTime.formatTime(recentAlert.created_at)}</small><strong class="inactivity-timer">Cảnh báo đã hoạt động <span data-alert-elapsed>—</span></strong></div></div><div class="alert-actions">${phone ? `<a class="button emergency-call-button" data-dispatch-event="${Number(recentAlert.id)}" href="tel:${phone}"><span class="material-symbols-rounded">call</span> Gọi liên hệ</a>` : '<button class="button emergency-call-button" data-page="contacts"><span class="material-symbols-rounded">contacts</span> Thêm liên hệ</button>'}<button class="outline-button false-alarm-button" data-dismiss-event="${Number(recentAlert.id)}">Báo động giả</button>${recentAlert.has_clip ? `<button class="outline-button replay-event-button" data-replay-event="${Number(recentAlert.id)}"><span class="material-symbols-rounded">play_circle</span> Phát lại</button>` : ""}</div><div class="alert-media-preview" id="alert-media-preview"></div>` : `<div class="alert-calm"><span class="material-symbols-rounded">verified_user</span><div><b>Chưa có cảnh báo mới</b><small>Luồng cảnh báo realtime đang được theo dõi.</small></div><i></i></div>`;
    content.querySelector(".recent-panel .section-title")?.insertAdjacentElement("afterend", alertArea);
    const contactPanel = document.createElement("section");
    contactPanel.className="emergency-contact-panel";
    contactPanel.innerHTML=`<div class="contact-panel-heading"><div><span class="section-kicker">EMERGENCY CONTACTS</span><h3>Liên hệ khẩn cấp</h3></div><a data-page="contacts" class="text-button">Quản lý</a></div>${contacts.length?contacts.slice(0,3).map(contact=>`<div class="quick-contact"><span class="contact-avatar">${escape((contact.name||"?").slice(0,1).toUpperCase())}</span><span><b>${escape(contact.name||"Người liên hệ")}</b><small>${escape(contact.phone||contact.email||"Chưa có số điện thoại")}</small></span>${contact.phone?`<a href="tel:${contact.phone.replace(/[^\d+]/g,"")}" aria-label="Gọi ${escape(contact.name)}" class="quick-call"><span class="material-symbols-rounded">call</span></a>`:""}</div>`).join(""):'<p class="contact-empty">Chưa có liên hệ. Admin có thể thêm số điện thoại trong Cấu hình liên hệ.</p>'}`;
    content.querySelector(".recent-panel .event-list")?.insertAdjacentElement("afterend", contactPanel);
    if (recentAlert?.has_snapshot) fetch(`${apiRoot}/api/events/${recentAlert.id}/snapshot`,{headers:window.authHeaders?.()||{}}).then(response=>response.ok?response.blob():null).then(blob=>{if(blob){const image=document.createElement("img");image.src=URL.createObjectURL(blob);image.alt="Ảnh chụp cảnh báo";content.querySelector("#latest-snapshot")?.replaceChildren(image);}}).catch(()=>{});
    if (window.careCamAlertTimer) clearInterval(window.careCamAlertTimer);
    const updateAge=()=>{const node=content.querySelector("#alert-age");if(!node)return;const timeText=FallGuardTime.formatTimeAgo(node.dataset.created);node.textContent=timeText;const elapsed=content.querySelector("[data-alert-elapsed]");if(elapsed)elapsed.textContent=timeText;};
    updateAge(); window.careCamAlertTimer=setInterval(updateAge,1000);
    const toolbar = document.createElement("div");
    toolbar.className = "live-toolbar panel";
    toolbar.innerHTML = `<label>Chia lưới <select id="live-grid-size"><option value="2">2 × 2</option><option value="3">3 × 3</option></select></label><label>Camera ưu tiên <select id="live-priority"><option value="">Không ưu tiên</option>${cameras.map(camera=>`<option value="${escape(camera.id)}">${escape(camera.name)}</option>`).join("")}</select></label><label class="live-toggle"><input type="checkbox" id="toggle-skeleton"> Khung xương AI</label><label class="live-toggle"><input type="checkbox" id="toggle-boxes"> Hộp nhận diện</label><button class="button danger-button" id="manual-alarm">Báo động thủ công</button>`;
    content.querySelector(".dashboard-camera-panel .section-title")?.insertAdjacentElement("afterend", toolbar);
    const grid = content.querySelector(".live-grid");
    const setLayout = () => {
      const size = Number(toolbar.querySelector("#live-grid-size").value);
      if (grid) {
        grid.style.setProperty("--live-columns", size);
        grid.querySelectorAll(".live-card").forEach((card,index)=>card.hidden=index>=size*size);
        grid.querySelectorAll(".live-placeholder").forEach(card=>card.remove());
        const activeCards=grid.querySelectorAll(".live-card:not([hidden])").length;
        for(let i=activeCards;i<size*size;i++){const slot=document.createElement("div");slot.className="live-placeholder";slot.innerHTML="<span>＋</span><b>Ô camera trống</b><small>Thêm thiết bị trong mục Camera & thiết bị</small>";grid.append(slot);}
        for (const [id,item] of webcamStreams) if (item.card?.hidden) stopWebcam(id,item.card);
      }
    };
    const priority = localStorage.getItem("fallguard_priority_camera") || aiSettings.priority_camera || "";
    toolbar.querySelector("#live-priority").value = priority;
    if (priority && grid) [...grid.children].sort((a,b)=>Number(b.querySelector(`[data-toggle="${CSS.escape(priority)}"]`)?1:0)-Number(a.querySelector(`[data-toggle="${CSS.escape(priority)}"]`)?1:0)).forEach(card=>grid.append(card));
    toolbar.querySelector("#live-grid-size").onchange=setLayout;
    toolbar.querySelector("#live-priority").onchange=event=>{localStorage.setItem("fallguard_priority_camera",event.target.value);renderDashboard();};
    toolbar.querySelector("#toggle-skeleton").checked=localStorage.getItem("fallguard_show_skeleton")!=="false";
    toolbar.querySelector("#toggle-boxes").checked=localStorage.getItem("fallguard_show_boxes")==="true";
    toolbar.querySelector("#toggle-skeleton").onchange=event=>localStorage.setItem("fallguard_show_skeleton",event.target.checked?"true":"false");
    toolbar.querySelector("#toggle-boxes").onchange=event=>localStorage.setItem("fallguard_show_boxes",event.target.checked?"true":"false");
    toolbar.querySelector("#manual-alarm").onclick=()=>localSiren?toggleLocalSiren(true):triggerManualAlarm();
    content.querySelectorAll("[data-dismiss-event]").forEach(button=>button.onclick=async()=>{try{await featureRequest(`/events/${button.dataset.dismissEvent}`,{method:"PATCH",body:JSON.stringify({status:"false_alarm",note:"Đánh dấu báo động giả từ bảng giám sát."})});renderDashboard();}catch(error){alert(error.message);}});
    content.querySelectorAll("[data-dispatch-event]").forEach(link=>link.onclick=async()=>{try{await featureRequest(`/events/${link.dataset.dispatchEvent}`,{method:"PATCH",body:JSON.stringify({status:"emergency_called",note:"Đã mở cuộc gọi tới liên hệ khẩn cấp."})});}catch(error){console.error(error);}});
    content.querySelectorAll("[data-replay-event]").forEach(button=>button.onclick=async()=>{try{const response=await fetch(`${apiRoot}/api/events/${button.dataset.replayEvent}/clip`,{headers:window.authHeaders?.()||{}});if(!response.ok)throw new Error("Clip chưa sẵn sàng.");const video=document.createElement("video");video.controls=true;video.autoplay=true;video.playsInline=true;video.src=URL.createObjectURL(await response.blob());content.querySelector("#alert-media-preview")?.replaceChildren(video);}catch(error){alert(error.message);}});
    content.querySelectorAll("[data-fullscreen-camera]").forEach(button=>button.onclick=()=>button.closest(".camera-preview")?.requestFullscreen?.());
    content.querySelectorAll("[data-camera-skeleton]").forEach(button=>button.onclick=()=>{const next=localStorage.getItem("fallguard_show_skeleton")==="false";localStorage.setItem("fallguard_show_skeleton",next?"true":"false");button.classList.toggle("control-active",next);});
    content.querySelector("#live-grid-size").innerHTML='<option value="1">1 × 1</option><option value="2">2 × 2</option><option value="3">3 × 3</option>';
    const savedGrid=Number(localStorage.getItem("fallguard_grid_size")||2);content.querySelector("#live-grid-size").value=String(savedGrid);
    const originalGridHandler=content.querySelector("#live-grid-size").onchange;content.querySelector("#live-grid-size").onchange=event=>{localStorage.setItem("fallguard_grid_size",event.target.value);originalGridHandler();};
    setLayout();
    const maxCameras=savedGrid*savedGrid;content.querySelectorAll(".live-card").forEach((card,index)=>card.hidden=index>=maxCameras);
  } catch (error) {
    content.innerHTML = `<div class="content"><div class="offline-box"><b>Chưa kết nối được hệ thống</b><p>${String(error.message || "Hãy kiểm tra backend.")}</p><button class="button" onclick="renderDashboard()">Thử kết nối lại</button></div></div>`;
  }
}
