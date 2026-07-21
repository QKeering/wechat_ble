from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.app import localize_payload_levels


BAD_MOJIBAKE_SNIPPETS = [
    "淇濇寔",
    "灏忔椂",
    "鍒嗛挓",
    "鍏呰冻",
    "姝ｅ父",
    "鏀炬澗",
    "涓瓑",
    "鍋忛珮",
    "寰堥珮",
    "娣辩潯",
    "娴呯潯",
    "娓呴啋",
    "绠楁硶",
    "鏃犲コ",
]

BAD_ENGLISH_VALUES = {
    "needs improvement",
    "needsimprovement",
    "need improvement",
    "needimprovement",
    "improvement needed",
    "improvementneeded",
    "suboptimal",
    "insufficient",
    "inadequate",
    "very poor",
    "no change",
    "unchanged",
    "stable",
    "poor",
    "bad",
    "worse",
    "worsened",
    "declined",
    "good",
    "better",
    "improved",
    "great",
    "excellent",
    "optimal",
    "ideal",
    "inactive",
    "sedentary",
    "active",
    "lifestyle",
    "low activity",
    "lowactivity",
    "high activity",
    "highactivity",
    "insufficient activity",
    "insufficientactivity",
    "sleep activation",
    "sleepactivation",
    "sleep preparation",
    "sleeppreparation",
    "sleep recovery",
    "sleeprecovery",
    "sleep rhythm",
    "sleeprhythm",
    "sleep quality",
    "sleepquality",
    "sleep duration",
    "sleepduration",
    "quality",
    "duration",
    "preparation",
    "recovery",
    "rhythm",
    "room for improvement",
    "roomforimprovement",
    "activity risk",
    "activityrisk",
    "sedentary risk",
    "sedentaryrisk",
    "exercise regularity",
    "exerciseregularity",
    "vital signs",
    "vitalsigns",
    "heart rate",
    "heartrate",
    "blood oxygen",
    "bloodoxygen",
    "body temperature",
    "bodytemperature",
    "very low",
    "low",
    "normal",
    "medium",
    "moderate",
    "fair",
    "average",
    "high",
    "very high",
    "intense",
    "severe",
    "mild",
    "sufficient",
    "adequate",
    "relax",
    "relaxed",
    "low risk",
    "medium risk",
    "moderate risk",
    "high risk",
    "normal load",
    "normalload",
    "light load",
    "lightload",
    "heavy load",
    "heavyload",
    "awake",
    "rem",
    "light sleep",
    "deep",
    "deep sleep",
    "core sleep",
}

DEFAULT_ENDPOINTS = [
    "/app/health/index",
    "/app/health/report",
    "/app/health/sleep/preparation",
    "/app/health/sleep/rhythm",
    "/app/health/sleep/recovery",
    "/app/health/sleep/activation",
    "/app/health/activity/sedentary",
    "/app/health/activity/intensity",
    "/app/health/activity/regularity",
    "/app/data/vitalSign",
    "/app/data/balanceScore",
    "/app/data/stress/stressDetail",
    "/app/data/stress/stressProportion",
    "/app/data/stress/stressSummary",
    "/app/data/motion/motionIntensity",
    "/app/data/motion/motionSummary",
    "/app/data/sleep/sleepOverview",
    "/app/data/sleep/sleepDetail",
    "/app/data/sleep/sleepSegment",
    "/app/data/sleep/sleepSummary",
]


