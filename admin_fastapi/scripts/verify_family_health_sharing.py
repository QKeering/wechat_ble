from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def request_json(base_url: str, method: str, path: str, token: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = base_url.rstrip("/") + path
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": token,
            "token": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"{method} {path} HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {path} failed: {exc.reason}") from exc

    try:
        result = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{method} {path} returned non-json: {raw[:300]}") from exc

    code = result.get("code")
    if code not in (0, 200):
        raise RuntimeError(f"{method} {path} business error: {result}")
    return result


def get_data(result: dict[str, Any]) -> Any:
    return result.get("data")


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"[OK] {message}")


def create_auto_token(phone: str) -> str:
    from app.db.redis import redis_client
    from app.db.session import SessionLocal
    from app.services import app_auth
    from app.services.family import initialize_schema

    redis = redis_client()
    if redis is None:
        raise RuntimeError("Redis is not configured; cannot create app login token.")
    with SessionLocal() as db:
        initialize_schema(db)
        user = app_auth.user_by_phone(db, phone)
        if not user:
            user = app_auth.create_user(db, open_id=f"verify-family:{phone}", phone=phone)
        token = app_auth.create_token(redis, user)
        print(f"[OK] auto-created child token for userId={user['id']} phone={phone}")
        return token


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family account health-data sharing flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL, for example http://127.0.0.1:8000")
    parser.add_argument("--token", default="", help="Child account app token/JWT.")
    parser.add_argument("--auto-token", action="store_true", help="Create/reuse a local child test user and generate an app token via backend services.")
    parser.add_argument("--child-phone", default="13900009999", help="Phone used by --auto-token child test user.")
    parser.add_argument("--device-mac", default=f"VERIFY-FAMILY-{int(time.time())}", help="Device MAC/SN to bind as parent device.")
    parser.add_argument("--member-name", default="验收父亲", help="Temporary family member name.")
    parser.add_argument("--phone", default="", help="Optional parent phone.")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    token = create_auto_token(args.child_phone) if args.auto_token else args.token
    if not token:
        raise RuntimeError("Provide --token or use --auto-token.")
    device_mac = args.device_mac

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"Base URL: {base_url}")
    print(f"Device MAC: {device_mac}")

    member = get_data(
        request_json(
            base_url,
            "POST",
            "/app/family/member/add",
            token,
            {
                "name": args.member_name,
                "relation": "father",
                "phone": args.phone,
            },
        )
    )
    member_id = int(member["id"])
    assert_true(member_id > 0, f"created family member id={member_id}")

    bound = get_data(
        request_json(
            base_url,
            "POST",
            "/app/family/device/bind",
            token,
            {
                "memberId": member_id,
                "mac": device_mac,
                "deviceName": f"{args.member_name}的设备",
                "serviceId": "verify-service",
            },
        )
    )
    assert_true(bound.get("deviceMac") == device_mac, "bound device to family member")

    request_json(
        base_url,
        "POST",
        "/app/data/sync",
        token,
        {
            "deviceMac": device_mac,
            "battery": 88,
            "dataList": [
                {
                    "recordTime": now,
                    "heartRate": 76,
                    "spo2": 98,
                    "temperature": 36.6,
                    "stepCount": 1800,
                    "stress": 32,
                    "hrv": 42,
                }
            ],
        },
    )
    assert_true(True, "synced health data with parent device MAC")

    dashboard_path = f"/app/family/health/dashboard?{urllib.parse.urlencode({'memberId': member_id})}"
    dashboard = get_data(request_json(base_url, "GET", dashboard_path, token))
    summary = dashboard.get("summary") or {}
    assert_true((dashboard.get("member") or {}).get("id") == member_id, "dashboard returns the family member")
    assert_true(round(float(summary.get("heartRateAvg") or 0)) == 76, "dashboard summary contains synced parent heart rate")
    assert_true(round(float(summary.get("spo2Avg") or 0)) == 98, "dashboard summary contains synced parent blood oxygen")
    assert_true(dashboard.get("aiSummary") is not None, "dashboard returns AI daily summary")

    vital_path = f"/app/family/data/vitalSign?{urllib.parse.urlencode({'memberId': member_id})}"
    vital = get_data(request_json(base_url, "GET", vital_path, token))
    assert_true(round(float(vital.get("heartRate") or 0)) == 76, "family vitalSign endpoint reads parent data")

    request_json(
        base_url,
        "POST",
        "/app/family/share/updatePermissions",
        token,
        {
            "memberId": member_id,
            "permissions": {
                "vitalSigns": False,
                "sleep": True,
                "motion": True,
                "alerts": True,
                "aiSummary": True,
                "deviceStatus": True,
            },
        },
    )
    assert_true(True, "disabled vitalSigns sharing permission")

    blocked = False
    try:
        request_json(base_url, "GET", vital_path, token)
    except RuntimeError as exc:
        blocked = "未开启该数据共享权限" in str(exc) or "business error" in str(exc)
        print(f"[OK] vitalSign denied after permission disabled: {exc}")
    assert_true(blocked, "vitalSign endpoint is blocked after permission disabled")

    filtered_dashboard = get_data(request_json(base_url, "GET", dashboard_path, token))
    filtered_summary = filtered_dashboard.get("summary") or {}
    assert_true("heartRateAvg" not in filtered_summary and "spo2Avg" not in filtered_summary, "dashboard hides vital-sign fields after permission disabled")

    print("\nFamily health sharing verification passed.")
    print(f"Created memberId={member_id}; deviceMac={device_mac}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"\n[FAILED] {exc}", file=sys.stderr)
        raise SystemExit(1)
