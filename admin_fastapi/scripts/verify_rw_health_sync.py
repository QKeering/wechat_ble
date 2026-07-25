from datetime import date, datetime
from pathlib import Path
import sys

from sqlalchemy import Column, Date, DateTime, Integer, MetaData, Numeric, String, Table, create_engine, inspect, select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.app import (
    data_vital_sign,
    data_detail_response,
    duration_level,
    duration_text,
    effective_sleep_values,
    java_sync_health_raw_values,
    java_sync_sleep_record_values,
    localize_payload_levels,
    motion_intensity_counts,
    nap_list,
    overview_payload,
    raw_points,
    ring_sleep_state_value,
    sleep_records,
    stress_chart,
    stress_bucket,
    stress_counts,
    stress_level,
    stress_records,
    sleep_type_key,
    sync_ring_data_records,
    upsert_sync_health_raw_record,
    upsert_sync_sleep_records,
)
from app.api import app as app_api
from app.services import health as health_service
from app.services.health import initialize_health_schema, sleep_type_key as service_sleep_type_key


class FakeRequest:
    def __init__(self, params: dict[str, str] | None = None):
        self.query_params = params or {}


EXPECTED_SLEEP_TYPES = {
    0: "INVALID",
    1: "AWAKE",
    2: "REM",
    3: "LIGHT",
    4: "DEEP",
    5: "NAP",
}


for value, expected in EXPECTED_SLEEP_TYPES.items():
    assert sleep_type_key(value) == expected, (value, sleep_type_key(value), expected)
    assert service_sleep_type_key(value) == expected, (value, service_sleep_type_key(value), expected)
    assert ring_sleep_state_value(value) == value

assert sleep_type_key("REM") == "REM"
assert sleep_type_key(99) == "INVALID"
assert ring_sleep_state_value(99) is None

localized_payload = localize_payload_levels(
    {
        "status": "Needs improvement",
        "trend": "No change",
        "dateRange": "07-06 to 07-12",
        "sleep": {"activation": {"level": "needs_improvement"}},
        "stress": [{"time": "鏀炬澗"}, {"time": "high"}],
        "duration": "1灏忔椂30鍒嗛挓",
        "algorithm": {
            "riskLevel": "high",
            "regularityLevel": "Good",
            "compactStatus": "NeedsImprovement",
            "compactSleepQuality": "SleepQuality",
            "compactVitalName": "VitalSigns",
            "compactLoad": "HeavyLoad",
            "camelStatus": "VeryPoor",
            "camelSleepStage": "LightSleep",
            "camelBodyTemperature": "BodyTemperature",
        },
    }
)
assert localized_payload["status"] == "待改善"
assert localized_payload["trend"] == "保持不变"
assert localized_payload["dateRange"] == "07-06 至 07-12"
assert localized_payload["sleep"]["activation"]["level"] == "待改善"
assert localized_payload["stress"] == [{"time": "放松"}, {"time": "偏高"}]
assert localized_payload["duration"] == "1小时30分钟"
assert localized_payload["algorithm"]["riskLevel"] == "偏高"
assert localized_payload["algorithm"]["regularityLevel"] == "良好"
assert localized_payload["algorithm"]["compactStatus"] == "待改善"
assert localized_payload["algorithm"]["compactSleepQuality"] == "睡眠质量"
assert localized_payload["algorithm"]["compactVitalName"] == "生命体征"
assert localized_payload["algorithm"]["compactLoad"] == "重度负荷"
assert localized_payload["algorithm"]["camelStatus"] == "待改善"
assert localized_payload["algorithm"]["camelSleepStage"] == "浅睡"
assert localized_payload["algorithm"]["camelBodyTemperature"] == "体温"
assert overview_payload(80, 70)["trend"] == "较上期+10"
assert overview_payload(70, 80)["trend"] == "较上期-10"
assert overview_payload(70, 70)["trend"] == "保持不变"
assert duration_text(90) == "1小时30分钟"
assert duration_level(420) == "充足"

metadata = MetaData()
health_raw = Table(
    "health_raw",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer),
    Column("record_time", DateTime),
    Column("device_mac", String(32)),
    Column("sleep_state", Integer),
    Column("step_count", Integer),
    Column("heart_rate", Integer),
    Column("hrv", Integer),
    Column("spo2", Integer),
    Column("stress", Integer),
    Column("temperature", Numeric(6, 2)),
    Column("blood_sugar", Numeric(6, 2)),
    Column("systolic", Integer),
    Column("diastolic", Integer),
    Column("motion_intensity", Integer),
    Column("perfusion_index", Numeric(6, 2)),
    Column("rr_intervals", String(255)),
    Column("create_time", DateTime),
)

