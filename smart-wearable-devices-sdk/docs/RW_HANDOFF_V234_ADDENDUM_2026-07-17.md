# RW v234-v240 Addendum - 2026-07-17

## Final Goal

Make RW devices, especially SY03, behave like the finished L19 path: connect reliably, sync data on the home page, upload normalized history to the backend, and let business/detail pages render from backend APIs instead of waiting on direct BLE reads.

## What Changed In v234-v240

- Current build tag: `rw-visible-build-tag-20260718-262`.
- v234 changed home page RW business sync from three serial BLE reads to one combined read.
- Previous behavior:
  - `sleepData` sync first.
  - `activity` sync second.
  - `heartRate/bloodOxygen/temperature/hrv/stress/bloodSugar` sync third.
  - Real-device logs often captured sleep and activity only; vital/stress had not completed yet.
- New behavior:
  - `awareness` calls `syncBusinessHistoryPage` once with the combined data types.
  - After the combined BLE sync/upload, the home page refreshes sleep, activity, stress, and vital backend data.
  - If the BLE sync fails, backend refresh still runs so existing server data can render.
- The home diagnostic result now includes:
  - `combined: true`
  - `combinedDataTypes`
  - `syncStatus`
  - `syncRecordCount`
  - per-card `recordCount` and `combinedRecordCount`
- v235 keeps the v234 combined sync and adds pressure/stress display-chain fixes for valid `stress=0` records.
- v236 adds exact sleep segment upload fields. RW sleep records now submit `startTime` and `endTime` in addition to `recordTime`, `sleepState`, and `sleepDuration`, so the backend can store cross-night sleep segments without guessing from a single timestamp.
- v237 tightened the frontend/backend sleep submit contract and fixed two visible mojibake fallbacks on the home page.
- v238 focuses on the latest real-device log:
  - Mine diagnostic copy no longer includes large raw successful `history-page-sync-result/upload-result` payloads; the compact `diagnostic-history-report` now carries the useful per-page sync/upload/query summary, missing data types, ack-only data types, and a tiny record sample.
  - Home pressure/stress now triggers a forced `stress-missing` business sync when backend stress is empty, so it is not blocked by the normal 5-minute date-click cooldown.
  - Backend verification now asserts explicit sleep `startTime/endTime/dateRef` survives pure sleep sync into `sleep_record`.
  - The RW/L19 audit now protects the vital-sign detail custom-date route so `selectedDayIndex=3&selectedDate=...` queries the selected backend date before the today fallback.
  - v238 package size was: main package 1,299,982 bytes, headroom 797,170 bytes, total artifact 1,598,172 bytes.
- v239 keeps the same protocol/data path and optimizes detail rendering:
  - `vitalSigns` detail now requests the backend vital summary, heart-rate detail, blood-oxygen detail, body-temperature detail, and HRV detail in one `Promise.all` batch.
  - The same click/calendar/pull-down action no longer starts a background vital query batch and immediately waits on a second identical batch.
  - This reduces the "detail page waits around 20 seconds" symptom without moving data sync back into inner pages.
  - v239 package size: main package 1,299,982 bytes, headroom 797,170 bytes, total artifact 1,598,135 bytes.
- v240 narrows the latest real-device diagnosis:
  - Mine diagnostic timestamps now use local phone time instead of UTC slices, so copied logs line up with screenshots and DB time.
  - `diagnostic-history-report` now includes `metricPath` for `heartRate/bloodOxygen/hrv/stress/temperature`, with `raw`, `submit`, and `status`.
  - HRV triage rule: `raw=0` means the device/parser did not produce HRV history; `raw>0 submit=0` means upload normalization filtered it; `submit>0` with an empty detail page points to backend insert/query/display.
  - Mine menu icons render through native `<image>` instead of `uv-image`, to avoid the missing icon symptom seen on real device.
  - Backend health raw sync now drops impossible record times before insert and excludes future/dirty values from summaries/details. This covers rows like `2083-03-29` and same-day future rows such as `23:06` when the phone/server is around `20:00`.

## Latest Log Before This Change

Attachment analyzed:

`C:\Users\Administrator\.codex\attachments\0b6b86da-8d75-492a-8dac-94bda98fa1c6\pasted-text.txt`

