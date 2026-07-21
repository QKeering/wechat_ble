# RW Handoff Addendum v203

Date: 2026-07-17

Visible build tag: `rw-visible-build-tag-20260718-262`

Package path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`

Package size after rebuild: main package `1,253,630 bytes`, headroom `843,522 bytes`, total artifact `1,549,666 bytes`.

## v222 - Pressure upload/display focus

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,253,630` bytes, with `843,522` bytes headroom under the 2M limit.
- Scope: focused on pressure/stress data path only. RW BLE command bytes were not changed.
- Homepage business sync now includes pressure in the vital batch: `['heartRate', 'bloodOxygen', 'hrv', 'stress', 'bloodSugar']`. This matches the target ownership: home page syncs device data, inner pages read backend APIs.
- `getStressInfo()` now only queries backend and writes pressure diagnostics. It logs `stress-sync-delegated-to-business` for RW devices instead of starting a separate one-off pressure BLE sync.
- Frontend history upload now maps pressure aliases into backend-compatible `stress`: `stressValue`, `stress_value`, `stressIndex`, `stress_index`, `avgStress`, `avg_stress`, `avgStressValue`, `avg_stress_value`, `pressure`, `pressureValue`, and `pressure_value`.
- RW parser, local latest metric readers, foreground metric readers, and diagnostic summaries now understand the same pressure aliases.
- Backend `admin_fastapi` `/app/data/sync` now accepts the same pressure aliases and writes them to `health_raw.stress`.
- Static audit now fails if the Relax/Stress detail page contains `syncBusinessHistoryPage`, `readLocalData`, or `allowRwDeviceSync`; pressure detail should remain backend-query only.

Validation passed:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run verify:ring-ble`
- `E:\qkeer\code\wechatAdmin\admin_fastapi\.venv\Scripts\python.exe scripts\verify_rw_health_sync.py`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Next pressure check:

1. Import `dist/build/mp-weixin` and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Stay on Awareness home page until `RW HOME / business-sync-background-result` appears.
3. Confirm the `vital` item includes `stress` in its `dataTypes`.
4. If pressure is still blank, copy Mine diagnostics and inspect:
   - `history-page-sync-result` for the homepage vital batch: whether stress history returned records or only an empty ACK.
   - `history-page-upload-result`: whether `submitRecordSample` includes `stress`.
   - `RW PRESSURE / stress-detail-query`: whether backend returns `stressValue`, `avgStressValue`, or `stressChart`.
5. If homepage upload contains `stress` but pressure detail query is empty, check deployed `admin_fastapi` version first.

## v218 Homepage-Owned Business Sync

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,251,959` bytes, with `845,193` bytes headroom under the 2M limit.
- Scope: moved the remaining RW business-history ownership to the homepage. Inner detail pages remain backend-query only.
- `src/pages/awareness/awareness.vue` now has `syncAwarenessBusinessHistoryInBackground` with a per-date 5-minute cooldown and in-flight dedupe.
- Homepage serial sync items:
  - sleep: `dataTypes: ['sleepData']`
  - activity: `dataTypes: ['activity']`
  - vital: `dataTypes: ['heartRate', 'bloodOxygen', 'hrv', 'stress', 'bloodSugar']`
- Pressure/stress is now included in the homepage vital batch. The previous standalone pressure page/home query no longer starts a second BLE sync.
- New homepage logs: `RW HOME / business-sync-background-start`, `business-sync-background-result`, `business-sync-skip-cooldown`, and `business-sync-dedupe`.
- After each sync item finishes, homepage re-queries the backend endpoint and refreshes only that homepage chart. This keeps the homepage responsive while filling data for backend-only detail pages.
- Validation passed: `npm.cmd run type-check`, `npm.cmd run audit:rw-l19 -- --skip-dist`, `npm.cmd run build:mp-weixin`, `npm.cmd run verify:mp-weixin-artifact`, `npm.cmd run check:mp-weixin-size`, and `npm.cmd run audit:rw-l19`.

Next real-device check:

1. Connect SY03 and stay on homepage until logs show `RW HOME / business-sync-background-result`.
2. Open sleep, activity, vital signs, and pressure detail pages. They should query backend directly, not start device reads from the detail pages.
3. Copy Mine diagnostics. Check `history-page-upload-result` counts for sleep/activity/vital and the corresponding detail `history-page-query-result` value hints.

## Latest Log Review

The latest 14:49 real-device log was still from older build `build 173`.
It proves the device can connect and notify, but it cannot verify the current v203 sleep/activity history path.

Useful evidence from that stale log:

- BLE transport was ready: connected, communication ready, and notify enabled.
- The device returned a generic short `0x0609` control ACK, for example `ab11000351e6060900`.
- Older build 173 treated that generic ACK as `unknown`, so `hrv/control-enable` timed out even though the device had replied.
- Current v203 Mine probe accepts generic `0x0609` ACK while a control command is waiting, so this class of response should no longer be counted as timeout.
- Analyzer now surfaces this evidence explicitly as `generic-rw-control-acks: FOUND`, with nearest command correlation such as `hrv/control-enable@L7/tx-ok`.
- The log did not exercise the current AB sleep/activity history probes.
- The old `history/file-list` timeout is not the main SY03/RW path and should stay out of the focused missing-command list.
- Current v203 missing-command probe is focused on four AB sleep/activity first-read history keys rather than already-proven core/control paths.
- APP SDK reference checked: Android demo uses `DHBleSdk.subscribeData(healthDataBroCallback)` for realtime health payloads, `DHBleSdk.subscribeData(testHrCallback)` for control command results, then `DHBleSdk.controlHealthDataJL(..., 1/0)`. This confirms a generic successful control ACK can be accepted even when the ACK does not repeat the metric name.
- APP SDK history reference uses `DHBleSdk.syncAllHealthData(...)` and `DHBleSdk.syncHealthDataByType(...)`, so the current focused path is RW/AB sleep and activity history payloads, not legacy or QKeer V2 fallback.

## v193-v203 Protocol Alignment

- Cross-checked the local Android APP SDK classes under `E:\qkeer\.codex_tmp\rw_sdk_app_classes_260414`.
- SDK key values match current implementation:
  - `BLE_KEY_SLEEP = 0x0505`
  - `BLE_KEY_RAW_SLEEP = 0x02fe`
  - `BLE_KEY_ACTIVITY = 0x0502`
  - `BLE_KEY_ACTIVITY_CURRENT_DAY = 0x051a`
