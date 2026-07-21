import secrets
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import engine
from app.services.crud import camelize_dict

STATUS_PENDING = 0
STATUS_APPROVED = 1
STATUS_REJECTED = 2
INVITE_UNUSED = 0
INVITE_USED = 1

STATUS_TEXT = {
    -1: "未申请",
    STATUS_PENDING: "待审核",
    STATUS_APPROVED: "已通过",
    STATUS_REJECTED: "已拒绝",
}


def initialize_schema() -> None:
    with engine.begin() as connection:
        connection.execute(text(
            """
            create table if not exists ai_lab_apply (
              id bigint not null auto_increment,
              user_id bigint not null,
              status tinyint not null default 0,
              remark varchar(500) default null,
              jump_url varchar(500) default null,
              invite_code_id bigint default null,
              apply_time datetime default null,
              audit_time datetime default null,
              audit_by bigint default null,
              del_flag tinyint not null default 0,
              create_time datetime default current_timestamp,
              update_time datetime default current_timestamp on update current_timestamp,
              primary key (id),
              unique key uk_user_id (user_id)
            ) engine=InnoDB default charset=utf8mb4 comment='AI实验室申请表'
            """
        ))
        apply_columns = {
            row[0] for row in connection.execute(text(
                "select column_name from information_schema.columns where table_schema=database() and table_name='ai_lab_apply'"
            )).all()
        }
        if "jump_url" not in apply_columns:
            connection.execute(text("alter table ai_lab_apply add column jump_url varchar(500) default null after remark"))
        if "invite_code_id" not in apply_columns:
            connection.execute(text("alter table ai_lab_apply add column invite_code_id bigint default null after jump_url"))
        connection.execute(text("update ai_lab_apply set del_flag=0 where del_flag is null"))
        connection.execute(text("alter table ai_lab_apply modify column del_flag tinyint not null default 0"))
        connection.execute(text(
            """
            create table if not exists ai_lab_invite_code (
              id bigint not null auto_increment,
              code varchar(20) not null,
              jump_url varchar(500) not null,
              status tinyint not null default 0,
              used_user_id bigint default null,
              used_time datetime default null,
              create_time datetime default current_timestamp,
              update_time datetime default current_timestamp on update current_timestamp,
              primary key (id),
              unique key uk_code (code)
            ) engine=InnoDB default charset=utf8mb4 comment='AI实验室邀请码表'
            """
        ))
        invite_columns = {
            row[0] for row in connection.execute(text(
                "select column_name from information_schema.columns where table_schema=database() and table_name='ai_lab_invite_code'"
            )).all()
        }
        if "jump_url" not in invite_columns:
            connection.execute(text("alter table ai_lab_invite_code add column jump_url varchar(500) default null after code"))
        connection.execute(text(
            """
            insert ignore into sys_menu(
              menu_id, menu_name, parent_id, order_num, path, component, query, route_name,
              is_frame, is_cache, menu_type, visible, status, perms, icon,
              create_by, create_time, update_by, update_time, remark
            ) values(
              1071, '审核管理', 1, 12, 'aiLab', 'system/aiLab/index', null, 'aiLab',
              1, 1, 'C', '0', '0', '', 'edit',
              'admin', '2026-04-21 21:30:00', 'admin', '2026-04-21 21:30:00', ''
            )
            """
        ))


def _serialize(row: Any) -> dict[str, Any] | None:
    return camelize_dict(dict(row._mapping)) if row else None


def _status_text(status: int | None) -> str:
    return STATUS_TEXT.get(status if status is not None else -1, "未知")


def _apply_row(db: Session, user_id: int) -> Any:
    return db.execute(
        text("select * from ai_lab_apply where user_id=:user_id order by id desc limit 1"),
        {"user_id": user_id},
    ).first()


def _status_payload(row: Any, user_id: int) -> dict[str, Any]:
    if not row:
        return {"userId": user_id, "status": -1, "statusText": _status_text(-1)}
    item = _serialize(row) or {}
    status = int(item.get("status", -1))
    payload = {
        "userId": user_id,
        "status": status,
        "statusText": _status_text(status),
        "applyTime": item.get("applyTime"),
        "auditTime": item.get("auditTime"),
        "remark": item.get("remark"),
    }
    if status == STATUS_APPROVED:
        payload["jumpUrl"] = item.get("jumpUrl")
    return payload


