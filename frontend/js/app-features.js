const featureApiRoot = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
const featureEscape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
async function featureRequest(path, options = {}) {
  const response = await fetch(`${featureApiRoot}/api${path}`, { ...options, headers: { "Content-Type": "application/json", ...(window.authHeaders?.() || {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Không thể lưu cấu hình.");
  return data;
}

async function showAIConfig() {
  const root = document.querySelector("#content");
  try {
    const [settings, cameras] = await Promise.all([featureRequest("/settings"), featureRequest("/cameras")]);
    const ai = settings.ai || {};
    const cameraOptions = [...cameras.map(camera => `<option value="${featureEscape(camera.id)}">${featureEscape(camera.name)}</option>`), '<option value="uploaded_video">Video t\u1ea3i l\u00ean</option>'].join("");
    const zones = structuredClone(ai.camera_zones || {});
    const backgrounds = new Map();
    root.innerHTML = `<div class="content feature-page"><div class="heading"><div><p class="eyebrow">FALLGUARD / AI & ROI</p><h1>C\u1ea5u h\u00ecnh AI v\u00e0 v\u00f9ng c\u1ea3nh b\u00e1o</h1><p class="welcome-copy">C\u1ea5u h\u00ecnh th\u1eddi gian x\u00e1c minh, \u0111\u1ed9 nh\u1ea1y, l\u1ecbch ch\u1ea1y v\u00e0 v\u00f9ng ph\u00e2n t\u00edch th\u1ef1c t\u1ebf.</p></div><span class="feature-admin-note">Ch\u1ec9 admin \u0111\u01b0\u1ee3c l\u01b0u thay \u0111\u1ed5i</span></div>
      <form class="panel feature-form" id="ai-settings-form"><div class="feature-settings-grid">
        <label>Th\u1eddi gian gi\u1eef t\u01b0 th\u1ebf n\u1eb1m<input type="number" name="fall_hold_seconds" min="1" max="30" step="0.5" value="${featureEscape(ai.fall_hold_seconds ?? 3)}"></label>
        <label>M\u1ee9c nh\u1ea1y / x\u00e1c minh <output id="sensitivity-output"></output><input type="range" name="sensitivity" min="0.2" max="0.95" step="0.05" value="${featureEscape(ai.sensitivity ?? 0.55)}"></label>
        <label class="feature-check"><input type="checkbox" name="show_skeleton" ${ai.show_skeleton !== false ? "checked" : ""}> Hi\u1ec7n khung x\u01b0\u01a1ng</label>
        <label class="feature-check"><input type="checkbox" name="show_boxes" ${ai.show_boxes !== false ? "checked" : ""}> Hi\u1ec7n h\u1ed9p nh\u1eadn di\u1ec7n</label>
        <label class="feature-check"><input type="checkbox" name="schedule_enabled" ${ai.schedule_enabled ? "checked" : ""}> Ch\u1ec9 ch\u1ea1y AI theo l\u1ecbch</label>
        <label>Camera \u01b0u ti\u00ean<select name="priority_camera"><option value="">Kh\u00f4ng \u01b0u ti\u00ean</option>${cameras.map(camera => `<option value="${featureEscape(camera.id)}" ${ai.priority_camera===camera.id?"selected":""}>${featureEscape(camera.name)}</option>`).join("")}</select></label>
        <label>B\u1eaft \u0111\u1ea7u l\u1ecbch<input type="time" name="schedule_start" value="${featureEscape(ai.schedule_start || "00:00")}"></label>
        <label>K\u1ebft th\u00fac l\u1ecbch<input type="time" name="schedule_end" value="${featureEscape(ai.schedule_end || "23:59")}"></label>
      </div><p class="feature-note" id="sensitivity-help"></p>
      <section class="feature-note"><b>V\u00f9ng ph\u00e2n t\u00edch theo camera</b><p>T\u1ea3i \u1ea3nh ch\u1ee5p th\u1eadt t\u1eeb \u0111\u00fang camera v\u00e0 g\u00f3c l\u1eafp \u0111\u1eb7t. B\u1ea5m c\u00e1c \u0111i\u1ec3m tr\u00ean \u1ea3nh \u0111\u1ec3 v\u1ebd \u0111a gi\u00e1c. T\u1ecda \u0111\u1ed9 v\u00f9ng s\u1ebd \u0111\u01b0\u1ee3c chu\u1ea9n h\u00f3a; backend ch\u1ec9 ph\u00e2n t\u00edch ng\u01b0\u1eddi trong v\u00f9ng ho\u1eb7c b\u1ecf qua ng\u01b0\u1eddi trong v\u00f9ng lo\u1ea1i tr\u1eeb. \u1ea2nh ch\u1ee5p ch\u1ec9 d\u00f9ng \u0111\u1ec3 v\u1ebd, kh\u00f4ng t\u1ea3i l\u00ean m\u00e1y ch\u1ee7.</p>
        <div class="feature-settings-grid"><label>Camera<select id="zone-camera">${cameraOptions}</select></label><label>Ch\u1ebf \u0111\u1ed9 v\u00f9ng<select id="zone-mode"><option value="include">Ch\u1ec9 ph\u00e2n t\u00edch b\u00ean trong v\u00f9ng</option><option value="exclude">B\u1ecf qua b\u00ean trong v\u00f9ng</option></select></label><label>\u1ea2nh khung h\u00ecnh th\u1eadt<input type="file" id="zone-image" accept="image/*"></label></div>
        <canvas id="zone-canvas" style="display:block;width:100%;height:auto;margin:12px 0;border:1px solid #64748b;border-radius:12px;background:#0f172a;cursor:crosshair;touch-action:none"></canvas>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="outline-button" id="zone-undo">Ho\u00e0n t\u00e1c \u0111i\u1ec3m</button><button type="button" class="outline-button" id="zone-clear">X\u00f3a v\u00f9ng camera n\u00e0y</button></div><small id="zone-count">Ch\u01b0a c\u00f3 v\u00f9ng. Ch\u1ecdn \u1ea3nh camera r\u1ed3i b\u1ea5m \u00edt nh\u1ea5t 3 \u0111i\u1ec3m.</small>
      </section><p id="ai-settings-message" class="auth-form-message" role="status"></p><button class="button" type="submit">L\u01b0u c\u1ea5u h\u00ecnh AI</button></form></div>`;
    const form = root.querySelector("#ai-settings-form"), canvas = root.querySelector("#zone-canvas"), ctx = canvas.getContext("2d");
    let points = [], currentZoneId = root.querySelector("#zone-camera").value;
    const editedZones = new Set();
    const updateSensitivity = () => {
      const value = Number(form.sensitivity.value), effectiveHold = Math.min(30, Number(form.fall_hold_seconds.value || 3) + value * 2);
      root.querySelector("#sensitivity-output").value = `${Math.round(value * 100)}%`;
      root.querySelector("#sensitivity-help").textContent = `M\u1ee9c x\u00e1c minh cao h\u1ea1 ng\u01b0\u1ee1ng t\u1ed1c \u0111\u1ed9 r\u01a1i nh\u01b0ng k\u00e9o d\u00e0i th\u1eddi gian gi\u1eef t\u01b0 th\u1ebf v\u00e0 y\u00eau c\u1ea7u LSTM \u0111\u1ed3ng thu\u1eadn l\u00e2u h\u01a1n. Th\u1eddi gian gi\u1eef t\u01b0 th\u1ebf hi\u1ec7n d\u1ef1 ki\u1ebfn kho\u1ea3ng ${effectiveHold.toFixed(1)} gi\u00e2y; n\u1ebfu LSTM kh\u00f4ng \u0111\u1ed3ng thu\u1eadn, nh\u00e1nh an to\u00e0n c\u00f3 th\u1ec3 ch\u1edd th\u00eam t\u1ed1i \u0111a 2 gi\u00e2y. Ph\u00e2n t\u00edch l\u00e2u h\u01a1n gi\u00fap l\u1ecdc dao \u0111\u1ed9ng, kh\u00f4ng \u0111\u1ea3m b\u1ea3o lu\u00f4n ch\u00ednh x\u00e1c v\u00e0 c\u00f3 th\u1ec3 l\u00e0m ch\u1eadm c\u1ea3nh b\u00e1o.`;
    };
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bg = backgrounds.get(currentZoneId); if (bg) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
      if (points.length) {
        ctx.beginPath(); points.forEach(([x,y],i)=>i?ctx.lineTo(x*canvas.width,y*canvas.height):ctx.moveTo(x*canvas.width,y*canvas.height));
        if (points.length>=3) ctx.closePath(); ctx.fillStyle="rgba(37,190,130,.20)"; if(points.length>=3)ctx.fill();
        ctx.strokeStyle="#22c55e";ctx.lineWidth=Math.max(2,canvas.width/400);ctx.stroke();
        points.forEach(([x,y])=>{ctx.beginPath();ctx.arc(x*canvas.width,y*canvas.height,Math.max(4,canvas.width/120),0,Math.PI*2);ctx.fillStyle="#facc15";ctx.fill();});
      }
      root.querySelector("#zone-count").textContent = points.length>=3 ? `\u0110\u00e3 v\u1ebd ${points.length} \u0111i\u1ec3m. V\u00f9ng \u00e1p d\u1ee5ng cho ${currentZoneId}.` : `\u0110ang c\u00f3 ${points.length}/3 \u0111i\u1ec3m; c\u1ea7n \u00edt nh\u1ea5t 3 \u0111i\u1ec3m \u0111\u1ec3 b\u1eadt v\u00f9ng.`;
    };
    const storeCurrentZone = () => { if(!editedZones.has(currentZoneId))return;if(points.length>=3)zones[currentZoneId]={mode:root.querySelector("#zone-mode").value,points:points.map(point=>[...point])};else delete zones[currentZoneId]; };
    const loadZone = () => { storeCurrentZone();currentZoneId=root.querySelector("#zone-camera").value;const zone=zones[currentZoneId];points=zone?.points?zone.points.map(point=>[...point]):[];root.querySelector("#zone-mode").value=zone?.mode||"include";const bg=backgrounds.get(currentZoneId);canvas.width=bg?.width||960;canvas.height=bg?.height||540;redraw();};
    root.querySelector("#zone-camera").addEventListener("change",loadZone);
    root.querySelector("#zone-mode").addEventListener("change",()=>{editedZones.add(currentZoneId);});
    root.querySelector("#zone-image").addEventListener("change",async event=>{const file=event.target.files?.[0];if(!file)return;let image;if(window.createImageBitmap)image=await createImageBitmap(file);else image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=URL.createObjectURL(file);});backgrounds.set(currentZoneId,image);canvas.width=image.width;canvas.height=image.height;redraw();});
    canvas.addEventListener("click",event=>{const rect=canvas.getBoundingClientRect();points.push([Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))]);editedZones.add(currentZoneId);redraw();});
    root.querySelector("#zone-undo").onclick=()=>{points.pop();editedZones.add(currentZoneId);redraw();};root.querySelector("#zone-clear").onclick=()=>{points=[];editedZones.add(currentZoneId);redraw();};
    form.sensitivity.addEventListener("input",updateSensitivity);form.fall_hold_seconds.addEventListener("input",updateSensitivity);updateSensitivity();loadZone();
    form.onsubmit=async event=>{event.preventDefault();const data=new FormData(form);editedZones.add(currentZoneId);storeCurrentZone();try{const next={fall_hold_seconds:Number(data.get("fall_hold_seconds")),sensitivity:Number(data.get("sensitivity")),show_skeleton:data.has("show_skeleton"),show_boxes:data.has("show_boxes"),schedule_enabled:data.has("schedule_enabled"),schedule_start:data.get("schedule_start"),schedule_end:data.get("schedule_end"),priority_camera:data.get("priority_camera")||null,camera_zones:zones};await featureRequest("/settings",{method:"PUT",body:JSON.stringify({ai:next})});localStorage.setItem("fallguard_show_skeleton",next.show_skeleton?"true":"false");localStorage.setItem("fallguard_show_boxes",next.show_boxes?"true":"false");root.querySelector("#ai-settings-message").textContent="\u0110\u00e3 l\u01b0u c\u1ea5u h\u00ecnh v\u00e0 v\u00f9ng ROI. Thay \u0111\u1ed5i s\u1ebd c\u00f3 hi\u1ec7u l\u1ef1c cho c\u00e1c khung h\u00ecnh ti\u1ebfp theo.";}catch(error){root.querySelector("#ai-settings-message").textContent=error.message;}};
  } catch(error) { root.innerHTML=`<div class="content"><div class="offline-box">${featureEscape(error.message)}</div></div>`; }
}
async function showEmergencyContacts() {
  const root = document.querySelector("#content");
  try {
    const settings = await featureRequest("/settings");
    const contacts = settings.contacts || [];
    root.innerHTML = `<div class="content feature-page"><div class="heading"><div><p class="eyebrow">FALLGUARD / THÔNG BÁO</p><h1>Liên hệ khẩn cấp</h1><p class="welcome-copy">Lưu người nhận và các kênh mong muốn cho quy trình liên lạc.</p></div></div><form class="panel feature-form" id="contacts-form"><div class="section-title"><div><span class="section-kicker">NGƯỜI NHẬN</span><h2>Danh sách liên hệ</h2></div><button type="button" class="outline-button" id="add-contact">＋ Thêm người</button></div><div id="contact-list">${contacts.map((item,i)=>contactRow(item,i)).join("")}</div><div class="feature-settings-grid feature-channels"><label class="feature-check"><input type="checkbox" name="push" ${settings.channels?.push!==false?"checked":""}> Thông báo trình duyệt / Push</label><label class="feature-check"><input type="checkbox" name="sms" ${settings.channels?.sms?"checked":""}> SMS (cần tích hợp nhà cung cấp)</label><label class="feature-check"><input type="checkbox" name="call" ${settings.channels?.call?"checked":""}> Cuộc gọi (cần tích hợp nhà cung cấp)</label><label class="feature-check"><input type="checkbox" name="zalo" ${settings.channels?.zalo?"checked":""}> Zalo (cần tích hợp API)</label></div><label>Thời gian chờ trước khi chuyển sang liên hệ tiếp theo (giây)<input type="number" min="5" max="3600" name="escalation-seconds" value="${featureEscape(settings.escalation?.wait_seconds ?? 30)}"></label><div class="feature-note"><b>Quy tắc leo thang</b><p>Thứ tự liên hệ và thời gian chờ được lưu làm cấu hình. Tự động xác nhận/chuyển tiếp cần dịch vụ gửi tin và lịch chạy nền, hiện chưa được tích hợp.</p></div><p id="contacts-message" class="auth-form-message" role="status"></p><button class="button" type="submit">Lưu danh bạ</button></form></div>`;
    const list = root.querySelector("#contact-list");
    root.querySelector("#add-contact").onclick = () => { list.insertAdjacentHTML("beforeend", contactRow({}, list.children.length)); list.lastElementChild.querySelector("input").focus(); };
    list.addEventListener("click", event => { if (event.target.closest("[data-remove-contact]")) event.target.closest(".contact-row").remove(); });
    root.querySelector("#contacts-form").onsubmit = async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const updated = [...list.querySelectorAll(".contact-row")].map(row=>({ name: row.querySelector('[name="contact-name"]').value.trim(), phone: row.querySelector('[name="contact-phone"]').value.trim(), email: row.querySelector('[name="contact-email"]').value.trim() })).filter(x=>x.name || x.phone || x.email);
      try { await featureRequest("/settings", { method:"PUT", body: JSON.stringify({ contacts: updated, channels: { push:data.has("push"), sms:data.has("sms"), call:data.has("call"), zalo:data.has("zalo") }, escalation: { wait_seconds: Number(data.get("escalation-seconds")) } }) }); root.querySelector("#contacts-message").textContent="Đã lưu danh sách và cấu hình leo thang. Kênh ngoài trình duyệt chưa gửi thông báo nếu chưa cấu hình nhà cung cấp."; }
      catch(error) { root.querySelector("#contacts-message").textContent=error.message; }
    };
  } catch (error) { root.innerHTML = `<div class="content"><div class="offline-box">${featureEscape(error.message)}</div></div>`; }
}

