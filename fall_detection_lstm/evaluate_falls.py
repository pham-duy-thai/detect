"""Evaluate video-level ablations from labeled /api/analyze-video responses.

Input JSON is a list of {label, fall_time_s, result}, where result is the full
API response for that video. label is FALL or NO_FALL; fall_time_s is required
for FALL. Videos should be held out by person or original recording.
"""

import argparse
import json
from pathlib import Path


VARIANTS = ("geometry", "lstm", "strict_agreement", "fusion")


def evaluate(rows: list[dict]) -> dict:
    if not rows:
        raise ValueError("No labeled videos")
    output = {}
    for variant in VARIANTS:
        tp = fp = tn = fn = 0
        delays = []
        negative_hours = 0.0
        for row in rows:
            label = row["label"]
            if label not in {"FALL", "NO_FALL"}:
                raise ValueError(f"Invalid label: {label}")
            result = row["result"]
            detected_at = result["analysis_summary"]["ablation_first_detection_s"][variant]
            if label == "FALL":
                fall_time = float(row["fall_time_s"])
                if detected_at is not None and float(detected_at) >= fall_time:
                    tp += 1
                    delays.append(float(detected_at) - fall_time)
                else:
                    fn += 1
            else:
                negative_hours += float(result["duration"]) / 3600
                if detected_at is None:
                    tn += 1
                else:
                    fp += 1
        output[variant] = {
            "tp": tp, "fp": fp, "tn": tn, "fn": fn,
            "recall": tp / (tp + fn) if tp + fn else None,
            "precision": tp / (tp + fp) if tp + fp else None,
            "false_positive_video_rate": fp / (fp + tn) if fp + tn else None,
            "mean_detection_delay_s": sum(delays) / len(delays) if delays else None,
        }
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(json.dumps(evaluate(json.loads(args.manifest.read_text(encoding="utf-8"))),
                     indent=2, ensure_ascii=False))