- SDK `SyncJLDataService.syncRingHealthData()` reads activity-current-day first, then sleep, then other health/history keys.
- SDK uses a get/continue/delete style history flow. Current mini-program still avoids delete for safety, but the current code keeps sending `ReadContinue(0x11)` for sleep/activity keys while payload pages keep arriving, then stops on an empty ACK, timeout, or the bounded page limit.
- Mine-page missing-command self-test no longer sends standalone `ReadContinue(0x11)` probes; it now checks only the first-read keys `0x0505`, `0x02fe`, `0x051a`, and `0x0502`, while real history sync still emits `history-ab-key-payload-continue` when a payload requires continuation.
- Default RW history fallback order now follows the APP SDK priority: activity-current-day first, then activity, sleep, raw-sleep, then vital keys. Targeted page reads still use their requested data type directly.
- Vital-sign targeted page reads now include temperature (`0x0508`) and blood pressure (`0x0504`) in the primary AB key path, so the detail page reads heart rate, blood oxygen, HRV, temperature, blood sugar, and blood pressure through one focused RW path.
- Vital-sign page RW detection now uses the shared protocol resolver (`ringBleBridge.isCurrentRwRing()`), so SY03 still uses the RW history path when the page store has device name/advertising data but no explicit `protocol` field yet.
- Vital-sign measurement components for heart rate, blood oxygen, HRV, and temperature now use `resolveRingProtocol()` instead of `userStore.deviceInfo.protocol === 'rw'`. This keeps SY03 on the RW foreground-measurement path even when the page only has name/advertising data.
- Health page was rebuilt with clean Chinese visible copy and the shared RW protocol resolver. This fixes the health-page mojibake/English leakage and keeps SY03 refresh on the RW path even if the page store has not written an explicit `protocol` field yet.
- Awareness page RW refresh now also uses `resolveRingProtocol()` instead of raw `userStore.deviceInfo.protocol` / `ringStore.deviceInfo.protocol` checks. This keeps the home/awareness entry on the RW timeout and refresh-dedupe path when SY03 is known by name or advertising data before the protocol field is persisted.
- Sleep page history uploads use a 24-hour lookback window, so overnight sleep records whose start time is before the selected date 00:00 are not filtered out before upload.
- Sleep stage status `4` now displays Chinese REM-stage copy, avoiding English `REM` on user pages.
- Backend `admin_fastapi` now accepts RW `motionIntensity = 4`; this keeps high-intensity activity samples from being discarded during `/app/data/sync`.
- RW AB activity history now maps `activityLevel` to `motionIntensity` for both record payloads and value-only summaries.
- New diagnostic event: `history-ab-key-payload-continue`.
- New diagnostic event: `history-ab-key-payload-merged`.
- Analyzer now reports `payloadContinue` for the AB history key path.
- Analyzer now reports generic RW `0x0609` realtime control ACKs and correlates them with the nearest pending control command.
- History page upload samples now expose `rawDataType`, `sleepDuration`, `totalDuration`, `deepSleepDuration`, `shallowSleepDuration`, `lightSleepDuration`, `motionIntensity`, calorie, and distance hints so a real-device log can separate payload parsing from backend/page display issues.
- Mine diagnostics and metric submission helpers now use resolver-inferred RW identity for SY03 even when a page/device object has no explicit `protocol` field yet.
- Metric foreground-measurement fallback now disables cached RW values for resolver-inferred SY03, so a pending measurement cannot submit stale heart-rate/blood-oxygen values.
- RW history normalization now fills APP SDK style step aliases (`step`, `steps`, `stepCount`, `totalSteps`, calorie, distance) before page upload.
- RW history normalization now fills APP SDK style sleep aliases (`sleepDuration`, `sleepDurationMinutes`, `durationMinutes`, `sleepTotalMinutes`, `totalSleepTime`, `totalSleepMinutes`, `totalDuration`) before page upload.
- RW history normalization now preserves APP SDK sleep summary fields (`totalDuration`, `deepSleepDuration`, `shallowSleepDuration`, `lightSleepDuration`) so summary payloads can still become L19/backend-compatible sleep duration data.
- v202 history-page diagnostic summaries now show APP SDK sleep summary fields separately in `rawRecordSample.metrics`, so tomorrow's sleep test can tell whether the ring returned total/deep/light duration before backend/page rendering.
- v203 history-page backend-query summaries now also show APP SDK sleep summary fields in `history-page-query-result.response.valueHints`, so logs can separate device upload success from backend/page query rendering.
- RW business controller fallback messages for monitoring/config/refresh failures are now Chinese, so diagnostics and toasts do not leak English failure text during RW testing.
- RW/L19 parity audit now scans runtime source files for common mojibake patterns and asserts the RW monitoring/config fallback messages remain Chinese.
- Mine-page protocol self-test command keys now use `history/ab-key/...`, matching the history sync diagnostics and handoff checklist. This makes real-device logs easier to map back to the exact RW AB history command under test.
- `rw-history` parity now asserts parsed APP SDK AB sleep/activity payloads keep both SDK fields and L19/backend-compatible fields.
- RW AB sleep/activity history now supports multiple APP SDK payload pages. It continues `ReadContinue(0x11)` until an empty continue ACK, timeout, or `RW_HISTORY_AB_KEY_MAX_CONTINUE_PAGES`.
- v195 merges same-key AB sleep/activity payload pages before parser mapping so split responses can produce one complete SDK-shaped result.
- v195 also prevents payload pages from different AB history keys from being merged together. This protects the sleep `0x0505` and raw-sleep `0x02fe` path when one key times out on continue and the next key immediately returns a payload.
- v196 treats `rw_ab_health_history` as a first-class L19-compatible history payload in upload completion checks, Store SDK local-data projection, and the Pinia ring store direct parsed-event path.
- v197 normalizes APP SDK raw AB history aliases such as `ab_activity_current_day` and `ab_sleep_sdk_summary` into business `step` and `sleep` types even when `dataType` is missing.
- v197 lets typed empty `rw_ab_health_history` responses clear only the matching business type in Store SDK local-data projection.
- v197 probe copy clarifies that realtime control commands may return a generic `0x0609` ACK instead of repeating the metric name/action.
- v198 passes the sleep page's 24-hour lookback timestamp into the actual RW device read, not only into upload filtering. This protects overnight sleep records that start before the selected date 00:00.
- v198 moves APP SDK AB raw-alias normalization into the RW history/compat layer as well, so `ab_activity_current_day` and `ab_sleep_sdk_summary` are typed correctly before Store projection.
- `rw-history` parity now asserts a two-page APP SDK `ActivityCurrentDay` response sends two `read-continue` commands and becomes one current-day summary with item details.
- `rw-history` parity now asserts a two-page APP SDK sleep response produces three sleep segments and a 240-minute summary after payload merge.

## Current Focus

The goal is still to make RW behave like the completed L19 path:

- Connection and notification are usable.
- Battery is already proven in earlier logs.
- Generic `0x0609` control ACK is handled.
- Sleep/activity/stress/vital history still needs real-device evidence from current build.
- If the device returns AB history payload but pages stay blank, the next problem is page/backend consumption, not BLE transport.
- If the device returns only empty ACK after overnight wear, check whether the ring actually stored history or whether monitoring collection was disabled.
- If commands timeout on v203, compare exact command hex against the APP SDK call path before adding more fallback traffic.

## 2026-07-17 14:49 Log Review

- User log attachment `40b8c01e-f686-46f2-9a29-9b626a9a7914/pasted-text.txt` is from stale build `20260716-173`, so it must not be used to judge the current v203 sleep/activity history path.
- The log proves the SY03 connection snapshot was ready: `connected=true`, `ready=true`, `notifyEnabled=true`, service `0000A00A`, command characteristic `0000B002`, notify characteristic `0000B003`.
- The log contains one generic realtime control ACK: `ab11000351e6060900`, parsed as `rw_health_data_control_ack`, `key=0x0609`, `name=unknown`. Current v203 adapter claims this ACK through the pending control queue and attributes it back to the in-flight metric command.
- The old v173 missing-command panel still ran 13 optional commands, including realtime control and file-list fallbacks. Current v203 missing-command panel is intentionally reduced to the four unproven AB history first-read keys: sleep `0x0505`, raw-sleep `0x02fe`, activity-current-day `0x051a`, and activity `0x0502`.
- The log contains zero sleep/activity AB history commands, so `sleep/activity-ab-focus` is `NOT_TESTED`. The next useful evidence must come from current v203 after overnight wear.
- No code change was required for this log because the current source already contains the APP SDK alignment that this stale log points to: generic `0x0609` ACK correlation, reduced missing-command focus, and sleep/activity APP SDK AB history aliases.
- Rebuilt the current package after reviewing the log. Main package is now `1,240,548 bytes`; headroom is `856,604 bytes`.

## Validation Completed

- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`
- `.\.venv\Scripts\python.exe scripts\verify_rw_health_sync.py` in `E:\qkeer\code\wechatAdmin\admin_fastapi`
- 2026-07-17 update: `node --check` passed for the log analyzer and verifier scripts.
- 2026-07-17 update: `npm.cmd run verify:ring-ble` passed after adding the generic `0x0609` ACK analyzer smoke test.
- 2026-07-17 update: `npm.cmd run audit:rw-l19 -- --skip-dist` passed after the analyzer-only change.
- 2026-07-17 v185 update: Mine-page missing-command self-test was reduced from eight fixed sleep/activity read/read-continue probes to four first-read probes.
- 2026-07-17 v186 update: Vital-sign targeted RW history reads now include temperature and blood pressure in the primary AB allow-list.
- 2026-07-17 v187 update: Vital-sign page now uses the shared RW protocol resolver instead of a raw `protocol === 'rw'` field check.
- 2026-07-17 v188 update: Health page visible text was rebuilt as clean Chinese, and health refresh uses the same shared RW protocol resolver.
- 2026-07-17 v189 update: Vital-sign foreground measurement components now use shared RW protocol detection instead of raw protocol-field checks, with parity coverage to keep that behavior in place.
- 2026-07-17 v190 update: Awareness/home refresh now uses shared RW protocol detection instead of raw protocol-field checks, with parity coverage to keep that behavior in place. Rebuild and post-build artifact/size/audit validation passed in the previous v190 package.
- 2026-07-17 v191 update: Mine diagnostics and metric helper submission/cache fallback now use shared RW protocol detection, with parity coverage for resolver-inferred SY03 and generic `0x0609` control ACK handling. Rebuild and post-build artifact/size/audit validation passed in the previous package.
- 2026-07-17 v192 update: APP SDK style RW sleep/activity history records now get L19/backend-compatible aliases during history normalization. Validation passed in the previous package.
- 2026-07-17 v193 update: AB sleep/activity history now supports multi-page APP SDK payload continuation. Validation passed in source/parity.
- 2026-07-17 v194 update: same-key AB sleep/activity payload pages are merged before parser mapping. Validation passed in source/parity.
- 2026-07-17 v195 update: AB payload merge now flushes when the response key changes, so sleep/raw-sleep/activity payloads cannot be cross-merged. Validation passed in source/parity.
- 2026-07-17 v196 update: `rw_ab_health_history` is now accepted as a completed history payload and projected into local data by Store SDK and Pinia store direct parsed-event handling. Validation passed in the previous package.
- 2026-07-17 v197 update: APP SDK raw AB history aliases now normalize into business `sleep`/`step`, typed empty AB history clears only the matching business type, and realtime control probe expectations now mention generic `0x0609` ACK. Validation passed in the previous package.
- 2026-07-17 v198 update: sleep/activity business-page reads now pass the computed lookback `sinceTimestamp` into the actual RW read call, and APP SDK AB raw-alias normalization is enforced in RW history plus compat entry points. Validation passed in the previous package.
- 2026-07-17 v199 update: APP SDK `SleepSummaryBean` aliases (`totalDuration`, `deepSleepDuration`, `shallowSleepDuration`) are now preserved, normalized, uploaded, and exposed in history-page diagnostics. Validation passed in the previous package.
- 2026-07-17 v200 update: RW monitoring/config/refresh fallback messages are Chinese, and the parity audit now blocks common runtime mojibake patterns plus English RW monitoring fallback regressions. Validation passed in the previous package.
- 2026-07-17 v201 update: Mine-page protocol self-test command keys were renamed from `history-key/...` to `history/ab-key/...`, aligning copied logs with the AB history diagnostics and handoff checklist. The log analyzer still accepts old `history-key/...` rows for stale logs. `audit:rw-l19 -- --skip-dist`, `type-check`, `verify:rw-backend-health`, `verify:ring-ble`, `build:mp-weixin`, `verify:mp-weixin-artifact`, `check:mp-weixin-size`, and full `audit:rw-l19` passed in the previous package.
- 2026-07-17 v202 update: `history-page-upload-result.rawRecordSample.metrics` now includes APP SDK sleep summary fields (`totalDuration`, `deepSleepDuration`, `shallowSleepDuration`, `lightSleepDuration`) alongside the L19-compatible `sleepDuration`. `audit:rw-l19 -- --skip-dist`, `type-check`, `verify:rw-backend-health`, `verify:ring-ble`, `build:mp-weixin`, `verify:mp-weixin-artifact`, `check:mp-weixin-size`, and full `audit:rw-l19` passed for this package.
- 2026-07-17 v203 update: `history-page-query-result.response.valueHints` now includes APP SDK sleep summary fields (`totalDuration`, `deepSleepDuration`, `shallowSleepDuration`, `lightSleepDuration`) after backend query as well as upload. `audit:rw-l19 -- --skip-dist`, `type-check`, `verify:rw-backend-health`, `build:mp-weixin`, `verify:mp-weixin-artifact`, `check:mp-weixin-size`, full `audit:rw-l19`, and `verify:ring-ble` passed for this package.
- 2026-07-17 14:49 log follow-up: `analyze-rw-ble-log --expect-history=sleep,activity --no-fail`, `businessHistoryPageSync.parity`, `type-check`, `verify:ring-ble`, `verify:rw-backend-health`, `build:mp-weixin`, `verify:mp-weixin-artifact`, `check:mp-weixin-size`, and full `audit:rw-l19` passed again in the previous package.

## Overnight Test Plan

Wear SY03 overnight on 2026-07-17 and test on 2026-07-18 morning with build tag `rw-visible-build-tag-20260718-262`.

Recommended sequence:

1. Open Mine and confirm copied diagnostics show `rw-visible-build-tag-20260718-262`.
2. Clear diagnostics.
3. Keep ring connected and open Sleep page first.
4. Open Activity page second.
5. Copy Mine diagnostics.

Key log lines to inspect:

- `history/ab-key/sleep/read` for key `0x0505`
- `history/ab-key/raw-sleep/read` for key `0x02fe`
- `history/ab-key/activity-current-day/read` for key `0x051a`
- `history/ab-key/activity/read` for key `0x0502`
- `history/ab-key/temperature/read` for key `0x0508`
- `history/ab-key/blood-pressure/read` for key `0x0504`
- `history-ab-key-payload-continue`
- `history-ab-key-payload-merged`
- Analyzer fields `abPayload`, `abPayloadRecords`, and `payloadContinue`
- History page sample fields `sleepDuration`, `totalDuration`, `deepSleepDuration`, and `shallowSleepDuration` if the ring returns an APP SDK sleep summary payload

Expected next decision:

- Payload + page blank: fix `syncRwHistoryFiles()` conversion or page upload bridge.
- Empty ACK after overnight wear: verify monitoring/storage state on device.
- Timeout: inspect the exact command and compare with APP SDK runtime command generation.

## v204 update: business page upload window fix

Visible build tag: `rw-visible-build-tag-20260718-262`

Latest real-device log:

- Source: `5f3f3e9b-1271-4a56-8a7b-10b48495bd96/pasted-text.txt`
- Snapshot was connected and ready: `connected=true`, `ready=true`, `notifyEnabled=true`.
- The device did return RW AB history payloads:
  - Sleep probe `history/ab-key/sleep/read` returned `rw_health_data:sleep`, 22 records, `sleepTotalMinutes:10`.
  - Activity current-day probe `history/ab-key/activity-current-day/read` returned `rw_health_data:step`, `stepCount:590`.
  - Activity page sync returned `rawRecords=2`.
- Business-page display still stayed empty because upload produced `submitRecords=0`, not because BLE failed to read data.

Root cause now being handled:

- SY03 APP-SDK AB sleep/activity payloads can contain timestamps outside the selected business-page day.
- Page sync passes a date window (`sinceTimestamp`), then upload filters out records older than that window.
- Result before v204: records were parsed, but upload rejected all page records before backend submission.
- Activity current-day payloads can also report a zero summary while hourly items contain steps; the page/backend should use item totals in that case.

v204 changes:

- `parseRwSdkActivityHistoryRecords()` now falls back to summed item totals for `ActivityCurrentDay` when the summary step count is zero.
- `mapRwAbHealthHistoryResult()` now aligns RW AB sleep and activity-current-day record timestamps to the page read window when `readAll=false`.
- Aligned records are marked with `rwTimestampAligned`, `rwOriginalUnixTime`, and `rwTimestampAlignReason`.
- `submitRingHistorySyncResult()` now reports `filteredOutCount` and `sampleFilteredRecords`.
- Business page upload diagnostics now include filtered samples, so the next log can show whether records are still being dropped before backend upload.

Next validation:

1. Open Mine and confirm the copied diagnostics show `rw-visible-build-tag-20260718-262`.
2. Clear diagnostics.
3. Open Sleep page, then Activity page.
4. Copy Mine diagnostics.
5. Check `history-page-upload-result`:
   - expected for fixed page path: `rawRecordCount > 0`, `submitRecordCount > 0`, `filteredOutCount = 0` or much lower than before.
   - if `submitRecordCount > 0` but page query is still empty, move to backend storage/query aggregation.
   - if `filteredOutCount > 0`, inspect `filteredRecordSample.rwOriginalUnixTime` and `rwTimestampAlignReason`.

Local validation for packaged v204:

- `npm.cmd run type-check` passed.
- `npm.cmd run audit:rw-l19 -- --skip-dist` passed.
- `npm.cmd run verify:ring-ble` passed.
- `npm.cmd run verify:rw-backend-health` passed.
- `npm.cmd run build:mp-weixin` passed.
- `npm.cmd run verify:mp-weixin-artifact` passed.
- `npm.cmd run check:mp-weixin-size` passed: main package 1,244,134 bytes, 853,018 bytes headroom.
- `npm.cmd run audit:rw-l19` passed.

2026-07-17 continuation:

- The log analyzer now expands `diagnostic-history-report.pages[].sync/upload/query` into page-level history events when the compact JSON is parseable.
- Analyzer output now prints `filteredOut` for history page upload diagnostics.
- Added a verifier smoke test for the exact page-blank pattern: compact report shows `rawRecords > 0`, `submitRecords = 0`, `filteredOutCount > 0`.
- Validation after analyzer-only update: `node --check scripts/analyze-rw-ble-log.mjs`, `node --check scripts/verify-ring-ble-parser.mjs`, `npm.cmd run verify:ring-ble`, `npm.cmd run audit:rw-l19 -- --skip-dist`, and full `npm.cmd run audit:rw-l19` passed.
- This analyzer-only continuation has been superseded by the v205 package below.

## v205 update: ordinary APP SDK activity page-window fix

Visible build tag: `rw-visible-build-tag-20260718-262`

Why this was needed:

- The v203 real-device log showed both `ab_activity_current_day_summary` and ordinary `ab_activity_sdk_summary` payloads.
- v204 aligned current-day activity and sleep records, but ordinary APP SDK activity records could still keep the device-side stale date such as `2026-07-09`.
- Business pages submit with the selected page day as `sinceTimestamp`; stale ordinary activity records were still eligible to be filtered before backend submission.

v205 changes:

- `alignRwAbHistoryRecordToReadWindow()` now aligns ordinary `ab_activity_sdk_*` records when `readAll=false`.
- Current-day activity remains marked with `rwTimestampAlignReason: "activity-current-day-window"`.
- Ordinary activity is marked with `rwTimestampAlignReason: "activity-page-window"`.
- Added a parity case where `activity-current-day` times out, `activity` returns an old-date APP SDK payload, and the final record is shifted to the requested business date.

Local validation for packaged v205:

- `npm.cmd run type-check` passed.
- `npm.cmd run verify:rw-backend-health` passed.
- `npm.cmd run verify:ring-ble` passed.
- `npm.cmd run build:mp-weixin` passed.
- `npm.cmd run verify:mp-weixin-artifact` passed.
- `npm.cmd run check:mp-weixin-size` passed: main package 1,244,209 bytes, 852,943 bytes headroom.
- `npm.cmd run audit:rw-l19 -- --skip-dist` passed.
- `npm.cmd run audit:rw-l19` passed.

Next real-device decision:

1. Publish `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Open Activity and Sleep pages, then copy Mine diagnostics.
4. If `history-page-upload-result.rawRecordCount > 0` and `submitRecordCount > 0`, BLE parsing/upload is no longer the blocker.
5. If backend query still returns empty after successful submit, continue in backend storage/query aggregation.
6. If `submitRecordCount = 0`, inspect `filteredRecordSample.rwTimestampAlignReason` and `rwOriginalUnixTime`.

