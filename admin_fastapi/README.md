# QKeer Admin FastAPI

Python/FastAPI backend that replaces the Java backend in `../admin`.

This project is intentionally placed inside the latest repository:

```text
E:\qkeer\code\wechatAdmin
```

## Goals

- Keep the existing frontend API paths compatible.
- Keep the existing MySQL schema compatible.
- Reimplement Java controller/service logic in Python module by module.
- Use `.env` for secrets. Do not copy production keys from Java YAML files.

## Run

```powershell
cd E:\qkeer\code\wechatAdmin\admin_fastapi
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8128
```

Useful endpoints:

```text
http://127.0.0.1:8128/docs
http://127.0.0.1:8128/_migration/status
```

RW/L19 health-sync compatibility check:

```powershell
.venv\Scripts\python.exe scripts\verify_rw_health_sync.py
```

On startup the backend performs an idempotent schema check for RW blood sugar and blood pressure fields in `health_raw` and `health_daily_summary`. Back up MySQL before the first deployment, then verify the new columns after restart.

Health-page text localization check:

```powershell
.venv\Scripts\python.exe scripts\check_health_text_response.py --sample-only

# After deploying/restarting the backend, pass a mini-app user token to scan real app endpoints:
$env:QKEER_APP_TOKEN="your-mini-app-token"
.venv\Scripts\python.exe scripts\check_health_text_response.py --base-url http://127.0.0.1:8128
```

The deployed check scans key `/app/health/*` and `/app/data/*` health endpoints for known English level text and mojibake display strings. The localization fallback covers common health labels such as lifestyle, sleep activation/preparation/recovery/rhythm, sleep quality, sleep duration, risk, vital signs, and level/status/trend values.

## Migration Policy

The generic CRUD routes are only a bridge for simple admin list/detail/create/update/delete pages. Any endpoint that has real Java service logic, health calculations, token creation, WeChat login, SMS, upload, export, or scheduled jobs should get a dedicated Python service before being marked migrated.