values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-13 22:30:00",
        "sleepState": 2,
        "bloodSugar": 5.8,
        "systolic": 121,
        "diastolic": 79,
        "motionIntensity": 4,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert values is not None
assert values["user_id"] == 7
assert values["device_mac"] == "3E:00:00:00:05:1B"
assert values["record_time"] == datetime(2026, 7, 13, 22, 30, 0)
assert values["sleep_state"] == 2
assert values["blood_sugar"] == 5.8
assert values["systolic"] == 121
assert values["diastolic"] == 79
assert values["motion_intensity"] == 4

invalid_values = java_sync_health_raw_values(
    health_raw,
    {"recordTime": "2026-07-13 22:35:00", "sleepState": 9},
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert invalid_values is not None
assert "sleep_state" not in invalid_values

invalid_extended_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-13 22:40:00",
        "bloodSugar": 80,
        "systolic": 20,
        "diastolic": 220,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert invalid_extended_values is not None
assert "blood_sugar" not in invalid_extended_values
assert "systolic" not in invalid_extended_values
assert "diastolic" not in invalid_extended_values

rw_skin_temperature_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:52:39",
        "temperature": 28.6,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert rw_skin_temperature_values is not None
assert rw_skin_temperature_values["temperature"] == 28.6

rw_scaled_temperature_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:52:49",
        "bodyTemperature": 3665,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert rw_scaled_temperature_values is not None
assert rw_scaled_temperature_values["temperature"] == 36.65

rw_scaled_skin_temperature_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:52:59",
        "skinTemperature": 365,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert rw_scaled_skin_temperature_values is not None
assert rw_scaled_skin_temperature_values["temperature"] == 36.5

frontend_contract_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:53:39",
        "stepCount": 6789,
        "heartRate": 89,
        "hrv": 46,
        "spo2": 98,
        "stress": 23,
        "temperature": 36.6,
        "sleepState": 4,
        "sleepDuration": 130,
        "motionIntensity": 2,
        "perfusionIndex": 8,
        "rrIntervals": "[810,790,805]",
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert frontend_contract_values is not None
assert frontend_contract_values["record_time"] == datetime(2026, 7, 17, 6, 53, 39)
assert frontend_contract_values["step_count"] == 6789
assert frontend_contract_values["heart_rate"] == 89
assert frontend_contract_values["hrv"] == 46
assert frontend_contract_values["spo2"] == 98
assert frontend_contract_values["stress"] == 23
assert frontend_contract_values["temperature"] == 36.6
assert frontend_contract_values["sleep_state"] == 4
assert frontend_contract_values["motion_intensity"] == 2
assert frontend_contract_values["perfusion_index"] == 8
assert frontend_contract_values["rr_intervals"] == "[810,790,805]"

rw_without_temperature_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:53:45",
        "protocol": "rw",
        "heartRate": 76,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert rw_without_temperature_values is not None
assert rw_without_temperature_values["temperature"] == 36.6

non_rw_without_temperature_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:53:46",
        "protocol": "qkeer_v2",
        "heartRate": 76,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1C",
)
assert non_rw_without_temperature_values is not None
assert "temperature" not in non_rw_without_temperature_values

rw_sleep_status_raw_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:53:49",
        "dataType": "sleep",
        "sleepType": 0,
        "sleepStatus": 2,
        "durationMinutes": 30,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert rw_sleep_status_raw_values is not None
assert rw_sleep_status_raw_values["sleep_state"] == 4

non_sleep_status_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:53:59",
        "status": 2,
        "heartRate": 72,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert non_sleep_status_values is not None
assert non_sleep_status_values["heart_rate"] == 72
assert "sleep_state" not in non_sleep_status_values

rw_alias_contract_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:54:09",
        "heart_rate": 88,
        "heartRateVariability": 42,
        "bloodOxygenSaturation": 97,
        "skinTemperature": 28.6,
        "pressureValue": 35,
        "glucose": 6.1,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert rw_alias_contract_values is not None
assert rw_alias_contract_values["heart_rate"] == 88
assert rw_alias_contract_values["hrv"] == 42
assert rw_alias_contract_values["spo2"] == 97
assert rw_alias_contract_values["temperature"] == 28.6
assert rw_alias_contract_values["stress"] == 35
assert rw_alias_contract_values["blood_sugar"] == 6.1

