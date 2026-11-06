const content = document.querySelector("#content");
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
  document.querySelectorAll("[data-page]").forEach(item => item.classList.toggle("active", item === link));
  document.querySelector("#breadcrumb").textContent = pageNames[type] || type;
  document.querySelector("#sidebar")?.classList.remove("open");
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

document.querySelector("#menu").onclick = () => document.querySelector("#sidebar").classList.add("open");
document.querySelector("#close").onclick = () => document.querySelector("#sidebar").classList.remove("open");
if (window.smartHomeUser?.()) navigate("dashboard", document.querySelector('[data-page="dashboard"]'));
window.addEventListener("fallguard:authenticated", () => navigate("dashboard", document.querySelector('[data-page="dashboard"]')));
