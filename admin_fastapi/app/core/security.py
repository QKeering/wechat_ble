from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Header
from redis import Redis

from app.core.config import settings

LOGIN_TOKEN_KEY = "qkeer:login_tokens:"
LOGIN_USER_CLAIM = "login_user_key"
APP_LOGIN_USER_CLAIM = "app_login_user_key"


class AuthError(Exception):
    pass


@dataclass
class CurrentUser:
    token_uuid: str
    username: str | None
    raw_claims: dict[str, Any]
    redis_payload: Any | None = None


def strip_token(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    prefix = (settings.token_prefix or "").strip()
    if prefix and value.lower().startswith(prefix.lower()):
        return value[len(prefix):].strip()
    return value


def decode_java_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.token_secret, algorithms=["HS512"])


def resolve_current_user(token: str, redis: Redis | None = None) -> CurrentUser:
    claims = decode_java_token(token)
    token_uuid = claims.get(LOGIN_USER_CLAIM) or claims.get(APP_LOGIN_USER_CLAIM)
    if not token_uuid:
        raise AuthError("无效 token")
    redis_payload = redis.get(f"{LOGIN_TOKEN_KEY}{token_uuid}") if redis else None
    return CurrentUser(
        token_uuid=token_uuid,
        username=claims.get("sub"),
        raw_claims=claims,
        redis_payload=redis_payload,
    )


def read_request_token(
    authorization: str | None = Header(default=None, alias="Authorization"),
    token: str | None = Header(default=None, alias="token"),
) -> str | None:
    return strip_token(authorization or token)
