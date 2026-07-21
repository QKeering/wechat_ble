from __future__ import annotations

import json
import secrets
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.services import app_auth
from app.services.crud import camelize_dict


DEFAULT_PERMISSIONS = {
    "vitalSigns": True,
    "sleep": True,
    "motion": True,
    "alerts": True,
    "aiSummary": True,
    "deviceStatus": True,
}

RELATION_STATUS = {
    "pending": 0,
    "active": 1,
    "paused": 2,
    "cancelled": 3,
    "rejected": 4,
}

RELATION_STATUS_TEXT = {
    0: "待确认",
    1: "生效",
    2: "已暂停",
    3: "已取消",
    4: "已拒绝",
}

INVITE_STATUS = {
    "pending": 0,
    "accepted": 1,
    "rejected": 2,
    "expired": 3,
    "cancelled": 4,
}


def has_permission(member: dict[str, Any], key: str) -> bool:
    if str(member.get("status") or "active") != "active":
        return False
    permissions = _parse_permissions(member.get("permissions"))
    return bool(permissions.get(key))


def require_permission(member: dict[str, Any], key: str) -> None:
    if str(member.get("status") or "active") != "active":
        raise ValueError("该共享关系已暂停或取消")
    if not has_permission(member, key):
        raise ValueError("当前亲情账号未开启该数据共享权限")


def initialize_schema(db: Session) -> None:
    db.execute(
        text(
            """
            create table if not exists family_member (
              id bigint primary key auto_increment,
              owner_user_id bigint not null,
              linked_user_id bigint null,
              data_user_id bigint not null,
              name varchar(64) not null,
              relation varchar(32) not null default 'parent',
              phone varchar(32) null,
              avatar varchar(255) null,
              permissions json null,
              relation_id bigint null,
              elder_profile_id bigint null,
              status varchar(32) not null default 'active',
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag tinyint not null default 0,
              index idx_family_member_owner (owner_user_id),
              index idx_family_member_data_user (data_user_id)
            )
            """
        )
    )
    _try_alter(db, "alter table family_member add column relation_id bigint null")
    _try_alter(db, "alter table family_member add column elder_profile_id bigint null")
    db.execute(
        text(
            """
            create table if not exists family_member_device (
              id bigint primary key auto_increment,
              member_id bigint not null,
              owner_user_id bigint not null,
              data_user_id bigint not null,
              device_mac varchar(128) not null,
              service_id varchar(128) null,
              device_name varchar(128) null,
              bind_by_user_id bigint not null,
              status varchar(32) not null default 'active',
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag tinyint not null default 0,
              index idx_family_member_device_mac (device_mac),
              index idx_family_member_device_member (member_id),
              index idx_family_member_device_owner (owner_user_id),
              index idx_family_member_device_data_user (data_user_id)
            )
            """
        )
    )
    try:
        db.execute(text("alter table family_member_device drop index uk_family_member_device_mac"))
    except Exception:
        db.rollback()
    db.execute(
        text(
            """
            create table if not exists family_health_alert (
              id bigint primary key auto_increment,
              member_id bigint not null,
              owner_user_id bigint not null,
              data_user_id bigint not null,
              alert_type varchar(64) not null,
              level varchar(32) not null default 'info',
              title varchar(128) not null,
              content varchar(512) null,
              metric_value varchar(64) null,
              status varchar(32) not null default 'unread',
              event_time datetime not null default current_timestamp,
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag tinyint not null default 0,
              index idx_family_alert_member (member_id),
              index idx_family_alert_owner (owner_user_id),
              index idx_family_alert_time (event_time)
            )
            """
        )
    )
    db.execute(
        text(
            """
            create table if not exists elder_profile (
              id bigint primary key auto_increment,
              creator_user_id bigint not null,
              real_user_id bigint null,
              name varchar(64) not null,
              phone varchar(32) null,
              sex tinyint null,
              birthday date null,
              height int null,
              weight int null,
              claim_status tinyint not null default 0,
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag char(1) not null default '0',
              index idx_elder_profile_creator (creator_user_id),
              index idx_elder_profile_real_user (real_user_id),
              index idx_elder_profile_phone (phone)
            )
            """
        )
    )
    db.execute(
        text(
            """
            create table if not exists family_relation (
              id bigint primary key auto_increment,
              elder_user_id bigint null,
              elder_profile_id bigint null,
              guardian_user_id bigint not null,
              relation_type varchar(32) not null default 'child',
              display_name varchar(64) not null,
              permission_scope json null,
              status tinyint not null default 1,
              source tinyint not null default 1,
              remark varchar(255) null,
              last_view_time datetime null,
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag char(1) not null default '0',
              index idx_family_elder_user_id (elder_user_id),
              index idx_family_elder_profile_id (elder_profile_id),
              index idx_family_guardian_user_id (guardian_user_id)
            )
            """
        )
    )
    db.execute(
        text(
            """
            create table if not exists family_invite (
              id bigint primary key auto_increment,
              invite_code varchar(64) not null,
              inviter_user_id bigint not null,
              invitee_user_id bigint null,
              elder_user_id bigint null,
              elder_profile_id bigint null,
              relation_id bigint null,
              invite_type tinyint not null,
              target_phone varchar(32) null,
              status tinyint not null default 0,
              expire_time datetime not null,
              accept_time datetime null,
              create_time datetime not null default current_timestamp,
              unique key uk_family_invite_code (invite_code),
              index idx_family_invite_inviter (inviter_user_id),
              index idx_family_invite_invitee (invitee_user_id),
              index idx_family_invite_target_phone (target_phone)
            )
            """
        )
    )
    _backfill_relations(db)
    db.execute(
        text(
            """
            create table if not exists device_bind_log (
              id bigint primary key auto_increment,
              device_id bigint null,
              device_mac varchar(128) null,
              device_sn varchar(128) null,
              old_user_id bigint null,
              new_user_id bigint null,
              operator_user_id bigint not null,
              operator_type tinyint not null default 2,
              action varchar(32) not null,
              reason varchar(255) null,
              create_time datetime not null default current_timestamp,
              index idx_device_bind_log_mac (device_mac),
              index idx_device_bind_log_operator (operator_user_id),
              index idx_device_bind_log_time (create_time)
            )
            """
        )
    )
    db.execute(
        text(
            """
            create table if not exists family_care_subscription (
              id bigint primary key auto_increment,
              user_id bigint not null,
              subscribe_enabled tinyint not null default 0,
              template_ids json null,
              last_request_status json null,
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              unique key uk_family_care_subscription_user (user_id)
            )
            """
        )
    )
    db.execute(
        text(
            """
            create table if not exists family_group (
              id bigint primary key auto_increment,
              owner_user_id bigint not null,
              group_name varchar(64) not null,
              description varchar(255) null,
              status tinyint not null default 1,
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag char(1) not null default '0',
              index idx_family_group_owner (owner_user_id)
            )
            """
        )
    )
    db.execute(
        text(
            """
            create table if not exists family_group_relation (
              id bigint primary key auto_increment,
              group_id bigint not null,
              relation_id bigint not null,
              member_id bigint null,
              role varchar(32) not null default 'elder',
              status tinyint not null default 1,
              created_by bigint not null,
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag char(1) not null default '0',
              unique key uk_family_group_relation (group_id, relation_id),
              index idx_family_group_relation_group (group_id),
              index idx_family_group_relation_relation (relation_id)
            )
            """
        )
    )
    db.execute(
        text(
            """
            create table if not exists family_assist_request (
              id bigint primary key auto_increment,
              requester_user_id bigint not null,
              relation_id bigint null,
              member_id bigint null,
              request_type varchar(32) not null default 'device_bind',
              status tinyint not null default 0,
              contact_phone varchar(32) null,
              device_mac varchar(128) null,
              description varchar(512) null,
              operator_user_id bigint null,
              operator_name varchar(64) null,
              result_note varchar(512) null,
              create_time datetime not null default current_timestamp,
              update_time datetime not null default current_timestamp on update current_timestamp,
              del_flag char(1) not null default '0',
              index idx_family_assist_requester (requester_user_id),
              index idx_family_assist_relation (relation_id),
              index idx_family_assist_status (status)
            )
            """
        )
    )
    db.commit()


def _try_alter(db: Session, sql: str) -> None:
    try:
        db.execute(text(sql))
        db.commit()
    except Exception:
        db.rollback()


def _backfill_relations(db: Session) -> None:
    rows = db.execute(
        text(
            """
            select * from family_member
            where del_flag=0 and (relation_id is null or relation_id=0)
            order by id
            """
        )
    ).all()
    for row in rows:
        member = dict(row._mapping)
        relation_id = create_relation(
            db,
            elder_user_id=int(member["data_user_id"]),
            elder_profile_id=member.get("elder_profile_id"),
            guardian_user_id=int(member["owner_user_id"]),
            display_name=member.get("name") or "家人",
            relation_type=_relation_type_from_member_relation(str(member.get("relation") or "parent")),
            permission_scope=_parse_permissions(member.get("permissions")),
            status=_status_to_relation_status(member.get("status")),
            source=1,
            remark="backfilled_from_family_member",
        )
        db.execute(text("update family_member set relation_id=:relation_id where id=:id"), {"relation_id": relation_id, "id": member["id"]})


