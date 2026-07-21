from __future__ import annotations

import hashlib
import hmac
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.sleepfm import SCHEMA_VERSION, SleepFMExportRequest


APP_TIMEZONE = timezone(timedelta(hours=8))
EPOCH_MINUTES = 5
SERIES_FIELDS = ("hr", "hrv", "skin_temp", "rr", "spo2", "actigraphy")


class SleepFMExportError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def verify_service_token(provided: str | None, expected: str) -> None:
    token = (provided or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not expected or not token or not hmac.compare_digest(token, expected):
        raise SleepFMExportError(401, "unauthorized", "服务鉴权失败")


def export_real_user_input(
    db: Session,
    request: SleepFMExportRequest,
    hash_secret: str,
    consented_user_ids: str,
) -> dict[str, Any]:
    if request.schema_version != SCHEMA_VERSION:
        raise SleepFMExportError(400, "invalid_schema_version", "schema_version 不支持")
    if request.preferred_input_mode in {"psg_modalities", "edf_reference"}:
        raise SleepFMExportError(409, "data_not_ready", "当前产品中心仅能导出 ring_6d_layer_a 数据")
    user = _load_user(db, request.user_id)
    if not user:
        raise SleepFMExportError(404, "user_not_found", "找不到指定用户")
    consented = {item.strip() for item in consented_user_ids.split(",") if item.strip()}
    if str(user["id"]) not in consented and str(user.get("code") or "") not in consented:
        raise SleepFMExportError(403, "consent_missing", "用户缺少 sleepfm_research_eval 授权")

    dates = _requested_dates(request)[: request.max_nights]
    nights = []
    missing = []
    user_hash = _hash_identifier(str(user["id"]), hash_secret)
    for night_date, requested_night_id in dates:
        night = _build_night(db, user, user_hash, night_date, requested_night_id, request.include_labels)
        if night is None:
            missing.append(requested_night_id)
        else:
            nights.append(night)
    if not nights:
        raise SleepFMExportError(404, "night_not_found", f"找不到指定夜晚: {', '.join(missing)}")

    now = datetime.now(APP_TIMEZONE)
    return {
        "schema_version": SCHEMA_VERSION,
        "request_id": request.request_id,
        "export_id": f"exp_{now:%Y%m%d_%H%M%S}_{uuid4().hex[:8]}",
        "generated_at": now,
        "user": _user_profile(user, user_hash),
        "nights": nights,
        "privacy": {
            "deidentified": True,
            "contains_direct_identifiers": False,
            "consent_scope": "sleepfm_research_eval",
            "retention_days": 30,
        },
    }


def _load_user(db: Session, user_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            select id, code, birthday, sex, height, weight
            from app_user
            where (cast(id as char)=:user_id or code=:user_id) and coalesce(del_flag, 0)=0
            limit 1
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    return dict(row) if row else None


def _requested_dates(request: SleepFMExportRequest) -> list[tuple[date, str]]:
    result: list[tuple[date, str]] = []
    if request.night_ids:
        for night_id in request.night_ids:
            raw_date = night_id.removeprefix("night_").replace("-", "")
            try:
                value = datetime.strptime(raw_date, "%Y%m%d").date()
            except ValueError as exc:
                raise SleepFMExportError(400, "invalid_time_window", f"night_id 格式错误: {night_id}") from exc
            result.append((value, night_id))
    elif request.date_range:
        current = request.date_range.start
        while current <= request.date_range.end:
            result.append((current, f"night_{current:%Y%m%d}"))
            current += timedelta(days=1)
    return result


def _build_night(
    db: Session,
    user: dict[str, Any],
    user_hash: str,
    night_date: date,
    night_id: str,
    include_labels: bool,
) -> dict[str, Any] | None:
    summary = db.execute(
        text(
            """
            select device_mac, sleep_start_time, sleep_end_time
            from health_daily_summary
            where user_id=:user_id and record_date=:record_date
            order by update_time desc limit 1
            """
        ),
        {"user_id": user["id"], "record_date": night_date},
    ).mappings().first()
    start, end = _sleep_window(db, int(user["id"]), night_date, summary)
    if start is None or end is None or end <= start:
        return None
    if end - start < timedelta(hours=2):
        raise SleepFMExportError(400, "invalid_time_window", f"{night_id} 有效睡眠窗口不足 2 小时")

    rows = db.execute(
        text(
            """
            select record_time, device_mac, heart_rate, hrv, temperature, spo2,
                   motion_intensity, step_count
            from health_raw
            where user_id=:user_id and record_time>=:start and record_time<:end
            order by record_time
            """
        ),
        {"user_id": user["id"], "start": start, "end": end},
    ).mappings().all()
    if not rows:
        return None
    series = _epoch_series(rows, start, end)
    lengths = {len(series[field]) for field in SERIES_FIELDS}
    if len(lengths) != 1:
        raise SleepFMExportError(422, "channel_length_mismatch", f"{night_id} 通道长度不一致")
    if not any(value is not None for value in series["hr"]):
        raise SleepFMExportError(422, "missing_required_channels", f"{night_id} 缺少心率通道")
    quality_score = _quality_score(series)
    if quality_score < 0.5:
        raise SleepFMExportError(422, "quality_reject", f"{night_id} 有效数据比例低于 0.50")

    device_mac = next((row.get("device_mac") for row in rows if row.get("device_mac")), None)
    device = _load_device(db, int(user["id"]), device_mac)
    labels = _labels(db, int(user["id"]), start, end) if include_labels else None
    return {
        "night_id": night_id,
        "timezone": "Asia/Shanghai",
        "sleep_window": {"start": _aware(start), "end": _aware(end)},
        "available_input_modes": ["ring_6d_layer_a"],
        "ring_layer_a": {
            "device_id": _hash_identifier(str((device or {}).get("id") or device_mac or "unknown"), user_hash),
            "user_id": user_hash,
            "night_start": _aware(start),
            "data_level": "validated" if quality_score >= 0.9 else "processed",
            "epoch_minutes": EPOCH_MINUTES,
            "firmware": (device or {}).get("firmware_version"),
            "quality_score": quality_score,
            "wearing_status": "on_finger" if quality_score >= 0.7 else "uncertain",
            "series": series,
        },
        "psg_modalities": None,
        "edf_reference": None,
        "labels": labels,
    }


def _sleep_window(db: Session, user_id: int, night_date: date, summary) -> tuple[datetime | None, datetime | None]:
    if summary and summary.get("sleep_start_time") and summary.get("sleep_end_time"):
        return summary["sleep_start_time"], summary["sleep_end_time"]
    row = db.execute(
        text(
            """
            select min(record_time) as start_time, max(record_time) as end_time
            from health_raw
            where user_id=:user_id and record_time>=:start and record_time<:end
              and sleep_state is not null
            """
        ),
        {
            "user_id": user_id,
            "start": datetime.combine(night_date, time(18, 0)),
            "end": datetime.combine(night_date + timedelta(days=1), time(12, 0)),
        },
    ).mappings().first()
    return (row.get("start_time"), row.get("end_time")) if row else (None, None)


def _epoch_series(rows, start: datetime, end: datetime) -> dict[str, list[float | None]]:
    epoch_seconds = EPOCH_MINUTES * 60
    count = max(1, int(((end - start).total_seconds() + epoch_seconds - 1) // epoch_seconds))
    buckets: dict[int, list] = defaultdict(list)
    for row in rows:
        index = int((row["record_time"] - start).total_seconds() // epoch_seconds)
        if 0 <= index < count:
            buckets[index].append(row)
    result = {field: [] for field in SERIES_FIELDS}
    mapping = {
        "hr": "heart_rate",
        "hrv": "hrv",
        "skin_temp": "temperature",
        "spo2": "spo2",
        "actigraphy": "motion_intensity",
    }
    for index in range(count):
        bucket = buckets.get(index, [])
        for target, source in mapping.items():
            values = [
                value
                for row in bucket
                if (value := _valid_sensor_value(target, row.get(source))) is not None
            ]
            result[target].append(round(sum(values) / len(values), 3) if values else None)
        result["rr"].append(None)  # rr_intervals is cardiac R-R, not respiratory rate.
    return result


def _valid_sensor_value(field: str, raw_value: Any) -> float | None:
    if raw_value is None:
        return None
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return None
    ranges = {
        "hr": (30.0, 220.0),
        "hrv": (1.0, 500.0),
        "skin_temp": (20.0, 45.0),
        "spo2": (70.0, 100.0),
        "actigraphy": (0.0, float("inf")),
    }
    low, high = ranges[field]
    return value if low <= value <= high else None


def _quality_score(series: dict[str, list[float | None]]) -> float:
    supported = [field for field in SERIES_FIELDS if any(value is not None for value in series[field])]
    if not supported:
        return 0.0
    total = len(series[supported[0]]) * len(supported)
    valid = sum(value is not None for field in supported for value in series[field])
    return round(valid / total, 4) if total else 0.0


def _load_device(db: Session, user_id: int, mac: str | None) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            select id, firmware_version from device
            where user_id=:user_id and (:mac is null or mac=:mac)
            order by update_time desc limit 1
            """
        ),
        {"user_id": user_id, "mac": mac},
    ).mappings().first()
    return dict(row) if row else None


def _labels(db: Session, user_id: int, start: datetime, end: datetime) -> dict[str, Any]:
    rows = db.execute(
        text(
            """
            select type, sleep_time from sleep_record
            where user_id=:user_id and start_time>=:start and start_time<:end
            order by start_time
            """
        ),
        {"user_id": user_id, "start": start, "end": end},
    ).mappings().all()
    stage_map = {1: "W", 2: "REM", 3: "N2", 4: "N3", 5: "W"}
    stages: list[str] = []
    for row in rows:
        stage = stage_map.get(row.get("type"), "UNKNOWN")
        stages.extend([stage] * max(1, int((row.get("sleep_time") or 0) * 2)))
    return {
        "sleep_stage_30s": stages or None,
        "ahi": None,
        "rdi": None,
        "odi3": None,
        "odi4": None,
        "diagnoses": [],
        "follow_up_outcomes": [],
    }


def _user_profile(user: dict[str, Any], user_hash: str) -> dict[str, Any]:
    birthday = user.get("birthday")
    age = None
    if birthday:
        today = date.today()
        age = today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))
    sex = {0: "unknown", 1: "male", 2: "female"}.get(user.get("sex"), "unknown")
    height, weight = user.get("height"), user.get("weight")
    bmi = round(float(weight) / ((float(height) / 100) ** 2), 1) if height and weight else None
    return {"user_id_hash": user_hash, "age": age, "sex": sex, "bmi": bmi}


def _hash_identifier(value: str, secret: str) -> str:
    digest = hashlib.sha256(f"{secret}:{value}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=APP_TIMEZONE) if value.tzinfo is None else value.astimezone(APP_TIMEZONE)
