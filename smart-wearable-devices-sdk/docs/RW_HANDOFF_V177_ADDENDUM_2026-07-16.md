# RW Handoff Addendum v177

Date: 2026-07-16

Visible build tag: `rw-visible-build-tag-20260718-262`

Package path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`

Package size after rebuild: main package 1,234,545 bytes, 862,607 bytes headroom under the 2 MB WeChat limit. Total artifact 1,512,493 bytes.

## Latest Log Review

The 14:49 pasted log was from older build 173, so it cannot judge the v176/v177 package directly.

Useful findings from that log:

- BLE was connected and notify was enabled: `connected=true`, `ready=true`, `notifyEnabled=true`.
- The device returned a generic `0x0609` control ACK such as `ab11000351e6060900`.
- The old probe treated that generic ACK as timeout because it expected the ACK to repeat the exact metric and enable/disable action. Current code accepts generic successful `0x0609` ACKs.
- `history/file-list` used the old `00013610` file-system command and timed out again. This line is not the primary SY03/RW history path and should not be in the missing-command focus list.

## What Changed In v177

- Added APP SDK-aligned AB history payload parsing:
  - Sleep `0x0505` / raw sleep `0x02fe`: 7-byte event records, big-endian seconds since 2000, sleep model, two reserved bytes.
  - Activity `0x0502`: 16-byte step records, big-endian time, reserved byte, 3-byte steps, 4-byte calorie raw divided by 10, 4-byte distance raw divided by 10000.
  - Activity current day `0x051a`: first 16-byte record as daily summary, later 16-byte records as hourly items.
- Sleep event streams now synthesize L19-style segment records and a session summary with `sleepTotalMinutes`, `asleepTime`, `awakeTime`, and `items`.
- Activity records now synthesize L19-style daily summaries with `stepCount`, `totalCalorie`, `totalDistance`, and `items`.
- The Mine page `missing` protocol probe focus no longer includes `history/file-list`; focus stays on native AB sleep/activity keys.
- Added parser parity samples for APP SDK big-endian sleep/activity payloads.
- Added history parity samples proving real APP SDK sleep/activity AB payloads map through `syncRwHistoryFiles()` into L19-compatible `local_data.records`.
- Added analyzer focus output `RW Sleep/Activity AB Probe Focus`, which classifies `0x0505`, `0x02fe`, `0x051a`, and `0x0502` as payload, empty ACK, timeout, error, or missing.
- Added analyzer expected-history output for AB history payload evidence: `abResponses`, `abResults`, `abReceived`, `abPayload`, and `abPayloadRecords`. If device payload is parsed but no page/manual sync result follows, the analyzer now reports `ab-payload-not-consumed`.
- Added regression coverage for SY03 short `0x0609` ACK `ab11000351e6060900`; adapter context must claim it as the pending HRV/control command instead of timing out.
- Cross-checked the local APP SDK classes under `E:\qkeer\.codex_tmp\rw_sdk_app_classes_260414`: `BLE_KEY_SLEEP=0x0505`, `BLE_KEY_RAW_SLEEP=0x02fe`, `BLE_KEY_ACTIVITY=0x0502`, and `BLE_KEY_ACTIVITY_CURRENT_DAY=0x051a`. SDK `SyncJLDataService.syncRingHealthData()` reads `ACTIVITY_CURRENT_DAY` first, then `SLEEP`, and uses `GET_GET_DEL` / `GET_DEL_GET_DEL` style history sync.
- Updated RW AB sleep/activity history reads to send one `ReadContinue(0x11)` after a payload response for `0x0505`, `0x02fe`, `0x051a`, and `0x0502`. The new diagnostic event is `history-ab-key-payload-continue`.

## Validation Completed

- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Additional source-only checks after the 2026-07-17 analyzer/regression update:

- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run audit:rw-l19 -- --skip-dist`

Additional checks after APP SDK sleep/activity read-continue alignment:

- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run audit:rw-l19 -- --skip-dist`

## Next Real-Device Test

Wear SY03 overnight on 2026-07-17, then test on 2026-07-18 morning with build tag `rw-visible-build-tag-20260718-262`.

Recommended sequence:

1. Open Mine and confirm copied logs show v177.
2. Clear diagnostics.
3. Keep ring connected and open Sleep page first.
4. Open Activity page second.
5. Copy Mine diagnostics.

Key lines to inspect:

- Analyzer section `RW Sleep/Activity AB Probe Focus`, especially `sleep/activity-ab-focus`.
- `history/ab-key/sleep/read` and `0x0505`: payload, empty ACK, or timeout.
- `history/ab-key/raw-sleep/read` and `0x02fe`: payload, empty ACK, or timeout.
- `history/ab-key/activity-current-day/read` and `0x051a`: payload, empty ACK, or timeout.
- `history/ab-key/activity/read` and `0x0502`: payload, empty ACK, or timeout.
- Expected-history fields `abPayload` and `abPayloadRecords`. If these are greater than zero but page result/upload is missing, inspect `syncRwHistoryFiles()` conversion and the page upload bridge before changing BLE commands.
- `history-ab-key-payload-continue` and analyzer field `payloadContinue`. If payload appears without this event on v177+ source, the build is stale or the sleep/activity path did not run.

If payload returns but pages are blank, next issue is page/backend consumption. If empty ACK returns after overnight wear, check whether monitoring/history collection was enabled before sleep. If timeout returns, continue comparing the exact command hex with the APP SDK command path.

