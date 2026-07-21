import argparse
import json
import os
import time
import urllib.request

from dotenv import load_dotenv


def response_value(response, key, default=None):
    if isinstance(response, dict):
        return response.get(key, default)
    return getattr(response, key, default)


def response_output(response):
    output = response_value(response, "output", {}) or {}
    if isinstance(output, str):
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            return {}
    return dict(output) if isinstance(output, dict) else {}


def check_public_url(url):
    request = urllib.request.Request(url, headers={"Range": "bytes=0-1023"})
    with urllib.request.urlopen(request, timeout=10) as response:
        sample = response.read(64)
        print("file_url_check:", {
            "status": getattr(response, "status", ""),
            "content_type": response.headers.get("content-type", ""),
            "content_length": response.headers.get("content-length", ""),
            "sample_size": len(sample),
        })


def extract_text(output):
    results = output.get("results") or []
    if results:
        item = results[0] or {}
        text = item.get("transcription") or item.get("text") or item.get("sentence") or ""
        if text:
            return text
        transcription_url = item.get("transcription_url") or item.get("transcriptionUrl")
        if transcription_url:
            with urllib.request.urlopen(transcription_url, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            texts = []
            for transcript in data.get("transcripts") or []:
                value = transcript.get("text") or transcript.get("sentence") or ""
                if value:
                    texts.append(str(value))
            return "".join(texts).strip()
    return output.get("text") or output.get("transcription") or ""


def main():
    parser = argparse.ArgumentParser(description="Test Aliyun DashScope ASR with a public audio URL.")
    parser.add_argument("url", help="Publicly accessible audio URL")
    parser.add_argument("--model", default=None, help="ASR model, default from ALI_ASR_MODEL or paraformer-v2")
    parser.add_argument("--timeout", type=int, default=90, help="Polling timeout seconds")
    parser.add_argument("--skip-url-check", action="store_true", help="Skip public URL accessibility check")
    args = parser.parse_args()

    load_dotenv()
    api_key = os.getenv("ALI_ASR_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    model = args.model or os.getenv("ALI_ASR_MODEL") or "paraformer-v2"
    if not api_key:
        raise SystemExit("Missing ALI_ASR_API_KEY or DASHSCOPE_API_KEY in .env")

    if not args.skip_url_check:
        check_public_url(args.url)

    from dashscope.audio.asr import Transcription

    started_at = time.monotonic()
    task = Transcription.async_call(model=model, file_urls=[args.url], api_key=api_key)
    task_output = response_output(task)
    print("submit:", json.dumps({
        "status_code": response_value(task, "status_code"),
        "message": response_value(task, "message", ""),
        "request_id": response_value(task, "request_id", ""),
        "task_id": task_output.get("task_id"),
        "task_status": task_output.get("task_status"),
    }, ensure_ascii=False))

    result = task
    while time.monotonic() - started_at < args.timeout:
        result = Transcription.fetch(task, api_key=api_key)
        output = response_output(result)
        status_code = response_value(result, "status_code")
        task_status = str(output.get("task_status") or "").upper()
        print("poll:", json.dumps({
            "elapsed_ms": int((time.monotonic() - started_at) * 1000),
            "status_code": status_code,
            "message": response_value(result, "message", ""),
            "task_status": task_status,
        }, ensure_ascii=False))
        if status_code and int(status_code) >= 400:
            break
        if task_status in {"SUCCEEDED", "SUCCESS", "COMPLETED", "FAILED", "CANCELED", "CANCELLED"}:
            break
        time.sleep(2)

    final_output = response_output(result)
    text = extract_text(final_output)
    print("final_output:", json.dumps(final_output, ensure_ascii=False)[:2000])
    print("text:", text or "<EMPTY>")


if __name__ == "__main__":
    main()
