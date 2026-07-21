from __future__ import annotations

import argparse
import time

from sqlalchemy import text

from verify_family_health_sharing import create_auto_token, get_data, request_json


def expect_business_error(base_url: str, method: str, path: str, token: str, payload: dict | None = None) -> str:
    try:
        request_json(base_url, method, path, token, payload)
    except RuntimeError as exc:
        return str(exc)
    raise AssertionError(f"{method} {path} should fail")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family invites expire persistently and reject invalid target phones.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--phone", default="13900006741")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-5:]
    token = create_auto_token(args.phone)

    invalid_error = expect_business_error(
        base,
        "POST",
        "/app/family/invite",
        token,
        {"inviteType": 1, "targetPhone": "12345"},
    )
    assert "手机号" in invalid_error
    print("[OK] backend rejects invalid invite target phone")

    invite = get_data(
        request_json(
            base,
            "POST",
            "/app/family/invite",
            token,
            {"inviteType": 1, "targetPhone": f"139{suffix}741"},
        )
    )
    invite_code = invite["inviteCode"]
    print(f"[OK] created invite {invite_code}")

    from app.db.session import SessionLocal
    from app.services import family

    with SessionLocal() as db:
        family.initialize_schema(db)
        db.execute(
            text("update family_invite set expire_time=date_sub(now(), interval 1 minute) where invite_code=:code"),
            {"code": invite_code},
        )
        db.commit()
    print("[OK] moved invite expire_time into the past")

    invites = get_data(request_json(base, "GET", "/app/family/invite/list", token))
    matched = next((item for item in invites if item["inviteCode"] == invite_code), None)
    assert matched and int(matched["status"]) == 3 and matched["statusText"] == "已过期"
    print("[OK] invite list persists expired status")

    with SessionLocal() as db:
        status = db.execute(text("select status from family_invite where invite_code=:code"), {"code": invite_code}).scalar()
        assert int(status) == 3
    print("[OK] expired invite status is saved to database")

    accept_error = expect_business_error(base, "POST", f"/app/family/invite/{invite_code}/accept", token)
    assert "邀请已处理" in accept_error or "邀请已过期" in accept_error
    print("[OK] expired invite cannot be accepted")

    print("Family invite expiry verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