function contactRow(item={}, index=0) { return `<div class="contact-row"><span class="contact-priority">${index+1}</span><input name="contact-name" aria-label="Tên liên hệ" placeholder="Tên người nhận" value="${featureEscape(item.name||"")}"><input name="contact-phone" type="tel" aria-label="Số điện thoại" placeholder="Số điện thoại" value="${featureEscape(item.phone||"")}"><input name="contact-email" type="email" aria-label="Email" placeholder="Email" value="${featureEscape(item.email||"")}"><button type="button" class="delete-camera" data-remove-contact aria-label="Xóa liên hệ">×</button></div>`; }

async function showIncidents() {
  const root = document.querySelector("#content");
  try {
    const [events, cameras] = await Promise.all([featureRequest("/events"), featureRequest("/cameras")]);
    const all = events.filter(event=>event.id != null || event.event_type==="FALL" || event.result==="FALL").map(event=>{const timestamp=FallGuardTime.parseTimestamp(event.created_at);return timestamp?{...event,created_at:timestamp.toISOString()}:event;});
    root.innerHTML = `<div class="content feature-page"><div class="heading"><div><p class="eyebrow">FALLGUARD / TRUNG TÂM CẢNH BÁO</p><h1>Sự cố & lịch sử té ngã</h1><p class="welcome-copy">Lọc sự kiện và ghi nhận kết quả xử lý để bàn giao cho người chăm sóc.</p></div><button class="outline-button" id="incident-refresh">Làm mới</button></div><section class="panel feature-form"><form id="incident-filter" class="event-filter-bar"><label>Từ ngày<input type="date" name="from"></label><label>Đến ngày<input type="date" name="to"></label><label>Camera<select name="camera"><option value="">Tất cả camera</option>${cameras.map(c=>`<option value="${featureEscape(c.id)}">${featureEscape(c.name)}</option>`).join("")}</select></label><label>Mức độ<select name="severity"><option value="">Tất cả mức</option><option value="high">Té ngã tin cậy cao (≥70%)</option><option value="suspected">Cần xác minh (&lt;70%)</option></select></label><button class="button" type="submit">Lọc sự cố</button></form><div class="incident-list" id="incident-list"></div></section></div>`;
    const heading=root.querySelector(".heading");
    const headingActions=document.createElement("div");headingActions.className="incident-heading-actions";
    const unreadCount=all.filter(event=>!isIncidentRead(event)).length;
    const unreadSummary=document.createElement("span");unreadSummary.className="unread-summary";unreadSummary.textContent=unreadCount?`${unreadCount} chưa đọc`:"Đã đọc tất cả";
    const markAll=document.createElement("button");markAll.type="button";markAll.className="outline-button";markAll.textContent="Đọc tất cả";markAll.disabled=!unreadCount;
    const refreshButton=root.querySelector("#incident-refresh");headingActions.append(unreadSummary,markAll,refreshButton);heading.append(headingActions);
    markAll.onclick=async()=>{markAll.disabled=true;try{await featureRequest("/events/acknowledge-all",{method:"POST"});window.dispatchEvent(new CustomEvent("fallguard:notifications-read"));showIncidents();}catch(error){markAll.disabled=false;markAll.title=error.message;}};
    const list = root.querySelector("#incident-list");
    const render = filters => {
      const rangeStart=filters.from?FallGuardTime.parseTimestamp(`${filters.from}T00:00:00+07:00`):null;
      const rangeEnd=filters.to?FallGuardTime.parseTimestamp(`${filters.to}T23:59:59+07:00`):null;
      const filtered = all.filter(e=>{const d=FallGuardTime.parseTimestamp(e.created_at);if(!d)return false;return(!rangeStart||d>=rangeStart)&&(!rangeEnd||d<=rangeEnd)&&(!filters.camera||e.camera_id===filters.camera)&&(!filters.severity||(filters.severity==="high"?Number(e.confidence||0)>=.7:Number(e.confidence||0)<.7));});
      list.innerHTML = filtered.length ? filtered.map(e=>`<article class="incident-card"><div class="incident-title"><span class="event-dot danger">!</span><div><b>${featureEscape(e.message||"Phát hiện té ngã")}</b><small>${FallGuardTime.formatDateTime(e.created_at)} · ${featureEscape(cameras.find(c=>c.id===e.camera_id)?.name||e.camera_id||"Không rõ camera")} · ${(Number(e.confidence||0)*100).toFixed(0)}% tin cậy</small></div><span class="status-chip">${e.status==="resolved"?"Đã xử lý":e.status==="false_alarm"?"Báo động giả":e.status==="emergency_called"?"Đã gọi cấp cứu":"Cần xử lý"}</span></div><div class="event-log-actions"><select data-incident-status="${Number(e.id)}"><option value="unresolved" ${(e.status||"unresolved")==="unresolved"?"selected":""}>Chưa xử lý</option><option value="resolved" ${e.status==="resolved"?"selected":""}>Đã xử lý</option><option value="false_alarm" ${e.status==="false_alarm"?"selected":""}>Báo động giả</option><option value="emergency_called" ${e.status==="emergency_called"?"selected":""}>Đã gọi cấp cứu</option></select><input data-incident-note placeholder="Ghi chú bàn giao" maxlength="500" value="${featureEscape(e.note||"")}"><button type="button" class="outline-button" data-save-incident="${Number(e.id)}">Lưu cập nhật</button>${e.has_snapshot?`<button type="button" class="outline-button" data-open-snapshot="${Number(e.id)}">Xem ảnh</button>`:""}${e.has_clip?`<button type="button" class="outline-button" data-open-clip="${Number(e.id)}">Phát lại clip</button>`:""}</div><small class="incident-media-note">${e.has_clip?"Đã lưu clip 10 giây trước và sau khi phát hiện.":e.camera_id==="manual"||e.camera_id==="uploaded_video"?"Sự kiện này không phát sinh từ luồng camera realtime.":"Clip đang được tạo từ bộ đệm camera…"}</small><div class="incident-media-viewer"></div></article>`).join("") : '<div class="empty-events"><span>✓</span><p>Không có sự cố phù hợp.</p></div>';
      filtered.forEach((event,index)=>{const title=list.querySelectorAll(".incident-title")[index];if(title){const status=document.createElement("em");status.className=`read-status ${isIncidentRead(event)?"is-read":"is-unread"}`;status.textContent=isIncidentRead(event)?"Đã đọc":"Chưa đọc";title.append(status);}});
      list.querySelectorAll("[data-save-incident]").forEach(button=>button.onclick=async()=>{const card=button.closest(".incident-card");try{await featureRequest(`/events/${button.dataset.saveIncident}`,{method:"PATCH",body:JSON.stringify({status:card.querySelector("[data-incident-status]").value,note:card.querySelector("[data-incident-note]").value})});button.textContent="Đã lưu";button.disabled=true;}catch(error){alert(error.message);}});
      list.querySelectorAll("[data-open-clip], [data-open-snapshot]").forEach(button=>button.onclick=async()=>{try{const kind=button.hasAttribute("data-open-clip")?"clip":"snapshot";const id=button.dataset.openClip||button.dataset.openSnapshot;const response=await fetch(`${featureApiRoot}/api/events/${id}/${kind}`,{headers:window.authHeaders?.()||{}});if(!response.ok)throw new Error("Không tải được media sự cố.");const url=URL.createObjectURL(await response.blob());const viewer=button.closest(".incident-card").querySelector(".incident-media-viewer");viewer.innerHTML=kind==="clip"?`<video controls autoplay playsinline src="${url}"></video>`:`<img alt="Ảnh chụp sự cố" src="${url}">`;}catch(error){alert(error.message);}});
    };
    const filters=root.querySelector("#incident-filter");
    filters.onsubmit=event=>{event.preventDefault();const d=new FormData(filters);render({from:d.get("from"),to:d.get("to"),camera:d.get("camera"),severity:d.get("severity")});};
    root.querySelector("#incident-refresh").onclick=showIncidents; render({});
  } catch(error) { root.innerHTML=`<div class="content"><div class="offline-box">${featureEscape(error.message)}</div></div>`; }
}

