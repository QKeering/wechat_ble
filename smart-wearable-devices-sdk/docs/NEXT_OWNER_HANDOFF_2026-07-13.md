閿? RW / L19 Handoff - 2026-07-15

Build tag: rw-visible-build-tag-20260718-262
Package: dist/build/mp-weixin
Goal: make RW devices behave like the completed L19 path for connection, device info, realtime metrics, and history-backed business pages.

## Completed
- L19 protocol path is already wrapped and treated as the reference path.
- RW BLE protocol has QKeer V2 command support, including realtime metrics, battery/device-info parsing, native history-list fallback, and LastData(0x70) fallback.
- RW battery display was fixed in earlier builds and should remain normal.
- Invalid RW bloodOxygen values are guarded at parser/page/cache layers. Values outside 70-100, such as 46, must not be displayed as SpO2.
- Mine page keeps the RW diagnostic panel and manual buttons for realtime metric reads and history sync.
- Awareness/Mine visible business pages were restored to compile and avoid corrupted visible text in the current build.
- Main package size remains under the 2 MB WeChat main-package limit.

## Changed In 20260715-78
- `src/sdk/ring-ble/rw/history.ts`: LastData records are mapped according to the requested history type. Example: when sleep history is requested and native file-list responses are silent, qkeer_v2_last_data can become L19-compatible local_data with dataType=sleep while keeping rawDataType=last_data.
- `src/sdk/ring-ble/rw/history.parity.ts`: added a parity test for the silent local/native-list path followed by LastData fallback.
- `src/composables/useRingMetricReadings.ts`: invalid SpO2 values are rejected before page display.
- `src/pages/mine/mine.vue`: RW diagnostic panel remains the single place to copy logs and run targeted RW checks.
- `src/pages/awareness/awareness.vue`: health page visible layout was rebuilt after encoding damage and keeps health summary cards.

## Changed In 20260715-80
- `src/sdk/ring-ble/rw/parser.ts`: all realtime bloodOxygen parser shapes now pass through the same 70-100 guard. Real-device packets that contain 46 are treated as no valid SpO2 result instead of being surfaced to UI.
- `src/composables/useRwForegroundMeasurement.ts`: foreground metric extraction also rejects direct, nested, and raw 46-style SpO2 candidates.
- `scripts/analyze-rw-ble-log.mjs`: RW history analysis now recognizes LastData(0x70), `history/native-last-data`, and `qkeer_v2_last_data` as valid sleep/vital/activity fallback evidence.
- `scripts/verify-ring-ble-parser.mjs`: parity coverage now includes invalid realtime SpO2 rejection and LastData history-log recognition.
- Latest log `88f8c285.../pasted-text.txt` was from build 71, not build 80. It proves old-package 46% leakage and old sleep file-list timeout, but the next real-device verdict must use build tag rw-visible-build-tag-20260718-262.

