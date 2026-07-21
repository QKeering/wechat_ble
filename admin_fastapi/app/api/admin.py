import csv
import io
import json
import re
import zipfile
from typing import Any

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from redis import Redis
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.core.responses import error, not_migrated, success, table
from app.core.security import read_request_token
from app.db.redis import get_redis
from app.db.session import get_db
from app.services import admin_backup, ai_lab, auth, code_generator, feedback, server_monitor, system
from app.services.crud import camelize_dict, create_row, delete_rows, get_row, list_rows, update_row
from app.services.device_import import device_template_xlsx, import_device_xlsx
from app.services.device_qrcode import ensure_payload_qrcode, ensure_rows_qrcode
from app.services.system_user_import import import_system_users_xlsx, system_user_template_xlsx

router = APIRouter(prefix="/admin", tags=["admin"])


CRUD_RESOURCES: dict[str, dict[str, Any]] = {
    "device": {
        "table": "device",
        "like": {"deviceName", "sn", "mac"},
        # Keep compatibility with clients that name the field after device_mac.
        "aliases": {"deviceMac": "mac", "macAddress": "mac"},
    },
    "device/model": {"table": "device_model", "like": {"modelKey", "modelName"}},
    "device/ota": {"table": "ota_package", "like": {"versionCode", "deviceModel", "description"}},
    "fqaGuid": {"table": "fqa_guid", "like": {"title", "content"}},
    "sysConfiguration": {"table": "sys_configuration", "like": {"name", "keyName"}},
    "user": {"table": "app_user", "like": {"phone", "nickName"}},
    "user/log": {"table": "user_log", "like": {"nickname", "deviceMac", "logMsg"}},
    "user/healthData": {"table": "health_daily_summary", "like": {"deviceMac", "healthLevel"}},
    "family/relation": {"table": "family_relation", "like": {"displayName", "relationType", "remark"}},
    "family/invite": {"table": "family_invite", "like": {"inviteCode", "targetPhone"}},
    "family/elderProfile": {"table": "elder_profile", "like": {"name", "phone"}},
    "family/deviceBindLog": {"table": "device_bind_log", "like": {"deviceMac", "deviceSn", "action", "reason"}},
    "family/relationAudit": {"table": "family_relation_audit", "like": {"action", "reason", "operatorName"}},
    "family/member": {"table": "family_member", "like": {"name", "phone", "relation", "status"}},
    "family/group": {"table": "family_group", "like": {"groupName", "description"}},
    "family/groupRelation": {"table": "family_group_relation", "like": {"role"}},
    "family/assistRequest": {"table": "family_assist_request", "like": {"requestType", "contactPhone", "deviceMac", "description", "resultNote"}},
    "system/config": {"table": "sys_config", "like": {"configName", "configKey"}},
    "system/dict/type": {"table": "sys_dict_type", "like": {"dictName", "dictType"}},
    "system/dict/data": {"table": "sys_dict_data", "like": {"dictLabel", "dictType"}},
    "system/dept": {"table": "sys_dept", "like": {"deptName"}},
    "system/menu": {"table": "sys_menu", "like": {"menuName"}},
    "system/notice": {"table": "sys_notice", "like": {"noticeTitle"}},
    "system/post": {"table": "sys_post", "like": {"postCode", "postName"}},
    "system/role": {"table": "sys_role", "like": {"roleName", "roleKey"}},
    "system/user": {"table": "sys_user", "like": {"userName", "nickName", "phonenumber"}},
    "monitor/operlog": {"table": "sys_oper_log", "like": {"title", "operName", "operIp"}},
    "monitor/logininfor": {"table": "sys_logininfor", "like": {"userName", "ipaddr", "msg"}},
    "monitor/job": {"table": "sys_job", "like": {"jobName", "jobGroup", "invokeTarget"}},
    "monitor/jobLog": {"table": "sys_job_log", "like": {"jobName", "jobGroup", "invokeTarget"}},
    "tool/gen": {"table": "gen_table", "like": {"tableName", "tableComment", "className"}},
}


def gen_table_payload(db: Session, table_name: str) -> dict[str, Any]:
    table_comment = db.execute(
        text(
            """
            select table_comment from information_schema.tables
            where table_schema = database() and table_name = :table_name
            """
        ),
        {"table_name": table_name},
    ).scalar() or table_name
    class_name = "".join(part[:1].upper() + part[1:] for part in table_name.split("_"))
    return {
        "table_name": table_name,
        "table_comment": table_comment,
        "class_name": class_name,
        "tpl_category": "crud",
        "tpl_web_type": "element-ui",
        "package_name": "app",
        "module_name": "admin",
        "business_name": table_name.split("_")[-1],
        "function_name": table_comment or table_name,
        "function_author": "qkeer",
        "gen_type": "0",
    }


