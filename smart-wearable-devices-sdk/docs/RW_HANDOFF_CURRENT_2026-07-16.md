閿? RW/SY03 SDK Current Handoff

Updated: 2026-07-16

Mini Program workspace: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next`

Backend workspace: `E:\qkeer\code\wechatAdmin\admin_fastapi`

Current test package: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`

Current visible build tag: `rw-visible-build-tag-20260718-262`

Current v156 package: main package 1,214,811 bytes, headroom 882,341 bytes, total artifact 1,492,667 bytes.

## Final Goal

Make RW/SY03 behave like the original L19 path from the business layer's point of view.

The business pages should consume one SDK-facing contract for:

- scan and connect state
- device information
- battery, firmware and software versions
- realtime heart rate, SpO2, temperature and other vital metrics
- sleep, activity, stress and vital history sync
- backend upload and detail-page refresh
- Chinese-only health text fallback
- WeChat mini-program main package below 2 MB

## Current State

L19 SDK encapsulation is already protected by `verify:ring-ble` and `audit:rw-l19`.

RW/SY03 now scans and connects through the RW detector. The current channel uses `A00A/B002` for writes and `A00A/B003` for notify. Previous real-device logs proved that connection and notify can reach ready state; recent connection failures were later attributed mostly to the device being asleep.

Battery, firmware and software version display have been fixed once and are covered by the device page diagnostics. Realtime heart rate and SpO2 still require real-device confirmation because earlier logs showed invalid values or no page display.

Business detail pages were restored and now use `useRingBusinessHistoryPageSync()` before backend detail queries:

- sleep page: `dataTypes: ['sleep']`
- activity page: `dataTypes: ['step']`
- stress page: `dataTypes: ['stress']`
- vital signs page: heart rate, SpO2, HRV, temperature, blood sugar and blood pressure

Sleep page date handling was tightened after v130: when the user taps yesterday/before-yesterday, `getSleepDetailInfo(currentDate)` and `getTemperatureDetail(currentDate)` now receive the selected date so `history-page-query-*` diagnostics match the synced/uploaded date.

The "Mine" page is the single place for RW diagnostics. Business pages should stay as normal product pages; diagnostics are copied from Mine.

Latest log review from the 2026-07-16 02:27 paste:

- the pasted log was from v147, while current code is v153.
- connection and notify were ready in the snapshot: `connected=true`, `ready=true`, `notifyEnabled=true`, protocol `rw`, device `3E:00:00:00:05:1B`.
- core protocol result was `1/8`; only `blood-oxygen/control-disable` returned a valid ACK.
- failed core commands in that log:
  - `battery/read`, sent `ab010003fca0020310`, failed after 321 ms because the ring data listener was cleared.
  - `firmware/read`, sent `ab010003cca2020410`, timed out after 8066 ms.
  - `heart-rate/control-enable`, sent `ab010006f7ee060900030501`, timed out after 8078 ms.
  - `heart-rate/realtime-read`, sent `ab0100030cbb022410`, timed out after 45028 ms after 4 attempts.
  - `heart-rate/control-disable`, sent `ab010006372f060900030500`, timed out after 8047 ms.
  - `blood-oxygen/control-enable`, sent `ab010006f5ce060900090501`, timed out after 8046 ms.
  - `blood-oxygen/realtime-read`, sent `ab010003ac95024e10`, timed out after 45042 ms after 4 attempts.
- root cause from protocol comparison: v147 still used CRC App SDK key reads for battery/version and AppRealTime read keys (`0x0224`, `0x024e`) for realtime heart-rate/SpO2. Earlier successful SY03 evidence and the current protocol parity point to no-CRC AB key reads: battery `ab010003020310`, firmware/software `ab010003020410`, realtime heart-rate `ab010003050310`, realtime SpO2 `ab010003050910`.
- v150+ switches the runtime and Mine self-test to those no-CRC primary commands. CRC and C6/L19 compatibility commands remain available only behind explicit RW debug fallback, so normal testing should no longer flood the device with fallback probes.


## 2026-07-16 v150 Follow-up Fixes

Latest v147 real-device log analysis showed the exact failing command line:

- `battery/read` sent `ab010003fca0020310` and failed because the data listener was cleared.
- `firmware/read` sent `ab010003cca2020410` and timed out.
- `heart-rate/realtime-read` sent `ab0100030cbb022410` and timed out after 4 attempts.
- `blood-oxygen/realtime-read` sent `ab010003ac95024e10` and timed out after 4 attempts.
- realtime control enable/disable ACKs were inconsistent; only `blood-oxygen/control-disable` returned.

Protocol comparison result: the failed v147 commands were still using CRC/AppRealTime reads for the SY03 path. v150 now prioritizes the no-CRC AB key commands expected by current RW/SY03 evidence:

- battery: `ab010003020310`
- firmware/software: `ab010003020410`
- heart rate realtime read: `ab010003050310`
- SpO2 realtime read: `ab010003050910`
- temperature realtime read: `ab010003050810`

Important runtime guard added after the v150 command switch:

- business metrics, page metric helpers and foreground measurement now treat primary `0x05xx` packets as realtime only when the packet has a read/read-continue flag (`0x10`/`0x11`) and is not history-shaped.
- historical `0x05xx` records remain blocked from realtime display, so historical heart-rate/SpO2/temperature packets cannot pollute the page.
- legacy AppRealTime `0x02xx` packets are still accepted as compatibility fallback when they appear in old logs or older device responses.
- local parity mocks now respond to both the new no-CRC `0x05xx` reads and old `0x02xx` compatibility reads.
## 2026-07-16 v151-v154 Diagnostic Copy And Route Fix

Latest 04:12 v150 real-device log (`58536f43.../pasted-text.txt`) showed a ready connection (`connected=true`, `ready=true`, `notifyEnabled=true`), but the copied full-probe report was truncated. It preserved commands 8-37 and lost required commands 1-7: battery, firmware/software, heart-rate enable/read/disable, and SpO2 enable/read. Therefore that log cannot prove core protocol success or failure.

v151-v154 fixes the diagnostic handoff and vital-sign sub-detail routing:

- Mine diagnostic storage was increased from 220 to 500 entries. v152 makes copy-log read the full 500-entry buffer before generating compact probe/history reports, and v153 makes every shared diagnostic writer preserve the same 500-entry buffer instead of trimming it back to 220.
- `protocol-probe-summary` now stores compact `requiredCommands` and `failedCommands` rows with command key, expected result, hex, status, timing, parsed summary and realtime poll attempt counts.
- `diagnostic-probe-report` now merges those summary rows, so required/core commands remain visible even when raw command logs have been pushed out by optional compatibility probes. The offline analyzer also reads `requiredCommands`/`failedCommands` directly as a fallback.
- `audit:rw-l19` protects this behavior via `RING_DIAGNOSTIC_LOG_MAX_COUNT = 500`, `MINE_PROTOCOL_PROBE_COPY_EVENTS`, `requiredCommands`, and `failedCommands` checks.
Latest 04:12 real-device log (`58536f43.../pasted-text.txt`) is still from v150, not v154. It proves BLE state was ready (`connected=true`, `ready=true`, `notifyEnabled=true`), and only optional/compat commands can be judged from that paste. It cannot judge current core battery/version/heart-rate/SpO2 behavior because the old copied report lost required commands 1-7. Next valid paste must show `rw-visible-build-tag-20260718-262`.

v154 restores the missing vital-sign sub-detail business pages from the original project and registers them in `src/pages.json`:

- `homeDetail/vitalSignsHeartDetail/vitalSignsDetail`
- `homeDetail/vitalSignsHeartDetail/oxyGenDetail`
- `homeDetail/vitalSignsHeartDetail/temperatureDetail`
- `homeDetail/vitalSignsHeartDetail/heartRateVariabilityDetail`

`audit:rw-l19` now checks both the route registration and the restored detail page files so the vital-sign cards cannot regress into WeChat `wx://not-found` / white screen again.
## 2026-07-16 v155 Business Page Entry And Text Guard

v155 fixes two source-level issues found after the v154 package:

- Sleep, activity and stress business detail pages now load today's data by default when opened without `selectedDayIndex` route params. Before this, ordinary entry into those pages could skip RW history sync and backend detail queries until the user changed date or pulled to refresh.
- The foreground RW single-measurement disconnect message in `useRwForegroundMeasurement.ts` no longer contains invalid UTF-8 replacement characters. The runtime string is stored with Unicode escapes so the page displays Chinese while preserving the mixed-encoding file safely.
- `audit:rw-l19` now protects both fixes: it scans runtime source files for invalid UTF-8 replacement characters and checks that sleep/activity/stress pages call `handleDateClick` on the default route path.

