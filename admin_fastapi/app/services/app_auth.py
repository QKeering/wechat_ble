import json
import random
import string
import time
from datetime import date, datetime
from typing import Any
from uuid import uuid4

import jwt
from redis import Redis
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import strip_token
from app.services.crud import camelize_dict, clean_payload, get_table

LOGIN_TOKEN_KEY = "qkeer:login_tokens:"
PHONE_CODE_KEY = "qkeer:app_phone_code:"
DEVICE_LINK_SERVICE_KEY = "qkeer:device_link_service:"
DEVICE_NAME_KEY = "qkeer:device_name:"


class AppAuthError(Exception):
    pass


def row_to_user(row: Any) -> dict[str, Any] | None:
    return camelize_dict(dict(row._mapping)) if row else None


def user_by_id(db: Session, user_id: int) -> dict[str, Any] | None:
    row = db.execute(text("select * from app_user where id=:id and del_flag=0"), {"id": user_id}).first()
    return row_to_user(row)


def user_by_open_id(db: Session, open_id: str) -> dict[str, Any] | None:
    row = db.execute(text("select * from app_user where open_id=:open_id and del_flag=0 limit 1"), {"open_id": open_id}).first()
    return row_to_user(row)


def user_by_phone(db: Session, phone: str) -> dict[str, Any] | None:
    row = db.execute(text("select * from app_user where phone=:phone and del_flag=0 limit 1"), {"phone": phone}).first()
    return row_to_user(row)


def default_code(phone: str | None = None) -> str:
    tail = (phone or "0000")[-4:]
    return "RING" + tail + "".join(random.choice(string.digits) for _ in range(4))


def create_user(db: Session, open_id: str | None = None, phone: str | None = None) -> dict[str, Any]:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    tail = (phone or open_id or "0000")[-4:]
    values = {
        "code": default_code(phone or open_id),
        "open_id": open_id,
        "phone": phone,
        "nick_name": f"用户{tail}",
        "sex": 2,
        "birthday": date(1990, 1, 1),
        "height": 170,
        "weight": 65,
        "status": 0,
        "avatar": f"/profile/state/avatar/avatar{random.randint(0, 8):02d}.png",
        "register_time": now,
        "create_time": now,
        "update_time": now,
    }
    table = get_table("app_user")
    result = db.execute(table.insert().values(**values))
    user_id = int(result.inserted_primary_key[0])
    init_user_defaults(db, user_id)
    db.commit()
    user = user_by_id(db, user_id)
    if not user:
        raise AppAuthError("用户创建失败")
    return user


def init_user_defaults(db: Session, user_id: int) -> None:
    if db.execute(text("select count(*) from user_goal where user_id=:user_id"), {"user_id": user_id}).scalar() == 0:
        db.execute(
            text("insert into user_goal(user_id, sleep, step, calorie, motion_time) values(:user_id, 8, 8000, 300, 30)"),
            {"user_id": user_id},
        )
    if db.execute(text("select count(*) from user_card_config where user_id=:user_id"), {"user_id": user_id}).scalar() == 0:
        defaults = [
            ("HEALTH", "sleep", 1, 1),
            ("HEALTH", "heartRate", 1, 2),
            ("HEALTH", "bloodOxygen", 1, 3),
            ("ACTIVITY", "step", 1, 1),
        ]
        for card_group, item_key, enable, card_order in defaults:
            db.execute(
                text(
                    """
                    insert into user_card_config(user_id, card_group, item_key, enable, card_order)
                    values(:user_id, :card_group, :item_key, :enable, :card_order)
                    """
                ),
                {"user_id": user_id, "card_group": card_group, "item_key": item_key, "enable": enable, "card_order": card_order},
            )


def create_token(redis: Redis | None, user: dict[str, Any]) -> str:
    token_uuid = str(uuid4())
    login_time = int(time.time() * 1000)
    expire_time = login_time + settings.app_token_expire_minutes * 60 * 1000
    token = jwt.encode({"app_login_user_key": token_uuid, "sub": user.get("phone") or user.get("openId") or str(user["id"])}, settings.token_secret, algorithm="HS512")
    payload = {
        "userId": user["id"],
        "token": token_uuid,
        "loginTime": login_time,
        "expireTime": expire_time,
        "user": user,
        "permissions": [],
    }
    if redis:
        redis.setex(f"{LOGIN_TOKEN_KEY}{token_uuid}", settings.app_token_expire_minutes * 60, json.dumps(payload, ensure_ascii=False, default=str))
    return token


