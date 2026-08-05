from __future__ import annotations

import hashlib
import json
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
    ensure_ring_history_raw_frame_schema(db)
    ensure_ring_history_raw_upload_job_schema(db)


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
L19_SLEEP_WINDOW_START_HOUR = 21
L19_SLEEP_WINDOW_END_HOUR = 11
L19_SLEEP_DEFAULT_SAMPLE_MINUTES = 5
L19_SLEEP_MAX_POINT_GAP_MINUTES = 90
SLEEP_ACTIVE_STAGE_KEYS = {"REM", "LIGHT", "DEEP", "NAP"}
L19_RAW_RECORD_MIN_DATE = date(2020, 1, 1)
RING_HISTORY_RAW_FRAME_TABLE = "ring_history_raw_frame"
RING_HISTORY_RAW_UPLOAD_JOB_TABLE = "ring_history_raw_upload_job"


def max_visible_record_time() -> datetime:
    return datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None) + HEALTH_RECORD_FUTURE_TOLERANCE


def ensure_ring_history_raw_frame_schema(db: Session) -> None:
    """Persist device raw history frames before parsed records are cleaned or repaired."""
    db.execute(
        text(
            """
            create table if not exists ring_history_raw_frame (
              id bigint primary key auto_increment,
              user_id bigint not null,
              upload_user_id bigint null,
              device_mac varchar(64) not null,
              device_key varchar(128) null,
              protocol varchar(32) null,
              source_type varchar(64) null,
              status varchar(32) null,
              raw_hash varchar(80) not null,
              raw_hex longtext not null,
              raw_byte_length int null,
              chunk_index int null,
              chunk_count int null,
              record_count int null,
              total_num int null,
              max_seq int null,
              record_time_start datetime null,
              record_time_end datetime null,
              received_at datetime null,
              first_seen_at datetime not null,
              last_seen_at datetime not null,
              seen_count int not null default 1,
              parse_status varchar(32) not null default 'pending',
              parse_message varchar(255) null,
              parsed_record_count int not null default 0,
              create_time datetime null,
              update_time datetime null,
              unique key uk_raw_user_device_hash (user_id, device_mac, raw_hash),
              key idx_raw_upload_user (upload_user_id),
              key idx_raw_user_device_time (user_id, device_mac, record_time_start, record_time_end),
              key idx_raw_parse_status (parse_status)
            ) engine=InnoDB default charset=utf8mb4
            """
        )
    )
    db.commit()
    bind = db.get_bind()
    inspector = inspect(bind)
    existing = {column["name"] for column in inspector.get_columns(RING_HISTORY_RAW_FRAME_TABLE)}
    for column_name, column_ddl in {
        "upload_user_id": "bigint null after user_id",
    }.items():
        if column_name in existing:
            continue
        try:
            db.execute(text(f"alter table {RING_HISTORY_RAW_FRAME_TABLE} add column {column_name} {column_ddl}"))
            db.commit()
            existing.add(column_name)
        except Exception:
            db.rollback()
            refreshed = {column["name"] for column in inspect(bind).get_columns(RING_HISTORY_RAW_FRAME_TABLE)}
            if column_name not in refreshed:
                raise
            existing = refreshed


def ensure_ring_history_raw_upload_job_schema(db: Session) -> None:
    """Queue raw history payloads so request handlers can return before per-frame writes."""
    db.execute(
        text(
            """
            create table if not exists ring_history_raw_upload_job (
              id bigint primary key auto_increment,
              upload_session_id varchar(96) not null,
              user_id bigint not null,
              upload_user_id bigint null,
              binding_id bigint null,
              binding_version varchar(96) null,
              device_mac varchar(64) not null,
              device_mac_norm varchar(64) not null,
              protocol varchar(32) null,
              payload_hash varchar(80) not null,
              payload_json longtext not null,
              raw_frame_count int not null default 0,
              status varchar(32) not null default 'queued',
              retry_count int not null default 0,
              error_msg varchar(512) null,
              stored_count int null,
              updated_count int null,
              skipped_count int null,
              create_time datetime null,
              update_time datetime null,
              started_at datetime null,
              finished_at datetime null,
              unique key uk_raw_upload_job_session (upload_session_id),
              unique key uk_raw_upload_job_payload (user_id, device_mac_norm, payload_hash),
              key idx_raw_upload_job_status (status, update_time),
              key idx_raw_upload_job_device (user_id, device_mac_norm, update_time)
            ) engine=InnoDB default charset=utf8mb4
            """
        )
    )
    db.commit()


def raw_history_repair_date(value: Any = None) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value not in (None, ""):
        text_value = str(value).strip()
        if text_value:
            try:
                return datetime.strptime(text_value[:10], "%Y-%m-%d").date()
            except ValueError:
                parsed = coerce_datetime(text_value)
                if parsed is not None:
                    return parsed.date()
    return datetime.now(HEALTH_TIMEZONE).date()


