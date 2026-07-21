# RW v302 Addendum - SY03 Device Sleep Payload Cleanup

## Goal

Continue the RW/SY03 true-device validation one protocol path at a time. This build only changes the device-side RW history parser and sleep cleanup loop. Database cleanup is intentionally out of scope and remains manual.

Build tag: `rw-visible-build-tag-20260718-302`

## Latest Log Source

- Backend: `admin_fastapi`
- Log page: `https://sh.qkeering.com/api/app/rw-debug/logs/page?limit=1000`
- API: `https://sh.qkeering.com/api/app/rw-debug/logs?limit=1000`

## Latest Log Findings Before This Change

- SY03 connection and notify subscription are stable in the latest v301 logs.
- `BLE_KEY_ACTIVITY` / `0x0502` old-history cleanup stayed valid. After SDK-style reads and deletes, the ring returned empty activity ACK, so stale 2024 activity no longer repeats from the device in that path.
- `BLE_KEY_SLEEP` / `0x0505` delete commands are accepted by the device. The log shows `sdk-delete` followed by delete ACK `ab1100034513050530`.
- The sleep loop still stopped too early because one non-empty sleep response, for example `ab11000a5c4e0505102e227f6c220000`, had payload bytes but no parsed records. It was classified as `rw_health_data_ack` with status `pending`.
- That misclassification made the history loop treat the response as no payload, so old JL sleep fragments around 2024-07-12 could remain on the ring.
- `history-page-sync-result` showed raw sleep records but `submitRecordCount: 0` because `historyStartDate` filtered the old records out. This confirms the backend/page conversion path is present, but the current test is still blocked by device-side stale history.
- `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` is still not trusted as `health_raw.step_count`; the 9000+ value seen in test did not match true daily steps.
- `BLE_KEY_TEMPERATURE` / `0x0508` still has no proven device response.
- `health_raw.sleep_state`, `stepCount`, `sleepState`, `durationMinutes`, `records=0`, `summaryScheduled`, `data_sync_summary`, and local summary/raw data remain the key checks after sync.

## Change In v302

- Parser now treats RW health-history responses with more than one raw payload byte as `rw_health_data`, even if the current decoder cannot yet turn that payload into records.
- One-byte health-history responses remain status-only ACKs.
- `hasRwAbHealthHistoryPayload` now counts non-empty raw health-history payload bytes, so the history loop distinguishes true empty ACK from undecoded payload.
- Sleep cleanup `BLE_KEY_SLEEP` / `0x0505` now keeps using SDK-style `GET_DEL_GET_DEL`, but the max read/delete loop was raised from 8 to 32 to clear multi-fragment old device records without database changes.
- No backend database delete, migration, or API behavior was changed.

## True-Device Test Plan

1. Install v302 and connect SY03.
2. From the home or Mine entry, trigger one normal RW sync.
3. Check the backend log page for:
   - `history/ab-key/sleep-history/sdk-read`
   - `history/ab-key/sleep-history/sdk-delete`
   - sleep read responses with key `1285` / `0x0505`
   - `history-page-sync-result`
4. Expected result:
   - Non-empty sleep packets should no longer stop the delete loop.
   - The ring should continue read/delete until a true empty sleep ACK is reached or the 32-read guard is hit.
   - Old 2024 sleep records should stop repeating after the device queue is drained.
   - If current sleep exists on the ring, backend `health_raw.sleep_state` should receive current-window records. If no current sleep exists, the expected outcome is empty ACK with no submitted sleep records.

## Still Open

- `BLE_KEY_TEMPERATURE` / `0x0508` remains the next bottom-layer command to test.
- Current-day step still needs a proven RW source. Keep rejecting `BLE_KEY_ACTIVITY_CURRENT_DAY` as business step data until it matches true daily steps.
- Business pages should read backend data after sync; detail pages should not initiate BLE history sync.
- If v302 logs still show old JL sleep after repeated delete ACKs, the next device-side check is whether the read command needs `ReadContinue` / `0x11` inside the delete loop for sleep fragments.
