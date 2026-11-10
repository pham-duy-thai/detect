import unittest

from fall_fusion import decide_fall, summarize_clip


def decision(**overrides):
    values = dict(geometry_state="NORMAL", horizontal=False, rapid_tilt=False,
                  rapid_descent=False, transition_descent=False, horizontal_motion=False, model_ready=False,
                  model_consensus=False, model_predicts_fall=None)
    values.update(overrides)
    return decide_fall(**values)


class FusionTest(unittest.TestCase):
    def test_strong_pose_transition_does_not_wait_for_lstm(self):
        result = decision(geometry_state="FALL", horizontal=True, rapid_tilt=True,
                          transition_descent=True)
        self.assertEqual((result.state, result.source), ("FALL", "geometry_fallback"))

    def test_confirmed_temporal_geometry_does_not_need_40_frames(self):
        self.assertEqual(decision(geometry_state="FALL", horizontal=True).state, "FALL")
        self.assertEqual(decision(geometry_state="FALL", horizontal=True, model_ready=True,
                                  model_consensus=True, model_predicts_fall=True).state, "FALL")

    def test_confident_40_frame_model_can_alert_without_geometry(self):
        self.assertEqual(decision(model_ready=True, model_consensus=True,
                                  model_predicts_fall=True).state, "FALL")
        self.assertEqual(decision(model_ready=True, model_consensus=False,
                                  model_predicts_fall=True).source, "lstm")

    def test_low_score_does_not_alert(self):
        self.assertEqual(decision(model_ready=True, model_predicts_fall=True,
                                  model_confident=False).verdict, "UNCERTAIN")

    def test_short_stream_cannot_use_a_model_vote(self):
        self.assertNotEqual(decision(model_ready=False, model_predicts_fall=True).state, "FALL")

    def test_lying_without_transition_does_not_raise_alert(self):
        self.assertEqual(decision(geometry_state="LYING", horizontal=True).state, "LYING")

    def test_rapid_transition_stays_pending_until_posture_confirmed(self):
        self.assertEqual(decision(rapid_tilt=True).state, "VERIFYING_FALL")

    def test_video_keeps_unresolved_evidence_uncertain(self):
        predictions = [{"analysis": {"valid_keypoint": True, "verdict": "PENDING", "reason": "Đang xác minh."}} for _ in range(18)]
        self.assertEqual(summarize_clip(predictions)[0], "UNCERTAIN")

    def test_any_confirmed_fall_is_preserved_at_end(self):
        predictions = [{"analysis": {"valid_keypoint": True, "verdict": value}} for value in ("FALL", "NO_FALL")]
        self.assertEqual(summarize_clip(predictions)[0], "FALL")


if __name__ == "__main__":
    unittest.main()
