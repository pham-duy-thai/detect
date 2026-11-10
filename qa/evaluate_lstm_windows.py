"""Evaluate the saved LSTM on the existing held-out sequence file."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "fall_detection_lstm"
sys.path.insert(0, str(PROJECT))
import numpy as np
import torch
from lstm_model import LSTMClassifier


def main():
    torch.set_num_threads(1)
    checkpoint = PROJECT / "lstm_fall_model_fallandnofall.pth"
    model = LSTMClassifier(3, 64, 2)
    model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
    model.eval()
    data = np.load(PROJECT / "csv_sequences" / "test.npz")
    x, y = data["X"], data["y"]
    confusion = np.zeros((2, 2), dtype=int)
    with torch.no_grad():
        for start in range(0, len(x), 256):
            predicted = model(torch.as_tensor(x[start:start + 256], dtype=torch.float32)).argmax(1).numpy()
            np.add.at(confusion, (y[start:start + 256], predicted), 1)
    tn, fp, fn, tp = (int(confusion[0, 0]), int(confusion[0, 1]), int(confusion[1, 0]), int(confusion[1, 1]))
    report = {"evaluation_unit": "40-frame windows, not fall events", "windows": len(y),
              "tn": tn, "fp": fp, "fn": fn, "tp": tp,
              "accuracy": (tp + tn) / len(y), "recall": tp / (tp + fn),
              "precision": tp / (tp + fp) if tp + fp else None,
              "checkpoint_sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
              "limitations": "Existing test.npz provenance is not independently verified; overlapping windows are correlated."}
    output = ROOT / "qa" / "reports" / "lstm-windows.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
