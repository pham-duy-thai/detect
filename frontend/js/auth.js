(() => {
  const API = (window.FALLGUARD_API_BASE || (location.protocol === "https:" ? location.origin : `${location.protocol}//${location.hostname}:8000`)).replace(/\/$/, "") + "/api";
  const tokenKey = "fallguard_access_token";
  const userKey = "smart_home_user";
  const state = { token: localStorage.getItem(tokenKey), user: null };
  const apiRoot = API.replace(/\/api$/, "");

  window.smartHomeUser = () => state.user || JSON.parse(localStorage.getItem(userKey) || "null");
  window.authToken = () => state.token;
  window.authHeaders = () => state.token ? { Authorization: `Bearer ${state.token}` } : {};

  async function request(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...window.authHeaders(),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Yêu cầu không thành công.");
    return data;
  }

  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function renderAuth(register = false, notice = "", registrationOpen = false) {
    const registerNotice = register && !registrationOpen
      ? "Đăng ký công khai đang đóng vì hệ thống đã có tài khoản quản trị. Hãy đăng nhập bằng admin hoặc nhờ quản trị viên tạo tài khoản cho bạn."
      : notice;
    document.body.innerHTML = `
      <main class="cl-login01">
        <section class="cl-login01__pane">
          <a class="cl-login01__brand" href="#">FALLGUARD</a>
          <div class="cl-login01__body">
            <span class="section-kicker">GIÁM SÁT AN TOÀN THÔNG MINH</span>
            <h1 class="cl-login01__title">${register ? "Tạo tài khoản" : "Chào mừng trở lại"}</h1>
            <p class="cl-login01__sub">${register ? "Tạo tài khoản bằng email hoặc số điện thoại. Admin duyệt trước khi bạn đăng nhập." : "Đăng nhập bằng email hoặc số điện thoại đã được duyệt."}</p>
            ${registerNotice ? `<p class="cl-login01__live">${escapeHtml(registerNotice)}</p>` : ""}
            <form class="cl-login01__form" id="auth-form" novalidate>
              ${register ? `<div class="cl-login01__field"><label class="cl-login01__label" for="name">Tên hiển thị</label><input class="cl-login01__input" type="text" id="name" maxlength="80" autocomplete="name" required></div>` : ""}
              <div class="cl-login01__field"><label class="cl-login01__label" for="email">Email hoặc số điện thoại</label><input class="cl-login01__input" type="text" id="email" maxlength="254" autocomplete="username" required placeholder="ten@vidu.com hoặc 09xxxxxxxx"></div>
              <div class="cl-login01__field"><label class="cl-login01__label" for="password">Mật khẩu</label><div class="password-field"><input class="cl-login01__input" type="password" id="password" autocomplete="${register ? "new-password" : "current-password"}" required minlength="${register ? 10 : 1}" maxlength="128" placeholder="${register ? "Tối thiểu 10 ký tự, gồm chữ và số" : "Nhập mật khẩu"}"><button type="button" class="password-toggle" aria-label="Hiện mật khẩu">Hiện</button></div></div>
              ${register ? `<div class="cl-login01__field"><label class="cl-login01__label" for="confirm">Xác nhận mật khẩu</label><input class="cl-login01__input" type="password" id="confirm" autocomplete="new-password" required></div>` : ""}
              <p class="cl-login01__live" id="auth-error" role="alert" aria-live="polite"></p>
              <button class="cl-login01__submit" id="auth-submit" type="submit">${register ? "Tạo tài khoản" : "Đăng nhập"}</button>
            </form>
            <p class="cl-login01__foot">${register ? "Đã có tài khoản?" : "Chưa có tài khoản?"} ${register || registrationOpen ? `<a class="cl-login01__link" href="#" id="auth-switch">${register ? "Đăng nhập" : "Đăng ký ngay"}</a>` : `<a class="cl-login01__link" href="#" id="auth-register-closed">Đăng ký</a>`}</p>
            <p class="auth-security-note">Kết nối an toàn · FallGuard</p>
          </div>
        </section>
        <section class="cl-login01__art"><img src="login/images/summit.jpg" alt="Không gian được FallGuard giám sát"></section>
      </main>`;

    const form = document.querySelector("#auth-form");
    const error = document.querySelector("#auth-error");
    const submit = document.querySelector("#auth-submit");
    document.querySelector("#auth-switch")?.addEventListener("click", event => {
      event.preventDefault();
      renderAuth(!register, "", registrationOpen);
    });
    document.querySelector("#auth-register-closed")?.addEventListener("click", event => {
      event.preventDefault();
        renderAuth(true, "", false);
    });
    document.querySelector(".password-toggle").onclick = event => {
      const input = document.querySelector("#password");
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      event.currentTarget.textContent = visible ? "Ẩn" : "Hiện";
      event.currentTarget.setAttribute("aria-label", visible ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      error.textContent = "";
      const email = document.querySelector("#email").value.trim();
      const password = document.querySelector("#password").value;
      if (register && password !== document.querySelector("#confirm").value) {
        error.textContent = "Mật khẩu xác nhận không khớp.";
        return;
      }
      submit.disabled = true;
      submit.textContent = register ? "Đang tạo tài khoản…" : "Đang đăng nhập…";
      try {
        const result = await request(register ? "/auth/register" : "/auth/login", {
          method: "POST",
          body: JSON.stringify(register ? { email, name: document.querySelector("#name").value.trim(), password } : { email, password })
        });
        if (register && result.status === "pending") {
          renderAuth(false, result.message || "Đã gửi yêu cầu. Vui lòng chờ admin duyệt tài khoản.", registrationOpen);
          return;
        }
        state.token = result.access_token;
        state.user = result.user;
        localStorage.setItem(tokenKey, state.token);
        localStorage.setItem(userKey, JSON.stringify(state.user));
        sessionStorage.setItem("fallguard_signed_in", "true");
        location.reload();
      } catch (exception) {
        error.textContent = exception.message;
      } finally {
        submit.disabled = false;
        submit.textContent = register ? "Tạo tài khoản" : "Đăng nhập";
      }
    };
  }

  async function initialize() {
    if (!state.token) {
      try {
        const config = await request("/auth/config");
        renderAuth(false, config.registration_open ? "Chưa có tài khoản? Đăng ký và chờ quản trị viên duyệt để đăng nhập." : "", config.registration_open);
      } catch {
        renderAuth(false, "Không kết nối được máy chủ. Hãy kiểm tra backend rồi thử lại.");
      }
      return;
    }
    if (sessionStorage.getItem("fallguard_signed_in") !== "true") {
      try {
        const config = await request("/auth/config");
        renderAuth(false, "Vui lòng đăng nhập để tiếp tục.", config.registration_open);
      } catch {
        renderAuth(false, "Không kết nối được máy chủ. Hãy kiểm tra backend rồi thử lại.");
      }
      return;
    }
    try {
      state.user = await request("/auth/me");
      const isAdminAccount = state.user.role === "admin" || state.user.email?.toLowerCase() === "admin@gmail.com";
      state.user.role = isAdminAccount ? "admin" : (state.user.role || "guest");
      localStorage.setItem(userKey, JSON.stringify(state.user));
      const name = document.querySelector(".user b");
      const email = document.querySelector(".user small");
      if (name) name.textContent = state.user.name;
      if (email) email.textContent = isAdminAccount ? "Quản trị viên" : "Viewer / Gia đình";
      const headerName = document.querySelector(".header-user-name");
      if (headerName) headerName.textContent = state.user.name || state.user.email;
      const headerRole = document.querySelector(".header-user-role");
      if (headerRole) headerRole.textContent = isAdminAccount ? "Quản trị viên" : "Viewer / Gia đình";
      const managerLink = document.querySelector('[data-page="account"]');
      if (managerLink) managerLink.hidden = !isAdminAccount;
      document.querySelectorAll('[data-page="ai-config"], [data-page="contacts"], [data-page="statistics"], [data-page="security"]').forEach(link => { link.hidden = !isAdminAccount; });
      const avatarUrl = state.user.avatar_url ? `${apiRoot}${state.user.avatar_url}` : "assets/images/avatar/avatar-1.jpg";
      document.querySelectorAll(".user img, .header-account img").forEach(image => { image.src = avatarUrl; });
      const authenticated = () => window.dispatchEvent(new CustomEvent("fallguard:authenticated", { detail: state.user }));
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", authenticated, { once: true });
      else authenticated();
    } catch {
      state.token = null;
      state.user = null;
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(userKey);
      sessionStorage.removeItem("fallguard_signed_in");
      try {
        const config = await request("/auth/config");
        renderAuth(false, "Phiên đã hết hạn. Vui lòng đăng nhập lại.", config.registration_open);
      } catch { renderAuth(false, "Không kết nối được máy chủ."); }
    }
  }

  window.authRequest = request;
  window.updateCurrentProfile = async name => {
    const user = await request("/auth/me", { method: "PATCH", body: JSON.stringify({ name }) });
    state.user = user;
    localStorage.setItem(userKey, JSON.stringify(user));
    const nameNode = document.querySelector(".user b");
    const headerName = document.querySelector(".header-user-name");
    if (nameNode) nameNode.textContent = user.name;
    if (headerName) headerName.textContent = user.name;
    return user;
  };
  window.updateCurrentAvatar = async file => {
    const form = new FormData();
    form.append("file", file);
    const user = await request("/auth/avatar", { method: "POST", body: form });
    state.user = user;
    localStorage.setItem(userKey, JSON.stringify(user));
    const avatarUrl = `${apiRoot}${user.avatar_url}`;
    document.querySelectorAll(".user img, .header-account img").forEach(image => { image.src = avatarUrl; });
    return user;
  };
  window.logout = async () => {
    try { if (state.token) await request("/auth/logout", { method: "POST" }); } catch { /* Session may already be expired. */ }
    state.token = null;
    state.user = null;
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    sessionStorage.removeItem("fallguard_signed_in");
    location.reload();
  };
  initialize();
})();