def get_status(db: Session, user_id: int) -> dict[str, Any]:
    return _status_payload(_apply_row(db, user_id), user_id)


def _use_invite_code(db: Session, user_id: int, invite_code: str, apply_id: int | None = None) -> None:
    row = db.execute(
        text("select * from ai_lab_invite_code where code=:code for update"),
        {"code": invite_code},
    ).first()
    if not row:
        raise ValueError("邀请码无效")
    item = _serialize(row) or {}
    if int(item.get("status") or 0) == INVITE_USED:
        raise ValueError("邀请码已被使用")
    if not str(item.get("jumpUrl") or "").strip():
        raise ValueError("邀请码跳转地址不能为空")
    now = datetime.now()
    db.execute(
        text("update ai_lab_invite_code set status=1, used_user_id=:user_id, used_time=:now where id=:id"),
        {"user_id": user_id, "now": now, "id": item["id"]},
    )
    values = {
        "user_id": user_id,
        "status": STATUS_APPROVED,
        "jump_url": item["jumpUrl"],
        "invite_code_id": item["id"],
        "now": now,
    }
    if apply_id:
        values["id"] = apply_id
        db.execute(text(
            """
            update ai_lab_apply
            set status=:status, jump_url=:jump_url, invite_code_id=:invite_code_id,
                audit_time=:now, audit_by=null, remark=null, del_flag=0
            where id=:id
            """
        ), values)
    else:
        db.execute(text(
            """
            insert into ai_lab_apply(user_id, status, jump_url, invite_code_id, apply_time, audit_time, audit_by, del_flag)
            values(:user_id, :status, :jump_url, :invite_code_id, :now, :now, null, 0)
            """
        ), values)


def apply(db: Session, user_id: int, invite_code: str | None) -> dict[str, Any]:
    invite_code = str(invite_code or "").strip()
    existing = _apply_row(db, user_id)
    if existing:
        item = _serialize(existing) or {}
        status = int(item.get("status") or 0)
        active = int(item.get("delFlag") or 0) == 0
        if status == STATUS_APPROVED and active:
            return get_status(db, user_id)
        if status == STATUS_PENDING and active:
            if not invite_code:
                return get_status(db, user_id)
            _use_invite_code(db, user_id, invite_code, int(item["id"]))
            db.commit()
            return get_status(db, user_id)
        db.execute(text("delete from ai_lab_apply where id=:id"), {"id": item["id"]})
    if invite_code:
        _use_invite_code(db, user_id, invite_code)
    else:
        db.execute(
            text("insert into ai_lab_apply(user_id, status, apply_time, del_flag) values(:user_id, 0, now(), 0)"),
            {"user_id": user_id},
        )
    db.commit()
    return get_status(db, user_id)


def _apply_detail(db: Session, row: Any) -> dict[str, Any]:
    item = _serialize(row) or {}
    item["statusText"] = _status_text(int(item.get("status", -1)))
    user = db.execute(text("select nick_name, phone, avatar from app_user where id=:id"), {"id": item["userId"]}).first()
    if user:
        item.update(_serialize(user) or {})
    if item.get("inviteCodeId"):
        item["inviteCode"] = db.execute(
            text("select code from ai_lab_invite_code where id=:id"),
            {"id": item["inviteCodeId"]},
        ).scalar()
    if item.get("auditBy"):
        item["auditByName"] = db.execute(
            text("select nick_name from sys_user where user_id=:id"),
            {"id": item["auditBy"]},
        ).scalar()
    return item


def list_applications(db: Session, filters: dict[str, Any], page_num: int, page_size: int) -> tuple[list[dict[str, Any]], int]:
    clauses = ["del_flag=0"]
    params: dict[str, Any] = {"limit": page_size, "offset": max(page_num - 1, 0) * page_size}
    for key, column in (("userId", "user_id"), ("status", "status")):
        if filters.get(key) not in (None, ""):
            clauses.append(f"{column}=:{column}")
            params[column] = filters[key]
    if filters.get("applyTimeStart") and filters.get("applyTimeEnd"):
        clauses.append("apply_time >= :start_time and apply_time < date_add(:end_time, interval 1 day)")
        params.update({"start_time": filters["applyTimeStart"], "end_time": filters["applyTimeEnd"]})
    where = " and ".join(clauses)
    total = db.execute(text(f"select count(*) from ai_lab_apply where {where}"), params).scalar() or 0
    rows = db.execute(text(f"select * from ai_lab_apply where {where} order by apply_time desc limit :limit offset :offset"), params).all()
    return [_apply_detail(db, row) for row in rows], int(total)


