import base64
import io
import json
import random
import re
import string
import time
import uuid
from datetime import datetime
from typing import Any

import bcrypt
import jwt
from redis import Redis
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings

CAPTCHA_CODE_KEY = "qkeer:captcha_codes:"
LOGIN_TOKEN_KEY = "qkeer:login_tokens:"
PWD_ERR_CNT_KEY = "qkeer:pwd_err_cnt:"

class LoginError(Exception):
    pass


def now_ms() -> int:
    return int(time.time() * 1000)


def to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def camelize_row(row: Any) -> dict[str, Any]:
    data = dict(row._mapping if hasattr(row, "_mapping") else row)
    result = {}
    for key, value in data.items():
        if isinstance(value, datetime):
            value = value.strftime("%Y-%m-%d %H:%M:%S")
        result[to_camel(key)] = value
    return result


def config_value(db: Session, key: str, default: str | None = None) -> str | None:
    value = db.execute(text("select config_value from sys_config where config_key=:key limit 1"), {"key": key}).scalar()
    return value if value is not None else default


def captcha_enabled(db: Session) -> bool:
    return str(config_value(db, "sys.account.captchaEnabled", "true")).lower() == "true"


def generate_captcha_image(code: str) -> str:
    noise = "\n".join(
        f"<circle cx='{random.randint(0, 120)}' cy='{random.randint(0, 38)}' r='1' fill='#{random.randint(0x999999, 0xdddddd):06x}'/>"
        for _ in range(35)
    )
    chars = "\n".join(
        f"<text x='{18 + index * 22}' y='{25 + random.randint(-2, 2)}' "
        f"font-size='20' font-family='Arial' font-weight='700' "
        f"fill='#{random.randint(0x225599, 0x3366cc):06x}' "
        f"transform='rotate({random.randint(-10, 10)} {18 + index * 22},22)'>{char}</text>"
        for index, char in enumerate(code)
    )
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='38' viewBox='0 0 120 38'>"
        "<rect width='120' height='38' rx='4' fill='#f7fbff'/>"
        f"{noise}{chars}"
        "<line x1='8' y1='28' x2='112' y2='10' stroke='#7aa7dc' stroke-width='1' opacity='.55'/>"
        "</svg>"
    )
    return base64.b64encode(svg.encode("utf-8")).decode("ascii")


def create_captcha(db: Session, redis: Redis | None) -> dict[str, Any]:
    enabled = captcha_enabled(db)
    payload: dict[str, Any] = {"captchaEnabled": enabled}
    if not enabled:
        return payload
    code = "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    captcha_uuid = uuid.uuid4().hex
    if redis is not None:
        redis.setex(f"{CAPTCHA_CODE_KEY}{captcha_uuid}", 120, code)
    payload["uuid"] = captcha_uuid
    payload["img"] = generate_captcha_image(code)
    return payload


def validate_captcha(db: Session, redis: Redis | None, code: str | None, captcha_uuid: str | None) -> None:
    if not captcha_enabled(db):
        return
    if redis is None:
        raise LoginError("验证码服务不可用")
    key = f"{CAPTCHA_CODE_KEY}{captcha_uuid or ''}"
    cached = redis.get(key)
    if cached is None:
        raise LoginError("验证码已失效")
    redis.delete(key)
    expected = cached.decode("utf-8") if isinstance(cached, bytes) else str(cached)
    if not code or code.lower() != expected.lower():
        raise LoginError("验证码错误")


def select_user_by_username(db: Session, username: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            select u.*, d.dept_name, d.parent_id as dept_parent_id, d.ancestors as dept_ancestors,
                   d.order_num as dept_order_num, d.leader as dept_leader, d.status as dept_status
            from sys_user u
            left join sys_dept d on u.dept_id = d.dept_id
            where u.user_name = :username and u.del_flag = '0'
            limit 1
            """
        ),
        {"username": username},
    ).first()
    return camelize_row(row) if row else None


def select_roles(db: Session, user_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select r.*
            from sys_role r
            inner join sys_user_role ur on ur.role_id = r.role_id
            where ur.user_id = :user_id and r.del_flag = '0'
            order by r.role_sort
            """
        ),
        {"user_id": user_id},
    ).all()
    return [camelize_row(row) for row in rows]


def role_permissions(db: Session, user_id: int) -> list[str]:
    if user_id == 1:
        return ["admin"]
    rows = db.execute(
        text(
            """
            select distinct r.role_key
            from sys_role r
            inner join sys_user_role ur on ur.role_id = r.role_id
            where ur.user_id = :user_id and r.status = '0' and r.del_flag = '0'
            """
        ),
        {"user_id": user_id},
    ).scalars()
    return [item for item in rows if item]


def menu_permissions(db: Session, user_id: int) -> list[str]:
    if user_id == 1:
        return ["*:*:*"]
    rows = db.execute(
        text(
            """
            select distinct m.perms
            from sys_menu m
            left join sys_role_menu rm on m.menu_id = rm.menu_id
            left join sys_user_role ur on rm.role_id = ur.role_id
            left join sys_role r on r.role_id = ur.role_id
            where m.status = '0' and r.status = '0' and ur.user_id = :user_id and ifnull(m.perms, '') <> ''
            """
        ),
        {"user_id": user_id},
    ).scalars()
    return [item for item in rows if item]


