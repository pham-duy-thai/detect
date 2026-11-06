(() => {
  const TIME_ZONE = "Asia/Ho_Chi_Minh";
  const numericTimestamp = value => typeof value === "number" || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()));

  function parseTimestamp(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (value == null || value === "") return null;

    let date;
    if (numericTimestamp(value)) {
      let epoch = Number(value);
      if (!Number.isFinite(epoch)) return null;
      if (Math.abs(epoch) < 100_000_000_000) epoch *= 1000;
      date = new Date(epoch);
    } else {
      let text = String(value).trim();
      const isoDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text);
      const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
      if (isoDateTime && !hasZone) text = `${text.replace(" ", "T")}Z`;
      date = new Date(text);
    }
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value, options = {}) {
    const date = parseTimestamp(value);
    return date ? date.toLocaleString("vi-VN", { timeZone: TIME_ZONE, ...options }) : "—";
  }

  function formatTime(value) {
    return formatDateTime(value, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatTimeAgo(value, now = Date.now()) {
    const date = parseTimestamp(value);
    if (!date) return "—";
    const seconds = Math.floor((Number(now) - date.getTime()) / 1000);
    if (!Number.isFinite(seconds)) return "—";
    if (seconds < -5) return "Sắp tới";
    if (seconds <= 5) return "Vừa xong";
    if (seconds < 60) return `${seconds} giây trước`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
    if (seconds < 2_592_000) return `${Math.floor(seconds / 86400)} ngày trước`;
    if (seconds < 31_536_000) return `${Math.floor(seconds / 2_592_000)} tháng trước`;
    return `${Math.floor(seconds / 31_536_000)} năm trước`;
  }

  window.FallGuardTime = Object.freeze({ parseTimestamp, formatDateTime, formatTime, formatTimeAgo, timeZone: TIME_ZONE });
})();
