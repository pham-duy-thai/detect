"""Explainable fusion of temporal pose evidence and an optional LSTM vote."""

from dataclasses import dataclass


@dataclass(frozen=True)
class FallVerdict:
    state: str
    verdict: str
    source: str
    reason: str


def decide_fall(*, geometry_state: str, horizontal: bool, rapid_tilt: bool,
                rapid_descent: bool, transition_descent: bool, horizontal_motion: bool,
                model_ready: bool, model_consensus: bool,
                model_predicts_fall: bool | None, model_confident: bool = True,
                geometry_ready: bool = True) -> FallVerdict:
    """Use the 40-frame model directly, with temporal geometry as fallback.

    model_consensus is retained for baseline comparisons; it does not veto a
    confident current LSTM decision. Geometry must confirm its own temporal
    transition before it can alert, even if the LSTM has fewer than 40 frames.
    """
    geometry_fall = geometry_state == "FALL"
    if model_ready and model_confident and model_predicts_fall:
        return FallVerdict("FALL", "FALL", "lstm_geometry" if geometry_fall else "lstm",
                           "Confident LSTM fall prediction from 40 valid keypoint frames.")
    if geometry_fall:
        return FallVerdict("FALL", "FALL", "geometry_fallback",
                           "Descent and posture transition confirmed over several frames.")
    if rapid_tilt or rapid_descent:
        return FallVerdict("VERIFYING_FALL", "PENDING", "transition",
                           "Rapid movement observed; checking the resulting posture.")
    if horizontal:
        return FallVerdict("LYING", "UNCERTAIN", "geometry_pending",
                           "Horizontal posture without enough observed transition evidence.")
    if model_ready and model_confident and model_predicts_fall is False:
        return FallVerdict(geometry_state, "NO_FALL", "lstm_no_fall",
                           "LSTM and current motion do not indicate a fall.")
    if model_ready:
        return FallVerdict("UNCERTAIN", "UNCERTAIN", "model_uncertain",
                           "LSTM score is below the decision threshold; geometry has not confirmed a fall.")
    if not geometry_ready:
        return FallVerdict("WARMING_UP" if geometry_state == "NORMAL" else geometry_state,
                           "PENDING", "warming_up", "Waiting for enough motion observations.")
    return FallVerdict(geometry_state, "NO_FALL", "geometry_normal",
                       "Observed keypoint motion does not form a fall transition.")


def summarize_clip(predictions: list[dict]) -> tuple[str, str]:
    """Close an uploaded clip with a fall only when a frame confirmed one."""
    analyses = [item.get("analysis", {}) for item in predictions if item.get("analysis", {}).get("valid_keypoint")]
    fall = next((item for item in analyses if item.get("verdict") == "FALL"), None)
    if fall:
        return "FALL", fall.get("reason", "Đã xác nhận chuỗi keypoint ngã.")
    if not analyses:
        return "NO_FALL", "Không có dấu hiệu ngã được ghi nhận. Video không có keypoint hợp lệ để đánh giá."
    return "NO_FALL", "Video đã kết thúc. Không có dấu hiệu ngã được xác nhận."