backend_alias_contract_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:54:19",
        "totalSteps": 4321,
        "heartRateValue": 77,
        "oxygenSaturation": 97,
        "hrvValue": 45,
        "pressureValue": 26,
        "temperatureValue": 36.6,
        "bloodSugarValue": 5.9,
        "bloodPressureValue": {"systolicValue": 121, "diastolicValue": 80},
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert backend_alias_contract_values is not None
assert backend_alias_contract_values["step_count"] == 4321
assert backend_alias_contract_values["heart_rate"] == 77
assert backend_alias_contract_values["spo2"] == 97
assert backend_alias_contract_values["hrv"] == 45
assert backend_alias_contract_values["stress"] == 26
assert backend_alias_contract_values["temperature"] == 36.6
assert backend_alias_contract_values["blood_sugar"] == 5.9
assert backend_alias_contract_values["systolic"] == 121
assert backend_alias_contract_values["diastolic"] == 80

stress_alias_contract_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:54:39",
        "stressValue": 32,
        "pressureValue": 47,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert stress_alias_contract_values is not None
assert stress_alias_contract_values["stress"] == 32

zero_stress_contract_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-17 06:54:49",
        "stress": 0,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert zero_stress_contract_values is not None
assert zero_stress_contract_values["stress"] == 0

date_ref_contract_values = java_sync_health_raw_values(
    health_raw,
    {
        "recordTime": "2026-07-09 13:00:00",
        "dateRef": "2026-07-17",
        "stepCount": 33,
        "heartRate": 73,
        "spo2": 98,
    },
    user_id=7,
    device_mac="3E:00:00:00:05:1B",
)
assert date_ref_contract_values is not None
assert date_ref_contract_values["record_time"] == datetime(2026, 7, 17, 13, 0, 0)
assert date_ref_contract_values["step_count"] == 33
assert date_ref_contract_values["heart_rate"] == 73
assert date_ref_contract_values["spo2"] == 98

original_current_app_datetime = app_api.current_app_datetime
app_api.current_app_datetime = lambda: datetime(2026, 7, 17, 20, 0, 0)
try:
    same_day_future_values = java_sync_health_raw_values(
        health_raw,
        {
            "recordTime": "2026-07-17 23:06:37",
            "stepCount": 3852,
        },
        user_id=7,
        device_mac="3E:00:00:00:05:1B",
    )
    bad_year_values = java_sync_health_raw_values(
        health_raw,
        {
            "recordTime": "2083-03-29 22:22:38",
            "spo2": 98,
        },
        user_id=7,
        device_mac="3E:00:00:00:05:1B",
    )
finally:
    app_api.current_app_datetime = original_current_app_datetime
assert same_day_future_values is None
assert bad_year_values is None

sleep_record = Table(
    "sleep_record",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer),
    Column("date_ref", Date),
    Column("type", Integer),
    Column("start_time", DateTime),
    Column("end_time", DateTime),
    Column("sleep_time", Integer),
)

health_daily_summary = Table(
    "health_daily_summary",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer),
    Column("device_mac", String(32)),
    Column("record_date", String(10)),
    Column("total_steps", Integer),
    Column("total_distance", Numeric(10, 2)),
    Column("total_calorie", Numeric(10, 2)),
    Column("active_time", Integer),
    Column("motion_score", Integer),
    Column("heart_rate_avg", Numeric(6, 2)),
    Column("heart_rate_min", Integer),
    Column("heart_rate_max", Integer),
    Column("heart_rate_score", Integer),
    Column("hrv_avg", Numeric(6, 2)),
    Column("hrv_min", Integer),
    Column("hrv_max", Integer),
    Column("hrv_score", Integer),
    Column("spo2_avg", Numeric(6, 2)),
    Column("spo2_min", Integer),
    Column("spo2_max", Integer),
    Column("spo2_score", Integer),
    Column("temperature_avg", Numeric(6, 2)),
    Column("temperature_min", Numeric(6, 2)),
    Column("temperature_max", Numeric(6, 2)),
    Column("temperature_score", Integer),
    Column("stress_avg", Numeric(6, 2)),
    Column("stress_min", Integer),
    Column("stress_max", Integer),
    Column("blood_sugar_avg", Numeric(6, 2)),
    Column("blood_sugar_min", Numeric(6, 2)),
    Column("blood_sugar_max", Numeric(6, 2)),
    Column("systolic_avg", Numeric(6, 2)),
    Column("systolic_min", Integer),
    Column("systolic_max", Integer),
    Column("diastolic_avg", Numeric(6, 2)),
    Column("diastolic_min", Integer),
    Column("diastolic_max", Integer),
    Column("stress_relaxed_time", Integer),
    Column("stress_normal_time", Integer),
    Column("stress_medium_time", Integer),
    Column("stress_high_time", Integer),
    Column("stress_score", Integer),
    Column("sleep_total_time", Integer),
    Column("sleep_deep_time", Integer),
    Column("sleep_light_time", Integer),
    Column("sleep_rem_time", Integer),
    Column("sleep_awake_time", Integer),
    Column("sleep_awake_count", Integer),
    Column("sleep_start_time", DateTime),
    Column("sleep_end_time", DateTime),
    Column("sleep_efficiency", Numeric(6, 2)),
    Column("sleep_score", Integer),
    Column("health_score", Integer),
    Column("health_level", String(32)),
    Column("create_time", DateTime),
    Column("update_time", DateTime),
)

