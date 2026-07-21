from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.services.crud import camelize_dict, clean_payload, get_table


RW_HEALTH_SCHEMA_COLUMNS = {
    "health_raw": {
        "blood_sugar": "decimal(6,2) null",
        "systolic": "int null",
        "diastolic": "int null",
    },
    "health_daily_summary": {
        "blood_sugar_avg": "decimal(6,2) null",
        "blood_sugar_min": "decimal(6,2) null",
        "blood_sugar_max": "decimal(6,2) null",
        "systolic_avg": "decimal(6,2) null",
        "systolic_min": "int null",
        "systolic_max": "int null",
        "diastolic_avg": "decimal(6,2) null",
        "diastolic_min": "int null",
        "diastolic_max": "int null",
    },
}


def initialize_health_schema(db: Session) -> None:
    bind = db.get_bind()
    inspector = inspect(bind)
    for table_name, columns in RW_HEALTH_SCHEMA_COLUMNS.items():
        if not inspector.has_table(table_name):
            continue
        existing = {column["name"] for column in inspector.get_columns(table_name)}
        for column_name, column_ddl in columns.items():
            if column_name in existing:
                continue
            try:
                db.execute(text(f"alter table {table_name} add column {column_name} {column_ddl}"))
                db.commit()
                existing.add(column_name)
            except Exception:
                db.rollback()
                refreshed = {column["name"] for column in inspect(bind).get_columns(table_name)}
                if column_name not in refreshed:
                    raise
                existing = refreshed


HEALTH_RAW_FIELD_RANGES = {
    "heart_rate": (30, 220),
    "hrv": (1, 300),
    "spo2": (70, 100),
    "temperature": (25.0, 45.0),
    "blood_sugar": (1.0, 33.3),
    "systolic": (50, 260),
    "diastolic": (30, 180),
}

HEALTH_RECORD_FUTURE_TOLERANCE = timedelta(minutes=10)
HEALTH_TIMEZONE = timezone(timedelta(hours=8))


def max_visible_record_time() -> datetime:
    return datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None) + HEALTH_RECORD_FUTURE_TOLERANCE


def ranged_aggregate_expr(aggregate: str, column: str) -> str:
    field_range = HEALTH_RAW_FIELD_RANGES.get(column)
    if not field_range:
        return f"{aggregate}(nullif({column}, 0))"
    min_value, max_value = field_range
    return f"{aggregate}(case when {column} is not null and {column} >= {min_value} and {column} <= {max_value} then {column} end)"


def avg_expr(column: str) -> str:
    return ranged_aggregate_expr("avg", column)


def min_expr(column: str) -> str:
    return ranged_aggregate_expr("min", column)


def max_expr(column: str) -> str:
    return ranged_aggregate_expr("max", column)


def score(value: float | None, low: float, high: float) -> int | None:
    if value is None:
        return None
    if low <= value <= high:
        return 100
    distance = min(abs(value - low), abs(value - high))
    return max(0, int(100 - distance * 10))


def clamp_score(value: float) -> float:
    return max(0.0, min(100.0, value))


def gaussian(value: float, ideal: float, sigma: float) -> float:
    if sigma <= 0:
        return 1.0 if value == ideal else 0.0
    return math.exp(-((value - ideal) ** 2) / (2 * sigma * sigma))


def calculate_heart_rate_score(values: list[int]) -> int | None:
    if not values:
        return None
    values = sorted(value for value in values if 30 <= value <= 220)
    if not values:
        return None
    rhr_count = max(1, int(len(values) * 0.2))
    rhr_values = values[:rhr_count]
    rhr_avg = sum(rhr_values) / len(rhr_values)
    variance = sum((value - rhr_avg) ** 2 for value in rhr_values) / len(rhr_values)
    rhr_std_dev = math.sqrt(variance)
    score_quality = 60.0 * gaussian(rhr_avg, 60.0, 8.0)
    score_stability = 40.0 * math.exp(-(rhr_std_dev ** 2) / (2 * (5.0 ** 2)))
    return round(clamp_score(score_quality + score_stability))


def calculate_spo2_score(values: list[int]) -> int | None:
    values = [value for value in values if 70 <= value <= 100]
    if not values:
        return None

    def single(value: int) -> float:
        if value >= 95:
            return 100.0
        if value <= 80:
            return 0.0
        return 100.0 * (value - 80) / (95 - 80)

    avg_score = sum(single(value) for value in values) / len(values)
    low_ratio = sum(1 for value in values if value < 90) / len(values)
    penalty = 20 * min(1.0, low_ratio * 5.0)
    return round(clamp_score(0.8 * avg_score - 0.2 * penalty))