def get_application(db: Session, apply_id: int) -> dict[str, Any] | None:
    row = db.execute(text("select * from ai_lab_apply where id=:id and del_flag=0"), {"id": apply_id}).first()
    return _apply_detail(db, row) if row else None


def audit(db: Session, apply_id: int, status: int, audit_by: int, jump_url: str | None, remark: str | None) -> None:
    if status not in (STATUS_APPROVED, STATUS_REJECTED):
        raise ValueError("审核状态只能为 1 或 2")
    if status == STATUS_APPROVED and not str(jump_url or "").strip():
        raise ValueError("请填写跳转地址")
    if status == STATUS_REJECTED and not str(remark or "").strip():
        raise ValueError("请填写拒绝原因")
    result = db.execute(text(
        """
        update ai_lab_apply
        set status=:status, audit_time=now(), audit_by=:audit_by, jump_url=:jump_url, remark=:remark
        where id=:id and del_flag=0
        """
    ), {"id": apply_id, "status": status, "audit_by": audit_by, "jump_url": jump_url, "remark": remark})
    if not result.rowcount:
        db.rollback()
        raise ValueError("申请记录不存在")
    db.commit()


def list_invite_codes(db: Session, page_num: int, page_size: int) -> tuple[list[dict[str, Any]], int]:
    params = {"limit": page_size, "offset": max(page_num - 1, 0) * page_size}
    total = db.execute(text("select count(*) from ai_lab_invite_code")).scalar() or 0
    rows = db.execute(text("select * from ai_lab_invite_code order by create_time desc limit :limit offset :offset"), params).all()
    result = []
    for row in rows:
        item = _serialize(row) or {}
        item["statusText"] = "已使用" if int(item.get("status") or 0) == INVITE_USED else "未使用"
        result.append(item)
    return result, int(total)


def add_invite_codes(db: Session, codes: list[str], jump_url: str) -> None:
    clean_codes = [str(code).strip() for code in codes if str(code).strip()]
    if not clean_codes:
        raise ValueError("邀请码不能为空")
    if not str(jump_url or "").strip():
        raise ValueError("跳转地址不能为空")
    if len(clean_codes) != len(set(clean_codes)):
        raise ValueError("邀请码不能重复")
    for code in clean_codes:
        if len(code) > 20:
            raise ValueError(f"邀请码 {code} 长度不能超过 20")
        if db.execute(text("select count(*) from ai_lab_invite_code where code=:code"), {"code": code}).scalar():
            raise ValueError(f"邀请码 {code} 已存在")
        db.execute(
            text("insert into ai_lab_invite_code(code, jump_url, status) values(:code, :jump_url, 0)"),
            {"code": code, "jump_url": jump_url},
        )
    db.commit()


def generate_invite_codes(db: Session, count: int, jump_url: str) -> list[str]:
    if not 1 <= count <= 1000:
        raise ValueError("单次最多生成 1000 个邀请码")
    if not str(jump_url or "").strip():
        raise ValueError("跳转地址不能为空")
    codes = []
    for _ in range(count):
        for _attempt in range(10):
            code = f"{secrets.randbelow(1_000_000):06d}"
            if not db.execute(text("select count(*) from ai_lab_invite_code where code=:code"), {"code": code}).scalar():
                db.execute(
                    text("insert into ai_lab_invite_code(code, jump_url, status) values(:code, :jump_url, 0)"),
                    {"code": code, "jump_url": jump_url},
                )
                codes.append(code)
                break
        else:
            db.rollback()
            raise ValueError("生成邀请码失败，请稍后重试")
    db.commit()
    return codes


def delete_invite_code(db: Session, invite_id: int) -> None:
    result = db.execute(text("delete from ai_lab_invite_code where id=:id"), {"id": invite_id})
    db.commit()
    if not result.rowcount:
        raise ValueError("邀请码不存在")
