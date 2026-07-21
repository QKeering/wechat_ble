# RW v304 Addendum - SY03 Temperature Current-Key Probe

## Goal

Continue RW/SY03 validation one device protocol path at a time. This build keeps the v303 step fix and adds only one new device-side temperature path. Database cleanup is intentionally out of scope.

Build tag: `rw-visible-build-tag-20260718-304`

## Latest Log Source

- Backend: `admin_fastapi`
- Log page: `https://sh.qkeering.com/api/app/rw-debug/logs/page?limit=1000`
- API: `https://sh.qkeering.com/api/app/rw-debug/logs?limit=1000`

## Latest Log Findings Before This Change

- SY03 connection and notify are ready in the latest run.
- `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` is now parsed and uploaded. The latest good sample submitted `stepCount` as a small current-day value instead of the old false 9000+ value.
- `history-page-sync-result` and `history-page-upload-result` confirm backend upload for heart-rate and step records.
- `BLE_KEY_ACTIVITY` still returns empty ACK, so historical activity has no device records in this run.
- `BLE_KEY_SLEEP` / `0x0505` returns empty ACK. That means no current sleep records were available from the ring in this run. There was no page-only conversion loss for sleep.
- `BLE_KEY_TEMPERATURE` / `0x0508` repeatedly writes OK but does not return a parsed payload, so no temperature record is available for upload.
- `bloodSugar` and `bloodPressure` currently return empty ACKs or no submittable records.
- `stepCount`, `sleepState`, `durationMinutes`, `historyStartDate`, `records=0`, `summaryScheduled`, `data_sync_summary`, `health_raw.step_count`, `health_raw.sleep_state`, and local summary/raw data remain the key checks after sync.

## SDK Evidence

- The APP SDK exposes `BLE_KEY_ACTIVITY`, `BLE_KEY_SLEEP`, and `BLE_KEY_ACTIVITY_CURRENT_DAY`.
- For temperature, the SDK has both:
  - `BLE_KEY_APP_REAL_TIME_TEMPERATURE_DATA` / `0x0230`
  - historical `BLE_KEY_TEMPERATURE` / `0x0508`
- The latest device logs show `0x0508` is not returning data, so v304 probes the SDK current-temperature key first.

## Change In v304

- RW history temperature fallback now sends `temperature-current` with `BLE_KEY_APP_REAL_TIME_TEMPERATURE_DATA` / `0x0230` before `temperature-history` with `0x0508`.
- `vital` fallback also includes the same order, so home/Mine sync can collect temperature if the ring exposes only the current-temperature command.
- `RwKey.AppRealTimeTemperature` is accepted as an AB health history key and maps to the normal `temperature` record shape.
- Added parity coverage to prove `history/ab-key/temperature-current/read` is sent before `history/ab-key/temperature-history/read`.
- No backend API, database delete, or admin_fastapi storage behavior was changed.

## True-Device Test Plan

1. Install v304 and connect SY03.
2. Trigger one normal RW sync from the home or Mine entry.
3. Check backend logs for:
   - `history/ab-key/temperature-current/read`
   - a parsed response with key `560` / `0x0230`
   - `history-page-sync-result`
   - `history-page-upload-result`
4. Expected result if the device supports current temperature:
   - `rawMetricCounts.temperature` appears.
   - `submitMetricCounts.temperature` appears.
   - `health_raw.temperature` gets a current value.
5. If `0x0230` also times out or returns empty:
   - The next single protocol path is temperature monitoring/open command validation, especially `0x027d` monitoring read and `0x021b` temperature detecting/write.

## Still Open

- Temperature remains unverified until the v304 true-device log shows whether `0x0230` returns.
- Sleep should be tested after a real sleep window. Current logs only show empty ACK from `0x0505`.
- Business detail pages should read backend data after sync. Detail pages should not initiate BLE history sync.