def iter_strings(value: Any, path: str = "$"):
    if isinstance(value, str):
        yield path, value
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            yield from iter_strings(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            yield from iter_strings(item, f"{path}.{key}")


def normalize_text(value: str) -> str:
    return re.sub(r"[\s_-]+", " ", value.strip()).lower()


def compact_text(value: str) -> str:
    return re.sub(r"[\W_]+", "", value.strip().lower())


BAD_ENGLISH_COMPACT_VALUES = {compact_text(value) for value in BAD_ENGLISH_VALUES}


def find_bad_text(payload: Any) -> list[tuple[str, str, str]]:
    issues: list[tuple[str, str, str]] = []
    for path, value in iter_strings(payload):
        normalized = normalize_text(value)
        compact = compact_text(value)
        if any(snippet in value for snippet in BAD_MOJIBAKE_SNIPPETS):
            issues.append((path, value, "mojibake"))
            continue
        if normalized in BAD_ENGLISH_VALUES or compact in BAD_ENGLISH_COMPACT_VALUES:
            issues.append((path, value, "english-level"))
            continue
        if re.fullmatch(r"[+-]?\d+\s+vs previous", normalized):
            issues.append((path, value, "english-trend"))
    return issues


def sample_payload() -> dict:
    return {
        "status": "Needs improvement",
        "trend": "No change",
        "dateRange": "07-06 To 07-12",
        "sleep": {
            "activation": {"level": "needs_improvement"},
            "duration": "1灏忔椂30鍒嗛挓",
            "segments": [{"time": "娣辩潯"}, {"time": "REM"}],
        },
        "stress": [{"time": "鏀炬澗"}, {"time": "high"}],
        "algorithm": {
            "riskLevel": "high risk",
            "regularityLevel": "Good",
            "recoveryLevel": "Fair",
            "habitTrend": "Stable",
            "activityTrend": "Improved",
            "sedentaryLevel": "Sedentary",
            "sleepStage": "Deep sleep",
            "loadLevel": "Heavy load",
            "habitName": "Lifestyle",
            "activationName": "Sleep activation",
            "qualityName": "Sleep quality",
            "durationName": "Sleep duration",
            "recoveryName": "Recovery",
            "rhythmName": "Rhythm",
            "riskName": "Activity risk",
            "vitalName": "Vital signs",
            "spo2Name": "Blood oxygen",
            "compactStatus": "NeedsImprovement",
            "compactLevel": "RoomForImprovement",
            "compactActivity": "LowActivity",
            "compactIntensity": "ModerateIntensity",
            "compactRisk": "SedentaryRisk",
            "compactSleepQuality": "SleepQuality",
            "compactHeartRate": "HeartRate",
            "compactLoad": "HeavyLoad",
        },
    }


def english_value_variants(value: str) -> set[str]:
    normalized = normalize_text(value)
    parts = [part for part in re.split(r"[\s_-]+", value.strip()) if part]
    pascal = "".join(part[:1].upper() + part[1:].lower() for part in parts)
    variants = {
        value,
        normalized,
        normalized.title(),
        normalized.replace(" ", ""),
        value.replace(" ", ""),
        pascal,
    }
    if pascal:
        variants.add(pascal[:1].lower() + pascal[1:])
    return {variant for variant in variants if variant}


def run_bad_english_collection_check() -> None:
    payload = {
        f"value{index}": variant
        for index, variant in enumerate(
            sorted({variant for value in BAD_ENGLISH_VALUES for variant in english_value_variants(value)})
        )
    }
    localized = localize_payload_levels(payload)
    issues = find_bad_text(localized)
    if issues:
        raise AssertionError(f"bad English collection localization still has bad text: {issues[:20]}")
    print(f"collection health text localization passed ({len(payload)} variants).")


def run_sample_check() -> None:
    localized = localize_payload_levels(sample_payload())
    issues = find_bad_text(localized)
    if issues:
        raise AssertionError(f"sample localization still has bad text: {issues}")
    assert localized["status"] == "待改善"
    assert localized["trend"] == "保持不变"
    assert localized["dateRange"] == "07-06 至 07-12"
    assert localized["sleep"]["activation"]["level"] == "待改善"
    assert localized["sleep"]["duration"] == "1小时30分钟"
    assert localized["sleep"]["segments"] == [{"time": "深睡"}, {"time": "快速眼动"}]
    assert localized["stress"] == [{"time": "放松"}, {"time": "偏高"}]
    assert localized["algorithm"]["riskLevel"] == "高风险"
    assert localized["algorithm"]["regularityLevel"] == "良好"
    assert localized["algorithm"]["recoveryLevel"] == "一般"
    assert localized["algorithm"]["habitTrend"] == "保持不变"
    assert localized["algorithm"]["activityTrend"] == "有改善"
    assert localized["algorithm"]["sedentaryLevel"] == "久坐"
    assert localized["algorithm"]["sleepStage"] == "深睡"
    assert localized["algorithm"]["loadLevel"] == "重度负荷"
    assert localized["algorithm"]["habitName"] == "生活习惯"
    assert localized["algorithm"]["activationName"] == "睡眠激活"
    assert localized["algorithm"]["qualityName"] == "睡眠质量"
    assert localized["algorithm"]["durationName"] == "睡眠时长"
    assert localized["algorithm"]["recoveryName"] == "恢复"
    assert localized["algorithm"]["rhythmName"] == "节律"
    assert localized["algorithm"]["riskName"] == "活动强度"
    assert localized["algorithm"]["vitalName"] == "生命体征"
    assert localized["algorithm"]["spo2Name"] == "血氧"
    assert localized["algorithm"]["compactStatus"] == "待改善"
    assert localized["algorithm"]["compactLevel"] == "待改善"
    assert localized["algorithm"]["compactActivity"] == "活动偏低"
    assert localized["algorithm"]["compactIntensity"] == "中等强度"
    assert localized["algorithm"]["compactRisk"] == "久坐风险"
    assert localized["algorithm"]["compactSleepQuality"] == "睡眠质量"
    assert localized["algorithm"]["compactHeartRate"] == "心率"
    assert localized["algorithm"]["compactLoad"] == "重度负荷"
    print("sample health text localization passed.")
    run_bad_english_collection_check()


def endpoint_url(base_url: str, endpoint: str, date_value: str) -> str:
    base = base_url.rstrip("/") + "/"
    url = urllib.parse.urljoin(base, endpoint.lstrip("/"))
    parsed = urllib.parse.urlparse(url)
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query.setdefault("date", date_value)
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query)))


