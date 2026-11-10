const apiGet = path => fetch(
  (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "") + "/api" + path,
  { headers: window.authHeaders?.() || {} }
).then(response => {
  if (!response.ok) throw new Error("Không thể kết nối backend.");
  return response.json();
});

const analyticsEscape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

async function loadAnalyticsPage(type) {
  try {
    const [events, cameras, health] = await Promise.all([apiGet("/events"), apiGet("/cameras"), apiGet("/health")]);
    if (type === "statistics") renderStats(events, cameras);
    else {
      const user = window.smartHomeUser?.() || {};
      let audits = [];
      if (user.role === "admin" || user.email?.toLowerCase() === "admin@gmail.com") audits = await apiGet("/audit-logs").catch(() => []);
      renderSecurity(events, cameras, health, audits);
    }
  } catch (error) {
    document.querySelector("#content").innerHTML = `<div class="content"><div class="offline-box"><b>Chưa tải được dữ liệu</b><p>${analyticsEscape(error.message)} Hãy kiểm tra backend.</p></div></div>`;
  }
}

function renderStats(allEvents, cameras) {
  allEvents = allEvents.filter(event => event.id != null || event.result === "FALL" || event.event_type === "FALL");
  const content = document.querySelector("#content");
  const render = (from = "", to = "") => {
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T23:59:59.999`) : null;
    const events = allEvents.filter(event => {
      const date = FallGuardTime.parseTimestamp(event.created_at);
      return date && (!start || date >= start) && (!end || date <= end);
    });
    const isManual = event => (event.source || (event.camera_id === "manual" ? "manual" : event.camera_id === "uploaded_video" ? "uploaded_video" : "live_camera")) === "manual";
    const aiEvents = events.filter(event => !isManual(event));
    const falseAlarms = aiEvents.filter(event => event.status === "false_alarm").length;
    const lstmEvents = aiEvents.filter(event => event.confidence_kind === "lstm_score" && Number.isFinite(Number(event.confidence)));
    const average = lstmEvents.length ? lstmEvents.reduce((sum, event) => sum + Number(event.confidence), 0) / lstmEvents.length : null;
    const days = new Set(aiEvents.map(event => FallGuardTime.formatDateTime(event.created_at,{year:"numeric",month:"2-digit",day:"2-digit"}))).size;
    const byCamera = cameras.map(camera => ({name:camera.name,count:aiEvents.filter(event=>event.camera_id===camera.id).length}));
    const other = [
      {name:"Video tải lên",count:aiEvents.filter(event=>event.camera_id==="uploaded_video").length},
      {name:"Camera đã xóa / chưa cấu hình",count:aiEvents.filter(event=>!cameras.some(camera=>camera.id===event.camera_id)&&event.camera_id!=="uploaded_video").length}
    ].filter(item=>item.count);
    const distribution = [...byCamera,...other];
    content.innerHTML = `<div class="content"><div class="heading"><div><p class="eyebrow">FALLGUARD / PHÂN TÍCH DỮ LIỆU</p><h1>Thống kê sự kiện thật</h1><p class="welcome-copy">Số liệu lấy từ lịch sử sự kiện backend; không tạo dữ liệu minh họa.</p></div><button class="outline-button" id="stats-refresh">↻ Tải lại dữ liệu</button></div>
      <form class="panel event-filter-bar" id="stats-filter"><label>Từ ngày<input type="date" name="from" value="${analyticsEscape(from)}"></label><label>Đến ngày<input type="date" name="to" value="${analyticsEscape(to)}"></label><button class="button" type="submit">Lọc</button><button class="outline-button" type="button" id="stats-clear">Xóa lọc</button></form>
      <div class="stats-grid">
        <article class="stat-card"><div class="stat-icon">!</div><p>Sự kiện AI</p><strong>${aiEvents.length}</strong><small>${aiEvents.length-falseAlarms} chưa đánh dấu báo giả · ${falseAlarms} báo giả</small></article>
        <article class="stat-card"><div class="stat-icon">%</div><p>Điểm LSTM trung bình</p><strong>${average === null ? "—" : `${(average * 100).toFixed(1)}%`}</strong><small>${lstmEvents.length} sự kiện có điểm LSTM · không phải độ chính xác đã kiểm chứng</small></article>
        <article class="stat-card"><div class="stat-icon">◉</div><p>Camera đang bật</p><strong>${cameras.filter(camera => camera.enabled).length}/${cameras.length}</strong><small>Trạng thái cấu hình hiện tại</small></article>
        <article class="stat-card"><div class="stat-icon">✓</div><p>Ngày có sự kiện AI</p><strong>${days}</strong><small>Trong khoảng ngày đã chọn</small></article>
      </div>
      <section class="panel"><div class="section-title"><div><span class="section-kicker">PHÂN BỐ TỪ BẢN GHI THẬT</span><h2>Sự kiện theo camera/nguồn</h2></div></div><div class="metric-list">${distribution.map(item => `<div class="metric"><span>${analyticsEscape(item.name)}</span><div><i style="width:${aiEvents.length ? Math.max(4,item.count / aiEvents.length * 100) : 4}%"></i></div><b>${item.count}</b></div>`).join("") || '<p class="muted">Chưa có sự kiện AI trong khoảng ngày này.</p>'}</div></section>
      <section class="panel"><span class="section-kicker">NGUỒN DỮ LIỆU</span><p class="muted">${aiEvents.length} sự kiện AI và ${events.length-aiEvents.length} sự kiện nhập tay lấy từ máy chủ. Các bản ghi cũ chưa có trường nguồn được suy ra từ mã camera.</p></section></div>`;
    content.querySelector("#stats-filter").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); render(data.get("from"), data.get("to")); };
    content.querySelector("#stats-clear").onclick = () => render();
    content.querySelector("#stats-refresh").onclick = () => loadAnalyticsPage("statistics");
  };
  render();
}

function renderSecurity(events, cameras, health, audits = []) {
  events = events.filter(event => event.id != null || event.result === "FALL" || event.event_type === "FALL");
  const websocket = window.WebSocket ? "Đang hỗ trợ" : "Không hỗ trợ";
  document.querySelector("#content").innerHTML = `
    <div class="content"><div class="heading"><div><p class="eyebrow">FALLGUARD <span>/</span> HỆ THỐNG</p><h1>Bảo mật & kết nối</h1><p class="welcome-copy">Theo dõi sức khỏe backend, AI detector và camera.</p></div><span class="security-state">● Hệ thống hoạt động</span></div>
      <div class="security-grid">
        <section class="panel"><span class="section-kicker">DỊCH VỤ</span><h2>Kết nối hệ thống</h2><div class="security-row"><span>Backend API</span><b class="ok">● Trực tuyến</b></div><div class="security-row"><span>Thông báo realtime</span><b class="ok">● ${websocket}</b></div><div class="security-row"><span>AI detector<small>${analyticsEscape(health.detector?.state || "Chưa có dữ liệu")}</small></span><b class="${health.detector?.state === "OFFLINE" ? "warn" : "ok"}">● ${health.detector?.state === "OFFLINE" ? "Ngoại tuyến" : "Sẵn sàng"}</b></div><div class="security-row"><span>Cảnh báo đã lưu</span><b>${events.length}</b></div></section>
        <section class="panel"><span class="section-kicker">THIẾT BỊ</span><h2>Trạng thái camera</h2>${cameras.map(camera => `<div class="security-row"><span>${analyticsEscape(camera.name)}<small>${analyticsEscape(camera.location || "Chưa thiết lập vị trí")}</small></span><b class="${camera.enabled ? "ok" : "warn"}">● ${camera.enabled ? "Đang bật" : "Đang tắt"}</b></div>`).join("") || '<p class="muted">Chưa có camera.</p>'}</section>
      </div>
      <section class="panel security-recommendations"><span class="section-kicker">KHUYẾN NGHỊ</span><h2>Bảo vệ hệ thống</h2><div class="security-tip">Không mở trực tiếp địa chỉ RTSP của camera ra Internet.</div><div class="security-tip">Chỉ cấp quyền webcam và thông báo cho website FallGuard.</div><div class="security-tip">Sử dụng mật khẩu riêng và chỉ chia sẻ tài khoản với người được phép.</div></section>
    </div>`;
  const currentUser = window.smartHomeUser?.() || {};
  if (currentUser.role === "admin" || currentUser.email?.toLowerCase() === "admin@gmail.com") document.querySelector("#content .content").insertAdjacentHTML("beforeend", `<section class="panel audit-panel"><span class="section-kicker">ADMIN AUDIT</span><h2>Nhật ký thay đổi</h2>${audits.length ? audits.slice(0,30).map(item=>`<div class="security-row"><span>${analyticsEscape(item.action)}<small>${analyticsEscape(JSON.stringify(item.detail||{}))}</small></span><b>${item.created_at ? new Date(item.created_at).toLocaleString("vi-VN") : ""}</b></div>`).join("") : '<p class="muted">Chưa có hoạt động được ghi nhận.</p>'}</section>`);
  const runtime=document.querySelector("#content .content");
  if(runtime) runtime.insertAdjacentHTML("afterbegin", `<section class="panel runtime-card"><span class="section-kicker">EDGE / AI SERVER</span><b>${analyticsEscape(health.runtime?.device || "CPU")}</b><small>${analyticsEscape(health.runtime?.logical_cpu_count || "—")} luồng CPU · CUDA ${health.runtime?.cuda_available ? "sẵn sàng" : "không khả dụng"}</small></section>`);
}
