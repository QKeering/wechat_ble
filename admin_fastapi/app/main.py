from pathlib import Path
import logging

import jwt
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.admin import router as admin_router
from app.api.app import router as app_router
from app.api.common import router as common_router
from app.api.migration import router as migration_router
from app.api.rw_debug import initialize_rw_debug_schema
from app.api.rw_debug import router as rw_debug_router
from app.api.sleepfm import router as sleepfm_router
from app.api.v1 import router as v1_router
from app.core.config import settings
from app.core.responses import error
from app.core.security import LOGIN_USER_CLAIM, decode_java_token, strip_token
from app.db.redis import redis_client
from app.services.app_auth import AppAuthError
from app.services.ai_growth import initialize_schema as initialize_ai_growth_schema
from app.services.ai_lab import initialize_schema as initialize_ai_lab_schema
from app.services.family import initialize_schema as initialize_family_schema
from app.services.feedback import initialize_schema as initialize_feedback_schema
from app.services.health import initialize_health_schema
from app.db.session import SessionLocal

logger = logging.getLogger("qkeer.app")


PUBLIC_ADMIN_PATHS = {
    "/admin",
    "/admin/captchaImage",
    "/admin/login",
    "/admin/register",
}
PUBLIC_ADMIN_PREFIXES = (
    "/admin/files/",
)
PROTECTED_ADMIN_PREFIXES = (
    "/admin",
    "/common/",
)
API_PREFIX = "/api"
API_ADMIN_COMPAT_PREFIXES = (
    "/api/admin",
    "/api/common/",
    "/api/system/",
    "/api/monitor/",
    "/api/tool/",
)


def create_app() -> FastAPI:
    try:
        initialize_ai_lab_schema()
        initialize_ai_growth_schema()
        with SessionLocal() as db:
            initialize_health_schema(db)
            initialize_feedback_schema(db)
            initialize_family_schema(db)
            initialize_rw_debug_schema(db)
    except Exception as exc:
        logger.exception("startup schema initialization failed: %s", exc)
    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def ruoyi_admin_path_compat(request: Request, call_next):
        if request.url.path.startswith(API_ADMIN_COMPAT_PREFIXES):
            compat_path = request.url.path[len(API_PREFIX):] or "/"
            request.scope["path"] = compat_path
            request.scope["raw_path"] = compat_path.encode()
        path = request.scope["path"]
        if path.startswith(("/system/", "/monitor/", "/tool/")):
            request.scope["path"] = "/admin" + path
            request.scope["raw_path"] = request.scope["path"].encode()
        path = request.scope["path"]
        if (
            request.method != "OPTIONS"
            and path.startswith(PROTECTED_ADMIN_PREFIXES)
            and path not in PUBLIC_ADMIN_PATHS
            and not path.startswith(PUBLIC_ADMIN_PREFIXES)
        ):
            token = strip_token(request.headers.get("Authorization") or request.headers.get("token"))
            if not token:
                return JSONResponse(status_code=200, content=error("未登录或登录已过期", code=401))
            try:
                claims = decode_java_token(token)
                token_uuid = claims.get(LOGIN_USER_CLAIM)
                redis = redis_client()
                if not token_uuid or redis is None or redis.get(f"qkeer:login_tokens:{token_uuid}") is None:
                    raise ValueError("login token expired")
            except (jwt.InvalidTokenError, ValueError):
                return JSONResponse(status_code=200, content=error("未登录或登录已过期", code=401))
        return await call_next(request)

    Path("uploads/ota").mkdir(parents=True, exist_ok=True)
    Path("uploads/avatar").mkdir(parents=True, exist_ok=True)
    Path("uploads/app").mkdir(parents=True, exist_ok=True)
    Path("uploads/common").mkdir(parents=True, exist_ok=True)
    app.mount("/admin/files/ota", StaticFiles(directory="uploads/ota"), name="ota-files")
    app.mount("/admin/files/avatar", StaticFiles(directory="uploads/avatar"), name="avatar-files")
    app.mount("/app/files", StaticFiles(directory="uploads/app"), name="app-files")
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
    app.include_router(migration_router)
    app.include_router(common_router)
    app.include_router(admin_router)
    # Register concrete /app routes before app_router's /app/{path:path}
    # migration fallback, otherwise the fallback returns 501 first.
    app.include_router(rw_debug_router)
    app.include_router(app_router)
    app.include_router(v1_router)
    app.include_router(sleepfm_router)

    @app.get("/")
    def root():
        return {
            "status": "ok",
            "name": settings.app_name,
            "docs": "/docs",
            "health": "/health",
            "adminApi": "/admin",
        }

    @app.get("/admin")
    def admin_root():
        return {"status": "ok", "name": settings.app_name}

    @app.get("/health")
    def health_check():
        return {"status": "ok"}

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError):
        return JSONResponse(status_code=200, content=error(f"参数校验失败: {exc.errors()}"))

    @app.exception_handler(AppAuthError)
    async def app_auth_exception_handler(_: Request, exc: AppAuthError):
        return JSONResponse(status_code=200, content=error(str(exc), code=401))

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception):
        return JSONResponse(status_code=200, content=error(str(exc)))

    return app


app = create_app()