def l19_sleep_window_for_date(record_date: Any) -> tuple[datetime, datetime]:
    target_date = raw_history_repair_date(record_date)
    start_time = datetime.combine(target_date - timedelta(days=1), datetime.min.time()) + timedelta(hours=L19_SLEEP_WINDOW_START_HOUR)
    end_time = datetime.combine(target_date, datetime.min.time()) + timedelta(hours=L19_SLEEP_WINDOW_END_HOUR)
    return start_time, end_time


def l19_day_window_for_date(record_date: Any) -> tuple[datetime, datetime]:
    target_date = raw_history_repair_date(record_date)
    start_time = datetime.combine(target_date, datetime.min.time())
    return start_time, start_time + timedelta(days=1)


def l19_raw_repair_query_window_for_date(record_date: Any) -> tuple[datetime, datetime]:
    sleep_start, sleep_end = l19_sleep_window_for_date(record_date)
    day_start, day_end = l19_day_window_for_date(record_date)
    return min(sleep_start, day_start), max(sleep_end, day_end)


def is_time_in_l19_sleep_window(value: Any, record_date: Any) -> bool:
    record_time = coerce_datetime(value)
    if record_time is None:
        return False
    start_time, end_time = l19_sleep_window_for_date(record_date)
    return start_time <= record_time <= end_time


def is_time_in_l19_repair_scope(value: Any, record_date: Any) -> bool:
    record_time = coerce_datetime(value)
    if record_time is None:
        return False
    sleep_start, sleep_end = l19_sleep_window_for_date(record_date)
    day_start, day_end = l19_day_window_for_date(record_date)
    return (sleep_start <= record_time <= sleep_end) or (day_start <= record_time < day_end)


def normalize_ring_history_device_mac(value: Any) -> str:
    return str(value or "").strip().upper()


def normalize_ring_history_device_mac_key(value: Any) -> str:
    return "".join(char for char in normalize_ring_history_device_mac(value) if char in "0123456789ABCDEF").lower()


