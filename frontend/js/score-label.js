window.FallGuardScore = Object.freeze({
  label(item) {
    if (item?.source === "manual" || item?.camera_id === "manual") return "Cảnh báo thủ công";
    const score = Number(item?.confidence);
    if (!Number.isFinite(score)) return "Chưa có điểm đánh giá";
    const percent = `${(Math.max(0, Math.min(1, score)) * 100).toFixed(0)}%`;
    if (item?.confidence_kind === "pose_keypoint_quality") return `Chất lượng keypoint ${percent}`;
    if (item?.confidence_kind === "lstm_score") return `Điểm LSTM ${percent}`;
    return "Điểm cũ: chưa rõ loại";
  }
});
