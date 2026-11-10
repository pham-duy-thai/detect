const content = document.querySelector("#content");
const mobileMenuButtons = document.querySelectorAll("#menu, .mobile-menu-button");
const mobileMenuScrim = document.querySelector(".mobile-menu-scrim");
const mobileSidebar = document.querySelector("#sidebar");
const mobileMenuLayout = window.matchMedia("(max-width: 56.25rem)");
let menuTrigger;

function setMobileMenu(open, restoreFocus = false) {
  mobileSidebar.classList.toggle("open", open);
  mobileSidebar.inert = mobileMenuLayout.matches && !open;
  mobileMenuScrim.hidden = !open;
  mobileMenuButtons.forEach(button => button.setAttribute("aria-expanded", String(open)));
  if (open) document.querySelector("#close").focus();
  else if (restoreFocus) menuTrigger?.focus();
}
const pageNames = {
  dashboard: "Tổng quan", devices: "Camera & thiết bị", statistics: "Thống kê",
  security: "Bảo mật", account: "Quản lý tài khoản", profile: "Tài khoản",
  messages: "Quản lý sự cố", settings: "Cài đặt", "ai-config": "Cấu hình AI & vùng", contacts: "Liên hệ khẩn cấp"
};

function stopActiveWebcams() {
  if (typeof webcamStreams === "undefined") return;
  for (const [id, item] of webcamStreams) {
    if (!item) continue;
    item.stream.getTracks().forEach(track => track.stop());
    clearInterval(item.timer);
    webcamStreams.delete(id);
  }
}

function navigate(type, link) {
  document.querySelectorAll(".header-popup").forEach(popup => popup.remove());
  document.querySelector(".header-bell")?.setAttribute("aria-expanded", "false");
  document.querySelectorAll("[data-page]").forEach(item => {
    const active = item.dataset.page === type && Boolean(item.closest(".sidebar, .mobile-nav"));
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.querySelector("#breadcrumb").textContent = pageNames[type] || type;
  setMobileMenu(false);
  if (type !== "devices") stopActiveWebcams();
  if (type === "dashboard") renderDashboard();
  else if (type === "devices") loadCameras();
  else if (type === "messages") showIncidents();
  else if (type === "account") showAccount();
  else if (type === "profile") showProfile();
  else if (type === "ai-config") showAIConfig();
  else if (type === "contacts") showEmergencyContacts();
  else if (type === "settings") window.openSettings?.();
  else if (type === "statistics" || type === "security") loadAnalyticsPage(type);
  else content.innerHTML = '<div class="content"><div class="offline-box">Trang này chưa được triển khai.</div></div>';
}

document.addEventListener("click", event => {
  const link = event.target.closest("[data-page]");
  if (!link) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  navigate(link.dataset.page, link);
}, true);

mobileMenuButtons.forEach(button => button.addEventListener("click", () => {
  menuTrigger = button;
  setMobileMenu(true);
}));
document.querySelector("#close").onclick = () => setMobileMenu(false, true);
mobileMenuScrim.onclick = () => setMobileMenu(false, true);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !mobileMenuScrim.hidden) setMobileMenu(false, true);
});
mobileMenuLayout.addEventListener("change", () => setMobileMenu(false));
setMobileMenu(false);
if (window.smartHomeUser?.()) navigate("dashboard", document.querySelector('[data-page="dashboard"]'));
window.addEventListener("fallguard:authenticated", () => navigate("dashboard", document.querySelector('[data-page="dashboard"]')));
