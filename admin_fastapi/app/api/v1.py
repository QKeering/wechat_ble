from fastapi import APIRouter, Depends, Header, Request

from app.core.responses import error
from app.db.session import get_db
from app.services import feedback
from sqlalchemy.orm import Session

router = APIRouter(prefix="/v1", tags=["feedback"])


@router.post("/feedback/snapshot")
async def feedback_snapshot(
    request: Request,
    x_qkeer_user: str | None = Header(default=None, alias="X-Qkeer-User"),
    db: Session = Depends(get_db),
):
    try:
        payload = await request.json()
        result = feedback.store_snapshot(db, payload, x_qkeer_user)
        stored_at = result["storedAt"]
        return {
            "ok": True,
            "snapshotId": result["snapshotId"],
            "storedAt": stored_at.isoformat() + "Z" if hasattr(stored_at, "isoformat") else stored_at,
            "duplicate": result["duplicate"],
        }
    except ValueError as exc:
        return {"ok": False, "msg": str(exc)}
    except Exception as exc:
        return error(str(exc))