## v206 update: business page submit compatibility

Visible build tag: `rw-visible-build-tag-20260718-262`

Latest log conclusion:

- The ring was connected, ready, and notifying; sleep/activity/vital AB history payloads were returned. The business-page blank state was not caused by a disconnected BLE link or no device response.
- Sleep and activity page logs showed raw history records, but older builds filtered them before `/app/data/sync` because SY03 APP-SDK records carried stale device-side dates.
- Vital-sign logs showed heart-rate/SpO2 records, but 6-byte AB vital records were being interpreted with little-endian timestamps, producing impossible years and keeping backend page queries empty.
- RW sleep stage values use the SDK/QKeer convention (`2` means deep sleep), while the backend/L19 sync contract expects `4` for deep sleep.

v206 changes:

- AB compact vital history now prefers SDK big-endian timestamps and records `timestampEncoding:"sdk_be"`.
- `alignRwAbHistoryRecordToReadWindow()` now aligns AB vital records to the selected page date when `readAll=false`, marking them with `rwTimestampAlignReason:"vital-page-window"`.
- RW sleep stages are normalized before upload to backend/L19 values: light `3`, deep `4`, REM `2`, awake `1`; invalid start/end states are not submitted as sleep stages.
- Added parity coverage for the real-device heart-rate payload shape `2e22008c 49 00`, stale AB vital page-window alignment, and RW deep-sleep upload mapping.

Packaged v206 validation:

- `npm.cmd run type-check` passed.
- `npm.cmd run verify:rw-backend-health` passed.
- `npm.cmd run verify:ring-ble` passed.
- `npm.cmd run audit:rw-l19 -- --skip-dist` passed.
- `npm.cmd run build:mp-weixin` passed.
- `npm.cmd run verify:mp-weixin-artifact` passed.
- `npm.cmd run check:mp-weixin-size` passed: main package 1,245,448 bytes, 851,704 bytes headroom; total artifact 1,524,275 bytes.
- `npm.cmd run audit:rw-l19` passed.

Next real-device check:

1. Publish `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Open Sleep, Activity, Vital Signs, and Relax/Stress pages, then copy Mine diagnostics.
4. Expected upload evidence: `history-page-upload-result.rawRecordCount > 0`, `submitRecordCount > 0`, and submitted samples with `rwTimestampAlignReason` equal to `sleep-page-window`, `activity-page-window` / `activity-current-day-window`, or `vital-page-window`.
5. If upload succeeds but the business page query is still empty, the next line is backend storage/query aggregation rather than BLE protocol.

## v207 update: backend submit-response diagnostics

Visible build tag: `rw-visible-build-tag-20260718-262`

- `submitRingHistorySyncResult()` now preserves the `/app/data/sync` response returned by `submitData`.
- `history-page-upload-result` now logs a compact `submitResponse` summary: `code`, `success`, `message`, payload type/keys, payload success/count/message.
- This does not change the upload payload; it only makes the next real-device log able to prove whether backend sync accepted the submitted records.
- Next log interpretation:
  - `submitRecordCount > 0` and `submitResponse.success/code` OK, but page query empty: inspect backend storage/query aggregation.
  - `submitRecordCount > 0` and `submitResponse` reports failure/message: fix backend `/app/data/sync` handling or auth/device identity.
  - `submitRecordCount = 0`: continue inspecting record filtering and timestamp alignment.

## v207 continuation: frontend/backend submit contract check

No package rebuild was required for this documentation/backend-verifier-only update.

- `admin_fastapi/scripts/verify_rw_health_sync.py` now includes a frontend-style RW sync sample covering `recordTime`, `stepCount`, `heartRate`, `hrv`, `spo2`, `stress`, `temperature`, `sleepState`, `sleepDuration`, `motionIntensity`, `perfusionIndex`, and `rrIntervals`.
- The sample proves the current frontend `dataList` field names map to backend `health_raw` columns.
- `npm.cmd run verify:rw-backend-health` passed after the contract sample was added.
- The log analyzer now reports `backendSubmit=PASS/FAIL/UNKNOWN` and has a smoke test for `submitRecords > 0` with backend submit failure.
- Next valid real-device log must still use `rw-visible-build-tag-20260718-262`; do not judge current business-page display from older v203 logs.

## v208 update: business-page upload/date visibility

Visible build tag: `rw-visible-build-tag-20260718-262`

- The latest available real-device evidence was still from v203, but it clearly showed the device returned records while the business-page upload submitted zero records. So the next blocker was not BLE connection; it was the upload/storage/query bridge.
- `submitRingHistorySyncResult()` now supports `disableTimestampFilter` and `dateRef`.
- `useRingBusinessHistoryPageSync` passes `disableTimestampFilter:true` for business-page uploads. The page read still targets the selected date, but upload no longer filters the just-read records out before `/app/data/sync`.
- Sleep page uploads pass `dateRef` as the selected page date, so overnight records can be queried by the day the UI is showing.
- Backend `/app/data/sync` now includes accepted sleep `date_ref` values in `touched_dates`, allowing daily-summary recalculation for the visible sleep day.
- Frontend parity covers a sleep page record that would be filtered by timestamp without `disableTimestampFilter`; backend verification covers `dateRef:"2026-07-17"` with a previous-day `recordTime`.
- Backend verification now also proves query visibility after insertion: RW activity/vital samples are visible through raw page points and daily summary, motion intensity buckets are populated, and sleep rows are visible by selected `dateRef`.
- `health.py` now coerces SQL-driver string timestamps into `datetime` before motion-minute and sleep-summary calculations, preventing business-page summary refresh from failing on textual `record_time` values.
- Packaged v208 validation passed: `type-check`, `verify:rw-backend-health`, `verify:ring-ble`, `audit:rw-l19 -- --skip-dist`, `build:mp-weixin`, `verify:mp-weixin-artifact`, `check:mp-weixin-size`, and full `audit:rw-l19`.
- Current package is `dist/build/mp-weixin`; main package is 1,246,789 bytes with 850,363 bytes headroom, total artifact 1,525,616 bytes.
- For the next real-device log, inspect: `rawRecordCount`, `submitRecordCount`, `timestampFilterDisabled:true`, `submitResponse`, and then page query `itemCount`/value hints.

## v209 update: dateRef for every business metric row

Visible build tag: `rw-visible-build-tag-20260718-262`

Latest v208 log:

- Source: `96b941f9-2adf-4c99-9fdb-0bf2b3a57183/pasted-text.txt`
- The log is from stale build 208, so the current v209 code still needs a real-device retest.
- Connection was ready: `connected=true`, `ready=true`, `notifyEnabled=true`, service `0000A00A`, command characteristic `0000B002`, notify characteristic `0000B003`.
- Focused probe proved the ring can return AB history payloads:
  - sleep `0x0505`: `rw_health_data:sleep`, 22 records, `sleepTotalMinutes:10`
  - raw sleep `0x02fe`: timeout
  - activity current-day `0x051a`: empty ACK
  - activity `0x0502`: `rw_health_data:step`
- Business-page evidence was more important than the missing optional raw-sleep command: `exercise` uploaded 2 records, but backend page query value hints stayed empty. Sleep latest page sync was empty/skip even though the probe had sleep payload. That means the active blocker is after BLE: upload date mapping, backend storage/query, or page field consumption.

v209 changes:

- Business-page upload now attaches `dateRef` to every submitted metric row with real fields, not only sleep rows.
- Backend `/app/data/sync` rebases non-sleep `health_raw.record_time` to the submitted `dateRef`. This keeps step, heart-rate, SpO2, HRV, stress, temperature and blood-sugar rows queryable under the selected business-page date even when SY03 returns stale device timestamps.
- Sleep still uses `date_ref` for the visible query day, but its overnight start/end timestamps are not rebased.
- Sleep and vital-sign pages now query detail APIs with the selected page date instead of always using today's date.
- Activity display components no longer hide valid zero values.
- Sleep-time rendering now has an aggregate-duration fallback when RW summary payloads do not contain backend stage-code points.

Validation for packaged v209:

- `npm.cmd run type-check`
- `npm.cmd run verify:rw-backend-health`
- `python -m py_compile` for backend `app.py` and `verify_rw_health_sync.py`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,246,769 bytes`
- Headroom: `850,383 bytes`
- Total artifact: `1,525,662 bytes`

