async function showAccount() {
  selectedAccountIds.clear();
  const user = window.smartHomeUser?.() || {};
  const isAdmin = user.role === "admin" || user.email?.toLowerCase() === "admin@gmail.com";
  if (!isAdmin) { showProfile(); return; }
  const content = document.querySelector("#content");
  document.querySelector("#breadcrumb").textContent = "Quản lý tài khoản";
  content.innerHTML = `
    <div class="content account-page">
      <div class="heading"><div><p class="eyebrow">FALLGUARD <span>/</span> QUẢN TRỊ</p><h1>Quản lý tài khoản</h1><p class="welcome-copy">Người dùng tự đăng ký bằng email hoặc số điện thoại; chỉ đăng nhập sau khi được duyệt.</p></div><button class="button" id="add-account"><span>＋</span> Cấp tài khoản</button></div>
      <section class="panel auth-account-card account-table-panel"><div class="account-list-head"><div><span class="section-kicker">DANH SÁCH NGƯỜI DÙNG</span><h2>Tài khoản hệ thống</h2><p class="muted" id="account-count">Đang tải tài khoản…</p></div><button class="outline-button" id="refresh-requests" type="button">Làm mới</button></div>
        <div class="account-toolbar"><input id="account-search" type="search" placeholder="Tìm tên, email hoặc số điện thoại" aria-label="Tìm tài khoản"><select id="account-status-filter" aria-label="Lọc trạng thái"><option value="all">Tất cả trạng thái</option><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option></select><span id="account-selected-count" class="account-selected-count">0 đã chọn</span><button id="bulk-approve" class="outline-button" type="button" disabled>Duyệt đã chọn</button><button id="bulk-reject" class="outline-button" type="button" disabled>Từ chối đã chọn</button></div>
        <div class="account-table-scroll"><table class="account-table"><thead><tr><th><input id="account-select-all" type="checkbox" aria-label="Chọn tất cả tài khoản"></th><th>TT</th><th>Tài khoản</th><th>Quyền sở hữu</th><th>Loại tài khoản</th><th>Ngày đăng ký</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody id="account-list"><tr><td colspan="8">Đang tải danh sách…</td></tr></tbody></table></div>
      </section>
    </div>`;
  document.querySelector("#add-account").addEventListener("click", () => openAddAccount());
  document.querySelector("#refresh-requests")?.addEventListener("click", loadAccountUsers);
  document.querySelector("#account-search")?.addEventListener("input", () => { selectedAccountIds.clear(); renderAccountRows(); });
  document.querySelector("#account-status-filter")?.addEventListener("change", () => { selectedAccountIds.clear(); renderAccountRows(); });
  document.querySelector("#account-select-all")?.addEventListener("change", event => {
    document.querySelectorAll("#account-list input[data-select-account]").forEach(box => {
      if (event.target.checked) selectedAccountIds.add(box.dataset.selectAccount);
      else selectedAccountIds.delete(box.dataset.selectAccount);
    });
    renderAccountRows();
  });
  document.querySelector("#bulk-approve")?.addEventListener("click", () => bulkAccountDecision(true));
  document.querySelector("#bulk-reject")?.addEventListener("click", () => bulkAccountDecision(false));
  await loadAccountUsers();
  clearInterval(accountRefreshTimer);
  accountRefreshTimer = setInterval(() => {
    if (document.querySelector("#account-list")) loadAccountUsers();
    else clearInterval(accountRefreshTimer);
  }, 10000);
}

