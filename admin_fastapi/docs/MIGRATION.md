# Java To FastAPI Migration

## Source Of Truth

Use only the latest code under:

```text
E:\qkeer\code\wechatAdmin
```

Java backend:

```text
admin
```

Admin frontend:

```text
admin_frontend\znzh-frontend-admin
```

## Frontend Compatibility

The admin frontend expects RuoYi-style response envelopes:

- normal success: `{"code": 200, "msg": "操作成功", "data": ...}`
- table data: `{"code": 200, "msg": "查询成功", "rows": [...], "total": 0}`
- business errors: HTTP 200 with non-200 business `code`

Keep existing API paths stable during migration.

## Module Order

1. System basics: login, captcha, users, roles, menus, dicts, config.
2. Device management and OTA.
3. App login, app user, app device binding.
4. Health data sync and reports.
5. Girl health.
6. Upload, export, monitor, jobs.
7. Pregnancy module can be merged later as a normal FastAPI module.

## Implemented

- `/admin/captchaImage`
- `/admin/login`
- `/admin/logout`
- `/admin/getInfo`
- `/admin/getRouters`
- system config and dict basics:
  - `/admin/system/config/configKey/{configKey}`
  - `/admin/system/config/refreshCache`
  - `/admin/system/dict/data/type/{dictType}`
  - `/admin/system/dict/type/optionselect`
  - `/admin/system/dict/type/refreshCache`
- system menu/dept/user/role essentials:
  - menu list, tree select, role-menu tree
  - dept list, exclude child list, dept tree
  - user detail/create/update/reset password/change status/auth role/profile
  - role create/update/status/data scope/options/auth-user allocation
  - post options
- generic RuoYi-style CRUD for config, dict, dept, menu, notice, post, role,
  user, device, device model, OTA, FAQ, app user, and logs.
- monitor basics:
  - oper log, login log, job, job log generic list/detail/delete
  - clean log endpoints
  - online/cache endpoints and Python process/server resource monitoring
- database backups:
  - list MySQL tables
  - selected-table and full-database `.sql` export
  - `.sql` restore using the local MySQL command-line tools
- AI lab:
  - admin application review list/detail and approve/reject flow
  - invite-code list, batch add, random generation, and delete
  - app application/status endpoints; valid invite codes approve immediately
- device helpers:
  - `/admin/device/model/options`
  - `/admin/device/ota/upload`
  - standards-compliant device QR PNG generation with legacy `/profile/qrcode/*`
    path compatibility
  - `.xlsx` device import template and transactional batch import; existing
    devices can be updated by MAC when `updateSupport` is enabled
  - `.xlsx` system-user import template and transactional batch import; existing
    users can be updated by username when `updateSupport` is enabled
- app basics:
  - local-compatible app login: phone login, wx login, phone code
  - app user profile, user goal, user card config
  - FAQ, app dict data, image upload
  - device model list, bind/unbind/bind info/device info/scan QR
  - OTA check and update callback
  - health/data endpoints backed by `health_raw`, `health_daily_summary`,
    and `sleep_record`; sync now recalculates daily summary for touched dates
  - girl health add/update/detail/temperature-stat endpoints with local
    `user_girl_health` table initialization
- upload/download/export compatibility:
  - `/common/upload`, `/admin/common/upload`
  - `/common/download`, `/admin/common/download`
  - generic CSV export/import-template compatibility for migrated admin tables
  - RuoYi no-`/admin` download paths such as `/system/config/export` are
    rewritten to `/admin/system/config/export`
- monitor/tool compatibility:
  - job change status/run records
  - online user list reads Redis login tokens
  - code generator table list/import/sync/delete and FastAPI CRUD scaffold preview/download

The implemented admin auth routes use MySQL users, BCrypt password verification,
Redis captcha storage, HS512 JWT tokens, and Redis login-token storage.
All `/admin/*` APIs and `/common/*` upload/download routes require a valid admin
JWT backed by an active Redis login token, except login, captcha, static files,
and public device QR images. App user APIs also reject JWTs whose Redis login
session has expired.

## Local App Login Note

The FastAPI local migration does not call WeChat or Tencent SMS yet. For local
联调, `openidCode` is treated as an open id, and phone verification codes are
stored in Redis under `qkeer:app_phone_code:{phone}`. The `/app/login/getPhoneCode`
response also includes `debugCode` for local testing.

## Remaining External Or Deferred Work

- Connect the production WeChat login API and Tencent SMS provider after their
  credentials and callback requirements are confirmed.
- Replace the local job-run record with an allow-listed Python scheduler after
  the production task targets are confirmed. Java Quartz invoke targets cannot
  be executed safely as arbitrary Python imports.
- Pregnancy remains intentionally deferred as an isolated small module.

## Secrets

The Java YAML currently contains database and third-party credentials. They are
not copied here. Put local values in `.env`.