def calculate_temperature_score(values: list[float]) -> int | None:
    values = [value for value in values if 30.0 <= value <= 45.0]
    if not values:
        return None
    avg_quality = sum(100 * gaussian(value, 36.7, 0.5) for value in values) / len(values)
    deviation_ratio = sum(1 for value in values if abs(value - 36.7) >= 1.0) / len(values)
    penalty = 20 * min(1.0, deviation_ratio * 5.0)
    return round(clamp_score(0.8 * avg_quality - 0.2 * penalty))


def calculate_hrv_score(value: float | None) -> int | None:
    if value is None or value <= 0:
        return None
    return min(100, int(value * 2))


def estimate_stress_from_hrv(value: float | int | None) -> int | None:
    if value is None:
        return None
    try:
        hrv = float(value)
    except (TypeError, ValueError):
        return None
    if hrv <= 0 or hrv > 300:
        return None
    return max(0, min(100, round(90 - hrv * 1.2)))


def calculate_motion_score(steps: int, mid_high_minutes: int, total_motion_minutes: int) -> int:
    score_value = 0
    if steps >= 10000:
        score_value += 40
    elif steps >= 8000:
        score_value += 35
    elif steps >= 6000:
        score_value += 30
    elif steps >= 4000:
        score_value += 20
    elif steps >= 2000:
        score_value += 10

    if mid_high_minutes >= 30:
        score_value += 40
    elif mid_high_minutes >= 20:
        score_value += 30
    elif mid_high_minutes >= 15:
        score_value += 20
    elif mid_high_minutes >= 10:
        score_value += 10

    if total_motion_minutes >= 60:
        score_value += 20
    elif total_motion_minutes >= 45:
        score_value += 15
    elif total_motion_minutes >= 30:
        score_value += 10
    elif total_motion_minutes >= 15:
        score_value += 5
    step_target_cap = int(min(100, max(0, steps) / 8000 * 100))
    return min(score_value, step_target_cap)


def motion_minutes_from_steps(db: Session, user_id: int, record_date: str) -> dict[str, int]:
    rows = db.execute(
        text(
            """
            select record_time, step_count
            from health_raw
            where user_id=:user_id and date(record_time)=:record_date
              and step_count is not null
              and record_time <= :max_record_time
            order by record_time
            """
        ),
        {"user_id": user_id, "record_date": record_date, "max_record_time": max_visible_record_time()},
    ).mappings().all()
    high_seconds = 0
    medium_seconds = 0
    low_seconds = 0
    previous_time = None
    previous_steps = None
    for row in rows:
        current_time = coerce_datetime(row.get("record_time"))
        current_steps = row.get("step_count")
        if current_time is None or current_steps is None:
            continue
        current_steps = int(current_steps)
        if previous_time is not None and previous_steps is not None:
            seconds = int((current_time - previous_time).total_seconds())
            step_diff = current_steps - previous_steps
            if seconds > 0 and step_diff >= 0:
                cadence = round((step_diff / seconds) * 60.0)
                if cadence <= 220:
                    if cadence > 80:
                        high_seconds += seconds
                    elif cadence >= 70:
                        medium_seconds += seconds
                    elif cadence >= 30:
                        low_seconds += seconds
        previous_time = current_time
        previous_steps = current_steps
    return {
        "mid_high_minutes": int((high_seconds + medium_seconds) / 60),
        "total_motion_minutes": int((high_seconds + medium_seconds + low_seconds) / 60),
    }


def raw_numeric_values(db: Session, user_id: int, record_date: str, column: str) -> list[float]:
    clauses = [
        "user_id=:user_id",
        "date(record_time)=:record_date",
        f"{column} is not null",
        "record_time <= :max_record_time",
    ]
    params: dict[str, Any] = {"user_id": user_id, "record_date": record_date, "max_record_time": max_visible_record_time()}
    field_range = HEALTH_RAW_FIELD_RANGES.get(column)
    if field_range:
        clauses.append(f"{column} >= :min_value and {column} <= :max_value")
        params["min_value"], params["max_value"] = field_range
    else:
        clauses.append(f"{column} > 0")
    rows = db.execute(
        text(
            f"""
            select {column} as value from health_raw
            where {' and '.join(clauses)}
            order by record_time
            """
        ),
        params,
    ).scalars().all()
    return [float(value) for value in rows if value is not None]