sleep_values = java_sync_sleep_record_values(
    sleep_record,
    {
        "recordTime": "2026-07-13 22:30:00",
        "sleepState": 2,
        "sleepDuration": 35,
    },
    user_id=7,
)
assert sleep_values is not None
assert sleep_values["type"] == 2
assert sleep_values["sleep_time"] == 35
assert sleep_values["start_time"] == datetime(2026, 7, 13, 22, 30, 0)
assert sleep_values["end_time"] == datetime(2026, 7, 13, 23, 5, 0)
assert str(sleep_values["date_ref"]) == "2026-07-13"

rw_duration_minutes_sleep_values = java_sync_sleep_record_values(
    sleep_record,
    {
        "recordTime": "2026-07-13 23:10:00",
        "sleepType": 0,
        "sleepStatus": 2,
        "durationMinutes": 45,
    },
    user_id=7,
)
assert rw_duration_minutes_sleep_values is not None
assert rw_duration_minutes_sleep_values["type"] == 4
assert rw_duration_minutes_sleep_values["sleep_time"] == 45
assert rw_duration_minutes_sleep_values["start_time"] == datetime(2026, 7, 13, 23, 10, 0)
assert rw_duration_minutes_sleep_values["end_time"] == datetime(2026, 7, 13, 23, 55, 0)
assert str(rw_duration_minutes_sleep_values["date_ref"]) == "2026-07-13"

rw_awake_status_sleep_values = java_sync_sleep_record_values(
    sleep_record,
    {
        "recordTime": "2026-07-13 23:56:00",
        "sleepStatus": 3,
        "durationMinutes": 4,
    },
    user_id=7,
)
assert rw_awake_status_sleep_values is not None
assert rw_awake_status_sleep_values["type"] == 1
assert rw_awake_status_sleep_values["sleep_time"] == 4

sleep_page_values = java_sync_sleep_record_values(
    sleep_record,
    {
        "recordTime": "2026-07-16 23:30:00",
        "sleepState": 4,
        "sleepDuration": 120,
        "dateRef": "2026-07-17",
    },
    user_id=7,
)
assert sleep_page_values is not None
assert sleep_page_values["start_time"] == datetime(2026, 7, 16, 23, 30, 0)
assert sleep_page_values["end_time"] == datetime(2026, 7, 17, 1, 30, 0)
assert str(sleep_page_values["date_ref"]) == "2026-07-17"

sleep_page_explicit_end_values = java_sync_sleep_record_values(
    sleep_record,
    {
        "startTime": "2026-07-16 23:45:00",
        "endTime": "2026-07-17 02:05:00",
        "sleepState": 3,
        "sleepDuration": 140,
        "dateRef": "2026-07-17",
    },
    user_id=7,
)
assert sleep_page_explicit_end_values is not None
assert sleep_page_explicit_end_values["start_time"] == datetime(2026, 7, 16, 23, 45, 0)
assert sleep_page_explicit_end_values["end_time"] == datetime(2026, 7, 17, 2, 5, 0)
assert str(sleep_page_explicit_end_values["date_ref"]) == "2026-07-17"