This log was still v233, so it should not be used to judge v234-v239.

Key evidence from the v233 log:

- Connection was ready.
- Snapshot had `connected=true`, `ready=true`, `storeConnected=true`, `notifyEnabled=true`, and the expected RW service/characteristics: `A00A/B002/B003`.
- Sleep uploaded 23 records.
- Activity uploaded 1 record.
- Vital sync only showed `history-page-sync-start`; no result was captured before the log was copied.
- Stress query returned a backend value hint of `stress:0`, but the same log also had `stress-sync-delegated-to-business` with `hasBackendStress:false` followed by `business-sync-dedupe`; v238's `stress-missing` force path was added for this exact case.
- The raw file already contained literal `<truncated>` markers, so the missing vital/stress terminal events were lost before analysis, not during local reading.
- This supports the diagnosis that serial/large diagnostics caused long waits and truncated diagnostics.
- It also showed the need to make sleep uploads more explicit: if the backend only receives a single `recordTime` plus duration, cross-night segments can land on the wrong business date. v236 now submits segment `startTime`/`endTime` directly.

## Next Real-Device Test

Use a package that shows `rw-visible-build-tag-20260718-262`.

Expected checks:

1. Open home/awareness page after RW connection.
2. Wait about 20-30 seconds once.
3. Open Mine diagnostics and copy logs.
4. Confirm `business-sync-background-start/result` show `combined: true`.
5. Confirm a single awareness `history-page-sync-start` includes sleep, activity, and vital data types together.
6. Confirm backend detail pages no longer trigger long direct BLE waits before rendering.

If detail pages still miss pressure, blood oxygen, HRV, temperature, or stress:

- First check whether the combined sync uploaded records for those data types.
- In `diagnostic-history-report.metricPath`, use `hrv.raw/hrv.submit/hrv.status` to decide whether HRV is missing in the device/parser layer, filtered during upload, or lost after backend upload.
- If uploaded but page is empty, investigate backend aggregation/date mapping/page field consumption.
- If not uploaded, investigate RW AB history command responses and LastData fallback for the missing types.

## Pressure Follow-Up

After the latest log review, pressure/stress was traced to display-chain mismatches rather than BLE transport:

- Mini-program upload and RW parser both treat `stress` in the range `0..100` as valid.
- The backend `/data/stress/*` query previously filtered `stress > 0`, so valid `stress=0` records were uploaded but invisible on pressure detail/proportion/summary pages.
- `admin_fastapi/app/api/app.py` now reads pressure rows with `stress >= 0 and stress <= 100`.
- The backend algorithm hourly stress aggregation now accepts `0..100` as well.
- `admin_fastapi/app/services/health.py` now calculates daily stress average/min/max with valid `0..100` values, and uses the same pressure buckets as the detail page: `0-29`, `30-49`, `50-69`, `70-100`.
- `admin_fastapi/scripts/verify_rw_health_sync.py` now includes a `stress=0` regression case and verifies it appears in pressure chart/counts.
- `src/pages/awareness/awareness.vue` now uses a pressure-specific `0..100` reader instead of the generic positive-number reader, so home pressure can distinguish valid `0` from truly missing data.

Validation already passed:

```powershell
& E:\qkeer\code\wechatAdmin\admin_fastapi\.venv\Scripts\python.exe E:\qkeer\code\wechatAdmin\admin_fastapi\scripts\verify_rw_health_sync.py
& E:\qkeer\code\wechatAdmin\admin_fastapi\.venv\Scripts\python.exe -m compileall E:\qkeer\code\wechatAdmin\admin_fastapi\app\api\app.py E:\qkeer\code\wechatAdmin\admin_fastapi\scripts\verify_rw_health_sync.py
npm.cmd run verify:rw-backend-health
```

## Validation Commands

Run from `E:\qkeer\code\wechatProgram\smart-wearable-devices-next`:

```powershell
npm.cmd run type-check
npm.cmd run verify:ring-ble
npm.cmd run verify:rw-backend-health
npm.cmd run audit:rw-l19 -- --skip-dist
npm.cmd run build:mp-weixin
npm.cmd run verify:mp-weixin-artifact
npm.cmd run check:mp-weixin-size
npm.cmd run audit:rw-l19
```

