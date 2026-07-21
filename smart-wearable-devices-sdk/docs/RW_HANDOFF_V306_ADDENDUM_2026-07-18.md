# RW v306 Addendum - Temperature Single-Path Probe

## Goal

Continue RW/SY03 validation one device protocol path at a time. This build keeps the v305 empty-ACK noise reduction and adds a Mine-page temperature-only protocol probe so true-device logs can isolate the body-temperature path without re-running every verified route.

Current build tag: `rw-visible-build-tag-20260719-318`

## Latest Log Source

- Backend: `admin_fastapi`
- Log page: `https://sh.qkeering.com/api/app/rw-debug/logs/page?limit=1000`
- API: `https://sh.qkeering.com/api/app/rw-debug/logs?limit=1000`
- Last checked on 2026-07-19: backend logs still end at `rw-visible-build-tag-20260719-309` / id `3159`. No v317/v318 `0x027d` / SDK-correct `0x021b` / `0x0508` temperature-only run has reached the backend yet.

## Release And Preview Guard

- The WeChat DevTools project root should be `E:\qkeer\code\wechatProgram\smart-wearable-devices-next`; its `project.config.json` sets `miniprogramRoot` to `dist/build/mp-weixin/`.
- Before treating any true-device result as v318 evidence, the Mine-page diagnostic card must visibly show `rw-visible-build-tag-20260719-318`.
- v318 keeps the v315 diagnostic-copy upload proof, v316 ready-time sync, and v317 key-specific temperature predicates. It additionally splits Mine-page temperature validation into one-command buttons.
- If backend logs still show `rw-visible-build-tag-20260719-309`, do not analyze temperature as the new SDK path. v309 only tested `0x0609/0x08` control plus `0x0230` realtime read.
- Local WeChat DevTools CLI exists at `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`, but this machine did not expose a working CLI service port during validation: `preview`, `open`, and `islogin` timed out and no preview QR was generated. If CLI preview is needed later, first enable the DevTools service port from the UI, then retry `cli.bat preview --project E:\qkeer\code\wechatProgram\smart-wearable-devices-next --qr-format image`.
- Confirm the current dist package before preview/upload:
  - `npm.cmd run verify:mp-weixin-artifact`
  - `npm.cmd run check:mp-weixin-size`
  - `npm.cmd run audit:rw-l19`
- Fetch and summarize backend logs in one step with `npm.cmd run check:rw-backend-log -- --limit=2000 --output=rw-debug-latest.json`. Use `npm.cmd run check:rw-backend-log -- --limit=2000 --output=rw-debug-latest.json --fail-on-missing-build-tag` when the run must fail if v318 is absent.
- The backend summary prints `temperature route verdict`; use it as the first pass: `WAITING_FOR_EXPECTED_BUILD` means the app build did not reach logs, `FAIL` names the timed-out/error command, `NO_SAMPLES` means the command path responded but history returned empty ACK, and `PASS` means the focused temperature path returned non-empty required responses.
- The lower-level commands remain available when needed: `npm.cmd run fetch:rw-backend-log -- --limit=2000 --output=rw-debug-latest.json`, then `npm.cmd run analyze:rw-backend-log -- rw-debug-latest.json`.

## SDK And PDF Evidence

- The APP SDK exposes `BLE_KEY_ACTIVITY`, `BLE_KEY_SLEEP`, and `BLE_KEY_ACTIVITY_CURRENT_DAY`.
- Step should continue to prefer `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a`; this avoids the old false local summary/raw data step value.
- Sleep still uses `BLE_KEY_SLEEP` / `0x0505`; if the ring returns empty ACK, `sleepState` and `durationMinutes` remain empty or zero after upload.
- Temperature SDK keys are:
  - `BLE_KEY_TEMPERATURE_DETECTING` / `0x021b`
  - `BLE_KEY_APP_REAL_TIME_TEMPERATURE_DATA` / `0x0230`
  - `BLE_KEY_TEMPERATURE_MONITORING` / `0x027d`
  - historical `BLE_KEY_TEMPERATURE` / `0x0508`
- The field-correct AB current-temperature read command is `ab0100030cb4023010` (`0x0230` + read flag `0x10`).
- The AB no-CRC variant is `ab010003023010`.
- The C6-equivalent current-temperature probe is `c60100030cb4023010`.
- In history sync diagnostics, `temperature-current` means the SDK current key `0x0230`, and `temperature-history` means the historical key `0x0508`.
- The PDF sample `c601000319d4050230` must not be treated as current body temperature. Its payload is `05 02 30`, meaning `0x0502` plus delete flag `0x30`, not `0x0230`.