sleep_page_implicit_end_values = java_sync_sleep_record_values(
    sleep_record,
    {
        "startTime": "2026-07-16 23:45:00",
        "endTime": "2026-07-17 02:05:00",
        "sleepState": 3,
        "sleepDuration": 140,
    },
    user_id=7,
)
assert sleep_page_implicit_end_values is not None
assert sleep_page_implicit_end_values["start_time"] == datetime(2026, 7, 16, 23, 45, 0)
assert sleep_page_implicit_end_values["end_time"] == datetime(2026, 7, 17, 2, 5, 0)
assert str(sleep_page_implicit_end_values["date_ref"]) == "2026-07-17"

sleep_page_implicit_duration_values = java_sync_sleep_record_values(
    sleep_record,
    {
        "recordTime": "2026-07-16 23:30:00",
        "sleepState": 4,
        "sleepDuration": 120,
    },
    user_id=7,
)
assert sleep_page_implicit_duration_values is not None
assert sleep_page_implicit_duration_values["start_time"] == datetime(2026, 7, 16, 23, 30, 0)
assert sleep_page_implicit_duration_values["end_time"] == datetime(2026, 7, 17, 1, 30, 0)
assert str(sleep_page_implicit_duration_values["date_ref"]) == "2026-07-17"

assert java_sync_sleep_record_values(
    sleep_record,
    {"recordTime": "2026-07-13 22:30:00", "sleepState": 4, "sleepDuration": 0},
    user_id=7,
) is None

engine = create_engine("sqlite://")
metadata.create_all(engine)
with Session(engine) as db:
    upsert_values = dict(sleep_values)
    upsert_sync_sleep_records(db, sleep_record, [upsert_values])
    upsert_values["sleep_time"] = 40
    upsert_values["end_time"] = datetime(2026, 7, 13, 23, 10, 0)
    upsert_sync_sleep_records(db, sleep_record, [upsert_values])
    stored_sleep_records = db.execute(select(sleep_record)).mappings().all()

    first_health_values = java_sync_health_raw_values(
        health_raw,
        {"recordTime": "2026-07-13 22:30:00", "heartRate": 72},
        user_id=7,
        device_mac="3E:00:00:00:05:1B",
    )
    second_health_values = java_sync_health_raw_values(
        health_raw,
        {"recordTime": "2026-07-13 22:30:00", "bloodSugar": 5.9},
        user_id=7,
        device_mac="3E:00:00:00:05:1B",
    )
    assert first_health_values is not None and second_health_values is not None
    assert upsert_sync_health_raw_record(db, health_raw, first_health_values) == "inserted"
    assert upsert_sync_health_raw_record(db, health_raw, second_health_values) == "updated"
    db.commit()
    stored_health_records = db.execute(select(health_raw)).mappings().all()

assert len(stored_sleep_records) == 1
assert stored_sleep_records[0]["sleep_time"] == 40
assert stored_sleep_records[0]["end_time"] == datetime(2026, 7, 13, 23, 10, 0)
assert len(stored_health_records) == 1
assert stored_health_records[0]["heart_rate"] == 72
assert float(stored_health_records[0]["blood_sugar"]) == 5.9

with Session(engine) as db:
    db.execute(
        sleep_record.insert(),
        [
            {
                "user_id": 8,
                "date_ref": date(2026, 7, 17),
                "type": 5,
                "start_time": datetime(2026, 7, 17, 13, 0, 0),
                "end_time": datetime(2026, 7, 17, 13, 25, 0),
                "sleep_time": 25,
                "create_time": datetime(2026, 7, 17, 13, 30, 0),
            },
            {
                "user_id": 8,
                "date_ref": date(2026, 7, 18),
                "type": 5,
                "start_time": datetime(2026, 7, 18, 13, 0, 0),
                "end_time": datetime(2026, 7, 18, 13, 20, 0),
                "sleep_time": 20,
                "create_time": datetime(2026, 7, 18, 13, 25, 0),
            },
            {
                "user_id": 8,
                "date_ref": date(2026, 7, 17),
                "type": 4,
                "start_time": datetime(2026, 7, 17, 23, 0, 0),
                "end_time": datetime(2026, 7, 18, 1, 0, 0),
                "sleep_time": 120,
                "create_time": datetime(2026, 7, 18, 1, 5, 0),
            },
        ],
    )
    db.commit()
    rw_numeric_nap_response = nap_list(FakeRequest({"date": "2026-07-17"}), {"id": 8}, db)

assert rw_numeric_nap_response["code"] == 200
assert len(rw_numeric_nap_response["data"]) == 1
assert rw_numeric_nap_response["data"][0]["type"] == 5
assert rw_numeric_nap_response["data"][0]["sleepTime"] == 25
assert str(rw_numeric_nap_response["data"][0]["dateRef"]) == "2026-07-17"

