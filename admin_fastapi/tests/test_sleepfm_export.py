import unittest
from datetime import datetime, timedelta

from app.schemas.sleepfm import SleepFMExportRequest
from app.services.sleepfm_export import (
    SleepFMExportError,
    _epoch_series,
    _quality_score,
    _requested_dates,
    _valid_sensor_value,
    verify_service_token,
)


class SleepFMExportTests(unittest.TestCase):
    def test_night_ids_are_parsed(self):
        request = SleepFMExportRequest.model_validate(
            {
                "schema_version": "sleepfm_real_user_input_v1",
                "request_id": "req_1",
                "user_id": "1",
                "night_ids": ["night_20260714"],
            }
        )
        dates = _requested_dates(request)
        self.assertEqual(dates[0][0].isoformat(), "2026-07-14")

    def test_invalid_service_token_is_rejected(self):
        with self.assertRaises(SleepFMExportError) as context:
            verify_service_token("Bearer wrong", "expected")
        self.assertEqual(context.exception.code, "unauthorized")

    def test_epoch_series_are_equal_length_and_rr_is_not_faked(self):
        start = datetime(2026, 7, 14, 23, 0)
        rows = [
            {
                "record_time": start + timedelta(minutes=minute),
                "heart_rate": 60,
                "hrv": 50,
                "temperature": 33.0,
                "spo2": 98,
                "motion_intensity": 0,
            }
            for minute in (0, 4, 5, 9)
        ]
        series = _epoch_series(rows, start, start + timedelta(minutes=10))
        self.assertEqual({len(values) for values in series.values()}, {2})
        self.assertEqual(series["hr"], [60.0, 60.0])
        self.assertEqual(series["rr"], [None, None])
        self.assertEqual(_quality_score(series), 1.0)

    def test_invalid_physiological_values_become_missing(self):
        self.assertIsNone(_valid_sensor_value("hr", 0))
        self.assertIsNone(_valid_sensor_value("hr", 29))
        self.assertEqual(_valid_sensor_value("hr", 60), 60.0)
        self.assertIsNone(_valid_sensor_value("spo2", 0))
        self.assertEqual(_valid_sensor_value("actigraphy", 0), 0.0)


if __name__ == "__main__":
    unittest.main()