def _permissions_payload(value: Any = None) -> str:
    payload = DEFAULT_PERMISSIONS.copy()
    if isinstance(value, dict):
        payload.update(value)
    return json.dumps(payload, ensure_ascii=False)


def _parse_permissions(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return {**DEFAULT_PERMISSIONS, **value}
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return {**DEFAULT_PERMISSIONS, **parsed}
        except json.JSONDecodeError:
            pass
    return DEFAULT_PERMISSIONS.copy()


def _relation_type_from_member_relation(relation: str) -> str:
    if relation in {"father", "mother", "grandpa", "grandma", "parent"}:
        return "child"
    return relation if relation in {"spouse", "relative", "caregiver", "other"} else "other"


def _status_from_relation_status(status: int | None) -> str:
    if status == RELATION_STATUS["paused"]:
        return "paused"
    if status == RELATION_STATUS["cancelled"]:
        return "cancelled"
    if status == RELATION_STATUS["rejected"]:
        return "rejected"
    if status == RELATION_STATUS["pending"]:
        return "pending"
    return "active"


def _status_to_relation_status(status: str | None) -> int:
    return {
        "pending": RELATION_STATUS["pending"],
        "active": RELATION_STATUS["active"],
        "paused": RELATION_STATUS["paused"],
        "cancelled": RELATION_STATUS["cancelled"],
        "rejected": RELATION_STATUS["rejected"],
    }.get(str(status or "active"), RELATION_STATUS["active"])


def _profile_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "sex": payload.get("sex"),
        "birthday": payload.get("birthday") or None,
        "height": payload.get("height"),
        "weight": payload.get("weight"),
    }


def create_elder_profile(
    db: Session,
    creator_user_id: int,
    payload: dict[str, Any],
    real_user_id: int | None = None,
) -> int:
    profile = _profile_payload(payload)
    result = db.execute(
        text(
            """
            insert into elder_profile(creator_user_id, real_user_id, name, phone, sex, birthday, height, weight, claim_status)
            values(:creator_user_id, :real_user_id, :name, :phone, :sex, :birthday, :height, :weight, :claim_status)
            """
        ),
        {
            "creator_user_id": creator_user_id,
            "real_user_id": real_user_id,
            "name": str(payload.get("name") or "").strip(),
            "phone": str(payload.get("phone") or "").strip() or None,
            "sex": profile["sex"],
            "birthday": profile["birthday"],
            "height": profile["height"],
            "weight": profile["weight"],
            "claim_status": 1 if real_user_id else 0,
        },
    )
    return int(result.lastrowid)


def create_relation(
    db: Session,
    *,
    elder_user_id: int | None,
    elder_profile_id: int | None,
    guardian_user_id: int,
    display_name: str,
    relation_type: str = "child",
    permission_scope: dict[str, Any] | None = None,
    status: int = RELATION_STATUS["active"],
    source: int = 1,
    remark: str | None = None,
) -> int:
    existing = None
    if elder_user_id:
        existing = db.execute(
            text(
                """
                select id from family_relation
                where elder_user_id=:elder_user_id and guardian_user_id=:guardian_user_id
                  and del_flag='0' and status in (0,1,2)
                order by id desc limit 1
                """
            ),
            {"elder_user_id": elder_user_id, "guardian_user_id": guardian_user_id},
        ).scalar()
    if existing:
        db.execute(
            text(
                """
                update family_relation
                set display_name=:display_name,
                    relation_type=:relation_type,
                    permission_scope=:permission_scope,
                    status=:status,
                    update_time=now()
                where id=:id
                """
            ),
            {
                "id": existing,
                "display_name": display_name,
                "relation_type": relation_type,
                "permission_scope": _permissions_payload(permission_scope),
                "status": status,
            },
        )
        return int(existing)
    result = db.execute(
        text(
            """
            insert into family_relation(
              elder_user_id, elder_profile_id, guardian_user_id, relation_type,
              display_name, permission_scope, status, source, remark
            )
            values(
              :elder_user_id, :elder_profile_id, :guardian_user_id, :relation_type,
              :display_name, :permission_scope, :status, :source, :remark
            )
            """
        ),
        {
            "elder_user_id": elder_user_id,
            "elder_profile_id": elder_profile_id,
            "guardian_user_id": guardian_user_id,
            "relation_type": relation_type,
            "display_name": display_name,
            "permission_scope": _permissions_payload(permission_scope),
            "status": status,
            "source": source,
            "remark": remark,
        },
    )
    return int(result.lastrowid)