original_health_get_table = health_service.get_table
with Session(engine) as db:
    health_service.get_table = lambda table_name: metadata.tables[table_name]
    original_app_get_table = app_api.get_table
    app_api.get_table = lambda table_name: metadata.tables[table_name]
    original_app_current_datetime = app_api.current_app_datetime
    original_health_max_visible_record_time = health_service.max_visible_record_time
    app_api.current_app_datetime = lambda: datetime(2026, 7, 17, 8, 40, 0)
    health_service.max_visible_record_time = lambda: datetime(2026, 7, 17, 8, 50, 0)
    try:
        rw_visible_samples = [
            {
                "recordTime": "2026-07-17 08:00:00",
                "stepCount": 1000,
                "heartRate": 70,
                "hrv": 50,
                "spo2": 97,
                "stress": 20,
                "temperature": 36.5,
                "bloodSugar": 5.4,
                "systolic": 120,
                "diastolic": 80,
                "motionIntensity": 1,
            },
            {
                "recordTime": "2026-07-17 08:30:00",
                "stepCount": 2200,
                "heartRate": 72,
                "hrv": 54,
                "spo2": 98,
                "stress": 35,
                "temperature": 36.7,
                "bloodSugar": 5.8,
                "systolic": 122,
                "diastolic": 82,
                "motionIntensity": 2,
            },
            {
                "recordTime": "2026-07-17 08:35:00",
                "hrv": 58,
            },
            {
                "recordTime": "2026-07-17 08:45:00",
                "stress": 0,
            },
        ]
        for sample in rw_visible_samples:
            sample_values = java_sync_health_raw_values(
                health_raw,
                sample,
                user_id=7,
                device_mac="3E:00:00:00:05:1B",
            )
            assert sample_values is not None
            upsert_sync_health_raw_record(db, health_raw, sample_values)
        db.execute(
            health_raw.insert().values(
                user_id=7,
                record_time=datetime(2026, 7, 17, 8, 15, 0),
                device_mac="3E:00:00:00:05:1B",
                step_count=0,
                heart_rate=0,
                hrv=0,
                spo2=46,
                temperature=0,
            )
        )
        db.execute(
            health_raw.insert().values(
                user_id=7,
                record_time=datetime(2026, 7, 17, 23, 6, 37),
                device_mac="3E:00:00:00:05:1B",
                step_count=3852,
                heart_rate=180,
                hrv=280,
                spo2=99,
                temperature=39,
                stress=88,
            )
        )
        upsert_sync_sleep_records(db, sleep_record, [dict(sleep_page_values)])

        visible_summary = health_service.calculate_daily_summary(db, 7, "2026-07-17")
        visible_heart_points = raw_points(db, 7, "2026-07-17", "heart_rate")
        visible_hrv_points = raw_points(db, 7, "2026-07-17", "hrv")
        visible_step_points = raw_points(db, 7, "2026-07-17", "step_count")
        visible_blood_sugar_points = raw_points(db, 7, "2026-07-17", "blood_sugar")
        visible_systolic_points = raw_points(db, 7, "2026-07-17", "systolic")
        visible_diastolic_points = raw_points(db, 7, "2026-07-17", "diastolic")
        visible_vital_payload = data_vital_sign(FakeRequest({"date": "2026-07-17"}), {"id": 7}, db)["data"]
        visible_stress_rows = stress_records(db, 7, "2026-07-17")
        visible_stress_rows_with_hrv = stress_records(db, 7, "2026-07-17", include_hrv_only=True)
        visible_stress_points = stress_chart(visible_stress_rows)
        visible_stress_points_with_hrv = stress_chart(visible_stress_rows_with_hrv)
        visible_stress_counts = stress_counts(visible_stress_rows)
        visible_stress_counts_with_hrv = stress_counts(visible_stress_rows_with_hrv)
        visible_motion_counts = motion_intensity_counts(db, 7, "2026-07-17")
        visible_sleep_rows = sleep_records(db, 7, "2026-07-17")
        visible_sleep_values = effective_sleep_values(db, 7, "2026-07-17", visible_sleep_rows)
        visible_heart_detail = data_detail_response(db, 7, "2026-07-17", "heart_rate", "heartRateScore", "heartRateAvg")
        visible_spo2_detail = data_detail_response(db, 7, "2026-07-17", "spo2", "spo2Score", "spo2Avg")
        visible_hrv_detail = data_detail_response(db, 7, "2026-07-17", "hrv", "hrvScore", "hrvAvg")
        visible_temperature_detail = data_detail_response(db, 7, "2026-07-17", "temperature", "temperatureScore", "temperatureAvg")
        fast_return_sync = sync_ring_data_records(
            db,
            9,
            [
                {
                    "recordTime": "2026-07-17 08:40:00",
                    "deviceMac": "3E:00:00:00:09:01",
                    "stepCount": 88,
                    "heartRate": 76,
                    "spo2": 99,
                }
            ],
            device_mac=None,
            calculate_summary=False,
        )
        fast_return_rows = db.execute(
            select(health_raw).where(health_raw.c.user_id == 9)
        ).mappings().all()
        fast_return_summary_rows = db.execute(
            select(health_daily_summary).where(health_daily_summary.c.user_id == 9)
        ).mappings().all()
        pure_sleep_sync = sync_ring_data_records(
            db,
            7,
            [
                {
                    "startTime": "2026-07-17 23:10:00",
                    "endTime": "2026-07-18 00:15:00",
                    "sleepState": 3,
                    "sleepDuration": 65,
                    "dateRef": "2026-07-18",
                }
            ],
            device_mac=None,
        )
        pure_sleep_rows = sleep_records(db, 7, "2026-07-18")
    finally:
        health_service.get_table = original_health_get_table
        app_api.get_table = original_app_get_table
        app_api.current_app_datetime = original_app_current_datetime
        health_service.max_visible_record_time = original_health_max_visible_record_time