## Change In v306

- Mine RW diagnostics adds `体温单测`.
- The temperature-only command order is:
  - `monitoring/temperature/read` (`0x027d`)
  - `monitoring/temperature-detecting/write` (`0x021b`)
  - `temperature/control-enable` (`0x0609`, type `0x08`)
  - `temperature/app-realtime-read` (`0x0230`, CRC)
  - `temperature/app-realtime-read-no-crc` (`0x0230`, short AB)
  - `temperature/c6-realtime-read` (`0x0230`, C6-equivalent CRC)
  - `temperature/c6-realtime-read-no-crc` (`0x0230`, short C6)
  - `history-key/temperature/read` (`0x0508`, CRC)
  - `history-key/temperature/read-no-crc` (`0x0508`, short AB)
  - `temperature/control-disable` (`0x0609`, type `0x08`)
- In temperature mode, the required checks are the config read/write, control enable, SDK current-temperature read, and historical temperature read. Alternative no-CRC/C6 paths remain optional but visible.
- The historical `0x0508` predicate is now key-specific, so a `0x0230` current-temperature payload cannot accidentally satisfy the historical-temperature command.

## Change In v309

- `体温单测` is narrowed to one realtime path: `0x0609/0x08` enable, `0x0230` APP realtime read, and `0x0609/0x08` disable.
- The already-proven C6/no-CRC retries, `0x021b/0x027d` monitoring config checks, and `0x0508` historical read remain in broader protocol checks, not in the focused temperature run.
- If the device was just restored from a non-ready state, protocol probe waits a 9-second settle window before sending the first command, so reconnect/time-sync tail commands do not contaminate the single-path result.

## Change In v310

- Latest isolated `体温单测` log proves the control path but not the data path:
  - `temperature/control-enable`: TX `ab010006359f060900080501`, RX ACK `ab11000351e6060900`.
  - `temperature/app-realtime-read`: TX `ab0100030cb4023010`, repeated polls for 45 seconds, no `0x0230` temperature payload.
  - `temperature/control-disable`: TX `ab010006f55e060900080500`, RX ACK `ab11000351e6060900`.
- Treat temperature as "command sent, device did not return data" until vendor SDK/official APP trace proves an extra precondition.
- Step upload is now conservative:
  - Parsed `0x051A` current-day step candidates remain visible in diagnostics.
  - `ab_activity_current_day_summary`, `ab_activity_current_day_hour`, `ab_activity_current_day_jl2_hour`, and `ab_activity_current_day_relative_hour` are no longer submitted to `admin_fastapi`.
  - Verified `0x0502` activity history records such as `ab_activity_history_jl2` remain submittable.
- Mine page adds `步数/睡眠单测` with only three commands:
  - `history-key/activity-current-day/read` (`0x051A`)
  - `history-key/activity/read` (`0x0502`)
  - `history-key/sleep/read` (`0x0505`)
- Build tag: `rw-visible-build-tag-20260719-310`.

## Change In v311-v314

- The Mine-page `体温单测` button now follows the APP SDK body-temperature path instead of the previously failing realtime-only path.
- The focused temperature command list is:
  - `monitoring/temperature/read` (`0x027d`, SDK `getTimedBodyTemperatureJL`)
  - `monitoring/temperature-detecting/write` (`0x021b`, SDK `setTimedBodyTemperatureJL`)
  - `history-key/temperature/read` (`0x0508`, historical `BLE_KEY_TEMPERATURE`)
  - `history-key/temperature/read-no-crc` (`0x0508`, short AB variant, optional)
- `0x0230` realtime temperature remains available in the broader/full probe and historical sync fallback, but is no longer the focused temperature route because v309 true-device logs already proved it writes successfully and then returns no payload.
- SDK evidence from `RW_SDK_APP_260414`:
  - `RingHealthType` has no TEMP sync type.
  - `DHBleSdk.getTimedBodyTemperatureJL()` reads `BLE_KEY_TEMPERATURE_MONITORING`.
  - `DHBleSdk.setTimedBodyTemperatureJL(...)` writes `BLE_KEY_TEMPERATURE_DETECTING`.
  - `CmdHelper.getTimedBodyTemperatureWCmdJL(...)` encodes the first value byte as `open + repeatModel bits`; `open=true` is the high bit, not low bit. v314 therefore sends SDK-style daily monitoring value `ff 00 00 17 3b 3c`, full command `ab010009f5ee021b00ff0000173b3c`.
  - The RW parser now decodes `0x021b` and `0x027d` high-bit enable and repeat-model fields, so a returned `ff 00 00 17 3b 3c` config is reported as enabled instead of closed.
  - `SyncJLDataService.syncRingHealthData()` does not include `BLE_KEY_TEMPERATURE` in its batch list, so temperature must be validated as a separate path.