async function showProfile() {
  const user = window.smartHomeUser?.() || {};
  const content = document.querySelector("#content");
  document.querySelector("#breadcrumb").textContent = "Tài khoản";
  const apiRoot = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
  const avatar = user.avatar_url ? `${apiRoot}${user.avatar_url}` : "assets/images/avatar/avatar-1.jpg";
  content.innerHTML = `<div class="content account-page profile-page"><div class="heading"><div><p class="eyebrow">FALLGUARD <span>/</span> TÀI KHOẢN</p><h1>Tài khoản của tôi</h1><p class="welcome-copy">Cập nhật ảnh đại diện và thông tin đăng nhập cá nhân.</p></div></div>
    <section class="panel auth-account-card"><span class="section-kicker">HỒ SƠ CÁ NHÂN</span><h2>Ảnh đại diện và thông tin</h2><form id="profile-form"><div class="profile-avatar-editor"><img id="profile-avatar-preview" src="${escapeAuthHtml(avatar)}" alt="Ảnh đại diện"><label class="button outline-button" for="profile-avatar-file">Đổi ảnh đại diện</label><input id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><small>JPG, PNG hoặc WebP · tối đa 3 MB</small></div><label>Tên hiển thị<input id="profile-name" maxlength="80" required value="${escapeAuthHtml(user.name || "")}"></label><label>Email hoặc số điện thoại đăng nhập<input value="${escapeAuthHtml(user.email || "")}" disabled></label><p id="profile-message" class="auth-form-message" role="status"></p><button class="button" type="submit">Lưu thông tin</button></form></section>
    <section class="panel auth-account-card"><span class="section-kicker">BẢO MẬT</span><h2>Đổi mật khẩu</h2><p class="muted">Mật khẩu mới tối thiểu 10 ký tự, gồm chữ và số.</p><form id="password-form"><label>Mật khẩu hiện tại<input id="current-password" type="password" autocomplete="current-password" required></label><label>Mật khẩu mới<input id="new-password" type="password" minlength="10" autocomplete="new-password" required></label><label>Xác nhận mật khẩu mới<input id="confirm-password" type="password" autocomplete="new-password" required></label><p id="password-message" class="auth-form-message" role="alert"></p><button class="button" type="submit">Cập nhật mật khẩu</button></form></section></div>`;
  const fileInput = document.querySelector("#profile-avatar-file");
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const message = document.querySelector("#profile-message");
    if (file.size > 3 * 1024 * 1024) { message.textContent = "Ảnh cần nhỏ hơn 3 MB."; fileInput.value = ""; return; }
    const preview = document.querySelector("#profile-avatar-preview");
    preview.src = URL.createObjectURL(file);
    try {
      const updated = await window.updateCurrentAvatar(file);
      preview.src = `${apiRoot}${updated.avatar_url}`;
      message.textContent = "Đã cập nhật ảnh đại diện.";
    } catch (error) { message.textContent = error.message; preview.src = avatar; }
  });
  document.querySelector("#profile-form").onsubmit = async event => {
    event.preventDefault();
    const message = document.querySelector("#profile-message");
    try { await window.updateCurrentProfile(document.querySelector("#profile-name").value.trim()); message.textContent = "Đã lưu thông tin cá nhân."; }
    catch (error) { message.textContent = error.message; }
  };
  document.querySelector("#password-form").onsubmit = async event => {
    event.preventDefault();
    const message = document.querySelector("#password-message");
    const current_password = document.querySelector("#current-password").value;
    const new_password = document.querySelector("#new-password").value;
    if (new_password !== document.querySelector("#confirm-password").value) { message.textContent = "Mật khẩu xác nhận không khớp."; return; }
    try {
      await window.authRequest("/auth/password", { method: "POST", body: JSON.stringify({ current_password, new_password }) });
      localStorage.removeItem("fallguard_access_token"); localStorage.removeItem("smart_home_user"); sessionStorage.removeItem("fallguard_signed_in"); location.reload();
    } catch (error) { message.textContent = error.message; }
  };
}