def normalize_ring_history_raw_hex(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex().upper()
    if isinstance(value, (list, tuple)):
        bytes_value = [
            int(item) & 0xFF
            for item in value
            if isinstance(item, (int, float)) and 0 <= int(item) <= 255
        ]
        return bytes(bytes_value).hex().upper()
    text_value = str(value or "").strip()
    if not text_value:
        return ""
    cleaned = "".join(char for char in text_value if char in "0123456789abcdefABCDEF")
    if len(cleaned) % 2 == 1:
        cleaned = cleaned[:-1]
    return cleaned.upper()


def _raw_frame_int(frame: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = frame.get(key)
        if value in (None, ""):
            continue
        try:
            number = int(float(value))
        except (TypeError, ValueError):
            continue
        return number
    return None


def _raw_frame_str(frame: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = frame.get(key)
        if value in (None, ""):
            continue
        text_value = str(value).strip()
        if text_value:
            return text_value
    return None


def _raw_frame_datetime(frame: dict[str, Any], *keys: str) -> datetime | None:
    for key in keys:
        value = frame.get(key)
        if value in (None, ""):
            continue
        if isinstance(value, (int, float)):
            timestamp = float(value)
            if timestamp > 1_000_000_000_000:
                timestamp = timestamp / 1000.0
            try:
                return datetime.fromtimestamp(timestamp, HEALTH_TIMEZONE).replace(tzinfo=None)
            except (OverflowError, OSError, ValueError):
                continue
        parsed = coerce_datetime(value)
        if parsed is not None:
            return parsed
    return None


def ring_history_frame_hash(user_id: int, device_mac: str, protocol: str | None, source_type: str | None, raw_hex: str) -> str:
    source = f"{user_id}:{normalize_ring_history_device_mac(device_mac)}:{protocol or ''}:{source_type or ''}:{raw_hex}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def store_ring_history_raw_frames(
    db: Session,
    user_id: int,
    device_mac: str,
    frames: list[Any],
    upload_user_id: int | None = None,
) -> dict[str, Any]:
    ensure_ring_history_raw_frame_schema(db)
    normalized_device_mac = normalize_ring_history_device_mac(device_mac)
    if not normalized_device_mac:
        return {"rawStored": False, "storedCount": 0, "updatedCount": 0, "skippedCount": len(frames or []), "rawFrameCount": 0}
    now = datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None)
    stored_count = 0
    updated_count = 0
    skipped_count = 0
    raw_hashes: list[str] = []
    for raw_frame in frames or []:
        frame = raw_frame if isinstance(raw_frame, dict) else {}
        raw_hex = normalize_ring_history_raw_hex(frame.get("rawHex") or frame.get("raw_hex") or frame.get("raw"))
        if not raw_hex:
            skipped_count += 1
            continue
        protocol = _raw_frame_str(frame, "protocol")
        source_type = _raw_frame_str(frame, "sourceType", "source_type", "type")
        raw_hash = ring_history_frame_hash(user_id, normalized_device_mac, protocol, source_type, raw_hex)
        raw_hashes.append(raw_hash)
        received_at = _raw_frame_datetime(frame, "receivedAt", "received_at") or now
        values = {
            "user_id": user_id,
            "upload_user_id": upload_user_id,
            "device_mac": normalized_device_mac,
            "device_key": _raw_frame_str(frame, "deviceKey", "device_key"),
            "protocol": protocol,
            "source_type": source_type,
            "status": _raw_frame_str(frame, "status"),
            "raw_hash": raw_hash,
            "raw_hex": raw_hex,
            "raw_byte_length": _raw_frame_int(frame, "rawByteLength", "raw_byte_length") or len(raw_hex) // 2,
            "chunk_index": _raw_frame_int(frame, "chunkIndex", "chunk_index"),
            "chunk_count": _raw_frame_int(frame, "chunkCount", "chunk_count"),
            "record_count": _raw_frame_int(frame, "recordCount", "record_count"),
            "total_num": _raw_frame_int(frame, "totalNum", "total_num"),
            "max_seq": _raw_frame_int(frame, "maxSeq", "max_seq"),
            "record_time_start": _raw_frame_datetime(frame, "recordTimeStart", "record_time_start"),
            "record_time_end": _raw_frame_datetime(frame, "recordTimeEnd", "record_time_end"),
            "received_at": received_at,
            "first_seen_at": received_at,
            "last_seen_at": now,
            "seen_count": 1,
            "parse_status": "pending",
            "parsed_record_count": 0,
            "create_time": now,
            "update_time": now,
        }
        existing = db.execute(
            text(
                """
                select id, seen_count
                from ring_history_raw_frame
                where user_id=:user_id and device_mac=:device_mac and raw_hash=:raw_hash
                limit 1
                """
            ),
            {"user_id": user_id, "device_mac": normalized_device_mac, "raw_hash": raw_hash},
        ).mappings().first()
        if existing:
            db.execute(
                text(
                    """
                    update ring_history_raw_frame
                    set upload_user_id=coalesce(:upload_user_id, upload_user_id),
                        device_key=:device_key,
                        protocol=:protocol,
                        source_type=:source_type,
                        status=:status,
                        raw_hex=:raw_hex,
                        raw_byte_length=:raw_byte_length,
                        chunk_index=:chunk_index,
                        chunk_count=:chunk_count,
                        record_count=:record_count,
                        total_num=:total_num,
                        max_seq=:max_seq,
                        record_time_start=coalesce(:record_time_start, record_time_start),
                        record_time_end=coalesce(:record_time_end, record_time_end),
                        received_at=coalesce(:received_at, received_at),
                        last_seen_at=:last_seen_at,
                        seen_count=coalesce(seen_count, 0) + 1,
                        update_time=:update_time
                    where id=:id
                    """
                ),
                {**values, "id": existing["id"]},
            )
            updated_count += 1
        else:
            db.execute(
                text(
                    """
                    insert into ring_history_raw_frame (
                      user_id, upload_user_id, device_mac, device_key, protocol, source_type, status,
                      raw_hash, raw_hex, raw_byte_length, chunk_index, chunk_count,
                      record_count, total_num, max_seq, record_time_start, record_time_end,
                      received_at, first_seen_at, last_seen_at, seen_count, parse_status,
                      parsed_record_count, create_time, update_time
                    ) values (
                      :user_id, :upload_user_id, :device_mac, :device_key, :protocol, :source_type, :status,
                      :raw_hash, :raw_hex, :raw_byte_length, :chunk_index, :chunk_count,
                      :record_count, :total_num, :max_seq, :record_time_start, :record_time_end,
                      :received_at, :first_seen_at, :last_seen_at, :seen_count, :parse_status,
                      :parsed_record_count, :create_time, :update_time
                    )
                    """
                ),
                values,
            )
            stored_count += 1
    db.commit()
    return {
        "rawStored": stored_count + updated_count > 0,
        "storedCount": stored_count,
        "updatedCount": updated_count,
        "skippedCount": skipped_count,
        "rawFrameCount": stored_count + updated_count,
        "rawHashes": raw_hashes,
    }


def enqueue_ring_history_raw_upload_job(
    db: Session,
    user_id: int,
    device_mac: str,
    frames: list[Any],
    upload_session_id: str,
    upload_user_id: int | None = None,
    binding_id: int | str | None = None,
    binding_version: str | None = None,
    protocol: str | None = None,
) -> dict[str, Any]:
    ensure_ring_history_raw_upload_job_schema(db)
    normalized_device_mac = normalize_ring_history_device_mac(device_mac)
    device_mac_norm = normalize_ring_history_device_mac_key(normalized_device_mac)
    frame_list = [frame for frame in (frames or []) if isinstance(frame, dict)]
    if not upload_session_id:
        upload_session_id = hashlib.sha256(
            f"{user_id}:{device_mac_norm}:{datetime.now(HEALTH_TIMEZONE).timestamp()}".encode("utf-8")
        ).hexdigest()[:32]
    payload_json = json.dumps({"frames": frame_list}, ensure_ascii=False, default=str, separators=(",", ":"))
    payload_hash = hashlib.sha256(f"{user_id}:{device_mac_norm}:{payload_json}".encode("utf-8")).hexdigest()
    now = datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None)
    payload = {
        "upload_session_id": upload_session_id,
        "user_id": user_id,
        "upload_user_id": upload_user_id,
        "binding_id": binding_id,
        "binding_version": binding_version,
        "device_mac": normalized_device_mac,
        "device_mac_norm": device_mac_norm,
        "protocol": protocol,
        "payload_hash": payload_hash,
        "payload_json": payload_json,
        "raw_frame_count": len(frame_list),
        "status": "queued",
        "retry_count": 0,
        "error_msg": None,
        "create_time": now,
        "update_time": now,
    }
    db.execute(
        text(
            """
            insert into ring_history_raw_upload_job (
              upload_session_id, user_id, upload_user_id, binding_id, binding_version,
              device_mac, device_mac_norm, protocol, payload_hash, payload_json,
              raw_frame_count, status, retry_count, error_msg, create_time, update_time
            ) values (
              :upload_session_id, :user_id, :upload_user_id, :binding_id, :binding_version,
              :device_mac, :device_mac_norm, :protocol, :payload_hash, :payload_json,
              :raw_frame_count, :status, :retry_count, :error_msg, :create_time, :update_time
            )
            on duplicate key update
              upload_session_id=values(upload_session_id),
              upload_user_id=coalesce(values(upload_user_id), upload_user_id),
              binding_id=coalesce(values(binding_id), binding_id),
              binding_version=coalesce(values(binding_version), binding_version),
              protocol=coalesce(values(protocol), protocol),
              payload_json=values(payload_json),
              raw_frame_count=values(raw_frame_count),
              status=case when status='success' then status else values(status) end,
              retry_count=case when status='success' then retry_count else 0 end,
              error_msg=null,
              update_time=values(update_time)
            """
        ),
        payload,
    )
    db.commit()
    row = db.execute(
        text(
            """
            select id, status, retry_count
            from ring_history_raw_upload_job
            where upload_session_id=:upload_session_id
               or (user_id=:user_id and device_mac_norm=:device_mac_norm and payload_hash=:payload_hash)
            order by id desc
            limit 1
            """
        ),
        {
            "upload_session_id": upload_session_id,
            "user_id": user_id,
            "device_mac_norm": device_mac_norm,
            "payload_hash": payload_hash,
        },
    ).mappings().first()
    return {
        "rawQueued": True,
        "rawStatus": row.get("status") if row else "queued",
        "uploadSessionId": upload_session_id,
        "jobId": row.get("id") if row else None,
        "dataUserId": user_id,
        "deviceMac": normalized_device_mac,
        "deviceMacNorm": device_mac_norm,
        "protocol": protocol,
        "payloadHash": payload_hash,
        "rawFrameCount": len(frame_list),
        "retryCount": row.get("retry_count") if row else 0,
    }