## Changed In 20260715-81
- Latest log `49b7e1d2.../pasted-text.txt` was from build 78. It showed BLE connection was ready, no disconnects, and the failure was history sync: `history/read-local-data-incremental`, native health/step/sleep list, `history/native-last-data`, and `history/read-file-list` were written, but the device returned no history response before timeout.
- `src/sdk/ring-ble/rw/history.ts`: added a true LastData-only diagnostic path. A request with `dataType=lastData` sends only `history/native-last-data` and waits for `qkeer_v2_last_data`; it no longer fires legacy file-list or native health/step/sleep list first.
- `src/pages/mine/mine.vue`: the top diagnostic history button now reads `闁硅姤顭堥々顩?through the LastData-only path. Sleep/activity/stress/vital remain separate one-by-one history buttons.
- `src/sdk/ring-ble/rw/history.ts`: native history-list commands are now spaced by 650ms when a typed history path needs more than one native list command.
- `scripts/analyze-rw-ble-log.mjs`: recognizes `summary/lastData` expected history names and new LastData-only diagnostic events.

## Changed In 20260715-82
- Latest log `49b7e1d2.../pasted-text.txt` still came from build 78. The useful conclusion is: connection reached `notify-primary-enabled`, no BLE disconnect happened, and the failure was the old all-history path timing out. Do not use that log to judge build 82.
- `src/pages.json`: visible navigation/tab titles were rewritten as clean Chinese strings so health/mine/subpackage titles no longer depend on previously garbled text.
- `src/homeDetail/sleepPage/sleepPage.vue`, `src/homeDetail/exercise/exercise.vue`, `src/homeDetail/relaxStatus/relaxStatus.vue`, and `src/homeDetail/vitalSigns/vitalSigns.vue`: enabled `allowRwDeviceSync` for page-level RW history sync. These pages now request their own typed history before querying backend data, instead of being skipped as `rw-manual-only`.
- History requests remain one-by-one: sleep sends sleep, activity sends step, relax sends stress, and vital signs collapses to one native health-list request.
- Verification passed for build 82: `type-check`, source RW/L19 audit, `verify:ring-ble`, `build:mp-weixin`, artifact verification, main-package size check, and full RW/L19 audit.

## Changed In 20260715-83
- `src/composables/useRingBusinessHistoryPageSync.ts`: RW business detail pages now submit successful history sync results to `/app/data/sync` through `submitRingHistorySyncResult(...)` before the page continues querying backend detail APIs.
- This closes a parity gap with L19: previously a detail page could read RW history into local runtime/storage, then immediately query backend APIs that had not received those records yet.
- New diagnostics: `history-page-upload-result`, `history-page-upload-skip`, and `history-page-upload-failed` under `RW PAGE`.
- `scripts/audit-rw-l19-parity.mjs`: added guards so the backend submit path and `allowRwDeviceSync: true` on sleep/activity/stress/vital detail pages cannot be removed silently.

## Changed In 20260715-84
- Protocol regression confirmed RW device-info refresh should reuse the combined `firmware_version` response for firmware/software aliases instead of probing `sendSoftwareVersion()` in the runtime refresh path. Sending an extra software command increases BLE command noise and failed `verify:ring-ble`.
- `src/sdk/ring-ble/businessMetrics.ts`: the combined version response is guarded by alias mapping so `softwareVersion/uiVersion` can fall back to the firmware response when the device does not emit a separate software packet.
- `src/pagesA/mines/device.vue`: the manual version helper also sends both version commands if it is wired back into UI later; this is not the default runtime refresh path.
- `scripts/audit-rw-l19-parity.mjs`: guards the combined version alias behavior so this RW/L19 parity point cannot regress silently.

## Changed In 20260715-85
- `src/composables/useRingBusinessHistoryPageSync.ts`: business detail pages now detect RW from the current device, store device, user device, or bound device before deciding whether to run RW history sync. This avoids skipping RW page-level sync when a user opens sleep/activity/stress/vital pages before the connection state has been restored.
- Non-RW skips now emit `RW PAGE/history-page-sync-skip` with `reason=non-rw`, so real-device logs can distinguish a deliberate skip from a missing RW restore attempt.
- `scripts/audit-rw-l19-parity.mjs`: added guards for the bound-device RW detection path.

## Changed In 20260715-86
- Latest log `98ac23d1.../pasted-text.txt` was from build 85. It proved connection and notify were ready (`notify-primary-enabled`, store/page connected), but there were zero `rx` / `rx-parsed` events in the copied window.
- The same log showed device-info refresh still wrote a long battery/version fallback sequence after the primary response timed out, and history summary/activity both failed in BLE waiters: `history/native-last-data` and step/file-list reads were written but no history response arrived before 20s timeout.
- `src/sdk/ring-ble/rw/adapter.ts`: default RW battery and firmware/version reads now use only the proven App SDK primary key command (`0x0203` for battery, `0x0204` for version). Old alternate-write and legacy fallback probes are gated behind explicit RW BLE debug mode instead of running in normal tests.
- Diagnostic detail truncation was raised from 1200 to 4000 characters in BLE/history/Mine/foreground/connect logs, so the copied `diagnostic-copy` header should remain parseable and keep `snapshot` / `lastHistoryResult`.
- Updated parity expectations to guard the low-noise primary path. Next real-device run should confirm the log no longer contains `battery/legacy-l19`, `battery/c6-*`, `battery/mini-*`, or version fallback packets during normal device-info refresh.

## Still Pending / True Device Proof
- Verify SY03/RW on a real phone with build tag rw-visible-build-tag-20260718-262.
- Realtime heart_rate should display a plausible value after pressing the Mine-page heart-rate test button.
- Realtime blood_oxygen should display only 70-100. If the device returns 46, the page should show waiting/no valid result instead of 46%.
- Temperature/HRV/stress/blood pressure/blood sugar still need one-by-one validation because not all device responses have been proven.
- History sync still needs real-device proof for sleepData/activity/stress/vital pages. LastData fallback now provides a summary fallback, but full native history payloads are still preferred.

## Real Device Test Checklist
1. Open Mine page and confirm build tag rw-visible-build-tag-20260718-262.
2. Confirm connection state is consistent across scan page, home page, and Mine page.
3. In Mine RW diagnostic panel, test one metric at a time: heart_rate, blood_oxygen, temperature, hrv, stress, blood_pressure, blood_sugar.
4. Copy logs after each metric if UI result is wrong.
5. Run history sync one type at a time: first `闂佽法鍠愰弸濠氬箯瀹勬澘绲块柟鑺ヮ焾椤╊泦, then sleep, activity, stress, vital.
6. Check Health page cards: sleep, activity, stress, vital signs.
7. If data is missing, copy Mine diagnostic logs. Do not run all tests concurrently.

## Useful Commands
- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

## Notes For Next Owner
- Treat L19 as the behavior reference.
- RW connection instability seen earlier was partly caused by device sleep. Always wake the ring before judging BLE connection code.
- Logs are more reliable than screenshots. Use Mine page diagnostic-copy output for analysis.
- Keep command volume low: test single metric/history type per run to avoid noisy concurrent BLE logs.