Next real-device check:

1. Publish/import `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Open Activity, Vital Signs, Sleep, and Relax/Stress pages.
4. Copy Mine diagnostics.
5. If `history-page-upload-result.submitRecordCount > 0` and `submitResponse` is OK but query `itemCount/valueHints` is empty, continue in backend query/summary aggregation.
6. If query has values but the page is blank, continue in frontend component field consumption.

## v210 update: business detail pages consume synced RW data

Visible build tag: `rw-visible-build-tag-20260718-262`

Latest v209 real-device log:

- Source: `94416b1c-efa2-4dff-9784-3b48a40490e1/pasted-text.txt`
- Connection and notify path were healthy: `connected=true`, `ready=true`, `notifyEnabled=true`, service `0000A00A`, command characteristic `0000B002`, notify characteristic `0000B003`.
- Focused probe proved usable history payloads: sleep `0x0505` returned 22 records with `sleepTotalMinutes:10`; activity current-day `0x051a` returned `stepCount:1466`; activity `0x0502` returned `stepCount:415`.
- Business pages had moved past BLE for sleep/activity: sleep page synced and uploaded 22 records, and `sleep-summary` query returned `sleepScore=54`; exercise synced and uploaded one step record.
- The remaining blank-detail symptom was frontend consumption: sleep score/time cards looked at overview/detail fields while backend summary already held the value; vital sub-detail pages were not consistently using the RW business sync/query bridge and selected date; pressure was not pulled on homepage unless the stress detail page had already synced it.

v210 changes:

- Sleep detail page now feeds `sleep-summary.sleepScore`, `sleepMinutes`, and `lastNightSleepMinutes` into the score/time cards when overview/detail endpoints are sparse.
- Heart-rate, blood-oxygen, HRV, and temperature detail subpages now run the RW business history sync/query bridge with selected-date `dateRef` before calling their backend detail APIs.
- Relax/stress detail page now falls back to already parsed RW stress/HRV values from the user store when backend detail data is sparse.
- Awareness homepage pressure now does a scoped stress history sync only after the first backend stress query has no stress value, then re-queries the backend. This limits extra protocol/log noise to the missing-pressure case.
- Log analyzer now treats malformed copied `history-page-upload-result.submitResponse` lines with `data:false` as `backendSubmit=FAIL`, preventing false PASS when backend sync rejects records.

Validation for packaged v210:

- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,247,227 bytes`
- Headroom: `849,925 bytes`
- Total artifact: `1,529,449 bytes`

Next real-device check:

1. Publish/import `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Open in small batches to avoid copied log truncation: Sleep detail -> copy Mine diagnostics; Activity detail -> copy; Vital Signs and its heart/SpO2/HRV/temperature subpages -> copy; Homepage pressure/Relax detail -> copy.
4. For each batch, inspect `history-page-sync-result`, `history-page-upload-result.submitResponse`, and `history-page-query-result.valueHints/itemCount`.
5. If query has values but the page remains blank, stay in frontend component field mapping. If upload is OK but query is empty, stay in backend query/summary aggregation. If sync has no records, return to the specific protocol command for that data type.

## v211 update: detail-card display fallback and pressure empty cooldown

Visible build tag: `rw-visible-build-tag-20260718-262`

Latest real-device logs reviewed:

- `94416b1c-efa2-4dff-9784-3b48a40490e1/pasted-text.txt` was build `209`.
- `ce18e39c-70c3-49b4-9e90-1731d22a2689/pasted-text.txt` was build `210`.

Log conclusions:

- The BLE connection was ready and notification was enabled.
- Sleep AB history `0x0505` returned 22 records. Activity current-day `0x051a` and ordinary activity `0x0502` returned usable step/calorie/distance values.
- Business sync for sleep/activity was already past the BLE layer: sleep uploaded records and `sleep-summary` returned score `54`; exercise uploaded step records.
- Pressure/stress was different: SY03 replied with empty stress ACK `ab1100035d15050d10`, so homepage pressure still has no device records to display.
- The remaining "homepage has data, detail page blank" symptom was frontend field consumption: synced/queryable values and cached RW metrics were not consistently normalized into the detail card props.

v211 changes:

- Activity detail cards now normalize RW/L19 step, calorie, and active-time aliases before rendering: `stepCount`, `steps`, `totalSteps`, `totalCalorie`, `activityMinutes`, and cached store values all feed the existing L19 card fields.
- Sleep detail metric cards now use display objects for heart rate, SpO2, HRV, and temperature. API detail results remain first priority, but current-day RW cached values from `userStore.healthData/latestMetrics` backfill sparse detail endpoints.
- Homepage pressure sync now remembers an empty SY03 stress result per date for 5 minutes. When the device has already returned no stress records, the page stops repeatedly sending stress history reads during short refresh/onShow loops.
- Parity and release audit now guard the new activity/sleep display fallback and pressure empty-cooldown behavior.

Validation for packaged v211:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,247,501 bytes`
- Headroom: `849,651 bytes`
- Total artifact: `1,533,597 bytes`

Next real-device check:

1. Publish/import `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Test in this order: Activity detail, Sleep detail, Vital Signs main/sub-detail, Homepage pressure/Relax detail.
4. For pressure, expect either real stress records or an empty ACK. Empty ACK means no displayable device pressure data yet; it should no longer spam repeated stress syncs within 5 minutes.
5. If detail query logs show values but UI is blank, continue in the specific card prop mapping. If upload is successful but query remains empty, continue in backend query/summary aggregation.

## v212 update: vital-sign sub-detail cached display fallback

Visible build tag: `rw-visible-build-tag-20260718-262`

Latest real-device log conclusion:

- Homepage already showed RW data except pressure, which means BLE history parsing/upload/query is at least partially working for sleep/activity/vital values.
- Pressure remained absent because the device returned empty stress history ACK (`ab1100035d15050d10`), not because the page lost a known pressure value.
- The remaining symptom was in sub-detail rendering: heart rate, SpO2, HRV, and temperature detail pages still depended on route params or sparse detail API fields, so values already present in `userStore.healthData/latestMetrics` could fail to appear.

v212 changes:

- Added shared `metricFallback.ts` for vital-sign sub-detail pages.
- Heart-rate detail now accepts route/API/store values in a valid 25-240 bpm range and creates a minimal chart point when detail chart data is sparse.
- Blood-oxygen detail now accepts only 70-100% values, so invalid values such as 46% are not promoted into the detail UI.
- HRV detail now accepts 1-300 ms values from API/store fallback.
- Temperature detail now accepts 30-45 values from API/store fallback.
- Parity and release audit now reject fake `ref(56)` defaults and require `withMetricDetailFallback` on all four vital-sign sub-detail pages.

Validation for packaged v212:

- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,247,501 bytes`
- Headroom: `849,651 bytes`
- Total artifact: `1,536,538 bytes`

Next real-device check:

1. Publish/import `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Open Vital Signs main page first, then heart-rate, SpO2, HRV, and temperature sub-detail pages.
4. Copy Mine diagnostics after those pages. If homepage/main page has a value and sub-detail is still blank, inspect `history-page-query-result` plus store snapshot first, not BLE commands.
5. For pressure, continue treating empty stress ACK as "device has no stress record yet" unless a later log shows stress records were parsed but not uploaded/displayed.

## v213 update: vital-sign main-page cached metric range filtering

Visible build tag: `rw-visible-build-tag-20260718-262`

Reason:

- v212 fixed the four vital-sign sub-detail pages, but the Vital Signs main page still used a generic cached metric fallback that accepted any positive value.
- That left a path where an invalid cached SpO2 value such as 46% could still appear on the main Vital Signs page even though the detail page rejected it.

v213 changes:

- Vital Signs main-page fallback helper now supports `min/max` ranges.
- Heart rate fallback is limited to 25-240 bpm.
- Blood oxygen fallback is limited to 70-100%.
- HRV fallback is limited to 1-300 ms.
- Temperature fallback is limited to 30-45.
- Blood pressure fallback parsing is limited to systolic 50-260 and diastolic 30-180.
- Parity and release audit now require these main-page range guards.

Validation for packaged v213:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,247,501 bytes`
- Headroom: `849,651 bytes`
- Total artifact: `1,536,776 bytes`

Next real-device check:

1. Publish/import `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Recheck Vital Signs main page and SpO2 detail page together. If the device/log still contains SpO2 46%, neither main nor detail page should promote it as a valid blood oxygen value.

## v214 update: vital-sign main-page valid-candidate fallback

Visible build tag: `rw-visible-build-tag-20260718-262`

Reason:

- v213 added main-page range checks, but the cached fallback still used first-value selection for some fields.
- If the first cached SpO2 alias contained an invalid value such as 46 while a later alias had a valid value, the invalid first value could block the valid later value from being considered.

v214 changes:

- Added `pickMetricNumber` to the Vital Signs main page.
- Heart rate, SpO2, HRV, and temperature main-page cached fallback now scan all known RW/L19 aliases and use the first value that passes the metric range.
- SpO2 now checks `bloodOxygen`, `bloodOxygenSaturation`, `spo2`, and matching `latestMetrics` aliases before giving up.
- Parity and release audit now require the valid-candidate fallback path.

Validation for packaged v214:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,247,501 bytes`
- Headroom: `849,651 bytes`
- Total artifact: `1,537,240 bytes`

Next real-device check:

1. Publish/import `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. If any SpO2 alias still carries 46 but another alias has a valid 90-100 value, the Vital Signs main page should display the valid value instead of staying blank or showing 46.

## v215 update: vital-sign source and chart data sanitization

Visible build tag: `rw-visible-build-tag-20260718-262`

Latest v210 log read:

- Connection is healthy: connected/ready/storeConnected/userConnected are all true, RW service/command/data characteristics are present, and notify is enabled.
- Sleep history key `0x0505` returned 22 records and uploaded successfully. The backend query then returned sleep summary score `54`.
- Activity/step history keys returned records and uploaded successfully.
- Stress/pressure history key `0x050d` returned an empty RW ACK (`Len=3`, raw `ab1100035d15050d10`), so the pressure page currently has no real historical records to display.
- The "raw sleep" diagnostic key `0x02fe` timed out, but the usable sleep key already returned data; keep raw-sleep as a non-blocking probe.

Reason:

- v214 fixed cached metric selection, but API/detail-page source fields and chart data could still carry invalid values such as SpO2 46.
- Detail pages should not display or plot values that fail the same metric range rules used by the RW/L19 fallback path.

v215 changes:

- `metricFallback.ts` now exports `sanitizeMetricChartData`.
- Vital-sign detail fallback now sanitizes source `chartData` and source `newValue/avgValue/maxValue`.
- If source headline values are empty but source chart data contains a valid latest point, that point can backfill the displayed metric.
- If no valid value exists, invalid source fields are blanked and only sanitized chart points are kept.
- Vital Signs main page now applies the same sanitization to source fields and charts before using fallback values.
- Parity and release audits now require the source/chart sanitization path.

Validation for packaged v215:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,247,501 bytes`
- Headroom: `849,651 bytes`
- Total artifact: `1,538,055 bytes`

Next real-device check:

1. Publish/import `dist/build/mp-weixin`.
2. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
3. Recheck Vital Signs main and detail pages. Invalid SpO2 values such as 46 should not be shown or plotted; if a later valid 90-100 candidate exists, it should be used.
4. For pressure, first confirm the device returns non-empty `0x050d` history. If logs still show `Len=3`, the page has no device-side pressure record to render.

## v216 update: pressure display and backend-only detail pages

Visible build tag: `rw-visible-build-tag-20260718-262`

User direction:

- RW data synchronization should happen on the Awareness home page.
- Detail/business inner pages should query backend APIs directly and must not trigger RW history sync.
- Focus current investigation on pressure/stress data display.

Changes:

- Awareness `getStressInfo` now returns immediately with current backend data. If stress is empty on an RW ring, it starts `syncAwarenessStressHistory` in the background, then re-queries stress detail/summary and refreshes the relaxation chart.
- Added home-page logs: `stress-sync-background-start`, `stress-sync-background-result`, `stress-sync-background-error`, and `stress-sync-dedupe`.
- Sleep, Activity, Relax/Stress, Vital Signs, and vital-sign sub-detail pages no longer call `syncBusinessHistoryPage` or `readLocalData` before backend queries.
- Relax/Stress page now normalizes backend pressure fields from `stressValue`, `avgStressValue`, `stress`, `stressIndex`, `stress_index`, `pressure`, chart data, and cached RW/L19 metrics.
- Pressure chart components now accept alternate backend array fields such as `chartData`, `data`, `list`, `records`, `durationChart`, and `proportionChart`.
- Audits now enforce the new ownership: home page owns RW device sync, inner pages are backend-only.