def coerce_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        text_value = value.strip()
        if not text_value:
            return None
        normalized = text_value.replace("T", " ").replace("Z", "")
        candidates = [
            normalized,
            normalized[:19],
            normalized[:10],
        ]
        for candidate in candidates:
            try:
                parsed = datetime.fromisoformat(candidate)
                return parsed.replace(tzinfo=None)
            except ValueError:
                continue
    return None


def health_level(value: int | None) -> str | None:
    if value is None:
        return None
    if value >= 85:
        return "优秀"
    if value >= 70:
        return "良好"
    if value >= 60:
        return "正常"
    return "偏低"


def sleep_type_key(value: Any) -> str:
    if value is None:
        return "INVALID"
    text_value = str(value).upper()
    mapping = {
        "0": "INVALID",
        "1": "AWAKE",
        "2": "REM",
        "3": "LIGHT",
        "4": "DEEP",
        "5": "NAP",
        "INVALID": "INVALID",
        "AWAKE": "AWAKE",
        "REM": "REM",
        "LIGHT": "LIGHT",
        "DEEP": "DEEP",
        "NAP": "NAP",
    }
    return mapping.get(text_value, "INVALID")


def calculate_sleep_score(awake: int, rem: int, light: int, deep: int, nap: int) -> int:
    total_time = awake + rem + light + deep + nap
    if total_time <= 0:
        return 0
    score_duration = 25 * min(1.0, total_time / 480.0)
    score_deep = 25 * gaussian(deep / total_time, 0.18, 0.1)
    score_light = 20 * gaussian(light / total_time, 0.55, 0.1)
    score_rem = 15 * gaussian(rem / total_time, 0.22, 0.1)
    score_awake = 10 * math.exp(-(awake / 60.0))
    restorative_time = rem + light + deep
    score_efficiency = 5 * min(1.0, (restorative_time / total_time) / 0.90)
    return round(clamp_score(score_duration + score_deep + score_light + score_rem + score_awake + score_efficiency))


def calculate_sleep_efficiency(awake: int, rem: int, light: int, deep: int, nap: int) -> float:
    total_time = awake + rem + light + deep + nap
    if total_time <= 0:
        return 0.0
    return round(((rem + light + deep) / total_time) * 100.0, 2)


def sleep_summary_from_records(db: Session, user_id: int, record_date: str) -> dict[str, Any]:
    rows = db.execute(
        text(
            """
            select type, start_time, end_time, sleep_time
            from sleep_record
            where user_id=:user_id and date_ref=:record_date
            order by start_time
            """
        ),
        {"user_id": user_id, "record_date": record_date},
    ).mappings().all()
    values = {"AWAKE": 0, "REM": 0, "LIGHT": 0, "DEEP": 0, "NAP": 0}
    awake_count = 0
    sleep_start = None
    sleep_end = None
    for row in rows:
        key = sleep_type_key(row.get("type"))
        minutes = max(int(row.get("sleep_time") or 0), 0)
        if key in values:
            values[key] += minutes
        if key == "AWAKE":
            awake_count += 1
        start_time = coerce_datetime(row.get("start_time"))
        end_time = coerce_datetime(row.get("end_time"))
        if start_time is not None and (sleep_start is None or start_time < sleep_start):
            sleep_start = start_time
        if end_time is not None and (sleep_end is None or end_time > sleep_end):
            sleep_end = end_time

    total_sleep = values["REM"] + values["LIGHT"] + values["DEEP"] + values["NAP"]
    return {
        "sleep_total_time": total_sleep,
        "sleep_deep_time": values["DEEP"],
        "sleep_light_time": values["LIGHT"],
        "sleep_rem_time": values["REM"],
        "sleep_awake_time": values["AWAKE"],
        "sleep_awake_count": awake_count,
        "sleep_start_time": sleep_start,
        "sleep_end_time": sleep_end,
        "sleep_efficiency": calculate_sleep_efficiency(values["AWAKE"], values["REM"], values["LIGHT"], values["DEEP"], values["NAP"]),
        "sleep_score": calculate_sleep_score(values["AWAKE"], values["REM"], values["LIGHT"], values["DEEP"], values["NAP"]) if rows else None,
    }


