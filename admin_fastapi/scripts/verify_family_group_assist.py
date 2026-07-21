from __future__ import annotations

import argparse
import time
import urllib.parse
from typing import Any

from verify_family_health_sharing import create_auto_token, get_data, request_json
from verify_family_admin_abnormal_unsynced import request_json as admin_request_json


def admin_token() -> str:
    from app.db.redis import redis_client
    from app.db.session import SessionLocal
    from app.services import auth, family
    from sqlalchemy import text

    redis = redis_client()
    if redis is None:
        raise RuntimeError("Redis is not configured; cannot create admin login token.")
    with SessionLocal() as db:
        family.initialize_schema(db)
        row = db.execute(text("select * from sys_user where del_flag='0' order by user_id asc limit 1")).first()
        if not row:
            raise RuntimeError("No sys_user row found for admin token.")
        return auth.create_token(redis, auth.camelize_row(row), ["*:*:*"])


def assert_true(condition: Any, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"[OK] {message}")


def same_assist_source(item: dict[str, Any], assist_id: int) -> bool:
    if item.get("sourceType") != "family_assist_request":
        return False
    source = str(item.get("sourceId") or item.get("id") or "")
    return source == str(assist_id) or source.endswith(f"-{assist_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family group collaboration and manual assist request flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--phone", default="13900006731")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-5:]
    token = create_auto_token(args.phone)

    member = get_data(
        request_json(
            base,
            "POST",
            "/app/family/member/add",
            token,
            {"name": f"协同照护老人{suffix}", "relation": "father"},
        )
    )
    member_id = int(member["id"])
    relation_id = int(member.get("relationId") or 0)
    assert_true(member_id > 0 and relation_id > 0, "created family member with relationId")

    group = get_data(
        request_json(
            base,
            "POST",
            "/app/family/groups",
            token,
            {
                "groupName": f"协同照护组{suffix}",
                "description": "验证多子女协同照护入口",
                "relationIds": [relation_id],
            },
        )
    )
    assert_true(int(group["id"]) > 0, "created family group")
    assert_true(int(group.get("memberCount") or 0) == 1, "family group includes selected elder relation")

    groups = get_data(request_json(base, "GET", "/app/family/groups", token))
    matched_group = next((item for item in groups if int(item["id"]) == int(group["id"])), None)
    assert_true(matched_group and matched_group.get("members"), "family groups list returns member relations")

    assist = get_data(
        request_json(
            base,
            "POST",
            "/app/family/assist",
            token,
            {
                "relationId": relation_id,
                "memberId": member_id,
                "requestType": "device_bind",
                "contactPhone": args.phone,
                "deviceMac": f"VERIFY-ASSIST-{suffix}",
                "description": "请协助确认老人设备绑定与数据共享状态",
            },
        )
    )
    assist_id = int(assist["id"])
    assert_true(assist_id > 0 and assist["statusText"] == "待处理", "submitted manual assist request")
    assert_true(assist.get("contactPhoneMasked"), "assist request masks contact phone in app response")

    requests = get_data(request_json(base, "GET", "/app/family/assist/list", token))
    assert_true(any(int(item["id"]) == assist_id for item in requests), "assist request list returns submitted request")

    query = urllib.parse.urlencode({"keyword": str(assist_id), "pageNum": 1, "pageSize": 10})
    admin = admin_token()
    abnormal = admin_request_json(base, "GET", f"/admin/family/abnormal/list?{query}", admin)
    rows = abnormal.get("rows") or []
    assert_true(
        any(same_assist_source(item, assist_id) for item in rows),
        "admin abnormal center includes pending assist request",
    )

    processing = admin_request_json(base, "PUT", f"/admin/family/assist/{assist_id}/status", admin, {"status": 1})
    processing_data = processing.get("data") or {}
    assert_true(int(processing_data.get("status") or 0) == 1, "admin can mark assist request as processing")
    assert_true(processing_data.get("operatorName") or processing_data.get("operatorUserId"), "assist processing records operator")

    completed = admin_request_json(
        base,
        "PUT",
        f"/admin/family/assist/{assist_id}/status",
        admin,
        {"status": 2, "resultNote": "已电话确认设备绑定流程，提醒用户重新同步。"},
    )
    completed_data = completed.get("data") or {}
    assert_true(int(completed_data.get("status") or 0) == 2, "admin can complete assist request")
    assert_true("重新同步" in str(completed_data.get("resultNote") or ""), "assist completion records result note")

    abnormal_after = admin_request_json(base, "GET", f"/admin/family/abnormal/list?{query}", admin)
    rows_after = abnormal_after.get("rows") or []
    assert_true(
        not any(same_assist_source(item, assist_id) for item in rows_after),
        "completed assist request leaves abnormal pending list",
    )

    print("Family group and assist request verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
