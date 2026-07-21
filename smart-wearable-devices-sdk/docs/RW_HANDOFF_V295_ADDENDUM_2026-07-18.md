# RW v295 handoff addendum

Build tag: `rw-visible-build-tag-20260718-295`

## Change

- Added a backend RW diagnostic log loop in `admin_fastapi`.
- Frontend RW diagnostic logs are now queued and uploaded to `/app/rw-debug/logs`.
- Backend stores logs in `rw_diagnostic_logs`.
- Public debug page: `/rw-debug/logs`.
- Clearing logs from the Mine page now clears local logs, pending upload queue, and the backend debug table.

## Purpose

- Avoid vConsole and clipboard truncation during SY03 real-device testing.
- Keep the existing business pages focused on behavior while the backend page keeps full BLE/FLOW/PAGE/HISTORY/MINE diagnostics.

## Next validation

- Deploy backend first so the new public endpoints exist.
- Build/import the v295 mini program.
- Open Mine, clear logs once, then run one focused SY03 path.
- Inspect `/rw-debug/logs?limit=1000` instead of relying on copied text.