function isIncidentRead(event){const userId=window.smartHomeUser?.()?.id;return event.acknowledged===true||Boolean(userId&&event.acknowledged_by?.includes(userId));}

async function triggerManualAlarm() {
  try {
    try { toggleLocalSiren(); } catch { /* Continue to record alarm if browser audio is unavailable. */ }
    const saved=await featureRequest("/events", { method:"POST", body:JSON.stringify({camera_id:"manual", confidence:0, message:"Báo động khẩn cấp thủ công từ Live Dashboard"}) });
    const manual=document.querySelector("#manual-alarm");if(manual){manual.classList.toggle("siren-active",Boolean(localSiren));manual.textContent=localSiren?"Tắt còi báo":"Báo động thủ công";}
    const panic=document.querySelector(".header-panic");if(panic){panic.classList.toggle("siren-active",Boolean(localSiren));const label=panic.querySelector("span:last-child");if(label)label.textContent=localSiren?"Tắt còi":"Báo động";}
    showEmergencyDialog(saved);
  } catch(error) { alert(`Không gửi được báo động: ${error.message}`); }
}

let localSiren = null;
function toggleLocalSiren(forceOff = false) {
  if (localSiren || forceOff) {
    if (localSiren) { clearInterval(localSiren.timer); localSiren.oscillator.stop(); localSiren.context.close(); localSiren=null; }
    const manual=document.querySelector("#manual-alarm");if(manual){manual.classList.remove("siren-active");manual.textContent="Báo động thủ công";}
    const panic=document.querySelector(".header-panic");if(panic){panic.classList.remove("siren-active");const label=panic.querySelector("span:last-child");if(label)label.textContent="Báo động";}
    return;
  }
  const Audio=window.AudioContext||window.webkitAudioContext;
  if (!Audio) throw new Error("Thiết bị không hỗ trợ âm thanh báo động.");
  const context=new Audio(); const oscillator=context.createOscillator(); const gain=context.createGain();
  oscillator.type="sine"; oscillator.frequency.value=880; gain.gain.value=.12; oscillator.connect(gain); gain.connect(context.destination); oscillator.start();
  let high=false; const timer=setInterval(()=>{high=!high;oscillator.frequency.setTargetAtTime(high?880:620,context.currentTime,.04);},450);
  localSiren={context,oscillator,timer};
}