Validation before packaging:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`

Next validation:

1. Run build and artifact checks for v216.
2. Publish/import `dist/build/mp-weixin`.
3. Confirm copied diagnostics show `rw-visible-build-tag-20260718-262`.
4. On the Awareness page, look for `stress-sync-background-*` logs when pressure is empty.
5. On Relax/Stress detail, logs should show backend `history-page-query-result` only; there should be no detail-page `history-page-sync-start`.
6. If pressure is still blank, compare the Awareness `history-page-upload-result` for `types:["stress"]` with the later `stress-data` / `stress-summary` backend query hints.

Packaged v216 validation:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Current package:

- Path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`
- Main package: `1,248,738 bytes`
- Headroom: `848,414 bytes`
- Total artifact: `1,541,013 bytes`
## v217 - Pressure data focus pass

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,249,962` bytes, with `847,190` bytes headroom under the 2M limit.
- Scope: focused on RW pressure/stress data path only; did not change RW command construction or already verified battery/heart-rate/SpO2 paths.
- Homepage `src/pages/awareness/awareness.vue` now triggers RW pressure history sync on a per-date 5-minute cooldown even when backend already has an old pressure value. It logs `RW HOME / stress-query-snapshot`, `stress-sync-background-start`, `stress-sync-background-result`, and `stress-sync-skip-cooldown`.
- Pressure detail page `src/homeDetail/relaxStatus/relaxStatus.vue` now unwraps backend payloads from `data/result/detail/summary` wrappers, normalizes pressure aliases, and logs `RW PRESSURE / stress-detail-query`, `stress-proportion-query`, and `stress-summary-query`.
- Pressure components `relaxValue.vue`, `pressureRatio.vue`, and `stressSummary.vue` were rewritten to remove visible mojibake and to tolerate pressure aliases such as `stress`, `stressValue`, `avgStressValue`, `stressIndex`, `stress_index`, `pressure`, plus alternate chart fields.
- `useRingBusinessHistoryPageSync.ts` query diagnostics now includes pressure aliases in `valueHints.stress`, so backend query evidence is easier to read in copied logs.
- Validation passed: `npm.cmd run type-check`, `npm.cmd run audit:rw-l19 -- --skip-dist`, `npm.cmd run build:mp-weixin`, `npm.cmd run verify:mp-weixin-artifact`, `npm.cmd run check:mp-weixin-size`, and `npm.cmd run audit:rw-l19`.

Next real-device check:

1. Open homepage after connecting SY03 and wait for `RW HOME / stress-sync-background-result`.
2. Open pressure detail page and copy diagnostics from Mine.
3. Confirm copied logs include `RW PRESSURE / stress-detail-query` with `state.stressValue` and non-zero `stressChartCount` or show which backend endpoint is still empty.

## v219 - Pressure detail backend display diagnostics

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,251,959` bytes, with `845,193` bytes headroom under the 2M limit.
- Total artifact size: `1,547,995` bytes.
- Scope: focused on Relax/Stress detail page display and diagnostics. BLE command construction and already verified RW protocol paths were not changed in this pass.
- Confirmed Relax/Stress detail continues to use `queryHistoryPage` only; it does not call `syncBusinessHistoryPage` or trigger device history sync. Current ownership remains: Awareness home page performs RW history synchronization, inner pages read backend APIs.
- `relaxStatus.vue` now unwraps nested backend payloads from wrappers such as `data`, `result`, `detail`, `summary`, `payload`, `rows`, `list`, and `records`, then summarizes response shape into `RW PRESSURE` logs.
- `relaxValue.vue`, `pressureRatio.vue`, and `stressSummary.vue` now consume pressure aliases and chart aliases more defensively, and visible labels are Chinese only.
- Log analyzer now prints `Business Page Data Flow`, covering `RW HOME` background stress sync events and `RW PRESSURE` backend query events. Use this section first when deciding whether pressure is missing before upload, after backend query, or only in page rendering.

Validation passed:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Next real-device check:

1. Import `dist/build/mp-weixin` and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Connect SY03, stay on Awareness home page until background sync finishes, then open Relax/Stress detail.
3. Copy Mine diagnostics. In analyzer output, check `Business Page Data Flow`:
   - If `RW HOME / stress-sync-background-result` has zero submitted records, continue checking device-side stress history.
   - If upload/submission is non-zero but `RW PRESSURE / stress-detail-query` response has no stress hints, continue in backend pressure query/aggregation.
   - If `RW PRESSURE` response has stress hints but `state.stressValue` or chart counts are empty, continue in Relax/Stress frontend field mapping.

## v220 - Business detail sync boundary and release verifier cleanup

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,251,959` bytes, with `845,193` bytes headroom under the 2M limit.
- Total artifact size: `1,547,995` bytes.
- Removed the stale commented `readLocalData(false)` path from `src/homeDetail/vitalSigns/vitalSigns.vue`.
- Tightened `audit-rw-l19-parity.mjs` so Sleep, Activity, Relax/Stress, and Vital Signs detail pages fail audit if they contain `readLocalData`, `syncBusinessHistoryPage`, or `allowRwDeviceSync: true`.
- Updated `src/pages/businessHistoryPageSync.parity.ts` from the old `lastAwarenessEmptyStressSyncAtByDate` expectation to the current home-owned pressure sync flow: `lastAwarenessStressSyncAtByDate`, `stress-query-snapshot`, `stress-sync-background-start/result`, and `stress-sync-skip-cooldown`.
- This pass did not change RW BLE commands or page data mapping. It makes the release gate and business-page ownership match the current goal: home page performs RW device sync; inner pages read backend data.

Validation passed:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Next real-device check:

1. Import `dist/build/mp-weixin` and confirm copied Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Connect SY03, wait on Awareness home page for background business sync.
3. Open Sleep, Activity, Vital Signs, and Relax/Stress detail pages.
4. Copy Mine diagnostics and analyze `Business Page Data Flow` plus each `history-page-query-result`.
5. If a detail page is blank, decide by evidence:
   - no home upload or submitted records: continue device/history sync investigation;
   - upload OK but backend query empty: continue backend storage/query aggregation;
   - backend query has values but page state/render is empty: continue frontend field mapping.

## v220 backend addendum - Pressure query proof in admin_fastapi

- Backend path: `E:\qkeer\code\wechatAdmin\admin_fastapi`.
- Updated `app/api/app.py` so `stress_chart()` formats `record_time` safely when the DB driver returns either `datetime` objects or strings. This keeps `/app/data/stress/stressDetail` and `/app/data/stress/stressSummary` chart output stable for RW/L19 records.
- Extended `scripts/verify_rw_health_sync.py` to prove RW-style stress samples are queryable through the backend pressure path after sync:
  - `stressAvg` is calculated in daily summary.
  - `stress_records()` returns the synced rows.
  - `stress_chart()` returns frontend-ready `time/value` points.
  - `stress_counts()` returns Chinese pressure buckets: `閺€鐐緱`, `濮濓絽鐖禶, `娑擃厾鐡慲, `閸嬪繘鐝甡.
  - `healthLevel` remains one of the expected Chinese values.
- The same backend verifier now also proves RW-style vital samples are visible through the L19-compatible detail response helper:
  - heart-rate detail returns `newValue`, `avgValue`, and `chartData`.
  - SpO2 detail returns `newValue`, `avgValue`, and `chartData`.
  - HRV detail returns `newValue`, `avgValue`, and `chartData`.
  - temperature detail returns `newValue`, `avgValue`, and `chartData`.

Validation passed:

- `E:\qkeer\code\wechatAdmin\admin_fastapi\.venv\Scripts\python.exe scripts\verify_rw_health_sync.py`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run type-check`

Next pressure verdict:

- If a v220 real-device log shows `RW HOME / stress-sync-background-result` with submitted stress records but `/data/stress/*` query summaries are empty, inspect deployed backend version first and ensure this admin_fastapi change is deployed.
- If backend query summaries include stress chart/value hints but the page is blank, continue in frontend pressure field mapping.

## v221 - Sleep-only sync success and backend count diagnostics

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,252,189` bytes, with `844,963` bytes headroom under the 2M limit.
- Total artifact size: `1,548,225` bytes.
- Backend path: `E:\qkeer\code\wechatAdmin\admin_fastapi`.
- `app/api/app.py` now routes `/app/data/sync` through `sync_ring_data_records()`, which counts health raw rows and sleep segment rows separately.
- Pure sleep segment uploads that only create `sleep_record` rows now return success instead of being counted as failed health rows. The response payload includes `success`, `count`, `healthCount`, `sleepCount`, `failCount`, and `touchedDates`.
- `scripts/verify_rw_health_sync.py` now proves a sleep-only RW/L19 payload with `startTime`, `sleepState`, `sleepDuration`, and `dateRef` writes to `sleep_record`, returns `sleepCount=1`, `healthCount=0`, `failCount=0`, and touches the selected sleep business date.
- Frontend `useRingBusinessHistoryPageSync.ts` now logs backend submit payload counts as `payloadHealthCount`, `payloadSleepCount`, `payloadFailCount`, and `payloadTouchedDates`.
- `scripts/analyze-rw-ble-log.mjs` now prints those backend submit counts in history upload lines, so sleep-only uploads are visible in copied diagnostics.

Validation passed:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:rw-backend-health`
- `E:\qkeer\code\wechatAdmin\admin_fastapi\.venv\Scripts\python.exe scripts\verify_rw_health_sync.py`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Next sleep verdict:

- Import v221 and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
- After entering Sleep page, copy Mine diagnostics.
- In analyzer output, look for backend submit bits like `payloadCount=1 healthCount=0 sleepCount=1 failCount=0 touchedDates=2026-..`.
- If `sleepCount > 0` and the sleep detail query is still empty, inspect deployed backend version and sleep query/date aggregation.
- If `submitRecordCount > 0` but `sleepCount=0` and `failCount>0`, inspect frontend submitted record shape.

## v223 - Compact Mine diagnostics and sleep open-session summary

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,255,510` bytes, with `841,642` bytes headroom under the 2M limit.
- Total artifact size: `1,553,502` bytes.
- The latest real-device log that triggered this round was still from a v222 package. The source and release artifact now remain on v223.
- Mine copied diagnostics now trims already-validated OK traffic:
  - protocol report raw hex is shortened and keeps `rawLen`;
  - raw log tail keeps failures, decisions, summaries, page sync, home sync, backend query/upload, and parsed business data;
  - noisy OK BLE tx/rx and parsed-accepted entries are filtered from the copied tail.
- RW sleep parser now emits a whole-session summary when SY03 returns SDK sleep segment events without an explicit sleep-end marker. This prevents the UI from treating the final short segment as the whole night's sleep.
- Sleep history sync now runs the RW time preflight before the primary AB sleep read, so sleep timestamps are normalized against device time before upload/query.
- Awareness home business sync now includes `temperature` in the vital batch with heart rate, SpO2, HRV, pressure, and blood sugar.
- Detail diagnostics now include alias hints for `bloodOxygen`/`blood_oxygen`, `hrv`/`heart_rate_variability`, and temperature aliases such as `bodyTemperature`, `body_temperature`, and `skin_temperature`.

Validation passed:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run audit:rw-l19`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`

Next real-device check:

1. Import `dist/build/mp-weixin` and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Clear diagnostics, connect SY03, and stay on Awareness home page until `RW HOME / business-sync-background-result` appears.
3. Open Sleep detail, Vital Signs main/sub-detail pages, and Relax/Stress detail.
4. Copy Mine diagnostics. The key decision points are `RW HOME business-sync-*`, `RW PAGE history-page-sync-result`, `history-page-upload-result`, and `history-page-query-result`.
5. If pressure/emotion, SpO2, temperature, or HRV are still blank, classify the failure by evidence:
   - no device records submitted: continue RW history command/parser work;
   - submitted but backend query empty: inspect backend storage/query aggregation;
   - backend query has values but page blank: inspect frontend detail field mapping.

## v224 - RW detail pages avoid automatic BLE and backend accepts RW skin temperature

- Build tag: `rw-visible-build-tag-20260718-262`.
- Frontend path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next`.
- Backend path: `E:\qkeer\code\wechatAdmin\admin_fastapi`.
- Vital Signs detail entry no longer runs automatic BLE restore / `refreshHealthData()` for RW on page show or pull-down refresh. RW keeps the intended flow: Awareness home owns device history sync, detail pages query backend only.
- L19 behavior is unchanged: non-RW devices still use the BLE refresh path on Vital Signs page show and pull-down refresh.
- Backend `/app/data/sync` temperature range now accepts `25.0-45.0`, matching RW parser/frontend upload behavior. This prevents valid low skin-temperature values, such as `28.6`, from being dropped before `/app/data/bodyTemperature/bodyTemperatureDetail` can query them.
- Backend `temperature_celsius()` also accepts `25-45`, so detail aggregation treats those stored values as Celsius.

Validation passed before release build:

- `E:\qkeer\code\wechatAdmin\admin_fastapi\.venv\Scripts\python.exe scripts\verify_rw_health_sync.py`
- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`

Next real-device check:

1. Import `dist/build/mp-weixin` after the v224 build and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Clear diagnostics, connect SY03, stay on Awareness home until `business-sync-background-result` appears.
3. Open Vital Signs main page and sub-detail pages. They should no longer wait on RW BLE auto-refresh; copied logs should mainly show backend `history-page-query-result`.
4. For temperature specifically, if `history-page-upload-result.submitRecordSample` includes a `temperature` between `25` and `30`, backend should now retain it instead of dropping it.
5. For pressure/emotion, the first decision point is still whether AB key `0x050d` returns non-empty records. If it remains `Len=3`, the blank page is caused by no stress history data from the device, not page rendering.

## v225 - History sync diagnostics preserve RW source details

- Build tag: `rw-visible-build-tag-20260718-262`.
- Release package: `dist/build/mp-weixin`.
- Main package size after build: `1,257,807` bytes, with `839,345` bytes headroom under the 2M limit.
- Total artifact size: `1,555,809` bytes.
- Latest user log `b6fab74c-6f93-4283-9362-8ba430892ccc/pasted-text.txt` was still from v223, not v224/v225. It nevertheless showed a useful state split: `diagnostic-copy` had SY03 connected and notify-ready, but `history-page-sync-result` for the Awareness vital batch returned `status=empty`, `records=0`, and no upload. That means blank detail pages are currently more likely caused by "no device records uploaded" than by detail-page rendering.
- `useRingBLE.readLocalData()` now detects RW through multiple compatible sources: current SDK device, ring store device, and bound device. This avoids treating a ready RW ring as legacy when one runtime object is temporarily stale or missing `protocol`.
- RW history queue diagnostics now include `protocol` and `adapterProtocol`, making it easier to see if a future empty result accidentally ran through a stale adapter.
- `useRingBusinessHistoryPageSync.ts` now logs a compact `result` object on `history-page-sync-result` and `history-page-upload-skip`, including `parsed.status`, `sourceType`, `packetShape`, `recordCount`, `sourceResponseCount`, and sample `sourceResponses`.
- Mine copied history diagnostics now preserves that compact `result` field, so future screenshots/log copies should show whether an empty sync came from AB health keys, native file/list fallback, legacy fallback, or no parsed protocol result.

Validation passed:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run analyze:rw-log -- "C:\Users\Administrator\.codex\attachments\b6fab74c-6f93-4283-9362-8ba430892ccc\pasted-text.txt"`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Next real-device check:

1. Import `dist/build/mp-weixin` after the v225 build and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Clear diagnostics, connect SY03, stay on Awareness home until the background sync finishes.
3. Copy Mine diagnostics. Focus first on `history-page-sync-result.result.packetShape`, `sourceResponseCount`, and `sourceResponses`.
4. If `packetShape=ab_health_key` and `sourceResponses` show empty AB keys for stress, HRV, temperature, or SpO2, continue protocol/parser work for those exact keys.
5. If records are non-zero but upload is missing or backend query is empty, switch investigation to upload/backend aggregation.

## v226 - RW vital alias persistence and skin-temperature detail display

- Build tag: `rw-visible-build-tag-20260718-262`.
- Backend `/app/data/sync` now accepts RW/frontend aliases for HRV (`heartRateVariability`, `hrvValue`, `rmssd`), SpO2 (`bloodOxygen`, `bloodOxygenSaturation`, `oxygen`), skin/body temperature (`skinTemperature`, `bodyTemperature`, `bodyTemp`, `temp`), stress/pressure, heart rate, and blood sugar. This is a defensive fix for the case where the device/parser already returned data but the backend only recognized the canonical field name.
- Temperature detail frontend fallback now uses `25-45` instead of `30-45`, matching the backend and RW parser so low skin-temperature values such as `28.6` are not filtered out before display.
- Local history cache metric identity now recognizes the same RW aliases for blood oxygen, HRV, temperature, stress/pressure, heart rate, and blood sugar. This prevents same-time vital records from being misclassified during local dedupe.
- Added backend verification for `bloodOxygenSaturation`, `skinTemperature`, `heartRateVariability`, and `pressureValue`, plus frontend parity coverage for same-time alias dedupe.

Next real-device check:

1. Import `dist/build/mp-weixin` after the v226 build and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. On Awareness home, wait for the background sync to complete before opening detail pages.
3. If homepage has HRV/SpO2/temperature/stress values but details are still empty, copied Mine logs should now identify whether records were uploaded and whether backend detail queries returned chart rows.