def sleep_summary_from_raw(db: Session, user_id: int, record_date: str) -> dict[str, Any]:
    rows = db.execute(
        text(
            """
            select record_time, sleep_state
            from health_raw
            where user_id=:user_id and date(record_time)=:record_date
              and sleep_state is not null
              and record_time <= :max_record_time
            order by record_time
            """
        ),
        {"user_id": user_id, "record_date": record_date, "max_record_time": max_visible_record_time()},
    ).mappings().all()
    values = {"AWAKE": 0, "REM": 0, "LIGHT": 0, "DEEP": 0, "NAP": 0}
    awake_count = 0
    sleep_start = None
    sleep_end = None
    sleep_keys = {"REM", "LIGHT", "DEEP", "NAP"}
    valid_rows = [
        (coerce_datetime(row.get("record_time")), sleep_type_key(row.get("sleep_state")))
        for row in rows
        if sleep_type_key(row.get("sleep_state")) != "INVALID"
    ]
    for index, (record_time, key) in enumerate(valid_rows):
        if record_time is None:
            continue
        minutes = 5
        if index + 1 < len(valid_rows) and valid_rows[index + 1][0] is not None:
            seconds = int((valid_rows[index + 1][0] - record_time).total_seconds())
            if 0 < seconds <= 900:
                minutes = max(1, round(seconds / 60))
        if key in values:
            values[key] += minutes
        if key == "AWAKE":
            awake_count += 1
        if key in sleep_keys:
            if sleep_start is None or record_time < sleep_start:
                sleep_start = record_time
            current_end = record_time + timedelta(minutes=minutes)
            if sleep_end is None or current_end > sleep_end:
                sleep_end = current_end

    total_sleep = values["REM"] + values["LIGHT"] + values["DEEP"] + values["NAP"]
    return {
        "sleep_total_time": total_sleep,
        "sleep_deep_time": values["DEEP"],
        "sleep_light_time": values["LIGHT"],
        "sleep_rem_time": values["REM"],
        "sleep_awake_time": values["AWAKE"],
        "sleep_awake_count": awake_count,
        "sleep_start_time": sleep_start,
        "sleep_end_time": sleep_end,
        "sleep_efficiency": calculate_sleep_efficiency(values["AWAKE"], values["REM"], values["LIGHT"], values["DEEP"], values["NAP"]),
        "sleep_score": calculate_sleep_score(values["AWAKE"], values["REM"], values["LIGHT"], values["DEEP"], values["NAP"]) if total_sleep else None,
    }


def ensure_girl_health_table(db: Session) -> None:
    db.execute(
        text(
            """
            create table if not exists user_girl_health (
              id bigint primary key auto_increment,
              user_id bigint not null,
              birth_day date null,
              create_time datetime null,
              last_period_time varchar(512) null,
              is_rule_type int null,
              period_cycle int null,
              period_runtime int null,
              other_unhealth varchar(512) null,
              is_pregnancy int null,
              last_period_time_point varchar(32) null,
              last_time_over varchar(32) null,
              key idx_user_girl_health_user_id (user_id)
            ) engine=InnoDB default charset=utf8mb4
            """
        )
    )
    db.commit()


def health_level(value: int | None) -> str | None:
    if value is None:
        return None
    if value >= 85:
        return "\u4f18\u79c0"
    if value >= 70:
        return "\u826f\u597d"
    if value >= 60:
        return "\u6b63\u5e38"
    return "\u504f\u4f4e"


