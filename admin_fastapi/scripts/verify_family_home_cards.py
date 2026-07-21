from __future__ import annotations

import argparse
import time
from datetime import datetime

from verify_family_health_sharing import create_auto_token, get_data, request_json


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family home care card summaries.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--phone", default="13900006701")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-5:]
    token = create_auto_token(args.phone)
    device_mac = f"VERIFY-HOME-{suffix}"

    member = get_data(
        request_json(
            base,
            "POST",
            "/app/family/member/add",
            token,
            {"name": f"首页卡片老人{suffix}", "relation": "mother"},
        )
    )
    member_id = int(member["id"])
    print(f"[OK] created member id={member_id}")

    get_data(
        request_json(
            base,
            "POST",
            "/app/family/device/bind",
            token,
            {"memberId": member_id, "mac": device_mac, "deviceName": "首页卡片验证设备"},
        )
    )
    request_json(
        base,
        "POST",
        "/app/data/sync",
        token,
        {
            "deviceMac": device_mac,
            "battery": 18,
            "dataList": [
                {
                    "recordTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "heartRate": 76,
                    "spo2": 92,
                    "temperature": 36.6,
                    "stepCount": 1200,
                    "stress": 35,
                    "hrv": 42,
                }
            ],
        },
    )
    print("[OK] synced attention data")

    home = get_data(request_json(base, "GET", "/app/family/home", token))
    matched = next((item for item in home["members"] if int(item["id"]) == member_id), None)
    assert matched
    assert int(matched.get("carePriority") or 0) >= 70
    assert matched.get("careReasons")
    assert matched.get("careSuggestion")
    assert matched.get("cardSummary")
    assert matched.get("metrics", {}).get("spo2") == 92
    print("[OK] family home returns prioritized card summary and metrics")

    print("Family home card verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
