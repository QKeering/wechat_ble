"""H5-facing read models built from existing QKeer app services.

This module intentionally contains no BLE, raw-frame, or new business-table logic.
It provides stable display DTOs while reusing the current authenticated app user.
Ticket exchange will replace the temporary App-token dependency in a later phase.
"""

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.app import (
    app_user,
    current_device,
    daily_summary,
    get_user_girl_health_all,
    growth_girlfriend_context_payload,
    health_index_payload,
    recent_summaries,
)
from app.core.responses import success
from app.db.redis import get_redis
from app.db.session import get_db
from app.services import ai_growth, health
from app.services import app_auth


router = APIRouter(prefix="/h5/xiaoqing", tags=["h5-xiaoqing"])
auth_router = APIRouter(tags=["h5-auth"])


@auth_router.post("/app/h5/session/create")
async def create_h5_session_ticket(
    request: Request,
    user: dict = Depends(app_user),
    redis=Depends(get_redis),
):
    payload = await request.json()
    app_access_token = str(request.headers.get("Authorization") or request.headers.get("token") or "").strip()
    return success(app_auth.create_h5_ticket(
        redis,
        user,
        str(payload.get("sceneId") or ""),
        app_access_token,
    ))


@auth_router.post("/h5/auth/exchange")
@auth_router.post("/app/h5/auth/exchange")
async def exchange_h5_session_ticket(
    request: Request,
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    payload = await request.json()
    ticket = str(payload.get("ticket") or "").strip()
    if not ticket:
        raise app_auth.AppAuthError("H5 ticket 不能为空")
    return success(app_auth.exchange_h5_ticket(db, redis, ticket))


def _number(value: Any, default: float | None = None) -> float | None:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _integer(value: Any, default: int | None = None) -> int | None:
    number = _number(value)
    return round(number) if number is not None else default


def _score_level(score: int) -> str:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 55:
        return "fair"
    return "low"


def _score_text(score: int) -> str:
    return {
        "excellent": "状态极佳",
        "good": "状态良好",
        "fair": "状态一般",
        "low": "状态偏低",
    }[_score_level(score)]


def _freshness(summary: dict[str, Any]) -> dict[str, Any]:
    measured_at = summary.get("recordDate")
    synced_at = summary.get("updateTime") or summary.get("createTime")
    return {
        "measuredAt": str(measured_at or "") or None,
        "lastSyncTime": str(synced_at or "") or None,
        "completeness": "complete" if summary else "missing",
    }


def _bounded_score(value: Any) -> int | None:
    score = _integer(value)
    return max(0, min(100, score)) if score is not None else None


def _average_score(summary: dict[str, Any], *keys: str) -> int | None:
    values = [_bounded_score(summary.get(key)) for key in keys]
    available = [value for value in values if value is not None]
    return round(sum(available) / len(available)) if available else None


def _score_status(score: int | None) -> str:
    if score is None:
        return "数据不足"
    if score >= 85:
        return "优秀"
    if score >= 70:
        return "良好"
    if score >= 55:
        return "一般"
    return "待改善"


def _today_cards(summary: dict[str, Any]) -> list[dict[str, Any]]:
    # Keep the same score semantics as /app/data/balanceScore. Raw stress,
    # steps, or the number of available vital fields are not comparable scores.
    stress_score = _bounded_score(summary.get("stressScore"))
    stress_source = "algorithm"
    if stress_score is None:
        stress = _number(summary.get("stressAvg"))
        stress_score = _bounded_score(100 - stress) if stress is not None else None
        stress_source = "derived_from_stress_avg" if stress is not None else "missing"

    sleep_score = _bounded_score(summary.get("sleepScore"))
    activity_score = _bounded_score(summary.get("motionScore"))
    activity_source = "algorithm"
    steps = _integer(
        summary.get("stepCount")
        if summary.get("stepCount") is not None
        else summary.get("totalSteps", summary.get("steps"))
    )
    if activity_score is None and steps is not None:
        activity_score = _bounded_score(steps / 60)
        activity_source = "derived_from_steps"
    elif activity_score is None:
        activity_source = "missing"

    vital_score = _average_score(summary, "heartRateScore", "spo2Score", "temperatureScore", "hrvScore")
    return [
        {
            "type": "stress",
            "title": "心情与压力",
            "status": _score_status(stress_score),
            "value": stress_score,
            "unit": "分",
            "summary": f"压力恢复评分 {_score_status(stress_score)}，分数越高状态越好。",
            "available": stress_score is not None,
            "scoreSource": stress_source,
        },
        {
            "type": "sleep",
            "title": "昨夜睡眠",
            "status": _score_status(sleep_score),
            "value": sleep_score,
            "unit": "分",
            "summary": f"睡眠综合评分 {_score_status(sleep_score)}，结合时长、分期和规律性。",
            "available": sleep_score is not None,
            "scoreSource": "algorithm" if sleep_score is not None else "missing",
        },
        {
            "type": "activity",
            "title": "今日活动",
            "status": _score_status(activity_score),
            "value": activity_score,
            "unit": "分",
            "summary": f"活动评分 {_score_status(activity_score)}" + (f"，今日 {steps} 步。" if steps is not None else "。"),
            "available": activity_score is not None,
            "scoreSource": activity_source,
        },
        {
            "type": "cardio",
            "title": "身体信号",
            "status": _score_status(vital_score),
            "value": vital_score,
            "unit": "分",
            "summary": f"生命体征综合评分 {_score_status(vital_score)}，仅用于趋势观察。",
            "available": vital_score is not None,
            "scoreSource": "algorithm" if vital_score is not None else "missing",
        },
    ]


@router.get("/today")
def h5_today(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    user_id = int(user["id"])
    summary = daily_summary(db, user_id, date.today().isoformat(), calculate_if_missing=False) or daily_summary(
        db, user_id, calculate_if_missing=False
    ) or {}
    health_index = health_index_payload(db, user_id)
    ai_context = growth_girlfriend_context_payload(db, user_id)
    score = _integer(summary.get("healthScore"), _integer(health_index.get("habitScore", {}).get("score"), 0)) or 0
    stress = _integer(summary.get("stressAvg"))
    hint = {
        "id": "breathing-3m",
        "title": "3 分钟深呼吸",
        "reason": "压力偏高时适合先让身体降速" if stress is not None and stress >= 60 else "用短时呼吸练习保持今天的节奏",
        "durationMinutes": 3,
    }
    return success({
        "vitalityScore": score,
        "scoreLevel": _score_level(score),
        "scoreText": _score_text(score),
        **_freshness(summary),
        "cards": _today_cards(summary),
        "aiSummary": ai_context.get("answer", {}).get("text"),
        "aiBasis": ai_context.get("answer", {}).get("basis", []),
        "confidence": ai_context.get("answer", {}).get("confidence", "low"),
        "interventionHint": hint,
        "dataQuality": {"source": "health_daily_summary", "isDerived": True},
        "disclaimer": "健康分析仅供生活方式参考，不作为诊断、治疗或预防依据。",
    })


@router.get("/cycle/overview")
def h5_cycle_overview(user: dict = Depends(app_user), db: Session = Depends(get_db)):
    raw_response = get_user_girl_health_all(user, db)
    raw = raw_response.get("data") if isinstance(raw_response, dict) else None
    if not isinstance(raw, dict):
        raw = {}
    profile = raw.get("profile") if isinstance(raw.get("profile"), dict) else {}
    last_start = raw.get("lastMenstrualStartDate") or profile.get("lastMenstrualStartDate")
    cycle_length = _integer(raw.get("cycleLength") or profile.get("cycleLength"), 28) or 28
    day_index = None
    if last_start:
        try:
            day_index = (date.today() - date.fromisoformat(str(last_start)[:10])).days % max(cycle_length, 1) + 1
        except ValueError:
            day_index = None
    phase = "unknown"
    if day_index is not None:
        if day_index <= 5:
            phase = "period"
        elif day_index <= 12:
            phase = "follicular"
        elif day_index <= 16:
            phase = "ovulation_window"
        elif day_index >= max(cycle_length - 5, 17):
            phase = "pms"
        else:
            phase = "luteal"
    phase_text = {
        "period": "预计处于经期",
        "follicular": "预计处于卵泡期",
        "ovulation_window": "预计处于排卵相关窗口",
        "luteal": "预计处于黄体期",
        "pms": "预计处于 PMS 高发阶段",
        "unknown": "周期数据不足",
    }[phase]
    return success({
        "currentPhase": phase,
        "phaseText": phase_text,
        "cycleDay": day_index,
        "cycleLength": cycle_length,
        "lastMenstrualStartDate": last_start,
        "confidence": "medium" if last_start and raw.get("records") else "low",
        "prediction": raw.get("predictedCycle") or {},
        "calendarMarks": raw.get("calendarMarks") or [],
        "temperatureRecords": raw.get("records") or [],
        "profile": profile,
        "dataQuality": {"recordCount": len(raw.get("records") or []), "isAuxiliaryEstimate": True},
        "insight": f"{phase_text}。周期提示基于历史记录和趋势辅助估计。",
        "disclaimer": "排卵期提示不可作为避孕、备孕或医疗依据。",
    })


def _trend(items: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    return [
        {"date": str(item.get("recordDate") or ""), "value": _number(item.get(field))}
        for item in reversed(items)
        if item.get(field) is not None
    ]


def _insight_dimensions(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest = items[0] if items else {}
    return {
        "sleep": {
            "title": "睡眠实验室",
            "score": _integer(latest.get("sleepScore")),
            "current": {"totalMinutes": _integer(latest.get("sleepTotalTime") or latest.get("sleepTotalMinutes"))},
            "trend7d": _trend(items, "sleepScore"),
        },
        "stress": {
            "title": "压力与情绪",
            "score": _integer(latest.get("stressScore")),
            "current": {"stress": _number(latest.get("stressAvg")), "hrv": _number(latest.get("hrvAvg"))},
            "trend7d": _trend(items, "stressAvg"),
        },
        "activity": {
            "title": "运动与恢复",
            "score": _integer(latest.get("motionScore")),
            "current": {"steps": _integer(latest.get("stepCount"), 0)},
            "trend7d": _trend(items, "motionScore"),
        },
        "cardio": {
            "title": "心血管健康",
            "score": _integer(latest.get("heartRateScore")),
            "current": {
                "heartRate": _number(latest.get("heartRateAvg")),
                "hrv": _number(latest.get("hrvAvg")),
                "spo2": _number(latest.get("spo2Avg")),
                "temperature": _number(latest.get("temperatureAvg")),
            },
            "trend7d": _trend(items, "heartRateAvg"),
        },
    }


@router.get("/insight/overview")
def h5_insight_overview(
    days: int = Query(default=7, ge=1, le=30),
    user: dict = Depends(app_user),
    db: Session = Depends(get_db),
):
    items = recent_summaries(db, int(user["id"]), days)
    return success({
        "dimensions": _insight_dimensions(items),
        "lastSyncTime": (items[0].get("updateTime") if items else None),
        "dataCompleteness": "complete" if len(items) >= 5 else ("partial" if items else "missing"),
        "observationWindow": {
            "days": days,
            "validDays": len(items),
            "missingDays": max(0, days - len(items)),
        },
        "disclaimer": "指标仅作趋势观察，异常持续或身体明显不适时请咨询专业医生。",
    })


@router.get("/insight/lifestyle-summary")
def h5_lifestyle_summary(
    days: int = Query(default=7, ge=3, le=30),
    user: dict = Depends(app_user),
    db: Session = Depends(get_db),
):
    items = recent_summaries(db, int(user["id"]), days)
    report_data = [
        {
            "date": str(item.get("recordDate") or ""),
            "sleepScore": _integer(item.get("sleepScore")),
            "sleepMinutes": _integer(item.get("sleepTotalTime") or item.get("sleepTotalMinutes")),
            "stressScore": _integer(item.get("stressScore")),
            "stressAvg": _number(item.get("stressAvg")),
            "motionScore": _integer(item.get("motionScore")),
            "steps": _integer(item.get("stepCount")),
        }
        for item in reversed(items)
        if any(item.get(key) is not None for key in (
            "sleepScore", "sleepTotalTime", "sleepTotalMinutes", "stressScore", "stressAvg", "motionScore", "stepCount"
        ))
    ]
    try:
        result = ai_growth.lifestyle_summary(report_data, days)
    except ai_growth.GrowthAIError:
        result = {"text": ai_growth.fallback_lifestyle_summary(report_data), "provider": "fallback", "model": "local-rule", "status": "provider_error"}
    return success({
        "text": result["text"], "validDays": len(report_data), "days": days,
        "modelStatus": result.get("status"),
        "disclaimer": "仅作生活方式趋势参考，不替代医疗诊断或治疗。",
    })


@router.get("/insight/{dimension}")
def h5_insight_detail(
    dimension: str,
    days: int = Query(default=7, ge=1, le=30),
    user: dict = Depends(app_user),
    db: Session = Depends(get_db),
):
    items = recent_summaries(db, int(user["id"]), days)
    dimensions = _insight_dimensions(items)
    selected = dimensions.get(dimension)
    if selected is None:
        return success({"dimension": dimension, "available": False, "reason": "unsupported_dimension"})
    ai_context = growth_girlfriend_context_payload(db, int(user["id"]))
    return success({
        "dimension": dimension,
        "available": bool(items),
        **selected,
        "explanation": ai_context.get("answer", {}).get("text"),
        "basis": ai_context.get("answer", {}).get("basis", []),
        "confidence": ai_context.get("answer", {}).get("confidence", "low"),
        "disclaimer": "仅供生活方式参考，不输出疾病诊断或治疗结论。",
    })


@router.get("/profile")
def h5_profile(
    user: dict = Depends(app_user),
    db: Session = Depends(get_db),
    redis=Depends(get_redis),
):
    girl = health.get_girl_health(db, int(user["id"])) or {}
    device_response = current_device(user, db, redis)
    device = device_response.get("data") if isinstance(device_response, dict) else None
    return success({
        "user": {
            "id": user.get("id"),
            "nickName": user.get("nickName"),
            "avatar": user.get("avatar"),
            "birthday": str(user.get("birthday") or "") or None,
            "sex": user.get("sex"),
            "height": user.get("height"),
            "weight": user.get("weight"),
        },
        "femaleHealthProfile": girl,
        "deviceSummary": device,
        "nativeRoutes": {"device": "device/manage", "family": "family/manage"},
        "privacy": {"rawFramesExposed": False, "deviceMacExposed": False},
    })
