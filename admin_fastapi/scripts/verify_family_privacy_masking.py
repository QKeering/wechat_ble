from __future__ import annotations

import argparse
import time

from verify_family_health_sharing import create_auto_token, get_data, request_json


def assert_masked(value: str | None, raw: str, label: str) -> None:
    text = str(value or "")
    if raw in text or "****" not in text:
        raise AssertionError(f"{label} should be masked, got {text!r}")
    print(f"[OK] {label} is masked as {text}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify app family APIs do not leak raw phone numbers.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--guardian-phone", default="13900006751")
    parser.add_argument("--elder-phone", default="13900006752")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-4:]
    guardian_phone = f"13951{suffix}01"
    elder_phone = f"13952{suffix}02"
    guardian_token = create_auto_token(guardian_phone)
    elder_token = create_auto_token(elder_phone)

    member = get_data(
        request_json(
            base,
            "POST",
            "/app/family/member/add",
            guardian_token,
            {"name": f"隐私老人{suffix}", "relation": "father", "phone": elder_phone},
        )
    )
    member_id = int(member["id"])
    relation_id = int(member["relationId"])
    print(f"[OK] created linked family member={member_id} relation={relation_id}")

    members = get_data(request_json(base, "GET", "/app/family/member/list", guardian_token))
    listed = next(item for item in members if int(item["id"]) == member_id)
    assert_masked(listed.get("phone"), elder_phone, "family member phone")
    assert_masked(listed.get("phoneMasked"), elder_phone, "family member phoneMasked")

    guardians = get_data(request_json(base, "GET", "/app/family/guardians", elder_token))
    guardian = next(item for item in guardians if int(item["relationId"]) == relation_id)
    assert_masked(guardian.get("guardianPhone"), guardian_phone, "guardian phone")
    assert_masked(guardian.get("guardianPhoneMasked"), guardian_phone, "guardian phoneMasked")

    group = get_data(
        request_json(
            base,
            "POST",
            "/app/family/groups",
            guardian_token,
            {"groupName": f"隐私群组{suffix}", "relationIds": [relation_id]},
        )
    )
    group_member = group["members"][0]
    assert_masked(group_member.get("phone"), elder_phone, "family group member phone")
    assert_masked(group_member.get("phoneMasked"), elder_phone, "family group member phoneMasked")

    assist = get_data(
        request_json(
            base,
            "POST",
            "/app/family/assist",
            guardian_token,
            {
                "relationId": relation_id,
                "memberId": member_id,
                "contactPhone": guardian_phone,
                "description": "请协助确认隐私脱敏后的人工协助请求",
            },
        )
    )
    assert_masked(assist.get("contactPhone"), guardian_phone, "assist contact phone")
    assert_masked(assist.get("contactPhoneMasked"), guardian_phone, "assist contact phoneMasked")

    requests = get_data(request_json(base, "GET", "/app/family/assist/list", guardian_token))
    request_item = next(item for item in requests if int(item["id"]) == int(assist["id"]))
    assert_masked(request_item.get("contactPhone"), guardian_phone, "assist list contact phone")
    assert_masked(request_item.get("contactPhoneMasked"), guardian_phone, "assist list contact phoneMasked")

    print("Family privacy masking verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