def verify_password(redis: Redis | None, username: str, password: str, encoded: str) -> None:
    if not username or not password:
        raise LoginError("用户名或密码不能为空")
    if len(username) < 2 or len(username) > 20 or len(password) < 5 or len(password) > 20:
        raise LoginError("用户名或密码错误")
    retry_key = f"{PWD_ERR_CNT_KEY}{username}"
    retry_count = int(redis.get(retry_key) or 0) if redis else 0
    if retry_count >= 5:
        raise LoginError("密码输入错误次数过多，请10分钟后再试")
    if not bcrypt.checkpw(password.encode("utf-8"), encoded.encode("utf-8")):
        if redis:
            redis.setex(retry_key, 600, retry_count + 1)
        raise LoginError("用户名或密码错误")
    if redis:
        redis.delete(retry_key)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_token(redis: Redis | None, user: dict[str, Any], permissions: list[str]) -> str:
    token_uuid = str(uuid.uuid4())
    login_time = now_ms()
    expire_time = login_time + settings.admin_token_expire_minutes * 60 * 1000
    claims = {"login_user_key": token_uuid, "sub": user.get("userName")}
    token = jwt.encode(claims, settings.token_secret, algorithm="HS512")
    payload = {
        "userId": user.get("userId"),
        "deptId": user.get("deptId"),
        "token": token_uuid,
        "loginTime": login_time,
        "expireTime": expire_time,
        "user": user,
        "permissions": permissions,
    }
    if redis:
        redis.setex(f"{LOGIN_TOKEN_KEY}{token_uuid}", settings.admin_token_expire_minutes * 60, json.dumps(payload, ensure_ascii=False, default=str))
    return token


def login(db: Session, redis: Redis | None, body: dict[str, Any], ip: str | None = None) -> str:
    username = str(body.get("username") or "").strip()
    password = str(body.get("password") or "")
    validate_captcha(db, redis, body.get("code"), body.get("uuid"))
    black_ips = config_value(db, "sys.login.blackIPList", "") or ""
    if ip and black_ips and any(pattern and re.fullmatch(pattern.replace("*", ".*"), ip) for pattern in black_ips.split(",")):
        raise LoginError("当前 IP 禁止登录")
    user = select_user_by_username(db, username)
    if not user:
        raise LoginError("用户不存在或密码错误")
    if str(user.get("status")) == "1":
        raise LoginError("用户已停用")
    verify_password(redis, username, password, user.get("password") or "")
    permissions = menu_permissions(db, int(user["userId"]))
    db.execute(text("update sys_user set login_ip=:ip, login_date=sysdate() where user_id=:user_id"), {"ip": ip or "", "user_id": user["userId"]})
    db.commit()
    return create_token(redis, user, permissions)


