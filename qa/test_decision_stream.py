"""Integration checks for the 40-frame model and short-stream geometry routes."""
import os
import json
from pathlib import Path
import secrets
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "fall_detection_lstm"))
os.environ["FALLGUARD_DATA_DIR"] = str(ROOT / "qa" / "runtime" / "stream-tests")
os.environ["FALLGUARD_ADMIN_PASSWORD"] = secrets.token_urlsafe(16) + "A1"
os.environ.pop("FALLGUARD_ADMIN_RESET_PASSWORD", None)
os.environ["MPLCONFIGDIR"] = str(ROOT / ".cache" / "matplotlib")
os.environ["YOLO_CONFIG_DIR"] = str(ROOT / ".cache" / "ultralytics")
import numpy as np
import torch
torch.set_num_threads(1)
from backend import main as api
from test_fall_postprocess_angle import pose


def sample(horizontal=False, drop=0):
    points = np.asarray([[x * 3 + 80, y * 3 + 40 + drop] for x, y, _ in pose(horizontal)], dtype=np.float32)
    if not horizontal:
        points[13:15] = [[215, 265 + drop], [245, 265 + drop]]
    return points


class FixedModel(torch.nn.Module):
    def __init__(self, logits):
        super().__init__()
        self.logits = logits

    def forward(self, values):
        return torch.tensor([self.logits], device=values.device)


