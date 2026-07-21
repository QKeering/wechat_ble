# RW v301 Addendum - SY03 Sleep History Delete Loop

## Goal

Continue the RW/SY03 true-device validation one protocol path at a time. This build keeps the v300 activity cleanup behavior, then focuses only on `BLE_KEY_SLEEP` / `0x0505` old-history cleanup so business pages can stop being blocked by stale JL sleep records.

Build tag: `rw-visible-build-tag-20260718-301`

## Latest Log Source

- Backend: `admin_fastapi`
- Log page: `https://sh.qkeering.com/api/app/rw-debug/logs/page?limit=1000`
- API: `https://sh.qkeering.com/api/app/rw-debug/logs?limit=1000`

## Latest Log Findings Before This Change

- SY03 connection and notify subscription are stable in the latest v300 logs.
- `BLE_KEY_ACTIVITY` / `0x0502` now follows the SDK-style loop and reached empty ACK, then sent delete ACK successfully. The old 2024 activity records stopped repeating.
- `stepCount` remains absent for current business data because the ring returned no valid current-day activity history after the stale records were deleted. `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` is still not trusted as business step data.
- `BLE_KEY_SLEEP` / `0x0505` returned payload records, but all sample records were old JL sleep segments around 2024-07-12. They were correctly filtered by `historyStartDate`, so upload showed raw sleep records but submitted only heart-rate records.
- The filtered sleep records carried `sleepState` and `durationMinutes`; the backend destination remains `health_raw.sleep_state`. This confirms the conversion path exists, but current-window data is still blocked by old ring history.
- Temperature `BLE_KEY_TEMPERATURE` / `0x0508` still timed out and is not changed in this build.
- Logs with `records=0`, `summaryScheduled`, `data_sync_summary`, and local summary/raw data remain the key checks when a page has no business records after sync.

## Change In v301

- Added SDK-style `GET_DEL_GET_DEL` behavior for `BLE_KEY_SLEEP` / `0x0505`.
- Sleep history now sends `history/ab-key/sleep-history/sdk-read`.
- After every sleep payload response, it immediately sends `history/ab-key/sleep-history/sdk-delete` with `deleteReason: payload`, then reads again.
- When sleep reaches an empty ACK, it sends one final delete with `deleteReason: empty`.
- Activity remains v300 `GET_GET_DEL`; this preserves the verified `BLE_KEY_ACTIVITY` behavior.
- No parser mapping change was made for heart-rate, HRV, SpO2, stress, temperature, step, or sleep fields.

## True-Device Test Plan

1. Install v301 and connect SY03.
2. Open the home page once and wait for one history sync.
3. In the backend log page, check for:
   - `history/ab-key/sleep-history/sdk-read`
   - `history-ab-key-sdk-read-response` with key `1285` / `0x0505`
   - `history/ab-key/sleep-history/sdk-delete`
   - `history-ab-key-sdk-delete-response` with `deleteReason: payload` or `deleteReason: empty`
4. Run sync a second time after delete ACKs.
5. Expected result:
   - Old 2024 sleep records should stop repeating.
   - If the ring has valid current-window sleep, backend `health_raw.sleep_state` should begin receiving records with `sleepState` and `durationMinutes`.
   - If the second sync only shows empty ACK, the old data cleanup worked and the ring currently has no sleep history available for the selected date.

## Still Open

- `BLE_KEY_TEMPERATURE` / `0x0508` remains the next bottom-layer command to test because current logs show timeout.
- Current-day step total still needs a verified source. Do not use `BLE_KEY_ACTIVITY_CURRENT_DAY` as `health_raw.step_count` until its payload is proven to match true daily steps.
- Business page visibility should be debugged from backend records first. The page should read backend data after sync; the mini-program should not block detail pages on fresh BLE reads.