def fetch_json(url: str, token: str | None, timeout: int) -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = token
        headers["token"] = token
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
    return json.loads(body) if body else None


def check_endpoint(base_url: str, endpoint: str, token: str | None, date_value: str, timeout: int) -> list[tuple[str, str, str]]:
    url = endpoint_url(base_url, endpoint, date_value)
    try:
        payload = fetch_json(url, token, timeout)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return [(endpoint, f"HTTP {exc.code}: {body[:300]}", "http-error")]
    except Exception as exc:
        return [(endpoint, str(exc), "request-error")]
    return [(f"{endpoint}{path[1:]}", value, reason) for path, value, reason in find_bad_text(payload)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check health API responses for known English or mojibake display text.")
    parser.add_argument("--base-url", help="Backend base URL, for example http://127.0.0.1:8128")
    parser.add_argument("--token", help="Mini app user token. Also read from QKEER_APP_TOKEN when omitted.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Date query value for data endpoints.")
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--endpoint", action="append", help="Endpoint path to check. Can be repeated.")
    parser.add_argument("--sample-only", action="store_true", help="Only run the local sample localization check.")
    args = parser.parse_args()

    run_sample_check()
    if args.sample_only or not args.base_url:
        return 0

    token = args.token or __import__("os").environ.get("QKEER_APP_TOKEN")
    endpoints = args.endpoint or DEFAULT_ENDPOINTS
    all_issues: list[tuple[str, str, str]] = []
    for endpoint in endpoints:
        all_issues.extend(check_endpoint(args.base_url, endpoint, token, args.date, args.timeout))

    if all_issues:
        print("health text check failed:")
        for path, value, reason in all_issues:
            print(f"- [{reason}] {path}: {value}")
        return 1

    print(f"health text API check passed for {len(endpoints)} endpoint(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