async function loadAccountRequests() {
  const host = document.querySelector("#request-list");
  if (!host) return;
  try {
    const requests = await window.authRequest("/auth/requests");
    host.innerHTML = requests.map(request => `<div class="row"><div class="icon">${escapeAuthHtml((request.name || request.email).slice(0, 1).toUpperCase())}</div><div class="account-user"><b>${escapeAuthHtml(request.name)}</b><p class="muted">${escapeAuthHtml(request.email)}</p></div><span class="status pending-status">Chờ duyệt</span><button class="button approval-button" data-approve="${escapeAuthHtml(request.id)}">Chấp nhận</button><button class="delete-camera" data-reject="${escapeAuthHtml(request.id)}" aria-label="Từ chối yêu cầu">×</button></div>`).join("") || '<div class="empty-events"><span>✓</span><p>Không có yêu cầu chờ duyệt.</p></div>';
    host.querySelectorAll("[data-approve], [data-reject]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        await window.authRequest(`/auth/users/${encodeURIComponent(button.dataset.approve || button.dataset.reject)}/approval`, {
          method: "PATCH", body: JSON.stringify({ approved: Boolean(button.dataset.approve) })
        });
        await Promise.all([loadAccountRequests(), loadAccountUsers()]);
      } catch (error) { alert(error.message); button.disabled = false; }
    });
  } catch (error) { host.textContent = error.message; }
}

let accountRows = [];
let accountRefreshTimer = null;
const selectedAccountIds = new Set();

async function bulkAccountDecision(approved) {
  const targets = accountRows.filter(user => selectedAccountIds.has(user.id) &&
    (approved ? ["pending", "rejected"].includes(user.status) : user.status === "pending"));
  if (!targets.length) return;
  if (!approved && !confirm(`Từ chối ${targets.length} tài khoản đã chọn?`)) return;
  const buttons = [document.querySelector("#bulk-approve"), document.querySelector("#bulk-reject")];
  buttons.forEach(button => { if (button) button.disabled = true; });
  try {
    for (const user of targets) {
      await window.authRequest(`/auth/users/${encodeURIComponent(user.id)}/approval`, {
        method: "PATCH", body: JSON.stringify({ approved })
      });
      selectedAccountIds.delete(user.id);
    }
    await loadAccountUsers();
  } catch (error) { alert(error.message); await loadAccountUsers(); }
}

