from __future__ import annotations

import unittest

from app.api.app import build_bound_device_response, clean_device_text


class _Row:
    def __init__(self, mapping: dict):
        self._mapping = mapping


class DeviceIdentityDisplayTests(unittest.TestCase):
    def test_complete_wrapping_quotes_are_removed(self):
        self.assertEqual(clean_device_text('  "HR18"  '), "HR18")
        self.assertEqual(clean_device_text("'B0:06:02:25:11:B0'"), "B0:06:02:25:11:B0")
        self.assertEqual(clean_device_text("“轻刻智能戒指”"), "轻刻智能戒指")
        self.assertEqual(clean_device_text('HR"18'), 'HR"18')

    def test_ble_name_is_not_used_as_user_facing_name(self):
        response = build_bound_device_response(
            _Row(
                {
                    "id": 1,
                    "mac": '"B0:06:02:25:11:B0"',
                    "device_name": '"HR18"',
                    "model_name": None,
                }
            ),
            149,
            payload={"bleName": '"HR18"'},
        )

        self.assertEqual(response["deviceName"], "轻刻智能戒指")
        self.assertEqual(response["name"], "轻刻智能戒指")
        self.assertEqual(response["bleName"], "HR18")
        self.assertEqual(response["mac"], "B0:06:02:25:11:B0")

    def test_model_name_has_display_priority(self):
        response = build_bound_device_response(
            _Row(
                {
                    "id": 2,
                    "mac": "B0:05:F0:00:05:D7",
                    "device_name": "HR18",
                    "model_name": '"轻刻智能戒指 L19"',
                }
            ),
            6,
            payload={"bleName": "HR18"},
        )

        self.assertEqual(response["deviceName"], "轻刻智能戒指 L19")
        self.assertEqual(response["productName"], "轻刻智能戒指 L19")
        self.assertEqual(response["bleName"], "HR18")


if __name__ == "__main__":
    unittest.main()