assert visible_summary["totalSteps"] == 2200
assert visible_summary["heartRateAvg"] == 71.0
assert visible_summary["spo2Avg"] == 97.5
assert round(float(visible_summary["bloodSugarAvg"]), 2) == 5.6
assert round(float(visible_summary["systolicAvg"]), 2) == 121.0
assert round(float(visible_summary["diastolicAvg"]), 2) == 81.0
assert round(float(visible_summary["stressAvg"]), 2) == 18.33
assert int(visible_summary["stressMin"]) == 0
assert int(visible_summary["stressMax"]) == 35
assert int(visible_summary["stressRelaxedTime"]) == 2
assert int(visible_summary["stressNormalTime"]) == 1
assert int(visible_summary["stressMediumTime"]) == 0
assert int(visible_summary["stressHighTime"]) == 0
assert int(visible_summary["stressScore"]) == 82
assert visible_summary["healthLevel"] in {"优秀", "良好", "正常", "偏低"}
assert visible_summary["sleepTotalTime"] == 120
assert visible_heart_points == [{"time": "08:00", "value": "70"}, {"time": "08:30", "value": "72"}]
assert visible_hrv_points == [{"time": "08:00", "value": "50"}, {"time": "08:30", "value": "54"}, {"time": "08:35", "value": "58"}]
assert visible_step_points == [{"time": "08:00", "value": "1000"}, {"time": "08:30", "value": "2200"}]
assert visible_blood_sugar_points == [{"time": "08:00", "value": "5.4"}, {"time": "08:30", "value": "5.8"}]
assert visible_systolic_points == [{"time": "08:00", "value": "120"}, {"time": "08:30", "value": "122"}]
assert visible_diastolic_points == [{"time": "08:00", "value": "80"}, {"time": "08:30", "value": "82"}]
assert round(float(visible_vital_payload["bloodSugarAvg"]), 2) == 5.6
assert round(float(visible_vital_payload["hrvAvg"]), 2) == 54.0
assert visible_vital_payload["bloodPressure"] == "121/81"
assert visible_vital_payload["hrvChart"] == visible_hrv_points
assert visible_vital_payload["bloodSugarChart"] == visible_blood_sugar_points
assert visible_vital_payload["systolicChart"] == visible_systolic_points
assert visible_vital_payload["diastolicChart"] == visible_diastolic_points
assert len(visible_stress_rows) == 3
assert len(visible_stress_rows_with_hrv) == 4
assert [row._mapping.get("hrv") for row in visible_stress_rows_with_hrv if row._mapping.get("stress") is None] == [58]
assert visible_stress_points == [{"time": "08:00", "value": "20"}, {"time": "08:30", "value": "35"}, {"time": "08:45", "value": "0"}]
assert visible_stress_points_with_hrv == [
    {"time": "08:00", "value": "20"},
    {"time": "08:30", "value": "35"},
    {"time": "08:35", "value": "20"},
    {"time": "08:45", "value": "0"},
]
assert visible_stress_counts[stress_bucket(0)] == 2
assert visible_stress_counts[stress_bucket(35)] == 1
assert visible_stress_counts[stress_bucket(65)] == 0
assert visible_stress_counts[stress_bucket(90)] == 0
assert visible_stress_counts_with_hrv[stress_bucket(0)] == 3
assert visible_stress_counts_with_hrv[stress_bucket(35)] == 1
assert stress_level(20) == "放松"
assert stress_level(35) == "正常"
assert stress_level(0) == stress_bucket(0)
assert visible_motion_counts["low"] == 1
assert visible_motion_counts["moderate"] == 1
assert len(visible_sleep_rows) == 1
assert visible_sleep_values["DEEP"] == 120


