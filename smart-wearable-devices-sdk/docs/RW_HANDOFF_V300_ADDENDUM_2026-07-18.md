# RW v300 Addendum - SY03 Activity History Delete Loop

## Goal

Continue the RW/SY03 true-device validation one protocol path at a time. This build focuses on the activity/step history path only, while preserving the working battery, firmware/software, BLE connection, and foreground metric parsing behavior.

Build tag: `rw-visible-build-tag-20260718-300`

## Latest Log Source

- Backend: `admin_fastapi`
- Log page: `https://sh.qkeering.com/api/app/rw-debug/logs/page?limit=1000`
- API: `https://sh.qkeering.com/api/app/rw-debug/logs?limit=1000`

## Confirmed Before This Change

- BLE connection reaches notify-ready on SY03.
- Battery and firmware/software reads work with the APP-SDK-style AB CRC commands.
- Time setting key `BLE_KEY_TIME` / `0x0201` returns ACK success.
- Activity history key `BLE_KEY_ACTIVITY` / `0x0502` returns parseable JL2 records.
- `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` has returned non-business payloads and empty ACKs; it must not be trusted as today's total step count yet.

## Problem Found In v299 Logs

The device kept returning old JL activity records dated 2024-07-12. The page upload layer correctly filtered them as outside the requested 2026-07-18 business window, so the backend received no step records.

The v299 logs did not show a `Delete(0x30)` command or delete ACK after the activity history reads. The Android APP SDK does not use the mini-program's old `read -> read-continue` flow for this path; it uses the JL state machine:

- `GET_GET_DEL` for activity/vital/current-day history.
- Repeated `Read(0x10)` while payload length is greater than the empty ACK shape.
- Send `Delete(0x30)` only after an empty ACK indicates the read loop reached the end.

The page diagnostics also show `historyStartDate` and raw-vs-submit counts, which are the first place to check when `stepCount` exists in raw records but does not reach `health_raw`. In the latest v299 log the filtered old activity records had `submitRecordCount=0`; the vital fallback ended with `records=0`.

For sleep, `sleepState` and `durationMinutes` are the key frontend/backend fields. Backend storage is still `health_raw.sleep_state`, so a future sleep fix must preserve both L19-compatible names and RW source fields.

The backend summary path should remain aligned with `summaryScheduled`, `data_sync_summary`, and local summary/raw data diagnostics. If old JL records are deleted successfully but the page is still empty, check whether the backend summary task was scheduled and whether local summary/raw data exists before changing the parser again.

## Change In v300

- Added an SDK-style delete loop for `BLE_KEY_ACTIVITY` / `0x0502` only.
- The mini-program now sends repeated `history/ab-key/activity-history/sdk-read` commands until an empty ACK is received, capped at 8 reads.
- After the empty ACK, it sends `history/ab-key/activity-history/sdk-delete`.
- Logs added:
  - `history-ab-key-sdk-loop-start`
  - `history-ab-key-sdk-read-response`
  - `history-ab-key-sdk-delete-response`
  - `history-ab-key-sdk-delete-timeout`
  - `history-ab-key-sdk-delete-skipped`

## True-Device Test Plan

1. Install the v300 package and connect SY03.
2. Open the home page once and wait for history sync.
3. In the backend log page, verify activity history logs include:
   - `sdk-read`
   - an empty ACK for key `0x0502`
   - `sdk-delete`
   - preferably `history-ab-key-sdk-delete-response`
4. Run sync again after the delete ACK.
5. Expected result:
   - The old 2024-07-12 records should stop repeating.
   - If the ring has real current-day activity, backend `health_raw.step_count` should begin receiving records in the current date range.

## Still Open

- `BLE_KEY_SLEEP` / `0x0505` likely needs the SDK `GET_DEL_GET_DEL` flow after activity delete is verified.
- `BLE_KEY_TEMPERATURE` / `0x0508` still times out in the latest logs; test this separately after activity/sleep are settled.
- HRV/stress/SpO2/heart-rate backend visibility now depends on whether the ring has generated history records; empty ACKs are not a page-display bug.
