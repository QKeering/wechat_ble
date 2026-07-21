# RW v305 Addendum - Stop Empty-ACK ReadContinue Noise

## Goal

Continue RW/SY03 validation one device protocol path at a time. This build keeps the v304 temperature-current probe and changes automatic history sync so verified empty AB responses do not fan out into old fallback routes. Database cleanup is intentionally out of scope.

Build tag: `rw-visible-build-tag-20260718-305`

## Latest Log Source

- Backend: `admin_fastapi`
- Log page: `https://sh.qkeering.com/api/app/rw-debug/logs/page?limit=1000`
- API: `https://sh.qkeering.com/api/app/rw-debug/logs?limit=1000`

## Latest Log Findings Before This Change

- SY03 connection and notify are ready. The selected RW service remains `0000A00A`, write `0000B002`, notify `0000B003`.
- Home sync uploaded two current records: heart-rate and current-day step.
- `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` is the current good step path. The latest sample submitted `stepCount=414`, which is much safer than the old false 9000+ local summary/raw data value.
- `BLE_KEY_ACTIVITY` still returns no submittable historical activity payload in this run.
- `BLE_KEY_SLEEP` / `0x0505` returns empty ACK. That means no current sleep records were available from the ring in this run, so `sleepState` and `durationMinutes` remain empty or zero after upload.
- Blood oxygen, HRV, stress, blood sugar, and blood pressure history keys return empty ACKs in the latest run. They are valid protocol responses, but `records=0`.
- `BLE_KEY_APP_REAL_TIME_TEMPERATURE_DATA` / `0x0230` and historical `BLE_KEY_TEMPERATURE` / `0x0508` both write OK but do not return parsed payloads in the latest run.
- `historyStartDate`, `summaryScheduled`, `data_sync_summary`, `health_raw.step_count`, `health_raw.sleep_state`, and `local summary/raw data` remain the key checks after sync.

## SDK Evidence

- The APP SDK exposes `BLE_KEY_ACTIVITY`, `BLE_KEY_SLEEP`, and `BLE_KEY_ACTIVITY_CURRENT_DAY`.
- For temperature, the SDK has both:
  - `BLE_KEY_APP_REAL_TIME_TEMPERATURE_DATA` / `0x0230`
  - historical `BLE_KEY_TEMPERATURE` / `0x0508`
- The latest device logs show `0x0508` is not returning data, so v304 and v305 probe the SDK current-temperature key first.

## Change In v305

- RW AB history reads now stop after an empty first read ACK. They no longer send automatic `read-continue` for that key.
- If the pre-native AB key returns either payload or empty ACK, automatic sync skips old `native-list`, `native-last-data`, and `readLocalData` fallback for that request.
- If the pre-native key has payload and more AB keys are still requested, sync directly tests the remaining AB keys and merges any payloads.
- If the pre-native key is empty and no remaining AB keys exist, sync returns the empty AB result immediately.
- Temperature order remains `temperature-current` (`0x0230`) before `temperature-history` (`0x0508`).
- No backend API, database delete, or admin_fastapi storage behavior was changed.

## True-Device Test Plan

1. Install v305 and connect SY03.
2. Trigger one normal RW sync from the home or Mine entry.
3. Check backend logs for build tag `rw-visible-build-tag-20260718-305`.
4. Expected log shape:
   - `history-ab-key-empty-stop` appears after empty ACKs.
   - `history-ab-key-skip-legacy-fallback` appears after pre-native AB responses.
   - Empty ACK metrics should not produce paired `read-continue` commands.
   - `native-list`, `native-last-data`, and old local-data fallback should be much lower or absent after an AB response.
5. Continue one route at a time:
   - step: verify `0x051a` only, not summary/local false step.
   - sleep: verify `0x0505` after a real sleep window.
   - temperature: verify whether `0x0230` or `0x0508` ever returns data.
   - HRV/stress/blood oxygen: verify whether the device continues to return empty ACKs or later payloads.

## Still Open

- Temperature remains unverified until true-device logs show whether `0x0230` returns payload.
- Sleep should be tested after a real sleep window. Current logs only show empty ACK from `0x0505`.
- HRV, stress, and blood oxygen are currently bottom-protocol empty ACKs, not page-only conversion loss.
- Business detail pages should read backend data after sync. Detail pages should not initiate BLE history sync.

## Latest v305 Validation - 2026-07-18 23:00-23:02

- v305 is active in the true-device log. Latest snapshots show `rw-visible-build-tag-20260718-305`.
- BLE connection is ready: notify enabled on RW service `0000A00A`, write `0000B002`, notify `0000B003`.
- The empty-ACK noise fix is effective: latest log has no AB `read-continue` commands.
- Uploaded metrics now include:
  - `stepCount` from `0x051a`, value `414`.
  - `spo2` from `0x0509`, value `98`.
  - `stress` from `0x050d`, value `34`.
  - `hrv` from `0x050a`, value `34`.
- Backend upload succeeded with `recordCount=4`, `submitRecordCount=4`, and `healthCount=4`.
- Device time appears corrected in uploaded records. Latest records are on `2026-07-18 23:00-23:01`, not the old 2024 timestamp.
- Still not returning usable data:
  - heart-rate `0x0503`: empty ACK in this run.
  - sleep `0x0505`: empty ACK, no sleep records.
  - temperature current `0x0230`: write OK, no parsed response.
  - temperature history `0x0508`: write OK, no parsed response.
  - blood sugar `0x0510`: empty ACK.
  - blood pressure `0x0504`: empty ACK.
- Current next protocol focus should be temperature, because `0x0230` and `0x0508` are no-response rather than empty-data ACKs.
