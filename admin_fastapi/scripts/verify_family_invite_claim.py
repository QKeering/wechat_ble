from __future__ import annotations

import argparse
import time

from verify_family_health_sharing import create_auto_token, get_data, request_json


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family invite and elder profile claim flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--guardian-phone", default="13900006661")
    parser.add_argument("--elder-phone", default="13900006662")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-4:]
    elder_phone = args.elder_phone[:-4] + suffix if len(args.elder_phone) >= 4 else args.elder_phone + suffix
    guardian_token = create_auto_token(args.guardian_phone)

    created = get_data(
        request_json(
            base,
            "POST",
            "/app/family/elder-profile",
            guardian_token,
            {
                "name": f"待认领老人{suffix}",
                "relation": "father",
                "phone": elder_phone,
                "height": 170,
            },
        )
    )
    print(f"[OK] created elder profile relation={created['relationId']} profile={created['elderProfileId']}")

    invite = get_data(
        request_json(
            base,
            "POST",
            "/app/family/invite",
            guardian_token,
            {
                "inviteType": 2,
                "targetPhone": elder_phone,
                "relationId": created["relationId"],
                "elderProfileId": created["elderProfileId"],
            },
        )
    )
    print(f"[OK] created invite {invite['inviteCode']}")

    elder_token = create_auto_token(elder_phone)

    elder_home = get_data(request_json(base, "GET", "/app/family/home", elder_token))
    assert elder_home["pendingInviteCount"] >= 1
    print("[OK] elder home shows pending invite")

    invites = get_data(request_json(base, "GET", "/app/family/invite/list", elder_token))
    matched = [item for item in invites if item["inviteCode"] == invite["inviteCode"]]
    assert matched and matched[0]["elderProfileId"] == created["elderProfileId"]
    print("[OK] elder invite list includes the invite")

    accepted = get_data(request_json(base, "POST", f"/app/family/invite/{invite['inviteCode']}/accept", elder_token))
    assert accepted["status"] == "accepted"
    print("[OK] elder accepted invite")

    claimed = get_data(request_json(base, "POST", f"/app/family/elder-profile/{created['elderProfileId']}/claim", elder_token))
    assert int(claimed["elderUserId"]) > 0
    print("[OK] elder claimed profile and migrated ownership")

    elders = get_data(request_json(base, "GET", "/app/family/elders", guardian_token))
    relation = next((item for item in elders if item.get("relationId") == created["relationId"]), None)
    assert relation and relation.get("elderUserId") == claimed["elderUserId"]
    print("[OK] guardian relation points to claimed elder user")

    print("Family invite claim verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
