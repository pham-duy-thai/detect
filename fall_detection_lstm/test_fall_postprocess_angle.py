import unittest

from fall_postprocess import FallPostProcessor


def pose(horizontal=False):
    points = [[50.0, 50.0, 1.0] for _ in range(17)]
    if horizontal:
        points[5], points[6] = [20, 50, 1], [20, 55, 1]
        points[11], points[12] = [80, 50, 1], [80, 55, 1]
        points[0] = [10, 50, 1]
        points[15], points[16] = [90, 50, 1], [90, 55, 1]
    else:
        points[5], points[6] = [45, 20, 1], [55, 20, 1]
        points[11], points[12] = [45, 60, 1], [55, 60, 1]
        points[0] = [50, 10, 1]
        points[15], points[16] = [45, 90, 1], [55, 90, 1]
    return points


class RapidTiltTest(unittest.TestCase):
    def test_drop_and_rotation_confirm_before_40_frames(self):
        detector = FallPostProcessor(lying_duration_s=0.25, velocity_threshold=0.6)
        fallen = [[x, y + 60, score] for x, y, score in pose(horizontal=True)]
        detector.update(pose(), 0.0)
        detector.update(pose(), 0.1)
        self.assertEqual(detector.update(fallen, 0.2), "LYING")
        self.assertEqual(detector.update(fallen, 0.3), "LYING")
        self.assertEqual(detector.update(fallen, 0.4), "LYING")
        self.assertEqual(detector.update(fallen, 0.5), "FALL")

    def test_horizontal_without_transition_is_not_fall(self):
        detector = FallPostProcessor(lying_duration_s=1.5, velocity_threshold=100)
        detector.update(pose(horizontal=True), 0.0)
        self.assertEqual(detector.update(pose(horizontal=True), 1.6), "LYING")
        self.assertFalse(detector.last_rapid_tilt)

    def test_rotation_without_descent_does_not_alert(self):
        detector = FallPostProcessor(lying_duration_s=0.25, velocity_threshold=100)
        detector.update(pose(), 0.0)
        detector.update(pose(horizontal=True), 1.0)
        detector.update(pose(horizontal=True), 1.3)
        self.assertEqual(detector.update(pose(horizontal=True), 1.6), "LYING")
        self.assertFalse(detector.fall_latched)

    def test_camera_gap_discards_old_transition(self):
        detector = FallPostProcessor(lying_duration_s=0.25)
        detector.update(pose(), 0.0)
        detector.update(pose(), 0.1)
        fallen = [[x, y + 60, score] for x, y, score in pose(horizontal=True)]
        detector.update(fallen, 0.2)
        detector.update(fallen, 3.0)
        detector.update(fallen, 3.2)
        self.assertEqual(detector.update(fallen, 3.4), "LYING")


if __name__ == "__main__":
    unittest.main()
