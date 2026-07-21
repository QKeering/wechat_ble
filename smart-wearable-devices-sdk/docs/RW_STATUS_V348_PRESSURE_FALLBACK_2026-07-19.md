# RW status v348 - pressure fallback

Date: 2026-07-19

## Final target

Package L19 and RW device protocols as SDK-like modules, keep the mini-program main package publishable, and make RW/SY03 business pages use the same stable data path as L19:

1. BLE protocol reads the device data.
2. Frontend normalizes RW records into the existing compatible upload fields.
3. Backend stores raw values in existing health tables.
4. Business pages read backend APIs directly, not by waiting on inner pages to sync from BLE.

## Pressure decision

RW/SY03 does not need to fabricate `health_raw.stress` on upload when the ring only reports HRV.

The backend now follows the L19-style business approach:

- Store HRV as HRV.
- Prefer raw stress when the device reports it.
- When raw stress is missing, derive a conservative pressure value from HRV.
- Feed the derived hourly pressure records into the existing `/physicalHealth/stressRatio` algorithm endpoint.
- If the external algorithm times out or returns empty, keep the local derived values as fallback.

Changed backend files:

- `E:\qkeer\code\wechatAdmin\admin_fastapi\app\services\health.py`
- `E:\qkeer\code\wechatAdmin\admin_fastapi\app\api\app.py`
- `E:\qkeer\code\wechatAdmin\admin_fastapi\scripts\verify_rw_health_sync.py`

Verification passed:

```powershell
cd E:\qkeer\code\wechatAdmin\admin_fastapi
.\.venv\Scripts\python.exe -m py_compile app\api\app.py app\services\health.py
.\.venv\Scripts\python.exe scripts\verify_rw_health_sync.py
```

## Current known-good paths

- Connection: current conclusion is that prior failures were mostly device sleep state, not the BLE base channel.
- Battery: protocol path has been proven, but immediate post-connect display still needs one real-device pass.
- Heart rate: bottom path and detail page have been verified by user feedback.
- SpO2: bottom path and detail page have been verified by user feedback.
- HRV: database receives HRV values.
- Temperature: single command path is OK after firmware update and `01` path test; history/detail still need real-device confirmation.
- Steps: current-day activity path can return step increments and upload to backend; freshness and display aggregation still need focused checks.

## Remaining work

1. Sleep
   - Needs next morning real-device data.
   - Verify BLE payload, DB `sleep_record`/`health_raw.sleep_state`, backend detail API, then frontend sleep pages.

2. Temperature history
   - Single temperature test is OK.
   - Still need to verify history records upload into `health_raw.temperature` and appear on detail pages.

3. Activity freshness and score
   - Step values can upload, but homepage refresh can still show an old accumulated value.
   - Activity score is backend business calculation, not a protocol value. If data exists but score is 0/empty, inspect backend daily summary and score API.

4. Pressure UI/API
   - Backend now derives pressure from HRV and calls the stress algorithm.
   - Needs deployment and real-device page verification.

5. Device information page
   - Business page should be restored to the original UI, with diagnostics kept on Mine page only.
   - Needs one visual pass after data paths are closed.

6. Battery immediate display
   - After connect, battery should refresh without waiting for manual entry into device info.
   - Needs a real-device package check.

7. Final UI cleanup
   - Remove or hide temporary protocol probes.
   - Clean Mine diagnostic layout.
   - Recheck menu icons, arrows, tab icons, and business page spacing.

## Notes for the next handoff

- Do not re-open already working commands in bulk diagnostics unless a regression appears.
- Keep frontend upload fields compatible with L19 where possible.
- Do not use legacy/QKeer V2 fallback for SY03/RW command verification.
- When debugging one channel, run one command path at a time and inspect server-side RW logs to avoid vConsole truncation.
