from __future__ import annotations

import unittest
from datetime import datetime
from unittest.mock import patch

from app.api import app as app_api


class VitalDetailPeriodTests(unittest.TestCase):
    def test_week_detail_aggregates_each_day_and_reports_period_bounds(self):
        rows = [
            {"recordTime": datetime(2026, 8, 31, 8, 0), "value": 70},
            {"recordTime": datetime(2026, 8, 31, 9, 0), "value": 74},
            {"recordTime": datetime(2026, 9, 2, 8, 0), "value": 80},
        ]
        summaries = [
            {"recordDate": "2026-09-01", "heartRateAvg": 76, "heartRateScore": 88},
            {"recordDate": "2026-09-02", "heartRateAvg": 80, "heartRateScore": 92},
        ]

        with patch.object(app_api, "raw_series_between", return_value=rows), patch.object(
            app_api, "summaries_between", return_value=summaries
        ):
            payload = app_api.data_detail_response(
                object(),
                1,
                "2026-09-02",
                "heart_rate",
                "heartRateScore",
                "heartRateAvg",
                period_type="week",
            )

        self.assertEqual(payload["type"], "week")
        self.assertEqual(payload["startDate"], "2026-08-31")
        self.assertEqual(payload["endDate"], "2026-09-06")
        self.assertEqual(payload["avgValue"], "76")
        self.assertEqual(payload["newValue"], "80")
        self.assertEqual(payload["avgValueRange"], "70-80")
        self.assertEqual(
            payload["chartData"],
            [
                {"time": "08-31", "value": "72"},
                {"time": "09-01", "value": "76"},
                {"time": "09-02", "value": "80"},
            ],
        )

    def test_month_temperature_keeps_decimal_precision(self):
        rows = [
            {"recordTime": datetime(2026, 9, 1, 8, 0), "value": 36.4},
            {"recordTime": datetime(2026, 9, 2, 8, 0), "value": 36.8},
        ]

        with patch.object(app_api, "raw_series_between", return_value=rows), patch.object(
            app_api, "summaries_between", return_value=[]
        ):
            payload = app_api.data_detail_response(
                object(),
                1,
                "2026-09-02",
                "temperature",
                "temperatureScore",
                "temperatureAvg",
                period_type="month",
            )

        self.assertEqual(payload["type"], "month")
        self.assertEqual(payload["startDate"], "2026-09-01")
        self.assertEqual(payload["endDate"], "2026-09-30")
        self.assertEqual(payload["avgValue"], "36.6")
        self.assertEqual(payload["avgValueRange"], "36.4-36.8")


if __name__ == "__main__":
    unittest.main()
