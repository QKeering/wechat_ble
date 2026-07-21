# RW Temperature Probe Handoff v322

Visible build: `rw-visible-build-tag-20260719-322`.

Goal: keep stable RW/SY03 paths unchanged and continue isolating the remaining body-temperature path one command at a time.

Latest confirmed results:
- `monitoring/temperature-detecting/plain-write` (`ab0100092bfb021b00010000173b3c`) timed out after BLE `tx-ok`; no device `rx-parsed`.
- `monitoring/temperature-detecting/sdk-short-write` (`ab010009e72e021b00ff0000173b05`) timed out after BLE `tx-ok`; no device `rx-parsed`.
- `monitoring/temperature-detecting/sdk-no-crc-write` (`ab010009021b00ff0000173b3c`) timed out after BLE `tx-ok`; no device `rx-parsed`.
- `monitoring/temperature/read` (`ab0100035c81027d10`, SDK `BLE_KEY_TEMPERATURE_MONITORING = 0x027d`) timed out after BLE `tx-ok`; no device `rx-parsed`.
- `temperature/app-realtime-read` (`ab0100030cb4023010`, SDK app realtime temperature `0x0230`) timed out after BLE `tx-ok`; no device `rx-parsed`.
- `history-key/temperature/read` (`ab0100030d16050810`, `0x0508`) responds with `rw_health_data_ack:temperature`, so the temperature-history read path is reachable but empty.
- `temperature/control-enable` (`ab010006359f060900080501`) was tested on v322 at 09:17. The device responded with `ab11000351e6060900`, parsed as `rw_health_data_control_ack` with `status: success`.
- After that successful control enable, `temperature/app-realtime-read` (`ab0100030cb4023010`) was tested again at 09:19. The command was sent four times and each write returned `tx-ok`, but no device `rx-parsed` response arrived before timeout.
- `temperature/control-disable` (`ab010006f55e060900080500`) was tested on v322 at 09:22. The device responded with `ab11000351e6060900`, parsed as `rw_health_data_control_ack` with `status: success`.

SDK evidence:
- `BLE_KEY_TEMPERATURE_DETECTING = 0x021b`.
- `BLE_KEY_TEMPERATURE_MONITORING = 0x027d`.
- `setTimedBodyTemperatureJL` sends `BLE_KEY_TEMPERATURE_DETECTING` with `UPDATE = 0x00`.
- `getTimedBodyTemperatureJL` reads `BLE_KEY_TEMPERATURE_MONITORING`.
- The SDK detecting payload is six bytes: `flags,startHour,startMin,endHour,endMin,duration`.

v322 changes:
- Added Mine diagnostic single-command mode `temperatureRealtimeControlEnable` mapped to `temperature/control-enable`.
- Added Mine diagnostic single-command mode `temperatureRealtimeControlDisable` mapped to `temperature/control-disable`.
- Added the two control commands to `scripts/summarize-rw-backend-log.mjs`.

Control commands to test:
- `temperature/control-enable`: `ab010006359f060900080501`.
- `temperature/control-disable`: `ab010006f55e060900080500`.

Next test order:
1. Publish v322 and confirm Mine diagnostics show `rw-visible-build-tag-20260719-322`.
2. Clear logs.
3. Done: test only `体温控制开`.
4. Done: wait 5-10 seconds after control enable, clear logs, and test only `体温实时0230`.
5. Done: clear logs and test only `体温控制关`; the device returned `0x0609` success ACK.

Current conclusion:
- SY03 accepts realtime-temperature control open/close (`0x0609/0x08`), but does not return an app realtime body-temperature value for `0x0230` in this firmware/state.
- Treat body temperature as a firmware/state unsupported data path until an official APP trace or vendor SDK sample shows an extra precondition or a different key.
