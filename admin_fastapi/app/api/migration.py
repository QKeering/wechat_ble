from fastapi import APIRouter

from app.core.responses import success

router = APIRouter(prefix="/_migration", tags=["migration"])


MIGRATION_MODULES = [
    {"module": "admin-auth", "paths": ["/admin/captchaImage", "/admin/login", "/admin/getInfo", "/admin/getRouters"], "status": "implemented"},
    {"module": "admin-system", "paths": ["/admin/system/*"], "status": "implemented"},
    {"module": "admin-device", "paths": ["/admin/device/*"], "status": "implemented"},
    {"module": "admin-user", "paths": ["/admin/user/*"], "status": "implemented"},
    {"module": "admin-monitor", "paths": ["/admin/monitor/*"], "status": "compatible"},
    {"module": "admin-backups", "paths": ["/admin/system/backups/*"], "status": "implemented"},
    {"module": "admin-common", "paths": ["/admin/common/*", "/admin/captchaImage"], "status": "implemented"},
    {"module": "app-login", "paths": ["/app/login/*"], "status": "local-compatible"},
    {"module": "app-user", "paths": ["/app/user/*"], "status": "implemented"},
    {"module": "app-device", "paths": ["/app/device/*", "/app/ota/package/*"], "status": "implemented"},
    {"module": "app-data", "paths": ["/app/data/*"], "status": "implemented"},
    {"module": "app-health", "paths": ["/app/health/*"], "status": "implemented"},
    {"module": "app-girl-health", "paths": ["/app/girlHealth/*"], "status": "implemented"},
    {"module": "app-common", "paths": ["/app/fqaGuid/*", "/app/system/dict/data/*", "/app/upload/*"], "status": "implemented"},
    {"module": "ai-lab", "paths": ["/admin/aiLab/*", "/app/aiLab/*"], "status": "implemented"},
]


@router.get("/status")
def migration_status():
    return success({"modules": MIGRATION_MODULES})
