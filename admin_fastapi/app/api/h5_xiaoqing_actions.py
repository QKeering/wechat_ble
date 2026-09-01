"""Write-side and intervention APIs for Xiaoqing H5."""

from datetime import date

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from app.api.app import app_user, growth_girlfriend_context_payload, recent_summaries
from app.core.responses import success
from app.db.session import get_db
from app.services import ai_growth, app_auth, h5_xiaoqing_actions as actions


router = APIRouter(tags=["h5-xiaoqing-actions"])


def idem_key(value: str | None) -> str | None:
    value = (value or "").strip()
    return value[:128] or None


@router.get("/h5/xiaoqing/daily-fortune")
def h5_daily_fortune(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    today = date.today()
    cached = actions.get_daily_fortune(db, user_id, today)
    if cached:
        return success(cached)
    context = growth_girlfriend_context_payload(db, user_id)
    try:
        generated = ai_growth.daily_fortune(context, today.isoformat(), str(user_id))
    except ai_growth.GrowthAIError:
        generated = {**ai_growth.fallback_daily_fortune(today.isoformat(), str(user_id)), "provider": "fallback", "model": "local-rule", "status": "provider_error"}
    provider, model = generated.pop("provider", None), generated.pop("model", None)
    return success(actions.save_daily_fortune(db, user_id, today, generated, provider, model))


@router.post("/h5/xiaoqing/cycle/record")
async def cycle_record(
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: dict = Depends(app_user), db: Session = Depends(get_db),
):
    return success(actions.save_cycle_record(db, int(user["id"]), await request.json(), idem_key(idempotency_key)))


@router.get("/h5/xiaoqing/cycle/records")
def cycle_records(limit: int = Query(default=100, ge=1, le=500), user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success(actions.list_cycle_records(db, int(user["id"]), limit))


@router.get("/h5/interventions/library")
def intervention_library(category: str | None = None, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    return success({"items": actions.content_list(db, int(user["id"]), category), "contentPolicy": "controlled_low_risk_v1"})


@router.get("/h5/interventions/recommendations")
def intervention_recommendations(context: str | None = None, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    result = actions.recommendations(db, int(user["id"]), context)
    result["reason"] = "根据当前状态从受控低风险内容库中匹配，AI 不直接生成课程内容。"
    return success(result)


@router.put("/h5/interventions/{content_id}/favorite")
async def intervention_favorite(
    content_id: str, request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: dict = Depends(app_user), db: Session = Depends(get_db),
):
    payload = await request.json()
    return success(actions.set_favorite(db, int(user["id"]), content_id, bool(payload.get("favorite", True)), idem_key(idempotency_key)))


@router.post("/h5/interventions/{content_id}/checkin")
async def intervention_checkin(
    content_id: str, request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: dict = Depends(app_user), db: Session = Depends(get_db),
):
    return success(actions.save_action(db, "h5_intervention_checkin", "checkin_id", int(user["id"]), content_id, await request.json(), idem_key(idempotency_key)))


@router.post("/h5/interventions/{content_id}/feedback")
async def intervention_feedback(
    content_id: str, request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: dict = Depends(app_user), db: Session = Depends(get_db),
):
    return success(actions.save_action(db, "h5_intervention_feedback", "feedback_id", int(user["id"]), content_id, await request.json(), idem_key(idempotency_key)))


@router.post("/h5/events")
async def h5_events(
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: dict = Depends(app_user), db: Session = Depends(get_db),
):
    payload = await request.json()
    events = payload if isinstance(payload, list) else payload.get("events") or [payload]
    return success(actions.save_events(db, int(user["id"]), events, idem_key(idempotency_key)))


@router.post("/h5/xiaoqing/chat")
async def h5_chat(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    question = str(payload.get("question") or payload.get("text") or "").strip()
    if not question:
        raise app_auth.AppAuthError("问题不能为空")
    context = growth_girlfriend_context_payload(db, int(user["id"]))
    try:
        result = ai_growth.chat(question, context)
    except ai_growth.GrowthAIError as exc:
        result = {"text": "当前 AI 服务暂不可用。你可以先选择呼吸、轻步行或短时休息等低风险行动。", "provider": "fallback", "model": "local-rule", "status": "provider_error", "error": str(exc)}
    ai_growth.save_message(db, int(user["id"]), question, result["text"], result.get("provider"), result.get("model"), result.get("status"))
    return success({
        "text": result["text"], "basis": context.get("answer", {}).get("basis", []),
        "confidence": context.get("answer", {}).get("confidence", "low"),
        "modelStatus": result.get("status"), "disclaimer": "仅供生活方式参考，不替代医疗诊断或治疗。",
    })


@router.get("/h5/xiaoqing/lifestyle-report")
def h5_lifestyle_report(
    days: int = Query(default=7, ge=3, le=30),
    user: dict = Depends(app_user), db: Session = Depends(get_db),
):
    try:
        items = recent_summaries(db, int(user["id"]), days)
        report_data = [
            {
                "date": str(item.get("recordDate") or ""),
                "sleepScore": item.get("sleepScore"),
                "sleepMinutes": item.get("sleepTotalTime") or item.get("sleepTotalMinutes"),
                "stressScore": item.get("stressScore"),
                "stressAvg": item.get("stressAvg"),
                "motionScore": item.get("motionScore"),
                "steps": item.get("stepCount"),
            }
            for item in reversed(items)
            if isinstance(item, dict) and any(item.get(key) is not None for key in (
                "sleepScore", "sleepTotalTime", "sleepTotalMinutes", "stressScore", "stressAvg", "motionScore", "stepCount"
            ))
        ]
    except Exception:
        report_data = []
    try:
        result = ai_growth.lifestyle_summary(report_data, days)
    except Exception:
        result = {"text": ai_growth.fallback_lifestyle_summary(report_data), "status": "provider_error"}
    return success({
        "text": result["text"], "validDays": len(report_data), "days": days,
        "modelStatus": result.get("status"),
        "disclaimer": "仅作生活方式趋势参考，不替代医疗诊断或治疗。",
    })


@router.post("/h5/xiaoqing/profile")
async def h5_profile_update(request: Request, user: dict = Depends(app_user), db: Session = Depends(get_db)):
    payload = await request.json()
    allowed = {key: payload[key] for key in ("avatar", "nickName", "birthday", "sex", "height", "weight") if key in payload}
    app_auth.update_current_user(db, int(user["id"]), allowed)
    return success(True)
