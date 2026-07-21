from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.responses import success, table
from app.db.session import get_db

router = APIRouter(tags=["rw-debug"])

APP_TIMEZONE = timezone(timedelta(hours=8))
RW_DEBUG_TABLE = "rw_diagnostic_logs"
MAX_BATCH_SIZE = 200
MAX_TEXT_LENGTH = 20000


class RwDebugLogEntry(BaseModel):
    id: int | None = None
    time: str | None = Field(default=None, max_length=64)
    clientTime: str | None = Field(default=None, max_length=64)
    source: str = Field(default="RW", max_length=64)
    event: str = Field(default="log", max_length=128)
    details: Any | None = None
    buildTag: str | None = Field(default=None, max_length=128)
    deviceId: str | None = Field(default=None, max_length=128)
    userId: int | None = None
    sessionId: str | None = Field(default=None, max_length=128)


class RwDebugLogBatch(BaseModel):
    entries: list[RwDebugLogEntry] | None = None
    logs: list[RwDebugLogEntry] | None = None
    sessionId: str | None = Field(default=None, max_length=128)
    buildTag: str | None = Field(default=None, max_length=128)


def now_app_time() -> datetime:
    return datetime.now(APP_TIMEZONE).replace(tzinfo=None)


def truncate_text(value: str | None, max_length: int = MAX_TEXT_LENGTH) -> str | None:
    if value is None:
        return None
    text_value = str(value)
    return text_value if len(text_value) <= max_length else f"{text_value[:max_length]}...<truncated>"


def json_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return truncate_text(value)
    try:
        return truncate_text(json.dumps(value, ensure_ascii=False, default=str))
    except Exception:
        return truncate_text(str(value))