def process_ring_history_raw_upload_jobs(db: Session, limit: int = 20, max_retry: int = 5) -> dict[str, Any]:
    ensure_ring_history_raw_upload_job_schema(db)
    safe_limit = max(1, min(int(limit or 20), 200))
    safe_max_retry = max(1, min(int(max_retry or 5), 20))
    rows = db.execute(
        text(
            f"""
            select *
            from ring_history_raw_upload_job
            where status in ('queued', 'failed')
              and retry_count < :max_retry
            order by update_time asc, id asc
            limit {safe_limit}
            """
        ),
        {"max_retry": safe_max_retry},
    ).mappings().all()
    processed = 0
    success_count = 0
    failed_count = 0
    results: list[dict[str, Any]] = []
    for row in rows:
        job_id = int(row["id"])
        now = datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None)
        db.execute(
            text(
                """
                update ring_history_raw_upload_job
                set status='running',
                    started_at=:started_at,
                    update_time=:update_time
                where id=:id
                  and status in ('queued', 'failed')
                """
            ),
            {"id": job_id, "started_at": now, "update_time": now},
        )
        db.commit()
        try:
            payload = json.loads(row.get("payload_json") or "{}")
            frames = payload.get("frames") if isinstance(payload, dict) else []
            if not isinstance(frames, list):
                frames = []
            store_result = store_ring_history_raw_frames(
                db,
                int(row["user_id"]),
                row.get("device_mac") or "",
                frames,
                upload_user_id=row.get("upload_user_id"),
            )
            finished_at = datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None)
            db.execute(
                text(
                    """
                    update ring_history_raw_upload_job
                    set status='success',
                        error_msg=null,
                        stored_count=:stored_count,
                        updated_count=:updated_count,
                        skipped_count=:skipped_count,
                        finished_at=:finished_at,
                        update_time=:update_time
                    where id=:id
                    """
                ),
                {
                    "id": job_id,
                    "stored_count": store_result.get("storedCount", 0),
                    "updated_count": store_result.get("updatedCount", 0),
                    "skipped_count": store_result.get("skippedCount", 0),
                    "finished_at": finished_at,
                    "update_time": finished_at,
                },
            )
            db.commit()
            processed += 1
            success_count += 1
            results.append({"id": job_id, "status": "success", **store_result})
        except Exception as exc:
            db.rollback()
            failed_at = datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None)
            next_retry_count = int(row.get("retry_count") or 0) + 1
            db.execute(
                text(
                    """
                    update ring_history_raw_upload_job
                    set status='failed',
                        retry_count=:retry_count,
                        error_msg=:error_msg,
                        finished_at=:finished_at,
                        update_time=:update_time
                    where id=:id
                    """
                ),
                {
                    "id": job_id,
                    "retry_count": next_retry_count,
                    "error_msg": str(exc)[:512],
                    "finished_at": failed_at,
                    "update_time": failed_at,
                },
            )
            db.commit()
            processed += 1
            failed_count += 1
            results.append({"id": job_id, "status": "failed", "error": str(exc)[:512]})
    return {
        "processed": processed,
        "success": success_count,
        "failed": failed_count,
        "limit": safe_limit,
        "maxRetry": safe_max_retry,
        "results": results,
    }