function renderAccountRows() {
  const host = document.querySelector("#account-list");
  if (!host) return;
  const query = document.querySelector("#account-search")?.value.trim().toLowerCase() || "";
  const filter = document.querySelector("#account-status-filter")?.value || "all";
  const current = window.smartHomeUser?.() || {};
  const users = accountRows.filter(user =>
    (filter === "all" || user.status === filter) &&
    `${user.name} ${user.email}`.toLowerCase().includes(query));
  const pendingCount = accountRows.filter(user => user.status === "pending").length;
  document.querySelector("#account-count").textContent = `${users.length} tài khoản · ${pendingCount} chờ duyệt`;
  host.innerHTML = users.map((user, index) => `
    <tr class="${user.status === "pending" ? "account-pending-row" : ""}">
      <td><input type="checkbox" data-select-account="${escapeAuthHtml(user.id)}" aria-label="Chọn ${escapeAuthHtml(user.name)}" ${user.role === "admin" || user.status === "approved" ? "disabled" : ""} ${selectedAccountIds.has(user.id) ? "checked" : ""}></td>
      <td class="account-ordinal"><span class="account-online-dot"></span>${index + 1}</td>
      <td><strong>${escapeAuthHtml(user.name)}</strong><small>${escapeAuthHtml(user.email)}</small></td>
      <td>${user.role === "admin" ? "Quản trị viên" : "Người dùng"}</td>
      <td>${user.contact_type === "phone" ? "Số điện thoại" : "Email"}</td>
      <td>${user.created_at ? FallGuardTime.formatDateTime(user.created_at) : "—"}</td>
      <td><span class="account-status account-status-${escapeAuthHtml(user.status || "approved")}">${user.status === "pending" ? "Chờ duyệt" : user.status === "rejected" ? "Đã từ chối" : "Đã duyệt"}</span></td>
      <td><div class="account-actions">${user.role === "admin" ? "" : user.status === "approved" ? `<span class="account-icon-action approved" role="img" aria-label="Tài khoản đã duyệt" title="Đã duyệt"><span class="material-symbols-rounded" aria-hidden="true">verified</span></span>` : `<button class="account-icon-action approve" data-approve="${escapeAuthHtml(user.id)}" type="button" aria-label="${user.status === "rejected" ? "Duyệt lại" : "Duyệt"} tài khoản ${escapeAuthHtml(user.name)}" title="${user.status === "rejected" ? "Duyệt lại" : "Duyệt"}"><span class="material-symbols-rounded" aria-hidden="true">how_to_reg</span></button>`}${user.status === "pending" ? `<button class="account-icon-action reject" data-reject="${escapeAuthHtml(user.id)}" type="button" aria-label="Từ chối tài khoản ${escapeAuthHtml(user.name)}" title="Từ chối"><span class="material-symbols-rounded" aria-hidden="true">block</span></button>` : ""}${user.id === current.id || user.role === "admin" ? "" : `<button class="account-icon-action edit" data-edit-user="${escapeAuthHtml(user.id)}" type="button" aria-label="Sửa tài khoản ${escapeAuthHtml(user.name)}" title="Sửa"><span class="material-symbols-rounded" aria-hidden="true">edit_square</span></button><button class="account-icon-action delete" data-delete-user="${escapeAuthHtml(user.id)}" type="button" aria-label="Xóa tài khoản ${escapeAuthHtml(user.name)}" title="Xóa"><span class="material-symbols-rounded" aria-hidden="true">delete</span></button>`}</div></td>
    </tr>`).join("") || '<tr><td colspan="8" class="account-empty">Không có tài khoản phù hợp.</td></tr>';
  host.querySelectorAll("[data-approve], [data-reject]").forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      await window.authRequest(`/auth/users/${encodeURIComponent(button.dataset.approve || button.dataset.reject)}/approval`, {
        method: "PATCH", body: JSON.stringify({ approved: Boolean(button.dataset.approve) })
      });
      await loadAccountUsers();
    } catch (error) { alert(error.message); button.disabled = false; }
  });
  host.querySelectorAll("input[data-select-account]").forEach(box => box.onchange = () => {
    if (box.checked) selectedAccountIds.add(box.dataset.selectAccount);
    else selectedAccountIds.delete(box.dataset.selectAccount);
    updateBulkAccountActions();
  });
  updateBulkAccountActions();
  host.querySelectorAll("[data-edit-user]").forEach(button => button.onclick = () => {
    const user = accountRows.find(item => item.id === button.dataset.editUser);
    if (user) openAddAccount(user);
  });
  host.querySelectorAll("[data-delete-user]").forEach(button => button.onclick = async () => {
    if (!confirm("Xóa tài khoản này? Các phiên đăng nhập hiện tại sẽ bị thu hồi.")) return;
    try {
      await window.authRequest(`/auth/users/${encodeURIComponent(button.dataset.deleteUser)}`, { method: "DELETE" });
      await loadAccountUsers();
    } catch (error) { alert(error.message); }
  });
}

function updateBulkAccountActions() {
  const selected = accountRows.filter(user => selectedAccountIds.has(user.id));
  const count = document.querySelector("#account-selected-count");
  if (count) count.textContent = `${selected.length} đã chọn`;
  const approve = document.querySelector("#bulk-approve");
  const reject = document.querySelector("#bulk-reject");
  if (approve) approve.disabled = !selected.some(user => ["pending", "rejected"].includes(user.status));
  if (reject) reject.disabled = !selected.some(user => user.status === "pending");
  const all = document.querySelector("#account-select-all");
  const visible = [...document.querySelectorAll("#account-list input[data-select-account]:not(:disabled)")];
  if (all) { all.checked = visible.length > 0 && visible.every(box => box.checked); all.indeterminate = visible.some(box => box.checked) && !all.checked; }
}

