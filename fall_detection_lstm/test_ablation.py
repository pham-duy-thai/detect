import unittest

from ablation import summarize_variants
from evaluate_falls import evaluate


class AblationTest(unittest.TestCase):
    def test_first_detection_for_each_variant(self):
        frames = [
            {"time": 1, "state": "FALL", "analysis": {"valid_keypoint": True,
             "geometry_state": "FALL", "lstm_consensus": False}},
            {"time": 2, "state": "FALL", "analysis": {"valid_keypoint": True,
             "geometry_state": "FALL", "lstm_consensus": True,
             "lstm_prediction": "FALL"}},
        ]
        self.assertEqual(summarize_variants(frames),
                         {"geometry": 1.0, "lstm": 2.0,
                          "strict_agreement": 2.0, "fusion": 1.0})

    def test_video_level_metrics(self):
        positive = {"label": "FALL", "fall_time_s": 1,
                    "result": {"duration": 10, "analysis_summary": {
                        "ablation_first_detection_s": {name: 2 for name in
                            ("geometry", "lstm", "strict_agreement", "fusion")}}}}
        negative = {"label": "NO_FALL", "result": {"duration": 10,
                    "analysis_summary": {"ablation_first_detection_s": {
                        "geometry": None, "lstm": 3,
                        "strict_agreement": None, "fusion": None}}}}
        metrics = evaluate([positive, negative])
        self.assertEqual(metrics["fusion"]["recall"], 1)
        self.assertEqual(metrics["fusion"]["mean_detection_delay_s"], 1)
        self.assertEqual(metrics["lstm"]["precision"], 0.5)


if __name__ == "__main__":
    unittest.main()