window.showIncidents = showIncidents;
window.showAIConfig = showAIConfig;
window.showEmergencyContacts = showEmergencyContacts;
window.showEmergencyDialog = showEmergencyDialog;

function updateSoundButton() {
  const button=document.querySelector(".global-sound-toggle");
  if(!button)return;
  const enabled=localStorage.getItem("fallguard_sound_enabled")!=="false";
  button.setAttribute("aria-label",enabled?"Tắt âm thanh cảnh báo":"Bật âm thanh cảnh báo");
  button.title=enabled?"Âm thanh cảnh báo đang bật":"Âm thanh cảnh báo đang tắt";
  button.querySelector(".material-symbols-rounded").textContent=enabled?"volume_up":"volume_off";
  button.querySelector(".sound-label").textContent=enabled?"Âm thanh bật":"Đã tắt tiếng";
  button.classList.toggle("is-muted",!enabled);
}

async function loadSystemHealth() {
  try {
    const [health,cameras]=await Promise.all([featureRequest("/health"),featureRequest("/cameras/health")]);
    const cpu=health.runtime?.cpu_load_percent;
    const cpuLabel=document.querySelector("#cpu-health-label");
    if(cpuLabel)cpuLabel.textContent=cpu==null?"Đang khởi tạo":`${cpu}%`;
    const cpuMeter=document.querySelector("#cpu-health-meter");if(cpuMeter)cpuMeter.style.width=`${Math.max(4,Number(cpu||0))}%`;
    const gpuLabel=document.querySelector("#gpu-health-label");
    if(gpuLabel)gpuLabel.textContent=health.runtime?.cuda_available?"CUDA ready":"CPU mode";
    const gpuMeter=document.querySelector("#gpu-health-meter");if(gpuMeter)gpuMeter.style.width=`${health.runtime?.gpu_memory_percent??0}%`;
    const active=cameras.filter(camera=>camera.online);
    const latency=active.length?Math.round(active.reduce((sum,camera)=>sum+Number(camera.latency_ms||0),0)/active.length):null;
    const latencyLabel=document.querySelector("#rtsp-health-label");if(latencyLabel)latencyLabel.textContent=latency==null?"No live feed":`${latency} ms`;
    const status=document.querySelector("#system-online-label");if(status)status.textContent=health.status==="ok"?"System online":"System unavailable";
  } catch { const status=document.querySelector("#system-online-label");if(status)status.textContent="Backend offline"; }
}

