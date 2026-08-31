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

    def test_model_name_is_used_when_device_name_is_ble_only(self):
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

    def test_device_name_with_unique_suffix_has_display_priority(self):
        response = build_bound_device_response(
            _Row(
                {
                    "id": 170,
                    "mac": "B0:05:F0:02:0B:B7",
                    "device_name": "QKeerL19_9527",
                    "model_name": "QKeerL19",
                }
            ),
            6,
            payload={"bleName": "QKeerL19"},
        )

        self.assertEqual(response["deviceName"], "QKeerL19_9527")
        self.assertEqual(response["name"], "QKeerL19_9527")
        self.assertEqual(response["modelName"], "QKeerL19")

    def test_device_detail_fields_are_returned_with_compatibility_aliases(self):
        response = build_bound_device_response(
            _Row(
                {
                    "id": 149,
                    "mac": "B0:06:02:25:11:B0",
                    "device_name": "QKeeRingL19",
                    "model_name": "QKeeRingL19",
                    "device_size": 7,
                    "firmware_version": "2.8.8.6Z3G",
                    "hardware_version": "603SV9.4.3",
                    "sn": "QKMOC8WY6MDA",
                }
            ),
            149,
            payload={"bleName": "HR18"},
        )

        self.assertEqual(response["deviceName"], "QKeeRingL19")
        self.assertEqual(response["bleName"], "HR18")
        self.assertEqual(response["deviceSize"], 7)
        self.assertEqual(response["ringSize"], 7)
        self.assertEqual(response["firmwareVersion"], "2.8.8.6Z3G")
        self.assertEqual(response["hardwareVersion"], "603SV9.4.3")
        self.assertEqual(response["deviceVersion"], "603SV9.4.3")
        self.assertEqual(response["version"], "603SV9.4.3")
        self.assertEqual(response["sn"], "QKMOC8WY6MDA")
        self.assertEqual(response["serialNumber"], "QKMOC8WY6MDA")


if __name__ == "__main__":
    unittest.main()