def list_ring_history_raw_frames(db: Session, user_id: int, device_mac: str, record_date: Any) -> list[dict[str, Any]]:
    ensure_ring_history_raw_frame_schema(db)
    normalized_device_mac = normalize_ring_history_device_mac(device_mac)
    query_start, query_end = l19_raw_repair_query_window_for_date(record_date)
    fallback_date = raw_history_repair_date(record_date).isoformat()
    rows = db.execute(
        text(
            """
            select *
            from ring_history_raw_frame
            where user_id=:user_id
              and device_mac=:device_mac
              and (
                (record_time_start is not null and record_time_start <= :query_end and coalesce(record_time_end, record_time_start) >= :query_start)
                or (record_time_start is null and date(first_seen_at)=:fallback_date)
              )
            order by coalesce(record_time_start, first_seen_at), id
            """
        ),
        {
            "user_id": user_id,
            "device_mac": normalized_device_mac,
            "query_start": query_start,
            "query_end": query_end,
            "fallback_date": fallback_date,
        },
    ).mappings().all()
    return [dict(row) for row in rows]


def _bytes_from_hex(raw_hex: str) -> bytes:
    try:
        return bytes.fromhex(normalize_ring_history_raw_hex(raw_hex))
    except ValueError:
        return b""


def _read_uint16_le(data: bytes, offset: int) -> int:
    return data[offset] | (data[offset + 1] << 8)


def _read_int16_le(data: bytes, offset: int) -> int:
    value = _read_uint16_le(data, offset)
    return value - 0x10000 if value & 0x8000 else value


def _read_uint32_le(data: bytes, offset: int) -> int:
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)


def _visible_l19_record_time(unix_time: int) -> datetime | None:
    if unix_time <= 0:
        return None
    try:
        record_time = datetime.fromtimestamp(unix_time, HEALTH_TIMEZONE).replace(tzinfo=None)
    except (OverflowError, OSError, ValueError):
        return None
    if record_time.date() < L19_RAW_RECORD_MIN_DATE or record_time > max_visible_record_time():
        return None
    return record_time


def parse_l19_raw_history_frame(frame: dict[str, Any]) -> list[dict[str, Any]]:
    data = _bytes_from_hex(frame.get("raw_hex") or frame.get("rawHex") or "")
    if len(data) < 8:
        return []
    total_num = _read_uint32_le(data, 4)
    if total_num in (0, 0xFFFFFFFF):
        return []
    records: list[dict[str, Any]] = []
    offset = 8
    while offset + 21 <= len(data):
        seq = _read_uint32_le(data, offset)
        unix_time = _read_uint32_le(data, offset + 4)
        record_time = _visible_l19_record_time(unix_time)
        step_count = _read_uint16_le(data, offset + 8)
        heart_rate = data[offset + 10]
        spo2 = data[offset + 11]
        hrv = data[offset + 12]
        stress = data[offset + 13]
        temperature = round(_read_int16_le(data, offset + 14) / 100.0, 2)
        activity_level = data[offset + 16]
        sleep_type = data[offset + 17]
        perfusion = data[offset + 18]
        rr_count = data[offset + 20]
        rr_start = offset + 21
        rr_intervals: list[int] = []
        for index in range(rr_count):
            rr_offset = rr_start + index * 2
            if rr_offset + 1 >= len(data):
                break
            rr_intervals.append(_read_uint16_le(data, rr_offset))
        if record_time is not None:
            item: dict[str, Any] = {
                "recordTime": record_time.strftime("%Y-%m-%d %H:%M:%S"),
                "unixTime": unix_time,
                "seq": seq,
                "protocol": frame.get("protocol") or "legacy",
                "sourceType": "l19_raw_frame_repair",
                "rawDataType": "l19_local_data",
                "sleepType": sleep_type,
                "sleepState": sleep_type,
            }
            if step_count > 0:
                item["stepCount"] = step_count
            if 30 <= heart_rate <= 220:
                item["heartRate"] = heart_rate
            if 70 <= spo2 <= 100:
                item["spo2"] = spo2
            if 1 <= hrv <= 300:
                item["hrv"] = hrv
            if 0 <= stress <= 100:
                item["stress"] = stress
            if 25.0 <= temperature <= 45.0:
                item["temperature"] = temperature
            if 0 <= activity_level <= 4:
                item["motionIntensity"] = activity_level
            if perfusion > 0:
                item["perfusionIndex"] = perfusion
            if rr_intervals:
                item["rrIntervals"] = json.dumps(rr_intervals, ensure_ascii=False)
            records.append(item)
        offset += 21 + rr_count * 2
    return records