def _relation_from_row(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    data = camelize_dict(dict(row._mapping))
    data["relationId"] = data.get("id")
    data["permissionScope"] = _parse_permissions(data.get("permissionScope"))
    data["statusText"] = RELATION_STATUS_TEXT.get(int(data.get("status") or 1), "生效")
    data["memberId"] = data.get("memberId")
    _mask_response_phone_fields(data, ("phone", "elderPhone", "profilePhone"))
    return data


def _member_from_row(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    data = camelize_dict(dict(row._mapping))
    data["permissions"] = _parse_permissions(data.get("permissions"))
    _mask_response_phone_fields(data, ("phone",))
    return data


def _create_shadow_user(db: Session, owner: dict[str, Any], name: str, phone: str | None) -> int:
    stamp = datetime.now().strftime("%m%d%H%M%S%f")
    open_id = f"family:{owner['id']}:{stamp}"
    shadow_phone = phone or f"9{str(owner['id'])[-2:].zfill(2)}{stamp[-8:]}"
    user = app_auth.create_user(db, open_id=open_id, phone=shadow_phone)
    db.execute(
        text("update app_user set nick_name=:name, update_time=now() where id=:id"),
        {"name": name, "id": user["id"]},
    )
    db.commit()
    return int(user["id"])


def list_members(db: Session, owner_user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select m.*,
                   d.device_mac, d.service_id, d.device_name,
                   dev.battery, dev.last_sync_time
            from family_member m
            left join family_member_device d on d.member_id=m.id and d.del_flag=0 and d.status='active'
            left join device dev on dev.mac=d.device_mac collate utf8mb4_general_ci and dev.del_flag=0
            where m.owner_user_id=:owner_user_id and m.del_flag=0
            order by m.create_time desc
            """
        ),
        {"owner_user_id": owner_user_id},
    ).all()
    return [_member_from_row(row) for row in rows if row]


def _attention_level(member: dict[str, Any]) -> str:
    device = device_status(member)
    if not device.get("mac"):
        return "unbound"
    if not device.get("online"):
        return "unsynced"
    battery = device.get("battery")
    if battery not in (None, ""):
        try:
            if float(battery) <= 20:
                return "attention"
        except (TypeError, ValueError):
            pass
    return "normal"


def _today_summary_for_member(db: Session, member: dict[str, Any]) -> dict[str, Any]:
    row = db.execute(
        text(
            """
            select * from health_daily_summary
            where user_id=:user_id and record_date=:record_date
            limit 1
            """
        ),
        {"user_id": int(member["dataUserId"]), "record_date": date.today().isoformat()},
    ).first()
    return camelize_dict(dict(row._mapping)) if row else {}


def _member_card_payload(db: Session, member: dict[str, Any], level: str) -> dict[str, Any]:
    device = device_status(member)
    summary = _today_summary_for_member(db, member)
    metrics = {
        "heartRate": round(_safe_float(summary.get("heartRateAvg")) or 0) or None,
        "spo2": round(_safe_float(summary.get("spo2Avg")) or 0) or None,
        "sleepScore": round(_safe_float(summary.get("sleepScore")) or 0) or None,
        "steps": round(_safe_float(summary.get("totalSteps")) or 0) or None,
        "battery": round(_safe_float(device.get("battery")) or 0) if device.get("battery") not in (None, "") else None,
    }
    priority = 0
    reasons: list[str] = []
    suggestions: list[str] = []
    if level == "unbound":
        priority = 90
        reasons.append("尚未绑定设备")
        suggestions.append("先为家人绑定设备，后续数据会自动归属到家人档案。")
    elif level == "unsynced":
        priority = 80
        reasons.append("超过 24 小时未同步")
        suggestions.append("提醒家人打开小程序同步一次，确认设备是否佩戴或有电。")
    if metrics["battery"] is not None and metrics["battery"] <= 20:
        priority = max(priority, 70)
        reasons.append("设备电量偏低")
        suggestions.append("建议提醒家人及时充电。")
    if metrics["spo2"] is not None and metrics["spo2"] < 93:
        priority = max(priority, 95)
        reasons.append("血氧偏低")
        suggestions.append("建议电话确认是否不适，并休息后复测。")
    heart_rate = metrics["heartRate"]
    if heart_rate is not None and (heart_rate > 110 or heart_rate < 50):
        priority = max(priority, 75)
        reasons.append("心率需要关注")
        suggestions.append("结合活动和休息情况观察，持续异常请咨询医生。")
    if metrics["sleepScore"] is not None and metrics["sleepScore"] < 60:
        priority = max(priority, 50)
        reasons.append("睡眠质量偏低")
        suggestions.append("今晚可提醒家人早点休息。")
    if not reasons:
        reasons.append("今日状态平稳")
    if not suggestions:
        suggestions.append("继续保持佩戴和每日同步。")
    card_summary = f"{member.get('name') or '家人'}：{reasons[0]}。"
    if priority == 0 and metrics["heartRate"] and metrics["spo2"]:
        card_summary = f"{member.get('name') or '家人'}今天数据整体平稳，心率 {metrics['heartRate']}，血氧 {metrics['spo2']}%。"
    return {
        "carePriority": priority,
        "careReasons": reasons[:3],
        "careSuggestion": suggestions[0],
        "cardSummary": card_summary,
        "metrics": metrics,
    }


def family_home(db: Session, user: dict[str, Any]) -> dict[str, Any]:
    user_id = int(user["id"])
    members = list_members(db, user_id)
    enriched_members = []
    stats = {
        "total": len(members),
        "syncedToday": 0,
        "needAttention": 0,
        "unbound": 0,
        "guardians": 0,
    }
    today = date.today().isoformat()
    for member in members:
        level = _attention_level(member)
        device = device_status(member)
        last_sync = str(device.get("lastSyncTime") or "")
        if last_sync.startswith(today):
            stats["syncedToday"] += 1
        if level in {"unsynced", "attention"}:
            stats["needAttention"] += 1
        if level == "unbound":
            stats["unbound"] += 1
        card_payload = _member_card_payload(db, member, level)
        enriched_members.append(
            {
                **member,
                "careStatus": level,
                "careStatusText": _care_status_text(level),
                **card_payload,
            }
        )
    enriched_members.sort(key=lambda item: int(item.get("carePriority") or 0), reverse=True)
    guardians = list_guardians(db, user_id)
    stats["guardians"] = len(guardians)
    invites = list_invites(db, user)
    pending_invites = [item for item in invites if item.get("status") == INVITE_STATUS["pending"]]
    return {
        "members": enriched_members,
        "guardians": guardians,
        "pendingInviteCount": len(pending_invites),
        "stats": stats,
        "summaryText": _home_summary_text(stats),
    }


def care_reminders(db: Session, user: dict[str, Any]) -> dict[str, Any]:
    user_id = int(user["id"])
    members = list_members(db, user_id)
    reminders: list[dict[str, Any]] = []
    for member in members:
        if str(member.get("status") or "active") != "active":
            continue
        level = _attention_level(member)
        card = _member_card_payload(db, member, level)
        priority = int(card.get("carePriority") or 0)
        if priority < 50:
            continue
        reminder_type = "health_attention"
        if level == "unsynced":
            reminder_type = "device_unsynced"
        elif level == "unbound":
            reminder_type = "device_unbound"
        elif any("电量" in str(reason) for reason in card.get("careReasons") or []):
            reminder_type = "low_battery"
        title = card.get("careReasons", ["需要关注"])[0]
        action_url = f"/pages/family/memberDetail?memberId={member.get('id')}"
        if member.get("relationId"):
            action_url += f"&relationId={member.get('relationId')}"
        reminders.append(
            {
                "memberId": member.get("id"),
                "relationId": member.get("relationId"),
                "memberName": member.get("name") or "家人",
                "type": reminder_type,
                "level": "danger" if priority >= 90 else "warning",
                "priority": priority,
                "title": title,
                "content": card.get("careSuggestion") or "建议打开详情确认今天的健康和设备状态。",
                "summary": card.get("cardSummary"),
                "actionText": "查看详情",
                "actionUrl": action_url,
                "eventTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        )
    reminders.sort(key=lambda item: int(item.get("priority") or 0), reverse=True)
    subscription = care_subscription(db, user_id)
    return {
        "reminders": reminders[:20],
        "unreadCount": len(reminders),
        "subscription": subscription,
        "summaryText": _care_reminder_summary(reminders),
    }


def _care_reminder_summary(reminders: list[dict[str, Any]]) -> str:
    if not reminders:
        return "暂无需要立即处理的照护提醒。"
    top = reminders[0]
    if len(reminders) == 1:
        return f"{top.get('memberName')}有 1 条提醒：{top.get('title')}。"
    return f"当前有 {len(reminders)} 条照护提醒，优先查看{top.get('memberName')}：{top.get('title')}。"


def care_subscription(db: Session, user_id: int) -> dict[str, Any]:
    row = db.execute(
        text("select * from family_care_subscription where user_id=:user_id limit 1"),
        {"user_id": user_id},
    ).first()
    if not row:
        return {"subscribeEnabled": False, "templateIds": [], "lastRequestStatus": {}}
    data = camelize_dict(dict(row._mapping))
    data["subscribeEnabled"] = bool(data.get("subscribeEnabled"))
    data["templateIds"] = _parse_json_list(data.get("templateIds"))
    data["lastRequestStatus"] = _parse_json_dict(data.get("lastRequestStatus"))
    return data


def update_care_subscription(db: Session, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    template_ids = payload.get("templateIds") or payload.get("template_ids") or []
    if not isinstance(template_ids, list):
        template_ids = []
    request_status = payload.get("requestStatus") or payload.get("request_status") or {}
    if not isinstance(request_status, dict):
        request_status = {}
    enabled = bool(payload.get("subscribeEnabled") or payload.get("subscribe_enabled") or request_status)
    db.execute(
        text(
            """
            insert into family_care_subscription(user_id, subscribe_enabled, template_ids, last_request_status)
            values(:user_id, :enabled, :template_ids, :request_status)
            on duplicate key update
              subscribe_enabled=:enabled,
              template_ids=:template_ids,
              last_request_status=:request_status,
              update_time=now()
            """
        ),
        {
            "user_id": user_id,
            "enabled": 1 if enabled else 0,
            "template_ids": json.dumps(template_ids, ensure_ascii=False),
            "request_status": json.dumps(request_status, ensure_ascii=False),
        },
    )
    db.commit()
    return care_subscription(db, user_id)


def list_family_groups(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select *
            from family_group
            where owner_user_id=:user_id and del_flag='0'
            order by update_time desc, id desc
            """
        ),
        {"user_id": user_id},
    ).all()
    groups: list[dict[str, Any]] = []
    for row in rows:
        group = camelize_dict(dict(row._mapping))
        members = db.execute(
            text(
                """
                select gr.id as group_relation_id, gr.relation_id, gr.member_id, gr.role, gr.status,
                       r.display_name, r.relation_type, r.elder_user_id, r.elder_profile_id,
                       m.name as member_name, m.phone, m.status as member_status
                from family_group_relation gr
                join family_relation r on r.id=gr.relation_id and r.del_flag='0'
                left join family_member m on m.relation_id=r.id and m.del_flag=0
                where gr.group_id=:group_id and gr.del_flag='0'
                order by gr.create_time asc
                """
            ),
            {"group_id": group["id"]},
        ).all()
        group_members = []
        for item in members:
            member = camelize_dict(dict(item._mapping))
            _mask_response_phone_fields(member, ("phone",))
            group_members.append(member)
        group["members"] = group_members
        group["memberCount"] = len(group["members"])
        groups.append(group)
    return groups


def create_family_group(db: Session, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    group_name = str(payload.get("groupName") or payload.get("name") or "我的家庭照护组").strip()
    if not group_name:
        raise ValueError("请填写家庭群组名称")
    result = db.execute(
        text(
            """
            insert into family_group(owner_user_id, group_name, description, status)
            values(:user_id, :group_name, :description, 1)
            """
        ),
        {
            "user_id": user_id,
            "group_name": group_name[:64],
            "description": (str(payload.get("description") or "").strip() or None),
        },
    )
    group_id = int(result.lastrowid)
    for relation_id in payload.get("relationIds") or []:
        add_family_group_relation(db, user_id, group_id, int(relation_id), commit=False)
    db.commit()
    return next((item for item in list_family_groups(db, user_id) if int(item["id"]) == group_id), {"id": group_id, "groupName": group_name})


def add_family_group_relation(db: Session, user_id: int, group_id: int, relation_id: int, *, commit: bool = True) -> dict[str, Any]:
    group = db.execute(
        text("select id from family_group where id=:group_id and owner_user_id=:user_id and del_flag='0'"),
        {"group_id": group_id, "user_id": user_id},
    ).first()
    if not group:
        raise ValueError("家庭群组不存在")
    member = member_for_relation(db, user_id, relation_id)
    db.execute(
        text(
            """
            insert into family_group_relation(group_id, relation_id, member_id, role, status, created_by)
            values(:group_id, :relation_id, :member_id, 'elder', 1, :user_id)
            on duplicate key update
              member_id=values(member_id),
              status=1,
              del_flag='0',
              update_time=now()
            """
        ),
        {"group_id": group_id, "relation_id": relation_id, "member_id": member.get("id"), "user_id": user_id},
    )
    if commit:
        db.commit()
    return next((item for item in list_family_groups(db, user_id) if int(item["id"]) == group_id), {"id": group_id})


def submit_assist_request(db: Session, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    relation_id = int(payload.get("relationId") or 0)
    member_id = int(payload.get("memberId") or 0)
    if relation_id:
        member = member_for_relation(db, user_id, relation_id)
        member_id = int(member.get("id") or member_id or 0)
    elif member_id:
        member = require_member(db, user_id, member_id)
        relation_id = int(member.get("relationId") or 0)
    else:
        raise ValueError("请选择需要协助的家人")
    description = str(payload.get("description") or "").strip()
    if len(description) < 4:
        raise ValueError("请简单说明需要协助的内容")
    request_type = str(payload.get("requestType") or "device_bind").strip() or "device_bind"
    result = db.execute(
        text(
            """
            insert into family_assist_request(
              requester_user_id, relation_id, member_id, request_type, status, contact_phone, device_mac, description
            )
            values(:requester_user_id, :relation_id, :member_id, :request_type, 0, :contact_phone, :device_mac, :description)
            """
        ),
        {
            "requester_user_id": user_id,
            "relation_id": relation_id or None,
            "member_id": member_id or None,
            "request_type": request_type[:32],
            "contact_phone": (_normalize_phone(payload.get("contactPhone")) or None),
            "device_mac": (str(payload.get("deviceMac") or "").strip() or None),
            "description": description[:512],
        },
    )
    db.commit()
    return get_assist_request(db, user_id, int(result.lastrowid))


def get_assist_request(db: Session, user_id: int, request_id: int) -> dict[str, Any]:
    row = db.execute(
        text(
            """
            select ar.*, r.display_name, m.name as member_name
            from family_assist_request ar
            left join family_relation r on r.id=ar.relation_id
            left join family_member m on m.id=ar.member_id
            where ar.id=:id and ar.requester_user_id=:user_id and ar.del_flag='0'
            """
        ),
        {"id": request_id, "user_id": user_id},
    ).first()
    if not row:
        raise ValueError("协助请求不存在")
    data = camelize_dict(dict(row._mapping))
    data["statusText"] = {0: "待处理", 1: "处理中", 2: "已完成", 3: "已关闭"}.get(int(data.get("status") or 0), "待处理")
    data["contactPhoneMasked"] = _mask_phone(data.get("contactPhone"))
    _mask_response_phone_fields(data, ("contactPhone",))
    return data


def list_assist_requests(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select ar.*, r.display_name, m.name as member_name
            from family_assist_request ar
            left join family_relation r on r.id=ar.relation_id
            left join family_member m on m.id=ar.member_id
            where ar.requester_user_id=:user_id and ar.del_flag='0'
            order by ar.create_time desc, ar.id desc
            limit 50
            """
        ),
        {"user_id": user_id},
    ).all()
    result: list[dict[str, Any]] = []
    for row in rows:
        data = camelize_dict(dict(row._mapping))
        data["statusText"] = {0: "待处理", 1: "处理中", 2: "已完成", 3: "已关闭"}.get(int(data.get("status") or 0), "待处理")
        data["contactPhoneMasked"] = _mask_phone(data.get("contactPhone"))
        _mask_response_phone_fields(data, ("contactPhone",))
        result.append(data)
    return result


def _parse_json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _parse_json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _care_status_text(level: str) -> str:
    return {
        "normal": "今日已同步",
        "unsynced": "超过 24 小时未同步",
        "attention": "需要关注",
        "unbound": "待绑定设备",
    }.get(level, "待确认")


def _home_summary_text(stats: dict[str, int]) -> str:
    if stats["total"] == 0:
        return "添加父母/家人后，可以远程查看设备状态和健康提醒。"
    if stats["needAttention"] > 0:
        return f"今天有 {stats['needAttention']} 位家人需要关注，请优先查看详情。"
    if stats["unbound"] > 0:
        return f"还有 {stats['unbound']} 位家人未绑定设备，绑定后即可开始守护。"
    return f"今天已有 {stats['syncedToday']} 位家人完成同步，整体状态平稳。"


def list_guardians(db: Session, data_user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select m.id as member_id,
                   m.relation_id,
                   m.name,
                   m.relation,
                   m.permissions,
                   m.status,
                   m.create_time,
                   r.status as relation_status,
                   u.id as guardian_user_id,
                   u.nick_name as guardian_name,
                   u.avatar as guardian_avatar,
                   u.phone as guardian_phone
            from family_member m
            left join family_relation r on r.id=m.relation_id and r.del_flag='0'
            left join app_user u on u.id=m.owner_user_id
            where m.data_user_id=:data_user_id and m.del_flag=0 and m.status in ('active','paused','pending')
            order by m.create_time desc
            """
        ),
        {"data_user_id": data_user_id},
    ).all()
    guardians = []
    for row in rows:
        data = camelize_dict(dict(row._mapping))
        data["permissions"] = _parse_permissions(data.get("permissions"))
        relation_status = data.get("relationStatus")
        if relation_status is not None:
            try:
                data["statusText"] = RELATION_STATUS_TEXT.get(int(relation_status), data.get("status") or "生效")
            except (TypeError, ValueError):
                data["statusText"] = data.get("status") or "生效"
        else:
            data["statusText"] = {
                "active": "生效",
                "paused": "已暂停",
                "pending": "待确认",
            }.get(str(data.get("status") or "active"), "生效")
        data["guardianPhoneMasked"] = _mask_phone(data.get("guardianPhone"))
        _mask_response_phone_fields(data, ("guardianPhone",))
        guardians.append(data)
    return guardians


def create_member(db: Session, owner: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("家人姓名不能为空")
    relation = str(payload.get("relation") or "parent").strip() or "parent"
    phone = str(payload.get("phone") or "").strip() or None
    avatar = str(payload.get("avatar") or "").strip() or None
    linked_user_id = payload.get("linkedUserId") or payload.get("linked_user_id")
    if not linked_user_id and phone:
        existing_user = app_auth.user_by_phone(db, phone)
        if existing_user:
            linked_user_id = existing_user["id"]
    data_user_id = int(linked_user_id) if linked_user_id else _create_shadow_user(db, owner, name, phone)
    elder_profile_id = None
    if not linked_user_id or any(payload.get(key) not in (None, "") for key in ("sex", "birthday", "height", "weight")):
        elder_profile_id = create_elder_profile(
            db,
            int(owner["id"]),
            payload,
            real_user_id=int(linked_user_id) if linked_user_id else None,
        )
    relation_id = create_relation(
        db,
        elder_user_id=data_user_id,
        elder_profile_id=elder_profile_id,
        guardian_user_id=int(owner["id"]),
        display_name=name,
        relation_type=_relation_type_from_member_relation(relation),
        permission_scope=payload.get("permissions"),
        status=RELATION_STATUS["active"],
        source=1,
        remark="created_from_member_api",
    )
    result = db.execute(
        text(
            """
            insert into family_member(
              owner_user_id, linked_user_id, data_user_id, name, relation, phone, avatar,
              permissions, relation_id, elder_profile_id
            )
            values(
              :owner_user_id, :linked_user_id, :data_user_id, :name, :relation, :phone, :avatar,
              :permissions, :relation_id, :elder_profile_id
            )
            """
        ),
        {
            "owner_user_id": owner["id"],
            "linked_user_id": linked_user_id,
            "data_user_id": data_user_id,
            "name": name,
            "relation": relation,
            "phone": phone,
            "avatar": avatar,
            "permissions": _permissions_payload(payload.get("permissions")),
            "relation_id": relation_id,
            "elder_profile_id": elder_profile_id,
        },
    )
    member_id = int(result.lastrowid)
    db.commit()
    return get_member(db, int(owner["id"]), member_id) or {"id": member_id}


def get_member(db: Session, owner_user_id: int, member_id: int) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            select m.*,
                   d.device_mac, d.service_id, d.device_name,
                   dev.battery, dev.last_sync_time
            from family_member m
            left join family_member_device d on d.member_id=m.id and d.del_flag=0 and d.status='active'
            left join device dev on dev.mac=d.device_mac collate utf8mb4_general_ci and dev.del_flag=0
            where m.id=:member_id and m.owner_user_id=:owner_user_id and m.del_flag=0
            limit 1
            """
        ),
        {"owner_user_id": owner_user_id, "member_id": member_id},
    ).first()
    return _member_from_row(row)


def require_member(db: Session, owner_user_id: int, member_id: int) -> dict[str, Any]:
    member = get_member(db, owner_user_id, member_id)
    if not member:
        raise ValueError("家人不存在或无权访问")
    return member


def update_permissions(db: Session, owner_user_id: int, member_id: int, permissions: dict[str, Any]) -> dict[str, Any]:
    member = require_member(db, owner_user_id, member_id)
    can_manage_relation_permissions = True
    if member.get("relationId"):
        relation_row = db.execute(
            text(
                """
                select r.*, p.claim_status
                from family_relation r
                left join elder_profile p on p.id=r.elder_profile_id and p.del_flag='0'
                where r.id=:id and r.del_flag='0'
                limit 1
                """
            ),
            {"id": member["relationId"]},
        ).first()
        if relation_row:
            relation = dict(relation_row._mapping)
            elder_user_id = int(relation.get("elder_user_id") or 0)
            claim_status = int(relation.get("claim_status") or 0)
            can_manage_relation_permissions = elder_user_id == owner_user_id or claim_status == 0
    if not can_manage_relation_permissions:
        raise ValueError("老人已认领档案后，只有老人本人可以调整共享权限")
    db.execute(
        text("update family_member set permissions=:permissions, update_time=now() where id=:id and owner_user_id=:owner_user_id"),
        {"permissions": _permissions_payload(permissions), "id": member_id, "owner_user_id": owner_user_id},
    )
    if member.get("relationId") and can_manage_relation_permissions:
        db.execute(
            text("update family_relation set permission_scope=:permissions, update_time=now() where id=:id"),
            {"permissions": _permissions_payload(permissions), "id": member["relationId"]},
        )
    db.commit()
    return require_member(db, owner_user_id, member_id)


def remove_member(db: Session, owner_user_id: int, member_id: int) -> bool:
    member = require_member(db, owner_user_id, member_id)
    db.execute(text("update family_member set del_flag=2, update_time=now() where id=:id and owner_user_id=:owner_user_id"), {"id": member_id, "owner_user_id": owner_user_id})
    db.execute(text("update family_member_device set del_flag=2, update_time=now() where member_id=:member_id and owner_user_id=:owner_user_id"), {"member_id": member_id, "owner_user_id": owner_user_id})
    if member.get("relationId"):
        db.execute(
            text("update family_relation set status=3, del_flag='2', update_time=now() where id=:id and guardian_user_id=:guardian_user_id"),
            {"id": member["relationId"], "guardian_user_id": owner_user_id},
        )
    db.commit()
    return True


def bind_device(db: Session, owner: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    member_id = int(payload.get("memberId") or payload.get("member_id") or 0)
    member = require_member(db, int(owner["id"]), member_id)
    if str(member.get("status") or "active") != "active":
        raise ValueError("该共享关系已暂停或取消，不能绑定设备")
    mac = str(payload.get("mac") or payload.get("deviceMac") or "").strip()
    if not mac:
        raise ValueError("设备 MAC 不能为空")
    service_id = str(payload.get("serviceId") or payload.get("service_id") or "").strip()
    device_name = str(payload.get("deviceName") or payload.get("device_name") or mac).strip()
    data_user_id = int(member["dataUserId"])
    force_bind = bool(payload.get("forceBind") or payload.get("force_bind") or payload.get("confirmOverride"))
    old_device = db.execute(
        text("select id, user_id, sn from device where mac=:mac and del_flag=0 order by id desc limit 1"),
        {"mac": mac},
    ).first()
    old_device_data = dict(old_device._mapping) if old_device else {}
    active_binding = db.execute(
        text(
            """
            select member_id, owner_user_id, data_user_id
            from family_member_device
            where device_mac=:mac and del_flag=0 and status='active'
            order by update_time desc limit 1
            """
        ),
        {"mac": mac},
    ).first()
    active_binding_data = dict(active_binding._mapping) if active_binding else {}
    bound_user_id = old_device_data.get("user_id") or active_binding_data.get("data_user_id")
    if bound_user_id and int(bound_user_id) != data_user_id and not force_bind:
        raise ValueError("该设备已绑定其他健康档案，请确认后再重新绑定")
    db.execute(
        text(
            """
            insert into device(device_name, device_size, sn, mac, del_flag, create_time, update_time)
            select :device_name, 0, :sn, :mac, 0, now(), now()
            where not exists (
              select 1 from device where mac=:mac and del_flag=0
            )
            """
        ),
        {"device_name": device_name, "sn": mac, "mac": mac},
    )
    db.execute(
        text(
            """
            update family_member_device
            set del_flag=2, status='replaced', update_time=now()
            where device_mac=:mac and del_flag=0
            """
        ),
        {"mac": mac},
    )
    db.execute(
        text(
            """
            insert into family_member_device(member_id, owner_user_id, data_user_id, device_mac, service_id, device_name, bind_by_user_id)
            values(:member_id, :owner_user_id, :data_user_id, :device_mac, :service_id, :device_name, :bind_by_user_id)
            """
        ),
        {
            "member_id": member_id,
            "owner_user_id": owner["id"],
            "data_user_id": data_user_id,
            "device_mac": mac,
            "service_id": service_id,
            "device_name": device_name,
            "bind_by_user_id": owner["id"],
        },
    )
    db.execute(
        text(
            """
            update device
            set user_id=:data_user_id,
                device_name=coalesce(nullif(:device_name,''), device_name),
                update_time=now()
            where mac=:mac and del_flag=0
            """
        ),
        {"data_user_id": data_user_id, "device_name": device_name, "mac": mac},
    )
    updated_device_id = old_device_data.get("id")
    if not updated_device_id:
        updated_device_id = db.execute(text("select id from device where mac=:mac and del_flag=0 order by id desc limit 1"), {"mac": mac}).scalar()
    db.execute(
        text(
            """
            insert into device_bind_log(device_id, device_mac, device_sn, old_user_id, new_user_id, operator_user_id, operator_type, action, reason)
            values(:device_id, :device_mac, :device_sn, :old_user_id, :new_user_id, :operator_user_id, 2, 'bind', :reason)
            """
        ),
        {
            "device_id": updated_device_id,
            "device_mac": mac,
            "device_sn": old_device_data.get("sn") or mac,
            "old_user_id": old_device_data.get("user_id"),
            "new_user_id": data_user_id,
            "operator_user_id": owner["id"],
            "reason": "family_guardian_force_rebind" if force_bind and bound_user_id and int(bound_user_id) != data_user_id else "family_guardian_bind",
        },
    )
    db.commit()
    return require_member(db, int(owner["id"]), member_id)


def resolve_sync_user_id(db: Session, owner_user_id: int, device_mac: str | None) -> int:
    if not device_mac:
        return owner_user_id
    row = db.execute(
        text(
            """
            select data_user_id from family_member_device
            where owner_user_id=:owner_user_id and device_mac=:device_mac
              and del_flag=0 and status='active'
            order by update_time desc limit 1
            """
        ),
        {"owner_user_id": owner_user_id, "device_mac": device_mac},
    ).first()
    return int(row._mapping["data_user_id"]) if row else owner_user_id


def device_status(member: dict[str, Any]) -> dict[str, Any]:
    last_sync = member.get("lastSyncTime")
    is_online = False
    if last_sync:
        try:
            parsed = datetime.strptime(str(last_sync)[:19], "%Y-%m-%d %H:%M:%S")
            is_online = parsed >= datetime.now() - timedelta(hours=24)
        except ValueError:
            is_online = False
    return {
        "mac": member.get("deviceMac"),
        "deviceName": member.get("deviceName"),
        "battery": member.get("battery"),
        "lastSyncTime": last_sync,
        "online": is_online,
    }


def build_alerts(db: Session, member: dict[str, Any], summary: dict[str, Any]) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    device = device_status(member)
    if not device.get("mac"):
        alerts.append({"level": "warning", "alertType": "device_unbound", "title": "尚未绑定设备", "content": "请先为这位家人绑定可穿戴设备。"})
    elif not device.get("online"):
        alerts.append({"level": "warning", "alertType": "device_offline", "title": "设备可能离线", "content": "最近 24 小时没有同步数据，请确认设备是否佩戴或有电。"})
    if device.get("battery") not in (None, ""):
        try:
            battery = float(device["battery"])
            if battery <= 20:
                alerts.append({"level": "warning", "alertType": "low_battery", "title": "设备电量偏低", "content": f"当前电量约 {battery:.0f}%，建议及时充电。", "metricValue": f"{battery:.0f}%"})
        except (TypeError, ValueError):
            pass
    spo2 = summary.get("spo2Avg")
    if spo2:
        try:
            if float(spo2) < 93:
                alerts.append({"level": "danger", "alertType": "low_spo2", "title": "血氧偏低", "content": "今日平均血氧偏低，建议电话确认是否不适。", "metricValue": str(round(float(spo2), 1))})
        except (TypeError, ValueError):
            pass
    heart_rate = summary.get("heartRateAvg")
    if heart_rate:
        try:
            hr = float(heart_rate)
            if hr > 110 or hr < 50:
                alerts.append({"level": "warning", "alertType": "heart_rate", "title": "心率需要关注", "content": "今日平均心率超出常见范围，建议结合实际活动情况确认。", "metricValue": str(round(hr))})
        except (TypeError, ValueError):
            pass
    sleep_score = summary.get("sleepScore")
    if sleep_score is not None:
        try:
            if float(sleep_score) < 60:
                alerts.append({"level": "info", "alertType": "sleep", "title": "睡眠质量偏低", "content": "昨晚睡眠质量偏低，建议关注作息和午间精神状态。", "metricValue": str(round(float(sleep_score)))})
        except (TypeError, ValueError):
            pass
    return alerts


def daily_ai_summary(member: dict[str, Any], summary: dict[str, Any], alerts: list[dict[str, Any]]) -> dict[str, Any]:
    name = member.get("name") or "家人"
    heart_rate = round(float(summary.get("heartRateAvg") or 0))
    spo2 = round(float(summary.get("spo2Avg") or 0))
    sleep_score = round(float(summary.get("sleepScore") or 0))
    motion_score = round(float(summary.get("motionScore") or 0))
    alert_titles = "、".join(item["title"] for item in alerts[:3]) or "暂无明显异常"
    if alerts:
        conclusion = f"{name}今天有 {len(alerts)} 项需要关注：{alert_titles}。"
    else:
        conclusion = f"{name}今天整体状态平稳，暂无明显异常提醒。"
    suggestions = []
    if sleep_score and sleep_score < 70:
        suggestions.append("今晚尽量保持规律作息，睡前减少刺激性活动。")
    if motion_score and motion_score < 60:
        suggestions.append("如身体允许，建议饭后轻量散步。")
    if spo2 and spo2 < 95:
        suggestions.append("建议电话确认是否有胸闷、乏力等不适。")
    if not suggestions:
        suggestions.append("继续保持佩戴和每日同步，便于观察长期趋势。")
    return {
        "title": "AI 今日健康摘要",
        "conclusion": conclusion,
        "metrics": {
            "heartRate": heart_rate or None,
            "spo2": spo2 or None,
            "sleepScore": sleep_score or None,
            "motionScore": motion_score or None,
        },
        "suggestions": suggestions,
        "disclaimer": "AI 建议仅供日常健康管理参考，不能替代医生诊断。如出现明显不适或持续异常，请及时就医。",
    }


def _safe_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def weekly_ai_report(db: Session, member: dict[str, Any]) -> dict[str, Any]:
    return _period_ai_report(db, member, days=7, title="AI 看护周报", period_name="本周")


def monthly_ai_report(db: Session, member: dict[str, Any]) -> dict[str, Any]:
    return _period_ai_report(db, member, days=30, title="AI 看护月报", period_name="本月")


def _period_ai_report(db: Session, member: dict[str, Any], *, days: int, title: str, period_name: str) -> dict[str, Any]:
    if str(member.get("status") or "active") != "active":
        raise ValueError("该共享关系已暂停或取消")
    require_permission(member, "aiSummary")
    data_user_id = int(member["dataUserId"])
    end_day = date.today()
    start_day = end_day - timedelta(days=days - 1)
    rows = db.execute(
        text(
            """
            select record_date, heart_rate_avg, spo2_avg, sleep_score, motion_score,
                   total_steps, health_score
            from health_daily_summary
            where user_id=:user_id and record_date between :start_day and :end_day
            order by record_date asc
            """
        ),
        {"user_id": data_user_id, "start_day": start_day.isoformat(), "end_day": end_day.isoformat()},
    ).all()
    records = [camelize_dict(dict(row._mapping)) for row in rows]
    heart_rates = [value for value in (_safe_float(item.get("heartRateAvg")) for item in records) if value is not None]
    spo2_values = [value for value in (_safe_float(item.get("spo2Avg")) for item in records) if value is not None]
    sleep_scores = [value for value in (_safe_float(item.get("sleepScore")) for item in records) if value is not None]
    motion_scores = [value for value in (_safe_float(item.get("motionScore")) for item in records) if value is not None]
    step_values = [value for value in (_safe_float(item.get("totalSteps")) for item in records) if value is not None]
    metrics = {
        "syncedDays": len(records),
        "totalDays": days,
        "heartRateAvg": _avg(heart_rates),
        "spo2Avg": _avg(spo2_values),
        "sleepScoreAvg": _avg(sleep_scores),
        "motionScoreAvg": _avg(motion_scores),
        "stepsAvg": round(_avg(step_values) or 0) if step_values else None,
    }
    concerns: list[str] = []
    suggestions: list[str] = []
    min_synced_days = 3 if days <= 7 else 12
    if metrics["syncedDays"] < min_synced_days:
        concerns.append(f"{period_name}同步天数偏少")
        suggestions.append("提醒家人每天至少打开小程序同步一次，便于连续观察趋势。")
    if metrics["spo2Avg"] is not None and metrics["spo2Avg"] < 95:
        concerns.append("平均血氧偏低")
        suggestions.append("建议电话确认是否有胸闷、乏力等不适，必要时复测或就医。")
    if metrics["heartRateAvg"] is not None and (metrics["heartRateAvg"] > 100 or metrics["heartRateAvg"] < 55):
        concerns.append("平均心率需要关注")
        suggestions.append("结合活动、情绪和休息情况观察心率变化，持续异常请咨询医生。")
    if metrics["sleepScoreAvg"] is not None and metrics["sleepScoreAvg"] < 70:
        concerns.append("睡眠质量偏低")
        suggestions.append("建议关注晚间作息，睡前减少刺激性活动。")
    if metrics["motionScoreAvg"] is not None and metrics["motionScoreAvg"] < 60:
        concerns.append("活动水平偏低")
        suggestions.append("如身体允许，可安排饭后轻量散步或伸展。")
    if not concerns:
        concerns.append(f"{period_name}整体状态平稳")
    if not suggestions:
        suggestions.append("继续保持佩戴和规律同步，后续可继续观察睡眠、活动和生命体征变化。")
    name = member.get("name") or "家人"
    conclusion = f"{name}{period_name}同步 {metrics['syncedDays']}/{days} 天，{concerns[0]}。"
    return {
        "title": title,
        "period": {"startDate": start_day.isoformat(), "endDate": end_day.isoformat()},
        "conclusion": conclusion,
        "metrics": metrics,
        "concerns": concerns,
        "suggestions": suggestions[:3],
        "records": records,
        "disclaimer": f"{title}仅供日常看护参考，不构成医疗诊断。出现持续异常或明显不适时，请及时就医。",
    }


def filter_summary_by_permissions(summary: dict[str, Any], member: dict[str, Any]) -> dict[str, Any]:
    if not summary:
        return {}
    allowed_keys = {"id", "userId", "recordDate", "healthScore", "healthLevel"}
    if has_permission(member, "vitalSigns"):
        allowed_keys.update({
            "heartRateAvg",
            "heartRateMin",
            "heartRateMax",
            "heartRateScore",
            "spo2Avg",
            "spo2Min",
            "spo2Score",
            "temperatureAvg",
            "temperatureScore",
            "hrvAvg",
            "stressAvg",
            "stressScore",
        })
    if has_permission(member, "sleep"):
        allowed_keys.update({"sleepScore", "sleepDuration", "sleepEfficiency", "sleepStartTime", "sleepEndTime"})
    if has_permission(member, "motion"):
        allowed_keys.update({"motionScore", "totalSteps", "totalCalorie", "totalDistance", "activeTime"})
    return {key: value for key, value in summary.items() if key in allowed_keys}


def filter_health_payload_by_permissions(payload: dict[str, Any], member: dict[str, Any]) -> dict[str, Any]:
    if not payload:
        return {}
    filtered = {
        "dateRange": payload.get("dateRange"),
        "habitScore": payload.get("habitScore"),
    }
    if has_permission(member, "sleep"):
        filtered["sleep"] = payload.get("sleep")
    if has_permission(member, "motion"):
        filtered["activity"] = payload.get("activity")
    return {key: value for key, value in filtered.items() if value is not None}


def member_dashboard(db: Session, member: dict[str, Any], health_index_payload) -> dict[str, Any]:
    if str(member.get("status") or "active") != "active":
        raise ValueError("该共享关系已暂停或取消")
    data_user_id = int(member["dataUserId"])
    payload = filter_health_payload_by_permissions(health_index_payload(db, data_user_id), member)
    today_summary = db.execute(
        text("select * from health_daily_summary where user_id=:user_id and record_date=:record_date limit 1"),
        {"user_id": data_user_id, "record_date": date.today().isoformat()},
    ).first()
    raw_summary = camelize_dict(dict(today_summary._mapping)) if today_summary else {}
    summary = filter_summary_by_permissions(raw_summary, member)
    alerts = build_alerts(db, member, raw_summary) if has_permission(member, "alerts") else []
    return {
        "member": member,
        "device": device_status(member) if has_permission(member, "deviceStatus") else {},
        "health": payload,
        "summary": summary,
        "alerts": alerts,
        "aiSummary": daily_ai_summary(member, raw_summary, alerts) if has_permission(member, "aiSummary") else None,
    }


def list_elder_relations(db: Session, guardian_user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select r.*,
                   m.id as member_id,
                   m.phone,
                   d.device_mac,
                   d.device_name,
                   dev.battery,
                   dev.last_sync_time,
                   p.name as profile_name,
                   p.claim_status
            from family_relation r
            left join family_member m on m.relation_id=r.id and m.del_flag=0
            left join family_member_device d on d.member_id=m.id and d.del_flag=0 and d.status='active'
            left join device dev on dev.mac=d.device_mac collate utf8mb4_general_ci and dev.del_flag=0
            left join elder_profile p on p.id=r.elder_profile_id and p.del_flag='0'
            where r.guardian_user_id=:guardian_user_id and r.del_flag='0'
            order by r.create_time desc
            """
        ),
        {"guardian_user_id": guardian_user_id},
    ).all()
    result = []
    for row in rows:
        data = _relation_from_row(row)
        if not data:
            continue
        data["displayName"] = data.get("displayName") or data.get("profileName") or "家人"
        data["lastSyncTime"] = data.get("lastSyncTime")
        data["deviceBattery"] = data.get("battery")
        data["careStatus"] = _care_status_text(_attention_level({
            "deviceMac": data.get("deviceMac"),
            "battery": data.get("battery"),
            "lastSyncTime": data.get("lastSyncTime"),
        }))
        result.append(data)
    return result


def member_for_relation(db: Session, guardian_user_id: int, relation_id: int) -> dict[str, Any]:
    row = db.execute(
        text(
            """
            select id from family_member
            where relation_id=:relation_id and owner_user_id=:guardian_user_id and del_flag=0
            order by id desc limit 1
            """
        ),
        {"relation_id": relation_id, "guardian_user_id": guardian_user_id},
    ).first()
    if not row:
        raise ValueError("共享关系不存在或无权访问")
    return require_member(db, guardian_user_id, int(row._mapping["id"]))


def create_elder_profile_with_relation(db: Session, owner: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    member = create_member(
        db,
        owner,
        {
            "name": payload.get("name"),
            "phone": payload.get("phone"),
            "relation": payload.get("relation") or payload.get("relationType") or "parent",
            "sex": payload.get("sex"),
            "birthday": payload.get("birthday"),
            "height": payload.get("height"),
            "weight": payload.get("weight"),
        },
    )
    return {
        "memberId": member.get("id"),
        "relationId": member.get("relationId"),
        "elderProfileId": member.get("elderProfileId"),
        "elderUserId": member.get("dataUserId"),
    }


def search_users(db: Session, phone: str) -> dict[str, Any] | None:
    normalized = str(phone or "").strip()
    if len(normalized) < 7:
        raise ValueError("请输入完整手机号")
    user = app_auth.user_by_phone(db, normalized)
    if not user:
        return None
    nick = str(user.get("nickName") or user.get("nick_name") or "用户")
    return {
        "userId": user["id"],
        "nickName": nick[:1] + "*" if len(nick) > 1 else nick,
        "avatar": user.get("avatar"),
        "phoneMasked": _mask_phone(normalized),
    }


def _new_invite_code(db: Session) -> str:
    for _ in range(10):
        code = "FAM" + secrets.token_hex(3).upper()
        exists = db.execute(text("select id from family_invite where invite_code=:code limit 1"), {"code": code}).scalar()
        if not exists:
            return code
    return "FAM" + secrets.token_hex(5).upper()


def create_invite(db: Session, inviter_user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    invite_type = int(payload.get("inviteType") or payload.get("invite_type") or 1)
    target_phone = _normalize_phone(payload.get("targetPhone") or payload.get("target_phone")) or None
    if target_phone and len(target_phone) != 11:
        raise ValueError("请输入正确的邀请手机号")
    elder_user_id = payload.get("elderUserId") or payload.get("elder_user_id")
    elder_profile_id = payload.get("elderProfileId") or payload.get("elder_profile_id")
    relation_id = payload.get("relationId") or payload.get("relation_id")
    if relation_id and not elder_user_id and not elder_profile_id:
        relation = db.execute(text("select elder_user_id, elder_profile_id from family_relation where id=:id and del_flag='0'"), {"id": relation_id}).first()
        if relation:
            elder_user_id = relation._mapping["elder_user_id"]
            elder_profile_id = relation._mapping["elder_profile_id"]
    code = _new_invite_code(db)
    expire = datetime.now() + timedelta(days=7)
    db.execute(
        text(
            """
            insert into family_invite(
              invite_code, inviter_user_id, elder_user_id, elder_profile_id,
              relation_id, invite_type, target_phone, status, expire_time
            )
            values(
              :invite_code, :inviter_user_id, :elder_user_id, :elder_profile_id,
              :relation_id, :invite_type, :target_phone, 0, :expire_time
            )
            """
        ),
        {
            "invite_code": code,
            "inviter_user_id": inviter_user_id,
            "elder_user_id": elder_user_id,
            "elder_profile_id": elder_profile_id,
            "relation_id": relation_id,
            "invite_type": invite_type,
            "target_phone": target_phone,
            "expire_time": expire.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )
    db.commit()
    return {"inviteCode": code, "expireTime": expire.strftime("%Y-%m-%d %H:%M:%S")}


def _normalize_phone(value: Any) -> str:
    return "".join(ch for ch in str(value or "").strip() if ch.isdigit())


def _mask_phone(value: Any) -> str:
    phone = _normalize_phone(value)
    if len(phone) >= 7:
        return f"{phone[:3]}****{phone[-4:]}"
    return "***" if phone else ""


def _mask_response_phone_fields(data: dict[str, Any], keys: tuple[str, ...]) -> None:
    for key in keys:
        if key not in data:
            continue
        masked = _mask_phone(data.get(key))
        if masked:
            data[f"{key}Masked"] = masked
            data[key] = masked


def _assert_invite_target(db: Session, current_user_id: int, invite: dict[str, Any]) -> None:
    target_phone = _normalize_phone(invite.get("target_phone"))
    if not target_phone:
        return
    row = db.execute(
        text("select phone from app_user where id=:id and del_flag=0 limit 1"),
        {"id": current_user_id},
    ).first()
    current_phone = _normalize_phone(row._mapping["phone"] if row else "")
    if current_phone != target_phone:
        raise ValueError("该邀请仅限指定手机号接受")


def handle_invite(db: Session, current_user_id: int, invite_code: str, accept: bool) -> dict[str, Any]:
    row = db.execute(text("select * from family_invite where invite_code=:code limit 1"), {"code": invite_code}).first()
    if not row:
        raise ValueError("邀请不存在")
    invite = dict(row._mapping)
    if int(invite.get("status") or 0) != INVITE_STATUS["pending"]:
        raise ValueError("邀请已处理")
    expire_time = invite.get("expire_time")
    if expire_time and datetime.strptime(str(expire_time)[:19], "%Y-%m-%d %H:%M:%S") < datetime.now():
        db.execute(text("update family_invite set status=3 where id=:id"), {"id": invite["id"]})
        db.commit()
        raise ValueError("邀请已过期")
    _assert_invite_target(db, current_user_id, invite)
    if not accept:
        db.execute(text("update family_invite set status=2, invitee_user_id=:user_id where id=:id"), {"id": invite["id"], "user_id": current_user_id})
        db.commit()
        return {"inviteCode": invite_code, "status": "rejected"}
    relation_id = invite.get("relation_id")
    if not relation_id:
        if int(invite.get("invite_type") or 1) == 1:
            relation_id = create_relation(
                db,
                elder_user_id=invite.get("elder_user_id") or invite.get("inviter_user_id"),
                elder_profile_id=invite.get("elder_profile_id"),
                guardian_user_id=current_user_id,
                display_name="家人",
                relation_type="child",
                status=RELATION_STATUS["active"],
                source=2,
                remark="accepted_invite",
            )
            _ensure_member_for_relation(db, int(relation_id))
        else:
            relation_id = create_relation(
                db,
                elder_user_id=current_user_id,
                elder_profile_id=invite.get("elder_profile_id"),
                guardian_user_id=int(invite["inviter_user_id"]),
                display_name="家人",
                relation_type="child",
                status=RELATION_STATUS["active"],
                source=2,
                remark="accepted_invite",
            )
    elif int(invite.get("invite_type") or 1) == 1:
        _ensure_member_for_relation(db, int(relation_id))
    db.execute(
        text("update family_invite set status=1, invitee_user_id=:user_id, relation_id=:relation_id, accept_time=now() where id=:id"),
        {"id": invite["id"], "user_id": current_user_id, "relation_id": relation_id},
    )
    db.commit()
    return {"inviteCode": invite_code, "status": "accepted", "relationId": int(relation_id)}


def _ensure_member_for_relation(db: Session, relation_id: int) -> int | None:
    row = db.execute(
        text(
            """
            select r.*, elder.phone as elder_phone, elder.nick_name as elder_nick_name,
                   p.name as profile_name, p.phone as profile_phone
            from family_relation r
            left join app_user elder on elder.id=r.elder_user_id
            left join elder_profile p on p.id=r.elder_profile_id and p.del_flag='0'
            where r.id=:relation_id and r.del_flag='0'
            limit 1
            """
        ),
        {"relation_id": relation_id},
    ).first()
    if not row:
        return None
    relation = dict(row._mapping)
    guardian_user_id = int(relation["guardian_user_id"])
    elder_user_id = relation.get("elder_user_id")
    if not elder_user_id:
        return None
    existing = db.execute(
        text(
            """
            select id from family_member
            where relation_id=:relation_id and owner_user_id=:owner_user_id and del_flag=0
            order by id desc limit 1
            """
        ),
        {"relation_id": relation_id, "owner_user_id": guardian_user_id},
    ).scalar()
    if existing:
        return int(existing)
    name = (
        relation.get("display_name")
        or relation.get("profile_name")
        or relation.get("elder_nick_name")
        or "家人"
    )
    phone = relation.get("profile_phone") or relation.get("elder_phone")
    result = db.execute(
        text(
            """
            insert into family_member(
              owner_user_id, linked_user_id, data_user_id, name, relation, phone,
              permissions, relation_id, elder_profile_id, status
            )
            values(
              :owner_user_id, :linked_user_id, :data_user_id, :name, :relation, :phone,
              :permissions, :relation_id, :elder_profile_id, :status
            )
            """
        ),
        {
            "owner_user_id": guardian_user_id,
            "linked_user_id": elder_user_id,
            "data_user_id": elder_user_id,
            "name": str(name)[:64],
            "relation": "parent",
            "phone": phone,
            "permissions": relation.get("permission_scope") or _permissions_payload(),
            "relation_id": relation_id,
            "elder_profile_id": relation.get("elder_profile_id"),
            "status": _status_from_relation_status(int(relation.get("status") or RELATION_STATUS["active"])),
        },
    )
    return int(result.lastrowid)


def update_relation(db: Session, current_user_id: int, relation_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    row = db.execute(
        text(
            """
            select r.*, p.claim_status
            from family_relation r
            left join elder_profile p on p.id=r.elder_profile_id and p.del_flag='0'
            where r.id=:id and r.del_flag='0'
            limit 1
            """
        ),
        {"id": relation_id},
    ).first()
    if not row:
        raise ValueError("共享关系不存在")
    relation = dict(row._mapping)
    if int(relation["guardian_user_id"]) != current_user_id and int(relation.get("elder_user_id") or 0) != current_user_id:
        raise ValueError("无权修改该共享关系")
    status = payload.get("status")
    permissions = payload.get("permissionScope") or payload.get("permissions")
    display_name = payload.get("displayName")
    elder_user_id = int(relation.get("elder_user_id") or 0)
    claim_status = int(relation.get("claim_status") or 0)
    is_elder = elder_user_id == current_user_id
    is_unclaimed_guardian = int(relation["guardian_user_id"]) == current_user_id and claim_status == 0
    can_manage_authorization = is_elder or is_unclaimed_guardian
    if isinstance(permissions, dict) and not can_manage_authorization:
        raise ValueError("老人已认领档案后，只有老人本人可以调整共享权限")
    if status and _status_to_relation_status(status) != RELATION_STATUS["cancelled"] and not can_manage_authorization:
        raise ValueError("老人已认领档案后，只有老人本人可以暂停或恢复共享")
    db.execute(
        text(
            """
            update family_relation
            set status=coalesce(:status, status),
                display_name=coalesce(:display_name, display_name),
                permission_scope=coalesce(:permission_scope, permission_scope),
                update_time=now()
            where id=:id
            """
        ),
        {
            "id": relation_id,
            "status": _status_to_relation_status(status) if status else None,
            "display_name": str(display_name).strip() if display_name else None,
            "permission_scope": _permissions_payload(permissions) if isinstance(permissions, dict) else None,
        },
    )
    if permissions and isinstance(permissions, dict):
        db.execute(
            text("update family_member set permissions=:permissions, update_time=now() where relation_id=:relation_id"),
            {"permissions": _permissions_payload(permissions), "relation_id": relation_id},
        )
    if status:
        db.execute(
            text("update family_member set status=:status, update_time=now() where relation_id=:relation_id"),
            {"status": _status_from_relation_status(_status_to_relation_status(status)), "relation_id": relation_id},
        )
    db.commit()
    updated = db.execute(text("select * from family_relation where id=:id"), {"id": relation_id}).first()
    return _relation_from_row(updated) or {"id": relation_id}


def delete_relation(db: Session, current_user_id: int, relation_id: int) -> bool:
    update_relation(db, current_user_id, relation_id, {"status": "cancelled"})
    db.execute(text("update family_relation set del_flag='2', update_time=now() where id=:id"), {"id": relation_id})
    db.execute(text("update family_member set del_flag=2, update_time=now() where relation_id=:id"), {"id": relation_id})
    db.commit()
    return True


def _invite_from_row(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    data = camelize_dict(dict(row._mapping))
    data["statusText"] = {
        INVITE_STATUS["pending"]: "待接受",
        INVITE_STATUS["accepted"]: "已接受",
        INVITE_STATUS["rejected"]: "已拒绝",
        INVITE_STATUS["expired"]: "已过期",
        INVITE_STATUS["cancelled"]: "已取消",
    }.get(int(data.get("status") or 0), "待接受")
    target_phone_masked = _mask_phone(data.get("targetPhone"))
    data["targetPhoneMasked"] = target_phone_masked
    if target_phone_masked:
        data["targetPhone"] = target_phone_masked
    return data


def expire_pending_invites(db: Session) -> int:
    result = db.execute(
        text(
            """
            update family_invite
            set status=:expired
            where status=:pending and expire_time < now()
            """
        ),
        {"expired": INVITE_STATUS["expired"], "pending": INVITE_STATUS["pending"]},
    )
    count = int(result.rowcount or 0)
    if count:
        db.commit()
    return count


def list_invites(db: Session, user: dict[str, Any]) -> list[dict[str, Any]]:
    expire_pending_invites(db)
    user_id = int(user["id"])
    phone = str(user.get("phone") or "").strip()
    rows = db.execute(
        text(
            """
            select i.*,
                   inviter.nick_name as inviter_name,
                   invitee.nick_name as invitee_name,
                   p.name as elder_profile_name,
                   r.display_name as relation_name
            from family_invite i
            left join app_user inviter on inviter.id=i.inviter_user_id
            left join app_user invitee on invitee.id=i.invitee_user_id
            left join elder_profile p on p.id=i.elder_profile_id
            left join family_relation r on r.id=i.relation_id
            where i.inviter_user_id=:user_id
               or i.invitee_user_id=:user_id
               or (:phone <> '' and i.target_phone=:phone)
            order by i.create_time desc
            limit 100
            """
        ),
        {"user_id": user_id, "phone": phone},
    ).all()
    result = []
    for row in rows:
        item = _invite_from_row(row)
        if not item:
            continue
        result.append(item)
    return result


def claim_elder_profile(db: Session, current_user: dict[str, Any], profile_id: int) -> dict[str, Any]:
    current_user_id = int(current_user["id"])
    profile_row = db.execute(
        text("select * from elder_profile where id=:id and del_flag='0' limit 1"),
        {"id": profile_id},
    ).first()
    if not profile_row:
        raise ValueError("老人档案不存在")
    profile = dict(profile_row._mapping)
    real_user_id = profile.get("real_user_id")
    if real_user_id and int(real_user_id) not in (0, current_user_id):
        raise ValueError("该老人档案已被其他账号认领")
    old_user_ids = {
        int(value)
        for value in (
            profile.get("real_user_id"),
            db.execute(text("select elder_user_id from family_relation where elder_profile_id=:id and elder_user_id is not null limit 1"), {"id": profile_id}).scalar(),
            db.execute(text("select data_user_id from family_member where elder_profile_id=:id and del_flag=0 limit 1"), {"id": profile_id}).scalar(),
        )
        if value
    }
    db.execute(
        text(
            """
            update elder_profile
            set real_user_id=:current_user_id, claim_status=1, update_time=now()
            where id=:profile_id
            """
        ),
        {"current_user_id": current_user_id, "profile_id": profile_id},
    )
    db.execute(
        text(
            """
            update family_relation
            set elder_user_id=:current_user_id, update_time=now()
            where elder_profile_id=:profile_id and del_flag='0'
            """
        ),
        {"current_user_id": current_user_id, "profile_id": profile_id},
    )
    db.execute(
        text(
            """
            update family_member
            set linked_user_id=:current_user_id, data_user_id=:current_user_id, update_time=now()
            where elder_profile_id=:profile_id and del_flag=0
            """
        ),
        {"current_user_id": current_user_id, "profile_id": profile_id},
    )
    db.execute(
        text(
            """
            update family_member_device d
            join family_member m on m.id=d.member_id
            set d.data_user_id=:current_user_id, d.update_time=now()
            where m.elder_profile_id=:profile_id and d.del_flag=0
            """
        ),
        {"current_user_id": current_user_id, "profile_id": profile_id},
    )
    old_ids_for_devices = list(old_user_ids - {current_user_id})
    if old_ids_for_devices:
        db.execute(
            text(
                """
                update device
                set user_id=:current_user_id, update_time=now()
                where user_id in :old_user_ids and del_flag=0
                """
            ).bindparams(bindparam("old_user_ids", expanding=True)),
            {"current_user_id": current_user_id, "old_user_ids": old_ids_for_devices},
        )
    db.commit()
    return {
        "elderProfileId": profile_id,
        "elderUserId": current_user_id,
        "migratedFromUserIds": sorted(old_user_ids),
    }
