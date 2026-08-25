from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from app.api.app import estimate_hrv_proxy_display


class HrvProxyDisplayTests(unittest.TestCase):
    def test_dense_low_activity_bpm_returns_display_only_proxy(self):
        start = datetime(2026, 8, 20, 8, 0, 0)
        bpm_values = [68, 70, 67, 71, 69, 72, 68, 70, 66, 71, 69]
        rows = [
            {
                "record_time": start + timedelta(seconds=index * 30),
                "heart_rate": bpm,
                "motion_intensity": 0,
                "sleep_state": 0,
            }
            for index, bpm in enumerate(bpm_values)
        ]

        result = estimate_hrv_proxy_display(rows)

        self.assertEqual(result["displayMode"], "proxy")
        self.assertEqual(result["hrvSource"], "bpm_proxy")
        self.assertGreaterEqual(result["proxyQuality"], 50)
        self.assertGreater(result["proxyMs"], 0)
        self.assertIn("仅供参考", result["tips"])
        self.assertNotIn("chartData", result)

    def test_sparse_bpm_is_rejected(self):
        start = datetime(2026, 8, 20, 8, 0, 0)
        rows = [
            {
                "record_time": start + timedelta(minutes=index * 5),
                "heart_rate": 70 + index % 2,
                "motion_intensity": 0,
                "sleep_state": 0,
            }
            for index in range(12)
        ]

        result = estimate_hrv_proxy_display(rows)

        self.assertEqual(result["displayMode"], "empty")
        self.assertEqual(result["hrvSource"], "none")
        self.assertEqual(result["proxyQuality"], 0)

    def test_active_window_is_not_estimated(self):
        start = datetime(2026, 8, 20, 8, 0, 0)
        rows = [
            {
                "record_time": start + timedelta(seconds=index * 30),
                "heart_rate": 120 + index % 3,
                "motion_intensity": 3,
                "sleep_state": 0,
            }
            for index in range(12)
        ]

        result = estimate_hrv_proxy_display(rows)

        self.assertEqual(result["displayMode"], "empty")
        self.assertEqual(result["emptyReason"], "active_window")


if __name__ == "__main__":
    unittest.main()