- Build tag: `rw-visible-build-tag-20260719-317`.

## Change In v317

- `monitoring/temperature/read` now requires parsed key `0x027d`, not only parsed name `temperature`.
- `monitoring/temperature-detecting/write` now requires parsed key `0x021b`, not only parsed name `temperature`.
- This prevents a delayed temperature config read response from being counted as a detecting-write success in the focused Mine-page `体温单测`.

## Change In v318

- Mine RW diagnostics adds three one-command temperature buttons:
  - `体温配置`: only sends `monitoring/temperature/read` (`0x027d`).
  - `体温开启`: only sends `monitoring/temperature-detecting/write` (`0x021b`).
  - `体温历史`: only sends `history-key/temperature/read` (`0x0508`).
- Keep `体温单测` as the grouped SDK temperature path, but use the one-command buttons first while debugging the bottom protocol route. Clear logs before each button so backend evidence maps to one command only.

## Latest Known State

- 2026-07-19 local verification passed for v316: `type-check`, `verify:ring-ble`, `audit:rw-l19`, `verify:mp-weixin-artifact`, and `check:mp-weixin-size`.
- The latest backend pull after the v318 source update still only contains `rw-visible-build-tag-20260719-309` rows, latest ids `3159..3152`; no v317/v318 true-device log has been observed yet.
- v316 added one ready-time correction for RW immediately after connect/restore becomes communication-ready, deduped for 10 minutes, before normal post-connect refresh. This is intended to prevent stale device dates from shifting step/sleep/history records.
- v305 logs showed connection ready and notify enabled on RW service `0000A00A`, write `0000B002`, notify `0000B003`.
- Empty-ACK noise reduction was effective: AB `read-continue` commands stopped after empty first ACKs.
- Uploaded metrics previously included `stepCount` from `0x051a`, SPO2, stress, and HRV.
- Still open from latest logs:
  - Heart-rate `0x0503` sometimes returns empty ACK in a run.
  - Sleep `0x0505` returns empty ACK when no sleep records are available.
  - Temperature current `0x0230` writes OK but has not returned parsed data yet.
  - Temperature history `0x0508` writes OK but has not returned parsed data yet.
  - Blood sugar `0x0510` and blood pressure `0x0504` can return empty ACKs.
- Backend checks after sync remain `historyStartDate`, `summaryScheduled`, `data_sync_summary`, `health_raw.step_count`, `health_raw.sleep_state`, and raw `records=0` diagnostics.

## True-Device Test Plan

1. Install v318 and connect SY03. Confirm the Mine diagnostic card shows `rw-visible-build-tag-20260719-318` before interpreting logs.
2. For step/sleep, open Mine page, clear logs, then tap `步数/睡眠单测`.
3. Wait until the button stops loading, then copy logs or read the backend log page.
4. Interpret the result:
   - `history-key/activity-current-day/read` may return parsed current-day step candidates, but these are diagnostic-only and should not write `health_raw.step_count`.
   - `history-key/activity/read` is the preferred step source for backend upload.
   - `history-key/sleep/read` must return non-empty sleep records before sleep pages can display backend sleep data.
5. For temperature, clear logs and test one command at a time in this order:
   - Tap `体温配置`, wait until it stops loading, then upload/copy logs.
   - Clear logs, tap `体温开启`, wait until it stops loading, then upload/copy logs.
   - Clear logs, tap `体温历史`, wait until it stops loading, then upload/copy logs.
6. Interpret temperature results as:
   - If `monitoring/temperature/read` succeeds, the device accepts SDK `0x027d` timed-temperature config reads.
   - If `monitoring/temperature-detecting/write` succeeds, the device accepts SDK `0x021b` timed-temperature config writes.
   - If `history-key/temperature/read` returns non-empty records, the bottom temperature data path is open and the upload/display conversion should be checked next.
   - If `history-key/temperature/read` returns ACK with `records=0`, the historical route is valid but the ring has no stored temperature sample.
   - If `0x027d`, `0x021b`, and `0x0508` all fail, continue with SDK-side constraints such as wearing state, temperature sensor support, firmware capability, or a required precondition not described in the PDF.

## Still Open

- Temperature remains the current protocol focus until a true-device log proves which command returns payload.
- Sleep should be tested after a real sleep window.
- Detail pages should read backend data after home sync. Detail pages should not initiate BLE history sync.
- Database deletion and cleanup remain out of scope for device-side work.