async function loadAccountUsers() {
  const host = document.querySelector("#account-list");
  if (!host) return;
  try {
    accountRows = (await window.authRequest("/auth/users")).sort((a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      String(b.created_at || "").localeCompare(String(a.created_at || "")));
    for (const id of selectedAccountIds) {
      if (!accountRows.some(user => user.id === id && user.role !== "admin" && user.status !== "approved")) selectedAccountIds.delete(id);
    }
    renderAccountRows();
  } catch (error) { host.innerHTML = `<tr><td colspan="8">${escapeAuthHtml(error.message)}</td></tr>`; }
}

function openAddAccount(account = null) {
  const editing = Boolean(account);
  const modal = document.createElement("div");
  modal.className = "app-modal";
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <button class="modal-close" type="button" aria-label="Đóng">×</button><span class="section-kicker">QUẢN LÝ NGƯỜI DÙNG</span><h2 id="add-account-title">${editing ? "Sửa tài khoản" : "Cấp tài khoản"}</h2><p class="muted">${editing ? "Cập nhật thông tin đăng nhập của tài khoản." : "Tạo thông tin đăng nhập mới cho người dùng."}</p>
      <form id="add-account-form"><label>Tên hiển thị<input id="new-user-name" maxlength="80" required></label><label>Email hoặc số điện thoại<input id="new-user-email" type="text" maxlength="254" required></label><label>Vai trò<select id="new-user-role"><option value="viewer">Viewer / Gia đình</option><option value="admin">Quản trị viên</option></select></label><label>${editing ? "Mật khẩu mới (không bắt buộc)" : "Mật khẩu tạm thời"}<input id="new-user-password" type="password" minlength="10" ${editing ? "" : "required"}><small>${editing ? "Để trống nếu muốn giữ mật khẩu hiện tại." : "Tối thiểu 10 ký tự, gồm chữ và số."}</small></label><p class="auth-form-message" id="add-account-error" role="alert"></p><div class="modal-actions"><button class="modal-cancel" type="button">Hủy</button><button class="button" id="create-account-submit" type="submit">${editing ? "Lưu thay đổi" : "Cấp tài khoản"}</button></div></form>
    </div>`;
  document.body.append(modal);
  modal.querySelector("#new-user-name").value = account?.name || "";
  modal.querySelector("#new-user-email").value = account?.email || "";
  modal.querySelector("#new-user-role").value = account?.role === "admin" ? "admin" : "viewer";
  modal.querySelector("#new-user-name").focus();
  modal.querySelectorAll(".modal-close, .modal-cancel").forEach(button => button.onclick = () => modal.remove());
  modal.addEventListener("click", event => { if (event.target === modal) modal.remove(); });
  modal.querySelector("#add-account-form").onsubmit = async event => {
    event.preventDefault();
    const submit = modal.querySelector("#create-account-submit");
    const error = modal.querySelector("#add-account-error");
    submit.disabled = true;
    submit.textContent = editing ? "Đang lưu…" : "Đang tạo…";
    try {
      const payload = { name: modal.querySelector("#new-user-name").value.trim(), email: modal.querySelector("#new-user-email").value.trim(), role: modal.querySelector("#new-user-role").value };
      const password = modal.querySelector("#new-user-password").value;
      if (password) payload.password = password;
      await window.authRequest(editing ? `/auth/users/${encodeURIComponent(account.id)}` : "/auth/users", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(editing ? payload : { ...payload, password })
      });
      modal.remove();
      await Promise.all([loadAccountUsers(), loadAccountRequests()]);
    } catch (exception) {
      error.textContent = exception.message;
      submit.disabled = false;
      submit.textContent = editing ? "Lưu thay đổi" : "Cấp tài khoản";
    }
  };
}

function escapeAuthHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
