"""Select a fixed v2 operating point using validation evidence only."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / "qa/reports/benchmark-csv-val-keypoint-v2.json"
    report = json.loads(source.read_text(encoding="utf-8"))
    if report["split"] != "val" or report["errors"]:
        raise ValueError("Calibration requires a complete validation report")
    trials = []
    for threshold in (0.55, 0.65, 0.75, 0.85, 0.9, 0.95):
        for hold in (0.2, 0.25, 0.35, 0.5):
            tp = fp = tn = fn = 0
            for row in report["videos"]:
                model = row["max_lstm_fall_score"] is not None and row["max_lstm_fall_score"] >= threshold
                geometry = row["max_qualified_horizontal_duration_s"] >= hold
                detected = model or geometry
                if row["label"] == "Fall":
                    tp += detected; fn += not detected
                else:
                    fp += detected; tn += not detected
            trials.append({"lstm_confidence_threshold": threshold, "geometry_confirm_seconds": hold,
                           "tp": tp, "fp": fp, "tn": tn, "fn": fn,
                           "recall": tp / (tp + fn), "precision": tp / (tp + fp) if tp + fp else 0,
                           "f1": 2 * tp / (2 * tp + fp + fn)})
    trials.sort(key=lambda item: (item["f1"], item["precision"], item["geometry_confirm_seconds"]), reverse=True)
    result = {"split": "val", "selection_metric": "clip-level F1", "chosen": trials[0], "trials": trials,
              "note": "Replay calibration from recorded evidence; verify the chosen point in the production stream before testing."}
    output = ROOT / "qa/reports/keypoint-v2-calibration.json"
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"chosen": result["chosen"], "top_five": trials[:5]}, indent=2))


if __name__ == "__main__":
    main()