class DecisionStreamTest(unittest.TestCase):
    def setUp(self):
        self.original = api.fall_model
        api.fall_model = FixedModel([0.0, 6.0])
        self.settings = {"geometry_confirm_seconds": 0.25, "sensitivity": 0.55,
                         "lstm_confidence_threshold": 0.75}

    def tearDown(self):
        api.fall_model = self.original

    def test_model_scores_at_frame_40_but_waits_for_floor_evidence(self):
        stream = api.FallDecisionStream(self.settings)
        for index in range(39):
            self.assertNotEqual(stream.update(sample(), np.ones(17), index / 30)["state"], "FALL")
        result = stream.update(sample(), np.ones(17), 39 / 30)
        self.assertTrue(result["analysis"]["lstm_supports_fall"])
        self.assertEqual(result["analysis"]["decision_source"], "floor_verifying")

    def test_18_frame_drop_alerts_without_lstm(self):
        stream = api.FallDecisionStream(self.settings)
        decisions = [stream.update(sample(index >= 4, 125 if index >= 4 else 0), np.ones(17), index / 30)
                     for index in range(18)]
        falls = [result for result in decisions if result["state"] == "FALL"]
        self.assertTrue(falls)
        self.assertEqual(falls[0]["analysis"]["decision_source"], "floor_fall")
        self.assertFalse(falls[0]["analysis"]["model_ready"])
        for index in range(18, 180):
            result = stream.update(sample(True, 125), np.ones(17), index / 30)
        self.assertEqual(result["analysis"]["fall_phase"], "ON_FLOOR")
        result = stream.update(sample(), np.ones(17), 180 / 30)
        self.assertEqual(result["analysis"]["floor_duration_s"], 0)

    def test_horizontal_pose_above_floor_cannot_confirm_fall(self):
        stream = api.FallDecisionStream(self.settings)
        for index in range(60):
            result = stream.update(sample(index >= 4), np.ones(17), index / 30)
            self.assertNotEqual(result["state"], "FALL")
        self.assertFalse(result["analysis"]["near_estimated_floor"])

    def test_compact_landing_requires_low_head_hips_and_loss_of_support(self):
        api.fall_model = FixedModel([0.0, 0.0])
        for controlled in (False, True):
            with self.subTest(controlled=controlled):
                stream = api.FallDecisionStream(self.settings)
                landing = sample()
                landing[:5] = [174, 275]
                landing[5:7] = [[185, 282], [195, 282]]
                landing[11:13] = [[215, 315], [245, 315]]
                landing[13:17] = [[215, 245], [245, 245], [215, 205], [245, 205]]
                if controlled:
                    landing[11:13, 1] = 245
                    landing[13:17, 1] = [270, 270, 310, 310]
                upright = sample()
                upright[1:5] = upright[0]
                for index in range(12):
                    stream.update(upright, np.ones(17), index / 30)
                for index in range(12, 20):
                    result = stream.update(landing, np.ones(17), index / 30)
                self.assertFalse(result["analysis"]["horizontal_pose"])
                self.assertEqual(result["analysis"]["verdict"] == "FALL", not controlled, result["analysis"])
                if not controlled:
                    self.assertEqual(result["analysis"]["decision_source"], "floor_compact")

    def test_trajectory_resolves_when_both_branches_are_inconclusive(self):
        api.fall_model = FixedModel([0.0, 0.0])
        stream = api.FallDecisionStream(self.settings)
        update_geometry = stream.postprocessor.update

        def inconclusive_geometry(*args):
            state = update_geometry(*args)
            return "LYING" if state == "FALL" else state

        with patch.object(stream.postprocessor, "update", side_effect=inconclusive_geometry):
            for index in range(40):
                stream.update(sample(), np.ones(17), index / 30)
            for index in range(40, 58):
                result = stream.update(sample(True, 125), np.ones(17), index / 30)
                self.assertNotEqual(result["state"], "FALL")
            for index in range(58, 65):
                result = stream.update(sample(True, 125), np.ones(17), index / 30)
            self.assertEqual(result["analysis"]["decision_source"], "floor_trajectory")
            self.assertEqual(result["analysis"]["verdict"], "FALL")

    def test_bending_waits_for_support_loss_and_cancels_on_recovery(self):
        upright = sample()
        upright[13:15] = [[215, 265], [245, 265]]
        bent = upright.copy()
        bent[[0, 5, 6]] = [[110, 245], [140, 220], [150, 230]]
        scores = np.ones(17)
        for loses_support in (False, True):
            with self.subTest(loses_support=loses_support):
                stream = api.FallDecisionStream(self.settings)
                for index in range(39):
                    stream.update(upright, scores, index / 30)
                result = stream.update(bent, scores, 39 / 30)
                self.assertEqual(result["analysis"]["decision_source"], "bend_verifying")
                self.assertTrue(result["analysis"]["lstm_supports_fall"])
                for index in range(40, 105):
                    result = stream.update(bent, scores, index / 30)
                    self.assertNotEqual(result["state"], "FALL")
                self.assertEqual(result["analysis"]["decision_source"], "bend_stable")
                next_pose = upright
                if loses_support:
                    next_pose = bent.copy()
                    next_pose[11:15, 1] += 60
                result = stream.update(next_pose, scores, 105 / 30)
                self.assertEqual(result["analysis"]["verdict"], "PENDING" if loses_support else "NO_FALL")
                if not loses_support:
                    self.assertEqual(result["analysis"]["decision_source"], "bend_recovered")

    def test_horizontal_person_is_not_rejected_for_small_height(self):
        valid, reason, _ = api.validate_person_box_and_hips(sample(True, 180), np.ones(17), (480, 640, 3))
        self.assertTrue(valid, reason)

    def test_occluded_head_can_still_use_geometry(self):
        points, scores = sample(True, 125), np.ones(17)
        scores[0] = 0
        points[0] = 0
        self.assertTrue(api.validate_upper_body_keypoints(points, scores)[0])
        stream = api.FallDecisionStream(self.settings)
        for index in range(4):
            stream.update(sample(), np.ones(17), index / 30)
        for index in range(4, 18):
            result = stream.update(points, scores, index / 30)
        self.assertEqual(result["state"], "FALL")
        self.assertFalse(result["analysis"]["model_pose_valid"])
        json.dumps(result)

    def test_low_score_is_uncertain_after_40_frames(self):
        api.fall_model = FixedModel([0.0, 0.0])
        stream = api.FallDecisionStream(self.settings)
        for index in range(40):
            result = stream.update(sample(), np.ones(17), index / 30)
        self.assertEqual(result["analysis"]["verdict"], "UNCERTAIN")

    def test_very_short_still_lying_is_uncertain(self):
        stream = api.FallDecisionStream(self.settings)
        for index in range(12):
            result = stream.update(sample(True, 180), np.ones(17), index / 30)
        self.assertEqual(result["analysis"]["verdict"], "UNCERTAIN")
        self.assertNotEqual(result["state"], "FALL")

    def test_lying_motion_does_not_alert_but_a_sustained_drop_does(self):
        stream = api.FallDecisionStream(self.settings)
        scores = np.ones(17)
        for index in range(60):
            points = sample(True)
            points[13:17, 1] += 15 * (index % 2)
            result = stream.update(points, scores, index / 30)
            self.assertNotEqual(result["state"], "FALL")
        self.assertTrue(result["analysis"]["lstm_supports_fall"])
        self.assertEqual(result["analysis"]["decision_source"], "lying_without_drop")
        for index in range(60, 75):
            result = stream.update(sample(True, 100), scores, index / 30)
        self.assertEqual(result["analysis"]["decision_source"], "lying_drop")


if __name__ == "__main__":
    unittest.main()
