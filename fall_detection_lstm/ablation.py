"""Frame-level detector variants summarized as video-level first detections."""


def summarize_variants(predictions: list[dict]) -> dict[str, float | None]:
    first = {name: None for name in ("geometry", "lstm", "strict_agreement", "fusion")}
    for item in predictions:
        analysis = item.get("analysis") or {}
        if not analysis.get("valid_keypoint"):
            continue
        geometry = analysis.get("geometry_state") == "FALL"
        model = bool(analysis.get("lstm_supports_fall", analysis.get("lstm_consensus") and analysis.get("lstm_prediction") == "FALL"))
        decisions = {"geometry": geometry, "lstm": model,
                     "strict_agreement": geometry and model,
                     "fusion": item.get("state") == "FALL"}
        for name, detected in decisions.items():
            if detected and first[name] is None:
                first[name] = float(item["time"])
    return first
