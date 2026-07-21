from __future__ import annotations

import argparse
import time
import urllib.parse
from datetime import datetime

from verify_family_health_sharing import create_auto_token, get_data, request_json


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family AI weekly and monthly report flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--phone", default="13900006691")
    parser.add_argument("--device-mac", default="")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-5:]
    token = create_auto_token(args.phone)
    device_mac = args.device_mac or f"VERIFY-WEEKLY-{suffix}"

    member = get_data(
        request_json(
            base,
            "POST",
            "/app/family/member/add",
            token,
            {
                "name": f"周报测试老人{suffix}",
                "relation": "father",
            },
        )
    )
    member_id = int(member["id"])
    print(f"[OK] created family member id={member_id}")

    get_data(
        request_json(
            base,
            "POST",
            "/app/family/device/bind",
            token,
            {
                "memberId": member_id,
                "mac": device_mac,
                "deviceName": "周报验证设备",
            },
        )
    )
    print("[OK] bound device")

    request_json(
        base,
        "POST",
        "/app/data/sync",
        token,
        {
            "deviceMac": device_mac,
            "battery": 82,
            "dataList": [
                {
                    "recordTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "heartRate": 78,
                    "spo2": 97,
                    "temperature": 36.5,
                    "stepCount": 2600,
                    "stress": 30,
                    "hrv": 45,
                }
            ],
        },
    )
    print("[OK] synced data")

    report_path = f"/app/family/ai/weeklyReport?{urllib.parse.urlencode({'memberId': member_id})}"
    report = get_data(request_json(base, "GET", report_path, token))
    assert report["title"] == "AI 看护周报"
    assert int(report["metrics"]["syncedDays"]) >= 1
    assert report["conclusion"]
    assert report["suggestions"]
    print("[OK] weekly report returned conclusion, metrics and suggestions")

    monthly_path = f"/app/family/ai/monthlyReport?{urllib.parse.urlencode({'memberId': member_id})}"
    monthly = get_data(request_json(base, "GET", monthly_path, token))
    assert monthly["title"] == "AI 看护月报"
    assert int(monthly["metrics"]["syncedDays"]) >= 1
    assert int(monthly["metrics"]["totalDays"]) == 30
    assert monthly["conclusion"]
    assert monthly["suggestions"]
    print("[OK] monthly report returned conclusion, metrics and suggestions")

    request_json(
        base,
        "POST",
        "/app/family/share/updatePermissions",
        token,
        {
            "memberId": member_id,
            "permissions": {
                "vitalSigns": True,
                "sleep": True,
                "motion": True,
                "alerts": True,
                "aiSummary": False,
                "deviceStatus": True,
            },
        },
    )
    blocked = False
    try:
        request_json(base, "GET", report_path, token)
    except RuntimeError as exc:
        blocked = "未开启该数据共享权限" in str(exc)
        print(f"[OK] weekly report denied after aiSummary disabled: {exc}")
    assert blocked

    monthly_blocked = False
    try:
        request_json(base, "GET", monthly_path, token)
    except RuntimeError as exc:
        monthly_blocked = "未开启该数据共享权限" in str(exc)
        print(f"[OK] monthly report denied after aiSummary disabled: {exc}")
    assert monthly_blocked

    print("Family AI report verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