def assert_metric_detail(detail: dict, expected_new: float, expected_avg: float, expected_values: list[float], expected_times: list[str] | None = None):
    assert round(float(detail["newValue"]), 2) == expected_new
    assert round(float(detail["avgValue"]), 2) == expected_avg
    assert [item["time"] for item in detail["chartData"]] == (expected_times or ["08:00", "08:30"])
    assert [round(float(item["value"]), 2) for item in detail["chartData"]] == expected_values


assert_metric_detail(visible_heart_detail, 72, 71.0, [70, 72])
assert_metric_detail(visible_spo2_detail, 98, 97.5, [97, 98])
assert_metric_detail(visible_hrv_detail, 58, 54.0, [50, 54, 58], ["08:00", "08:30", "08:35"])
assert_metric_detail(visible_temperature_detail, 36.7, 36.6, [36.5, 36.7])
assert fast_return_sync["success"] is True
assert fast_return_sync["count"] == 1
assert fast_return_sync["healthCount"] == 1
assert fast_return_sync["sleepCount"] == 0
assert fast_return_sync["failCount"] == 0
assert fast_return_sync["touchedDates"] == ["2026-07-17"]
assert fast_return_sync["summarySkipped"] is True
assert fast_return_sync["summaryMs"] == 0
assert fast_return_sync["summaryDates"] == []
assert len(fast_return_rows) == 1
assert fast_return_rows[0]["device_mac"] == "3E:00:00:00:09:01"
assert fast_return_rows[0]["step_count"] == 88
assert fast_return_rows[0]["heart_rate"] == 76
assert fast_return_rows[0]["spo2"] == 99
assert len(fast_return_summary_rows) == 0
assert pure_sleep_sync["success"] is True
assert pure_sleep_sync["count"] == 1
assert pure_sleep_sync["healthCount"] == 0
assert pure_sleep_sync["sleepCount"] == 1
assert pure_sleep_sync["failCount"] == 0
assert pure_sleep_sync["touchedDates"] == ["2026-07-18"]
assert len(pure_sleep_rows) == 1
pure_sleep_row = dict(pure_sleep_rows[0]._mapping)


def parsed_db_datetime(value):
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


assert parsed_db_datetime(pure_sleep_row["start_time"]) == datetime(2026, 7, 17, 23, 10, 0)
assert parsed_db_datetime(pure_sleep_row["end_time"]) == datetime(2026, 7, 18, 0, 15, 0)
assert str(pure_sleep_row["date_ref"]) == "2026-07-18"
assert pure_sleep_row["sleep_time"] == 65

migration_metadata = MetaData()
Table(
    "health_raw",
    migration_metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer),
    Column("record_time", DateTime),
)
Table(
    "health_daily_summary",
    migration_metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer),
    Column("record_date", Date),
)
migration_engine = create_engine("sqlite://")
migration_metadata.create_all(migration_engine)
with Session(migration_engine) as db:
    initialize_health_schema(db)
    initialize_health_schema(db)

migration_inspector = inspect(migration_engine)
raw_columns = {column["name"] for column in migration_inspector.get_columns("health_raw")}
summary_columns = {column["name"] for column in migration_inspector.get_columns("health_daily_summary")}
assert {"blood_sugar", "systolic", "diastolic"}.issubset(raw_columns)
assert {
    "blood_sugar_avg",
    "blood_sugar_min",
    "blood_sugar_max",
    "systolic_avg",
    "systolic_min",
    "systolic_max",
    "diastolic_avg",
    "diastolic_min",
    "diastolic_max",
}.issubset(summary_columns)

print("RW/L19 health sync parity passed.")
