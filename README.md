# QKeer Admin Clean Workspace

This workspace contains the admin backend and its frontend in a clean source-only layout.

## Layout

- `admin_fastapi/`: FastAPI backend source.
- `admin_frontend/znzh-frontend-admin/`: admin frontend source.
- `smart-wearable-devices-next/`: WeChat mini-program source.

## Notes

- Runtime-only files were intentionally excluded: Python virtual environments, `node_modules`, build output, logs, uploads, cache folders, archives, backend private `.env`, WeChat DevTools private config, and RW debug export files.
- Use `admin_fastapi/.env.example` as the backend environment template.
- Git is initialized at this workspace root. Configure a local Git identity before committing:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```
