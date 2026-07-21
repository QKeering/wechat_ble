from __future__ import annotations

import argparse
import time

from verify_family_health_sharing import create_auto_token, get_data, request_json


def create_member(base: str, token: str, name: str) -> int:
    member = get_data(
        request_json(
            base,
            "POST",
            "/app/family/member/add",
            token,
            {
                "name": name,
                "relation": "parent",
            },
        )
    )
    return int(member["id"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family device binding conflict protection.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--first-phone", default="13900006681")
    parser.add_argument("--second-phone", default="13900006682")
    parser.add_argument("--device-mac", default="")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-5:]
    device_mac = args.device_mac or f"VERIFY-CONFLICT-{suffix}"

    first_token = create_auto_token(args.first_phone)
    second_token = create_auto_token(args.second_phone)
    first_member_id = create_member(base, first_token, f"冲突测试老人A{suffix}")
    second_member_id = create_member(base, second_token, f"冲突测试老人B{suffix}")
    print(f"[OK] created members first={first_member_id} second={second_member_id}")

    first_bound = get_data(
        request_json(
            base,
            "POST",
            "/app/family/device/bind",
            first_token,
            {
                "memberId": first_member_id,
                "mac": device_mac,
                "deviceName": "冲突验证设备",
            },
        )
    )
    assert first_bound.get("deviceMac") == device_mac
    print("[OK] first guardian bound device")

    blocked = False
    try:
        request_json(
            base,
            "POST",
            "/app/family/device/bind",
            second_token,
            {
                "memberId": second_member_id,
                "mac": device_mac,
                "deviceName": "冲突验证设备",
            },
        )
    except RuntimeError as exc:
        blocked = "已绑定其他健康档案" in str(exc)
        print(f"[OK] second binding blocked without confirmation: {exc}")
    assert blocked

    forced = get_data(
        request_json(
            base,
            "POST",
            "/app/family/device/bind",
            second_token,
            {
                "memberId": second_member_id,
                "mac": device_mac,
                "deviceName": "冲突验证设备",
                "forceBind": True,
            },
        )
    )
    assert forced.get("deviceMac") == device_mac
    print("[OK] second guardian rebound device after explicit confirmation")

    print("Family device conflict verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