function showEmergencyDialog(event) {
  const eventTimestamp=FallGuardTime.parseTimestamp(event.created_at);
  event={...event,created_at:(eventTimestamp||new Date()).toISOString()};
  const eventId=event.id==null?"live-alert":String(event.id);
  let modal=document.querySelector(".emergency-dialog-scrim");
  if(modal&&(modal.dataset.eventId===eventId||(event.camera_id&&modal.dataset.cameraId===String(event.camera_id)))){
    modal._event=event;modal.dataset.eventId=eventId;
    if(event.has_clip)attachEmergencyReplay(modal,event);
    return;
  }
  if(modal){clearInterval(modal._timer);modal.remove();}
  modal=document.createElement("div");modal.className="emergency-dialog-scrim";modal.dataset.eventId=eventId;modal.dataset.cameraId=String(event.camera_id||"");modal._event=event;
  const apiRoot=featureApiRoot;
  modal.innerHTML=`<section class="emergency-dialog" role="alertdialog" aria-modal="true" aria-labelledby="emergency-title"><div class="emergency-dialog-top"><span class="emergency-pulse"><i></i> CARECAM · CẢNH BÁO KHẨN</span><button class="emergency-close" aria-label="Đóng cảnh báo">×</button></div><div class="emergency-icon"><span class="material-symbols-rounded">crisis_alert</span></div><p class="emergency-overline">FALL DETECTED</p><h2 id="emergency-title">${featureEscape(event.message||"Phát hiện té ngã")}</h2><p class="emergency-meta">${featureEscape(event.camera_id||"Camera trực tiếp")} · ${new Date(event.created_at||Date.now()).toLocaleTimeString("vi-VN")} · ${(Number(event.confidence||0)*100).toFixed(0)}% tin cậy</p><div class="emergency-elapsed">Cảnh báo đã hoạt động <b data-dialog-age>0 giây</b></div><div class="emergency-dialog-media" data-dialog-media><span class="material-symbols-rounded">videocam</span><small>Đang chờ clip sự cố · luồng trực tiếp đang được lưu</small></div><div class="emergency-dialog-actions"><a class="button emergency-call-button" data-dialog-call hidden><span class="material-symbols-rounded">call</span> Gọi người thân</a><button class="outline-button" data-dialog-replay hidden><span class="material-symbols-rounded">play_circle</span> Xem lại clip</button><button class="outline-button false-alarm-button" data-dialog-false>Đánh dấu báo động giả</button></div><small class="emergency-disclaimer">Cuộc gọi sẽ mở ứng dụng điện thoại của thiết bị. FallGuard không tự gọi cấp cứu.</small></section>`;
  document.body.append(modal);
  const closeEmergency=()=>{clearInterval(modal._timer);modal.remove();};
  modal.querySelector(".emergency-close").onclick=closeEmergency;
  modal.addEventListener("click",event=>{if(event.target===modal)closeEmergency();});
  modal.addEventListener("keydown",event=>{if(event.key==="Escape")closeEmergency();});
  const created=new Date(event.created_at||Date.now()).getTime();
  const tick=()=>{if(!modal.isConnected)return;const age=Math.max(0,Math.floor((Date.now()-created)/1000));modal.querySelector("[data-dialog-age]").textContent=age<60?`${age} giây`:`${Math.floor(age/60)} phút ${age%60} giây`;};
  tick();modal._timer=setInterval(tick,1000);
  modal.querySelector(".emergency-close").focus();
  featureRequest("/contacts").then(({contacts=[]})=>{
    const contact=contacts.find(item=>item.phone);
    if(contact){const call=modal.querySelector("[data-dialog-call]");call.hidden=false;call.href=`tel:${contact.phone.replace(/[^\d+]/g,"")}`;call.addEventListener("click",()=>{const current=modal._event;if(current?.id)featureRequest(`/events/${current.id}`,{method:"PATCH",body:JSON.stringify({status:"emergency_called",note:`Đã mở cuộc gọi tới ${contact.name||contact.phone}.`})}).catch(()=>{});});}
  }).catch(()=>{});
  modal.querySelector("[data-dialog-false]").onclick=async()=>{try{const current=modal._event;if(current?.id)await featureRequest(`/events/${current.id}`,{method:"PATCH",body:JSON.stringify({status:"false_alarm",note:"Đánh dấu báo động giả từ hộp cảnh báo khẩn."})});closeEmergency();if(document.querySelector("[data-page=dashboard].active"))renderDashboard();}catch(error){alert(error.message);}};
  if(event.has_clip&&event.id)attachEmergencyReplay(modal,event);
}