def calculate_daily_summary(db: Session, user_id: int, record_date: str | date) -> dict[str, Any]:
    if isinstance(record_date, date):
        record_date = record_date.isoformat()
    row = db.execute(
        text(
            f"""
            select
              max(device_mac) as device_mac,
              max(coalesce(step_count, 0)) as total_steps,
              max(coalesce(step_count, 0)) as max_steps,
              {avg_expr("heart_rate")} as heart_rate_avg,
              {min_expr("heart_rate")} as heart_rate_min,
              {max_expr("heart_rate")} as heart_rate_max,
              {avg_expr("hrv")} as hrv_avg,
              {min_expr("hrv")} as hrv_min,
              {max_expr("hrv")} as hrv_max,
              {avg_expr("spo2")} as spo2_avg,
              {min_expr("spo2")} as spo2_min,
              {max_expr("spo2")} as spo2_max,
              {avg_expr("temperature")} as temperature_avg,
              {min_expr("temperature")} as temperature_min,
              {max_expr("temperature")} as temperature_max,
              avg(case when stress is not null and stress >= 0 and stress <= 100 then stress end) as stress_avg,
              min(case when stress is not null and stress >= 0 and stress <= 100 then stress end) as stress_min,
              max(case when stress is not null and stress >= 0 and stress <= 100 then stress end) as stress_max,
              {avg_expr("blood_sugar")} as blood_sugar_avg,
              {min_expr("blood_sugar")} as blood_sugar_min,
              {max_expr("blood_sugar")} as blood_sugar_max,
              {avg_expr("systolic")} as systolic_avg,
              {min_expr("systolic")} as systolic_min,
              {max_expr("systolic")} as systolic_max,
              {avg_expr("diastolic")} as diastolic_avg,
              {min_expr("diastolic")} as diastolic_min,
              {max_expr("diastolic")} as diastolic_max,
              sum(case when stress between 0 and 29 then 1 else 0 end) as stress_relaxed_time,
              sum(case when stress between 30 and 49 then 1 else 0 end) as stress_normal_time,
              sum(case when stress between 50 and 69 then 1 else 0 end) as stress_medium_time,
              sum(case when stress between 70 and 100 then 1 else 0 end) as stress_high_time,
              sum(case when motion_intensity is not null and motion_intensity > 0 then 1 else 0 end) as active_time,
              sum(case when sleep_state is not null then 1 else 0 end) as sleep_total_time
            from health_raw
            where user_id=:user_id and date(record_time)=:record_date
              and record_time <= :max_record_time
            """
        ),
        {"user_id": user_id, "record_date": record_date, "max_record_time": max_visible_record_time()},
    ).mappings().first()
    data = dict(row or {})
    if not data or all(
        data.get(key) is None
        for key in (
            "heart_rate_avg",
            "spo2_avg",
            "temperature_avg",
            "stress_avg",
            "blood_sugar_avg",
            "systolic_avg",
            "diastolic_avg",
        )
    ) and not data.get("total_steps"):
        return {}

    total_steps = int(data.get("total_steps") or 0)
    motion_minutes = motion_minutes_from_steps(db, user_id, record_date)
    active_time = motion_minutes["total_motion_minutes"]
    mid_high_minutes = motion_minutes["mid_high_minutes"]
    motion_score = calculate_motion_score(total_steps, mid_high_minutes, active_time) if total_steps else None
    heart_values = [int(value) for value in raw_numeric_values(db, user_id, record_date, "heart_rate")]
    spo2_values = [int(value) for value in raw_numeric_values(db, user_id, record_date, "spo2")]
    temp_values = raw_numeric_values(db, user_id, record_date, "temperature")
    heart_score = calculate_heart_rate_score(heart_values)
    hrv_score = calculate_hrv_score(float(data["hrv_avg"])) if data.get("hrv_avg") is not None else None
    spo2_score = calculate_spo2_score(spo2_values)
    temp_score = calculate_temperature_score(temp_values)
    effective_stress_avg = data.get("stress_avg")
    if effective_stress_avg is None:
        effective_stress_avg = estimate_stress_from_hrv(data.get("hrv_avg"))
    stress_score = max(0, 100 - int(float(effective_stress_avg))) if effective_stress_avg is not None else None
    sleep_data = sleep_summary_from_records(db, user_id, record_date)
    if not sleep_data.get("sleep_total_time"):
        sleep_data = sleep_summary_from_raw(db, user_id, record_date)
    sleep_score = sleep_data.get("sleep_score")
    score_values = [item for item in (motion_score, heart_score, hrv_score, spo2_score, temp_score, stress_score, sleep_score) if item is not None]
    health_score = int(sum(score_values) / len(score_values)) if score_values else None

    values = {
        "user_id": user_id,
        "device_mac": data.get("device_mac"),
        "record_date": record_date,
        "total_steps": total_steps,
        "total_distance": round(total_steps * 0.0007, 2),
        "total_calorie": round(total_steps * 0.04, 2),
        "active_time": active_time,
        "motion_score": motion_score,
        "heart_rate_avg": data.get("heart_rate_avg"),
        "heart_rate_min": data.get("heart_rate_min"),
        "heart_rate_max": data.get("heart_rate_max"),
        "heart_rate_score": heart_score,
        "hrv_avg": data.get("hrv_avg"),
        "hrv_min": data.get("hrv_min"),
        "hrv_max": data.get("hrv_max"),
        "hrv_score": hrv_score,
        "spo2_avg": data.get("spo2_avg"),
        "spo2_min": data.get("spo2_min"),
        "spo2_max": data.get("spo2_max"),
        "spo2_score": spo2_score,
        "temperature_avg": data.get("temperature_avg"),
        "temperature_min": data.get("temperature_min"),
        "temperature_max": data.get("temperature_max"),
        "temperature_score": temp_score,
        "stress_avg": effective_stress_avg,
        "stress_min": data.get("stress_min") if data.get("stress_min") is not None else effective_stress_avg,
        "stress_max": data.get("stress_max") if data.get("stress_max") is not None else effective_stress_avg,
        "blood_sugar_avg": data.get("blood_sugar_avg"),
        "blood_sugar_min": data.get("blood_sugar_min"),
        "blood_sugar_max": data.get("blood_sugar_max"),
        "systolic_avg": data.get("systolic_avg"),
        "systolic_min": data.get("systolic_min"),
        "systolic_max": data.get("systolic_max"),
        "diastolic_avg": data.get("diastolic_avg"),
        "diastolic_min": data.get("diastolic_min"),
        "diastolic_max": data.get("diastolic_max"),
        "stress_relaxed_time": int(data.get("stress_relaxed_time") or 0),
        "stress_normal_time": int(data.get("stress_normal_time") or 0),
        "stress_medium_time": int(data.get("stress_medium_time") or 0),
        "stress_high_time": int(data.get("stress_high_time") or 0),
        "stress_score": stress_score,
        "sleep_total_time": int(sleep_data.get("sleep_total_time") or 0),
        "sleep_deep_time": int(sleep_data.get("sleep_deep_time") or 0),
        "sleep_light_time": int(sleep_data.get("sleep_light_time") or 0),
        "sleep_rem_time": int(sleep_data.get("sleep_rem_time") or 0),
        "sleep_awake_time": int(sleep_data.get("sleep_awake_time") or 0),
        "sleep_awake_count": int(sleep_data.get("sleep_awake_count") or 0),
        "sleep_start_time": sleep_data.get("sleep_start_time"),
        "sleep_end_time": sleep_data.get("sleep_end_time"),
        "sleep_efficiency": sleep_data.get("sleep_efficiency"),
        "sleep_score": sleep_score,
        "health_score": health_score,
        "health_level": health_level(health_score),
        "update_time": datetime.now(),
    }
    existing = db.execute(
        text("select id from health_daily_summary where user_id=:user_id and record_date=:record_date limit 1"),
        {"user_id": user_id, "record_date": record_date},
    ).scalar()
    table = get_table("health_daily_summary")
    if existing:
        db.execute(table.update().where(table.c.id == existing).values(**{k: v for k, v in values.items() if k in table.c}))
    else:
        values["create_time"] = datetime.now()
        db.execute(table.insert().values(**{k: v for k, v in values.items() if k in table.c}))
    db.commit()
    return daily_summary(db, user_id, record_date) or {}


