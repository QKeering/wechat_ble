from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.schemas.sleepfm import SleepFMExportRequest, SleepFMRealUserInputV1
from app.services.sleepfm_export import SleepFMExportError, export_real_user_input, verify_service_token


# Nginx exposes the application under /api/ and strips that prefix before
# proxying, so the internal FastAPI path starts at /v1/.
router = APIRouter(prefix="/v1/ai-health/sleepfm-input", tags=["sleepfm"])


def api_error(exc: SleepFMExportError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


@router.post("/export", response_model=SleepFMRealUserInputV1)
async def export_sleepfm_input(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
):
    try:
        verify_service_token(authorization, settings.sleepfm_service_token)
        payload = SleepFMExportRequest.model_validate(await request.json())
        return export_real_user_input(
            db,
            payload,
            settings.sleepfm_hash_secret or settings.token_secret,
            settings.sleepfm_consented_user_ids,
        )
    except ValidationError as exc:
        is_time_window = any("date_range" in tuple(str(item) for item in error["loc"]) for error in exc.errors())
        code = "invalid_time_window" if is_time_window else "invalid_request"
        status_code = 400 if is_time_window else 422
        return JSONResponse(status_code=status_code, content={"code": code, "message": str(exc)})
    except SleepFMExportError as exc:
        return api_error(exc)
