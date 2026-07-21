# RW Handoff Addendum v176

Date: 2026-07-16

Visible build tag: `rw-visible-build-tag-20260718-262`

Package path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`

Package size after rebuild: main package 1,230,544 bytes, 866,608 bytes headroom under the 2 MB WeChat limit. Total artifact 1,508,492 bytes.

## Purpose

Continue the RW-to-L19 parity goal for SY03. The current focus is not BLE connection: recent logs prove the device can connect, notify, login, and answer core AB read frames. The current focus is the APP SDK history-key line for sleep and activity data.

## What Changed In v176

- Kept the v175 APP SDK keys in the RW protocol/history path:
  - `0x0505` sleep
  - `0x02fe` raw sleep
  - `0x051a` activity current day
  - `0x0502` activity
- Fixed `parseLatestHealthDataRecordValue()` so sleep/activity payloads are not forced into the old six-byte compact layout.
- Sleep segment payloads, including 8-byte `0x0505` records, now produce both normalized `records` and a useful top-level `value`.
- Activity/current-day payloads now expose `activityLevel` in the top-level value summary when available.
- Added parity tests for direct AB key history sync:
  - sleep page request `dataType: sleepData` returning `history/ab-key/sleep/read`.
  - activity page request `dataType: activity` returning `history/ab-key/activity-current-day/read`.

## Validation Completed

- `npm.cmd run type-check`: passed.
- `npm.cmd run verify:ring-ble`: passed after parser/history parity additions.
- `npm.cmd run audit:rw-l19 -- --skip-dist`: passed.
- `npm.cmd run build:mp-weixin`: passed.
- `npm.cmd run verify:mp-weixin-artifact`: passed.
- `npm.cmd run check:mp-weixin-size`: passed.
- `npm.cmd run audit:rw-l19`: passed.
- `npm.cmd run verify:rw-backend-health`: passed.

## Next Real-Device Test

Use v176. Wear SY03 overnight, then on 2026-07-17:

1. Open Mine first and confirm logs show `rw-visible-build-tag-20260718-262`.
2. Copy Mine diagnostics once before opening detail pages.
3. Open Sleep and Activity pages.
4. Copy Mine diagnostics again.

Key evidence to check:

- `0x0505` sleep: payload vs empty ACK vs timeout.
- `0x02fe` raw sleep: payload vs empty ACK vs timeout.
- `0x051a` activity current day: payload vs empty ACK vs timeout.
- `0x0502` activity: payload vs empty ACK vs timeout.

If these return payload but pages stay blank, the next issue is page/backend mapping, not BLE transport. If they return empty ACK after overnight wear, check whether monitoring/history collection was enabled before sleep. If they time out, compare against APP SDK command framing and characteristic/write mode.