def daily_summary(db: Session, user_id: int, record_date: str | date | None = None) -> dict[str, Any] | None:
    if isinstance(record_date, date):
        record_date = record_date.isoformat()
    if record_date:
        row = db.execute(
            text("select * from health_daily_summary where user_id=:user_id and record_date=:record_date order by update_time desc limit 1"),
            {"user_id": user_id, "record_date": record_date},
        ).first()
        if not row:
            return calculate_daily_summary(db, user_id, record_date)
    else:
        row = db.execute(
            text("select * from health_daily_summary where user_id=:user_id order by record_date desc limit 1"),
            {"user_id": user_id},
        ).first()
    return camelize_dict(dict(row._mapping)) if row else None


def upsert_girl_health(db: Session, user_id: int, payload: dict[str, Any], create: bool) -> int:
    ensure_girl_health_table(db)
    table = get_table("user_girl_health")
    payload = dict(payload)
    if isinstance(payload.get("lastPeriodTime"), list):
        payload["lastPeriodTime"] = ",".join(str(item) for item in payload["lastPeriodTime"])
    values = clean_payload(table, payload)
    values["user_id"] = user_id
    values.setdefault("create_time", datetime.now())
    if create:
        db.execute(table.insert().values(**values))
    else:
        row_id = values.pop("id", None) or db.execute(text("select id from user_girl_health where user_id=:user_id limit 1"), {"user_id": user_id}).scalar()
        if row_id:
            db.execute(table.update().where(table.c.id == row_id).values(**values))
        else:
            db.execute(table.insert().values(**values))
    db.commit()
    return 1


def get_girl_health(db: Session, user_id: int) -> dict[str, Any] | None:
    ensure_girl_health_table(db)
    row = db.execute(text("select * from user_girl_health where user_id=:user_id limit 1"), {"user_id": user_id}).first()
    return camelize_dict(dict(row._mapping)) if row else None