def parse_details(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def pick_nested(mapping: dict[str, Any], *paths: str) -> Any:
    for path in paths:
        current: Any = mapping
        for key in path.split("."):
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(key)
        if current not in (None, ""):
            return current
    return None


def normalize_optional_text(value: Any, max_length: int) -> str | None:
    if value in (None, ""):
        return None
    return str(value)[:max_length]


def initialize_rw_debug_schema(db: Session) -> None:
    bind = db.get_bind()
    inspector = inspect(bind)
    if inspector.has_table(RW_DEBUG_TABLE):
        return

    dialect = bind.dialect.name
    if dialect == "mysql":
        ddl = f"""
        create table if not exists {RW_DEBUG_TABLE} (
            id bigint not null auto_increment primary key,
            created_at datetime not null,
            client_log_id bigint null,
            client_time varchar(64) null,
            source varchar(64) not null,
            event varchar(128) not null,
            build_tag varchar(128) null,
            device_id varchar(128) null,
            user_id int null,
            session_id varchar(128) null,
            details_json mediumtext null,
            payload_json mediumtext null,
            index idx_rw_debug_created_at (created_at),
            index idx_rw_debug_source_event (source, event),
            index idx_rw_debug_session (session_id)
        ) default charset=utf8mb4
        """
    else:
        ddl = f"""
        create table if not exists {RW_DEBUG_TABLE} (
            id integer primary key autoincrement,
            created_at datetime not null,
            client_log_id integer null,
            client_time varchar(64) null,
            source varchar(64) not null,
            event varchar(128) not null,
            build_tag varchar(128) null,
            device_id varchar(128) null,
            user_id integer null,
            session_id varchar(128) null,
            details_json text null,
            payload_json text null
        )
        """
    db.execute(text(ddl))
    if dialect != "mysql":
        db.execute(text(f"create index if not exists idx_rw_debug_created_at on {RW_DEBUG_TABLE} (created_at)"))
        db.execute(text(f"create index if not exists idx_rw_debug_source_event on {RW_DEBUG_TABLE} (source, event)"))
        db.execute(text(f"create index if not exists idx_rw_debug_session on {RW_DEBUG_TABLE} (session_id)"))
    db.commit()


def rw_debug_row(entry: RwDebugLogEntry, batch: RwDebugLogBatch) -> dict[str, Any]:
    details = parse_details(entry.details)
    payload = entry.model_dump(mode="json")
    build_tag = entry.buildTag or batch.buildTag or pick_nested(details, "buildTag", "snapshot.buildTag")
    device_id = entry.deviceId or pick_nested(
        details,
        "deviceId",
        "snapshot.deviceId",
        "snapshot.currentDevice.deviceId",
        "snapshot.storeDevice.deviceId",
        "snapshot.userDevice.deviceId",
    )
    return {
        "created_at": now_app_time(),
        "client_log_id": entry.id,
        "client_time": entry.clientTime or entry.time,
        "source": (entry.source or "RW")[:64],
        "event": (entry.event or "log")[:128],
        "build_tag": normalize_optional_text(build_tag, 128),
        "device_id": normalize_optional_text(device_id, 128),
        "user_id": entry.userId,
        "session_id": normalize_optional_text(entry.sessionId or batch.sessionId, 128),
        "details_json": json_text(entry.details),
        "payload_json": json_text(payload),
    }


def query_rw_debug_logs(
    db: Session,
    limit: int,
    source: str | None = None,
    event: str | None = None,
    q: str | None = None,
) -> list[dict[str, Any]]:
    initialize_rw_debug_schema(db)
    clauses: list[str] = []
    params: dict[str, Any] = {"limit": max(1, min(limit, 2000))}
    if source:
        clauses.append("source = :source")
        params["source"] = source
    if event:
        clauses.append("event = :event")
        params["event"] = event
    if q:
        clauses.append("(source like :q or event like :q or details_json like :q or payload_json like :q)")
        params["q"] = f"%{q}%"
    where_sql = f"where {' and '.join(clauses)}" if clauses else ""
    rows = db.execute(
        text(
            f"""
            select id, created_at, client_log_id, client_time, source, event, build_tag,
                   device_id, user_id, session_id, details_json, payload_json
            from {RW_DEBUG_TABLE}
            {where_sql}
            order by id desc
            limit :limit
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("/app/rw-debug/logs")
def receive_rw_debug_logs(payload: RwDebugLogBatch, db: Session = Depends(get_db)):
    initialize_rw_debug_schema(db)
    entries = payload.entries or payload.logs or []
    entries = entries[-MAX_BATCH_SIZE:]
    if not entries:
        return success({"count": 0})
    rows = [rw_debug_row(entry, payload) for entry in entries]
    db.execute(
        text(
            f"""
            insert into {RW_DEBUG_TABLE}
              (created_at, client_log_id, client_time, source, event, build_tag, device_id,
               user_id, session_id, details_json, payload_json)
            values
              (:created_at, :client_log_id, :client_time, :source, :event, :build_tag, :device_id,
               :user_id, :session_id, :details_json, :payload_json)
            """
        ),
        rows,
    )
    db.commit()
    return success({"count": len(rows)})


@router.delete("/app/rw-debug/logs")
def clear_rw_debug_logs(db: Session = Depends(get_db)):
    initialize_rw_debug_schema(db)
    result = db.execute(text(f"delete from {RW_DEBUG_TABLE}"))
    db.commit()
    return success({"deleted": result.rowcount})


@router.get("/app/rw-debug/logs")
def list_rw_debug_logs(
    db: Session = Depends(get_db),
    limit: int = Query(default=300, ge=1, le=2000),
    source: str | None = None,
    event: str | None = None,
    q: str | None = None,
):
    rows = query_rw_debug_logs(db, limit=limit, source=source, event=event, q=q)
    return table(rows, total=len(rows))


def render_log_details(details_json: str | None) -> str:
    if not details_json:
        return ""
    try:
        parsed = json.loads(details_json)
        text_value = json.dumps(parsed, ensure_ascii=False, indent=2, default=str)
    except Exception:
        text_value = details_json
    return escape(text_value)


@router.get("/app/rw-debug/logs/page", response_class=HTMLResponse)
@router.get("/rw-debug/logs", response_class=HTMLResponse)
def rw_debug_logs_page(
    db: Session = Depends(get_db),
    limit: int = Query(default=500, ge=1, le=2000),
    source: str | None = None,
    event: str | None = None,
    q: str | None = None,
):
    rows = query_rw_debug_logs(db, limit=limit, source=source, event=event, q=q)
    body_rows = "\n".join(
        f"""
        <tr>
          <td>{escape(str(row.get("id") or ""))}</td>
          <td>{escape(str(row.get("created_at") or ""))}</td>
          <td>{escape(str(row.get("client_time") or ""))}</td>
          <td>{escape(str(row.get("source") or ""))}</td>
          <td>{escape(str(row.get("event") or ""))}</td>
          <td>{escape(str(row.get("build_tag") or ""))}</td>
          <td>{escape(str(row.get("device_id") or ""))}</td>
          <td><pre>{render_log_details(row.get("details_json"))}</pre></td>
        </tr>
        """
        for row in rows
    )
    html = f"""
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>RW Diagnostic Logs</title>
        <style>
          body {{ margin: 0; padding: 16px; font-family: Arial, sans-serif; background: #f4f6f8; color: #17202a; }}
          header {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }}
          form {{ display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }}
          input {{ padding: 8px; border: 1px solid #ccd3db; border-radius: 4px; }}
          button, a.button {{ padding: 8px 12px; border: 0; border-radius: 4px; background: #2f6fed; color: #fff; cursor: pointer; text-decoration: none; }}
          button.danger {{ background: #d64545; }}
          table {{ width: 100%; border-collapse: collapse; background: #fff; }}
          th, td {{ border: 1px solid #e3e7ed; padding: 8px; vertical-align: top; font-size: 13px; }}
          th {{ position: sticky; top: 0; background: #eef3fb; z-index: 1; }}
          pre {{ margin: 0; white-space: pre-wrap; word-break: break-word; max-width: 760px; font-family: Consolas, monospace; }}
          .muted {{ color: #667085; }}
        </style>
      </head>
      <body>
        <header>
          <div>
            <h2>RW Diagnostic Logs</h2>
            <div class="muted">Rows: {len(rows)}. Page is public for field debugging.</div>
          </div>
          <div>
            <button class="danger" onclick="clearLogs()">Clear all logs</button>
            <a class="button" href="?">Reset filter</a>
          </div>
        </header>
        <form method="get">
          <input name="source" placeholder="source" value="{escape(source or '')}" />
          <input name="event" placeholder="event" value="{escape(event or '')}" />
          <input name="q" placeholder="search text" value="{escape(q or '')}" />
          <input name="limit" type="number" min="1" max="2000" value="{limit}" />
          <button type="submit">Search</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Server Time</th>
              <th>Client Time</th>
              <th>Source</th>
              <th>Event</th>
              <th>Build</th>
              <th>Device</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>{body_rows}</tbody>
        </table>
        <script>
          async function clearLogs() {{
            if (!confirm('Clear all RW diagnostic logs?')) return;
            const path = location.pathname.endsWith('/') ? location.pathname.slice(0, -1) : location.pathname;
            const logsPath = path.endsWith('/page') ? path.slice(0, -5) : path;
            await fetch(logsPath, {{ method: 'DELETE' }});
            location.reload();
          }}
        </script>
      </body>
    </html>
    """
    return HTMLResponse(html)
