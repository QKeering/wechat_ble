from __future__ import annotations

import argparse
import time

from verify_family_health_sharing import create_auto_token, get_data, request_json


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify elder-initiated guardian invite flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--elder-phone", default="13900006711")
    parser.add_argument("--guardian-phone", default="13900006712")
    parser.add_argument("--stranger-phone", default="13900006713")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = int(str(int(time.time()))[-4:])
    elder_suffix = f"{suffix:04d}"
    guardian_suffix = f"{(suffix + 1) % 10000:04d}"
    stranger_suffix = f"{(suffix + 2) % 10000:04d}"
    elder_phone = args.elder_phone[:-4] + elder_suffix if len(args.elder_phone) >= 4 else args.elder_phone + elder_suffix
    guardian_phone = args.guardian_phone[:-4] + guardian_suffix if len(args.guardian_phone) >= 4 else args.guardian_phone + guardian_suffix
    stranger_phone = args.stranger_phone[:-4] + stranger_suffix if len(args.stranger_phone) >= 4 else args.stranger_phone + stranger_suffix

    elder_token = create_auto_token(elder_phone)
    guardian_token = create_auto_token(guardian_phone)
    stranger_token = create_auto_token(stranger_phone)

    invite = get_data(
        request_json(
            base,
            "POST",
            "/app/family/invite",
            elder_token,
            {
                "inviteType": 1,
                "targetPhone": guardian_phone,
            },
        )
    )
    print(f"[OK] elder created guardian invite {invite['inviteCode']}")

    blocked = False
    try:
        request_json(base, "POST", f"/app/family/invite/{invite['inviteCode']}/accept", stranger_token)
    except RuntimeError as exc:
        blocked = "仅限指定手机号" in str(exc)
        print(f"[OK] non-target phone cannot accept invite: {exc}")
    assert blocked, "non-target phone should not accept targeted invite"

    invites = get_data(request_json(base, "GET", "/app/family/invite/list", guardian_token))
    matched = [item for item in invites if item["inviteCode"] == invite["inviteCode"]]
    assert matched, "guardian invite list should include elder invite"
    target_phone_text = str(matched[0].get("targetPhoneMasked") or matched[0].get("targetPhone") or "")
    assert "****" in target_phone_text and target_phone_text != guardian_phone
    print("[OK] guardian invite list masks target phone")
    print("[OK] guardian invite list includes elder invite")

    accepted = get_data(request_json(base, "POST", f"/app/family/invite/{invite['inviteCode']}/accept", guardian_token))
    assert accepted["status"] == "accepted"
    relation_id = int(accepted["relationId"])
    print(f"[OK] guardian accepted invite relation={relation_id}")

    home = get_data(request_json(base, "GET", "/app/family/home", guardian_token))
    members = home.get("members") or []
    member = next((item for item in members if int(item.get("relationId") or 0) == relation_id), None)
    assert member, "guardian family home should include elder relation member card"
    member_id = int(member["id"])
    print(f"[OK] guardian home includes elder memberId={member_id}")

    dashboard = get_data(request_json(base, "GET", f"/app/family/health/dashboard?memberId={member_id}", guardian_token))
    assert int((dashboard.get("member") or {}).get("id") or 0) == member_id
    print("[OK] guardian can open elder health dashboard")

    guardians = get_data(request_json(base, "GET", "/app/family/guardians", elder_token))
    visible = next((item for item in guardians if int(item.get("relationId") or item.get("id") or 0) == relation_id), None)
    assert visible, "elder guardian list should include accepted guardian"
    print("[OK] elder guardian list includes accepted guardian")

    print("Family elder invite guardian verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