def record_login(db: Session, user_id: int, ip: str | None = None) -> None:
    db.execute(
        text("update app_user set last_ip=:ip, last_login_time=now(), update_time=now() where id=:id"),
        {"id": user_id, "ip": ip or ""},
    )
    db.commit()


def login_by_phone(db: Session, redis: Redis | None, phone: str, code: str | None, open_id_code: str | None, ip: str | None = None) -> str:
    if redis is None:
        raise AppAuthError("验证码服务不可用")
    if redis.get(f"{PHONE_CODE_KEY}{phone}") is None:
        raise AppAuthError("验证码已失效")
    if redis:
        cached = redis.get(f"{PHONE_CODE_KEY}{phone}")
        if cached is not None:
            expected = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
            if str(code or "") != expected:
                raise AppAuthError("验证码错误")
            redis.delete(f"{PHONE_CODE_KEY}{phone}")
    user = user_by_phone(db, phone)
    open_id = open_id_code or phone
    if not user:
        user = create_user(db, open_id=open_id, phone=phone)
    elif open_id and user.get("openId") != open_id:
        db.execute(text("update app_user set open_id=:open_id where id=:id"), {"open_id": open_id, "id": user["id"]})
        db.commit()
        user = user_by_id(db, int(user["id"])) or user
    record_login(db, int(user["id"]), ip)
    return create_token(redis, user)


def login_by_open_id(db: Session, redis: Redis | None, open_id: str, ip: str | None = None) -> str:
    user = user_by_open_id(db, open_id)
    if not user:
        user = create_user(db, open_id=open_id)
    record_login(db, int(user["id"]), ip)
    return create_token(redis, user)


def login_by_wechat_identity(db: Session, redis: Redis | None, open_id: str, phone: str, ip: str | None = None) -> str:
    if not open_id:
        raise AppAuthError("openid不能为空")
    if not phone:
        raise AppAuthError("手机号不能为空")
    user = user_by_phone(db, phone)
    if not user:
        user = create_user(db, open_id=open_id, phone=phone)
    elif open_id and user.get("openId") != open_id:
        db.execute(text("update app_user set open_id=:open_id where id=:id"), {"open_id": open_id, "id": user["id"]})
        db.commit()
        user = user_by_id(db, int(user["id"])) or user
    record_login(db, int(user["id"]), ip)
    return create_token(redis, user)


def current_user(db: Session, redis: Redis | None, token: str | None) -> dict[str, Any]:
    token = strip_token(token)
    if not token:
        raise AppAuthError("未登录或登录已过期")
    try:
        claims = jwt.decode(token, settings.token_secret, algorithms=["HS512"])
    except jwt.InvalidTokenError as exc:
        raise AppAuthError("登录状态已失效") from exc
    user_key = claims.get("app_login_user_key") or claims.get("login_user_key")
    subject = claims.get("sub")
    if not user_key or redis is None or redis.get(f"{LOGIN_TOKEN_KEY}{user_key}") is None:
        raise AppAuthError("登录状态已失效")
    if not user_key and not subject:
        raise AppAuthError("无效 token")
    if subject and subject.isdigit() and len(subject) < 10:
        user = user_by_id(db, int(subject))
    elif subject:
        user = user_by_phone(db, subject) or user_by_open_id(db, subject)
    else:
        user = None
    if not user:
        raise AppAuthError("登录用户不存在")
    return user


def update_current_user(db: Session, user_id: int, payload: dict[str, Any]) -> int:
    table = get_table("app_user")
    allowed = {key: value for key, value in payload.items() if key in {"avatar", "nickName", "birthday", "sex", "height", "weight"}}
    values = clean_payload(table, allowed)
    db.execute(table.update().where(table.c.id == user_id).values(**values))
    db.commit()
    return 1
