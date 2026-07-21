from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def request_json(base_url: str, method: str, path: str, token: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "token": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"{method} {path} HTTP {exc.code}: {body}") from exc
    result = json.loads(raw) if raw else {}
    if result.get("code") not in (0, 200):
        raise RuntimeError(f"{method} {path} business error: {result}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify admin family relation status audit flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    from app.db.session import SessionLocal
    from app.db.redis import redis_client
    from app.services import app_auth, auth, family
    from app.api.admin import ensure_family_relation_audit_schema
    from sqlalchemy import text

    base = args.base_url.rstrip("/")
    suffix = str(int(time.time()))[-5:]

    with SessionLocal() as db:
        family.initialize_schema(db)
        ensure_family_relation_audit_schema(db)
        admin_row = db.execute(text("select * from sys_user where del_flag='0' order by user_id asc limit 1")).first()
        if not admin_row:
            raise RuntimeError("No sys_user row found for admin token.")
        admin_user = auth.camelize_row(admin_row)
        redis = redis_client()
        if redis is None:
            raise RuntimeError("Redis is not configured; cannot create admin login token.")
        token = auth.create_token(redis, admin_user, ["*:*:*"])

        elder_phone = f"139{suffix}101"
        guardian_phone = f"139{suffix}102"
        elder = app_auth.user_by_phone(db, elder_phone) or app_auth.create_user(db, open_id=f"audit-elder-{suffix}", phone=elder_phone)
        guardian = app_auth.user_by_phone(db, guardian_phone) or app_auth.create_user(db, open_id=f"audit-guardian-{suffix}", phone=guardian_phone)
        relation_id = family.create_relation(
            db,
            elder_user_id=int(elder["id"]),
            elder_profile_id=None,
            guardian_user_id=int(guardian["id"]),
            display_name=f"审计测试{suffix}",
            relation_type="child",
            status=family.RELATION_STATUS["active"],
            source=3,
            remark="verify_admin_audit",
        )
        db.commit()
        print(f"[OK] created test relation={relation_id}")

    reason = f"后台验收暂停共享 {suffix}"
    request_json(base, "PUT", f"/admin/family/relation/{relation_id}/status", token, {"status": 2, "reason": reason})
    print("[OK] admin status endpoint accepted reason")

    with SessionLocal() as db:
        audit = db.execute(
            text(
                """
                select * from family_relation_audit
                where relation_id=:relation_id
                order by id desc limit 1
                """
            ),
            {"relation_id": relation_id},
        ).first()
        assert audit, "audit row should be written"
        data = dict(audit._mapping)
        assert int(data["new_status"]) == 2
        assert data["reason"] == reason
        assert int(data["operator_user_id"]) == int(admin_user["userId"])
        print("[OK] audit row records operator and reason")

    print("Family admin audit verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
