# RW v303 Addendum - SY03 Current-Day Step Packet

## Goal

Continue the RW/SY03 true-device validation one protocol path at a time. This build keeps v302 sleep device cleanup and only adds a conservative parser for the latest `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` current-day step packet. Database cleanup is intentionally out of scope.

Build tag: `rw-visible-build-tag-20260718-303`

## Latest Log Source

- Backend: `admin_fastapi`
- Log page: `https://sh.qkeering.com/api/app/rw-debug/logs/page?limit=1000`
- API: `https://sh.qkeering.com/api/app/rw-debug/logs?limit=1000`

## Latest Log Findings Before This Change

- SY03 connection is stable and notify is ready.
- v302 sleep cleanup worked: `BLE_KEY_SLEEP` / `0x0505` sent repeated `sdk-read` and `sdk-delete`, including the single 7-byte sleep point, then reached empty ACK.
- The same run still uploaded no current sleep because the 46 sleep records were old JL records around 2024-07-11/2024-07-12 and were filtered by `historyStartDate`.
- `BLE_KEY_ACTIVITY` / `0x0502` returned empty ACK after delete, so activity history itself has no current records.
- `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` returned a non-empty 16-byte-block packet, but the old parser did not recognize this variant. The packet includes a safe current-hour step value of 53 in the latest log.
- The earlier 9000+ step issue came from treating ambiguous bytes as a total. This build does not restore that unsafe path.
- `BLE_KEY_TEMPERATURE` / `0x0508` still times out. `bloodSugar` / `0x0510` and `bloodPressure` / `0x0504` currently return empty ACKs.
- `stepCount`, `sleepState`, `durationMinutes`, `historyStartDate`, `records=0`, `summaryScheduled`, `data_sync_summary`, `health_raw.step_count`, `health_raw.sleep_state`, and local summary/raw data remain the key checks after sync.

## Change In v303

- Added `ab_activity_current_day_relative_hour` parsing for the new SY03 `0x051a` 16-byte-block current-day format.
- The parser only accepts this format when the blocks form a consecutive hourly sequence, so random leading bytes still stay as ACK/no data.
- The first summary-like block is not submitted as total steps.
- The non-zero hourly block is converted to a step record using the current local date/hour and submitted as `stepCount`.
- Added a real-log parser parity sample that expects the latest `0x051a` packet to decode as 53 steps.
- No database delete, backend migration, or API behavior was changed.

## True-Device Test Plan

1. Install v303 and connect SY03.
2. Trigger one normal RW sync from the home or Mine entry.
3. Check backend logs for:
   - `history/ab-key/activity-current-day/read`
   - `rx-parsed` with key `1306` / `0x051a`
   - `history-page-sync-result`
   - `history-page-upload-result`
4. Expected result:
   - `rawMetricCounts.stepCount` should appear when the device returns the new `0x051a` packet.
   - `submitMetricCounts.stepCount` should appear with a small value matching the current-hour packet, not the previous bogus 9000+ value.
   - If the ring returns empty ACK for `0x051a`, then there is no current step payload to submit.

## Still Open

- `BLE_KEY_TEMPERATURE` / `0x0508` remains the next bottom-layer command to test.
- Sleep should be tested again after v302 cleanup. If the next sync still shows 2024 sleep records, the next device-side check is whether sleep deletion needs `ReadContinue` / `0x11` inside the delete loop.
- Current sleep will only appear after the ring has valid current-window sleep data; old filtered sleep records should not be database-deleted by the mini-program.
- Business detail pages should read backend data after sync; detail pages should not initiate BLE history sync.