def user_from_token(db: Session, token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(token, settings.token_secret, algorithms=["HS512"])
    except jwt.InvalidTokenError as exc:
        raise LoginError("登录状态已失效") from exc
    username = claims.get("sub")
    if not username:
        raise LoginError("登录状态已失效")
    user = select_user_by_username(db, username)
    if not user:
        raise LoginError("登录用户不存在")
    return user


def token_uuid(token: str) -> str | None:
    try:
        claims = jwt.decode(token, settings.token_secret, algorithms=["HS512"])
    except jwt.InvalidTokenError as exc:
        raise LoginError("登录状态已失效") from exc
    return claims.get("login_user_key")


def without_password(user: dict[str, Any]) -> dict[str, Any]:
    result = dict(user)
    result.pop("password", None)
    return result


def get_info(db: Session, user: dict[str, Any]) -> dict[str, Any]:
    roles = role_permissions(db, int(user["userId"]))
    permissions = menu_permissions(db, int(user["userId"]))
    user = without_password(user)
    user["roles"] = select_roles(db, int(user["userId"]))
    return {
        "user": user,
        "roles": roles,
        "permissions": permissions,
        "isDefaultModifyPwd": config_value(db, "sys.account.initPasswordModify", "0") == "1" and not user.get("pwdUpdateDate"),
        "isPasswordExpired": False,
    }


def select_menu_rows(db: Session, user_id: int) -> list[dict[str, Any]]:
    if user_id == 1:
        query = """
            select distinct m.menu_id, m.parent_id, m.menu_name, m.path, m.component, m.`query`, m.route_name,
                   m.visible, m.status, ifnull(m.perms,'') as perms, m.is_frame, m.is_cache, m.menu_type,
                   m.icon, m.order_num, m.create_time
            from sys_menu m
            where m.menu_type in ('M', 'C') and m.status = 0
            order by m.parent_id, m.order_num
        """
        rows = db.execute(text(query)).all()
    else:
        query = """
            select distinct m.menu_id, m.parent_id, m.menu_name, m.path, m.component, m.`query`, m.route_name,
                   m.visible, m.status, ifnull(m.perms,'') as perms, m.is_frame, m.is_cache, m.menu_type,
                   m.icon, m.order_num, m.create_time
            from sys_menu m
            left join sys_role_menu rm on m.menu_id = rm.menu_id
            left join sys_user_role ur on rm.role_id = ur.role_id
            left join sys_role ro on ur.role_id = ro.role_id
            left join sys_user u on ur.user_id = u.user_id
            where u.user_id = :user_id and m.menu_type in ('M', 'C') and m.status = 0 and ro.status = 0
            order by m.parent_id, m.order_num
        """
        rows = db.execute(text(query), {"user_id": user_id}).all()
    return [camelize_row(row) for row in rows]


def capitalize(value: str | None) -> str:
    if not value:
        return ""
    return value[:1].upper() + value[1:]


def is_http(path: str | None) -> bool:
    return bool(path and (path.startswith("http://") or path.startswith("https://")))


def inner_link_replace(path: str) -> str:
    for old, new in (("http://", ""), ("https://", ""), ("www.", ""), (".", "/"), (":", "/")):
        path = path.replace(old, new)
    return path


def is_menu_frame(menu: dict[str, Any]) -> bool:
    return int(menu.get("parentId") or 0) == 0 and menu.get("menuType") == "C" and str(menu.get("isFrame")) == "1"


def is_inner_link(menu: dict[str, Any]) -> bool:
    return str(menu.get("isFrame")) == "1" and is_http(menu.get("path"))


def is_parent_view(menu: dict[str, Any]) -> bool:
    return int(menu.get("parentId") or 0) != 0 and menu.get("menuType") == "M"


def route_name(menu: dict[str, Any], path: str | None = None) -> str:
    if path is None and is_menu_frame(menu):
        return ""
    return capitalize(menu.get("routeName") or path or menu.get("path"))


def router_path(menu: dict[str, Any]) -> str:
    path = menu.get("path") or ""
    if int(menu.get("parentId") or 0) != 0 and is_inner_link(menu):
        path = inner_link_replace(path)
    if int(menu.get("parentId") or 0) == 0 and menu.get("menuType") == "M" and str(menu.get("isFrame")) == "1":
        path = "/" + path
    elif is_menu_frame(menu):
        path = "/"
    return path


def component(menu: dict[str, Any]) -> str:
    comp = menu.get("component")
    if comp and not is_menu_frame(menu):
        return comp
    if not comp and int(menu.get("parentId") or 0) != 0 and is_inner_link(menu):
        return "InnerLink"
    if not comp and is_parent_view(menu):
        return "ParentView"
    return "Layout"


def menu_tree(menus: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_parent: dict[int, list[dict[str, Any]]] = {}
    ids = {int(item["menuId"]) for item in menus}
    for item in menus:
        by_parent.setdefault(int(item.get("parentId") or 0), []).append(item)

    def attach(item: dict[str, Any]) -> dict[str, Any]:
        children = [attach(child) for child in by_parent.get(int(item["menuId"]), [])]
        if children:
            item["children"] = children
        return item

    roots = [item for item in menus if int(item.get("parentId") or 0) not in ids]
    return [attach(item) for item in roots] or menus


def meta(menu: dict[str, Any], link: str | None = None) -> dict[str, Any]:
    value = {"title": menu.get("menuName"), "icon": menu.get("icon"), "noCache": str(menu.get("isCache")) == "1"}
    target = link if link is not None else menu.get("path")
    if is_http(target):
        value["link"] = target
    return value


def build_routers(menus: list[dict[str, Any]]) -> list[dict[str, Any]]:
    routers = []
    for menu in menus:
        router = {
            "hidden": str(menu.get("visible")) == "1",
            "name": route_name(menu),
            "path": router_path(menu),
            "component": component(menu),
            "query": menu.get("query"),
            "meta": meta(menu),
        }
        children = menu.get("children") or []
        if children and menu.get("menuType") == "M":
            router["alwaysShow"] = True
            router["redirect"] = "noRedirect"
            router["children"] = build_routers(children)
        elif is_menu_frame(menu):
            router["meta"] = None
            router["children"] = [{
                "path": menu.get("path"),
                "component": menu.get("component"),
                "name": route_name(menu, menu.get("path")),
                "meta": meta(menu),
                "query": menu.get("query"),
            }]
        elif int(menu.get("parentId") or 0) == 0 and is_inner_link(menu):
            path = inner_link_replace(menu.get("path") or "")
            router["meta"] = {"title": menu.get("menuName"), "icon": menu.get("icon")}
            router["path"] = "/"
            router["children"] = [{
                "path": path,
                "component": "InnerLink",
                "name": route_name(menu, path),
                "meta": meta(menu, menu.get("path")),
            }]
        routers.append({key: value for key, value in router.items() if value not in (None, "", [])})
    return routers


def get_routers(db: Session, user: dict[str, Any]) -> list[dict[str, Any]]:
    return build_routers(menu_tree(select_menu_rows(db, int(user["userId"]))))
