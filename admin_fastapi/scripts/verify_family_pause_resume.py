from __future__ import annotations

import argparse
import time
import urllib.parse

from verify_family_health_sharing import create_auto_token, get_data, request_json


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify family sharing pause and resume flow.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--guardian-phone", default="13900006671")
    parser.add_argument("--elder-phone", default="13900006672")
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
                "name": f"暂停恢复老人{suffix}",
                "relation": "mother",
                "phone": elder_phone,
                "height": 165,
            },
        )
    )
    relation_id = int(created["relationId"])
    member_id = int(created["memberId"])
    print(f"[OK] created relation={relation_id} member={member_id}")

    invite = get_data(
        request_json(
            base,
            "POST",
            "/app/family/invite",
            guardian_token,
            {
                "inviteType": 2,
                "targetPhone": elder_phone,
                "relationId": relation_id,
                "elderProfileId": created["elderProfileId"],
            },
        )
    )
    elder_token = create_auto_token(elder_phone)
    get_data(request_json(base, "POST", f"/app/family/invite/{invite['inviteCode']}/accept", elder_token))
    get_data(request_json(base, "POST", f"/app/family/elder-profile/{created['elderProfileId']}/claim", elder_token))
    print("[OK] elder accepted invite and claimed profile")

    dashboard_path = f"/app/family/health/dashboard?{urllib.parse.urlencode({'memberId': member_id})}"
    health_index_path = f"/app/family/health/index?{urllib.parse.urlencode({'memberId': member_id})}"
    get_data(request_json(base, "GET", dashboard_path, guardian_token))
    get_data(request_json(base, "GET", health_index_path, guardian_token))
    print("[OK] guardian can read dashboard before pause")

    guardian_relation_denied = False
    try:
        request_json(
            base,
            "PUT",
            f"/app/family/relations/{relation_id}",
            guardian_token,
            {
                "permissionScope": {
                    "vitalSigns": False,
                    "sleep": True,
                    "motion": True,
                    "alerts": True,
                    "aiSummary": True,
                    "deviceStatus": True,
                }
            },
        )
    except RuntimeError as exc:
        guardian_relation_denied = "business error" in str(exc) or "只有老人本人" in str(exc)
        print(f"[OK] guardian relation permission update denied after claim: {exc}")
    assert guardian_relation_denied

    guardian_member_denied = False
    try:
        request_json(
            base,
            "POST",
            "/app/family/share/updatePermissions",
            guardian_token,
            {
                "memberId": member_id,
                "permissions": {
                    "vitalSigns": False,
                    "sleep": True,
                    "motion": True,
                    "alerts": True,
                    "aiSummary": True,
                    "deviceStatus": True,
                },
            },
        )
    except RuntimeError as exc:
        guardian_member_denied = "business error" in str(exc) or "只有老人本人" in str(exc)
        print(f"[OK] guardian legacy permission update denied after claim: {exc}")
    assert guardian_member_denied

    paused = get_data(request_json(base, "PUT", f"/app/family/relations/{relation_id}", elder_token, {"status": "paused"}))
    assert int(paused["status"]) == 2
    print("[OK] elder paused sharing")

    blocked = False
    try:
        request_json(base, "GET", dashboard_path, guardian_token)
    except RuntimeError as exc:
        blocked = "已暂停" in str(exc) or "已暂停或取消" in str(exc) or "business error" in str(exc)
        print(f"[OK] dashboard denied after pause: {exc}")
    assert blocked

    health_index_blocked = False
    try:
        request_json(base, "GET", health_index_path, guardian_token)
    except RuntimeError as exc:
        health_index_blocked = "已暂停" in str(exc) or "已暂停或取消" in str(exc) or "business error" in str(exc)
        print(f"[OK] health/index denied after pause: {exc}")
    assert health_index_blocked

    legacy_bind_blocked = False
    try:
        request_json(
            base,
            "POST",
            "/app/family/device/bind",
            guardian_token,
            {"memberId": member_id, "mac": f"VERIFY-PAUSED-LEGACY-{suffix}", "deviceName": "暂停后旧接口绑定"},
        )
    except RuntimeError as exc:
        legacy_bind_blocked = "不能绑定设备" in str(exc) or "已暂停或取消" in str(exc) or "business error" in str(exc)
        print(f"[OK] legacy device bind denied after pause: {exc}")
    assert legacy_bind_blocked

    relation_bind_blocked = False
    try:
        request_json(
            base,
            "POST",
            f"/app/family/elders/{relation_id}/devices/bind",
            guardian_token,
            {"mac": f"VERIFY-PAUSED-REL-{suffix}", "deviceName": "暂停后新接口绑定"},
        )
    except RuntimeError as exc:
        relation_bind_blocked = "不能绑定设备" in str(exc) or "已暂停或取消" in str(exc) or "business error" in str(exc)
        print(f"[OK] relation device bind denied after pause: {exc}")
    assert relation_bind_blocked

    guardians = get_data(request_json(base, "GET", "/app/family/guardians", elder_token))
    relation = next((item for item in guardians if int(item.get("relationId") or 0) == relation_id), None)
    assert relation and (relation.get("status") == "paused" or int(relation.get("relationStatus") or 0) == 2)
    print("[OK] elder can still see paused relation in sharing management")

    resumed = get_data(request_json(base, "PUT", f"/app/family/relations/{relation_id}", elder_token, {"status": "active"}))
    assert int(resumed["status"]) == 1
    get_data(request_json(base, "GET", dashboard_path, guardian_token))
    print("[OK] elder resumed sharing and guardian can read again")

    permissions = {
        "vitalSigns": False,
        "sleep": True,
        "motion": True,
        "alerts": True,
        "aiSummary": True,
        "deviceStatus": True,
    }
    updated = get_data(request_json(base, "PUT", f"/app/family/relations/{relation_id}", elder_token, {"permissionScope": permissions}))
    assert updated.get("permissionScope") or updated.get("permission_scope") or updated.get("permissions") is not None
    print("[OK] elder updated guardian permission scope")

    vital_path = f"/app/family/data/vitalSign?{urllib.parse.urlencode({'memberId': member_id})}"
    vital_blocked = False
    try:
        request_json(base, "GET", vital_path, guardian_token)
    except RuntimeError as exc:
        vital_blocked = "未开启该数据共享权限" in str(exc) or "business error" in str(exc)
        print(f"[OK] vitalSign denied after elder disabled permission: {exc}")
    assert vital_blocked

    filtered_dashboard = get_data(request_json(base, "GET", dashboard_path, guardian_token))
    filtered_summary = filtered_dashboard.get("summary") or {}
    assert "heartRateAvg" not in filtered_summary and "spo2Avg" not in filtered_summary
    print("[OK] dashboard hides vital-sign fields after elder disabled permission")

    health_index_after_permission = get_data(request_json(base, "GET", health_index_path, guardian_token))
    assert "sleep" in health_index_after_permission and "activity" in health_index_after_permission
    assert "vitalSigns" not in health_index_after_permission and "summary" not in health_index_after_permission
    print("[OK] health/index remains filtered through shared permission model")

    print("Family pause/resume and elder permission verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
