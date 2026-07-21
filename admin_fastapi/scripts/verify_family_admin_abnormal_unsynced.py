from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
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
    parser = argparse.ArgumentParser(description="Verify admin family abnormal list includes long-unsynced devices.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    from app.db.redis import redis_client
    from app.db.session import SessionLocal
    from app.services import app_auth, auth, family
    from sqlalchemy import text

    suffix = str(int(time.time()))[-5:]
    base = args.base_url.rstrip("/")

    with SessionLocal() as db:
        family.initialize_schema(db)
        admin_row = db.execute(text("select * from sys_user where del_flag='0' order by user_id asc limit 1")).first()
        if not admin_row:
            raise RuntimeError("No sys_user row found for admin token.")
        redis = redis_client()
        if redis is None:
            raise RuntimeError("Redis is not configured; cannot create admin login token.")
        admin_user = auth.camelize_row(admin_row)
        token = auth.create_token(redis, admin_user, ["*:*:*"])

        guardian = app_auth.user_by_phone(db, f"139{suffix}201") or app_auth.create_user(db, open_id=f"abnormal-guardian-{suffix}", phone=f"139{suffix}201")
        member = family.create_member(db, guardian, {"name": f"未同步老人{suffix}", "relation": "father"})
        member_id = int(member["id"])
        device_mac = f"VERIFY-UNSYNCED-{suffix}"
        family.bind_device(db, guardian, {"memberId": member_id, "mac": device_mac, "deviceName": "未同步验证设备"})
        db.execute(
            text("delete from device where mac=:mac"),
            {"mac": device_mac},
        )
        db.commit()
        print(f"[OK] created unsynced member={member_id} mac={device_mac}")

    query = urllib.parse.urlencode({"keyword": device_mac, "pageNum": 1, "pageSize": 10})
    result = request_json(base, "GET", f"/admin/family/abnormal/list?{query}", token)
    rows = result.get("rows") or []
    matched = next((item for item in rows if item.get("sourceType") == "family_unsynced_device" and device_mac in str(item.get("content") or "")), None)
    assert matched, "abnormal list should include long-unsynced family device"
    print("[OK] abnormal list includes long-unsynced family device")

    print("Family admin unsynced abnormal verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
