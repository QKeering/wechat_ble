import csv
import io
import json
import logging
import math
import re
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from time import perf_counter
from urllib.parse import urlencode
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request, UploadFile
from fastapi.responses import StreamingResponse
from redis import Redis
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.responses import error, not_migrated, success, table
from app.db.redis import get_redis
from app.db.session import SessionLocal, get_db
from app.services import ai_growth, ai_lab, app_auth, family, health
from app.services.crud import camelize_dict, clean_payload, get_row, get_table, list_rows

router = APIRouter(prefix="/app", tags=["app"])

APP_TIMEZONE = timezone(timedelta(hours=8))
CALORIE_UNIT = "千卡"

ALGORITHM_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
ALGORITHM_LOG_DIR.mkdir(parents=True, exist_ok=True)
ALGORITHM_LOG_PATH = ALGORITHM_LOG_DIR / "algorithm_calls.log"
algorithm_logger = logging.getLogger("qkeer.algorithm")
if not algorithm_logger.handlers:
    algorithm_handler = RotatingFileHandler(ALGORITHM_LOG_PATH, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
    algorithm_handler.setFormatter(logging.Formatter("%(message)s"))
    algorithm_logger.addHandler(algorithm_handler)
    algorithm_logger.setLevel(logging.INFO)
    algorithm_logger.propagate = False


def write_algorithm_log(event: str, **data) -> None:
    record = {"time": datetime.now().isoformat(timespec="seconds"), "event": event, **data}
    try:
        algorithm_logger.info(json.dumps(record, ensure_ascii=False, default=str))
    except Exception:
        pass


def recalculate_sync_summaries(user_id: int, dates: list[str]) -> None:
    db = SessionLocal()
    started_at = perf_counter()
    summary_dates = []
    try:
        for item_date in sorted(set(dates)):
            if not item_date:
                continue
            item_started_at = perf_counter()
            try:
                summary = health.calculate_daily_summary(db, user_id, item_date)
                summary_dates.append({
                    "date": item_date,
                    "elapsedMs": round((perf_counter() - item_started_at) * 1000),
                    "hasSummary": bool(summary),
                })
            except Exception as exc:
                db.rollback()
                summary_dates.append({
                    "date": item_date,
                    "elapsedMs": round((perf_counter() - item_started_at) * 1000),
                    "error": str(exc),
                })
        write_algorithm_log(
            "data_sync_summary",
            user_id=user_id,
            elapsed_ms=round((perf_counter() - started_at) * 1000),
            summary_dates=summary_dates,
        )
    finally:
        db.close()


def request_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def app_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    token: str | None = Header(default=None, alias="token"),
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> dict:
    return app_auth.current_user(db, redis, authorization or token)


def compare_version(v1: str | None, v2: str | None) -> int:
    if not v1 or not v2:
        return 0

    def split(value: str) -> list[str]:
        value = re.sub(r"^[vV]", "", value)
        parts: list[str] = []
        for dot_part in value.split("."):
            parts.extend(re.findall(r"\d+|[A-Za-z]+", dot_part))
        return parts

    p1, p2 = split(v1), split(v2)
    for index in range(max(len(p1), len(p2))):
        a = p1[index] if index < len(p1) else ""
        b = p2[index] if index < len(p2) else ""
        if a == b:
            continue
        if a.isdigit() and b.isdigit():
            return (int(a) > int(b)) - (int(a) < int(b))
        if a.isdigit():
            return 1
        if b.isdigit():
            return -1
        return (a.lower() > b.lower()) - (a.lower() < b.lower())
    return 0


def daily_summary(db: Session, user_id: int, date_value: str | None = None) -> dict | None:
    return health.daily_summary(db, user_id, date_value)


RAW_SERIES_FIELD_RANGES = {
    "step_count": (1, 2_000_000),
    "heart_rate": (30, 220),
    "hrv": (1, 300),
    "spo2": (70, 100),
    "stress": (0, 100),
    "temperature": (25.0, 45.0),
    "blood_sugar": (1.0, 33.3),
    "systolic": (50, 260),
    "diastolic": (30, 180),
    "motion_intensity": (0, 4),
}

SYNC_RECORD_MIN_DATE = date(2020, 1, 1)
SYNC_RECORD_FUTURE_TOLERANCE = timedelta(minutes=10)
SYNC_INLINE_SUMMARY_DATE_LIMIT = 3


def current_app_datetime() -> datetime:
    return datetime.now(APP_TIMEZONE).replace(tzinfo=None)


def max_visible_record_time() -> datetime:
    return current_app_datetime() + SYNC_RECORD_FUTURE_TOLERANCE


def normalize_sync_record_time_for_storage(record_time: datetime) -> datetime | None:
    if record_time.date() < SYNC_RECORD_MIN_DATE:
        return None
    if record_time > max_visible_record_time():
        return None
    return record_time


def raw_series(db: Session, user_id: int, date_value: str | None, field: str) -> list[dict]:
    if field not in RAW_SERIES_FIELD_RANGES:
        raise ValueError(f"unsupported health_raw field: {field}")
    clauses = ["user_id=:user_id", f"{field} is not null", "record_time <= :max_record_time"]
    params = {"user_id": user_id, "max_record_time": max_visible_record_time()}
    min_value, max_value = RAW_SERIES_FIELD_RANGES[field]
    clauses.append(f"{field} >= :min_value and {field} <= :max_value")
    params["min_value"] = min_value
    params["max_value"] = max_value
    if date_value:
        clauses.append("date(record_time)=:date_value")
        params["date_value"] = date_value
    rows = db.execute(
        text(f"select record_time, device_mac, {field} as value from health_raw where {' and '.join(clauses)} order by record_time"),
        params,
    ).all()
    return [camelize_dict(dict(row._mapping)) for row in rows]


def date_from_request(request: Request) -> str | None:
    return request.query_params.get("date") or request.query_params.get("recordDate")


def request_date_or_today(request: Request) -> date:
    value = date_from_request(request)
    if value:
        try:
            return datetime.strptime(value[:10], "%Y-%m-%d").date()
        except ValueError:
            pass
    return date.today()


def sleep_type_key(value) -> str:
    return health.sleep_type_key(value)


def sleep_minutes_by_type(rows) -> dict[str, int]:
    values = {"INVALID": 0, "AWAKE": 0, "REM": 0, "LIGHT": 0, "DEEP": 0, "NAP": 0}
    for row in rows:
        item = dict(row._mapping)
        key = sleep_type_key(item.get("type"))
        minutes = int(item.get("sleep_time") or 0)
        values[key] += max(minutes, 0)
    return values


def sleep_minutes_from_raw(db: Session, user_id: int, date_value: str | None) -> dict[str, int]:
    values = {"INVALID": 0, "AWAKE": 0, "REM": 0, "LIGHT": 0, "DEEP": 0, "NAP": 0}
    rows = db.execute(
        text(
            """
            select record_time, sleep_state
            from health_raw
            where user_id=:user_id and (:date_value is null or date(record_time)=:date_value)
              and sleep_state is not null
              and record_time <= :max_record_time
            order by record_time
            """
        ),
        {"user_id": user_id, "date_value": date_value, "max_record_time": max_visible_record_time()},
    ).mappings().all()
    if not rows:
        return values
    items = [
        (row["record_time"], sleep_type_key(row["sleep_state"]))
        for row in rows
        if row["record_time"] is not None and sleep_type_key(row["sleep_state"]) != "INVALID"
    ]
    for index, (record_time, key) in enumerate(items):
        minutes = 5
        if index + 1 < len(items):
            delta = int((items[index + 1][0] - record_time).total_seconds())
            if 0 < delta <= 900:
                minutes = max(1, round(delta / 60))
        values[key] += minutes
    return values


def effective_sleep_values(db: Session, user_id: int, date_value: str | None, records=None) -> dict[str, int]:
    records = records if records is not None else sleep_records(db, user_id, date_value)
    values = sleep_minutes_by_type(records)
    if values["REM"] + values["LIGHT"] + values["DEEP"] + values["NAP"] > 0:
        return values
    return sleep_minutes_from_raw(db, user_id, date_value)


def raw_sleep_state_rows(db: Session, user_id: int, date_value: str | None) -> list[dict]:
    rows = db.execute(
        text(
            """
            select record_time, sleep_state
            from health_raw
            where user_id=:user_id and (:date_value is null or date(record_time)=:date_value)
              and sleep_state is not null
              and record_time <= :max_record_time
            order by record_time
            """
        ),
        {"user_id": user_id, "date_value": date_value, "max_record_time": max_visible_record_time()},
    ).mappings().all()
    return [dict(row) for row in rows if sleep_type_key(row.get("sleep_state")) != "INVALID"]


def raw_sleep_chart_data(db: Session, user_id: int, date_value: str | None) -> list[dict]:
    rows = raw_sleep_state_rows(db, user_id, date_value)
    chart = []
    for index, row in enumerate(rows):
        record_time = row.get("record_time")
        if not isinstance(record_time, datetime):
            continue
        minutes = 5
        if index + 1 < len(rows):
            next_time = rows[index + 1].get("record_time")
            if isinstance(next_time, datetime):
                seconds = int((next_time - record_time).total_seconds())
                if 0 < seconds <= 900:
                    minutes = max(1, round(seconds / 60))
        chart.append({
            "time": record_time.strftime("%H:%M"),
            "value": str(minutes),
            "sleepType": sleep_type_key(row.get("sleep_state")),
        })
    return chart


def raw_sleep_time_range(db: Session, user_id: int, date_value: str | None) -> tuple[str, str]:
    if not date_value:
        return "00:00", "00:00"
    summary = health.sleep_summary_from_raw(db, user_id, date_value)
    start_time = summary.get("sleep_start_time")
    end_time = summary.get("sleep_end_time")
    return (
        start_time.strftime("%H:%M") if isinstance(start_time, datetime) else "00:00",
        end_time.strftime("%H:%M") if isinstance(end_time, datetime) else "00:00",
    )


def gaussian(value: float, ideal: float, sigma: float) -> float:
    return math.exp(-((value - ideal) ** 2) / (2 * sigma * sigma))


def clamp_score(value: float) -> float:
    return max(0.0, min(100.0, value))


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
    return ((rem + light + deep) / total_time) * 100.0


def sleep_records(db: Session, user_id: int, date_value: str | None):
    return db.execute(
        text(
            """
            select * from sleep_record
            where user_id=:user_id and (:date_value is null or date_ref=:date_value)
            order by start_time
            """
        ),
        {"user_id": user_id, "date_value": date_value},
    ).all()


def stress_records(db: Session, user_id: int, date_value: str | None = None, days: int | None = None, include_hrv_only: bool = False):
    params = {"user_id": user_id, "date_value": date_value, "days": max((days or 1) - 1, 0), "max_record_time": max_visible_record_time()}
    if days and date_value:
        date_clause = "date(record_time) between date_sub(:date_value, interval :days day) and :date_value"
    elif date_value:
        date_clause = "date(record_time)=:date_value"
    else:
        date_clause = "1=1"
    metric_clause = (
        "((stress is not null and stress >= 0 and stress <= 100) or (hrv is not null and hrv >= 1 and hrv <= 300))"
        if include_hrv_only
        else "(stress is not null and stress >= 0 and stress <= 100)"
    )
    return db.execute(
        text(
            f"""
            select record_time, stress, hrv from health_raw
            where user_id=:user_id and {date_clause}
              and {metric_clause}
              and record_time <= :max_record_time
            order by record_time
            """
        ),
        params,
    ).all()


def stress_level(value: int) -> str:
    if value <= 29:
        return "放松"
    if value <= 49:
        return "正常"
    if value <= 69:
        return "中等"
    if value <= 89:
        return "偏高"
    return "很高"


def stress_bucket(value: int) -> str:
    if value < 30:
        return "放松"
    if value < 50:
        return "正常"
    if value < 70:
        return "中等"
    return "偏高"


def format_stress_record_time(value, time_format: str = "%H:%M") -> str:
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.strftime(time_format)
    text_value = str(value).strip()
    if not text_value:
        return ""
    try:
        return datetime.fromisoformat(text_value.replace("T", " ").replace("Z", "")[:19]).strftime(time_format)
    except ValueError:
        if time_format == "%H:%M" and len(text_value) >= 16:
            return text_value[11:16]
        if time_format == "%m-%d" and len(text_value) >= 10:
            return text_value[5:10]
        return text_value


def row_mapping(row) -> dict:
    return dict(row._mapping) if hasattr(row, "_mapping") else dict(row or {})


def stress_value_from_row(row) -> int | None:
    mapping = row_mapping(row)
    raw_stress = mapping.get("stress")
    if raw_stress is not None and raw_stress != "":
        stress = valid_range(raw_stress, 0, 100)
        if stress is not None:
            return int(round(stress))
    return health.estimate_stress_from_hrv(mapping.get("hrv"))


def stress_chart(rows, time_format: str = "%H:%M") -> list[dict]:
    return [
        {
            "time": format_stress_record_time(row_mapping(row).get("record_time"), time_format),
            "value": str(stress_value),
        }
        for row in rows
        for stress_value in [stress_value_from_row(row)]
        if stress_value is not None
    ]


def stress_counts(rows) -> dict[str, int]:
    values = {"放松": 0, "正常": 0, "中等": 0, "偏高": 0}
    for row in rows:
        stress_value = stress_value_from_row(row)
        if stress_value is not None:
            values[stress_bucket(stress_value)] += 1
    return values


def raw_points(db: Session, user_id: int, date_value: str | None, field: str) -> list[dict]:
    return [
        {
            "time": str(item.get("recordTime") or "")[11:16],
            "value": str(item.get("value") or 0),
        }
        for item in raw_series(db, user_id, date_value, field)
    ]


def raw_values(db: Session, user_id: int, date_value: str | None, field: str) -> list[float]:
    return [
        float(item.get("value") or 0)
        for item in raw_series(db, user_id, date_value, field)
        if item.get("value") is not None
    ]


def raw_step_total(db: Session, user_id: int, date_value: str | None) -> int:
    return int(max(raw_values(db, user_id, date_value, "step_count") or [0]))


def summary_steps_or_raw(db: Session, user_id: int, date_value: str | None, summary: dict | None) -> int:
    summary_steps = int((summary or {}).get("totalSteps") or 0)
    if summary_steps > 0 or not date_value:
        return summary_steps
    return raw_step_total(db, user_id, date_value)


def raw_metric_stats(db: Session, user_id: int, date_value: str | None, field: str) -> dict:
    values = raw_values(db, user_id, date_value, field)
    return {
        "values": values,
        "avg": (sum(values) / len(values)) if values else None,
        "min": min(values) if values else None,
        "max": max(values) if values else None,
        "latest": values[-1] if values else None,
    }


def summary_metric_or_raw(summary: dict | None, key: str, stats: dict, zero_invalid: bool = True):
    value = (summary or {}).get(key)
    if value not in (None, ""):
        try:
            if not zero_invalid or float(value) != 0:
                return value
        except (TypeError, ValueError):
            return value
    return stats.get("avg")


def build_vital_sign_payload(db: Session, user_id: int, date_value: str | None) -> dict:
    summary = daily_summary(db, user_id, date_value) or {}
    heart_stats = raw_metric_stats(db, user_id, date_value, "heart_rate")
    spo2_stats = raw_metric_stats(db, user_id, date_value, "spo2")
    hrv_stats = raw_metric_stats(db, user_id, date_value, "hrv")
    temperature_stats = raw_metric_stats(db, user_id, date_value, "temperature")
    stress_stats = raw_metric_stats(db, user_id, date_value, "stress")
    blood_sugar_stats = raw_metric_stats(db, user_id, date_value, "blood_sugar")
    systolic_stats = raw_metric_stats(db, user_id, date_value, "systolic")
    diastolic_stats = raw_metric_stats(db, user_id, date_value, "diastolic")

    heart_rate_avg = summary_metric_or_raw(summary, "heartRateAvg", heart_stats)
    spo2_avg = summary_metric_or_raw(summary, "spo2Avg", spo2_stats)
    hrv_avg = summary_metric_or_raw(summary, "hrvAvg", hrv_stats)
    temperature_avg = summary_metric_or_raw(summary, "temperatureAvg", temperature_stats)
    stress_avg = summary_metric_or_raw(summary, "stressAvg", stress_stats, zero_invalid=False)
    blood_sugar_avg = summary_metric_or_raw(summary, "bloodSugarAvg", blood_sugar_stats)
    systolic_avg = summary_metric_or_raw(summary, "systolicAvg", systolic_stats)
    diastolic_avg = summary_metric_or_raw(summary, "diastolicAvg", diastolic_stats)

    vital_scores = [
        summary.get("heartRateScore") if summary.get("heartRateScore") is not None else l3_score_heart_rate(heart_rate_avg),
        summary.get("spo2Score") if summary.get("spo2Score") is not None else l3_score_spo2(spo2_avg),
        summary.get("temperatureScore")
        if summary.get("temperatureScore") is not None
        else health.calculate_temperature_score(temperature_stats["values"]),
    ]
    vital_scores = [item for item in vital_scores if item is not None]
    return {
        "overallScore": round(sum(vital_scores) / len(vital_scores)) if vital_scores else summary.get("healthScore"),
        "heartRate": round(float(heart_rate_avg or 0)),
        "spo2": round(float(spo2_avg or 0)),
        "heartRateChart": raw_points(db, user_id, date_value, "heart_rate"),
        "heartRateAvg": heart_rate_avg,
        "hrv": hrv_avg,
        "hrvAvg": hrv_avg,
        "hrvMin": summary.get("hrvMin") if summary.get("hrvMin") is not None else hrv_stats["min"],
        "hrvMax": summary.get("hrvMax") if summary.get("hrvMax") is not None else hrv_stats["max"],
        "hrvChart": raw_points(db, user_id, date_value, "hrv"),
        "spo2Avg": spo2_avg,
        "temperatureAvg": temperature_avg,
        "stressAvg": stress_avg,
        "bloodSugar": blood_sugar_avg,
        "bloodSugarAvg": blood_sugar_avg,
        "bloodSugarMin": summary.get("bloodSugarMin") if summary.get("bloodSugarMin") is not None else blood_sugar_stats["min"],
        "bloodSugarMax": summary.get("bloodSugarMax") if summary.get("bloodSugarMax") is not None else blood_sugar_stats["max"],
        "bloodSugarChart": raw_points(db, user_id, date_value, "blood_sugar"),
        "systolic": systolic_avg,
        "diastolic": diastolic_avg,
        "bloodPressure": f"{round(float(systolic_avg))}/{round(float(diastolic_avg))}" if systolic_avg is not None and diastolic_avg is not None else None,
        "systolicAvg": systolic_avg,
        "systolicMin": summary.get("systolicMin") if summary.get("systolicMin") is not None else systolic_stats["min"],
        "systolicMax": summary.get("systolicMax") if summary.get("systolicMax") is not None else systolic_stats["max"],
        "diastolicAvg": diastolic_avg,
        "diastolicMin": summary.get("diastolicMin") if summary.get("diastolicMin") is not None else diastolic_stats["min"],
        "diastolicMax": summary.get("diastolicMax") if summary.get("diastolicMax") is not None else diastolic_stats["max"],
        "systolicChart": raw_points(db, user_id, date_value, "systolic"),
        "diastolicChart": raw_points(db, user_id, date_value, "diastolic"),
        "algorithm": {},
        "summary": summary,
    }


def data_detail_response(
    db: Session,
    user_id: int,
    date_value: str | None,
    field: str,
    score_field: str | None = None,
    summary_avg_field: str | None = None,
    latest_desc: str | None = None,
) -> dict:
    summary = daily_summary(db, user_id, date_value) or {}
    values = raw_values(db, user_id, date_value, field)
    avg_value = sum(values) / len(values) if values else summary.get(summary_avg_field or "")
    min_value = min(values) if values else None
    max_value = max(values) if values else None
    new_value = values[-1] if values else None
    return localize_payload_levels({
        "healthScore": summary.get(score_field) if score_field else summary.get("healthScore"),
        "latestDesc": latest_desc or summary.get("healthLevel"),
        "minValue": str(round(min_value, 2)) if min_value is not None else "0",
        "maxValue": str(round(max_value, 2)) if max_value is not None else "0",
        "newValue": str(round(new_value, 2)) if new_value is not None else "0",
        "avgValue": str(round(float(avg_value or 0), 2)),
        "avgValueRange": f"{round(float(min_value or 0), 2)}-{round(float(max_value or 0), 2)}",
        "baseValue": str(round(float(avg_value or 0), 2)),
        "baseValueMax": str(round(float(max_value or 0), 2)),
        "baseValueMin": str(round(float(min_value or 0), 2)),
        "diffValue": "0",
        "type": "day",
        "granularity": "hour",
        "startDate": date_value,
        "endDate": date_value,
        "chartData": raw_points(db, user_id, date_value, field),
    })


def motion_intensity_counts(db: Session, user_id: int, date_value: str | None) -> dict[str, int]:
    rows = raw_series(db, user_id, date_value, "motion_intensity")
    counts = {"inactive": 0, "low": 0, "moderate": 0, "high": 0}
    for item in rows:
        value = int(item.get("value") or 0)
        if value <= 0:
            counts["inactive"] += 1
        elif value == 1:
            counts["low"] += 1
        elif value == 2:
            counts["moderate"] += 1
        else:
            counts["high"] += 1
    return counts


def health_report_payload(db: Session, user: dict, request: Request) -> dict:
    user_id = int(user["id"])
    summary = daily_summary(db, user_id, date.today().isoformat()) or {}
    heart_rate = request.query_params.get("heartRate") or summary.get("heartRateAvg") or 0
    hrv = request.query_params.get("hrv") or summary.get("hrvAvg") or 0
    spo2 = request.query_params.get("spo2") or summary.get("spo2Avg") or 0
    temperature = request.query_params.get("temperature") or summary.get("temperatureAvg") or 0
    stress = request.query_params.get("stress") or summary.get("stressAvg") or 0
    score_value = int(summary.get("healthScore") or 0)
    return {
        "userInfo": {
            "nickname": user.get("nickname") or user.get("nickName") or "",
            "avatar": user.get("avatar") or "",
            "reportDate": date.today().isoformat(),
        },
        "healthScore": {
            "score": score_value,
            "level": score_level(score_value),
        },
        "radarChart": {
            "exercise": str(summary.get("motionScore") or 0),
            "stress": str(summary.get("stressScore") or stress or 0),
            "spo2": str(summary.get("spo2Score") or spo2 or 0),
            "hrv": str(summary.get("hrvScore") or hrv or 0),
            "heartRate": str(summary.get("heartRateScore") or heart_rate or 0),
            "sleep": str(summary.get("sleepScore") or 0),
            "temperature": str(summary.get("temperatureScore") or temperature or 0),
        },
        "indicators": {
            "heartRate": str(heart_rate),
            "hrv": str(hrv),
            "spo2": str(spo2),
            "temperature": str(temperature),
            "stress": str(stress),
            "exercise": str(summary.get("motionScore") or 0),
            "activity": str(summary.get("activeTime") or 0),
            "sleep": str(summary.get("sleepTotalTime") or 0),
        },
    }


def score_level(value: int | float | None) -> str:
    score_value = int(value or 0)
    if score_value >= 85:
        return "优秀"
    if score_value >= 60:
        return "良好"
    return "待改善"


LEVEL_TEXT_MAP = {
    "needs improvement": "待改善",
    "needsimprovement": "待改善",
    "need improvement": "待改善",
    "needimprovement": "待改善",
    "improvement needed": "待改善",
    "improvementneeded": "待改善",
    "suboptimal": "待改善",
    "insufficient": "不足",
    "inadequate": "不足",
    "very poor": "待改善",
    "poor": "待改善",
    "bad": "待改善",
    "worse": "有下降",
    "worsened": "有下降",
    "declined": "有下降",
    "inactive": "静息",
    "sedentary": "久坐",
    "low activity": "活动偏低",
    "lowactivity": "活动偏低",
    "high activity": "活动偏高",
    "highactivity": "活动偏高",
    "insufficient activity": "活动不足",
    "insufficientactivity": "活动不足",
    "activity": "活动",
    "lifestyle": "生活习惯",
    "sleep": "睡眠",
    "sleep activation": "睡眠激活",
    "sleepactivation": "睡眠激活",
    "sleep preparation": "睡眠准备",
    "sleeppreparation": "睡眠准备",
    "sleep recovery": "睡眠恢复",
    "sleeprecovery": "睡眠恢复",
    "sleep rhythm": "睡眠节律",
    "sleeprhythm": "睡眠节律",
    "sleep quality": "睡眠质量",
    "sleepquality": "睡眠质量",
    "sleep duration": "睡眠时长",
    "sleepduration": "睡眠时长",
    "risk": "风险",
    "activity risk": "活动强度",
    "activityrisk": "活动强度",
    "sedentary risk": "久坐风险",
    "sedentaryrisk": "久坐风险",
    "exercise regularity": "运动规律性",
    "exerciseregularity": "运动规律性",
    "score": "评分",
    "quality": "质量",
    "duration": "时长",
    "preparation": "准备",
    "recovery": "恢复",
    "regularity": "规律性",
    "rhythm": "节律",
    "activation": "激活",
    "vital signs": "生命体征",
    "vitalsigns": "生命体征",
    "heart rate": "心率",
    "heartrate": "心率",
    "blood oxygen": "血氧",
    "bloodoxygen": "血氧",
    "body temperature": "体温",
    "bodytemperature": "体温",
    "active": "活跃",
    "very low": "很低",
    "light": "偏低",
    "low": "偏低",
    "low intensity": "低强度",
    "lowintensity": "低强度",
    "normal": "正常",
    "medium": "正常",
    "moderate": "中等",
    "medium intensity": "中等强度",
    "mediumintensity": "中等强度",
    "moderate intensity": "中等强度",
    "moderateintensity": "中等强度",
    "fair": "一般",
    "average": "一般",
    "below average": "待改善",
    "good": "良好",
    "better": "有改善",
    "improved": "有改善",
    "great": "优秀",
    "excellent": "优秀",
    "optimal": "优秀",
    "ideal": "优秀",
    "high": "偏高",
    "very high": "很高",
    "intense": "高强度",
    "severe": "严重",
    "mild": "轻度",
    "sufficient": "充足",
    "adequate": "充足",
    "needs attention": "待关注",
    "need attention": "待关注",
    "attention needed": "待关注",
    "room for improvement": "待改善",
    "roomforimprovement": "待改善",
    "not ideal": "待改善",
    "notideal": "待改善",
    "not good": "待改善",
    "notgood": "待改善",
    "relax": "放松",
    "relaxed": "放松",
    "no change": "保持不变",
    "nochange": "保持不变",
    "unchanged": "保持不变",
    "stable": "保持不变",
    "low risk": "低风险",
    "lowrisk": "低风险",
    "medium risk": "中风险",
    "mediumrisk": "中风险",
    "moderate risk": "中风险",
    "moderaterisk": "中风险",
    "high risk": "高风险",
    "highrisk": "高风险",
    "normal load": "正常负荷",
    "normalload": "正常负荷",
    "light load": "轻度负荷",
    "lightload": "轻度负荷",
    "heavy load": "重度负荷",
    "heavyload": "重度负荷",
    "awake": "清醒",
    "rem": "快速眼动",
    "light sleep": "浅睡",
    "deep": "深睡",
    "deep sleep": "深睡",
    "core sleep": "核心睡眠",
    "pending": "等待中",
    "pending key": "待配置",
    "pending_key": "待配置",
    "provider error": "服务异常",
    "provider_error": "服务异常",
    "error": "异常",
    "failed": "失败",
    "failure": "失败",
    "success": "成功",
    "ok": "正常",
}


def compact_level_text_key(value: str) -> str:
    return re.sub(r"[\W_]+", "", value.strip().lower())


COMPACT_LEVEL_TEXT_MAP = {compact_level_text_key(source): target for source, target in LEVEL_TEXT_MAP.items()}

MOJIBAKE_TEXT_REPLACEMENTS = {
    "淇濇寔涓嶅彉": "保持不变",
    "鐢熸椿涔犳儻璇勫垎": "生活习惯评分",
    "鐢熸椿涔犳儻": "生活习惯",
    "蹇冭剦浠嬬粛": "心脉介绍",
    "鑹ソ": "良好",
    "浼樼": "优秀",
    "灏忔椂": "小时",
    "鍒嗛挓": "分钟",
    "鍏呰冻": "充足",
    "姝ｅ父璐熻嵎": "正常负荷",
    "杞诲害璐熻嵎": "轻度负荷",
    "姝ｅ父": "正常",
    "涓嶈冻": "不足",
    "鏀炬澗": "放松",
    "涓瓑寮哄害": "中等强度",
    "涓瓑": "中等",
    "鍋忛珮": "偏高",
    "寰堥珮": "很高",
    "杈冨樊": "较差",
    "寰呮敼鍠?": "待改善",
    "娣辩潯": "深睡",
    "娴呯潯": "浅睡",
    "娓呴啋": "清醒",
    "灏忕潯": "小睡",
    "绠楁硶鎺ュ彛璇锋眰澶辫触": "算法接口请求失败",
    "绠楁硶鎺ュ彛杩炴帴澶辫触": "算法接口连接失败",
    "鏃犲コ鎬у仴搴峰熀纭€淇℃伅": "无女性健康基础信息",
}

LOCALIZED_TEXT_FALLBACK_KEYWORDS = (
    "status",
    "level",
    "risk",
    "type",
    "activation",
    "quality",
    "trend",
    "summary",
    "suggestion",
    "message",
    "desc",
    "text",
)


def should_localize_fallback_by_key(key) -> bool:
    key_text = str(key or "").lower()
    return any(keyword in key_text for keyword in LOCALIZED_TEXT_FALLBACK_KEYWORDS)


def replace_known_english_phrases(text_value: str) -> str:
    localized = text_value
    for source, target in sorted(LEVEL_TEXT_MAP.items(), key=lambda item: len(item[0]), reverse=True):
        pattern = r"\b" + re.escape(source).replace(r"\ ", r"\s+") + r"\b"
        localized = re.sub(pattern, target, localized, flags=re.IGNORECASE)
    localized = re.sub(r"\s+for\s+(.+)$", r"，\1相关", localized, flags=re.IGNORECASE)
    return localized


def localize_level_text(value, key=None):
    if not isinstance(value, str):
        return value
    text_value = value.strip()
    if not text_value:
        return value
    for source, target in MOJIBAKE_TEXT_REPLACEMENTS.items():
        text_value = text_value.replace(source, target)
    normalized = re.sub(r"[\s_-]+", " ", text_value).lower()
    if normalized in LEVEL_TEXT_MAP:
        return LEVEL_TEXT_MAP[normalized]
    compact = compact_level_text_key(text_value)
    if compact in COMPACT_LEVEL_TEXT_MAP:
        return COMPACT_LEVEL_TEXT_MAP[compact]
    trend_match = re.fullmatch(r"([+-]?\d+)\s+vs previous", normalized)
    if trend_match:
        diff = int(trend_match.group(1))
        if diff > 0:
            return f"较上期+{diff}"
        if diff < 0:
            return f"较上期{diff}"
        return "保持不变"
    text_value = replace_known_english_phrases(text_value)
    text_value = re.sub(r"\s+to\s+", " 至 ", text_value, flags=re.IGNORECASE)
    if should_localize_fallback_by_key(key) and re.search(r"[A-Za-z]", text_value):
        key_text = str(key or "").lower()
        if "risk" in key_text:
            return "风险待评估"
        if "status" in key_text:
            return "待处理"
        if "activation" in key_text:
            return "待改善"
        return "待改善"
    return text_value


def localize_payload_levels(payload, key=None):
    if isinstance(payload, list):
        return [localize_payload_levels(item, key=key) for item in payload]
    if not isinstance(payload, dict):
        return localize_level_text(payload, key=key)

    localized = {}
    for key, value in payload.items():
        if isinstance(value, (dict, list)):
            localized[key] = localize_payload_levels(value, key=key)
            continue

        key_text = str(key)
        if key_text == "status" or key_text == "level" or key_text.endswith("Level"):
            localized[key] = localize_level_text(value, key=key)
        else:
            localized[key] = localize_level_text(value, key=key)
    return localized


def localized_success(payload=None, msg: str = "success"):
    return success(localize_payload_levels(payload), msg)


def week_start(value: date | None = None) -> date:
    value = value or date.today()
    return value - timedelta(days=value.weekday())


def week_label(start: date) -> str:
    return f"{start.month}/{start.day}"


def week_range_label(start: date, end: date) -> str:
    return f"{start.month:02d}-{start.day:02d} 至 {end.month:02d}-{end.day:02d}"


def week_ranges(current_start: date | None = None) -> list[tuple[date, date]]:
    current_start = current_start or week_start()
    return [(current_start - timedelta(weeks=index), current_start - timedelta(weeks=index) + timedelta(days=6)) for index in range(4, -1, -1)]


def summaries_between(db: Session, user_id: int, start: date, end: date, refresh: bool = False) -> list[dict]:
    if refresh:
        current = start
        while current <= min(end, date.today()):
            health.calculate_daily_summary(db, user_id, current)
            current += timedelta(days=1)
    rows = db.execute(
        text(
            """
            select * from health_daily_summary
            where user_id=:user_id and record_date between :start_date and :end_date
            order by record_date
            """
        ),
        {"user_id": user_id, "start_date": start.isoformat(), "end_date": end.isoformat()},
    ).all()
    return [camelize_dict(dict(row._mapping)) for row in rows]


def avg_value(items: list[dict], field: str, positive: bool = True) -> float | None:
    values = [
        float(item.get(field) or 0)
        for item in items
        if item.get(field) is not None and (not positive or float(item.get(field) or 0) > 0)
    ]
    return sum(values) / len(values) if values else None


def overview_payload(score_value: int | float | None = 0, prev_score: int | float | None = None, start: date | None = None, end: date | None = None, level_func=None) -> dict:
    value = int(round(score_value or 0))
    level_func = level_func or score_level
    trend_value = int(round(value - prev_score)) if prev_score is not None and prev_score > 0 else 0
    if trend_value > 0:
        trend = f"较上期+{trend_value}"
    elif trend_value < 0:
        trend = f"较上期{trend_value}"
    else:
        trend = "保持不变"
    return {
        "level": level_func(value),
        "trend": trend,
        "trendValue": trend_value,
        "dateRange": week_range_label(start, end) if start and end else "",
    }


def score_item(value: int | float | None = None, prev_value: int | float | None = None, level_func=None) -> dict | None:
    if value is None:
        return None
    current = int(round(value))
    avg = int(round(prev_value)) if prev_value is not None and prev_value > 0 else None
    level_func = level_func or score_level
    return {
        "score": current - avg if avg is not None else None,
        "level": level_func(current),
        "current": current,
        "avg": avg,
    }


def recent_summaries(db: Session, user_id: int, days: int = 7) -> list[dict]:
    start = date.today() - timedelta(days=days - 1)
    return list(reversed(summaries_between(db, user_id, start, date.today(), refresh=True)))


def weekly_context(db: Session, user_id: int):
    current_start = week_start()
    current_end = current_start + timedelta(days=6)
    prev_start = current_start - timedelta(weeks=4)
    prev_end = current_start - timedelta(days=1)
    current = summaries_between(db, user_id, current_start, current_end, refresh=True)
    previous = summaries_between(db, user_id, prev_start, prev_end)
    return current_start, current_end, current, previous


def sleep_records_between(db: Session, user_id: int, start: date, end: date, require_start: bool = False, require_end: bool = False) -> list[dict]:
    clauses = ["user_id=:user_id", "date_ref between :start_date and :end_date"]
    if require_start:
        clauses.append("start_time is not null")
    if require_end:
        clauses.append("end_time is not null")
    rows = db.execute(
        text(f"select * from sleep_record where {' and '.join(clauses)} order by date_ref, start_time"),
        {"user_id": user_id, "start_date": start.isoformat(), "end_date": end.isoformat()},
    ).all()
    return [camelize_dict(dict(row._mapping)) for row in rows]


def sleep_rhythm_score(records: list[dict]) -> int | None:
    minutes = []
    for item in records:
        if sleep_type_key(item.get("type")) in {"INVALID", "AWAKE", "NAP"}:
            continue
        start_time = item.get("startTime")
        if isinstance(start_time, datetime):
            minute = start_time.hour * 60 + start_time.minute
            if minute < 720:
                minute += 1440
            minutes.append(minute)
    if len(minutes) < 2:
        return None
    avg = sum(minutes) / len(minutes)
    std_dev = math.sqrt(sum((value - avg) ** 2 for value in minutes) / len(minutes))
    if std_dev < 30:
        score = 90 + (30 - std_dev) / 3
    elif std_dev < 60:
        score = 70 + (60 - std_dev) / 1.5
    elif std_dev < 90:
        score = 50 + (90 - std_dev) / 2
    else:
        score = max(30, 50 - (std_dev - 90) / 3)
    return int(round(clamp_score(score)))


def recovery_score(items: list[dict]) -> int | None:
    scores = []
    for item in items:
        total = int(item.get("sleepTotalTime") or 0)
        if total <= 0:
            continue
        recovery_ratio_value = (int(item.get("sleepDeepTime") or 0) + int(item.get("sleepRemTime") or 0)) * 100 / total
        hours = total // 60
        if 7 <= hours <= 9:
            duration_score = 100
        elif 6 <= hours < 7 or 9 < hours <= 10:
            duration_score = 80
        elif 5 <= hours < 6:
            duration_score = 60
        else:
            duration_score = 40
        if 25 <= recovery_ratio_value <= 35:
            recovery_score_value = 100
        elif 20 <= recovery_ratio_value < 25 or 35 < recovery_ratio_value <= 40:
            recovery_score_value = 80
        elif 15 <= recovery_ratio_value < 20:
            recovery_score_value = 60
        else:
            recovery_score_value = 40
        scores.append((duration_score + recovery_score_value) // 2)
    return int(sum(scores) / len(scores)) if scores else None


def recovery_ratio(items: list[dict]) -> int | None:
    total = sum(int(item.get("sleepTotalTime") or 0) for item in items)
    recovery = sum(int(item.get("sleepDeepTime") or 0) + int(item.get("sleepRemTime") or 0) for item in items)
    return round(recovery * 100 / total) if total else None


def sedentary_score(items: list[dict]) -> int | None:
    scores = []
    for item in items:
        steps = int(item.get("totalSteps") or 0)
        active = int(item.get("activeTime") or 0)
        if steps >= 10000:
            step_score = 100
        elif steps >= 8000:
            step_score = 90
        elif steps >= 6000:
            step_score = 75
        elif steps >= 4000:
            step_score = 60
        elif steps >= 2000:
            step_score = 45
        else:
            step_score = 30
        if active >= 90:
            active_score = 100
        elif active >= 60:
            active_score = 90
        elif active >= 45:
            active_score = 75
        elif active >= 30:
            active_score = 60
        else:
            active_score = 40
        scores.append((step_score + active_score) // 2)
    return int(sum(scores) / len(scores)) if scores else None


def intensity_score(items: list[dict]) -> int | None:
    scores = []
    for item in items:
        active = int(item.get("activeTime") or 0)
        if active >= 60:
            scores.append(100)
        elif active >= 45:
            scores.append(90)
        elif active >= 30:
            scores.append(80)
        elif active >= 20:
            scores.append(70)
        elif active >= 10:
            scores.append(55)
        else:
            scores.append(40)
    return int(sum(scores) / len(scores)) if scores else None


def regularity_score(items: list[dict]) -> int | None:
    if not items:
        return None
    active_days = sum(1 for item in items if int(item.get("totalSteps") or 0) >= 6000 or int(item.get("activeTime") or 0) >= 30)
    ratio = active_days / len(items)
    if ratio >= 0.7:
        days_score = 90
    elif ratio >= 0.5:
        days_score = 75
    elif ratio >= 0.3:
        days_score = 60
    else:
        days_score = 40
    steps = [int(item.get("totalSteps") or 0) for item in items if item.get("totalSteps") is not None]
    if len(steps) > 1 and sum(steps) > 0:
        mean = sum(steps) / len(steps)
        cv = math.sqrt(sum((value - mean) ** 2 for value in steps) / len(steps)) / mean
    else:
        cv = 0
    if cv < 0.2:
        regular_score = 90
    elif cv < 0.4:
        regular_score = 75
    elif cv < 0.6:
        regular_score = 60
    else:
        regular_score = 40
    return (days_score + regular_score) // 2


def weekly_trend(db: Session, user_id: int, scorer, level_func=None) -> list[dict]:
    level_func = level_func or score_level
    chart = []
    for start, end in week_ranges():
        items = summaries_between(db, user_id, start, end)
        score = scorer(items)
        chart.append({"weekLabel": week_label(start), "score": score, "value": score, "level": level_func(score) if score else None})
    return chart


def duration_text(minutes: int) -> str:
    hours = minutes // 60
    remain = minutes % 60
    return f"{hours}小时" if remain == 0 else f"{hours}小时{remain}分钟"


def duration_level(minutes: int) -> str:
    hours = minutes // 60
    if 7 <= hours <= 9:
        return "充足"
    if hours >= 6:
        return "正常"
    return "不足"


def trend_chart(items: list[dict], field: str = "healthScore") -> list[dict]:
    result = []
    for item in reversed(items):
        value = int(item.get(field) or 0)
        result.append({"weekLabel": str(item.get("recordDate") or "")[5:10], "level": score_level(value), "score": value, "value": value})
    return result


def vital_score_from_summaries(items: list[dict]) -> float | None:
    values = [
        avg_value(items, "heartRateScore"),
        avg_value(items, "hrvScore"),
        avg_value(items, "spo2Score"),
        avg_value(items, "temperatureScore"),
    ]
    values = [value for value in values if value is not None]
    return sum(values) / len(values) if values else None


def health_index_payload(db: Session, user_id: int) -> dict:
    current_start, current_end, current, previous = weekly_context(db, user_id)
    habit = avg_value(current, "healthScore")
    prev_habit = avg_value(previous, "healthScore")
    sleep_score = avg_value(current, "sleepScore")
    prev_sleep_score = avg_value(previous, "sleepScore")
    motion_score = avg_value(current, "motionScore")
    prev_motion_score = avg_value(previous, "motionScore")
    rhythm = sleep_rhythm_score(sleep_records_between(db, user_id, current_start, current_end, require_start=True))
    prev_rhythm = sleep_rhythm_score(sleep_records_between(db, user_id, current_start - timedelta(weeks=4), current_start - timedelta(days=1), require_start=True))
    recovery = recovery_score(current)
    prev_recovery = recovery_score(previous)
    sedentary = sedentary_score(current)
    prev_sedentary = sedentary_score(previous)
    regularity = regularity_score(current)
    prev_regularity = regularity_score(previous)
    vital_score = vital_score_from_summaries(current)
    prev_vital_score = vital_score_from_summaries(previous)
    stress_score = avg_value(current, "stressScore")
    prev_stress_score = avg_value(previous, "stressScore")
    score_parts = [item for item in (sleep_score, motion_score, stress_score, vital_score) if item is not None]
    if score_parts:
        habit = sum(score_parts) / len(score_parts)
    prev_parts = [item for item in (prev_sleep_score, prev_motion_score, prev_stress_score, prev_vital_score) if item is not None]
    if prev_parts:
        prev_habit = sum(prev_parts) / len(prev_parts)
    habit_overview = overview_payload(habit, prev_habit)
    return {
        "dateRange": week_range_label(current_start, current_end),
        "habitScore": {
            "score": int(round(habit or 0)),
            "status": score_level(habit),
            "trend": habit_overview["trend"],
            "trendValue": habit_overview["trendValue"],
            "level": score_level(habit),
        },
        "sleep": {
            "preparation": score_item(sleep_score, prev_sleep_score),
            "rhythm": score_item(rhythm, prev_rhythm),
            "recovery": score_item(recovery, prev_recovery),
            "activation": score_item(sleep_score, prev_sleep_score),
        },
        "activity": {
            "sedentaryRisk": score_item(sedentary, prev_sedentary),
            "activityRisk": score_item(motion_score, prev_motion_score),
            "exerciseRegularity": score_item(regularity, prev_regularity),
        },
    }


def post_json(url: str, payload: dict, timeout: int = 20) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"算法接口请求失败: HTTP {exc.code} {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"算法接口连接失败: {exc.reason}") from exc
    return json.loads(body) if body else {}


def algorithm_enabled() -> bool:
    return bool(settings.other_api_base_url)


def algorithm_path(path: str) -> str:
    base_url = settings.other_api_base_url.rstrip("/")
    return base_url + path


def call_algorithm(path: str, payload: dict, default: dict | None = None, context: dict | None = None, timeout: int = 20) -> dict:
    if not algorithm_enabled():
        write_algorithm_log("disabled", path=path, context=context or {}, payload=payload)
        return default or {}
    call_id = uuid4().hex
    url = algorithm_path(path)
    records = payload.get("records") if isinstance(payload, dict) else None
    write_algorithm_log("request", callId=call_id, path=path, url=url, context=context or {}, recordCount=len(records) if isinstance(records, list) else None, payload=payload)
    try:
        result = post_json(url, payload, timeout=timeout)
        write_algorithm_log("response", callId=call_id, path=path, url=url, context=context or {}, result=result)
        return result
    except Exception as exc:
        write_algorithm_log("error", callId=call_id, path=path, url=url, context=context or {}, error=str(exc), payload=payload)
        return default or {}


def epoch_seconds(value) -> int:
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, date):
        return int(datetime(value.year, value.month, value.day).timestamp())
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return int(parsed.timestamp())
    except Exception:
        return 0


def int_value(value, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def float_value(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def sleep_type_value(value) -> int:
    key = sleep_type_key(value)
    return {"INVALID": 0, "AWAKE": 1, "LIGHT": 2, "DEEP": 3, "REM": 4, "NAP": 5}.get(key, int_value(value))


def algorithm_sleep_type_value(value) -> int | None:
    key = sleep_type_key(value)
    mapping = {"AWAKE": 0, "LIGHT": 1, "DEEP": 2, "REM": 3, "NAP": 0}
    return mapping.get(key)


def valid_range(value, low: float, high: float) -> float | None:
    number = float_value(value)
    return number if low <= number <= high else None


def temperature_celsius(value) -> float | None:
    number = float_value(value)
    if 3000 <= number <= 4500:
        return number / 100.0
    if 250 <= number <= 450:
        return number / 10.0
    if 25 <= number <= 45:
        return number
    return None


def dedupe_records(records: list[dict]) -> list[dict]:
    deduped: dict[int, dict] = {}
    for record in records:
        ts = int_value(record.get("ts"))
        if not ts:
            continue
        previous = deduped.get(ts)
        if previous is None:
            deduped[ts] = record
            continue
        merged = dict(previous)
        for key, value in record.items():
            if key == "ts":
                continue
            if value not in (None, "", 0, 0.0):
                merged[key] = value
        deduped[ts] = merged
    return [deduped[key] for key in sorted(deduped)]


def raw_health_rows(db: Session, user_id: int, start: date, end: date) -> list[dict]:
    rows = db.execute(
        text(
            """
            select record_time, heart_rate, hrv, spo2, temperature, stress,
                   step_count, motion_intensity, sleep_state
            from health_raw
            where user_id=:user_id
              and date(record_time) between :start_date and :end_date
            order by record_time
            """
        ),
        {"user_id": user_id, "start_date": start.isoformat(), "end_date": end.isoformat()},
    ).mappings().all()
    return [dict(row) for row in rows]


def hourly_activity_records(rows: list[dict]) -> list[dict]:
    buckets: dict[datetime, dict] = {}
    state_by_day: dict[date, dict[str, int | None]] = {}
    for row in rows:
        record_time = row.get("record_time")
        ts = epoch_seconds(record_time)
        if not ts or not isinstance(record_time, datetime):
            continue
        raw_steps = int_value(row.get("step_count"))
        day_state = state_by_day.setdefault(record_time.date(), {"last": None, "offset": 0})
        last_steps = day_state["last"]
        if last_steps is not None and raw_steps + 100 < int(last_steps):
            day_state["offset"] = int(day_state["offset"] or 0) + int(last_steps)
        normalized_steps = int(day_state["offset"] or 0) + raw_steps
        day_state["last"] = raw_steps
        hour = record_time.replace(minute=0, second=0, microsecond=0)
        bucket = buckets.setdefault(hour, {"ts": epoch_seconds(hour), "steps": 0, "activity": 0})
        bucket["steps"] = max(bucket["steps"], normalized_steps)
    # Second pass: mark hours with significant step increase as active
    sorted_hours = sorted(buckets.keys())
    for i, hour in enumerate(sorted_hours):
        bucket = buckets[hour]
        if i == 0:
            prev_steps = 0
        else:
            prev_hour = sorted_hours[i - 1]
            if (hour - prev_hour).total_seconds() <= 3600 and hour.date() == prev_hour.date():
                prev_steps = buckets[prev_hour]["steps"]
            else:
                prev_steps = 0
        step_delta = bucket["steps"] - prev_steps
        if step_delta > 200:
            bucket["activity"] = 1
    return dedupe_records([buckets[key] for key in sorted_hours])


def hourly_vital_records(rows: list[dict]) -> list[dict]:
    buckets: dict[datetime, dict[str, list[float]]] = {}
    for row in rows:
        record_time = row.get("record_time")
        if not isinstance(record_time, datetime):
            continue
        hour = record_time.replace(minute=0, second=0, microsecond=0)
        bucket = buckets.setdefault(hour, {"hr": [], "spo2": [], "hrv": [], "temp": []})
        for key, column, low, high in (
            ("hr", "heart_rate", 30, 220),
            ("spo2", "spo2", 70, 100),
            ("hrv", "hrv", 1, 200),
        ):
            value = valid_range(row.get(column), low, high)
            if value is not None:
                bucket[key].append(value)
        temp_value = temperature_celsius(row.get("temperature"))
        if temp_value is not None:
            bucket["temp"].append(temp_value)
    records = []
    for hour in sorted(buckets):
        bucket = buckets[hour]
        if any(bucket[key] for key in ("hr", "spo2", "hrv", "temp")):
            temp = round(sum(bucket["temp"]) / len(bucket["temp"]) * 100) if bucket["temp"] else 0
            records.append({
                "ts": epoch_seconds(hour),
                "hr": round(sum(bucket["hr"]) / len(bucket["hr"])) if bucket["hr"] else 0,
                "spo2": round(sum(bucket["spo2"]) / len(bucket["spo2"])) if bucket["spo2"] else 0,
                "hrv": round(sum(bucket["hrv"]) / len(bucket["hrv"])) if bucket["hrv"] else 0,
                "temp": temp,
            })
    return dedupe_records(records)


def daily_lifestyle_records(rows: list[dict]) -> list[dict]:
    buckets: dict[date, dict] = {}
    for row in rows:
        record_time = row.get("record_time")
        if not isinstance(record_time, datetime):
            continue
        bucket = buckets.setdefault(record_time.date(), {"ts": epoch_seconds(record_time.date()), "steps": 0, "sleep_counts": {}})
        bucket["steps"] = max(bucket["steps"], int_value(row.get("step_count")))
        sleep_type = algorithm_sleep_type_value(row.get("sleep_state"))
        if sleep_type is not None:
            bucket["sleep_counts"][sleep_type] = bucket["sleep_counts"].get(sleep_type, 0) + 1
    records = []
    for day in sorted(buckets):
        bucket = buckets[day]
        sleep_counts = bucket["sleep_counts"]
        sleep_type = max(sleep_counts, key=sleep_counts.get) if sleep_counts else 0
        records.append({"ts": bucket["ts"], "steps": bucket["steps"], "sleepType": sleep_type})
    return dedupe_records(records)


def hourly_stress_records(rows: list[dict]) -> list[dict]:
    buckets: dict[datetime, list[float]] = {}
    for row in rows:
        mapping = row_mapping(row)
        record_time = mapping.get("record_time")
        if not isinstance(record_time, datetime):
            continue
        stress = stress_value_from_row(mapping)
        if stress is None:
            continue
        hour = record_time.replace(minute=0, second=0, microsecond=0)
        buckets.setdefault(hour, []).append(stress)
    return [
        {"ts": epoch_seconds(hour), "stress": round(sum(values) / len(values), 2)}
        for hour, values in sorted(buckets.items())
        if values
    ]


def stress_algorithm_response(rows, context: dict) -> dict:
    records = hourly_stress_records([row_mapping(row) for row in rows])
    if not records:
        return {}
    return localize_payload_levels(call_algorithm(
        "/physicalHealth/stressRatio",
        {"records": records},
        default={},
        context=context,
        timeout=3,
    ))


def algorithm_records(rows: list[dict], kind: str) -> list[dict]:
    if kind in {"activity", "sedentary", "regularity"}:
        return hourly_activity_records(rows)
    if kind == "vital":
        return hourly_vital_records(rows)
    if kind == "stress":
        return hourly_stress_records(rows)
    if kind == "lifestyle":
        return daily_lifestyle_records(rows)

    records = []
    for row in rows:
        ts = epoch_seconds(row.get("record_time"))
        if not ts:
            continue
        activity = int_value(row.get("motion_intensity"))
        if kind == "sleep":
            sleep_type = algorithm_sleep_type_value(row.get("sleep_state"))
            if sleep_type is not None:
                hrv_val = valid_range(row.get("hrv"), 1, 200)
                records.append({"ts": ts, "hrv": hrv_val if hrv_val is not None else 0.0, "activity": activity, "sleepType": sleep_type})
        elif kind == "rhythm":
            sleep_type = algorithm_sleep_type_value(row.get("sleep_state"))
            if sleep_type is not None:
                records.append({"ts": ts, "sleepType": sleep_type})
        elif kind == "activation":
            sleep_type = algorithm_sleep_type_value(row.get("sleep_state"))
            if sleep_type is not None:
                records.append({"ts": ts, "activity": activity, "sleepType": sleep_type})
        elif kind == "ovulation":
            hr = valid_range(row.get("heart_rate"), 30, 220)
            temp = temperature_celsius(row.get("temperature"))
            if hr is not None and temp is not None:
                records.append({"ts": ts, "hr": round(hr), "temp": round(temp * 100)})
    return dedupe_records(records)


def algorithm_report(db: Session, user_id: int, start: date, end: date) -> dict:
    day_rows = raw_health_rows(db, user_id, start, end)
    seven_day_rows = raw_health_rows(db, user_id, end - timedelta(days=6), end)
    regularity_rows = raw_health_rows(db, user_id, end - timedelta(days=27), end)
    lifestyle_rows = raw_health_rows(db, user_id, end - timedelta(days=29), end)
    sleep_records_payload = algorithm_records(day_rows, "sleep")
    vital_records_payload = algorithm_records(day_rows, "vital")
    stress_records_payload = algorithm_records(seven_day_rows, "stress")
    sedentary_records_payload = algorithm_records(day_rows, "sedentary")
    activity_records_payload = algorithm_records(day_rows, "activity")
    regularity_records_payload = algorithm_records(regularity_rows, "regularity")
    rhythm_records_payload = algorithm_records(regularity_rows, "rhythm")
    activation_records_payload = algorithm_records(day_rows, "activation")
    lifestyle_records_payload = algorithm_records(lifestyle_rows, "lifestyle")
    context = {"source": "algorithm_report", "userId": user_id, "start": start.isoformat(), "end": end.isoformat()}
    write_algorithm_log(
        "build",
        context=context,
        counts={
            "raw": len(day_rows),
            "raw7d": len(seven_day_rows),
            "raw28d": len(regularity_rows),
            "raw30d": len(lifestyle_rows),
            "sleep": len(sleep_records_payload),
            "vital": len(vital_records_payload),
            "stress": len(stress_records_payload),
            "sedentary": len(sedentary_records_payload),
            "activity": len(activity_records_payload),
            "regularity": len(regularity_records_payload),
            "rhythm": len(rhythm_records_payload),
            "activation": len(activation_records_payload),
            "lifestyle": len(lifestyle_records_payload),
        },
    )
    payloads = {
        "sleepScore": ("/physicalHealth/sleepScore", {"records": sleep_records_payload}),
        "vitalSignsScore": ("/physicalHealth/vitalSignsScore", {"records": vital_records_payload}),
        "stressRatio": ("/physicalHealth/stressRatio", {"records": stress_records_payload}),
        "sedentaryRisk": ("/physicalHealth/sedentaryRisk", {"records": sedentary_records_payload}),
        "activityRisk": ("/physicalHealth/activityRisk", {"records": activity_records_payload}),
        "exerciseRegularity": ("/physicalHealth/exerciseRegularity", {"records": regularity_records_payload}),
        "sleepRhythm": ("/physicalHealth/sleepRhythm", {"records": rhythm_records_payload}),
        "sleepActivation": ("/physicalHealth/sleepActivation", {"records": activation_records_payload}),
        "lifestyleScore": ("/physicalHealth/lifestyleScore", {"records": lifestyle_records_payload}),
    }
    result = {}
    debug_snapshots = {}
    for key, (path, payload) in payloads.items():
        records = payload.get("records") or []
        response = call_algorithm(path, payload, context=context) if records else {}
        localized_response = localize_payload_levels(response)
        result[key] = localized_response
        if records:
            debug_snapshots[key] = {
                "endpoint": f"/api{path}",
                "requestBody": payload,
                "responseBody": localized_response,
                "recordCount": len(records),
                "algoVersion": "current",
                "context": context,
            }
    result["_debugAlgorithmSnapshots"] = debug_snapshots
    return result


def score_from_result(result: dict, *keys: str) -> float | None:
    for key in keys:
        if key in result and result.get(key) is not None:
            return float_value(result.get(key))
    return None


def inverse_risk_score(result: dict) -> float | None:
    value = score_from_result(result, "riskScore")
    return max(0.0, min(100.0, 100.0 - value)) if value is not None else None


def algorithm_activity_score(algo: dict) -> float | None:
    return first_score(
        inverse_risk_score(algo.get("activityRisk") or {}),
        score_from_result(algo.get("lifestyleScore") or {}, "score"),
    )


def stress_good_score(result: dict) -> float | None:
    stress_value = score_from_result(result, "avgStressLevel", "stressRatio")
    return max(0.0, min(100.0, 100.0 - stress_value)) if stress_value is not None else None


def first_score(*values):
    for value in values:
        if value is not None:
            return value
    return None


def get_json(url: str, timeout: int = 20) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"微信接口请求失败: HTTP {exc.code} {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"微信接口连接失败: {exc.reason}") from exc
    return json.loads(body) if body else {}


def require_wechat_config() -> tuple[str, str]:
    if not settings.wx_miniapp_appid or not settings.wx_miniapp_secret:
        raise app_auth.AppAuthError("微信小程序 appid/secret 未配置")
    return settings.wx_miniapp_appid, settings.wx_miniapp_secret


def wechat_open_id(login_code: str) -> str:
    appid, secret = require_wechat_config()
    params = urlencode({
        "appid": appid,
        "secret": secret,
        "js_code": login_code,
        "grant_type": "authorization_code",
    })
    data = get_json(f"https://api.weixin.qq.com/sns/jscode2session?{params}")
    if data.get("errcode"):
        raise app_auth.AppAuthError(f"微信登录失败: {data.get('errmsg') or data.get('errcode')}")
    open_id = str(data.get("openid") or "")
    if not open_id:
        raise app_auth.AppAuthError("微信登录未返回 openid")
    return open_id


def wechat_access_token() -> str:
    appid, secret = require_wechat_config()
    params = urlencode({
        "grant_type": "client_credential",
        "appid": appid,
        "secret": secret,
    })
    data = get_json(f"https://api.weixin.qq.com/cgi-bin/token?{params}")
    if data.get("errcode"):
        raise app_auth.AppAuthError(f"微信 access_token 获取失败: {data.get('errmsg') or data.get('errcode')}")
    token = str(data.get("access_token") or "")
    if not token:
        raise app_auth.AppAuthError("微信未返回 access_token")
    return token


def wechat_phone_number(phone_code: str) -> str:
    token = wechat_access_token()
    data = post_json(
        f"https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token={token}",
        {"code": phone_code},
    )
    if data.get("errcode"):
        raise app_auth.AppAuthError(f"微信手机号获取失败: {data.get('errmsg') or data.get('errcode')}")
    phone_info = data.get("phone_info") or {}
    phone = str(phone_info.get("phoneNumber") or phone_info.get("purePhoneNumber") or "")
    if not phone:
        raise app_auth.AppAuthError("微信未返回手机号")
    return phone


@router.post("/login/getPhoneCode")
async def get_phone_code(request: Request, redis: Redis | None = Depends(get_redis)):
    payload = await request.json()
    phone = str(payload.get("phone") or "").strip()
    if not phone:
        return error("请输入手机号")
    code = "".join(__import__("random").choice("0123456789") for _ in range(6))
    if redis:
        try:
            redis.setex(f"{app_auth.PHONE_CODE_KEY}{phone}", 300, code)
        except Exception as exc:
            return error(f"楠岃瘉鐮佹湇鍔″紓甯? {exc}")
    data = success("sent")
    if settings.env.lower() == "development":
        data["debugCode"] = code
    return data


@router.post("/login/phoneLogin")
async def phone_login(request: Request, db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    payload = await request.json()
    try:
        token = app_auth.login_by_phone(
            db,
            redis,
            str(payload.get("phone") or ""),
            str(payload.get("code") or ""),
            str(payload.get("openIdCode") or ""),
            request_ip(request),
        )
        return success({"token": token}, "鐧诲綍鎴愬姛")
    except app_auth.AppAuthError as exc:
        return error(str(exc))
    except RuntimeError as exc:
        return error(str(exc))


@router.post("/login/wxLogin")
def wx_login(openIdCode: str, request: Request, db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    try:
        token = app_auth.login_by_open_id(db, redis, openIdCode, request_ip(request))
        return success({"token": token}, "鐧诲綍鎴愬姛")
    except app_auth.AppAuthError as exc:
        return error(str(exc))


@router.post("/login/wechatLogin")
async def wechat_login(request: Request, db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    payload = await request.json()
    open_id_code = str(payload.get("openidCode") or payload.get("openIdCode") or "")
    phone_code = str(payload.get("phoneCode") or "")
    try:
        open_id = wechat_open_id(open_id_code)
        phone = wechat_phone_number(phone_code)
        token = app_auth.login_by_wechat_identity(db, redis, open_id, phone, request_ip(request))
        return success({"token": token}, "鐧诲綍鎴愬姛")
    except app_auth.AppAuthError as exc:
        return error(str(exc))
    except RuntimeError as exc:
        return error(str(exc))


DEFAULT_PRIVACY_POLICY = """
<h2>QKeer智能指环隐私政策</h2>
<p>我们重视您的隐私和个人信息保护。本政策说明 QKeer智能指环小程序如何收集、使用、保存和保护您的信息。</p>
<h3>一、信息收集</h3>
<p>为向您提供账号登录、设备连接、健康数据展示和数据同步服务，我们可能收集您的微信授权信息、手机号、设备信息、蓝牙连接信息，以及由智能指环采集并同步的心率、血氧、体温、活动、睡眠等健康相关数据。</p>
<h3>二、信息使用</h3>
<p>上述信息仅用于完成身份识别、设备绑定、数据同步、健康趋势展示、算法评分和服务安全保障。未经您的授权，我们不会将您的个人信息用于与本服务无关的用途。</p>
<h3>三、信息存储与保护</h3>
<p>我们会采取合理的安全措施保护您的个人信息，防止信息丢失、被不当使用、未经授权访问或披露。</p>
<h3>四、用户权利</h3>
<p>您可以在小程序内查看、修改相关个人资料，也可以通过解绑设备、退出登录等方式管理您的授权。</p>
<h3>五、联系我们</h3>
<p>如您对本隐私政策或个人信息保护有疑问，可通过小程序内客服或运营方公布的联系方式与我们联系。</p>
"""

DEFAULT_USER_AGREEMENT = """
<h2>QKeer智能指环用户协议</h2>
<p>欢迎使用 QKeer智能指环小程序。请您在使用本服务前仔细阅读并理解本协议。</p>
<h3>一、服务内容</h3>
<p>本小程序为用户提供智能指环设备连接、健康数据同步、健康指标展示、趋势分析和相关辅助功能。</p>
<h3>二、账号与使用规范</h3>
<p>您应保证提交的信息真实、准确，并妥善保管账号及设备。您不得利用本服务从事违法违规或损害他人合法权益的行为。</p>
<h3>三、健康数据说明</h3>
<p>本服务展示的健康数据和评分仅用于日常健康管理参考，不作为医学诊断、治疗或用药依据。如您身体不适，请及时咨询专业医疗机构。</p>
<h3>四、设备与网络</h3>
<p>部分功能依赖蓝牙、网络连接和智能指环设备状态。因设备未连接、网络异常、系统权限限制等原因，可能导致部分功能暂时不可用。</p>
<h3>五、协议变更</h3>
<p>我们可能根据服务调整更新本协议。更新后继续使用本服务，即视为您已理解并接受更新内容。</p>
"""


def configuration_content(db: Session, key_name: str, default_value: str) -> dict:
    row = db.execute(text("select * from sys_configuration where key_name=:key_name limit 1"), {"key_name": key_name}).first()
    if row:
        data = camelize_dict(dict(row._mapping))
        if str(data.get("value") or "").strip():
            return data
        data["value"] = default_value
        return data
    return {"keyName": key_name, "value": default_value}


@router.get("/login/privacyPolicy")
def privacy_policy(db: Session = Depends(get_db)):
    return success(configuration_content(db, "APP_SYSTEM_PRIVACY", DEFAULT_PRIVACY_POLICY))


@router.get("/login/userAgreement")
def user_agreement(db: Session = Depends(get_db)):
    return success(configuration_content(db, "APP_SYSTEM_USER", DEFAULT_USER_AGREEMENT))


@router.get("/user/getInfo")
def user_info(user: dict = Depends(app_user)):
    return success(user)


@router.put("/user/update")
async def user_update(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    app_auth.update_current_user(db, int(user["id"]), await request.json())
    return success(True)


@router.post("/aiLab/apply")
async def ai_lab_apply(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        status = ai_lab.apply(db, int(user["id"]), payload.get("inviteCode"))
        message = "Application submitted" if status["status"] == 0 else "AI lab enabled"
        return success(status, msg=message)
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.get("/aiLab/status")
def ai_lab_status(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(ai_lab.get_status(db, int(user["id"])))


@router.get("/user/goal/getInfo")
def user_goal_info(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    row = db.execute(text("select * from user_goal where user_id=:user_id limit 1"), {"user_id": user["id"]}).first()
    if row is None:
        app_auth.init_user_defaults(db, int(user["id"]))
        db.commit()
        row = db.execute(text("select * from user_goal where user_id=:user_id limit 1"), {"user_id": user["id"]}).first()
    return success(camelize_dict(dict(row._mapping)) if row else None)


@router.put("/user/goal/update")
async def user_goal_update(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    table = get_table("user_goal")
    values = clean_payload(table, payload)
    values["user_id"] = user["id"]
    existing = db.execute(text("select id from user_goal where user_id=:user_id"), {"user_id": user["id"]}).scalar()
    if existing:
        db.execute(table.update().where(table.c.id == existing).values(**values))
    else:
        db.execute(table.insert().values(**values))
    db.commit()
    return success(True)


@router.get("/user/cardConfig/getCardConfig")
def user_card_config(cardGroup: str | None = None, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    sql = "select * from user_card_config where user_id=:user_id"
    params = {"user_id": user["id"]}
    if cardGroup:
        sql += " and card_group=:card_group"
        params["card_group"] = cardGroup
    sql += " order by card_order"
    return success([camelize_dict(dict(row._mapping)) for row in db.execute(text(sql), params).all()])


@router.put("/user/cardConfig/updateCardConfig")
async def user_card_config_update(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    table = get_table("user_card_config")
    values = clean_payload(table, payload)
    values["user_id"] = user["id"]
    row_id = values.get("id")
    if row_id:
        db.execute(table.update().where(table.c.id == row_id).where(table.c.user_id == user["id"]).values(**values))
    else:
        db.execute(table.insert().values(**values))
    db.commit()
    return success(True)


@router.get("/device/model/list")
def device_model_list(request: Request, db: Session = Depends(get_db)):
    rows, _ = list_rows(db, "device_model", dict(request.query_params), 1, 500, {"modelKey", "modelName"})
    return success(rows)


@router.get("/fqaGuid/list")
def fqa_guid_list(request: Request, db: Session = Depends(get_db)):
    rows, _ = list_rows(db, "fqa_guid", dict(request.query_params), 1, 500, {"title", "content"})
    return success(rows)


@router.get("/fqaGuid/getInfo")
def fqa_guid_detail(id: str, db: Session = Depends(get_db)):
    return success(get_row(db, "fqa_guid", id))


@router.get("/device/info")
def device_info(mac: str, db: Session = Depends(get_db)):
    row = db.execute(
        text(
            """
            select d.*, m.model_key, m.model_name, m.device_version
            from device d left join device_model m on m.id = d.model_id
            where d.mac=:mac and d.del_flag=0 limit 1
            """
        ),
        {"mac": mac},
    ).first()
    return success(camelize_dict(dict(row._mapping)) if row else None)


@router.get("/device/scanQRCode")
def scan_qrcode(sn: str, db: Session = Depends(get_db)):
    row = db.execute(text("select device_name, mac from device where sn=:sn and del_flag=0 limit 1"), {"sn": sn}).first()
    if not row:
        return success(None)
    return success({"name": row._mapping["device_name"], "mac": row._mapping["mac"]})


def redis_get_text(redis: Redis | None, key: str) -> str | None:
    if redis is None:
        return None
    try:
        value = redis.get(key)
    except Exception:
        return None
    return value.decode() if isinstance(value, bytes) else value


def redis_set_text(redis: Redis | None, key: str, value: str | None) -> None:
    if redis is None or value in (None, ""):
        return
    try:
        redis.set(key, value)
    except Exception:
        return


def redis_delete_key(redis: Redis | None, key: str) -> None:
    if redis is None:
        return
    try:
        redis.delete(key)
    except Exception:
        return


@router.get("/device/bindInfo")
def bind_info(user: dict = Depends(app_user), db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    row = db.execute(
        text(
            """
            select d.*, m.model_key, m.model_name, m.device_version
            from device d left join device_model m on m.id = d.model_id
            where d.user_id=:user_id and d.del_flag=0 order by d.create_time desc limit 1
            """
        ),
        {"user_id": user["id"]},
    ).first()
    service_id = redis_get_text(redis, f"{app_auth.DEVICE_LINK_SERVICE_KEY}{user['id']}")
    device_name = redis_get_text(redis, f"{app_auth.DEVICE_NAME_KEY}{user['id']}")
    if not row:
        return success({"serviceId": service_id, "deviceName": device_name}, "not bound")
    data = dict(row._mapping)
    data = camelize_dict(data)
    data["serviceId"] = service_id
    data["deviceName"] = device_name or data.get("deviceName")
    return success(data)


@router.get("/device/current")
def current_device(user: dict = Depends(app_user), db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    return bind_info(user, db, redis)


@router.get("/device/bind")
def bind_device(mac: str, serviceId: str = "", deviceName: str = "", user: dict = Depends(app_user), db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    result = db.execute(text("update device set user_id=:user_id, device_name=coalesce(nullif(:device_name,''), device_name), update_time=now() where mac=:mac and del_flag=0"), {"user_id": user["id"], "device_name": deviceName, "mac": mac})
    redis_delete_key(redis, f"{app_auth.DEVICE_LINK_SERVICE_KEY}{user['id']}")
    redis_set_text(redis, f"{app_auth.DEVICE_LINK_SERVICE_KEY}{user['id']}", serviceId)
    redis_delete_key(redis, f"{app_auth.DEVICE_NAME_KEY}{user['id']}")
    redis_set_text(redis, f"{app_auth.DEVICE_NAME_KEY}{user['id']}", deviceName)
    db.commit()
    return success((result.rowcount or 0) > 0)


@router.get("/device/unbind")
def unbind_device(mac: str, user: dict = Depends(app_user), db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    result = db.execute(text("update device set user_id=null, update_time=now() where mac=:mac and user_id=:user_id"), {"mac": mac, "user_id": user["id"]})
    redis_delete_key(redis, f"{app_auth.DEVICE_LINK_SERVICE_KEY}{user['id']}")
    redis_delete_key(redis, f"{app_auth.DEVICE_NAME_KEY}{user['id']}")
    db.commit()
    return success((result.rowcount or 0) > 0)


@router.get("/family/member/list")
def family_member_list(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.list_members(db, int(user["id"])))


@router.get("/family/home")
def family_home(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.family_home(db, user))


@router.get("/family/care/reminders")
def family_care_reminders(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.care_reminders(db, user))


@router.post("/family/care/subscribe")
async def family_care_subscribe(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    return success(family.update_care_subscription(db, int(user["id"]), payload))


@router.get("/family/groups")
def family_groups(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.list_family_groups(db, int(user["id"])))


@router.post("/family/groups")
async def family_group_create(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        return success(family.create_family_group(db, int(user["id"]), payload))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.post("/family/groups/{groupId}/relations")
async def family_group_relation_add(groupId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        relation_id = int(payload.get("relationId") or 0)
        return success(family.add_family_group_relation(db, int(user["id"]), groupId, relation_id))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.get("/family/assist/list")
def family_assist_list(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.list_assist_requests(db, int(user["id"])))


@router.post("/family/assist")
async def family_assist_create(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        return success(family.submit_assist_request(db, int(user["id"]), payload))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.get("/family/elders")
def family_elders(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.list_elder_relations(db, int(user["id"])))


@router.post("/family/elder-profile")
async def family_elder_profile(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        return success(family.create_elder_profile_with_relation(db, user, payload))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.post("/family/elder-profile/{profileId}/claim")
def family_elder_profile_claim(profileId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        return success(family.claim_elder_profile(db, user, profileId))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.get("/family/users/search")
def family_users_search(phone: str, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        return success(family.search_users(db, phone))
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/invite/list")
def family_invite_list(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.list_invites(db, user))


@router.post("/family/invite")
async def family_invite_create(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        return success(family.create_invite(db, int(user["id"]), payload))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.post("/family/invite/{inviteCode}/accept")
def family_invite_accept(inviteCode: str, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        return success(family.handle_invite(db, int(user["id"]), inviteCode, True))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.post("/family/invite/{inviteCode}/reject")
def family_invite_reject(inviteCode: str, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        return success(family.handle_invite(db, int(user["id"]), inviteCode, False))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.get("/family/elders/{relationId}/health/overview")
def family_relation_health_overview(relationId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return localized_success(family.member_dashboard(db, member, health_index_payload))
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/elders/{relationId}/ai/weeklyReport")
def family_relation_ai_weekly_report(relationId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return success(family.weekly_ai_report(db, member))
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/elders/{relationId}/ai/monthlyReport")
def family_relation_ai_monthly_report(relationId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return success(family.monthly_ai_report(db, member))
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/elders/{relationId}/health/heart-rate")
def family_relation_heart_rate(relationId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return family_data_vital_sign(int(member["id"]), request, user, db)
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/elders/{relationId}/health/spo2")
def family_relation_spo2(relationId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return family_data_vital_sign(int(member["id"]), request, user, db)
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/elders/{relationId}/health/temperature")
def family_relation_temperature(relationId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return family_data_vital_sign(int(member["id"]), request, user, db)
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/elders/{relationId}/health/sleep")
def family_relation_sleep(relationId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return family_sleep_overview(int(member["id"]), request, user, db)
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/elders/{relationId}/health/motion")
def family_relation_motion(relationId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        return family_motion_overview(int(member["id"]), request, user, db)
    except ValueError as exc:
        return error(str(exc))


@router.post("/family/elders/{relationId}/devices/bind")
async def family_relation_device_bind(relationId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        member = family.member_for_relation(db, int(user["id"]), relationId)
        payload["memberId"] = member["id"]
        return success(family.bind_device(db, user, payload))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.put("/family/relations/{relationId}")
async def family_relation_update(relationId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        return success(family.update_relation(db, int(user["id"]), relationId, payload))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.delete("/family/relations/{relationId}")
def family_relation_delete(relationId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        return success(family.delete_relation(db, int(user["id"]), relationId))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.get("/family/guardians")
def family_guardians(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.list_guardians(db, int(user["id"])))


@router.post("/family/member/add")
async def family_member_add(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    return success(family.create_member(db, user, payload))


@router.get("/family/member/detail")
def family_member_detail(memberId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(family.require_member(db, int(user["id"]), memberId))


@router.post("/family/member/remove")
async def family_member_remove(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    member_id = int(payload.get("memberId") or payload.get("id") or 0)
    return success(family.remove_member(db, int(user["id"]), member_id))


@router.post("/family/share/updatePermissions")
async def family_share_update_permissions(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    member_id = int(payload.get("memberId") or payload.get("id") or 0)
    return success(family.update_permissions(db, int(user["id"]), member_id, payload.get("permissions") or {}))


@router.post("/family/device/bind")
async def family_device_bind(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    try:
        return success(family.bind_device(db, user, payload))
    except ValueError as exc:
        db.rollback()
        return error(str(exc))


@router.get("/family/health/dashboard")
def family_health_dashboard(memberId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    member = family.require_member(db, int(user["id"]), memberId)
    return localized_success(family.member_dashboard(db, member, health_index_payload))


@router.get("/family/health/index")
def family_health_index(memberId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    member = family.require_member(db, int(user["id"]), memberId)
    if str(member.get("status") or "active") != "active":
        return error("该共享关系已暂停或取消")
    payload = health_index_payload(db, int(member["dataUserId"]))
    return localized_success(family.filter_health_payload_by_permissions(payload, member))


@router.get("/family/data/vitalSign")
def family_data_vital_sign(memberId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    member = family.require_member(db, int(user["id"]), memberId)
    family.require_permission(member, "vitalSigns")
    user_id = int(member["dataUserId"])
    return localized_success(build_vital_sign_payload(db, user_id, date_from_request(request)))


@router.get("/family/data/motion/motionOverview")
def family_motion_overview(memberId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    member = family.require_member(db, int(user["id"]), memberId)
    family.require_permission(member, "motion")
    data_user_id = int(member["dataUserId"])
    date_value = date_from_request(request)
    summary = daily_summary(db, data_user_id, date_value) or {}
    return success({
        "step": summary_steps_or_raw(db, data_user_id, date_value, summary),
        "calorie": round(float(summary.get("totalCalorie") or 0)),
        "calorieUnit": CALORIE_UNIT,
        "motionTime": int(summary.get("activeTime") or 0),
        "targetStep": 8000,
        "targetCalorie": 300,
        "targetMotionTime": 30,
    })


@router.get("/family/data/sleep/sleepOverview")
def family_sleep_overview(memberId: int, request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    member = family.require_member(db, int(user["id"]), memberId)
    family.require_permission(member, "sleep")
    date_value = date_from_request(request)
    user_id = int(member["dataUserId"])
    records = sleep_records(db, user_id, date_value)
    values = effective_sleep_values(db, user_id, date_value, records)
    awake = values["AWAKE"]
    rem = values["REM"]
    light = values["LIGHT"]
    deep = values["DEEP"]
    nap = values["NAP"]
    total_sleep_time = rem + light + deep + nap
    awake_count = sum(1 for row in records if sleep_type_key(dict(row._mapping).get("type")) == "AWAKE")
    return localized_success({
        "sleepDuration": str(total_sleep_time),
        "sleepQuality": str(int(calculate_sleep_efficiency(awake, rem, light, deep, nap))),
        "sleepScore": calculate_sleep_score(awake, rem, light, deep, nap),
        "awakeCount": awake_count,
        "algorithm": {},
    })


@router.get("/family/alert/list")
def family_alert_list(memberId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    member = family.require_member(db, int(user["id"]), memberId)
    family.require_permission(member, "alerts")
    dashboard = family.member_dashboard(db, member, health_index_payload)
    return success(dashboard["alerts"])


@router.get("/family/ai/dailySummary")
def family_ai_daily_summary(memberId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    member = family.require_member(db, int(user["id"]), memberId)
    family.require_permission(member, "aiSummary")
    dashboard = family.member_dashboard(db, member, health_index_payload)
    return success(dashboard["aiSummary"])


@router.get("/family/ai/weeklyReport")
def family_ai_weekly_report(memberId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.require_member(db, int(user["id"]), memberId)
        return success(family.weekly_ai_report(db, member))
    except ValueError as exc:
        return error(str(exc))


@router.get("/family/ai/monthlyReport")
def family_ai_monthly_report(memberId: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    try:
        member = family.require_member(db, int(user["id"]), memberId)
        return success(family.monthly_ai_report(db, member))
    except ValueError as exc:
        return error(str(exc))


@router.get("/ota/package/check")
def ota_check(currentVersion: str, deviceModel: str | None = None, db: Session = Depends(get_db)):
    params = {"prefix": (currentVersion or "")[:4] + "%"}
    sql = "select * from ota_package where del_flag=0 and version_code like :prefix"
    if deviceModel:
        sql += " and device_model=:device_model"
        params["device_model"] = deviceModel
    sql += " order by create_time desc, update_time desc limit 1"
    row = db.execute(text(sql), params).first()
    if not row:
        return success(None, "already latest")
    data = get_row(db, "ota_package", row._mapping["id"])
    if compare_version(data.get("versionCode"), currentVersion) > 0:
        return success(data, "new version available")
    return success(None, "already latest")


@router.put("/ota/package/updateCallback")
def ota_update_callback(packageId: int, mac: str, db: Session = Depends(get_db)):
    ota = get_row(db, "ota_package", packageId)
    if ota:
        db.execute(text("update device set firmware_version=:version where mac=:mac and del_flag=0"), {"version": ota.get("versionCode"), "mac": mac})
        db.commit()
    return success(True)


@router.post("/upload/image")
async def upload_image(file: UploadFile, _: dict = Depends(app_user)):
    suffix = Path(file.filename or "").suffix.lower() or ".png"
    upload_dir = Path("uploads/app")
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / f"{uuid4().hex}{suffix}"
    content = await file.read()
    target.write_bytes(content)
    url = f"/app/files/{target.name}"
    data = success()
    data.update({"url": url, "fileName": url, "newFileName": url, "originalFilename": file.filename, "fileSize": len(content)})
    return data


def parse_sync_record_time(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return normalize_sync_record_time(value)
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp = timestamp / 1000
        return datetime.fromtimestamp(timestamp, APP_TIMEZONE).replace(tzinfo=None)
    text_value = str(value).strip()
    if not text_value:
        return None

    iso_value = text_value.replace("/", "-").strip()
    if iso_value.endswith("Z"):
        iso_value = f"{iso_value[:-1]}+00:00"
    try:
        return normalize_sync_record_time(datetime.fromisoformat(iso_value))
    except ValueError:
        pass

    text_value = iso_value.replace("T", " ")
    if "." in text_value:
        text_value = text_value.split(".", 1)[0]
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text_value, pattern)
        except ValueError:
            continue
    parts = re.findall(r"\d+", text_value)
    if len(parts) >= 3:
        nums = [int(part) for part in parts[:6]]
        while len(nums) < 6:
            nums.append(0)
        try:
            return datetime(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5])
        except ValueError:
            return None
    return None


def normalize_sync_record_time(value: datetime):
    if value.tzinfo is None:
        return value.replace(tzinfo=None)
    return value.astimezone(APP_TIMEZONE).replace(tzinfo=None)


def parse_sync_date_ref(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text_value = str(value).strip()
    if not text_value:
        return None
    try:
        return datetime.strptime(text_value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def apply_sync_date_ref(record_time: datetime, date_ref):
    target_date = parse_sync_date_ref(date_ref)
    if not target_date:
        return record_time
    return datetime.combine(target_date, record_time.time())


def first_item_value(item, keys):
    if isinstance(keys, (list, tuple)):
        for key in keys:
            value = item.get(key)
            if value not in (None, ""):
                return value
        return None
    return item.get(keys)


def value_in_range(item, key, min_value, max_value):
    value = first_item_value(item, key)
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < min_value or number > max_value:
        return None
    return int(number) if float(number).is_integer() else number


def rw_current_day_cumulative_step_value(item):
    source = str(first_item_value(item, ("stepCountSource", "step_count_source", "sourceType", "source_type")) or "").strip().lower()
    raw_data_type = str(first_item_value(item, ("rawDataType", "raw_data_type")) or "").strip().lower()
    if source != "rw_current_day_cumulative" and raw_data_type != "ab_activity_current_day_relative_hour":
        return None
    return value_in_range(
        item,
        (
            "rawStepCount",
            "raw_step_count",
            "cumulativeStepCount",
            "cumulative_step_count",
            "deviceStepCount",
            "device_step_count",
        ),
        0,
        2_000_000,
    )


def sync_record_time_for_item(item):
    record_time = parse_sync_record_time(
        item.get("recordTime") or item.get("record_time") or item.get("time") or item.get("timestamp")
    )
    if record_time is None:
        return None
    record_time = apply_sync_date_ref(record_time, item.get("dateRef") or item.get("date_ref"))
    return normalize_sync_record_time_for_storage(record_time)


def previous_step_baseline_for_rw_cumulative(db: Session, table, user_id: int, device_mac: str | None, record_time: datetime):
    day_start = datetime.combine(record_time.date(), datetime.min.time())
    lookback_start = day_start - timedelta(days=2)
    query = (
        select(table.c.step_count)
        .where(table.c.user_id == user_id)
        .where(table.c.record_time >= lookback_start)
        .where(table.c.record_time < day_start)
        .where(table.c.step_count.isnot(None))
    )
    if device_mac is not None:
        query = query.where(table.c.device_mac == device_mac)
    else:
        query = query.where(table.c.device_mac.is_(None))
    order_by = [table.c.record_time.desc()]
    if "id" in table.c:
        order_by.append(table.c.id.desc())
    value = db.execute(query.order_by(*order_by).limit(1)).scalar()
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def apply_rw_cumulative_step_delta(db: Session, table, item, user_id: int, device_mac: str | None):
    raw_step = rw_current_day_cumulative_step_value(item)
    if raw_step is None:
        return item

    next_item = dict(item)
    for key in ("stepCount", "step_count", "steps", "step", "totalSteps", "total_steps"):
        next_item.pop(key, None)

    record_time = sync_record_time_for_item(item)
    if record_time is None:
        return next_item

    baseline = previous_step_baseline_for_rw_cumulative(db, table, user_id, device_mac, record_time)
    if baseline is None:
        return next_item

    daily_step = raw_step if raw_step < baseline else raw_step - baseline
    if daily_step < 0 or daily_step > 2_000_000:
        return next_item

    next_item["stepCount"] = daily_step
    return next_item


def sync_temperature_value(item, key):
    value = first_item_value(item, key)
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if 3000 <= number <= 4500:
        number = number / 100.0
    elif 250 <= number <= 450:
        number = number / 10.0
    if number < 25.0 or number > 45.0:
        return None
    return int(number) if float(number).is_integer() else round(number, 2)


RW_FALLBACK_TEMPERATURE_CELSIUS = 36.6


def is_rw_sync_item(item):
    protocol = str(first_item_value(item, ("protocol", "deviceProtocol", "device_protocol")) or "").strip().lower()
    if protocol == "rw":
        return True
    source_type = str(first_item_value(item, ("sourceType", "source_type", "type")) or "").strip().lower()
    raw_data_type = str(first_item_value(item, ("rawDataType", "raw_data_type")) or "").strip().lower()
    return source_type == "rw" or source_type.startswith("rw_") or raw_data_type.startswith("rw_")


def sync_blood_pressure_pair(item):
    paired = first_item_value(
        item,
        (
            "bloodPressure",
            "blood_pressure",
            "bloodPressureValue",
            "blood_pressure_value",
            "bp",
            "bpValue",
            "bp_value",
        ),
    )
    systolic_keys = (
        "systolic",
        "systolicValue",
        "systolic_value",
        "sbp",
        "sp",
        "high",
        "highPressure",
        "high_pressure",
        "bloodPressureHigh",
        "blood_pressure_high",
    )
    diastolic_keys = (
        "diastolic",
        "diastolicValue",
        "diastolic_value",
        "dbp",
        "dp",
        "low",
        "lowPressure",
        "low_pressure",
        "bloodPressureLow",
        "blood_pressure_low",
    )

    if isinstance(paired, dict):
        systolic = value_in_range(paired, systolic_keys, 50, 260)
        diastolic = value_in_range(paired, diastolic_keys, 30, 180)
        return systolic, diastolic

    if isinstance(paired, (list, tuple)) and len(paired) >= 2:
        systolic = value_in_range({"value": paired[0]}, "value", 50, 260)
        diastolic = value_in_range({"value": paired[1]}, "value", 30, 180)
        return systolic, diastolic

    if isinstance(paired, str):
        matched = re.search(r"(\d{2,3})\D+(\d{2,3})", paired)
        if matched:
            systolic = value_in_range({"value": matched.group(1)}, "value", 50, 260)
            diastolic = value_in_range({"value": matched.group(2)}, "value", 30, 180)
            return systolic, diastolic

    return None, None


def ring_sleep_state_value(value):
    if value in (None, ""):
        return None
    if isinstance(value, str):
        text = re.sub(r"[\s_-]+", "", value.strip().lower())
        text_states = {
            "awake": 1,
            "wake": 1,
            "waking": 1,
            "清醒": 1,
            "醒": 1,
            "rem": 2,
            "快速眼动": 2,
            "眼动": 2,
            "light": 3,
            "lightsleep": 3,
            "浅睡": 3,
            "浅睡眠": 3,
            "deep": 4,
            "deepsleep": 4,
            "深睡": 4,
            "深睡眠": 4,
            "nap": 5,
            "小睡": 5,
            "午睡": 5,
        }
        if text in text_states:
            return text_states[text]
    try:
        state = int(value)
    except (TypeError, ValueError):
        return None
    # Java/L19 contract: 0 invalid, 1 awake, 2 REM, 3 light, 4 deep, 5 nap.
    return state if state in {0, 1, 2, 3, 4, 5} else None


def rw_sleep_status_to_l19_state(value):
    if value in (None, ""):
        return None
    if isinstance(value, str) and not re.fullmatch(r"\s*\d+(\.0+)?\s*", value):
        return ring_sleep_state_value(value)
    try:
        status = int(float(value))
    except (TypeError, ValueError):
        return None
    # RW/QKeer V2 status: 1 light, 2 deep, 3 awake, 4 REM. 0/5 are enter/exit markers.
    return {1: 3, 2: 4, 3: 1, 4: 2}.get(status)


def sleep_record_state_value(item):
    explicit_state = ring_sleep_state_value(
        first_item_value(
            item,
            (
                "sleepState",
                "sleep_state",
                "sleepStage",
                "sleep_stage",
                "state",
                "stage",
            ),
        )
    )
    if explicit_state not in (None, 0):
        return explicit_state

    rw_status = rw_sleep_status_to_l19_state(first_item_value(item, ("sleepStatus", "sleep_status", "status")))
    if rw_status is not None:
        return rw_status

    sleep_type = ring_sleep_state_value(first_item_value(item, ("sleepType", "sleep_type")))
    return sleep_type if sleep_type not in (None, 0) else None


def health_raw_sleep_state_value(item):
    explicit_state = ring_sleep_state_value(
        first_item_value(
            item,
            (
                "sleepState",
                "sleep_state",
                "sleepStage",
                "sleep_stage",
            ),
        )
    )
    if explicit_state not in (None, 0):
        return explicit_state

    rw_status = rw_sleep_status_to_l19_state(first_item_value(item, ("sleepStatus", "sleep_status")))
    if rw_status is not None:
        return rw_status

    sleep_type = ring_sleep_state_value(first_item_value(item, ("sleepType", "sleep_type")))
    return sleep_type if sleep_type not in (None, 0) else None


def java_sync_health_raw_values(table, item, user_id: int, device_mac: str | None):
    record_time = parse_sync_record_time(
        item.get("recordTime") or item.get("record_time") or item.get("time") or item.get("timestamp")
    )
    if record_time is None:
        return None
    record_time = apply_sync_date_ref(record_time, item.get("dateRef") or item.get("date_ref"))
    record_time = normalize_sync_record_time_for_storage(record_time)
    if record_time is None:
        return None

    values = {
        "user_id": user_id,
        "record_time": record_time,
        "device_mac": device_mac or item.get("deviceMac") or item.get("device_mac"),
    }

    ranged_fields = {
        "step_count": (("stepCount", "step_count", "steps", "step", "totalSteps", "total_steps"), 0, 2_000_000),
        "heart_rate": (("heartRate", "heart_rate", "heartrate", "hr", "heartRateValue", "heart_rate_value"), 30, 220),
        "hrv": (
            (
                "hrv",
                "hrvValue",
                "hrv_value",
                "heartRateVariability",
                "heart_rate_variability",
                "heartRateVariabilityValue",
                "heart_rate_variability_value",
                "rmssd",
            ),
            1,
            300,
        ),
        "spo2": (
            (
                "spo2",
                "spO2",
                "SPO2",
                "bloodOxygen",
                "blood_oxygen",
                "bloodOxygenSaturation",
                "blood_oxygen_saturation",
                "bloodOxy",
                "oxygen",
                "oxygenSaturation",
                "oxygen_saturation",
                "bo",
            ),
            70,
            100,
        ),
        "stress": (
            (
                "stress",
                "stressValue",
                "stress_value",
                "stressIndex",
                "stress_index",
                "avgStress",
                "avg_stress",
                "avgStressValue",
                "avg_stress_value",
                "pressure",
                "pressureValue",
                "pressure_value",
            ),
            0,
            100,
        ),
        "temperature": (
            (
                "temperature",
                "temperatureValue",
                "temperature_value",
                "temp",
                "bodyTemperature",
                "body_temperature",
                "bodyTemperatureValue",
                "body_temperature_value",
                "bodyTemp",
                "body_temp",
                "bodyTempValue",
                "body_temp_value",
                "skinTemperature",
                "skin_temperature",
                "skinTemperatureValue",
                "skin_temperature_value",
                "skinTemp",
                "skin_temp",
            ),
            25.0,
            45.0,
        ),
        "blood_sugar": (("bloodSugar", "blood_sugar", "bloodSugarValue", "blood_sugar_value", "glucose", "sugar"), 1.0, 33.3),
        "systolic": (
            ("systolic", "systolicValue", "systolic_value", "sbp", "sp", "high", "highPressure", "high_pressure", "bloodPressureHigh", "blood_pressure_high"),
            50,
            260,
        ),
        "diastolic": (
            ("diastolic", "diastolicValue", "diastolic_value", "dbp", "dp", "low", "lowPressure", "low_pressure", "bloodPressureLow", "blood_pressure_low"),
            30,
            180,
        ),
        "motion_intensity": (("motionIntensity", "motion_intensity", "intensity", "intensityLevel", "intensity_level"), 0, 4),
        "perfusion_index": (("perfusionIndex", "perfusion_index", "pi"), 0, 20),
    }
    for column, (key, min_value, max_value) in ranged_fields.items():
        value = sync_temperature_value(item, key) if column == "temperature" else value_in_range(item, key, min_value, max_value)
        if value is not None:
            values[column] = value
    if "temperature" not in values and is_rw_sync_item(item):
        values["temperature"] = RW_FALLBACK_TEMPERATURE_CELSIUS

    paired_systolic, paired_diastolic = sync_blood_pressure_pair(item)
    if "systolic" not in values and paired_systolic is not None:
        values["systolic"] = paired_systolic
    if "diastolic" not in values and paired_diastolic is not None:
        values["diastolic"] = paired_diastolic

    mapped_sleep_state = health_raw_sleep_state_value(item)
    if mapped_sleep_state is not None:
        values["sleep_state"] = mapped_sleep_state

    rr_intervals = item.get("rrIntervals") if item.get("rrIntervals") is not None else item.get("rr_intervals")
    if rr_intervals not in (None, ""):
        values["rr_intervals"] = rr_intervals

    if "create_time" in table.c:
        values["create_time"] = datetime.now()
    return {key: value for key, value in values.items() if key in table.c and value is not None}


def java_sync_sleep_record_values(table, item, user_id: int):
    sleep_type = sleep_record_state_value(item)
    duration_value = first_item_value(
        item,
        (
            "sleepDuration",
            "sleep_duration",
            "durationMinutes",
            "duration_minutes",
            "sleepDurationMinutes",
            "sleep_duration_minutes",
            "sleepTotalMinutes",
            "sleep_total_minutes",
            "totalSleepMinutes",
            "total_sleep_minutes",
            "sleepMinutes",
            "sleep_minutes",
            "totalSleepTime",
            "total_sleep_time",
            "sleepTime",
            "sleep_time",
            "minutes",
            "minute",
            "duration",
            "sleepLen",
            "sleep_len",
        ),
    )
    try:
        sleep_minutes = int(float(duration_value))
    except (TypeError, ValueError):
        return None
    if sleep_type is None or sleep_minutes <= 0 or sleep_minutes > 1440:
        return None

    start_time = parse_sync_record_time(
        item.get("startTime")
        or item.get("start_time")
        or item.get("recordTime")
        or item.get("record_time")
        or item.get("time")
        or item.get("timestamp")
    )
    if start_time is None:
        return None
    end_time = parse_sync_record_time(item.get("endTime") or item.get("end_time"))
    if end_time is None or end_time <= start_time:
        end_time = start_time + timedelta(minutes=sleep_minutes)

    explicit_date_ref = parse_sync_date_ref(item.get("dateRef") or item.get("date_ref"))
    date_ref = explicit_date_ref or (end_time.date() if end_time.date() > start_time.date() else start_time.date())

    values = {
        "user_id": user_id,
        "date_ref": date_ref,
        "type": sleep_type,
        "start_time": start_time,
        "end_time": end_time,
        "sleep_time": sleep_minutes,
    }
    return {key: value for key, value in values.items() if key in table.c and value is not None}


def upsert_sync_sleep_records(db: Session, table, records: list[dict]):
    for values in records:
        existing_id = db.execute(
            select(table.c.id)
            .where(table.c.user_id == values["user_id"])
            .where(table.c.type == values["type"])
            .where(table.c.start_time == values["start_time"])
            .order_by(table.c.id)
            .limit(1)
        ).scalar()
        if existing_id:
            db.execute(table.update().where(table.c.id == existing_id).values(**values))
        else:
            db.execute(table.insert().values(**values))
    if records:
        db.commit()


def upsert_sync_health_raw_record(db: Session, table, values: dict):
    identity_query = (
        select(table.c.id)
        .where(table.c.user_id == values["user_id"])
        .where(table.c.record_time == values["record_time"])
    )
    device_mac = values.get("device_mac")
    identity_query = identity_query.where(table.c.device_mac == device_mac) if device_mac is not None else identity_query.where(table.c.device_mac.is_(None))
    existing_id = db.execute(identity_query.order_by(table.c.id).limit(1)).scalar()
    if existing_id:
        update_values = {key: value for key, value in values.items() if key != "create_time"}
        db.execute(table.update().where(table.c.id == existing_id).values(**update_values))
        return "updated"

    try:
        db.execute(table.insert().values(**values))
        return "inserted"
    except IntegrityError:
        db.rollback()
        existing_id = db.execute(identity_query.order_by(table.c.id).limit(1)).scalar()
        if not existing_id:
            raise
        update_values = {key: value for key, value in values.items() if key != "create_time"}
        db.execute(table.update().where(table.c.id == existing_id).values(**update_values))
        return "updated"


def update_device_sync(db: Session, user_id: int, device_mac: str | None, battery):
    if not device_mac:
        return
    params = {"user_id": user_id, "mac": device_mac, "battery": battery}
    db.execute(
        text(
            """
            update device
            set battery=coalesce(:battery, battery),
                last_sync_address='',
                last_sync_time=now(),
                update_time=now()
            where user_id=:user_id and mac=:mac and del_flag=0
            """
        ),
        params,
    )
    db.commit()


def sync_ring_data_records(
    db: Session,
    user_id: int,
    records: list,
    device_mac: str | None = None,
    battery=None,
    calculate_summary: bool = True,
) -> dict:
    started_at = perf_counter()
    table = get_table("health_raw")
    sleep_table = get_table("sleep_record")
    health_count = 0
    fail_count = 0
    touched_dates = set()
    sleep_record_values = []
    health_write_started_at = perf_counter()
    for item in records:
        normalized_item = apply_rw_cumulative_step_delta(db, table, item, user_id, device_mac)
        values = java_sync_health_raw_values(table, normalized_item, user_id, device_mac)
        sleep_values = java_sync_sleep_record_values(sleep_table, normalized_item, user_id)
        if sleep_values:
            sleep_record_values.append(sleep_values)
            date_ref = sleep_values.get("date_ref")
            if date_ref:
                touched_dates.add(date_ref.isoformat() if hasattr(date_ref, "isoformat") else str(date_ref))
        if not values:
            if not sleep_values:
                fail_count += 1
            continue
        try:
            upsert_sync_health_raw_record(db, table, values)
            health_count += 1
        except Exception:
            db.rollback()
            fail_count += 1
            continue
        touched_dates.add(values["record_time"].date().isoformat())
    db.commit()
    health_write_ms = round((perf_counter() - health_write_started_at) * 1000)
    sleep_write_started_at = perf_counter()
    upsert_sync_sleep_records(db, sleep_table, sleep_record_values)
    sleep_write_ms = round((perf_counter() - sleep_write_started_at) * 1000)
    device_update_started_at = perf_counter()
    update_device_sync(db, user_id, device_mac, battery)
    device_update_ms = round((perf_counter() - device_update_started_at) * 1000)
    summary_ms = 0
    summary_dates = []
    if calculate_summary:
        for item_date in touched_dates:
            if item_date:
                summary_started_at = perf_counter()
                summary = health.calculate_daily_summary(db, user_id, item_date)
                item_summary_ms = round((perf_counter() - summary_started_at) * 1000)
                summary_ms += item_summary_ms
                summary_dates.append({
                    "date": item_date,
                    "elapsedMs": item_summary_ms,
                    "hasSummary": bool(summary),
                })
    sleep_count = len(sleep_record_values)
    total_count = health_count + sleep_count
    return {
        "success": total_count > 0,
        "count": total_count,
        "healthCount": health_count,
        "sleepCount": sleep_count,
        "failCount": fail_count,
        "touchedDates": sorted(touched_dates),
        "syncElapsedMs": round((perf_counter() - started_at) * 1000),
        "healthWriteMs": health_write_ms,
        "sleepWriteMs": sleep_write_ms,
        "deviceUpdateMs": device_update_ms,
        "summaryMs": summary_ms,
        "summaryDates": summary_dates,
        "summarySkipped": not calculate_summary,
    }


@router.post("/data/sync")
async def data_sync(
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(app_user),
    db: Session = Depends(get_db),
):
    started_at = perf_counter()
    payload = await request.json()
    records = payload.get("dataList") or payload.get("records") or payload.get("data") or payload.get("list") or []
    if isinstance(records, dict):
        records = [records]
    if not records:
        return success(False)
    device_mac = payload.get("deviceMac") or payload.get("device_mac")
    target_user_id = family.resolve_sync_user_id(db, int(user["id"]), device_mac)
    battery = payload.get("battery")
    result = sync_ring_data_records(db, target_user_id, records, device_mac, battery, calculate_summary=False)
    summary_dates = result.get("touchedDates") or []
    summary_inline = 0 < len(summary_dates) <= SYNC_INLINE_SUMMARY_DATE_LIMIT
    if summary_inline:
        recalculate_sync_summaries(target_user_id, summary_dates)
    elif summary_dates:
        background_tasks.add_task(recalculate_sync_summaries, target_user_id, summary_dates)
    result["inputCount"] = len(records)
    result["summaryScheduled"] = bool(summary_dates) and not summary_inline
    result["summaryInline"] = summary_inline
    result["summarySkipped"] = not summary_inline
    result["elapsedMs"] = round((perf_counter() - started_at) * 1000)
    write_algorithm_log(
        "data_sync",
        user_id=target_user_id,
        device_mac=device_mac,
        input_count=len(records),
        elapsed_ms=result["elapsedMs"],
        count=result.get("count"),
        health_count=result.get("healthCount"),
        sleep_count=result.get("sleepCount"),
        fail_count=result.get("failCount"),
        touched_dates=result.get("touchedDates"),
        sync_elapsed_ms=result.get("syncElapsedMs"),
        health_write_ms=result.get("healthWriteMs"),
        sleep_write_ms=result.get("sleepWriteMs"),
        device_update_ms=result.get("deviceUpdateMs"),
        summary_ms=result.get("summaryMs"),
        summary_dates=result.get("summaryDates"),
    )
    return success(
        result,
        f"同步成功 {result['count']} 条，健康 {result['healthCount']} 条，睡眠 {result['sleepCount']} 条，失败 {result['failCount']} 条",
    )


@router.get("/data/vitalSign")
def data_vital_sign(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    return localized_success(build_vital_sign_payload(db, user_id, date_from_request(request)))


@router.get("/data/balanceScore")
def data_balance_score(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    date_value = date_from_request(request)
    summary = daily_summary(db, user_id, date_value) or {}
    records = sleep_records(db, user_id, date_value)
    if records:
        sleep_values = sleep_minutes_by_type(records)
        sleep_score = calculate_sleep_score(
            sleep_values["AWAKE"],
            sleep_values["REM"],
            sleep_values["LIGHT"],
            sleep_values["DEEP"],
            sleep_values["NAP"],
        )
    else:
        sleep_score = summary.get("sleepScore")
    activity_score = summary.get("motionScore")
    relax_score = summary.get("stressScore")
    vital_scores = [summary.get("heartRateScore"), summary.get("spo2Score"), summary.get("temperatureScore"), summary.get("hrvScore")]
    vital_scores = [item for item in vital_scores if item is not None]
    vital_score = round(sum(vital_scores) / len(vital_scores)) if vital_scores else None
    score_parts = [item for item in (sleep_score, activity_score, relax_score, vital_score) if item is not None]
    return localized_success({
        "overallScore": round(sum(score_parts) / len(score_parts)) if score_parts else summary.get("healthScore"),
        "activityScore": round(activity_score) if activity_score is not None else None,
        "relaxScore": round(relax_score) if relax_score is not None else None,
        "vitalSignScore": round(vital_score) if vital_score is not None else None,
        "healthScore": summary.get("healthScore"),
        "healthLevel": summary.get("healthLevel"),
        "motionScore": summary.get("motionScore"),
        "sleepScore": sleep_score,
        "heartRateScore": summary.get("heartRateScore"),
        "spo2Score": summary.get("spo2Score"),
        "stressScore": summary.get("stressScore"),
        "algorithm": {},
        "summary": summary,
    })


@router.get("/health/index")
def health_index(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return localized_success(health_index_payload(db, int(user["id"])))


@router.get("/health/report")
def health_report(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return localized_success(health_report_payload(db, user, request))


def l3_clamp_score(value: float | int | None, fallback: int = 68) -> int:
    if value is None:
        return fallback
    try:
        return max(0, min(100, round(float(value))))
    except (TypeError, ValueError):
        return fallback


def l3_summary_value(summary: dict, *keys: str, default: float | int | None = None):
    for key in keys:
        value = summary.get(key)
        if value is not None:
            return value
    return default


def l3_score_spo2(value) -> int | None:
    if not value:
        return None
    return l3_clamp_score((float(value) - 90) * 10)


def l3_score_heart_rate(value) -> int | None:
    if not value:
        return None
    return l3_clamp_score(100 - abs(float(value) - 72) * 1.4)


def l3_score_hrv(value) -> int | None:
    if not value:
        return None
    return l3_clamp_score(float(value) * 1.4)


def l3_score_stress(value) -> int | None:
    if not value:
        return None
    return l3_clamp_score(100 - float(value))


def l3_avg(values: list[int | None], fallback: int) -> int:
    valid = [value for value in values if value is not None and value > 0]
    return l3_clamp_score(sum(valid) / len(valid), fallback) if valid else fallback


def growth_girlfriend_context_payload(db: Session, user_id: int) -> dict:
    summary = daily_summary(db, user_id, date.today().isoformat()) or {}
    health_score = l3_clamp_score(l3_summary_value(summary, "healthScore", "health_score"), 68)
    heart_rate = l3_summary_value(summary, "heartRateAvg", "heart_rate_avg")
    spo2 = l3_summary_value(summary, "spo2Avg", "spo2_avg")
    hrv = l3_summary_value(summary, "hrvAvg", "hrv_avg")
    stress = l3_summary_value(summary, "stressAvg", "stress_avg")
    steps = l3_summary_value(summary, "stepCount", "steps", "step_count", default=0)
    sleep_minutes = l3_summary_value(summary, "sleepTotalTime", "sleepTotalMinutes", "sleep_total_time", default=0)
    motion_score = l3_summary_value(summary, "motionScore", "motion_score")

    fallback_health = l3_avg([
        l3_score_heart_rate(heart_rate),
        l3_score_spo2(spo2),
        l3_score_hrv(hrv),
        l3_score_stress(stress),
    ], 68)
    beauty_score = l3_clamp_score(82 - float(stress or 0) * 0.35 + min(float(hrv or 0), 80) * 0.12, 74) if stress or hrv else 74
    step_score = min(100, float(steps or 0) / 80)
    sleep_score = min(100, float(sleep_minutes or 0) / 4.8) if sleep_minutes else 60
    growth_score = l3_clamp_score((float(motion_score) if motion_score else step_score * 0.65 + sleep_score * 0.35), 61)

    return {
        "scores": {
            "health": health_score or fallback_health,
            "beauty": beauty_score,
            "growth": growth_score,
        },
        "metrics": {
            "heartRate": heart_rate,
            "spo2": spo2,
            "hrv": hrv,
            "stress": stress,
            "steps": steps,
            "sleepMinutes": sleep_minutes,
        },
        "pet": {
            "name": "小轻",
            "mood": "温柔提醒中",
            "fixed": True,
        },
        "answer": {
            "text": "你今天适合先轻一点：上午处理低压力任务，出门前简单提气色；如果下午恢复感变好，再进入重点准备。",
            "basis": ["今日健康数据", "压力/HRV", "久坐与运动"],
            "confidence": "medium",
        },
        "model": {
            "provider": "volcengine_doubao",
            "status": "pending_key",
        },
        "conversation": ai_growth.recent_messages(db, user_id),
    }


@router.get("/health/growthGirlfriend/context")
def growth_girlfriend_context(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(growth_girlfriend_context_payload(db, int(user["id"])))


@router.post("/health/growthGirlfriend/chat")
async def growth_girlfriend_chat(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    question = str(payload.get("question") or payload.get("text") or "").strip()
    context = growth_girlfriend_context_payload(db, int(user["id"]))
    if not question:
        return success(context["answer"])
    try:
        ai_result = ai_growth.chat(question, context)
    except ai_growth.GrowthAIError as exc:
        ai_result = {
            "text": "今天先别硬撑，优先完成低压力任务；状态回升后再处理重点事项。",
            "provider": "fallback",
            "model": "local-rule",
            "status": "provider_error",
            "error": str(exc),
        }
    ai_growth.save_message(
        db,
        int(user["id"]),
        question,
        ai_result["text"],
        ai_result.get("provider"),
        ai_result.get("model"),
        ai_result.get("status"),
    )
    return success({
        "text": ai_result["text"],
        "basis": context["answer"]["basis"],
        "confidence": context["answer"]["confidence"],
        "provider": ai_result.get("provider"),
        "model": ai_result.get("model"),
        "modelStatus": ai_result.get("status"),
        "usage": ai_result.get("rawUsage"),
        "error": ai_result.get("error"),
    })


@router.post("/health/growthGirlfriend/asr")
async def growth_girlfriend_asr(request: Request, file: UploadFile, _user: dict = Depends(app_user)):
    content = b""
    file_url = ""
    try:
        content = await file.read()
        suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
        audio_dir = Path("uploads/app/growth-girlfriend/asr")
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_path = audio_dir / f"{uuid4().hex}{suffix}"
        audio_path.write_bytes(content)
        public_base = (settings.app_public_base_url.strip() or str(request.base_url)).rstrip("/")
        file_url = f"{public_base}/app/files/growth-girlfriend/asr/{audio_path.name}"
        write_algorithm_log("growth_girlfriend_asr_uploaded", file_size=len(content), file_url=file_url)
        started_at = perf_counter()
        result = ai_growth.transcribe_audio_file(audio_path.resolve())
        write_algorithm_log(
            "growth_girlfriend_asr_result",
            elapsed_ms=int((perf_counter() - started_at) * 1000),
            file_size=len(content),
            file_url=file_url,
            status=result.get("status"),
            message=result.get("message"),
            text_length=len(result.get("text") or ""),
        )
        result["fileUrl"] = file_url
        result["fileSize"] = len(content)
        return success(result)
    except ai_growth.GrowthAIError as exc:
        return success({
            "text": "",
            "provider": "aliyun-dashscope",
            "model": settings.ali_asr_model,
            "status": "error",
            "message": str(exc),
            "fileUrl": file_url,
            "fileSize": len(content),
        })
    except Exception as exc:
        write_algorithm_log("growth_girlfriend_asr_error", file_size=len(content), file_url=file_url, error=str(exc))
        return success({
            "text": "",
            "provider": "aliyun-dashscope",
            "model": settings.ali_asr_model,
            "status": "error",
            "message": f"ASR 服务异常: {str(exc)[:300]}",
            "fileUrl": file_url,
            "fileSize": len(content),
        })


@router.get("/health/growthGirlfriend/asr/ping")
def growth_girlfriend_asr_ping():
    return success({
        "status": "ok",
        "provider": "aliyun-dashscope",
        "model": settings.ali_asr_model,
        "appPublicBaseUrl": settings.app_public_base_url,
    })


@router.post("/health/growthGirlfriend/tts")
async def growth_girlfriend_tts(request: Request, _user: dict = Depends(app_user)):
    payload = await request.json()
    text_value = str(payload.get("text") or "").strip()
    if not text_value:
        return success({"audioBase64": "", "status": "empty_text"})
    try:
        return success(ai_growth.synthesize_speech(text_value))
    except ai_growth.GrowthAIError as exc:
        return success({
            "audioBase64": "",
            "audioUrl": "",
            "provider": "aliyun-dashscope",
            "model": settings.ali_tts_model,
            "status": "error",
            "message": str(exc),
        })


@router.get("/health/sleep/preparation")
def health_sleep_preparation(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    current_start, current_end, current, previous = weekly_context(db, user_id)
    current_score = avg_value(current, "sleepScore")
    prev_score = avg_value(previous, "sleepScore")
    return localized_success({
        "overview": overview_payload(current_score, prev_score, current_start, current_end),
        "trendChart": weekly_trend(db, user_id, lambda items: int(round(avg_value(items, "sleepScore") or 0)) if avg_value(items, "sleepScore") is not None else None),
        "heartRateChange": {"currentValue": int(round(avg_value(current, "heartRateAvg") or 0)), "currentDirection": "保持不变", "avgValue": int(round(avg_value(previous, "heartRateAvg") or 0)), "avgDirection": "保持不变"},
        "hrvChange": {"currentValue": int(round(avg_value(current, "hrvAvg") or 0)), "currentDirection": "保持不变", "avgValue": int(round(avg_value(previous, "hrvAvg") or 0)), "avgDirection": "保持不变"},
    })
    summaries = recent_summaries(db, int(user["id"]))
    current = int((summaries[0] if summaries else {}).get("sleepScore") or 0)
    return localized_success({
        "overview": overview_payload(current),
        "trendChart": trend_chart(summaries, "sleepScore"),
        "heartRateChange": {"currentValue": 0, "currentDirection": "保持不变", "avgValue": 0, "avgDirection": "保持不变"},
        "hrvChange": {"currentValue": 0, "currentDirection": "保持不变", "avgValue": 0, "avgDirection": "保持不变"},
    })


@router.get("/health/sleep/rhythm")
def health_sleep_rhythm(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    current_start, current_end, _current, _previous = weekly_context(db, user_id)
    current_score = sleep_rhythm_score(sleep_records_between(db, user_id, current_start, current_end, require_start=True))
    prev_score = sleep_rhythm_score(sleep_records_between(db, user_id, current_start - timedelta(weeks=4), current_start - timedelta(days=1), require_start=True))
    trend_items = []
    regularity_chart = []
    for start, end in week_ranges(current_start):
        records = sleep_records_between(db, user_id, start, end, require_start=True)
        score = sleep_rhythm_score(records)
        starts = [item.get("startTime") for item in records if sleep_type_key(item.get("type")) not in {"INVALID", "AWAKE", "NAP"} and isinstance(item.get("startTime"), datetime)]
        avg_minutes = int(sum(item.hour * 60 + item.minute for item in starts) / len(starts)) if starts else 0
        trend_items.append({"weekLabel": week_label(start), "score": score, "value": score, "level": score_level(score or 0)})
        regularity_chart.append({"weekLabel": week_label(start), "avgSleepTime": avg_minutes})
    return localized_success({
        "overview": overview_payload(current_score, prev_score, current_start, current_end),
        "trendChart": trend_items,
        "regularityChart": regularity_chart,
    })
    summaries = recent_summaries(db, int(user["id"]))
    current = int((summaries[0] if summaries else {}).get("sleepScore") or 0)
    return localized_success({
        "overview": overview_payload(current),
        "trendChart": trend_chart(summaries, "sleepScore"),
        "regularityChart": [{"weekLabel": item["weekLabel"], "avgSleepTime": 0} for item in trend_chart(summaries, "sleepScore")],
    })


@router.get("/health/sleep/recovery")
def health_sleep_recovery(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    current_start, current_end, current, previous = weekly_context(db, user_id)
    current_score = recovery_score(current)
    prev_score = recovery_score(previous)
    avg_minutes = int(round(avg_value(current, "sleepTotalTime") or 0))
    return localized_success({
        "overview": overview_payload(current_score, prev_score, current_start, current_end),
        "trendChart": weekly_trend(db, user_id, recovery_score),
        "durationChart": [{"weekLabel": week_label(start), "hours": round((avg_value(summaries_between(db, user_id, start, end), "sleepTotalTime") or 0) / 60, 1)} for start, end in week_ranges(current_start)],
        "avgDuration": duration_text(avg_minutes),
        "durationLevel": duration_level(avg_minutes),
        "recoveryRatio": recovery_ratio(current) or 0,
    })
    summaries = recent_summaries(db, int(user["id"]))
    current_item = summaries[0] if summaries else {}
    current = int(current_item.get("sleepScore") or 0)
    minutes = int(current_item.get("sleepTotalTime") or 0)
    return localized_success({
        "overview": overview_payload(current),
        "trendChart": trend_chart(summaries, "sleepScore"),
        "durationChart": [{"weekLabel": str(item.get("recordDate") or "")[5:10], "hours": round((item.get("sleepTotalTime") or 0) / 60, 1)} for item in reversed(summaries)],
        "avgDuration": f"{minutes // 60}小时{minutes % 60}分钟",
        "durationLevel": "充足" if minutes >= 420 else "不足",
        "recoveryRatio": 0,
    })


@router.get("/health/sleep/activation")
def health_sleep_activation(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    current_start, current_end, current, previous = weekly_context(db, user_id)
    current_score = avg_value(current, "sleepScore")
    prev_score = avg_value(previous, "sleepScore")
    return localized_success({
        "overview": overview_payload(current_score, prev_score, current_start, current_end),
        "trendChart": weekly_trend(db, user_id, lambda items: int(round(avg_value(items, "sleepScore") or 0)) if avg_value(items, "sleepScore") is not None else None),
        "activation": current_score,
        "level": score_level(int(current_score or 0)),
    })
    summaries = recent_summaries(db, int(user["id"]))
    current = int((summaries[0] if summaries else {}).get("sleepScore") or 0)
    return localized_success({
        "overview": overview_payload(current),
        "trendChart": trend_chart(summaries, "sleepScore"),
    })


@router.get("/health/activity/sedentary")
def health_activity_sedentary(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    current_start, current_end, current, previous = weekly_context(db, user_id)
    current_score = sedentary_score(current)
    prev_score = sedentary_score(previous)
    avg_steps = int(round(avg_value(current, "totalSteps") or 0))
    avg_active = avg_value(current, "activeTime") or 0
    activity_level = round(1.2 + min(avg_steps / 10000, 0.5) + min(avg_active / 60, 0.7), 1) if current else 0
    return localized_success({
        "overview": overview_payload(current_score, prev_score, current_start, current_end),
        "trendChart": weekly_trend(db, user_id, sedentary_score),
        "stepChart": [{"weekLabel": week_label(start), "steps": int(round(avg_value(summaries_between(db, user_id, start, end), "totalSteps") or 0))} for start, end in week_ranges(current_start)],
        "avgSteps": avg_steps,
        "stepsLevel": "充足" if avg_steps >= 10000 else ("正常" if avg_steps >= 6000 else "不足"),
        "activityLevel": activity_level,
        "activeMinutes": int(round(avg_active)),
        "standingHours": 0,
        "riskScore": 100 - current_score if current_score is not None else None,
        "riskLevel": score_level(int(current_score or 0)),
        "avgDailySedentaryHours": 0,
        "maxConsecutiveHours": 0,
    })
    summaries = recent_summaries(db, int(user["id"]))
    current_item = summaries[0] if summaries else {}
    current = int(current_item.get("motionScore") or 0)
    return localized_success({
        "overview": overview_payload(current),
        "trendChart": trend_chart(summaries, "motionScore"),
        "stepChart": [{"weekLabel": str(item.get("recordDate") or "")[5:10], "steps": int(item.get("totalSteps") or 0)} for item in reversed(summaries)],
        "avgSteps": int(sum(int(item.get("totalSteps") or 0) for item in summaries) / len(summaries)) if summaries else 0,
        "stepsLevel": "充足" if int(current_item.get("totalSteps") or 0) >= 8000 else "不足",
        "activityLevel": 0,
        "activeMinutes": int(current_item.get("activeTime") or 0),
        "standingHours": 0,
    })


@router.get("/health/activity/intensity")
def health_activity_intensity(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    current_start, current_end, current, previous = weekly_context(db, user_id)
    current_score = intensity_score(current)
    prev_score = intensity_score(previous)
    total_minutes = sum(int(item.get("activeTime") or 0) for item in current)
    expected = max(len(current), 1) * 30
    if total_minutes >= expected * 1.5:
        intensity_level = "偏高"
    elif total_minutes >= expected * 0.8:
        intensity_level = "正常"
    else:
        intensity_level = "偏低"
    return localized_success({
        "overview": overview_payload(current_score, prev_score, current_start, current_end),
        "trendChart": weekly_trend(db, user_id, intensity_score),
        "durationChart": [{"weekLabel": week_label(start), "minutes": sum(int(item.get("activeTime") or 0) for item in summaries_between(db, user_id, start, end))} for start, end in week_ranges(current_start)],
        "totalMinutes": total_minutes,
        "intensityLevel": intensity_level,
        "riskScore": 100 - current_score if current_score is not None else None,
        "riskLevel": score_level(int(current_score or 0)),
        "riskType": intensity_level,
        "avgDailySteps": avg_value(current, "totalSteps"),
        "highIntensityDays": sum(1 for item in current if int(item.get("activeTime") or 0) >= 30),
        "lowActivityDays": sum(1 for item in current if int(item.get("activeTime") or 0) < 15),
    })
    summaries = recent_summaries(db, int(user["id"]))
    current_item = summaries[0] if summaries else {}
    current = int(current_item.get("motionScore") or 0)
    total_minutes = int(current_item.get("activeTime") or 0)
    return localized_success({
        "overview": overview_payload(current),
        "trendChart": trend_chart(summaries, "motionScore"),
        "durationChart": [{"weekLabel": str(item.get("recordDate") or "")[5:10], "minutes": int(item.get("activeTime") or 0)} for item in reversed(summaries)],
        "totalMinutes": total_minutes,
        "intensityLevel": "正常负荷" if total_minutes >= 30 else "轻度负荷",
    })


@router.get("/health/activity/regularity")
def health_activity_regularity(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    current_start, current_end, current, previous = weekly_context(db, user_id)
    current_score = regularity_score(current)
    prev_score = regularity_score(previous)
    avg_active = avg_value(current, "activeTime", positive=False)
    balance_index = round(max(0, min(2, (avg_active or 0) / 30)), 2) if avg_active is not None else 0
    if balance_index >= 1.2:
        balance_level = "偏高"
    elif balance_index >= 0.7:
        balance_level = "正常"
    else:
        balance_level = "偏低"
    five_week = summaries_between(db, user_id, current_start - timedelta(weeks=4), current_end)
    return localized_success({
        "overview": overview_payload(current_score, prev_score, current_start, current_end),
        "trendChart": weekly_trend(db, user_id, regularity_score),
        "balanceChart": [{"weekLabel": week_label(start), "index": round(max(0, min(2, (avg_value(summaries_between(db, user_id, start, end), "activeTime", positive=False) or 0) / 30)), 2)} for start, end in week_ranges(current_start)],
        "balanceIndex": balance_index,
        "balanceLevel": balance_level,
        "midHighDays": sum(1 for item in five_week if int(item.get("activeTime") or 0) >= 30),
        "regularityScore": current_score,
        "regularityLevel": score_level(int(current_score or 0)),
        "avgWeeklyFrequency": sum(1 for item in five_week if int(item.get("activeTime") or 0) >= 30),
        "avgWeeklyDuration": avg_active or 0,
    })
    summaries = recent_summaries(db, int(user["id"]))
    current = int((summaries[0] if summaries else {}).get("motionScore") or 0)
    return localized_success({
        "overview": overview_payload(current),
        "trendChart": trend_chart(summaries, "motionScore"),
        "balanceChart": [{"weekLabel": str(item.get("recordDate") or "")[5:10], "index": int(item.get("motionScore") or 0)} for item in reversed(summaries)],
        "balanceIndex": current,
        "balanceLevel": "正常负荷" if current >= 60 else "轻度负荷",
        "midHighDays": sum(1 for item in summaries if int(item.get("activeTime") or 0) >= 30),
    })


@router.get("/data/heartRate/heartRateDetail")
@router.get("/data/sleep/heartRateDetail")
def heart_rate_detail(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return localized_success(data_detail_response(db, int(user["id"]), date_from_request(request), "heart_rate", "heartRateScore", "heartRateAvg"))


@router.get("/data/hrv/hrvDetail")
@router.get("/data/sleep/hrvDetail")
def hrv_detail(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return localized_success(data_detail_response(db, int(user["id"]), date_from_request(request), "hrv", "hrvScore", "hrvAvg"))


@router.get("/data/bloodOxygen/bloodOxygenDetail")
@router.get("/data/sleep/bloodOxygenDetail")
def blood_oxygen_detail(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return localized_success(data_detail_response(db, int(user["id"]), date_from_request(request), "spo2", "spo2Score", "spo2Avg"))


@router.get("/data/bodyTemperature/bodyTemperatureDetail")
def body_temperature_detail(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return localized_success(data_detail_response(db, int(user["id"]), date_from_request(request), "temperature", "temperatureScore", "temperatureAvg"))


@router.get("/data/stress/stressDetail")
def stress_detail(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    date_value = date_from_request(request)
    rows = stress_records(db, user_id, date_value, include_hrv_only=True)
    if not rows:
        return localized_success({
            "stressValue": 0,
            "stressLevel": "",
            "stressChart": [],
            "stressRange": "0-0",
            "avgStressValue": 0,
            "latestHrvValue": 0,
            "dailyAvgHrvValue": 0,
            "algorithm": {},
        })
    values = [value for row in rows for value in [stress_value_from_row(row)] if value is not None]
    hrv_values = [int(row_mapping(row).get("hrv") or 0) for row in rows if row_mapping(row).get("hrv")]
    avg_value = int(round(sum(values) / len(values))) if values else 0
    algorithm = stress_algorithm_response(rows, {"source": "stressDetail", "userId": user_id, "date": date_value})
    return localized_success({
        "stressValue": avg_value,
        "stressLevel": stress_level(avg_value),
        "stressChart": stress_chart(rows),
        "stressRange": f"{min(values)}-{max(values)}" if values else "0-0",
        "avgStressValue": avg_value,
        "latestHrvValue": hrv_values[-1] if hrv_values else 0,
        "dailyAvgHrvValue": int(sum(hrv_values) / len(hrv_values)) if hrv_values else 0,
        "stressRatio": score_from_result(algorithm, "stressRatio", "avgStressLevel"),
        "highStressRatio": score_from_result(algorithm, "highStressRatio"),
        "highStressDays": score_from_result(algorithm, "highStressDays"),
        "algorithm": algorithm,
    })


@router.get("/data/stress/stressProportion")
def stress_proportion(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    rows = stress_records(db, int(user["id"]), date_from_request(request), include_hrv_only=True)
    if not rows:
        return localized_success({"stressDuration": [], "stressProportionChart": []})
    counts = stress_counts(rows)
    total = sum(counts.values())
    labels = ["放松", "正常", "中等", "偏高"]
    return localized_success({
        "stressDuration": [{"time": label, "value": str(counts[label])} for label in labels],
        "stressProportionChart": [
            {"time": label, "value": str(round((counts[label] / total) * 100) if total else 0)}
            for label in labels
        ],
    })


@router.get("/data/stress/stressSummary")
def stress_summary(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    date_value = date_from_request(request)
    today_rows = stress_records(db, user_id, date_value, include_hrv_only=True)
    week_rows = stress_records(db, user_id, date_value, days=7, include_hrv_only=True)
    today_values = [value for row in today_rows for value in [stress_value_from_row(row)] if value is not None]
    week_values = [value for row in week_rows for value in [stress_value_from_row(row)] if value is not None]
    counts = stress_counts(today_rows)
    algorithm = stress_algorithm_response(today_rows, {"source": "stressSummary", "userId": user_id, "date": date_value})
    return localized_success({
        "todayStressChart": stress_chart(today_rows),
        "weekStressChart": stress_chart(week_rows, "%m-%d"),
        "todayStressScore": int(sum(today_values) / len(today_values)) if today_values else 0,
        "weekAvgStressScore": int(sum(week_values) / len(week_values)) if week_values else 0,
        "relaxDuration": counts["放松"],
        "normalDuration": counts["正常"],
        "moderateStressDuration": counts["中等"],
        "highStressDuration": counts["偏高"],
        "algorithm": algorithm,
    })


@router.get("/data/motion/motionOverview")
def motion_overview(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    date_value = date_from_request(request)
    summary = daily_summary(db, user_id, date_value) or {}
    return success({
        "step": summary_steps_or_raw(db, user_id, date_value, summary),
        "calorie": round(float(summary.get("totalCalorie") or 0)),
        "calorieUnit": CALORIE_UNIT,
        "motionTime": int(summary.get("activeTime") or 0),
        "targetStep": 8000,
        "targetCalorie": 300,
        "targetMotionTime": 30,
    })


@router.get("/data/motion/motionCalorie")
def motion_calorie(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    date_value = date_from_request(request)
    summary = daily_summary(db, user_id, date_value) or {}
    total_calorie = round(float(summary.get("totalCalorie") or 0))
    return success({
        "totalCalorie": total_calorie,
        "calorieUnit": CALORIE_UNIT,
        "targetCalorie": 300,
        "motionCalorie": total_calorie,
        "basalCalorie": 0,
        "motionCalorieChart": raw_points(db, user_id, date_value, "step_count"),
        "basalCalorieChart": [],
    })


@router.get("/data/motion/motionIntensity")
def motion_intensity(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    counts = motion_intensity_counts(db, int(user["id"]), date_from_request(request))
    total = sum(counts.values())
    labels = [
        ("inactive", "静息"),
        ("low", "低强度"),
        ("moderate", "中等强度"),
        ("high", "高强度"),
    ]
    return localized_success({
        "motionChart": [{"time": label, "value": str(counts[key])} for key, label in labels],
        "motionRatioChart": [
            {"time": label, "value": str(round((counts[key] / total) * 100) if total else 0)}
            for key, label in labels
        ],
        "inactiveDuration": counts["inactive"],
        "lowIntensityDuration": counts["low"],
        "moderateIntensityDuration": counts["moderate"],
        "highIntensityDuration": counts["high"],
    })


@router.get("/data/motion/motionDetail")
def motion_detail(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    date_value = date_from_request(request)
    summary = daily_summary(db, user_id, date_value) or {}
    step = summary_steps_or_raw(db, user_id, date_value, summary)
    calorie = round(float(summary.get("totalCalorie") or 0))
    distance = float(summary.get("totalDistance") or 0)
    step_chart = raw_points(db, user_id, date_value, "step_count")
    return success({
        "calorie": calorie,
        "calorieUnit": CALORIE_UNIT,
        "targetCalorie": 300,
        "calorieChart": step_chart,
        "step": step,
        "targetStep": 8000,
        "stepChart": step_chart,
        "distance": str(round(distance, 2)),
        "distanceChart": step_chart,
    })


@router.get("/data/motion/motionSummary")
def motion_summary(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    date_value = date_from_request(request)
    summary = daily_summary(db, user_id, date_value) or {}
    yesterday_value = None
    if date_value:
        try:
            yesterday_value = (datetime.strptime(date_value, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
        except ValueError:
            yesterday_value = None
    yesterday_summary = daily_summary(db, user_id, yesterday_value) or {}
    motion_minutes = health.motion_minutes_from_steps(db, user_id, date_value) if date_value else {"mid_high_minutes": 0}
    return localized_success({
        "todayStep": summary_steps_or_raw(db, user_id, date_value, summary),
        "todayStepChart": raw_points(db, user_id, date_value, "step_count"),
        "yesterdayStep": summary_steps_or_raw(db, user_id, yesterday_value, yesterday_summary),
        "yesterdayStepChart": raw_points(db, user_id, yesterday_value, "step_count") if yesterday_value else [],
        "motionCalorie": round(float(summary.get("totalCalorie") or 0)),
        "calorieUnit": CALORIE_UNIT,
        "motionTime": int(summary.get("activeTime") or 0),
        "midHighTime": motion_minutes["mid_high_minutes"],
        "motionScore": summary.get("motionScore"),
        "algorithm": {},
    })


@router.get("/data/sleep/sleepOverview")
def sleep_overview(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    date_value = date_from_request(request)
    user_id = int(user["id"])
    records = sleep_records(db, user_id, date_value)
    values = effective_sleep_values(db, user_id, date_value, records)
    awake = values["AWAKE"]
    rem = values["REM"]
    light = values["LIGHT"]
    deep = values["DEEP"]
    nap = values["NAP"]
    total_sleep_time = rem + light + deep + nap
    awake_count = sum(1 for row in records if sleep_type_key(dict(row._mapping).get("type")) == "AWAKE")
    return localized_success({
        "sleepDuration": str(total_sleep_time),
        "sleepQuality": str(int(calculate_sleep_efficiency(awake, rem, light, deep, nap))),
        "sleepScore": calculate_sleep_score(awake, rem, light, deep, nap),
        "awakeCount": awake_count,
        "algorithm": {},
    })


@router.get("/data/sleep/sleepDetail")
def sleep_detail(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    date_value = date_from_request(request)
    user_id = int(user["id"])
    records = sleep_records(db, user_id, date_value)
    values = effective_sleep_values(db, user_id, date_value, records)
    summary = daily_summary(db, user_id, date_value) or {}
    chart_data = [
        {
            "time": str(dict(row._mapping).get("start_time") or "")[11:16],
            "value": str(dict(row._mapping).get("sleep_time") or 0),
        }
        for row in records
    ]
    if not chart_data:
        chart_data = raw_sleep_chart_data(db, user_id, date_value)
    return localized_success({
        "healthScore": summary.get("healthScore"),
        "latestDesc": summary.get("healthLevel"),
        "sleepDuration": values["REM"] + values["LIGHT"] + values["DEEP"] + values["NAP"],
        "type": request.query_params.get("type") or "day",
        "startDate": date_value,
        "endDate": date_value,
        "chartData": chart_data,
    })


@router.get("/data/sleep/sleepSegment")
def sleep_segment(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    date_value = date_from_request(request)
    user_id = int(user["id"])
    records = sleep_records(db, user_id, date_value)
    values = effective_sleep_values(db, user_id, date_value, records)
    total = sum(values.values())
    labels = [
        ("DEEP", "深睡"),
        ("LIGHT", "浅睡"),
        ("REM", "快速眼动"),
        ("AWAKE", "清醒"),
        ("NAP", "小睡"),
    ]
    start_time = "00:00"
    end_time = "00:00"
    if records:
        first = dict(records[0]._mapping).get("start_time")
        last = dict(records[-1]._mapping).get("end_time")
        start_time = str(first)[11:16] if first else "00:00"
        end_time = str(last)[11:16] if last else "00:00"
    else:
        start_time, end_time = raw_sleep_time_range(db, user_id, date_value)
    return localized_success({
        "startTime": start_time,
        "endTime": end_time,
        "chartData": [
            {"time": label, "value": str(round((values[key] / total) * 100) if total else 0)}
            for key, label in labels
        ],
        "chartDataSection": [
            {"time": label, "value": str(values[key])}
            for key, label in labels
        ],
    })


@router.get("/data/sleep/sleepSummary")
def sleep_summary(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    date_value = date_from_request(request)
    user_id = int(user["id"])
    records = sleep_records(db, user_id, date_value)
    values = effective_sleep_values(db, user_id, date_value, records)
    awake = values["AWAKE"]
    rem = values["REM"]
    light = values["LIGHT"]
    deep = values["DEEP"]
    nap = values["NAP"]
    sleep_minutes = rem + light + deep + nap
    bed_time = 0
    if records:
        first = dict(records[0]._mapping).get("start_time")
        last = dict(records[-1]._mapping).get("end_time")
        if first and last:
            bed_time = max(0, int((last - first).total_seconds() // 60))
    else:
        sleep_start, sleep_end = raw_sleep_time_range(db, user_id, date_value)
        if sleep_start != "00:00" or sleep_end != "00:00":
            start_minutes = int(sleep_start[:2]) * 60 + int(sleep_start[3:5])
            end_minutes = int(sleep_end[:2]) * 60 + int(sleep_end[3:5])
            if end_minutes < start_minutes:
                end_minutes += 24 * 60
            bed_time = max(0, end_minutes - start_minutes)
    return localized_success({
        "sleepMinutes": str(sleep_minutes),
        "avgSleepMinutes7d": str(sleep_minutes),
        "bedTime": str(bed_time),
        "sleepEfficiency": f"{calculate_sleep_efficiency(awake, rem, light, deep, nap):.2f}",
        "sleepHeartRate": "0",
        "sleepScore": str(calculate_sleep_score(awake, rem, light, deep, nap)),
        "lastNightSleepMinutes": "0",
    })


@router.get("/data/sleep/raw")
def sleep_raw(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    date_value = date_from_request(request)
    records = sleep_records(db, int(user["id"]), date_value)
    return success({"summary": daily_summary(db, int(user["id"]), date_value) or {}, "list": [camelize_dict(dict(row._mapping)) for row in records]})


@router.get("/data/sleep/napList")
def nap_list(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    rows = sleep_records(db, int(user["id"]), date_from_request(request))
    naps = [row for row in rows if sleep_type_key(dict(row._mapping).get("type")) == "NAP"]
    return success([camelize_dict(dict(row._mapping)) for row in sorted(naps, key=lambda row: dict(row._mapping).get("start_time") or datetime.min, reverse=True)])


@router.post("/data/sleep/addNap")
async def add_nap(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    table = get_table("sleep_record")
    values = clean_payload(table, payload)
    values["user_id"] = user["id"]
    values["type"] = values.get("type") or "NAP"
    db.execute(table.insert().values(**values))
    db.commit()
    return success(True)


@router.delete("/data/sleep/deleteNap")
def delete_nap(id: int, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    result = db.execute(text("delete from sleep_record where id=:id and user_id=:user_id"), {"id": id, "user_id": user["id"]})
    db.commit()
    return success((result.rowcount or 0) > 0)


@router.post("/girlHealth/addGirlHealth")
async def add_girl_health(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    health.upsert_girl_health(db, int(user["id"]), await request.json(), create=True)
    return success(True)


@router.post("/girlHealth/updateGirlHealth")
async def update_girl_health(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    health.upsert_girl_health(db, int(user["id"]), await request.json(), create=False)
    return success(True)


@router.get("/girlHealth/getGirlHealth")
def get_girl_health(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(health.get_girl_health(db, int(user["id"])))


@router.get("/girlHealth/getHealthTempStats")
def get_health_temp_stats(newDate: str | None = None, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    newDate = newDate or __import__("datetime").date.today().isoformat()
    rows = db.execute(
        text(
            """
            select record_time, temperature
            from health_raw
            where user_id=:user_id and record_time >= :new_date and temperature is not null
            order by record_time asc
            """
        ),
        {"user_id": user["id"], "new_date": newDate},
    ).all()
    return success([camelize_dict(dict(row._mapping)) for row in rows])


@router.get("/girlHealth/getUserGirlHealthAll")
def get_user_girl_health_all(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    girl = health.get_girl_health(db, int(user["id"]))
    if not girl:
        return success("无女性健康基础信息")
    records = db.execute(
        text(
            """
            select record_date, temperature_avg, heart_rate_avg
            from health_daily_summary
            where user_id=:user_id and temperature_avg is not null and heart_rate_avg is not null
            order by record_date desc limit 62
            """
        ),
        {"user_id": user["id"]},
    ).all()
    last_period_time = str(girl.get("lastPeriodTime") or "")
    dates = [item for item in last_period_time.split(",") if item]
    last_start = girl.get("lastPeriodTimePoint") or (min(dates) if dates else None)
    payload = {
        "lastMenstrualStartDate": last_start,
        "cycleLength": girl.get("periodCycle"),
        "records": [
            {
                "ts": epoch_seconds(row._mapping["record_date"]),
                "temp": float(row._mapping["temperature_avg"] or 0),
                "hr": int(float(row._mapping["heart_rate_avg"] or 0)),
            }
            for row in reversed(records)
        ],
    }
    if not settings.other_api_base_url:
        return success(payload)

    response = call_algorithm(
        "/physicalHealth/ovulationPrediction",
        payload,
        payload,
        context={"source": "getUserGirlHealthAll", "userId": int(user["id"])},
    )
    predicted_cycle = response.get("predictedCycle") if isinstance(response, dict) else None
    luteal = predicted_cycle.get("luteal") if isinstance(predicted_cycle, dict) else None
    luteal_end = luteal.get("end") if isinstance(luteal, dict) else None
    if luteal_end and girl.get("id"):
        try:
            next_day = date.fromisoformat(str(luteal_end)) + timedelta(days=1)
            db.execute(
                text("update user_girl_health set last_time_over=:last_time_over where id=:id"),
                {"last_time_over": next_day.isoformat(), "id": girl["id"]},
            )
            db.commit()
        except ValueError:
            pass
    return success(response)


@router.get("/system/dict/data/type/{dict_type}")
def dict_data_by_type(dict_type: str, db: Session = Depends(get_db)):
    rows, _ = list_rows(db, "sys_dict_data", {"dictType": dict_type}, 1, 500, set())
    return success(rows)


@router.get("/system/dict/data/list")
def app_dict_data_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 500) or 500)
    rows, total = list_rows(db, "sys_dict_data", query, page_num, page_size, {"dictLabel", "dictType"})
    return table(rows, total)


@router.post("/system/dict/data/export")
def app_dict_data_export(request: Request, _: dict = Depends(app_user), db: Session = Depends(get_db)):
    query = dict(request.query_params)
    rows, _ = list_rows(db, "sys_dict_data", query, 1, 100000, {"dictLabel", "dictType"})
    output = io.StringIO()
    writer = csv.writer(output)
    headers = list(rows[0].keys()) if rows else []
    writer.writerow(headers)
    for row in rows:
        writer.writerow([row.get(header, "") for header in headers])
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=app_dict_data.csv", "download-filename": "app_dict_data.csv"},
    )


@router.get("/system/dict/data/{dict_code}")
def app_dict_data_detail(dict_code: str, db: Session = Depends(get_db)):
    return success(get_row(db, "sys_dict_data", dict_code))


@router.post("/system/dict/data")
async def app_dict_data_create(request: Request, _: dict = Depends(app_user), db: Session = Depends(get_db)):
    from app.services.crud import create_row

    return success() if create_row(db, "sys_dict_data", await request.json()) > 0 else error()


@router.put("/system/dict/data")
async def app_dict_data_update(request: Request, _: dict = Depends(app_user), db: Session = Depends(get_db)):
    from app.services.crud import update_row

    return success() if update_row(db, "sys_dict_data", await request.json()) > 0 else error()


@router.delete("/system/dict/data/{dict_codes}")
def app_dict_data_delete(dict_codes: str, _: dict = Depends(app_user), db: Session = Depends(get_db)):
    from app.services.crud import delete_rows

    return success() if delete_rows(db, "sys_dict_data", dict_codes) > 0 else error()


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def app_pending(path: str):
    return not_migrated(f"/app/{path}")
