"""Persistence for Xiaoqing H5 cycle records, interventions and events."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session


DEFAULT_CONTENT = [
    ("breathing-3m", "3 分钟深呼吸", "breathing", "压力偏高时，先让身体降速。", 3, "stress,anytime"),
    ("breathing-478", "478 呼吸练习", "breathing", "用稳定节奏帮助身体进入放松状态。", 4, "stress,sleep"),
    ("mindful-5m", "5 分钟情绪安定", "mindfulness", "短暂停下来，观察当下感受。", 5, "stress,pms"),
    ("body-scan-5m", "身体扫描", "mindfulness", "温和觉察肩颈、呼吸与身体紧张。", 5, "sleep,stress"),
    ("sleep-relax-5m", "睡前 5 分钟放松", "sleep", "睡前降低刺激，为入睡做准备。", 5, "sleep"),
    ("sleep-stretch-8m", "睡前舒缓拉伸", "sleep", "使用低强度动作舒缓久坐紧张。", 8, "sleep,sedentary"),
    ("period-yoga-6m", "经期温和舒展", "cycle", "经期以舒适和低强度为优先。", 6, "period"),
    ("period-care-3m", "经期照护记录", "cycle", "记录身体感受，帮助理解个人节律。", 3, "period,pms"),
    ("neck-stretch-4m", "肩颈放松", "recovery", "久坐后做一组温和肩颈活动。", 4, "sedentary"),
    ("light-walk-12m", "午后轻步行", "recovery", "用轻步行减少连续久坐。", 12, "activity,sedentary"),
    ("recovery-stretch-6m", "恢复拉伸", "recovery", "恢复一般时优先低强度活动。", 6, "activity,recovery"),
    ("emotion-note-2m", "一句话情绪记录", "emotion", "记录此刻感受，不急着评价自己。", 2, "stress,pms"),
]


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, default=str)


def _load(value: Any) -> Any:
    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return value


def initialize_schema(db: Session) -> None:
    dialect = db.get_bind().dialect.name
    pk = "integer primary key autoincrement" if dialect == "sqlite" else "bigint primary key auto_increment"
    json_type = "text" if dialect == "sqlite" else "longtext"
    tables = [
        f"""create table if not exists h5_cycle_record (
          id {pk}, record_id varchar(64) not null unique, user_id bigint not null,
          record_type varchar(32) not null, record_date date not null, payload_json {json_type} not null,
          idempotency_key varchar(128) null, create_time datetime not null, update_time datetime not null
        )""",
        f"""create table if not exists h5_intervention_content (
          id {pk}, content_id varchar(64) not null unique, title varchar(128) not null,
          category varchar(32) not null, reason text not null, duration_minutes integer not null,
          scene_tags varchar(255) null, content_json {json_type} not null, status integer not null default 1,
          sort_order integer not null default 0, create_time datetime not null, update_time datetime not null
        )""",
        f"""create table if not exists h5_intervention_favorite (
          id {pk}, user_id bigint not null, content_id varchar(64) not null, is_favorite integer not null default 1,
          idempotency_key varchar(128) null, create_time datetime not null, update_time datetime not null,
          unique(user_id, content_id)
        )""",
        f"""create table if not exists h5_intervention_checkin (
          id {pk}, checkin_id varchar(64) not null unique, user_id bigint not null, content_id varchar(64) not null,
          action varchar(32) not null, scene_id varchar(128) null, idempotency_key varchar(128) null,
          started_at datetime null, completed_at datetime null, payload_json {json_type} not null,
          create_time datetime not null, update_time datetime not null
        )""",
        f"""create table if not exists h5_intervention_feedback (
          id {pk}, feedback_id varchar(64) not null unique, user_id bigint not null, content_id varchar(64) not null,
          feedback_type varchar(32) not null, reason text null, scene_id varchar(128) null,
          idempotency_key varchar(128) null, payload_json {json_type} not null,
          create_time datetime not null, update_time datetime not null
        )""",
        f"""create table if not exists h5_event_log (
          id {pk}, event_id varchar(64) not null unique, user_id bigint not null, event_name varchar(128) not null,
          occurred_at datetime not null, scene_id varchar(128) null, tab_name varchar(32) null,
          target_id varchar(128) null, result varchar(64) null, payload_json {json_type} not null,
          idempotency_key varchar(128) null, create_time datetime not null
        )""",
    ]
    for ddl in tables:
        db.execute(text(ddl))
    now = datetime.now()
    for order, (content_id, title, category, reason, duration, tags) in enumerate(DEFAULT_CONTENT, 1):
        exists = db.execute(text("select id from h5_intervention_content where content_id=:content_id"), {"content_id": content_id}).scalar()
        if not exists:
            db.execute(text("""insert into h5_intervention_content
              (content_id,title,category,reason,duration_minutes,scene_tags,content_json,status,sort_order,create_time,update_time)
              values(:content_id,:title,:category,:reason,:duration,:tags,:content,1,:sort_order,:now,:now)"""), {
                "content_id": content_id, "title": title, "category": category, "reason": reason,
                "duration": duration, "tags": tags, "content": _json({"steps": [], "safety": "low_risk_lifestyle"}),
                "sort_order": order, "now": now,
            })
    db.commit()


def save_cycle_record(db: Session, user_id: int, payload: dict[str, Any], idem: str | None) -> dict[str, Any]:
    if idem:
        row = db.execute(text("select * from h5_cycle_record where user_id=:uid and idempotency_key=:idem limit 1"), {"uid": user_id, "idem": idem}).mappings().first()
        if row:
            return serialize_cycle(dict(row))
    record_type = str(payload.get("type") or payload.get("recordType") or "symptom")
    if record_type not in {"period_start", "period_end", "period", "symptom"}:
        raise ValueError("不支持的周期记录类型")
    record_date = str(payload.get("date") or date.today().isoformat())[:10]
    date.fromisoformat(record_date)
    record_id, now = uuid4().hex, datetime.now()
    db.execute(text("""insert into h5_cycle_record
      (record_id,user_id,record_type,record_date,payload_json,idempotency_key,create_time,update_time)
      values(:rid,:uid,:typ,:day,:payload,:idem,:now,:now)"""), {
        "rid": record_id, "uid": user_id, "typ": record_type, "day": record_date,
        "payload": _json(payload), "idem": idem, "now": now,
    })
    db.commit()
    return {"recordId": record_id, "recordType": record_type, "date": record_date, "payload": payload}


def serialize_cycle(row: dict[str, Any]) -> dict[str, Any]:
    return {"recordId": row.get("record_id"), "recordType": row.get("record_type"), "date": str(row.get("record_date")), "payload": _load(row.get("payload_json")) or {}}


def list_cycle_records(db: Session, user_id: int, limit: int = 100) -> list[dict[str, Any]]:
    rows = db.execute(text(f"select * from h5_cycle_record where user_id=:uid order by record_date desc,id desc limit {max(1,min(limit,500))}"), {"uid": user_id}).mappings().all()
    return [serialize_cycle(dict(row)) for row in rows]


def content_list(db: Session, user_id: int, category: str | None = None) -> list[dict[str, Any]]:
    rows = db.execute(text("""select c.*, coalesce(f.is_favorite,0) as favorite
      from h5_intervention_content c left join h5_intervention_favorite f
      on f.content_id=c.content_id and f.user_id=:uid
      where c.status=1 and (:category is null or c.category=:category)
      order by c.sort_order,c.id"""), {"uid": user_id, "category": category}).mappings().all()
    return [{"id": r["content_id"], "title": r["title"], "category": r["category"], "reason": r["reason"], "durationMinutes": r["duration_minutes"], "sceneTags": (r["scene_tags"] or "").split(","), "favorite": bool(r["favorite"]), "content": _load(r["content_json"]) or {}} for r in rows]


def recommendations(db: Session, user_id: int, context: str | None = None) -> dict[str, Any]:
    items = content_list(db, user_id)
    context = (context or "").lower()
    ranked = sorted(items, key=lambda item: (0 if any(tag in context for tag in item["sceneTags"]) else 1, item["durationMinutes"]))
    return {"primary": ranked[0] if ranked else None, "alternatives": ranked[1:3], "strategy": "controlled_content_rule_v1"}


def set_favorite(db: Session, user_id: int, content_id: str, favorite: bool, idem: str | None) -> dict[str, Any]:
    now = datetime.now()
    row = db.execute(text("select id from h5_intervention_favorite where user_id=:uid and content_id=:cid"), {"uid": user_id, "cid": content_id}).scalar()
    if row:
        db.execute(text("update h5_intervention_favorite set is_favorite=:fav,idempotency_key=:idem,update_time=:now where id=:id"), {"fav": int(favorite), "idem": idem, "now": now, "id": row})
    else:
        db.execute(text("insert into h5_intervention_favorite(user_id,content_id,is_favorite,idempotency_key,create_time,update_time) values(:uid,:cid,:fav,:idem,:now,:now)"), {"uid": user_id, "cid": content_id, "fav": int(favorite), "idem": idem, "now": now})
    db.commit()
    return {"contentId": content_id, "favorite": favorite}


def save_action(db: Session, table: str, id_column: str, user_id: int, content_id: str, payload: dict[str, Any], idem: str | None) -> dict[str, Any]:
    if not db.execute(text("select id from h5_intervention_content where content_id=:cid and status=1"), {"cid": content_id}).scalar():
        raise ValueError("轻干预内容不存在或已停用")
    if idem:
        row = db.execute(text(f"select {id_column} from {table} where user_id=:uid and idempotency_key=:idem limit 1"), {"uid": user_id, "idem": idem}).scalar()
        if row:
            return {"id": row, "duplicate": True}
    item_id, now = uuid4().hex, datetime.now()
    if table == "h5_intervention_checkin":
        action = str(payload.get("action") or "completed")
        if action not in {"started", "completed", "skipped"}: raise ValueError("不支持的打卡动作")
        db.execute(text("""insert into h5_intervention_checkin
          (checkin_id,user_id,content_id,action,scene_id,idempotency_key,started_at,completed_at,payload_json,create_time,update_time)
          values(:iid,:uid,:cid,:action,:scene,:idem,:started,:completed,:payload,:now,:now)"""),
          {"iid": item_id,"uid":user_id,"cid":content_id,"action":action,"scene":payload.get("sceneId"),"idem":idem,"started":payload.get("startedAt"),"completed":payload.get("completedAt") or (now if action=="completed" else None),"payload":_json(payload),"now":now})
    else:
        feedback_type = str(payload.get("feedbackType") or "helpful")
        if feedback_type not in {"helpful","not_helpful","not_for_me","report"}: raise ValueError("不支持的反馈类型")
        db.execute(text("""insert into h5_intervention_feedback
          (feedback_id,user_id,content_id,feedback_type,reason,scene_id,idempotency_key,payload_json,create_time,update_time)
          values(:iid,:uid,:cid,:typ,:reason,:scene,:idem,:payload,:now,:now)"""),
          {"iid":item_id,"uid":user_id,"cid":content_id,"typ":feedback_type,"reason":payload.get("reason"),"scene":payload.get("sceneId"),"idem":idem,"payload":_json(payload),"now":now})
    db.commit()
    return {"id": item_id, "duplicate": False}


def save_events(db: Session, user_id: int, events: list[dict[str, Any]], idem: str | None) -> dict[str, Any]:
    saved = 0
    for event in events[:100]:
        event_name = str(event.get("eventName") or "").strip()
        if not event_name: continue
        event_id = str(event.get("eventId") or uuid4().hex)
        if db.execute(text("select id from h5_event_log where event_id=:eid"), {"eid":event_id}).scalar(): continue
        now = datetime.now()
        db.execute(text("""insert into h5_event_log
          (event_id,user_id,event_name,occurred_at,scene_id,tab_name,target_id,result,payload_json,idempotency_key,create_time)
          values(:eid,:uid,:name,:occurred,:scene,:tab,:target,:result,:payload,:idem,:now)"""),
          {"eid":event_id,"uid":user_id,"name":event_name,"occurred":event.get("occurredAt") or now,"scene":event.get("sceneId"),"tab":event.get("tab"),"target":event.get("targetId"),"result":event.get("result"),"payload":_json(event),"idem":idem,"now":now})
        saved += 1
    db.commit()
    return {"accepted": saved, "received": min(len(events), 100)}
