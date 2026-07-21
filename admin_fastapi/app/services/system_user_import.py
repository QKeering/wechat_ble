from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import auth
from app.services.crud import clean_payload, get_table
from app.services.device_import import _read_xlsx, _write_xlsx

USER_COLUMNS = [
    ("用户名", "userName"),
    ("用户昵称", "nickName"),
    ("部门编号", "deptId"),
    ("手机号码", "phonenumber"),
    ("邮箱", "email"),
    ("性别", "sex"),
    ("状态", "status"),
]
HEADER_ALIASES = {label: key for label, key in USER_COLUMNS}
HEADER_ALIASES.update({key: key for _, key in USER_COLUMNS})
HEADER_ALIASES.update({"user_name": "userName", "nick_name": "nickName", "dept_id": "deptId", "phone": "phonenumber"})


def system_user_template_xlsx() -> bytes:
    return _write_xlsx([[label for label, _ in USER_COLUMNS]])


def import_system_users_xlsx(db: Session, content: bytes, update_support: bool, operator: str = "admin") -> str:
    rows = _read_xlsx(content)
    if not rows:
        raise ValueError("导入文件没有用户数据")
    table = get_table("sys_user")
    initial_password = auth.config_value(db, "sys.user.initPassword", "123456") or "123456"
    processed = 0
    errors = []
    for index, row in enumerate(rows, start=2):
        payload = {HEADER_ALIASES[key]: value for key, value in row.items() if key in HEADER_ALIASES and value not in ("", None)}
        try:
            _validate_user(payload)
            username = str(payload["userName"]).strip()
            existing = db.execute(text("select user_id from sys_user where user_name=:username limit 1"), {"username": username}).scalar()
            values = clean_payload(table, payload)
            values["update_by" if existing else "create_by"] = operator
            if existing:
                if not update_support:
                    raise ValueError(f"用户 {username} 已存在")
                values.pop("user_name", None)
                db.execute(table.update().where(table.c.user_id == existing).values(**values))
            else:
                values.setdefault("password", auth.hash_password(initial_password))
                values.setdefault("del_flag", "0")
                values.setdefault("status", "0")
                values.setdefault("nick_name", username)
                db.execute(table.insert().values(**values))
            processed += 1
        except Exception as exc:
            errors.append(f"第 {index} 行: {exc}")
    if errors:
        db.rollback()
        raise ValueError("导入失败，未写入任何数据: " + "; ".join(errors))
    db.commit()
    return f"导入完成，共处理 {processed} 条用户数据"


def _validate_user(payload: dict[str, Any]) -> None:
    username = str(payload.get("userName") or "").strip()
    nickname = str(payload.get("nickName") or username).strip()
    if not 2 <= len(username) <= 20:
        raise ValueError("用户名长度必须在 2 到 20 个字符之间")
    if not nickname:
        raise ValueError("用户昵称不能为空")
    payload["userName"] = username
    payload["nickName"] = nickname
    if payload.get("deptId") not in (None, ""):
        payload["deptId"] = int(payload["deptId"])
    if payload.get("sex") not in (None, ""):
        payload["sex"] = str(payload["sex"])
    if payload.get("status") not in (None, ""):
        payload["status"] = str(payload["status"])