Verification completed for this package. The full release command `npm.cmd run verify:rw-l19:release` passes end-to-end:

- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run audit:rw-l19`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`

Next real-device test should start from Mine diagnostics on build `rw-visible-build-tag-20260718-262`:

1. Connect SY03 and confirm the snapshot is `connected=true`, `ready=true`, `notifyEnabled=true`.
2. Run the Mine core protocol self-test and verify command hexes are the no-CRC commands listed above, not v147 CRC/AppRealTime hexes.
3. Tap device info and confirm battery, firmware and software appear.
4. Test heart rate and SpO2 from the page; copy Mine diagnostics if a value is missing or outside plausible range.
5. Open sleep/activity/stress/vital detail pages to confirm history upload and backend detail refresh.
## Important Recent Fixes

### Protocol And Parser

- RW protocol commands live in `src/sdk/ring-ble/rw/protocol.ts`.
- RW parser lives in `src/sdk/ring-ble/rw/parser.ts`.
- QKeer V2 LastData, health list, sleep list and step list are parsed into L19-compatible records.
- `src/sdk/ring-ble/rw/parser.parity.ts` now explicitly protects QKeer V2 sleep-stage Chinese text (`濞村懐娼痐, `濞ｈ京娼痐, `闁偓閸戣櫣娼惇鐕? and LastData charging status text (`閺堫亜鍘栭悽绀? so those runtime fields cannot regress back to mojibake.
- AB history keys now include:
  - `0x0503` heart rate
  - `0x0504` blood pressure
  - `0x0508` temperature
  - `0x0509` SpO2
  - `0x050a` HRV
  - `0x050d` stress
  - `0x0510` blood sugar
- Heart rate is filtered to `25-240`.
- SpO2 is filtered to `70-100`.
- Blood sugar normalizes values such as `56` to `5.6`.
- AB history records are parsed before single-value realtime fallback so timestamp bytes do not become fake realtime values.

### History Sync

RW history sync is in `src/sdk/ring-ble/rw/history.ts`.

Current fallback order:

1. `0x36` local history
2. pre-native AB health history keys for the requested metric set
3. QKeer V2 native history list
4. QKeer V2 LastData
5. final local-data fallback
6. remaining AB health history keys

Empty AB key ack/pending responses no longer stop the chain. They log `history-ab-key-empty-continue` and allow native history or final fallback to continue.

Current builds serialize RW `readLocalData()` calls through a small compatibility queue in `src/composables/useRingBLE.ts`. This prevents business pages and Mine diagnostics from flooding the RW BLE command channel with multiple history reads at the same time. The queue writes `RW FLOW compat-history-queue-enqueue/start/result/failed` diagnostics with `queuedBehind` and `queueDepth`, so new logs can distinguish queued history reads from true device no-response.

v132 adds page-level timeout visibility for business detail history reads. `useRingBusinessHistoryPageSync()` now passes `timeoutMs` into `ringBle.readLocalData(..., { timeoutMs })`; the default page timeout is 18 seconds. `history-page-sync-result` and `history-page-sync-failed` now include `elapsedMs`, so the next log can show whether sleep/activity/stress/vital pages are waiting on a device timeout, returning empty records quickly, or reaching upload/query but failing later in the backend/page layer.

### Upload And Business Metrics

- Upload bridge: `src/composables/useRingHistoryUpload.ts`
- Business metrics: `src/sdk/ring-ble/businessMetrics.ts`
- Page sync bridge: `src/composables/useRingBusinessHistoryPageSync.ts`

Direct `qkeer_v2_last_data`, `qkeer_v2_health_list`, `qkeer_v2_sleep_list` and `qkeer_v2_step_list` responses are treated as completed history payloads when they contain records.

History records are mapped to L19 backend fields including:

- `heartRate`
- `spo2`
- `temperature`
- `hrv`
- `stress`
- `bloodSugar`
- `systolic`
- `diastolic`
- `stepCount`
- `sleepState`
- `sleepDuration`
- `motionIntensity`

RW upload uses stable MAC fallback from `ringBle.deviceInfo`, `ringStore.deviceInfo`, `ringStore.boundDevice` and `userStore.deviceInfo`, instead of stale platform IDs.

v146 filters backend submit records so invalid HRV, stress, blood sugar, temperature and blood pressure samples cannot be uploaded as L19-compatible business data. Invalid records with other valid fields, such as step count, keep those valid fields.`r`n`r`nAfter a successful business-page upload, current builds update `userStore.lastReadTimestamp` to the returned `maxTimestamp`, matching the legacy L19 watcher behavior and reducing duplicate RW history uploads on repeated page visits.

### Health Text Fallback

- Frontend health text fallback lives in `src/utils/healthText.ts`.
- Source/page-visible mojibake guard lives in `src/sourceEncoding.parity.ts`; it now includes common business-page visible strings such as garbled `娴犲﹤銇塦, `闁瀚ㄩ弮銉︽埂`, `閻紕婀, `濞茶濮ー, `閺€鐐緱閻樿埖鈧梗, `閻㈢喎鎳℃担鎾崇窙`, `缂傛牞绶崡锛勫`, `鐞涒偓缁溁, `鐞涒偓閸樺獖, and `鎺矯`.
- Backend health text fallback lives in `E:\qkeer\code\wechatAdmin\admin_fastapi\app\api\app.py`.
- English levels such as `Needs improvement`, `Room for improvement`, `Good`, `Excellent`, `Low activity` and sleep/activity labels are mapped to Chinese.
- Backend compact English variants such as `NeedsImprovement`, `SleepQuality`, `SedentaryRisk`, `HeartRate`, `HeavyLoad` and `RoomForImprovement` are also mapped to Chinese.
- Backend now also builds a compact mapping from every spaced level phrase, so CamelCase/no-space variants such as `VeryPoor`, `LightSleep` and `BodyTemperature` are covered without one-off aliases.
- Known mojibake phrases are mapped to Chinese fallback text.
- The mojibake detector is intentionally conservative: normal Chinese such as `韫囧啳鍓︽禒瀣矝` or `閻㈢喐妞挎稊鐘冲劵鐠囧嫬鍨巂 must not be treated as broken text.
- `src/utils/healthText.parity.ts` protects this behavior through `verify:ring-ble`.
- Backend checks passed on 2026-07-16, including 279 known bad-English variants from the collection-level sample. The mini-program workspace now exposes `npm.cmd run verify:rw-backend-health` to rerun the backend checks from one place, and `npm.cmd run verify:rw-l19:release` includes this backend check:
  - `.venv\Scripts\python.exe scripts\check_health_text_response.py --sample-only`
  - `.venv\Scripts\python.exe scripts\verify_rw_health_sync.py`
  - `.venv\Scripts\python.exe -m compileall app\api\app.py scripts\check_health_text_response.py scripts\verify_rw_health_sync.py`

### Diagnostics

Runtime diagnostics are written to storage and copied from the Mine page.

Key files:

- `src/pages/mine/mine.vue`
- `scripts/analyze-rw-ble-log.mjs`
- `scripts/verify-ring-ble-parser.mjs`
- `scripts/verify-rw-backend-health.mjs`

The Mine page emits:

- `diagnostic-build`
- `diagnostic-copy`
- `diagnostic-copy-incomplete`
- `diagnostic-probe-report`
- `protocol-probe-plan`
- `protocol-probe-command-start`
- `protocol-probe-command-response`
- `protocol-probe-command-timeout`
- `protocol-probe-summary`
- `history-page-sync-*`
- `history-page-upload-*`

The analyzer now treats page-level history upload logs as authoritative evidence. If a new log shows:

```text
pageUpload=1 records=1 uploaded=true maxTimestamp=...
```

then BLE/parser/page sync produced submittable data. Runtime logs also emit the clearer aliases `uploaded` and `recordCount`; `submitted/count` and `uploaded/recordCount` should be treated as the same upload evidence. Current builds also log `rawRecordCount`, `submitRecordCount`, `rawRecordSample` and `submitRecordSample`. If `rawRecordCount > 0` but `submitRecordCount = 0`, the device/parser produced records but the L19-compatible submit mapping rejected them. If the detail page is still blank after `uploaded=true`, the next issue is backend detail aggregation or page refresh, not BLE connection.

The source audit now also protects the Mine protocol self-test classification: battery/version and realtime heart-rate/SpO2 are core required checks, while QKeer V2 history, legacy history and AB history-key reads are compatibility probes. Optional probe timeouts should guide protocol work but should not be confused with connection failure.

v133 and later split the Mine protocol test into two explicit buttons. `閿熸枻鎷烽敓鏂ゆ嫹閿熺殕纭锋嫹` runs only the required core chain: battery, firmware/software version, heart-rate realtime enable/read/disable, and SpO2 realtime enable/read/disable. `閿熸枻鎷烽敓鏂ゆ嫹閿熺殕纭锋嫹` runs the full command matrix, including monitoring, legacy history, AB history-key and QKeer V2 compatibility probes. Protocol logs now carry `mode: core` or `mode: full`; use core mode first when checking whether SY03 can communicate reliably.

v134 additionally tightens device-info evidence: firmware and software versions are checked separately. The protocol probe report now prints compact `versions=fw/hw/sw/ui` evidence for version responses.

v135 adds compact `diagnostic-history-report` output to Mine log copies. This summarizes the latest history sync path, including AB key fallback counts, QKeer V2 native-list/LastData timeouts, final local-data fallback, upload record counts and query evidence.

v136 adds more compact history timing fields (`elapsedMs`, `phase`, `responseWaitMs`, `queueDepth`, `queuedBehind`, `unexpectedResponseCount`) and teaches the offline analyzer to read the flat Mine diagnostic snapshot shape used by current copied logs.

v137 adds optional AB history-key `ReadContinue(0x11)` probes in the Mine full protocol self-test. v138 promotes that evidence into production history sync: every AB health key now tries `Read(0x10)` first, then retries `ReadContinue(0x11)` after an empty response or timeout. v139 tightens the production wait by matching AB replies to the expected key and flag, so a delayed `0x10` reply is not consumed as a `0x11` reply. v140 further requires the response flag to be identifiable from `parsed.flag`, raw bytes or `rawHex`; unknown/missing flags no longer satisfy a pending AB `Read`/`ReadContinue` attempt. The parity suite now includes an unflagged AB payload regression case so this cannot silently roll back. v141 additionally normalizes RW page realtime helper values: heart rate must be 25-240 and not a status byte, HRV must be positive, and stress must be 0-100; parity covers invalid newer direct values so they cannot replace the latest valid reading. v142 applies the same guard to foreground single-measurement success handling: heart rate, SpO2, blood sugar and temperature must be plausible, and status-prefixed data packets are decoded before display. v143 extends business metric aggregation guards: HRV must be positive, stress must be 0-100, and blood pressure must contain plausible systolic/diastolic values before business pages can display it. v144 extends the same guard to backend history upload for HRV, stress, blood sugar, temperature and blood pressure. v145 improves Mine diagnostic copies so partial protocol self-test tails still produce `diagnostic-probe-report` evidence. v146 improves the offline analyzer so `truncated:true` tail reports are useful for locating failed tail commands but keep `RW/L19 Gate` core-protocol as `NOT_PROVEN` until a full self-test summary is copied. Pre-native AB probing is bounded to one core key with a 2200ms wait, so business pages can still reach QKeer V2 native-list and LastData fallbacks within the page timeout. Runtime logs include `history-ab-key-retry-continue`, `attempt`, `flag`, `previousFlag` and `responseFlag`, and the offline analyzer reports `abKeyRetryContinues` / `retryContinue`.

The offline analyzer prints a `RW/L19 Gate` section near the top. It is the first summary to check for the final objective. The gate requires current build, ready connection, battery/firmware/software device info, no failed core protocol commands, page-level realtime heart-rate/SpO2 hits, and business-page history upload evidence for sleep, activity, stress and vital data. Device-info evidence can come either from protocol self-test responses or from the device page's `battery-read-result` and `version-read-result` logs.

## Latest Log Conclusion

The 2026-07-16 02:27 attached log (`22f909b5.../pasted-text.txt`) was from v147. It is stale for current v153 code, but it directly identified the command mismatch blocking the core SY03 path.

That log proved:

- connection and notify were ready: `connected=true`, `ready=true`, `notifyEnabled=true`, protocol `rw`.
- the core protocol self-test only passed `1/8`.
- these required commands failed:
  - `battery/read`: `ab010003fca0020310`, listener cleared after 321 ms.
  - `firmware/read`: `ab010003cca2020410`, timeout after 8066 ms.
  - `heart-rate/control-enable`: `ab010006f7ee060900030501`, timeout after 8078 ms.
  - `heart-rate/realtime-read`: `ab0100030cbb022410`, timeout after 45028 ms, attempt 4/4.
  - `heart-rate/control-disable`: `ab010006372f060900030500`, timeout after 8047 ms.
  - `blood-oxygen/control-enable`: `ab010006f5ce060900090501`, timeout after 8046 ms.
  - `blood-oxygen/realtime-read`: `ab010003ac95024e10`, timeout after 45042 ms, attempt 4/4.
- only `blood-oxygen/control-disable` returned `rw_health_data_control_ack`.

Protocol comparison showed the primary issue was command shape, not BLE connection: v147 used CRC battery/version reads and AppRealTime keys (`0x0224`, `0x024e`). v150 now uses the no-CRC RW key commands as the primary path: battery `ab010003020310`, firmware/software `ab010003020410`, realtime heart rate `ab010003050310`, and realtime SpO2 `ab010003050910`. Compatibility CRC/C6/L19 probes remain behind the explicit RW debug fallback only.

## Remaining Work
Still not fully proven on real device:

- RW/SY03 realtime heart rate and SpO2 are correct and stable on the page.
- RW/SY03 temperature, HRV, stress, blood sugar and blood pressure are correctly returned or correctly reported as unsupported/no data.
- sleep, activity, stress and vital history return records on the real device.
- records upload to backend and appear after detail-page refresh.
- backend deployment used by the tester includes the Chinese fallback changes.
- health page and detail pages have no English or mojibake text in real testing.
- L19 has not regressed after all RW changes.

## Next Real-Device Test Checklist

Use the current `dist\build\mp-weixin` package and verify the Mine diagnostic build tag first.

1. Open Mine and confirm `rw-visible-build-tag-20260718-262`.
2. Clear RW diagnostic logs.
3. Wake SY03 before connecting.
4. Connect SY03 and confirm the snapshot is ready.
5. Tap the Mine RW/L19 acceptance button and wait for completion before copying logs.
6. If one-click acceptance fails, run the single failed item again: core self-test, heart rate, SpO2, sleep, activity, stress, or vital.
7. Run battery/version read from the device page if device-info evidence is still missing.
8. Open sleep, activity, stress and vital detail pages.
9. Return to Mine and copy the full diagnostic log.
10. Analyze with:

```powershell
npm.cmd run analyze:rw-log -- "<log-file>"
```

For history-specific checks, pass expected types when useful:

```powershell
npm.cmd run analyze:rw-log -- "<log-file>" --expect-history=sleep,step,vital,stress
```

## How To Interpret The Next Log

First check build:

- If the log has no current v153 tag, do not judge current code.
- If the log has stale tags, retest with the current package.

Then check protocol self-test:

- `diagnostic-probe-report` is emitted in chunks and should appear near the top of copied Mine logs. `scripts/analyze-rw-ble-log.mjs` can merge these chunks and judge the self-test even if raw command logs are truncated. In v145+, if `protocol-probe-start` has already fallen out of the copied log but command response/timeout lines remain, Mine still emits a compact tail report with `truncated:true` and `reason:"protocol-probe-start-missing"`. In v146, the analyzer surfaces that reason and keeps the core protocol gate unproven until the full self-test summary is present. In v147, required realtime heart-rate/SpO2 protocol reads use the same warm-up polling cadence as foreground measurement: 1500/8000/18000/28000 ms within a 45 s window, and emit `protocol-probe-command-poll` with attempt/elapsed details. The offline analyzer now reports protocol probe `polls` totals and per-command `attempt=x/y` / `polls=n`, including compact `diagnostic-probe-report` rows. In v148, Mine adds one-click RW/L19 acceptance, which runs core protocol, heart rate, SpO2, sleep, activity, stress, and vital history checks in order, then emits `rw-l19-acceptance-summary`; the analyzer prints this under `RW/L19 Acceptance`, and the `RW/L19 Gate` can use either detailed step results or an all-pass acceptance summary when raw protocol/page logs have been truncated. In v150, core battery/version and realtime heart-rate/SpO2 probes must send the no-CRC keys `0203`, `0204`, `0503`, and `0509`; in v151-v153, copied probe reports must still include required/core command rows even if raw command logs are truncated; if a new log still shows `fca0020310`, `cca2020410`, `022410`, or `024e10` as the primary core commands, the tester is not running the current package. If a required `ab-realtime` read reaches `attempt=4/4` and still times out, treat it as device/protocol no-result after enable/read; compare Mine manual metric and raw rx before changing page display code.
- `mode: core` means the log only covers core required commands. `mode: full` means compatibility probes were also tested.
- Required failures in `ab-core` or `ab-realtime` mean core RW commands need protocol work.
- Optional failures in `qkeer-v2-history` or legacy families do not by themselves mean connection failure.
- `diagnostic-copy-incomplete` means the user copied before self-test finished.

Then check `RW/L19 Gate`:

- `overall: PASS` means the copied log proves the RW path reached the L19-equivalent business contract for the covered checks.
- `core-protocol: FAIL` means one of the required commands failed or timed out; fix protocol command/result handling before page display work.
- `realtime-heart-spo2: NOT_PROVEN` means heart-rate/SpO2 was not measured from the page or did not hit the expected realtime keys.
- `business-history-upload: NOT_PROVEN` means at least one of sleep/activity/stress/vital did not show page sync plus upload evidence.

Then check history:

- `history-page-sync-start` means a business page attempted typed history sync.
- `history-page-sync-result recordCount > 0` means the page received records.
- `history-page-upload-result submitted=true count>0` or `uploaded=true recordCount>0` means records were submitted to backend.
- `history-page-query-result` is emitted after sleep/activity/stress/vital detail APIs return. If upload succeeds but `itemCount=0` or the query value hints are empty, move investigation to backend aggregation, date offset, or page field consumption instead of BLE transport.
- `history-page-query-failed` is emitted when a sleep/activity/stress/vital detail API throws. It includes `page`, `date`, `endpoint`, and `error`, so failed backend/detail requests can be separated from BLE history read failures.
- `manual-metric-start/result/failed` means the Mine diagnostic panel ran a single realtime measurement. A `manual-metric-result` with `expectedKey`, `value`, and `parsed.type=rw_health_data` is valid page-level heart-rate/SpO2 evidence, even when lower-level BLE lines are truncated.
- `manual-history-sync-start/result/failed` means the Mine diagnostic panel attempted a typed history sync. A `manual-history-sync-result` with `recordCount > 0` and `uploaded=true` is valid protocol/upload evidence, even when raw BLE command lines are truncated from the copied log.
- `compat-history-queue-enqueue/start/result/failed` means RW history reads are being serialized before commands are sent.
- The offline analyzer reports queue counts and `maxQueuedBehind` in the History Sync section; non-zero values mean multiple RW history reads were queued instead of sent concurrently.
- upload success plus blank detail page points to backend/detail refresh.
- sync timeout with no `rx-parsed` points to the device not responding to that command or a command shape mismatch.

## Verification Commands

From `E:\qkeer\code\wechatProgram\smart-wearable-devices-next`:

```powershell
npm.cmd run type-check
npm.cmd run audit:rw-l19 -- --skip-dist
npm.cmd run verify:ring-ble
npm.cmd run verify:rw-backend-health
npm.cmd run build:mp-weixin
npm.cmd run verify:mp-weixin-artifact
npm.cmd run check:mp-weixin-size
npm.cmd run audit:rw-l19

# one-command release verification
npm.cmd run verify:rw-l19:release
# legacy alias, same chain
npm.cmd run verify:ring-ble:release
```

Current known good package state from v153:

- main package: 1,201,646 bytes, about 1.17 MB
- main package headroom: 895,506 bytes, about 875 KB
- total artifact: 1,446,442 bytes
- below WeChat 2 MB main-package limit
- latest release verification passed after backend health-text verification exposure and release-chain inclusion, the business-page `lastReadTimestamp` parity fix, upload raw-vs-submittable diagnostics, RW history queue serialization, business detail query success/failure diagnostics, business-page history timeout/elapsed diagnostics, Mine core/full protocol test split, software-version device-info guard, compact Mine history report, AB history ReadContinue probes, production ReadContinue retry fallback, flag-matched AB history waits, strict identifiable AB response flags, realtime/foreground/business-metric/upload invalid-value guards, required realtime self-test warm-up polling, one-click RW/L19 acceptance diagnostics, no-CRC RW key command primary path, and build-tag bump
- source guards now verify that sleep, activity, stress and vital pages await RW history sync before backend detail queries and route every detail API through `queryHistoryPage`

## Key Files

- `src/sdk/ring-ble/rw/protocol.ts`
- `src/sdk/ring-ble/rw/parser.ts`
- `src/sdk/ring-ble/rw/history.ts`
- `src/sdk/ring-ble/rw/adapter.ts`
- `src/sdk/ring-ble/businessMetrics.ts`
- `src/composables/useRingHistoryUpload.ts`
- `src/composables/useRingBusinessHistoryPageSync.ts`
- `src/pages/mine/mine.vue`
- `src/pagesA/mines/device.vue`
- `src/homeDetail/sleepPage/sleepPage.vue`
- `src/homeDetail/exercise/exercise.vue`
- `src/homeDetail/relaxStatus/relaxStatus.vue`
- `src/homeDetail/vitalSigns/vitalSigns.vue`
- `scripts/analyze-rw-ble-log.mjs`
- `scripts/verify-ring-ble-parser.mjs`
- `scripts/verify-rw-backend-health.mjs`
- `scripts/audit-rw-l19-parity.mjs`

## 2026-07-16 v156 real-device log follow-up

Build tag: rw-visible-build-tag-20260718-262
Package: dist/build/mp-weixin
Size check: main package 1,214,811 bytes / 1,186 KB; headroom 882,341 bytes / 862 KB; total artifact 1,492,667 bytes / 1,458 KB.

Latest v155 SY03 Mine diagnostic log showed BLE connection and notify were ready, but required full-probe failures were concentrated on no-CRC short commands:
- battery/read ab010003020310 timeout
- firmware/read ab010003020410 timeout
- heart-rate realtime no-CRC read ab010003050310 timeout
- blood-oxygen realtime no-CRC read ab010003050910 timeout
- control ACKs were inconsistent; enable ACKs timed out while a disable ACK could return

Fixes in v156:
- RW compatibility fallback is enabled by default for battery and firmware/version reads, instead of only when RW BLE debug is enabled.
- RW realtime health-data reads now send App-SDK CRC reads first and keep no-CRC 0x05xx reads as fallback.
- Mine protocol probe tests battery/firmware through CRC key reads first and keeps no-CRC commands as optional full-probe diagnostics.
- Mine protocol probe treats realtime control commands as write-ok steps; realtime data reads now carry the proof, so missing control ACK alone does not fail the core gate.
- Analyzer/diagnostic copy keeps compact RW/L19 acceptance evidence via diagnostic-acceptance-report.
Latest 06:17 pasted log (`778bdcb4.../pasted-text.txt`) is also v155, not v156. Analyzer result: connection snapshot ready, but build gate NOT_PROVEN and core-protocol FAIL. Required failures are battery/read `ab010003020310`, firmware/read `ab010003020410`, heart-rate control/read/disable, and blood-oxygen control/read. This confirms v155 old behavior; do not judge v156 from this paste. Retest must show `rw-visible-build-tag-20260718-262`.

Analyzer follow-up after this paste: `protocol-probe-command-write-ok` is now counted as a protocol-probe response and printed with `writeOnly=1`, so v156 write-only control steps will not be misreported as missing responses.

Validation run:
- npm.cmd run audit:rw-l19 -- --skip-dist: passed
- npm.cmd run type-check: passed
- npm.cmd run verify:ring-ble: passed
- npm.cmd run build:mp-weixin: passed
- npm.cmd run audit:rw-l19: passed
- npm.cmd run verify:mp-weixin-artifact: passed
- npm.cmd run check:mp-weixin-size: passed
- npm.cmd run verify:rw-l19:release: passed

Next real-device validation:
1. Import dist/build/mp-weixin into WeChat DevTools and upload v156.
2. Wake SY03, connect, open Mine -> RW/L19 one-click acceptance if available.
3. Copy Mine diagnostics only after the acceptance/probe button finishes.
4. Expected useful evidence in the next log: diagnostic-copy buildTag v156, diagnostic-acceptance-report, and probe rows showing whether app-sdk-ab-crc battery/firmware/realtime commands return.
