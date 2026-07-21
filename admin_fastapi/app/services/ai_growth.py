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