def gen_column_payload(db: Session, table_id: int, table_name: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select column_name, column_comment, column_type, column_key, extra, is_nullable, ordinal_position
            from information_schema.columns
            where table_schema = database() and table_name = :table_name
            order by ordinal_position
            """
        ),
        {"table_name": table_name},
    ).all()
    result = []
    for row in rows:
        data = {str(key).lower(): value for key, value in dict(row._mapping).items()}
        column_name = data["column_name"]
        java_field = column_name.split("_")[0] + "".join(part[:1].upper() + part[1:] for part in column_name.split("_")[1:])
        column_type = str(data["column_type"])
        java_type = "Long" if "bigint" in column_type else "Integer" if "int" in column_type else "Date" if "date" in column_type or "time" in column_type else "String"
        result.append({
            "table_id": table_id,
            "column_name": column_name,
            "column_comment": data.get("column_comment") or column_name,
            "column_type": column_type,
            "java_type": java_type,
            "java_field": java_field,
            "is_pk": "1" if data.get("column_key") == "PRI" else "0",
            "is_increment": "1" if "auto_increment" in str(data.get("extra") or "") else "0",
            "is_required": "1" if data.get("is_nullable") == "NO" and data.get("column_key") != "PRI" else "0",
            "is_insert": "0" if data.get("column_key") == "PRI" else "1",
            "is_edit": "0" if data.get("column_key") == "PRI" else "1",
            "is_list": "1",
            "is_query": "0",
            "query_type": "EQ",
            "html_type": "input",
            "sort": data.get("ordinal_position") or 0,
        })
    return result


def ensure_gen_table_imported(db: Session, table_name: str) -> int:
    existing = db.execute(text("select table_id from gen_table where table_name=:table_name limit 1"), {"table_name": table_name}).scalar()
    if existing:
        return int(existing)
    payload = gen_table_payload(db, table_name)
    result = db.execute(text(
        """
        insert into gen_table(table_name, table_comment, class_name, tpl_category, tpl_web_type, package_name,
          module_name, business_name, function_name, function_author, gen_type, create_time)
        values(:table_name, :table_comment, :class_name, :tpl_category, :tpl_web_type, :package_name,
          :module_name, :business_name, :function_name, :function_author, :gen_type, now())
        """
    ), payload)
    table_id = int(result.lastrowid)
    for column in gen_column_payload(db, table_id, table_name):
        db.execute(text(
            """
            insert into gen_table_column(table_id, column_name, column_comment, column_type, java_type, java_field,
              is_pk, is_increment, is_required, is_insert, is_edit, is_list, is_query, query_type, html_type, sort, create_time)
            values(:table_id, :column_name, :column_comment, :column_type, :java_type, :java_field,
              :is_pk, :is_increment, :is_required, :is_insert, :is_edit, :is_list, :is_query, :query_type, :html_type, :sort, now())
            """
        ), column)
    db.commit()
    return table_id


def generated_files_for_table(db: Session, table_name: str) -> dict[str, str]:
    table_id = ensure_gen_table_imported(db, table_name)
    columns, _ = list_rows(db, "gen_table_column", {"tableId": table_id}, 1, 1000)
    return code_generator.generated_files(table_name, columns)


def generated_zip(db: Session, table_names: list[str]) -> io.BytesIO:
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        for table_name in table_names:
            for name, content in generated_files_for_table(db, table_name).items():
                archive.writestr(name, content)
    data.seek(0)
    return data


@router.get("/index/data")
def index_data():
    return success({})


def admin_user(
    token: str | None = Depends(read_request_token),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not token:
        raise auth.LoginError("未登录或登录已过期")
    return auth.user_from_token(db, token)


def ensure_family_relation_audit_schema(db: Session) -> None:
    db.execute(
        text(
            """
            create table if not exists family_relation_audit (
              id bigint primary key auto_increment,
              relation_id bigint not null,
              old_status tinyint null,
              new_status tinyint null,
              operator_user_id bigint not null,
              operator_name varchar(64) null,
              action varchar(32) not null,
              reason varchar(255) not null,
              create_time datetime not null default current_timestamp,
              index idx_family_relation_audit_relation (relation_id),
              index idx_family_relation_audit_operator (operator_user_id),
              index idx_family_relation_audit_time (create_time)
            )
            """
        )
    )
    db.commit()


@router.get("/captchaImage")
def captcha_image(db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    captcha = auth.create_captcha(db, redis)
    data = success(captcha)
    data.update(captcha)
    return data


@router.post("/login")
async def login(request: Request, db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    try:
        payload = await request.json()
        token = auth.login(db, redis, payload, request.client.host if request.client else None)
        data = success()
        data["token"] = token
        return data
    except auth.LoginError as exc:
        return error(str(exc))


@router.post("/logout")
def logout(token: str | None = Depends(read_request_token), redis: Redis | None = Depends(get_redis)):
    if token and redis:
        try:
            token_uuid = auth.token_uuid(token)
            if token_uuid:
                redis.delete(f"{auth.LOGIN_TOKEN_KEY}{token_uuid}")
        except auth.LoginError:
            pass
    return success()


@router.get("/aiLab/list")
def ai_lab_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    rows, total = ai_lab.list_applications(db, query, page_num, page_size)
    return table(rows, total)


@router.get("/feedback/snapshots/list")
def feedback_snapshot_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    rows, total = feedback.list_snapshots(db, query, page_num, page_size)
    return table(rows, total)


@router.get("/feedback/snapshots/export")
def feedback_snapshot_export(request: Request, db: Session = Depends(get_db)):
    data = feedback.export_snapshots_csv(db, dict(request.query_params))
    return StreamingResponse(
        data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=feedback_snapshots.csv"},
    )


@router.get("/family/abnormal/list")
def family_abnormal_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    offset = (page_num - 1) * page_size
    keyword = str(query.get("keyword") or "").strip()
    params: dict[str, Any] = {
        "limit": page_size,
        "offset": offset,
        "keyword": f"%{keyword}%",
    }
    keyword_sql = ""
    if keyword:
        keyword_sql = " and (title like :keyword or content like :keyword or object_id like :keyword)"
    source_sql = """
      select convert(concat('relation-', id) using utf8mb4) collate utf8mb4_general_ci as id,
             convert('relation' using utf8mb4) collate utf8mb4_general_ci as source_type,
             convert(cast(id as char) using utf8mb4) collate utf8mb4_general_ci as object_id,
             case status
               when 0 then convert('共享关系待确认' using utf8mb4) collate utf8mb4_general_ci
               when 2 then convert('共享关系已暂停' using utf8mb4) collate utf8mb4_general_ci
               when 3 then convert('共享关系已取消' using utf8mb4) collate utf8mb4_general_ci
               when 4 then convert('共享关系已拒绝' using utf8mb4) collate utf8mb4_general_ci
               else convert('共享关系异常' using utf8mb4) collate utf8mb4_general_ci
             end as title,
             convert(concat('guardian=', guardian_user_id, ', elder=', coalesce(elder_user_id, elder_profile_id), ', display=', coalesce(display_name, '')) using utf8mb4) collate utf8mb4_general_ci as content,
             status as severity,
             update_time as event_time
      from family_relation
      where del_flag='0' and status <> 1
      union all
      select convert(concat('invite-', id) using utf8mb4) collate utf8mb4_general_ci as id,
             convert('invite' using utf8mb4) collate utf8mb4_general_ci as source_type,
             convert(invite_code using utf8mb4) collate utf8mb4_general_ci as object_id,
             case status
               when 0 then convert('邀请待处理' using utf8mb4) collate utf8mb4_general_ci
               when 3 then convert('邀请已过期' using utf8mb4) collate utf8mb4_general_ci
               else convert('邀请未完成' using utf8mb4) collate utf8mb4_general_ci
             end as title,
             convert(concat('targetPhone=', coalesce(target_phone, ''), ', inviter=', inviter_user_id) using utf8mb4) collate utf8mb4_general_ci as content,
             status as severity,
             coalesce(accept_time, expire_time, create_time) as event_time
      from family_invite
      where status in (0,3)
      union all
      select convert(concat('profile-', id) using utf8mb4) collate utf8mb4_general_ci as id,
             convert('elder_profile' using utf8mb4) collate utf8mb4_general_ci as source_type,
             convert(cast(id as char) using utf8mb4) collate utf8mb4_general_ci as object_id,
             convert('老人档案待认领' using utf8mb4) collate utf8mb4_general_ci as title,
             convert(concat('name=', coalesce(name, ''), ', phone=', coalesce(phone, ''), ', creator=', creator_user_id) using utf8mb4) collate utf8mb4_general_ci as content,
             0 as severity,
             update_time as event_time
      from elder_profile
      where del_flag='0' and claim_status=0
      union all
      select convert(concat('bind-', id) using utf8mb4) collate utf8mb4_general_ci as id,
             convert('device_bind_log' using utf8mb4) collate utf8mb4_general_ci as source_type,
             convert(cast(id as char) using utf8mb4) collate utf8mb4_general_ci as object_id,
             convert('设备强制重绑' using utf8mb4) collate utf8mb4_general_ci as title,
             convert(concat('mac=', coalesce(device_mac, ''), ', oldUser=', coalesce(old_user_id, ''), ', newUser=', coalesce(new_user_id, ''), ', operator=', operator_user_id) using utf8mb4) collate utf8mb4_general_ci as content,
             2 as severity,
             create_time as event_time
      from device_bind_log
      where reason='family_guardian_force_rebind'
      union all
      select convert(concat('unsynced-', d.id) using utf8mb4) collate utf8mb4_general_ci as id,
             convert('family_unsynced_device' using utf8mb4) collate utf8mb4_general_ci as source_type,
             convert(cast(m.id as char) using utf8mb4) collate utf8mb4_general_ci as object_id,
             convert('家人设备长期未同步' using utf8mb4) collate utf8mb4_general_ci as title,
             convert(concat('member=', coalesce(m.name, ''), ', guardian=', m.owner_user_id, ', elder=', m.data_user_id, ', mac=', coalesce(d.device_mac, ''), ', lastSync=', coalesce(dev.last_sync_time, '从未同步')) using utf8mb4) collate utf8mb4_general_ci as content,
             2 as severity,
             coalesce(dev.last_sync_time, d.update_time, d.create_time) as event_time
      from family_member_device d
      join family_member m on m.id=d.member_id and m.del_flag=0 and m.status='active'
      left join device dev on dev.mac=d.device_mac collate utf8mb4_general_ci and dev.del_flag=0
      where d.del_flag=0 and d.status='active'
        and (dev.last_sync_time is null or dev.last_sync_time < date_sub(now(), interval 24 hour))
      union all
      select convert(concat('assist-', id) using utf8mb4) collate utf8mb4_general_ci as id,
             convert('family_assist_request' using utf8mb4) collate utf8mb4_general_ci as source_type,
             convert(cast(id as char) using utf8mb4) collate utf8mb4_general_ci as object_id,
             convert('人工协助请求待处理' using utf8mb4) collate utf8mb4_general_ci as title,
             convert(concat('requester=', requester_user_id, ', relation=', coalesce(relation_id, ''), ', type=', request_type, ', desc=', coalesce(description, '')) using utf8mb4) collate utf8mb4_general_ci as content,
             1 as severity,
             update_time as event_time
      from family_assist_request
      where del_flag='0' and status in (0,1)
    """
    list_sql = f"""
        select * from ({source_sql}) abnormal
        where 1=1 {keyword_sql}
        order by event_time desc
        limit :limit offset :offset
    """
    count_sql = f"select count(1) from ({source_sql}) abnormal where 1=1 {keyword_sql}"
    rows = db.execute(text(list_sql), params).all()
    total = db.execute(text(count_sql), params).scalar() or 0
    return table([camelize_dict(dict(row._mapping)) for row in rows], int(total))


@router.put("/family/relation/{relation_id}/status")
async def family_relation_status_update(
    relation_id: int,
    request: Request,
    current_admin: dict[str, Any] = Depends(admin_user),
    db: Session = Depends(get_db),
):
    payload = await request.json()
    status = int(payload.get("status") if payload.get("status") is not None else -1)
    reason = str(payload.get("reason") or "").strip()
    if status not in (1, 2, 3):
        return error("共享关系状态只能设置为生效、暂停或取消")
    if not reason:
        return error("请填写操作原因")
    ensure_family_relation_audit_schema(db)
    row = db.execute(
        text("select * from family_relation where id=:id and del_flag='0' limit 1"),
        {"id": relation_id},
    ).first()
    if not row:
        return error("共享关系不存在")
    relation = dict(row._mapping)
    old_status = relation.get("status")
    db.execute(
        text("update family_relation set status=:status, remark=:reason, update_time=now() where id=:id"),
        {"id": relation_id, "status": status, "reason": reason},
    )
    member_status = {1: "active", 2: "paused", 3: "cancelled"}[status]
    db.execute(
        text("update family_member set status=:status, update_time=now() where relation_id=:relation_id and del_flag=0"),
        {"status": member_status, "relation_id": relation_id},
    )
    action = {1: "resume", 2: "pause", 3: "cancel"}[status]
    db.execute(
        text(
            """
            insert into family_relation_audit(
              relation_id, old_status, new_status, operator_user_id, operator_name, action, reason
            )
            values(
              :relation_id, :old_status, :new_status, :operator_user_id, :operator_name, :action, :reason
            )
            """
        ),
        {
            "relation_id": relation_id,
            "old_status": old_status,
            "new_status": status,
            "operator_user_id": int(current_admin.get("userId") or 0),
            "operator_name": current_admin.get("userName") or current_admin.get("nickName"),
            "action": action,
            "reason": reason[:255],
        },
    )
    db.commit()
    updated = db.execute(text("select * from family_relation where id=:id"), {"id": relation_id}).first()
    return success(camelize_dict(dict(updated._mapping)) if updated else {"id": relation_id, "status": status})


@router.put("/family/assist/{request_id}/status")
async def family_assist_status_update(
    request_id: int,
    request: Request,
    current_admin: dict[str, Any] = Depends(admin_user),
    db: Session = Depends(get_db),
):
    payload = await request.json()
    status = int(payload.get("status") if payload.get("status") is not None else -1)
    note = str(payload.get("resultNote") or payload.get("note") or "").strip()
    if status not in (1, 2, 3):
        return error("协助请求状态只能设置为处理中、已完成或已关闭")
    if status in (2, 3) and not note:
        return error("完成或关闭协助请求时请填写处理备注")
    row = db.execute(
        text("select * from family_assist_request where id=:id and del_flag='0' limit 1"),
        {"id": request_id},
    ).first()
    if not row:
        return error("协助请求不存在")
    admin_id = int(current_admin.get("userId") or 0)
    admin_name = current_admin.get("userName") or current_admin.get("nickName")
    db.execute(
        text(
            """
            update family_assist_request
            set status=:status,
                operator_user_id=:operator_user_id,
                operator_name=:operator_name,
                result_note=:result_note,
                update_time=now()
            where id=:id and del_flag='0'
            """
        ),
        {
            "id": request_id,
            "status": status,
            "operator_user_id": admin_id,
            "operator_name": admin_name,
            "result_note": note[:512] if note else None,
        },
    )
    db.commit()
    updated = db.execute(text("select * from family_assist_request where id=:id"), {"id": request_id}).first()
    return success(camelize_dict(dict(updated._mapping)) if updated else {"id": request_id, "status": status})


@router.get("/feedback/snapshots/{snapshot_id}")
def feedback_snapshot_detail(snapshot_id: str, db: Session = Depends(get_db)):
    item = feedback.get_snapshot(db, snapshot_id)
    return success(item) if item else error("反馈快照不存在")


@router.post("/feedback/snapshots/{snapshot_id}/recalculate")
def feedback_snapshot_recalculate(snapshot_id: str, db: Session = Depends(get_db)):
    try:
        return success(feedback.recalculate_snapshot(db, snapshot_id))
    except ValueError as exc:
        return error(str(exc))


@router.put("/feedback/snapshots/{snapshot_id}/review")
async def feedback_snapshot_review(snapshot_id: str, request: Request, db: Session = Depends(get_db)):
    try:
        payload = await request.json()
        return success(feedback.update_review(db, snapshot_id, payload))
    except ValueError as exc:
        return error(str(exc))


@router.delete("/feedback/snapshots/{snapshot_id}")
def feedback_snapshot_delete(snapshot_id: str, db: Session = Depends(get_db)):
    return success() if feedback.delete_snapshot(db, snapshot_id) > 0 else error("反馈快照不存在")


@router.get("/aiLab/inviteCode/list")
def ai_lab_invite_code_list(pageNum: int = 1, pageSize: int = 10, db: Session = Depends(get_db)):
    rows, total = ai_lab.list_invite_codes(db, pageNum, pageSize)
    return table(rows, total)


@router.post("/aiLab/inviteCode/add")
async def ai_lab_invite_code_add(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    ai_lab.add_invite_codes(db, payload.get("codes") or [], str(payload.get("jumpUrl") or ""))
    return success(True)


@router.post("/aiLab/inviteCode/generate")
async def ai_lab_invite_code_generate(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    codes = ai_lab.generate_invite_codes(db, int(payload.get("count") or 0), str(payload.get("jumpUrl") or ""))
    return success(codes)


@router.delete("/aiLab/inviteCode/{invite_id}")
def ai_lab_invite_code_delete(invite_id: int, db: Session = Depends(get_db)):
    ai_lab.delete_invite_code(db, invite_id)
    return success(True)


@router.post("/aiLab/audit")
async def ai_lab_audit(
    request: Request,
    current_admin: dict[str, Any] = Depends(admin_user),
    db: Session = Depends(get_db),
):
    payload = await request.json()
    status = int(payload.get("status") or 0)
    ai_lab.audit(
        db,
        int(payload.get("id") or 0),
        status,
        int(current_admin["userId"]),
        payload.get("jumpUrl"),
        payload.get("remark"),
    )
    return success(True, msg="审核通过" if status == 1 else "已拒绝")


@router.get("/aiLab/{apply_id}")
def ai_lab_detail(apply_id: int, db: Session = Depends(get_db)):
    return success(ai_lab.get_application(db, apply_id))


@router.post("/register")
async def register(request: Request, db: Session = Depends(get_db), redis: Redis | None = Depends(get_redis)):
    payload = await request.json()
    if str(auth.config_value(db, "sys.account.registerUser", "false")).lower() != "true":
        return error("当前系统没有开启注册功能")
    try:
        auth.validate_captcha(db, redis, payload.get("code"), payload.get("uuid"))
        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
        if not 2 <= len(username) <= 20:
            return error("用户名长度必须在 2 到 20 个字符之间")
        if not 5 <= len(password) <= 20:
            return error("密码长度必须在 5 到 20 个字符之间")
        if auth.select_user_by_username(db, username):
            return error("保存用户失败，注册账号已存在")
        encoded = auth.hash_password(password)
        db.execute(
            text(
                """
                insert into sys_user(user_name, nick_name, password, status, del_flag, create_by, create_time)
                values(:username, :nickname, :password, '0', '0', :username, now())
                """
            ),
            {"username": username, "nickname": username, "password": encoded},
        )
        db.commit()
        return success()
    except auth.LoginError as exc:
        return error(str(exc))


@router.get("/getInfo")
def get_info(token: str | None = Depends(read_request_token), db: Session = Depends(get_db)):
    try:
        if not token:
            raise auth.LoginError("未登录或登录已过期")
        user = auth.user_from_token(db, token)
        data = success()
        data.update(auth.get_info(db, user))
        return data
    except auth.LoginError as exc:
        return error(str(exc), code=401)


@router.get("/getRouters")
def get_routers(token: str | None = Depends(read_request_token), db: Session = Depends(get_db)):
    try:
        if not token:
            raise auth.LoginError("未登录或登录已过期")
        user = auth.user_from_token(db, token)
        return success(auth.get_routers(db, user))
    except auth.LoginError as exc:
        return error(str(exc), code=401)


@router.get("/system/config/configKey/{config_key}")
def system_config_key(config_key: str, db: Session = Depends(get_db)):
    return success(system.config_value(db, config_key))


@router.delete("/system/config/refreshCache")
def system_config_refresh_cache():
    return success()


@router.get("/system/dict/data/type/{dict_type}")
def system_dict_data_type(dict_type: str, db: Session = Depends(get_db)):
    return success(system.dict_data_by_type(db, dict_type))


@router.delete("/system/dict/type/refreshCache")
def system_dict_type_refresh_cache():
    return success()


@router.get("/system/dict/type/optionselect")
def system_dict_type_optionselect(db: Session = Depends(get_db)):
    return success(system.dict_type_options(db))


@router.get("/system/menu/list")
def system_menu_list(request: Request, db: Session = Depends(get_db)):
    return success(system.menu_list(db, dict(request.query_params)))


@router.get("/system/menu/treeselect")
def system_menu_treeselect(db: Session = Depends(get_db)):
    return success(system.menu_tree_select(db))


@router.get("/system/menu/roleMenuTreeselect/{role_id}")
def system_role_menu_treeselect(role_id: int, db: Session = Depends(get_db)):
    data = success()
    data["checkedKeys"] = system.role_menu_ids(db, role_id)
    data["menus"] = system.menu_tree_select(db)
    return data


@router.get("/system/dept/list")
def system_dept_list(request: Request, db: Session = Depends(get_db)):
    return success(system.dept_list(db, dict(request.query_params)))


@router.get("/system/dept/list/exclude/{dept_id}")
def system_dept_list_exclude(dept_id: int, db: Session = Depends(get_db)):
    rows = [item for item in system.dept_list(db) if int(item.get("deptId") or 0) != dept_id and f",{dept_id}," not in f",{item.get('ancestors') or ''},"]
    return success(rows)


@router.get("/system/user/deptTree")
def system_user_dept_tree(db: Session = Depends(get_db)):
    return success(system.dept_tree_select(db))


@router.get("/system/user/profile")
def system_user_profile(token: str | None = Depends(read_request_token), db: Session = Depends(get_db)):
    try:
        user = auth.user_from_token(db, token or "")
    except Exception as exc:
        return error(str(exc), code=401)
    data = success()
    data["data"] = auth.without_password(user)
    data["roleGroup"] = ",".join(role.get("roleName") or "" for role in system.rows(
        db,
        """
        select r.role_name from sys_role r
        join sys_user_role ur on ur.role_id = r.role_id
        where ur.user_id=:user_id and r.del_flag='0'
        """,
        {"user_id": user["userId"]},
    ))
    data["postGroup"] = ",".join(post.get("postName") or "" for post in system.rows(
        db,
        """
        select p.post_name from sys_post p
        join sys_user_post up on up.post_id = p.post_id
        where up.user_id=:user_id
        """,
        {"user_id": user["userId"]},
    ))
    return data


@router.put("/system/user/profile")
async def system_user_profile_update(request: Request, token: str | None = Depends(read_request_token), db: Session = Depends(get_db)):
    try:
        user = auth.user_from_token(db, token or "")
    except Exception as exc:
        return error(str(exc), code=401)
    payload = await request.json()
    allowed = {key: payload.get(key) for key in ("nickName", "email", "phonenumber", "sex") if key in payload}
    allowed["userId"] = user["userId"]
    return success() if system.update_simple(db, "sys_user", "userId", allowed) > 0 else error()


@router.put("/system/user/profile/updatePwd")
async def system_user_profile_update_pwd(request: Request, token: str | None = Depends(read_request_token), db: Session = Depends(get_db)):
    try:
        user = auth.user_from_token(db, token or "")
    except Exception as exc:
        return error(str(exc), code=401)
    payload = await request.json()
    if not auth.bcrypt.checkpw(str(payload.get("oldPassword") or "").encode("utf-8"), str(user.get("password") or "").encode("utf-8")):
        return error("旧密码错误")
    db.execute(text("update sys_user set password=:password where user_id=:user_id"), {"password": system.hash_password(str(payload.get("newPassword") or "")), "user_id": user["userId"]})
    db.commit()
    return success()


@router.post("/system/user/profile/avatar")
async def system_user_profile_avatar(file: UploadFile, token: str | None = Depends(read_request_token), db: Session = Depends(get_db)):
    try:
        user = auth.user_from_token(db, token or "")
    except Exception as exc:
        return error(str(exc), code=401)
    suffix = Path(file.filename or "").suffix.lower() or ".png"
    upload_dir = Path("uploads/avatar")
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / f"{uuid4().hex}{suffix}"
    target.write_bytes(await file.read())
    url = f"/admin/files/avatar/{target.name}"
    db.execute(text("update sys_user set avatar=:avatar where user_id=:user_id"), {"avatar": url, "user_id": user["userId"]})
    db.commit()
    data = success()
    data["imgUrl"] = url
    return data


@router.get("/system/role/deptTree/{role_id}")
def system_role_dept_tree(role_id: int, db: Session = Depends(get_db)):
    data = success()
    data["checkedKeys"] = system.role_dept_ids(db, role_id)
    data["depts"] = system.dept_tree_select(db)
    return data


@router.get("/system/user/list")
def system_user_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    rows, total = list_rows(db, "sys_user", query, page_num, page_size, {"userName", "nickName", "phonenumber"})
    for row in rows:
        row.pop("password", None)
    return table(rows, total)


@router.get("/system/user/")
@router.get("/system/user/{user_id}")
def system_user_detail(user_id: int | None = None, db: Session = Depends(get_db)):
    data = success()
    data.update(system.user_detail(db, user_id))
    return data


@router.post("/system/user")
async def system_user_create(request: Request, db: Session = Depends(get_db)):
    return success() if system.create_user(db, await request.json()) > 0 else error()


@router.put("/system/user")
async def system_user_update(request: Request, db: Session = Depends(get_db)):
    return success() if system.update_user(db, await request.json()) > 0 else error()


@router.put("/system/user/resetPwd")
async def system_user_reset_pwd(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    payload["password"] = system.hash_password(str(payload.get("password") or ""))
    return success() if system.update_simple(db, "sys_user", "userId", payload) > 0 else error()


@router.put("/system/user/changeStatus")
async def system_user_change_status(request: Request, db: Session = Depends(get_db)):
    return success() if system.update_simple(db, "sys_user", "userId", await request.json()) > 0 else error()


@router.get("/system/user/authRole/{user_id}")
def system_user_auth_role(user_id: int, db: Session = Depends(get_db)):
    user = system.row(db, "select * from sys_user where user_id=:user_id and del_flag='0'", {"user_id": user_id})
    assigned = set(db.execute(text("select role_id from sys_user_role where user_id=:user_id"), {"user_id": user_id}).scalars())
    roles = system.rows(db, "select * from sys_role where del_flag='0' order by role_sort")
    for role in roles:
        role["flag"] = int(role.get("roleId") or 0) in assigned
    data = success()
    data["user"] = user
    data["roles"] = roles
    return data


@router.put("/system/user/authRole")
def system_user_auth_role_update(userId: int, roleIds: str = "", db: Session = Depends(get_db)):
    system.replace_user_roles(db, userId, system.id_list(roleIds))
    db.commit()
    return success()


@router.put("/system/role/changeStatus")
async def system_role_change_status(request: Request, db: Session = Depends(get_db)):
    return success() if system.update_simple(db, "sys_role", "roleId", await request.json()) > 0 else error()


@router.put("/system/role/dataScope")
async def system_role_data_scope(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    result = system.update_simple(db, "sys_role", "roleId", payload)
    system.replace_role_depts(db, int(payload.get("roleId")), system.id_list(payload.get("deptIds")))
    db.commit()
    return success() if result > 0 else error()


@router.post("/system/role")
async def system_role_create(request: Request, db: Session = Depends(get_db)):
    return success() if system.create_role(db, await request.json()) > 0 else error()


@router.put("/system/role")
async def system_role_update(request: Request, db: Session = Depends(get_db)):
    return success() if system.update_role(db, await request.json()) > 0 else error()


@router.get("/system/role/optionselect")
def system_role_optionselect(db: Session = Depends(get_db)):
    return success(system.rows(db, "select * from sys_role where del_flag='0' order by role_sort"))


@router.get("/system/role/authUser/allocatedList")
def system_role_allocated_users(request: Request, db: Session = Depends(get_db)):
    params = dict(request.query_params)
    role_id = params.get("roleId")
    page_num = int(params.get("pageNum", 1) or 1)
    page_size = int(params.get("pageSize", 10) or 10)
    sql = """
        select u.* from sys_user u
        join sys_user_role ur on ur.user_id = u.user_id
        where u.del_flag='0' and ur.role_id=:role_id
    """
    bind = {"role_id": role_id}
    if params.get("userName"):
        sql += " and u.user_name like :user_name"
        bind["user_name"] = f"%{params['userName']}%"
    if params.get("phonenumber"):
        sql += " and u.phonenumber like :phonenumber"
        bind["phonenumber"] = f"%{params['phonenumber']}%"
    total = db.execute(text(f"select count(*) from ({sql}) t"), bind).scalar() or 0
    rows = db.execute(text(sql + " order by u.user_id limit :limit offset :offset"), {**bind, "limit": page_size, "offset": (page_num - 1) * page_size}).all()
    return table([camelize_dict(dict(row._mapping)) for row in rows], total)


@router.get("/system/role/authUser/unallocatedList")
def system_role_unallocated_users(request: Request, db: Session = Depends(get_db)):
    params = dict(request.query_params)
    role_id = params.get("roleId")
    page_num = int(params.get("pageNum", 1) or 1)
    page_size = int(params.get("pageSize", 10) or 10)
    sql = """
        select u.* from sys_user u
        where u.del_flag='0' and u.user_id not in (
          select user_id from sys_user_role where role_id=:role_id
        )
    """
    bind = {"role_id": role_id}
    if params.get("userName"):
        sql += " and u.user_name like :user_name"
        bind["user_name"] = f"%{params['userName']}%"
    if params.get("phonenumber"):
        sql += " and u.phonenumber like :phonenumber"
        bind["phonenumber"] = f"%{params['phonenumber']}%"
    total = db.execute(text(f"select count(*) from ({sql}) t"), bind).scalar() or 0
    rows = db.execute(text(sql + " order by u.user_id limit :limit offset :offset"), {**bind, "limit": page_size, "offset": (page_num - 1) * page_size}).all()
    return table([camelize_dict(dict(row._mapping)) for row in rows], total)


@router.put("/system/role/authUser/cancel")
async def system_role_auth_cancel(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    db.execute(text("delete from sys_user_role where user_id=:user_id and role_id=:role_id"), {"user_id": payload.get("userId"), "role_id": payload.get("roleId")})
    db.commit()
    return success()


@router.put("/system/role/authUser/cancelAll")
def system_role_auth_cancel_all(roleId: int, userIds: str, db: Session = Depends(get_db)):
    for user_id in system.id_list(userIds):
        db.execute(text("delete from sys_user_role where role_id=:role_id and user_id=:user_id"), {"role_id": roleId, "user_id": user_id})
    db.commit()
    return success()


@router.put("/system/role/authUser/selectAll")
def system_role_auth_select_all(roleId: int, userIds: str, db: Session = Depends(get_db)):
    for user_id in system.id_list(userIds):
        exists = db.execute(text("select count(*) from sys_user_role where role_id=:role_id and user_id=:user_id"), {"role_id": roleId, "user_id": user_id}).scalar()
        if not exists:
            db.execute(text("insert into sys_user_role(user_id, role_id) values(:user_id, :role_id)"), {"user_id": user_id, "role_id": roleId})
    db.commit()
    return success()


@router.get("/system/post/optionselect")
def system_post_optionselect(db: Session = Depends(get_db)):
    return success(system.rows(db, "select * from sys_post order by post_sort"))


@router.get("/device/model/options")
def device_model_options(db: Session = Depends(get_db)):
    return success(system.rows(db, "select id, model_key, model_name, device_version from device_model where del_flag=0 order by id"))


@router.put("/user/changeStatus")
async def app_user_change_status(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    result = db.execute(
        text("update app_user set status=:status, update_time=now() where id=:id and del_flag=0"),
        {"id": payload.get("id"), "status": payload.get("status")},
    )
    db.commit()
    return success((result.rowcount or 0) > 0)


@router.get("/user/latestHealthData/{user_id}")
def app_user_latest_health_data(user_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        text("select * from health_daily_summary where user_id=:user_id order by record_date desc, id desc limit 1"),
        {"user_id": user_id},
    ).first()
    return success(camelize_dict(dict(row._mapping)) if row else None)


def app_user_health_data_query(db: Session, query: dict[str, Any], paginate: bool = True) -> tuple[list[dict[str, Any]], int]:
    clauses = []
    params: dict[str, Any] = {}
    if query.get("userId"):
        clauses.append("user_id=:user_id")
        params["user_id"] = query["userId"]
    if query.get("deviceMac"):
        clauses.append("device_mac like :device_mac")
        params["device_mac"] = f"%{query['deviceMac']}%"
    begin_time = query.get("beginTime") or query.get("params[beginTime]")
    end_time = query.get("endTime") or query.get("params[endTime]")
    if begin_time:
        clauses.append("record_date >= :begin_time")
        params["begin_time"] = begin_time
    if end_time:
        clauses.append("record_date <= :end_time")
        params["end_time"] = end_time
    where = f" where {' and '.join(clauses)}" if clauses else ""
    total = int(db.execute(text(f"select count(*) from health_daily_summary{where}"), params).scalar() or 0)
    sql = f"select * from health_daily_summary{where} order by record_date desc, id desc"
    if paginate:
        page_num = int(query.get("pageNum", 1) or 1)
        page_size = int(query.get("pageSize", 10) or 10)
        sql += " limit :limit offset :offset"
        params.update({"limit": page_size, "offset": max(page_num - 1, 0) * page_size})
    rows = db.execute(text(sql), params).all()
    return [camelize_dict(dict(row._mapping)) for row in rows], total


@router.get("/user/historyHealthData")
def app_user_history_health_data(request: Request, db: Session = Depends(get_db)):
    rows, total = app_user_health_data_query(db, dict(request.query_params))
    return table(rows, total)


@router.post("/user/healthData/export")
def app_user_health_data_export(request: Request, db: Session = Depends(get_db)):
    rows, _ = app_user_health_data_query(db, dict(request.query_params), paginate=False)
    output = io.StringIO()
    writer = csv.writer(output)
    headers = list(rows[0].keys()) if rows else []
    writer.writerow(headers)
    for row in rows:
        writer.writerow([row.get(header, "") for header in headers])
    content = output.getvalue().encode("utf-8-sig")
    filename = "user_health_data.csv"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}", "download-filename": filename},
    )


@router.put("/monitor/job/changeStatus")
async def monitor_job_change_status(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    return success() if system.update_simple(db, "sys_job", "jobId", payload) > 0 else error()


@router.put("/monitor/job/run")
async def monitor_job_run(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    job_id = payload.get("jobId") or payload.get("job_id")
    job = get_row(db, "sys_job", job_id) if job_id else None
    if not job:
        return error("任务不存在或已过期")
    db.execute(
        text(
            """
            insert into sys_job_log(job_name, job_group, invoke_target, job_message, status, create_time)
            values(:job_name, :job_group, :invoke_target, :job_message, '0', now())
            """
        ),
        {
            "job_name": job.get("jobName"),
            "job_group": job.get("jobGroup"),
            "invoke_target": job.get("invokeTarget"),
            "job_message": "FastAPI local run recorded; scheduler execution is not enabled in migration mode.",
        },
    )
    db.commit()
    return success()


@router.get("/tool/gen/db/list")
def gen_db_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    table_name = query.get("tableName")
    clauses = [
        "table_schema = database()",
        "table_name not like 'qrtz_%'",
        "table_name not in ('gen_table', 'gen_table_column')",
        "table_name not in (select table_name from gen_table)",
    ]
    params: dict[str, Any] = {}
    if table_name:
        clauses.append("table_name like :table_name")
        params["table_name"] = f"%{table_name}%"
    rows = db.execute(
        text(
            f"""
            select table_name, table_comment, create_time, update_time
            from information_schema.tables
            where {' and '.join(clauses)}
            order by create_time desc
            """
        ),
        params,
    ).all()
    data = [camelize_dict(dict(row._mapping)) for row in rows]
    return table(data, len(data))


@router.get("/tool/gen/list")
def gen_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    rows, total = list_rows(db, "gen_table", query, page_num, page_size, {"tableName", "tableComment", "className"})
    return table(rows, total)


@router.post("/tool/gen/importTable")
async def gen_import_table(request: Request, tables: str = "", db: Session = Depends(get_db)):
    if not tables:
        form = await request.form()
        tables = str(form.get("tables") or "")
    for table_name in [item.strip() for item in tables.split(",") if item.strip()]:
        ensure_gen_table_imported(db, table_name)
    return success()


@router.post("/tool/gen/createTable")
async def gen_create_table(request: Request, sql: str = "", db: Session = Depends(get_db)):
    if not sql:
        form = await request.form()
        sql = str(form.get("sql") or "")
    if not re.match(r"^\s*create\s+table\s+", sql or "", flags=re.I):
        return error("只允许执行 CREATE TABLE 语句")
    db.execute(text(sql))
    db.commit()
    match = re.search(r"create\s+table\s+`?([a-zA-Z0-9_]+)`?", sql, flags=re.I)
    if match:
        ensure_gen_table_imported(db, match.group(1))
    return success()


@router.get("/tool/gen/column/{table_id}")
def gen_column_list(table_id: int, db: Session = Depends(get_db)):
    rows, total = list_rows(db, "gen_table_column", {"tableId": table_id}, 1, 1000)
    return table(rows, total)


@router.get("/tool/gen/preview/{table_id}")
def gen_preview(table_id: int, db: Session = Depends(get_db)):
    info = get_row(db, "gen_table", table_id)
    columns, _ = list_rows(db, "gen_table_column", {"tableId": table_id}, 1, 1000)
    if not info:
        return error("生成配置不存在")
    table_name = info.get("tableName")
    return success(code_generator.generated_files(str(table_name), columns))


@router.get("/tool/gen/{table_id}")
def gen_info(table_id: int, db: Session = Depends(get_db)):
    info = get_row(db, "gen_table", table_id)
    rows, _ = list_rows(db, "gen_table_column", {"tableId": table_id}, 1, 1000)
    tables, _ = list_rows(db, "gen_table", {}, 1, 1000)
    data = success()
    data.update({"info": info, "rows": rows, "tables": tables})
    return data


@router.put("/tool/gen")
async def gen_update(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    columns = payload.pop("columns", None) or []
    update_row(db, "gen_table", payload)
    for column in columns:
        if column.get("columnId"):
            update_row(db, "gen_table_column", column)
    return success()


@router.get("/tool/gen/synchDb/{table_name}")
def gen_sync_db(table_name: str, db: Session = Depends(get_db)):
    table_id = ensure_gen_table_imported(db, table_name)
    db.execute(text("delete from gen_table_column where table_id=:table_id"), {"table_id": table_id})
    for column in gen_column_payload(db, table_id, table_name):
        db.execute(text(
            """
            insert into gen_table_column(table_id, column_name, column_comment, column_type, java_type, java_field,
              is_pk, is_increment, is_required, is_insert, is_edit, is_list, is_query, query_type, html_type, sort, create_time)
            values(:table_id, :column_name, :column_comment, :column_type, :java_type, :java_field,
              :is_pk, :is_increment, :is_required, :is_insert, :is_edit, :is_list, :is_query, :query_type, :html_type, :sort, now())
            """
        ), column)
    db.commit()
    return success()


@router.delete("/tool/gen/{table_ids}")
def gen_delete(table_ids: str, db: Session = Depends(get_db)):
    ids = [item for item in table_ids.split(",") if item.isdigit()]
    if not ids:
        return error("请选择要删除的生成配置")
    params = {"ids": [int(item) for item in ids]}
    db.execute(text("delete from gen_table_column where table_id in :ids").bindparams(bindparam("ids", expanding=True)), params)
    db.execute(text("delete from gen_table where table_id in :ids").bindparams(bindparam("ids", expanding=True)), params)
    db.commit()
    return success()


@router.get("/tool/gen/download/{table_name}")
def gen_code_download(table_name: str, db: Session = Depends(get_db)):
    data = generated_zip(db, [table_name])
    return StreamingResponse(data, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=ruoyi.zip", "download-filename": "ruoyi.zip"})


@router.get("/tool/gen/genCode/{table_name}")
def gen_code_local(table_name: str, db: Session = Depends(get_db)):
    table_id = ensure_gen_table_imported(db, table_name)
    columns, _ = list_rows(db, "gen_table_column", {"tableId": table_id}, 1, 1000)
    target = code_generator.write_generated_files(Path("generated"), table_name, columns)
    return success(msg=f"代码已生成到 {target.resolve()}")


@router.get("/tool/gen/batchGenCode")
def gen_code_batch(tables: str = "", db: Session = Depends(get_db)):
    data = generated_zip(db, [item.strip() for item in tables.split(",") if item.strip()])
    return StreamingResponse(data, media_type="application/zip", headers={"Content-Disposition": "attachment; filename=ruoyi.zip", "download-filename": "ruoyi.zip"})


@router.post("/device/ota/upload")
async def device_ota_upload(file: UploadFile):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".hex", ".bin", ".hex16"}:
        return error("文件类型不支持")
    upload_dir = Path("uploads/ota")
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / f"{uuid4().hex}{suffix}"
    content = await file.read()
    target.write_bytes(content)
    url = f"/admin/files/ota/{target.name}"
    data = success()
    data.update({
        "url": url,
        "fileName": url,
        "newFileName": url,
        "originalFilename": file.filename,
        "fileSize": len(content),
    })
    return data


@router.post("/{resource:path}/export")
def generic_export(resource: str, request: Request, db: Session = Depends(get_db)):
    config = CRUD_RESOURCES.get(resource)
    if not config:
        return not_migrated(f"/admin/{resource}/export")
    query = dict(request.query_params)
    rows, _ = list_rows(db, config["table"], query, 1, 100000, config.get("like", set()))
    if resource == "system/user":
        for row in rows:
            row.pop("password", None)
    output = io.StringIO()
    writer = csv.writer(output)
    if rows:
        headers = list(rows[0].keys())
        writer.writerow(headers)
        for row in rows:
            writer.writerow([row.get(header, "") for header in headers])
    else:
        writer.writerow([])
    content = output.getvalue().encode("utf-8-sig")
    filename = f"{resource.replace('/', '_')}.csv"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}", "download-filename": filename},
    )


@router.post("/{resource:path}/importTemplate")
def generic_import_template(resource: str):
    if resource == "device":
        filename = "device_template.xlsx"
        return StreamingResponse(
            io.BytesIO(device_template_xlsx()),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}", "download-filename": filename},
        )
    if resource == "system/user":
        filename = "system_user_template.xlsx"
        return StreamingResponse(
            io.BytesIO(system_user_template_xlsx()),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}", "download-filename": filename},
        )
    filename = f"{resource.replace('/', '_')}_template.csv"
    return StreamingResponse(
        io.BytesIO(b"\xef\xbb\xbf"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}", "download-filename": filename},
    )


@router.post("/{resource:path}/importData")
async def generic_import_data(resource: str, file: UploadFile | None = None, updateSupport: bool = False, db: Session = Depends(get_db)):
    if resource == "device":
        if file is None:
            return error("请选择要导入的 .xlsx 文件")
        try:
            message = import_device_xlsx(db, await file.read(), updateSupport)
            return success(msg=message)
        except ValueError as exc:
            return error(str(exc))
    if resource == "system/user":
        if file is None:
            return error("请选择要导入的 .xlsx 文件")
        try:
            message = import_system_users_xlsx(db, await file.read(), updateSupport)
            return success(msg=message)
        except ValueError as exc:
            return error(str(exc))
    return error(f"暂不支持导入: {resource}")


@router.delete("/monitor/operlog/clean")
def monitor_operlog_clean(db: Session = Depends(get_db)):
    db.execute(text("delete from sys_oper_log"))
    db.commit()
    return success()


@router.delete("/monitor/logininfor/clean")
def monitor_logininfor_clean(db: Session = Depends(get_db)):
    db.execute(text("delete from sys_logininfor"))
    db.commit()
    return success()


@router.delete("/monitor/jobLog/clean")
def monitor_job_log_clean(db: Session = Depends(get_db)):
    db.execute(text("delete from sys_job_log"))
    db.commit()
    return success()


@router.get("/monitor/logininfor/unlock/{user_name}")
def monitor_logininfor_unlock(user_name: str, redis: Redis | None = Depends(get_redis)):
    if redis:
        redis.delete(f"qkeer:pwd_err_cnt:{user_name}")
    return success()


@router.get("/monitor/online/list")
def monitor_online_list(redis: Redis | None = Depends(get_redis)):
    if redis is None:
        return table([], 0)
    rows = []
    for key in redis.keys("qkeer:login_tokens:*"):
        raw = redis.get(key)
        if raw is None:
            continue
        try:
            payload = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        except Exception:
            continue
        user = payload.get("user") or {}
        token_id = str(key.decode("utf-8") if isinstance(key, bytes) else key).replace("qkeer:login_tokens:", "")
        rows.append({
            "tokenId": token_id,
            "userName": user.get("userName") or user.get("phone") or user.get("nickName"),
            "deptName": user.get("deptName"),
            "ipaddr": user.get("loginIp") or user.get("lastIp"),
            "loginLocation": "",
            "browser": "",
            "os": "",
            "loginTime": payload.get("loginTime"),
        })
    return table(rows, len(rows))


@router.delete("/monitor/online/{token_id}")
def monitor_online_logout(token_id: str, redis: Redis | None = Depends(get_redis)):
    if redis:
        redis.delete(f"qkeer:login_tokens:{token_id}")
    return success()


@router.get("/monitor/cache")
def monitor_cache(redis: Redis | None = Depends(get_redis)):
    info = redis.info() if redis else {}
    db_size = redis.dbsize() if redis else 0
    return success({"info": info, "dbSize": db_size, "commandStats": []})


@router.get("/monitor/cache/getNames")
def monitor_cache_names():
    return success([{"cacheName": "qkeer:login_tokens:", "remark": "登录用户"}, {"cacheName": "qkeer:captcha_codes:", "remark": "验证码"}])


@router.get("/monitor/cache/getKeys/{cache_name:path}")
def monitor_cache_keys(cache_name: str, redis: Redis | None = Depends(get_redis)):
    if not redis:
        return success([])
    return success([key.decode("utf-8") if isinstance(key, bytes) else key for key in redis.keys(f"{cache_name}*")])


@router.get("/monitor/cache/getValue/{cache_name:path}/{cache_key:path}")
def monitor_cache_value(cache_name: str, cache_key: str, redis: Redis | None = Depends(get_redis)):
    key = cache_key if cache_key.startswith(cache_name) else f"{cache_name}{cache_key}"
    value = redis.get(key) if redis else None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    return success({"cacheName": cache_name, "cacheKey": cache_key, "cacheValue": value})


@router.delete("/monitor/cache/clearCacheName/{cache_name:path}")
def monitor_cache_clear_name(cache_name: str, redis: Redis | None = Depends(get_redis)):
    if redis:
        for key in redis.keys(f"{cache_name}*"):
            redis.delete(key)
    return success()


@router.delete("/monitor/cache/clearCacheKey/{cache_key:path}")
def monitor_cache_clear_key(cache_key: str, redis: Redis | None = Depends(get_redis)):
    if redis:
        redis.delete(cache_key)
    return success()


@router.delete("/monitor/cache/clearCacheAll")
def monitor_cache_clear_all(redis: Redis | None = Depends(get_redis)):
    if redis:
        redis.flushdb()
    return success()


@router.get("/monitor/server")
def monitor_server():
    return success(server_monitor.server_info())


@router.get("/system/backups/list")
def backup_table_list(request: Request, db: Session = Depends(get_db)):
    query = dict(request.query_params)
    page_num = int(query.get("pageNum", 1) or 1)
    page_size = int(query.get("pageSize", 10) or 10)
    rows, total = admin_backup.list_tables(db, query.get("name"), page_num, page_size)
    return table(rows, total)


@router.post("/system/backups/choice")
async def backup_selected_tables(request: Request):
    form = await request.form()
    names = [str(item) for item in [*form.getlist("name"), *form.getlist("name[]")]]
    target = admin_backup.create_backup(names)
    return FileResponse(target, media_type="application/octet-stream", filename=target.name)


@router.post("/system/backups/onekey")
def backup_all_tables():
    target = admin_backup.create_backup()
    return FileResponse(target, media_type="application/octet-stream", filename=target.name)


@router.get("/system/backups/download")
def backup_download():
    target = admin_backup.backup_path()
    if not target.exists():
        return error("暂无可下载的数据库备份")
    return FileResponse(target, media_type="application/octet-stream", filename=target.name)


@router.post("/system/backups/reduction/implement")
async def backup_restore(file: UploadFile | None = None):
    if file is None:
        return error("请选择 .sql 备份文件")
    admin_backup.restore_backup(await file.read(), file.filename)
    return success()


@router.get("/{resource:path}/list")
def generic_list(resource: str, request: Request, db: Session = Depends(get_db)):
    config = CRUD_RESOURCES.get(resource)
    if not config:
        return not_migrated(f"/admin/{resource}/list")
    query = dict(request.query_params)
    page_num = int(query.pop("pageNum", 1) or 1)
    page_size = int(query.pop("pageSize", 10) or 10)
    for alias, field in config.get("aliases", {}).items():
        alias_value = query.pop(alias, None)
        if alias_value not in (None, "") and query.get(field) in (None, ""):
            query[field] = alias_value
    rows, total = list_rows(db, config["table"], query, page_num, page_size, config.get("like", set()))
    if resource == "device":
        ensure_rows_qrcode(rows)
    return table(rows, total)


@router.get("/{resource:path}/{row_id}")
def generic_get(resource: str, row_id: str, db: Session = Depends(get_db)):
    config = CRUD_RESOURCES.get(resource)
    if not config:
        return not_migrated(f"/admin/{resource}/{row_id}")
    return success(get_row(db, config["table"], row_id))


@router.post("/{resource:path}")
async def generic_create(resource: str, request: Request, db: Session = Depends(get_db)):
    config = CRUD_RESOURCES.get(resource)
    if not config:
        return not_migrated(f"/admin/{resource}")
    payload = await request.json()
    if resource == "device":
        payload = ensure_payload_qrcode(payload)
    return success() if create_row(db, config["table"], payload) > 0 else error()


@router.put("/{resource:path}")
async def generic_update(resource: str, request: Request, db: Session = Depends(get_db)):
    config = CRUD_RESOURCES.get(resource)
    if not config:
        return not_migrated(f"/admin/{resource}")
    payload = await request.json()
    if resource == "device":
        payload = ensure_payload_qrcode(payload)
    return success() if update_row(db, config["table"], payload) > 0 else error()


@router.delete("/{resource:path}/{ids}")
def generic_delete(resource: str, ids: str, db: Session = Depends(get_db)):
    config = CRUD_RESOURCES.get(resource)
    if not config:
        return not_migrated(f"/admin/{resource}/{ids}")
    return success() if delete_rows(db, config["table"], ids) > 0 else error()