function attachEmergencyReplay(modal,event){
  const replay=modal.querySelector("[data-dialog-replay]");if(!replay||!event.id)return;replay.hidden=false;
  replay.onclick=async()=>{try{const response=await fetch(`${featureApiRoot}/api/events/${event.id}/clip`,{headers:window.authHeaders?.()||{}});if(!response.ok)throw new Error("Clip chưa sẵn sàng.");const video=document.createElement("video");video.controls=true;video.autoplay=true;video.playsInline=true;video.src=URL.createObjectURL(await response.blob());modal.querySelector("[data-dialog-media]").replaceChildren(video);}catch(error){alert(error.message);}};
}

document.querySelector(".global-sound-toggle")?.addEventListener("click",()=>{localStorage.setItem("fallguard_sound_enabled",localStorage.getItem("fallguard_sound_enabled")==="false"?"true":"false");updateSoundButton();});
document.querySelector(".header-panic")?.addEventListener("click",()=>localSiren?toggleLocalSiren(true):triggerManualAlarm());
updateSoundButton();
window.addEventListener("fallguard:authenticated",loadSystemHealth);
if(window.authToken?.())loadSystemHealth();
if(window.authToken?.())window.careCamHealthTimer=setInterval(loadSystemHealth,5000);
window.addEventListener("fallguard:authenticated",()=>{if(!window.careCamHealthTimer)window.careCamHealthTimer=setInterval(loadSystemHealth,5000);});
window.addEventListener("fallguard:alert",event=>showEmergencyDialog(event.detail||{}));
