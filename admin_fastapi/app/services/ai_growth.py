import hashlib
import json
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.db.session import engine
from sqlalchemy import text
from sqlalchemy.orm import Session


class GrowthAIError(RuntimeError):
    pass


asr_logger = logging.getLogger("qkeer.algorithm")


def _asr_log(event: str, **data: Any) -> None:
    try:
        asr_logger.info(json.dumps({"event": event, **data}, ensure_ascii=False, default=str))
    except Exception:
        pass


def initialize_schema() -> None:
    with engine.begin() as connection:
        connection.execute(text(
            """
            create table if not exists growth_girlfriend_message (
              id bigint not null auto_increment,
              user_id bigint not null,
              question text null,
              answer text null,
              provider varchar(50) default null,
              model varchar(100) default null,
              status varchar(50) default null,
              create_time datetime default current_timestamp,
              primary key (id),
              key idx_growth_girlfriend_user_time (user_id, create_time)
            ) engine=InnoDB default charset=utf8mb4 comment='小轻AI成长闺蜜对话上下文'
            """
        ))


def recent_messages(db: Session, user_id: int, limit: int = 6) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            select question, answer, provider, model, status, create_time
            from growth_girlfriend_message
            where user_id=:user_id
            order by create_time desc, id desc
            limit :limit
            """
        ),
        {"user_id": user_id, "limit": limit},
    ).mappings().all()
    return [dict(row) for row in reversed(rows)]


def save_message(db: Session, user_id: int, question: str, answer: str, provider: str | None, model: str | None, status: str | None) -> None:
    db.execute(
        text(
            """
            insert into growth_girlfriend_message(user_id, question, answer, provider, model, status)
            values(:user_id, :question, :answer, :provider, :model, :status)
            """
        ),
        {
            "user_id": user_id,
            "question": question,
            "answer": answer,
            "provider": provider,
            "model": model,
            "status": status,
        },
    )
    db.commit()


def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int = 45) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise GrowthAIError(f"AI provider HTTP {exc.code}: {body[:500]}") from exc
    except urllib.error.URLError as exc:
        raise GrowthAIError(f"AI provider connection failed: {exc.reason}") from exc

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise GrowthAIError(f"AI provider returned non-JSON body: {body[:500]}") from exc


def _mock_chat(question: str, context: dict[str, Any]) -> dict[str, Any]:
    scores = context.get("scores") or {}
    return {
        "text": (
            f"我看了你的三项状态：健康{scores.get('health', '-')}、美丽{scores.get('beauty', '-')}、成长{scores.get('growth', '-')}。"
            "今天先轻一点，优先做低压力的事。"
        ),
        "provider": "mock",
        "model": "local-rule",
        "status": "pending_key",
    }


def chat(question: str, context: dict[str, Any]) -> dict[str, Any]:
    provider = (settings.growth_ai_provider or "qwen").lower()
    if provider == "doubao" and settings.volcengine_ark_api_key and settings.doubao_chat_model:
        return _chat_openai_compatible(
            base_url=settings.volcengine_ark_base_url,
            api_key=settings.volcengine_ark_api_key,
            model=settings.doubao_chat_model,
            provider="doubao",
            question=question,
            context=context,
        )

    if settings.dashscope_api_key:
        return _chat_openai_compatible(
            base_url=settings.dashscope_compatible_url,
            api_key=settings.dashscope_api_key,
            model=settings.dashscope_chat_model,
            provider="qwen",
            question=question,
            context=context,
        )

    return _mock_chat(question, context)


def daily_fortune(context: dict[str, Any], day: str, user_seed: str) -> dict[str, Any]:
    provider = (settings.growth_ai_provider or "qwen").lower()
    if provider == "doubao" and settings.volcengine_ark_api_key and settings.doubao_chat_model:
        return _daily_fortune_openai_compatible(
            base_url=settings.volcengine_ark_base_url, api_key=settings.volcengine_ark_api_key,
            model=settings.doubao_chat_model, provider="doubao", context=context, day=day,
        )
    if settings.dashscope_api_key:
        return _daily_fortune_openai_compatible(
            base_url=settings.dashscope_compatible_url, api_key=settings.dashscope_api_key,
            model=settings.dashscope_chat_model, provider="qwen", context=context, day=day,
        )
    return {**fallback_daily_fortune(day, user_seed), "provider": "fallback", "model": "local-rule", "status": "pending_key"}


def fallback_daily_fortune(day: str, user_seed: str) -> dict[str, Any]:
    choices = [
        ("小吉", "把步子放慢一点，好消息正在靠近。", "适合整理手头的小事，给自己留一段不被打扰的时间。", "雾霾蓝", 7, "松弛", "你的细腻是天赋，不必急着回应所有声音。"),
        ("中吉", "今天适合相信自己的第一感受。", "先完成一件最重要的小事，余下的交给时间慢慢展开。", "薄荷绿", 3, "笃定", "照顾好自己的节奏，也是一种向前。"),
        ("小吉", "轻轻开始，今天会比想象中顺利。", "适合沟通、记录和短暂散步，不必一次把事情做满。", "暖杏色", 6, "轻盈", "你已经做得很好，今天也可以对自己温柔一点。"),
    ]
    index = int(hashlib.sha256(f"{user_seed}:{day}".encode("utf-8")).hexdigest()[:8], 16) % len(choices)
    grade, message, detail, color, number, keyword, whisper = choices[index]
    return {"date": day, "grade": grade, "message": message, "detail": detail, "luckyColor": color, "luckyNumber": number, "keyword": keyword, "whisper": whisper}


def lifestyle_summary(report_data: list[dict[str, Any]], days: int = 7) -> dict[str, Any]:
    if not report_data:
        return {"text": "近期数据还不够，继续佩戴并同步后，小轻再帮你整理睡眠、情绪和运动报告。", "provider": "fallback", "model": "local-rule", "status": "insufficient_data"}
    provider = (settings.growth_ai_provider or "qwen").lower()
    if provider == "doubao" and settings.volcengine_ark_api_key and settings.doubao_chat_model:
        return _lifestyle_summary_openai_compatible(
            base_url=settings.volcengine_ark_base_url, api_key=settings.volcengine_ark_api_key,
            model=settings.doubao_chat_model, provider="doubao", report_data=report_data, days=days,
        )
    if settings.dashscope_api_key:
        return _lifestyle_summary_openai_compatible(
            base_url=settings.dashscope_compatible_url, api_key=settings.dashscope_api_key,
            model=settings.dashscope_chat_model, provider="qwen", report_data=report_data, days=days,
        )
    return {"text": fallback_lifestyle_summary(report_data), "provider": "fallback", "model": "local-rule", "status": "pending_key"}


def fallback_lifestyle_summary(report_data: list[dict[str, Any]]) -> str:
    def average(key: str) -> int | None:
        values = []
        for item in report_data:
            try:
                if item.get(key) is not None:
                    values.append(float(item[key]))
            except (TypeError, ValueError):
                continue
        return round(sum(values) / len(values)) if values else None

    sleep_score, stress_score, motion_score = average("sleepScore"), average("stressScore"), average("motionScore")
    sleep_text = f"睡眠平均{sleep_score}分" if sleep_score is not None else "睡眠数据不足"
    emotion_text = f"情绪与压力状态平均{stress_score}分" if stress_score is not None else "情绪数据不足"
    motion_text = f"运动状态平均{motion_score}分" if motion_score is not None else "运动数据不足"
    return f"近7天{sleep_text}，{emotion_text}，{motion_text}。建议优先保持规律作息，再安排轻量活动。"


def _lifestyle_summary_openai_compatible(
    *, base_url: str, api_key: str, model: str, provider: str,
    report_data: list[dict[str, Any]], days: int,
) -> dict[str, Any]:
    system_prompt = (
        "你是小轻AI陪伴助手。根据用户授权的近期真实汇总，从睡眠、情绪、运动三个方面生成生活化周期报告。"
        "每个方面都要提到，先总结趋势，再给一个总的低风险行动建议。控制在160个中文字符以内。"
        "不得诊断疾病、夸大结论或使用数据中不存在的事实；数据不足时明确说明。"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"观察窗口：最近{days}天\n生活汇总：{json.dumps(report_data, ensure_ascii=False, default=str)}"},
        ],
        "temperature": 0.45,
    }
    data = _post_json(f"{base_url.rstrip('/')}/chat/completions", {"Authorization": f"Bearer {api_key}"}, payload)
    answer = str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    if not answer:
        raise GrowthAIError("综合报告模型未返回内容")
    return {"text": answer[:300], "provider": provider, "model": model, "status": "ok"}


def sleep_summary(sleep_data: list[dict[str, Any]], days: int = 7) -> dict[str, Any]:
    if not sleep_data:
        return {"text": "近期睡眠数据还不够，继续佩戴并同步后，小轻再帮你总结睡眠节奏。", "provider": "fallback", "model": "local-rule", "status": "insufficient_data"}
    provider = (settings.growth_ai_provider or "qwen").lower()
    if provider == "doubao" and settings.volcengine_ark_api_key and settings.doubao_chat_model:
        return _sleep_summary_openai_compatible(
            base_url=settings.volcengine_ark_base_url, api_key=settings.volcengine_ark_api_key,
            model=settings.doubao_chat_model, provider="doubao", sleep_data=sleep_data, days=days,
        )
    if settings.dashscope_api_key:
        return _sleep_summary_openai_compatible(
            base_url=settings.dashscope_compatible_url, api_key=settings.dashscope_api_key,
            model=settings.dashscope_chat_model, provider="qwen", sleep_data=sleep_data, days=days,
        )
    return {"text": fallback_sleep_summary(sleep_data), "provider": "fallback", "model": "local-rule", "status": "pending_key"}


def fallback_sleep_summary(sleep_data: list[dict[str, Any]]) -> str:
    scores = [float(item["score"]) for item in sleep_data if item.get("score") is not None]
    minutes = [float(item["minutes"]) for item in sleep_data if item.get("minutes") is not None]
    if not scores and not minutes:
        return "近期睡眠数据还不完整，建议继续保持佩戴和同步，暂不做趋势判断。"
    parts = []
    if minutes:
        avg_minutes = round(sum(minutes) / len(minutes))
        parts.append(f"近期开启睡眠记录的夜晚，平均睡眠约{avg_minutes // 60}小时{avg_minutes % 60}分")
    if scores:
        avg_score = round(sum(scores) / len(scores))
        parts.append(f"平均睡眠评分约{avg_score}分")
    return "，".join(parts) + "。保持规律作息，继续观察自己的恢复感受。"


def _sleep_summary_openai_compatible(
    *, base_url: str, api_key: str, model: str, provider: str,
    sleep_data: list[dict[str, Any]], days: int,
) -> dict[str, Any]:
    system_prompt = (
        "你是小轻AI陪伴助手。请根据用户授权的近期真实睡眠汇总，生成一段生活化睡眠总结。"
        "先概括睡眠时长、评分和趋势，再给一个低风险、可执行的作息建议。"
        "控制在100个中文字符以内，不诊断失眠或疾病，不承诺改善；数据不足时明确说明。"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"观察窗口：最近{days}天\n睡眠数据：{json.dumps(sleep_data, ensure_ascii=False, default=str)}"},
        ],
        "temperature": 0.45,
    }
    data = _post_json(f"{base_url.rstrip('/')}/chat/completions", {"Authorization": f"Bearer {api_key}"}, payload)
    answer = str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    if not answer:
        raise GrowthAIError("睡眠总结模型未返回内容")
    return {"text": answer[:180], "provider": provider, "model": model, "status": "ok"}


def _daily_fortune_openai_compatible(
    *, base_url: str, api_key: str, model: str, provider: str,
    context: dict[str, Any], day: str,
) -> dict[str, Any]:
    system_prompt = (
        "你是小轻AI陪伴助手。请生成轻松、积极、可执行的今日签，它属于生活方式娱乐内容，不是事实预测。"
        "不得预测疾病、怀孕、寿命、灾祸、投资收益、考试录取或重大人生结果，不制造焦虑。"
        "只返回一个JSON对象，不要Markdown。字段必须为date、grade、message、detail、luckyColor、"
        "luckyNumber、keyword、whisper。grade只能是小吉、中吉、大吉、平；luckyNumber为1到9整数；"
        "其余内容使用简洁自然的中文。"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"日期：{day}\n用户授权状态摘要：{json.dumps(context, ensure_ascii=False, default=str)}"},
        ],
        "temperature": 0.75,
    }
    data = _post_json(f"{base_url.rstrip('/')}/chat/completions", {"Authorization": f"Bearer {api_key}"}, payload)
    content = str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    if content.startswith("```"):
        content = content.strip("`").removeprefix("json").strip()
    try:
        fortune = json.loads(content)
    except json.JSONDecodeError as exc:
        raise GrowthAIError("今日签模型返回格式无效") from exc
    required = ("grade", "message", "detail", "luckyColor", "luckyNumber", "keyword", "whisper")
    if not isinstance(fortune, dict) or any(not fortune.get(key) for key in required):
        raise GrowthAIError("今日签模型返回字段不完整")
    fortune["date"] = day
    fortune["grade"] = str(fortune["grade"]) if str(fortune["grade"]) in {"小吉", "中吉", "大吉", "平"} else "平"
    fortune["luckyNumber"] = max(1, min(9, int(fortune["luckyNumber"])))
    for key, limit in {"message": 48, "detail": 90, "luckyColor": 12, "keyword": 12, "whisper": 70}.items():
        fortune[key] = str(fortune[key]).strip()[:limit]
    return {**fortune, "provider": provider, "model": model, "status": "ok"}


def _chat_openai_compatible(
    *,
    base_url: str,
    api_key: str,
    model: str,
    provider: str,
    question: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    system_prompt = (
        "你是小轻AI成长闺蜜，面向女性用户。你必须基于用户授权的健康数据、状态分数和上下文回答。"
        "默认回答要简短、温柔、口语化，控制在60个中文字符以内，最多2句话。"
        "优先给一个最适合当下的建议，不要长篇解释，不要列很多条。"
        "只有用户明确要求详细方案时，才可以展开到3-5条。"
        "不得诊断、治疗、处方、预测疾病或判断孕产异常。数据不足时，简短说明不确定性。"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"用户问题：{question}\n\n"
                    "当前授权上下文 JSON：\n"
                    + json.dumps(context, ensure_ascii=False, default=str)
                    + "\n\n请直接回答用户问题，不要说用户问题为空。默认短答，不超过60个中文字符。"
                ),
            },
        ],
        "temperature": 0.7,
    }
    data = _post_json(
        f"{base_url.rstrip('/')}/chat/completions",
        {"Authorization": f"Bearer {api_key}"},
        payload,
    )
    answer = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return {
        "text": answer,
        "provider": provider,
        "model": model,
        "status": "ok",
        "rawUsage": data.get("usage"),
    }


def _response_value(response: Any, key: str, default: Any = None) -> Any:
    if isinstance(response, dict):
        return response.get(key, default)
    return getattr(response, key, default)


def _response_output(response: Any) -> dict[str, Any]:
    output = _response_value(response, "output", {}) or {}
    if isinstance(output, str):
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {}
    return dict(output) if isinstance(output, dict) else {}


def _asr_error_message(output: dict[str, Any], response: Any) -> str:
    return str(
        output.get("message")
        or output.get("error_message")
        or output.get("task_status")
        or _response_value(response, "message", "")
        or "ASR 未返回识别结果"
    )


def _extract_multimodal_asr_text(response: Any) -> str:
    output = _response_value(response, "output", {}) or {}
    if isinstance(output, dict):
        choices = output.get("choices") or []
    else:
        choices = getattr(output, "choices", []) or []
    if not choices:
        return ""
    choice = choices[0]
    message = choice.get("message") if isinstance(choice, dict) else getattr(choice, "message", None)
    if not message:
        return ""
    content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
    if not content:
        return ""
    if isinstance(content, str):
        return content.strip()
    texts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            value = item.get("text") or item.get("transcription") or ""
        else:
            value = getattr(item, "text", "") or getattr(item, "transcription", "")
        if value:
            texts.append(str(value))
    return "".join(texts).strip()


def transcribe_audio_file(audio_path: str | Path) -> dict[str, Any]:
    if not settings.ali_asr_api_key:
        return {
            "text": "",
            "provider": "aliyun-dashscope",
            "model": settings.ali_asr_model,
            "status": "pending_key",
            "message": "ALI_ASR_API_KEY 未配置，前端可先使用文字输入。",
        }

    path = Path(audio_path).resolve()
    if not path.exists() or not path.is_file():
        raise GrowthAIError(f"ASR audio file not found: {path}")

    try:
        import dashscope
        from dashscope import MultiModalConversation

        dashscope.api_key = settings.ali_asr_api_key
        file_uri = "file://" + str(path).replace("\\", "/")
        started_at = time.monotonic()
        response = MultiModalConversation.call(
            model=settings.ali_asr_model or "qwen3-asr-flash",
            messages=[
                {"role": "system", "content": [{"text": "只输出音频转写的文字，不要多余解释"}]},
                {"role": "user", "content": [{"audio": file_uri}]},
            ],
            result_format="message",
            asr_options={"enable_itn": True},
        )
        text_value = _extract_multimodal_asr_text(response)
        _asr_log(
            "growth_girlfriend_asr_local_file_result",
            elapsed_ms=int((time.monotonic() - started_at) * 1000),
            status_code=_response_value(response, "status_code"),
            message=_response_value(response, "message", ""),
            model=settings.ali_asr_model,
            audio_file=str(path),
            text_length=len(text_value),
        )
    except ModuleNotFoundError as exc:
        if exc.name == "dashscope":
            raise GrowthAIError("语音识别服务缺少 dashscope 依赖，请在后端安装 requirements.txt 后重启服务。") from exc
        raise GrowthAIError(f"ASR provider failed: {str(exc)[:500]}") from exc
    except Exception as exc:
        raise GrowthAIError(f"ASR provider failed: {str(exc)[:500]}") from exc

    status_code = _response_value(response, "status_code")
    if status_code and int(status_code) >= 400:
        raise GrowthAIError(f"ASR provider HTTP {status_code}: {str(_response_value(response, 'message', ''))[:500]}")

    return {
        "text": text_value,
        "provider": "aliyun-dashscope",
        "model": settings.ali_asr_model,
        "status": "ok" if text_value else "empty",
        "message": "" if text_value else (_response_value(response, "message", "") or "ASR 未返回识别文本"),
        "raw": _response_output(response),
    }


def transcribe_audio_url(file_url: str) -> dict[str, Any]:
    if not settings.ali_asr_api_key:
        return {
            "text": "",
            "provider": "aliyun-dashscope",
            "model": settings.ali_asr_model,
            "status": "pending_key",
            "message": "ALI_ASR_API_KEY 未配置，前端可先使用文字输入。",
        }

    try:
        _check_audio_url(file_url)
        from dashscope.audio.asr import Transcription

        started_at = time.monotonic()
        task = Transcription.async_call(
            model=settings.ali_asr_model,
            file_urls=[file_url],
            api_key=settings.ali_asr_api_key,
        )
        task_output = _response_output(task)
        _asr_log(
            "growth_girlfriend_asr_submitted",
            file_url=file_url,
            status_code=_response_value(task, "status_code"),
            task_id=task_output.get("task_id"),
            task_status=task_output.get("task_status"),
            message=_response_value(task, "message", ""),
        )
        if _response_value(task, "status_code") and int(_response_value(task, "status_code")) >= 400:
            raise GrowthAIError(f"ASR submit HTTP {_response_value(task, 'status_code')}: {str(_response_value(task, 'message', ''))[:500]}")

        result = task
        while time.monotonic() - started_at < 60:
            result = Transcription.fetch(task, api_key=settings.ali_asr_api_key)
            output = _response_output(result)
            status_code = _response_value(result, "status_code")
            task_status = str(output.get("task_status") or "").upper()
            _asr_log(
                "growth_girlfriend_asr_poll",
                elapsed_ms=int((time.monotonic() - started_at) * 1000),
                status_code=status_code,
                task_status=task_status,
                message=_asr_error_message(output, result),
            )
            if status_code and int(status_code) >= 400:
                raise GrowthAIError(f"ASR provider HTTP {status_code}: {str(_response_value(result, 'message', ''))[:500]}")
            if task_status in {"SUCCEEDED", "SUCCESS", "COMPLETED"}:
                break
            if task_status in {"FAILED", "CANCELED", "CANCELLED"}:
                raise GrowthAIError(f"ASR provider task {task_status}: {_asr_error_message(output, result)[:500]}")
            time.sleep(2)
        else:
            raise GrowthAIError("ASR provider timeout: 阿里任务 60 秒内未完成，请检查音频 URL 是否可公网访问")
    except ModuleNotFoundError as exc:
        if exc.name == "dashscope":
            raise GrowthAIError("语音识别服务缺少 dashscope 依赖，请在后端安装 requirements.txt 后重启服务。") from exc
        raise GrowthAIError(f"ASR provider failed: {str(exc)[:500]}") from exc
    except Exception as exc:
        raise GrowthAIError(f"ASR provider failed: {str(exc)[:500]}") from exc

    status_code = _response_value(result, "status_code")
    output = _response_output(result)
    if status_code and int(status_code) >= 400:
        raise GrowthAIError(f"ASR provider HTTP {status_code}: {str(_response_value(result, 'message', ''))[:500]}")

    task_status = str(output.get("task_status") or "").upper()
    if task_status and task_status not in {"SUCCEEDED", "SUCCESS", "COMPLETED"}:
        raise GrowthAIError(f"ASR provider task {task_status}: {_asr_error_message(output, result)[:500]}")

    text_value = ""
    results = output.get("results") or []
    if results:
        item = results[0] or {}
        text_value = item.get("transcription") or item.get("text") or item.get("sentence") or ""
        transcription_url = item.get("transcription_url") or item.get("transcriptionUrl")
        if not text_value and transcription_url:
            text_value = _fetch_transcription_text(transcription_url)

    if not text_value:
        text_value = output.get("text") or output.get("transcription") or ""

    return {
        "text": text_value,
        "provider": "aliyun-dashscope",
        "model": settings.ali_asr_model,
        "status": "ok" if text_value else "empty",
        "message": "" if text_value else _asr_error_message(output, result),
        "raw": output,
    }


def _check_audio_url(file_url: str) -> None:
    try:
        request = urllib.request.Request(file_url, headers={"Range": "bytes=0-1023"})
        with urllib.request.urlopen(request, timeout=8) as response:
            sample = response.read(64)
            _asr_log(
                "growth_girlfriend_asr_file_url_checked",
                file_url=file_url,
                status=getattr(response, "status", ""),
                content_type=response.headers.get("content-type", ""),
                content_length=response.headers.get("content-length", ""),
                sample_size=len(sample),
            )
    except Exception as exc:
        raise GrowthAIError(f"ASR audio URL unavailable: {file_url} ({str(exc)[:300]})") from exc


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.mp3") -> dict[str, Any]:
    return {
        "text": "",
        "provider": "aliyun-dashscope",
        "model": settings.ali_asr_model,
        "status": "needs_public_url",
        "message": "阿里录音文件识别需要可公网访问的 file_url，请使用 transcribe_audio_url。",
    }


def _fetch_transcription_text(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise GrowthAIError(f"ASR result download failed: {str(exc)[:500]}") from exc

    texts: list[str] = []
    for transcript in data.get("transcripts") or []:
        text_value = transcript.get("text") or transcript.get("sentence") or ""
        if text_value:
            texts.append(str(text_value))
    if not texts:
        text_value = data.get("text") or data.get("transcription") or ""
        if text_value:
            texts.append(str(text_value))
    return "".join(texts).strip()


def synthesize_speech(text: str) -> dict[str, Any]:
    if not settings.ali_tts_api_key:
        return {
            "audioBase64": "",
            "audioUrl": "",
            "provider": "aliyun-dashscope",
            "model": settings.ali_tts_model,
            "status": "pending_key",
            "message": "ALI_TTS_API_KEY 未配置，前端先展示文本回答。",
        }

    cleaned_text = " ".join(str(text or "").split())[:800]
    if not cleaned_text:
        return {"audioBase64": "", "audioUrl": "", "provider": "aliyun-dashscope", "model": settings.ali_tts_model, "status": "empty_text"}

    errors: list[str] = []
    for model, voice in (
        (settings.ali_tts_model, settings.ali_tts_voice),
        (settings.ali_tts_fallback_model, settings.ali_tts_fallback_voice),
    ):
        try:
            result = _synthesize_with_dashscope(model, voice, cleaned_text)
            if result.get("audioUrl") or result.get("audioBase64"):
                return result
            errors.append(str(result.get("message") or "empty audio"))
        except Exception as exc:
            errors.append(str(exc)[:240])

    raise GrowthAIError("TTS provider failed: " + " | ".join(errors[:2]))


def _synthesize_with_dashscope(model: str, voice: str, text_value: str) -> dict[str, Any]:
    try:
        import dashscope
    except ModuleNotFoundError as exc:
        raise GrowthAIError("语音合成服务缺少 dashscope 依赖，请在后端安装 requirements.txt 后重启服务。") from exc

    if model.startswith("qwen-tts"):
        from dashscope.audio.qwen_tts import SpeechSynthesizer

        response = SpeechSynthesizer.call(
            model=model,
            text=text_value,
            voice=voice,
            api_key=settings.ali_tts_api_key,
        )
        output = _response_output(response)
        audio = output.get("audio") or {}
        return {
            "audioBase64": audio.get("data") or "",
            "audioUrl": audio.get("url") or "",
            "provider": "aliyun-dashscope",
            "model": model,
            "voice": voice,
            "status": "ok" if audio.get("url") or audio.get("data") else "empty",
            "message": _response_value(response, "message", ""),
        }

    response = dashscope.HttpSpeechSynthesizer.call(
        model=model,
        text=text_value,
        voice=voice,
        audio_format="mp3",
        sample_rate=24000,
        api_key=settings.ali_tts_api_key,
    )
    return {
        "audioBase64": "",
        "audioUrl": getattr(response, "audio_url", "") or "",
        "provider": "aliyun-dashscope",
        "model": model,
        "voice": voice,
        "status": "ok" if getattr(response, "audio_url", "") else "empty",
        "message": getattr(response, "message", ""),
    }
