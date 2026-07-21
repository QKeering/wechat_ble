# RW Temperature Probe Handoff v321

Visible build: `rw-visible-build-tag-20260719-321`.

Goal: keep the stable RW/SY03 data paths unchanged, then isolate the remaining temperature path. Latest firmware-upgrade logs showed `0x0508` temperature history can return an empty ACK, while the SDK-style `0x021b` enable command writes successfully but does not receive a device response.

SDK evidence:
- `BLE_KEY_TEMPERATURE_DETECTING = 0x021b`.
- `BLE_KEY_TEMPERATURE_MONITORING = 0x027d`.
- SDK method `setTimedBodyTemperatureJL` sends `BLE_KEY_TEMPERATURE_DETECTING` with `UPDATE = 0x00`.
- SDK method `getTimedBodyTemperatureJL` reads `BLE_KEY_TEMPERATURE_MONITORING`.
- SDK body-temperature detecting payload is 6 bytes after key and flag: `flags,startHour,startMin,endHour,endMin,duration`. The normal all-day enable payload is `ff0000173b3c`.

Known results before v321:
- `monitoring/temperature/read` (`0x027d`) can be isolated from background history sync and should stay available as the config read check.
- `monitoring/temperature-detecting/write` (`0x021b`, SDK payload `ff0000173b3c`) writes OK three times but times out with no `rx-parsed`.
- `history-key/temperature/read` (`0x0508`) returns `rw_health_data_ack:temperature` with Len=3, meaning the read path is alive but there is no stored temperature data.
- Waiting several minutes after the SDK-style `0x021b` enable still leaves `0x0508` empty, so repeating only the same command is not useful.

v321 test results:
- `monitoring/temperature-detecting/plain-write` (`ab0100092bfb021b00010000173b3c`) was tested at 08:45. BLE write returned `tx-ok` three times, but no device `rx-parsed` response arrived before timeout.
- `monitoring/temperature-detecting/sdk-short-write` (`ab010009e72e021b00ff0000173b05`) was tested at 08:54. BLE write returned `tx-ok` three times, but no device `rx-parsed` response arrived before timeout.
- `monitoring/temperature-detecting/sdk-no-crc-write` (`ab010009021b00ff0000173b3c`) was tested at 08:57. BLE write returned `tx-ok` three times, but no device `rx-parsed` response arrived before timeout.
- `monitoring/temperature/read` (`ab0100035c81027d10`) was tested at 08:59. BLE write returned `tx-ok`, but no device `rx-parsed` response arrived before timeout.
- `history-key/temperature/read` (`ab0100030d16050810`) was tested at 08:49. The device responded with `ab1100030d16050810`, parsed as `rw_health_data_ack:temperature`; this confirms the history read path is reachable but currently empty.
- `temperature/app-realtime-read` (`ab0100030cb4023010`) must not be considered successful from `tx-ok` alone. In the latest clean logs it had no terminal response.

v321 changes:
- Added single-command buttons in Mine diagnostics for `0x021b` variants:
  - `monitoring/temperature-detecting/plain-write`: plain enable byte `010000173b3c`.
  - `monitoring/temperature-detecting/sdk-short-write`: SDK flags with 5-minute duration `ff0000173b05`.
  - `monitoring/temperature-detecting/sdk-no-crc-write`: SDK payload without CRC.
- Added a single-command Mine entry for `temperature/app-realtime-read` (`0x0230`) so realtime temperature can be checked without running the full temperature sweep.
- Variant-only commands are excluded from normal `temperature` and `full` protocol probes to reduce log noise.

Next test order:
1. Publish v321 and confirm Mine diagnostics show `rw-visible-build-tag-20260719-321`.
2. Clear logs.
3. Done: test only `体温开01`.
4. Done: test only `体温开5分`.
5. Done: test only `体温开短帧`.
6. Done: test only `体温配置` (`monitoring/temperature/read`, `0x027d`).
7. Next: clear logs and test only `体温实时0230`.
8. If `体温实时0230` only returns ACK/timeout, prepare a v322 build with isolated `0x0609/0x08` realtime temperature control buttons so control-enable can be tested without the full probe.
9. If any `0x021b` variant responds in a future build, wait 2-5 minutes and test `体温历史` (`history-key/temperature/read`, `0x0508`).
