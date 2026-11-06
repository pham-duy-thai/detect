async function showAccount() {
  const user = window.smartHomeUser?.() || {};
  const isAdmin = user.role === "admin" || user.email?.toLowerCase() === "admin@gmail.com";
  if (!isAdmin) { showProfile(); return; }
  const content = document.querySelector("#content");
  document.querySelector("#breadcrumb").textContent = "Quản lý tài khoản";
  content.innerHTML = `
    <div class="content account-page">
      <div class="heading"><div><p class="eyebrow">FALLGUARD <span>/</span> QUẢN TRỊ</p><h1>Quản lý tài khoản</h1><p class="welcome-copy">Duyệt yêu cầu, chỉnh sửa danh sách và cấp quyền truy cập cho người dùng.</p></div><button class="button" id="add-account"><span>＋</span> Cấp tài khoản</button></div>
      <section class="panel auth-account-card"><div class="account-list-head"><div><span class="section-kicker">CẦN XỬ LÝ</span><h2>Yêu cầu chờ duyệt</h2><p class="muted">Khách chỉ đăng nhập được sau khi admin chấp nhận.</p></div><button class="outline-button" id="refresh-requests" type="button">Làm mới</button></div><div id="request-list" class="rows"><span class="muted">Đang tải yêu cầu…</span></div></section>
      <section class="panel auth-account-card"><div class="account-list-head"><div><span class="section-kicker">NGƯỜI DÙNG</span><h2>Tài khoản hệ thống</h2><p class="muted">Cập nhật thông tin, cấp quyền hoặc xóa tài khoản.</p></div></div><div id="account-list" class="rows"><span class="muted">Đang tải danh sách…</span></div></section>
    </div>`;
  document.querySelector("#add-account").addEventListener("click", () => openAddAccount());
  document.querySelector("#refresh-requests")?.addEventListener("click", loadAccountRequests);
  await Promise.all([loadAccountUsers(), loadAccountRequests()]);
}

async function showProfile() {
  const user = window.smartHomeUser?.() || {};
  const content = document.querySelector("#content");
  document.querySelector("#breadcrumb").textContent = "Tài khoản";
  const apiRoot = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "");
  const avatar = user.avatar_url ? `${apiRoot}${user.avatar_url}` : "assets/images/avatar/avatar-1.jpg";
  content.innerHTML = `<div class="content account-page profile-page"><div class="heading"><div><p class="eyebrow">FALLGUARD <span>/</span> TÀI KHOẢN</p><h1>Tài khoản của tôi</h1><p class="welcome-copy">Cập nhật ảnh đại diện và thông tin đăng nhập cá nhân.</p></div></div>
    <section class="panel auth-account-card"><span class="section-kicker">HỒ SƠ CÁ NHÂN</span><h2>Ảnh đại diện và thông tin</h2><form id="profile-form"><div class="profile-avatar-editor"><img id="profile-avatar-preview" src="${escapeAuthHtml(avatar)}" alt="Ảnh đại diện"><label class="button outline-button" for="profile-avatar-file">Đổi ảnh đại diện</label><input id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><small>JPG, PNG hoặc WebP · tối đa 3 MB</small></div><label>Tên hiển thị<input id="profile-name" maxlength="80" required value="${escapeAuthHtml(user.name || "")}"></label><label>Email đăng nhập<input value="${escapeAuthHtml(user.email || "")}" disabled></label><p id="profile-message" class="auth-form-message" role="status"></p><button class="button" type="submit">Lưu thông tin</button></form></section>
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

async function loadAccountUsers() {
  const host = document.querySelector("#account-list");
  if (!host) return;
  try {
    const users = await window.authRequest("/auth/users");
    const current = window.smartHomeUser?.() || {};
    host.innerHTML = users.map(user => `
      <div class="row"><div class="icon">${escapeAuthHtml((user.name || user.email).slice(0, 1).toUpperCase())}</div><div class="account-user"><b>${escapeAuthHtml(user.name)}</b><p class="muted">${escapeAuthHtml(user.email)}</p></div><span class="status ${user.status === "pending" ? "pending-status" : ""}">${user.id === current.id ? "Bạn đang đăng nhập" : user.role === "admin" ? "Quản trị viên" : user.status === "rejected" ? "Đã từ chối" : "Viewer / Gia đình"}</span>${user.id === current.id || user.role === "admin" ? "" : `<button class="outline-button user-edit-button" data-edit-user="${escapeAuthHtml(user.id)}" type="button">Sửa</button><button class="delete-camera" data-delete-user="${escapeAuthHtml(user.id)}" title="Xóa tài khoản" aria-label="Xóa tài khoản">×</button>`}</div>`).join("") || '<p class="muted">Chưa có tài khoản nào.</p>';
    host.querySelectorAll("[data-edit-user]").forEach(button => button.onclick = () => {
      const user = users.find(item => item.id === button.dataset.editUser);
      if (user) openAddAccount(user);
    });
    host.querySelectorAll("[data-delete-user]").forEach(button => button.onclick = async () => {
      if (!confirm("Xóa tài khoản này? Các phiên đăng nhập hiện tại sẽ bị thu hồi.")) return;
      try {
        await window.authRequest(`/auth/users/${encodeURIComponent(button.dataset.deleteUser)}`, { method: "DELETE" });
        await loadAccountUsers();
      } catch (error) { alert(error.message); }
    });
  } catch (error) { host.textContent = error.message; }
}

function openAddAccount(account = null) {
  const editing = Boolean(account);
  const modal = document.createElement("div");
  modal.className = "app-modal";
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <button class="modal-close" type="button" aria-label="Đóng">×</button><span class="section-kicker">QUẢN LÝ NGƯỜI DÙNG</span><h2 id="add-account-title">${editing ? "Sửa tài khoản" : "Cấp tài khoản"}</h2><p class="muted">${editing ? "Cập nhật thông tin đăng nhập của tài khoản." : "Tạo thông tin đăng nhập mới cho người dùng."}</p>
      <form id="add-account-form"><label>Tên hiển thị<input id="new-user-name" maxlength="80" required></label><label>Email<input id="new-user-email" type="email" maxlength="254" required></label><label>Vai trò<select id="new-user-role"><option value="viewer">Viewer / Gia đình</option><option value="admin">Quản trị viên</option></select></label><label>${editing ? "Mật khẩu mới (không bắt buộc)" : "Mật khẩu tạm thời"}<input id="new-user-password" type="password" minlength="10" ${editing ? "" : "required"}><small>${editing ? "Để trống nếu muốn giữ mật khẩu hiện tại." : "Tối thiểu 10 ký tự, gồm chữ và số."}</small></label><p class="auth-form-message" id="add-account-error" role="alert"></p><div class="modal-actions"><button class="modal-cancel" type="button">Hủy</button><button class="button" id="create-account-submit" type="submit">${editing ? "Lưu thay đổi" : "Cấp tài khoản"}</button></div></form>
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
