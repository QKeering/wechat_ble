from __future__ import annotations

import csv
import io
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.crud import camelize_dict


SNAPSHOT_TABLE = "feedback_snapshot"


def json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, default=str)


def json_loads(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text_value = str(value).strip()
    if text_value.endswith("Z"):
        text_value = text_value[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text_value)
    except ValueError:
        return None


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def initialize_schema(db: Session) -> None:
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        db.execute(
            text(
                """
                create table if not exists feedback_snapshot (
                  id integer primary key autoincrement,
                  snapshot_id varchar(64) not null unique,
                  user_id varchar(64) not null,
                  endpoint varchar(255) not null,
                  algo_version varchar(64) null,
                  field_path varchar(255) not null,
                  displayed_as varchar(255) not null,
                  original_value text null,
                  corrected_value text null,
                  reason text null,
                  request_body text not null,
                  response_body text not null,
                  context text null,
                  device_id varchar(128) null,
                  firmware varchar(128) null,
                  app_version varchar(128) null,
                  env varchar(32) null,
                  tester varchar(128) null,
                  requested_at datetime null,
                  submitted_at datetime null,
                  review_status varchar(32) null,
                  diagnosis varchar(32) null,
                  review_remark text null,
                  reviewed_by varchar(128) null,
                  reviewed_at datetime null,
                  create_time datetime not null,
                  update_time datetime not null
                )
                """
            )
        )
        for name, column in {
            "idx_feedback_user_id": "user_id",
            "idx_feedback_endpoint": "endpoint",
            "idx_feedback_field_path": "field_path",
            "idx_feedback_env": "env",
            "idx_feedback_create_time": "create_time",
        }.items():
            db.execute(text(f"create index if not exists {name} on feedback_snapshot ({column})"))
    else:
        db.execute(
            text(
                """
                create table if not exists feedback_snapshot (
                  id bigint primary key auto_increment,
                  snapshot_id varchar(64) not null,
                  user_id varchar(64) not null,
                  endpoint varchar(255) not null,
                  algo_version varchar(64) null,
                  field_path varchar(255) not null,
                  displayed_as varchar(255) not null,
                  original_value longtext null,
                  corrected_value longtext null,
                  reason text null,
                  request_body longtext not null,
                  response_body longtext not null,
                  context longtext null,
                  device_id varchar(128) null,
                  firmware varchar(128) null,
                  app_version varchar(128) null,
                  env varchar(32) null,
                  tester varchar(128) null,
                  requested_at datetime null,
                  submitted_at datetime null,
                  review_status varchar(32) null,
                  diagnosis varchar(32) null,
                  review_remark text null,
                  reviewed_by varchar(128) null,
                  reviewed_at datetime null,
                  create_time datetime not null,
                  update_time datetime not null,
                  unique key uk_feedback_snapshot_id (snapshot_id),
                  key idx_feedback_user_id (user_id),
                  key idx_feedback_endpoint (endpoint),
                  key idx_feedback_field_path (field_path),
                  key idx_feedback_env (env),
                  key idx_feedback_create_time (create_time)
                ) engine=InnoDB default charset=utf8mb4
                """
            )
        )
    ensure_review_columns(db, dialect)
    db.commit()


def ensure_review_columns(db: Session, dialect: str) -> None:
    columns = {
        "review_status": "varchar(32) null",
        "diagnosis": "varchar(32) null",
        "review_remark": "text null",
        "reviewed_by": "varchar(128) null",
        "reviewed_at": "datetime null",
    }
    if dialect == "sqlite":
        existing = {row[1] for row in db.execute(text("pragma table_info(feedback_snapshot)")).all()}
        for name, ddl in columns.items():
            if name not in existing:
                db.execute(text(f"alter table feedback_snapshot add column {name} {ddl}"))
        return
    for name, ddl in columns.items():
        try:
            db.execute(text(f"alter table feedback_snapshot add column {name} {ddl}"))
        except SQLAlchemyError:
            db.rollback()


def normalize_snapshot(payload: dict[str, Any], header_user_id: str | None = None) -> dict[str, Any]:
    correction = payload.get("correction") or {}
    context = payload.get("context") or {}
    user_id = str(payload.get("userId") or header_user_id or "").strip()
    request_body = payload.get("requestBody")
    if isinstance(request_body, dict) and user_id:
        request_body = {**request_body, "user_id": user_id}
    snapshot_id = str(payload.get("snapshotId") or "").strip()
    endpoint = str(payload.get("endpoint") or "").strip()
    field_path = str(correction.get("fieldPath") or "").strip()
    displayed_as = str(correction.get("displayedAs") or "").strip()
    reason = str(correction.get("reason") or "").strip()
    missing = []
    for key, value in {
        "snapshotId": snapshot_id,
        "userId": user_id,
        "endpoint": endpoint,
        "requestBody": request_body,
        "responseBody": payload.get("responseBody"),
        "correction.fieldPath": field_path,
        "correction.displayedAs": displayed_as,
        "correction.reason": reason,
    }.items():
        if value in (None, "", []):
            missing.append(key)
    if "originalValue" not in correction:
        missing.append("correction.originalValue")
    if "correctedValue" not in correction:
        missing.append("correction.correctedValue")
    if missing:
        raise ValueError("缺少必填字段: " + ", ".join(missing))
    return {
        "snapshot_id": snapshot_id,
        "user_id": user_id,
        "endpoint": endpoint,
        "algo_version": payload.get("algoVersion"),
        "field_path": field_path,
        "displayed_as": displayed_as,
        "original_value": json_dumps(correction.get("originalValue")),
        "corrected_value": json_dumps(correction.get("correctedValue")),
        "reason": reason,
        "request_body": json_dumps(request_body),
        "response_body": json_dumps(payload.get("responseBody")),
        "context": json_dumps(context),
        "device_id": context.get("deviceId"),
        "firmware": context.get("firmware"),
        "app_version": context.get("appVersion"),
        "env": context.get("env"),
        "tester": context.get("tester"),
        "requested_at": parse_datetime(context.get("requestedAt")),
        "submitted_at": parse_datetime(context.get("submittedAt")),
    }


def store_snapshot(db: Session, payload: dict[str, Any], header_user_id: str | None = None) -> dict[str, Any]:
    initialize_schema(db)
    values = normalize_snapshot(payload, header_user_id)
    existing = db.execute(
        text("select id, create_time from feedback_snapshot where snapshot_id=:snapshot_id limit 1"),
        {"snapshot_id": values["snapshot_id"]},
    ).mappings().first()
    now = utc_now()
    if existing:
        return {"snapshotId": values["snapshot_id"], "storedAt": existing["create_time"], "duplicate": True}
    values["create_time"] = now
    values["update_time"] = now
    db.execute(
        text(
            """
            insert into feedback_snapshot(
              snapshot_id, user_id, endpoint, algo_version, field_path, displayed_as,
              original_value, corrected_value, reason, request_body, response_body, context,
              device_id, firmware, app_version, env, tester, requested_at, submitted_at,
              create_time, update_time
            ) values (
              :snapshot_id, :user_id, :endpoint, :algo_version, :field_path, :displayed_as,
              :original_value, :corrected_value, :reason, :request_body, :response_body, :context,
              :device_id, :firmware, :app_version, :env, :tester, :requested_at, :submitted_at,
              :create_time, :update_time
            )
            """
        ),
        values,
    )
    db.commit()
    return {"snapshotId": values["snapshot_id"], "storedAt": now, "duplicate": False}


def row_to_snapshot(row: Any, detail: bool = False) -> dict[str, Any]:
    data = camelize_dict(dict(row._mapping if hasattr(row, "_mapping") else row))
    for key in ("originalValue", "correctedValue"):
        data[key] = json_loads(data.get(key))
    if detail:
        for key in ("requestBody", "responseBody", "context"):
            data[key] = json_loads(data.get(key))
    else:
        data.pop("requestBody", None)
        data.pop("responseBody", None)
        data.pop("context", None)
    return data


def build_filters(query: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    clauses = ["1=1"]
    params: dict[str, Any] = {}
    equals = {
        "userId": "user_id",
        "endpoint": "endpoint",
        "fieldPath": "field_path",
        "displayedAs": "displayed_as",
        "env": "env",
        "deviceId": "device_id",
        "firmware": "firmware",
        "tester": "tester",
        "reviewStatus": "review_status",
        "diagnosis": "diagnosis",
    }
    for query_key, column in equals.items():
        value = query.get(query_key)
        if value not in (None, ""):
            clauses.append(f"{column}=:{query_key}")
            params[query_key] = value
    keyword = query.get("keyword")
    if keyword:
        clauses.append("(endpoint like :keyword or field_path like :keyword or displayed_as like :keyword or reason like :keyword)")
        params["keyword"] = f"%{keyword}%"
    begin_time = query.get("beginTime") or query.get("params[beginTime]")
    end_time = query.get("endTime") or query.get("params[endTime]")
    if begin_time:
        clauses.append("create_time >= :beginTime")
        params["beginTime"] = begin_time
    if end_time:
        clauses.append("create_time <= :endTime")
        params["endTime"] = f"{end_time} 23:59:59" if len(str(end_time)) == 10 else end_time
    return " and ".join(clauses), params


def list_snapshots(db: Session, query: dict[str, Any], page_num: int, page_size: int) -> tuple[list[dict[str, Any]], int]:
    initialize_schema(db)
    where_sql, params = build_filters(query)
    total = db.execute(text(f"select count(*) from feedback_snapshot where {where_sql}"), params).scalar() or 0
    rows = db.execute(
        text(
            f"""
            select * from feedback_snapshot
            where {where_sql}
            order by create_time desc, id desc
            limit :limit offset :offset
            """
        ),
        {**params, "limit": page_size, "offset": (page_num - 1) * page_size},
    ).all()
    return [row_to_snapshot(row) for row in rows], int(total)


def get_snapshot(db: Session, snapshot_id: str | int) -> dict[str, Any] | None:
    initialize_schema(db)
    if str(snapshot_id).isdigit():
        row = db.execute(text("select * from feedback_snapshot where id=:id limit 1"), {"id": int(snapshot_id)}).first()
    else:
        row = db.execute(text("select * from feedback_snapshot where snapshot_id=:snapshot_id limit 1"), {"snapshot_id": snapshot_id}).first()
    return row_to_snapshot(row, detail=True) if row else None


def algorithm_path(endpoint: str) -> str:
    path = endpoint.strip()
    if path.startswith("/api/"):
        path = path[4:]
    if not path.startswith("/"):
        path = "/" + path
    base = settings.other_api_base_url.rstrip("/") + "/"
    return urljoin(base, path.lstrip("/"))


def algorithm_user_name_from_id(db: Session, user_id: Any) -> str:
    if user_id in (None, ""):
        return ""
    try:
        normalized_user_id = int(user_id)
    except (TypeError, ValueError):
        return ""
    try:
        row = db.execute(
            text("select nick_name from app_user where id=:id and del_flag=0 limit 1"),
            {"id": normalized_user_id},
        ).first()
        if row:
            nick_name = str(row._mapping.get("nick_name") or "").strip()
            if nick_name:
                return nick_name
    except SQLAlchemyError:
        return ""
    return f"用户{normalized_user_id}"


def recalculate_snapshot(db: Session, snapshot_id: str | int) -> dict[str, Any]:
    snapshot = get_snapshot(db, snapshot_id)
    if not snapshot:
        raise ValueError("快照不存在")
    endpoint = snapshot.get("endpoint") or ""
    if endpoint.startswith("/app/"):
        raise ValueError("聚合接口快照只能审阅，不能直接复算算法；请上报 /api/physicalHealth/* 算法端点快照")
    if not settings.other_api_base_url:
        raise ValueError("未配置算法服务 OTHER_API_BASE_URL")
    request_body = snapshot.get("requestBody") or {}
    if isinstance(request_body, dict):
        user_id = request_body.get("user_id") or snapshot.get("userId")
        user_name = str(request_body.get("user_name") or "").strip()
        if not user_name:
            user_name = algorithm_user_name_from_id(db, user_id)
        request_body = {
            **request_body,
            "user_id": user_id,
            "user_name": user_name,
        }
    url = algorithm_path(endpoint)
    data = json.dumps(request_body, ensure_ascii=False, default=str).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            current = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ValueError(f"复算失败: {exc}") from exc
    return {
        "snapshotId": snapshot.get("snapshotId"),
        "endpoint": snapshot.get("endpoint"),
        "requestBody": request_body,
        "oldResponse": snapshot.get("responseBody"),
        "currentResponse": current,
        "correction": {
            "fieldPath": snapshot.get("fieldPath"),
            "displayedAs": snapshot.get("displayedAs"),
            "originalValue": snapshot.get("originalValue"),
            "correctedValue": snapshot.get("correctedValue"),
            "reason": snapshot.get("reason"),
        },
        "recalculatedAt": utc_now().isoformat() + "Z",
    }


def update_review(db: Session, snapshot_id: str | int, payload: dict[str, Any]) -> dict[str, Any]:
    initialize_schema(db)
    review_status = payload.get("reviewStatus") or "confirmed"
    diagnosis = payload.get("diagnosis") or "unknown"
    allowed_status = {"pending", "confirmed", "ignored"}
    allowed_diagnosis = {"front", "data", "algorithm", "unknown"}
    if review_status not in allowed_status:
        raise ValueError("reviewStatus 只能是 pending / confirmed / ignored")
    if diagnosis not in allowed_diagnosis:
        raise ValueError("diagnosis 只能是 front / data / algorithm / unknown")
    params = {
        "review_status": review_status,
        "diagnosis": diagnosis,
        "review_remark": payload.get("reviewRemark") or "",
        "reviewed_by": payload.get("reviewedBy") or "",
        "reviewed_at": utc_now(),
        "update_time": utc_now(),
    }
    if str(snapshot_id).isdigit():
        where = "id=:id"
        params["id"] = int(snapshot_id)
    else:
        where = "snapshot_id=:snapshot_id"
        params["snapshot_id"] = str(snapshot_id)
    result = db.execute(
        text(
            f"""
            update feedback_snapshot
            set review_status=:review_status,
                diagnosis=:diagnosis,
                review_remark=:review_remark,
                reviewed_by=:reviewed_by,
                reviewed_at=:reviewed_at,
                update_time=:update_time
            where {where}
            """
        ),
        params,
    )
    db.commit()
    if result.rowcount <= 0:
        raise ValueError("反馈快照不存在")
    item = get_snapshot(db, snapshot_id)
    if not item:
        raise ValueError("反馈快照不存在")
    return item


def delete_snapshot(db: Session, snapshot_id: str | int) -> int:
    initialize_schema(db)
    params: dict[str, Any] = {}
    if str(snapshot_id).isdigit():
        where = "id=:id"
        params["id"] = int(snapshot_id)
    else:
        where = "snapshot_id=:snapshot_id"
        params["snapshot_id"] = str(snapshot_id)
    result = db.execute(text(f"delete from feedback_snapshot where {where}"), params)
    db.commit()
    return int(result.rowcount or 0)


def export_snapshots_csv(db: Session, query: dict[str, Any]) -> io.BytesIO:
    rows, _ = list_snapshots(db, query, 1, 100000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "snapshotId",
        "userId",
        "endpoint",
        "algoVersion",
        "fieldPath",
        "displayedAs",
        "originalValue",
        "correctedValue",
        "reason",
        "deviceId",
        "firmware",
        "appVersion",
        "env",
        "tester",
        "reviewStatus",
        "diagnosis",
        "reviewRemark",
        "reviewedBy",
        "reviewedAt",
        "createTime",
    ])
    for row in rows:
        writer.writerow([
            row.get("snapshotId"),
            row.get("userId"),
            row.get("endpoint"),
            row.get("algoVersion"),
            row.get("fieldPath"),
            row.get("displayedAs"),
            json_dumps(row.get("originalValue")),
            json_dumps(row.get("correctedValue")),
            row.get("reason"),
            row.get("deviceId"),
            row.get("firmware"),
            row.get("appVersion"),
            row.get("env"),
            row.get("tester"),
            row.get("reviewStatus"),
            row.get("diagnosis"),
            row.get("reviewRemark"),
            row.get("reviewedBy"),
            row.get("reviewedAt"),
            row.get("createTime"),
        ])
    data = io.BytesIO(output.getvalue().encode("utf-8-sig"))
    data.seek(0)
    return data
