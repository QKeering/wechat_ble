import unittest
from datetime import datetime

from app.api import app as app_api


class _FakeMappingsResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeRow:
    def __init__(self, mapping):
        self._mapping = mapping


class _FakeDb:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, *_args, **_kwargs):
        return _FakeMappingsResult(self.rows)


class _FakeRawDb:
    def __init__(self, field_values):
        self.field_values = field_values

    def execute(self, query, *_args, **_kwargs):
        query_text = str(query)
        for field, values in self.field_values.items():
            if f"{field} as value" in query_text:
                rows = [
                    _FakeRow({
                        "record_time": datetime(2026, 7, 18, 8, index),
                        "device_mac": "3E:00:00:00:05:1B",
                        "value": value,
                    })
                    for index, value in enumerate(values)
                ]
                return _FakeMappingsResult(rows)
        return _FakeMappingsResult([])


class RwSleepRawFallbackTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"record_time": datetime(2026, 7, 18, 22, 0), "sleep_state": 3},
            {"record_time": datetime(2026, 7, 18, 22, 5), "sleep_state": 4},
            {"record_time": datetime(2026, 7, 18, 22, 15), "sleep_state": 1},
        ]
        self.db = _FakeDb(self.rows)

    def test_raw_sleep_chart_uses_health_raw_sleep_state(self):
        chart = app_api.raw_sleep_chart_data(self.db, 6, "2026-07-18")

        self.assertEqual(
            chart,
            [
                {"time": "22:00", "value": "5", "sleepType": "LIGHT"},
                {"time": "22:05", "value": "10", "sleepType": "DEEP"},
                {"time": "22:15", "value": "5", "sleepType": "AWAKE"},
            ],
        )

    def test_raw_sleep_time_range_is_derived_from_sleeping_states(self):
        start_time, end_time = app_api.raw_sleep_time_range(self.db, 6, "2026-07-18")

        self.assertEqual((start_time, end_time), ("22:00", "22:15"))

    def test_effective_sleep_values_falls_back_to_health_raw(self):
        values = app_api.effective_sleep_values(self.db, 6, "2026-07-18", records=[])

        self.assertEqual(values["LIGHT"], 5)
        self.assertEqual(values["DEEP"], 10)
        self.assertEqual(values["AWAKE"], 5)

    def test_summary_steps_falls_back_to_health_raw_step_count(self):
        db = _FakeDb([
            _FakeRow({"record_time": datetime(2026, 7, 18, 18, 0), "device_mac": "3E:00:00:00:05:1B", "value": 1793}),
            _FakeRow({"record_time": datetime(2026, 7, 18, 20, 0), "device_mac": "3E:00:00:00:05:1B", "value": 3543}),
        ])

        self.assertEqual(app_api.summary_steps_or_raw(db, 6, "2026-07-18", {}), 3543)
        self.assertEqual(app_api.summary_steps_or_raw(db, 6, "2026-07-18", {"totalSteps": 1200}), 1200)

    def test_vital_sign_payload_falls_back_to_health_raw_metrics(self):
        original_daily_summary = app_api.daily_summary
        app_api.daily_summary = lambda *_args, **_kwargs: {}
        try:
            payload = app_api.build_vital_sign_payload(
                _FakeRawDb({
                    "heart_rate": [76, 80],
                    "spo2": [97, 99],
                    "hrv": [26, 28],
                    "temperature": [36.4],
                    "stress": [27],
                }),
                6,
                "2026-07-18",
            )
        finally:
            app_api.daily_summary = original_daily_summary

        self.assertEqual(payload["heartRate"], 78)
        self.assertEqual(payload["heartRateAvg"], 78)
        self.assertEqual(payload["spo2"], 98)
        self.assertEqual(payload["spo2Avg"], 98)
        self.assertEqual(payload["hrv"], 27)
        self.assertEqual(payload["hrvAvg"], 27)
        self.assertEqual(payload["hrvMin"], 26)
        self.assertEqual(payload["hrvMax"], 28)
        self.assertEqual(payload["temperatureAvg"], 36.4)
        self.assertEqual(payload["stressAvg"], 27)

    def test_vital_sign_payload_keeps_existing_summary_values(self):
        original_daily_summary = app_api.daily_summary
        app_api.daily_summary = lambda *_args, **_kwargs: {
            "heartRateAvg": 66,
            "spo2Avg": 99,
            "hrvAvg": 45,
            "hrvMin": 40,
            "hrvMax": 50,
        }
        try:
            payload = app_api.build_vital_sign_payload(
                _FakeRawDb({
                    "heart_rate": [76, 80],
                    "spo2": [97, 98],
                    "hrv": [26, 28],
                }),
                6,
                "2026-07-18",
            )
        finally:
            app_api.daily_summary = original_daily_summary

        self.assertEqual(payload["heartRate"], 66)
        self.assertEqual(payload["spo2"], 99)
        self.assertEqual(payload["hrv"], 45)
        self.assertEqual(payload["hrvMin"], 40)
        self.assertEqual(payload["hrvMax"], 50)


if __name__ == "__main__":
    unittest.main()