def _record_time_from_submit_item(item: dict[str, Any]) -> datetime | None:
    return coerce_datetime(item.get("recordTime") or item.get("record_time") or item.get("time") or item.get("timestamp"))


def clip_l19_sleep_segment_records_to_active_sleep(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    active_ranges: list[tuple[datetime, datetime]] = []
    for item in segments:
        stage_key = sleep_type_key(item.get("sleepState") if item.get("sleepState") is not None else item.get("sleepType"))
        start_time = coerce_datetime(item.get("startTime"))
        end_time = coerce_datetime(item.get("endTime"))
        if stage_key in SLEEP_ACTIVE_STAGE_KEYS and start_time is not None and end_time is not None and end_time > start_time:
            active_ranges.append((start_time, end_time))
    if not active_ranges:
        return []

    sleep_start = min(item[0] for item in active_ranges)
    sleep_end = max(item[1] for item in active_ranges)
    clipped_segments: list[dict[str, Any]] = []
    for item in segments:
        start_time = coerce_datetime(item.get("startTime"))
        end_time = coerce_datetime(item.get("endTime"))
        if start_time is None or end_time is None:
            continue
        clipped_start = max(start_time, sleep_start)
        clipped_end = min(end_time, sleep_end)
        duration = max(0, round((clipped_end - clipped_start).total_seconds() / 60))
        if duration <= 0:
            continue
        clipped_segments.append({
            **item,
            "recordTime": clipped_start.strftime("%Y-%m-%d %H:%M:%S"),
            "startTime": clipped_start.strftime("%Y-%m-%d %H:%M:%S"),
            "endTime": clipped_end.strftime("%Y-%m-%d %H:%M:%S"),
            "sleepDuration": duration,
        })
    return clipped_segments


def build_l19_sleep_segment_records(records: list[dict[str, Any]], record_date: Any) -> list[dict[str, Any]]:
    start_window, end_window = l19_sleep_window_for_date(record_date)
    keyed_points: dict[datetime, int] = {}
    for item in records:
        record_time = _record_time_from_submit_item(item)
        if record_time is None or record_time < start_window or record_time > end_window:
            continue
        try:
            sleep_state = int(item.get("sleepState") if item.get("sleepState") is not None else item.get("sleepType"))
        except (TypeError, ValueError):
            continue
        if sleep_state not in {1, 2, 3, 4, 5}:
            continue
        keyed_points[record_time] = sleep_state
    points = sorted(keyed_points.items(), key=lambda pair: pair[0])
    if not points:
        return []

    segments: list[dict[str, Any]] = []
    current_state = points[0][1]
    segment_start = points[0][0]
    segment_end = segment_start
    for index, (record_time, state) in enumerate(points):
        next_time = points[index + 1][0] if index + 1 < len(points) else None
        minutes = L19_SLEEP_DEFAULT_SAMPLE_MINUTES
        if next_time is not None:
            gap_minutes = int((next_time - record_time).total_seconds() // 60)
            if 0 < gap_minutes <= L19_SLEEP_MAX_POINT_GAP_MINUTES:
                minutes = max(1, gap_minutes)
        point_end = min(record_time + timedelta(minutes=minutes), end_window)
        if index == 0:
            segment_end = point_end
            continue
        if state == current_state and record_time <= segment_end + timedelta(minutes=1):
            if point_end > segment_end:
                segment_end = point_end
            continue
        duration = max(0, round((segment_end - segment_start).total_seconds() / 60))
        if duration > 0:
            segments.append({
                "recordTime": segment_start.strftime("%Y-%m-%d %H:%M:%S"),
                "startTime": segment_start.strftime("%Y-%m-%d %H:%M:%S"),
                "endTime": segment_end.strftime("%Y-%m-%d %H:%M:%S"),
                "dateRef": raw_history_repair_date(record_date).isoformat(),
                "sleepType": current_state,
                "sleepState": current_state,
                "sleepDuration": duration,
                "sourceType": "l19_sleep_segment_repair",
                "rawDataType": "sleep_segment",
            })
        current_state = state
        segment_start = record_time
        segment_end = point_end

    duration = max(0, round((segment_end - segment_start).total_seconds() / 60))
    if duration > 0:
        segments.append({
            "recordTime": segment_start.strftime("%Y-%m-%d %H:%M:%S"),
            "startTime": segment_start.strftime("%Y-%m-%d %H:%M:%S"),
            "endTime": segment_end.strftime("%Y-%m-%d %H:%M:%S"),
            "dateRef": raw_history_repair_date(record_date).isoformat(),
            "sleepType": current_state,
            "sleepState": current_state,
            "sleepDuration": duration,
            "sourceType": "l19_sleep_segment_repair",
            "rawDataType": "sleep_segment",
        })
    return clip_l19_sleep_segment_records_to_active_sleep(segments)


def prepare_l19_raw_history_repair_records(db: Session, user_id: int, device_mac: str, record_date: Any) -> dict[str, Any]:
    target_date = raw_history_repair_date(record_date)
    frames = list_ring_history_raw_frames(db, user_id, device_mac, target_date)
    parsed_records: list[dict[str, Any]] = []
    raw_hashes: list[str] = []
    for frame in frames:
        raw_hash = str(frame.get("raw_hash") or "")
        if raw_hash:
            raw_hashes.append(raw_hash)
        parsed_records.extend(parse_l19_raw_history_frame(frame))

    keyed_records: dict[tuple[str, Any], dict[str, Any]] = {}
    for item in parsed_records:
        record_time = _record_time_from_submit_item(item)
        if record_time is None or not is_time_in_l19_repair_scope(record_time, target_date):
            continue
        key = (record_time.strftime("%Y-%m-%d %H:%M:%S"), item.get("seq"))
        keyed_records[key] = item
    direct_records = sorted(keyed_records.values(), key=lambda item: str(item.get("recordTime") or ""))
    sleep_segment_records = build_l19_sleep_segment_records(direct_records, target_date)
    sleep_start, sleep_end = l19_sleep_window_for_date(target_date)
    day_start, day_end = l19_day_window_for_date(target_date)
    return {
        "recordDate": target_date.isoformat(),
        "frames": frames,
        "rawHashes": raw_hashes,
        "parsedPointRecords": direct_records,
        "sleepSegmentRecords": sleep_segment_records,
        "records": direct_records + sleep_segment_records,
        "frameCount": len(frames),
        "parsedPointCount": len(direct_records),
        "sleepSegmentCount": len(sleep_segment_records),
        "sleepWindowStart": sleep_start,
        "sleepWindowEnd": sleep_end,
        "dayWindowStart": day_start,
        "dayWindowEnd": day_end,
    }


def clear_l19_raw_history_repair_window(db: Session, user_id: int, device_mac: str, record_date: Any) -> dict[str, int]:
    target_date = raw_history_repair_date(record_date)
    normalized_device_mac = normalize_ring_history_device_mac(device_mac)
    sleep_start, sleep_end = l19_sleep_window_for_date(target_date)
    day_start, day_end = l19_day_window_for_date(target_date)
    health_result = db.execute(
        text(
            """
            delete from health_raw
            where user_id=:user_id
              and device_mac=:device_mac
              and (
                (record_time >= :day_start and record_time < :day_end)
                or (record_time >= :sleep_start and record_time <= :sleep_end)
              )
            """
        ),
        {
            "user_id": user_id,
            "device_mac": normalized_device_mac,
            "day_start": day_start,
            "day_end": day_end,
            "sleep_start": sleep_start,
            "sleep_end": sleep_end,
        },
    )
    sleep_result = db.execute(
        text(
            """
            delete from sleep_record
            where user_id=:user_id and date_ref=:record_date
            """
        ),
        {"user_id": user_id, "record_date": target_date.isoformat()},
    )
    db.commit()
    return {
        "healthRawDeleted": int(health_result.rowcount or 0),
        "sleepRecordDeleted": int(sleep_result.rowcount or 0),
    }


def mark_l19_raw_history_repair_result(
    db: Session,
    user_id: int,
    device_mac: str,
    raw_hashes: list[str],
    success: bool,
    parsed_count: int,
    message: str | None = None,
) -> None:
    unique_hashes = [item for item in dict.fromkeys(raw_hashes) if item]
    if not unique_hashes:
        return
    placeholders = []
    params: dict[str, Any] = {
        "user_id": user_id,
        "device_mac": normalize_ring_history_device_mac(device_mac),
        "parse_status": "parsed" if success else "failed",
        "parse_message": (message or "")[:255],
        "parsed_record_count": parsed_count,
        "update_time": datetime.now(HEALTH_TIMEZONE).replace(tzinfo=None),
    }
    for index, raw_hash in enumerate(unique_hashes):
        key = f"hash_{index}"
        placeholders.append(f":{key}")
        params[key] = raw_hash
    db.execute(
        text(
            f"""
            update ring_history_raw_frame
            set parse_status=:parse_status,
                parse_message=:parse_message,
                parsed_record_count=:parsed_record_count,
                update_time=:update_time
            where user_id=:user_id and device_mac=:device_mac and raw_hash in ({', '.join(placeholders)})
            """
        ),
        params,
    )
    db.commit()


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


def raw_sleep_state_intervals_from_rows(rows: list[dict[str, Any]] | Any) -> list[dict[str, Any]]:
    """Convert raw L19 sleep state points to clipped intervals.

    Raw rows are queried with the broad 21:00-11:00 sleep window. The device can
    report clear-awake points before the user actually falls asleep and after
    wake-up. Those points are useful raw data, but must not be counted in the
    sleep detail statistics. We keep awake only between the first and last
    active sleep state.
    """
    keyed_rows: dict[datetime, dict[str, Any]] = {}
    for row in rows or []:
        item = dict(row)
        record_time = coerce_datetime(item.get("record_time"))
        if record_time is None:
            continue
        stage_key = sleep_type_key(item.get("sleep_state"))
        if stage_key == "INVALID":
            continue
        item["record_time"] = record_time
        item["sleep_stage_key"] = stage_key
        keyed_rows[record_time] = item

    ordered_rows = [keyed_rows[key] for key in sorted(keyed_rows.keys())]
    intervals: list[dict[str, Any]] = []
    for index, row in enumerate(ordered_rows):
        record_time = row.get("record_time")
        if not isinstance(record_time, datetime):
            continue
        minutes = L19_SLEEP_DEFAULT_SAMPLE_MINUTES
        if index + 1 < len(ordered_rows):
            next_time = ordered_rows[index + 1].get("record_time")
            if isinstance(next_time, datetime):
                seconds = int((next_time - record_time).total_seconds())
                if 0 < seconds <= L19_SLEEP_MAX_POINT_GAP_MINUTES * 60:
                    minutes = max(1, round(seconds / 60))
        end_time = record_time + timedelta(minutes=minutes)
        intervals.append({
            "start": record_time,
            "end": end_time,
            "stage_key": row.get("sleep_stage_key"),
            "minutes": minutes,
        })

    active_intervals = [item for item in intervals if item.get("stage_key") in SLEEP_ACTIVE_STAGE_KEYS]
    if not active_intervals:
        return []

    sleep_start = min(item["start"] for item in active_intervals)
    sleep_end = max(item["end"] for item in active_intervals)
    clipped: list[dict[str, Any]] = []
    for item in intervals:
        start_time = max(item["start"], sleep_start)
        end_time = min(item["end"], sleep_end)
        if end_time <= start_time:
            continue
        minutes = max(1, round((end_time - start_time).total_seconds() / 60))
        clipped.append({
            **item,
            "start": start_time,
            "end": end_time,
            "minutes": minutes,
        })
    return clipped


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
    sleep_window_start, sleep_window_end = l19_sleep_window_for_date(record_date)
    rows = db.execute(
        text(
            """
            select record_time, sleep_state
            from health_raw
            where user_id=:user_id
              and record_time >= :sleep_window_start
              and record_time <= :sleep_window_end
              and sleep_state is not null
              and record_time <= :max_record_time
            order by record_time
            """
        ),
        {
            "user_id": user_id,
            "sleep_window_start": sleep_window_start,
            "sleep_window_end": sleep_window_end,
            "max_record_time": max_visible_record_time(),
        },
    ).mappings().all()
    values = {"AWAKE": 0, "REM": 0, "LIGHT": 0, "DEEP": 0, "NAP": 0}
    awake_count = 0
    sleep_start = None
    sleep_end = None
    for item in raw_sleep_state_intervals_from_rows(rows):
        record_time = item.get("start")
        key = str(item.get("stage_key") or "")
        minutes = int(item.get("minutes") or 0)
        if not isinstance(record_time, datetime) or minutes <= 0:
            continue
        if key in values:
            values[key] += minutes
        if key == "AWAKE":
            awake_count += 1
        if key in SLEEP_ACTIVE_STAGE_KEYS:
            if sleep_start is None or record_time < sleep_start:
                sleep_start = record_time
            current_end = item.get("end")
            if isinstance(current_end, datetime) and (sleep_end is None or current_end > sleep_end):
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
    # Mini Program has used both frontend-facing field names and legacy DB/API names.
    # Normalize them here before clean_payload() so current and older app packages
    # write the same user_girl_health columns.
    if not payload.get("birthDay") and payload.get("birthday"):
        payload["birthDay"] = payload.get("birthday")
    if not payload.get("periodCycle") and payload.get("cycleDay") is not None:
        payload["periodCycle"] = payload.get("cycleDay")
    if not payload.get("periodRuntime") and payload.get("menstruationDay") is not None:
        payload["periodRuntime"] = payload.get("menstruationDay")
    if not payload.get("isRuleType") and payload.get("cycleRegularity") is not None:
        payload["isRuleType"] = payload.get("cycleRegularity")
    if not payload.get("otherUnhealth") and payload.get("healthConditions") is not None:
        payload["otherUnhealth"] = payload.get("healthConditions")
    last_menstruation_date = payload.get("lastMenstruationDate")
    if last_menstruation_date:
        payload.setdefault("lastPeriodTimePoint", last_menstruation_date)
        if not payload.get("lastPeriodTime"):
            payload["lastPeriodTime"] = [last_menstruation_date]
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
