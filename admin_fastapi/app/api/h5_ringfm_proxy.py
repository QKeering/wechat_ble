"""Same-origin H5 proxy using a short-lived HMAC service identity."""

import hashlib
import hmac
import json
import logging
import secrets
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, Depends, Request

from app.api.app import app_user
from app.core.config import settings
from app.core.responses import error, success


router = APIRouter(prefix="/h5/xiaoqing/ringfm", tags=["h5-ringfm-proxy"])
logger = logging.getLogger("qkeer.ringfm_bridge")
SUPPORTED_DAYS = {7, 15, 30, 90}


def _signed_headers(method: str, path: str, user_id: int) -> dict[str, str]:
    secret = settings.ringfm_bridge_secret.strip()
    if not secret:
        raise RuntimeError("RINGFM_BRIDGE_SECRET 未配置")
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    canonical_path = urlsplit(path).path
    canonical = "\n".join((method.upper(), canonical_path, str(user_id), timestamp, nonce))
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-QKeer-User-Id": str(user_id),
        "X-QKeer-Timestamp": timestamp,
        "X-QKeer-Nonce": nonce,
        "X-QKeer-Signature": signature,
    }


def _proxy(path: str, user_id: int, method: str = "GET", body: dict | None = None):
    encoded_body = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    try:
        headers = _signed_headers(method, path, user_id)
    except RuntimeError as exc:
        return error(str(exc), code=503)
    request = UrlRequest(
        f"{settings.ringfm_base_url.rstrip('/')}{path}",
        data=encoded_body,
        method=method,
        headers=headers,
    )
    try:
        with urlopen(request, timeout=settings.ringfm_timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
            return success(payload)
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
            detail = payload.get("detail") or payload.get("message") or f"ringfm_http_{exc.code}"
        except (ValueError, json.JSONDecodeError):
            detail = f"ringfm_http_{exc.code}"
        return error(str(detail), code=int(exc.code))
    except (URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        logger.warning(
            "RingFM bridge unavailable error_type=%s method=%s path=%s user_id=%s",
            type(exc).__name__,
            method.upper(),
            urlsplit(path).path,
            user_id,
        )
        return error("RingFM 服务暂时不可用", code=502)


@router.get("/catalog")
def catalog(user: dict = Depends(app_user)):
    return _proxy("/v1/me/ringfm/catalog", int(user["id"]))


@router.get("/dashboard")
def dashboard(days: int = 30, user: dict = Depends(app_user)):
    if days not in SUPPORTED_DAYS:
        return error("invalid_observation_window", code=422)
    return _proxy(f"/v1/me/ringfm/dashboard?{urlencode({'days': days})}", int(user["id"]))


@router.get("/diseases/{disease_id}")
def disease(disease_id: str, days: int = 30, user: dict = Depends(app_user)):
    if days not in SUPPORTED_DAYS:
        return error("invalid_observation_window", code=422)
    safe_id = quote(disease_id, safe="")
    return _proxy(f"/v1/me/ringfm/diseases/{safe_id}?{urlencode({'days': days})}", int(user["id"]))


@router.post("/diseases/{disease_id}/explanation")
async def explanation(disease_id: str, request: Request, user: dict = Depends(app_user)):
    safe_id = quote(disease_id, safe="")
    body = await request.json()
    return _proxy(
        f"/v1/me/ringfm/diseases/{safe_id}/explanation",
        int(user["id"]),
        method="POST",
        body=body,
    )
