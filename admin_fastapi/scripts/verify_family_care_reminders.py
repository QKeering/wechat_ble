from __future__ import annotations

import argparse
import time
from datetime import datetime

from verify_family_health_sharing import create_auto_token, get_data, request_json


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family care reminder inbox and subscribe state.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--phone", default="13900006721")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-5:]
    token = create_auto_token(args.phone)
    device_mac = f"VERIFY-CARE-{suffix}"

    member = get_data(
        request_json(
            base,
            "POST",
            "/app/family/member/add",
            token,
            {"name": f"照护提醒老人{suffix}", "relation": "father"},
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
            {"memberId": member_id, "mac": device_mac, "deviceName": "照护提醒验证设备"},
        )
    )
    request_json(
        base,
        "POST",
        "/app/data/sync",
        token,
        {
            "deviceMac": device_mac,
            "battery": 12,
            "dataList": [
                {
                    "recordTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "heartRate": 118,
                    "spo2": 91,
                    "temperature": 36.7,
                    "stepCount": 500,
                    "stress": 45,
                    "hrv": 35,
                }
            ],
        },
    )
    print("[OK] synced data that should produce care reminders")

    box = get_data(request_json(base, "GET", "/app/family/care/reminders", token))
    matched = next((item for item in box["reminders"] if int(item["memberId"]) == member_id), None)
    assert matched, box
    assert int(matched["priority"]) >= 70
    assert f"memberId={member_id}" in matched["actionUrl"]
    if matched.get("relationId"):
        assert f"relationId={matched['relationId']}" in matched["actionUrl"]
    assert box["unreadCount"] >= 1
    print("[OK] care reminder inbox returns prioritized reminder")

    subscription = get_data(
        request_json(
            base,
            "POST",
            "/app/family/care/subscribe",
            token,
            {
                "subscribeEnabled": True,
                "templateIds": ["tmpl-care-warning"],
                "requestStatus": {"tmpl-care-warning": "accept"},
            },
        )
    )
    assert subscription["subscribeEnabled"] is True
    assert subscription["templateIds"] == ["tmpl-care-warning"]
    assert subscription["lastRequestStatus"]["tmpl-care-warning"] == "accept"
    print("[OK] care subscribe state persisted")

    print("Family care reminder verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
