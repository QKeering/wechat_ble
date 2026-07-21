# RW Ring Protocol

Source document:

- `E:\qkeer\SDK 文件\RW微信小程序协议开发文档251201.pdf`

Current implemented scope:

- Device detection for RW broadcast examples such as `HR18N` with manufacturer data markers `F802` / `F811`.
- RW scan normalization now parses the `0x52 + mac(6)` advertisement segment into `advertis.macInfo` / `mac`, and scan merge keys include that stable MAC identity like L19.
- RW protocol detection and the RW adapter share the same explicit BH3-name exclusion rule, while unnamed `D606` / `3E000000` advertis-only packets still resolve as RW candidates.
- RW scan lifecycle now mirrors L19: discovery uses duplicate reports plus periodic `getBluetoothDevices()` polling, ignores late device-found events after scanning stops, and clears discovery callbacks/timers when discovery startup fails.
- RW connect/discover now carries scan-origin metadata (`mac`, `uniMacId`, `advertis`) into the ready device and service cache, so bind/reconnect can keep the stable advertisement identity even when WeChat rotates the platform `deviceId`.
- Business-level scan connections use the WeChat platform `deviceId` for BLE connection and keep RW `uniMacId` / `mac` / `advertis.macInfo` as stable identity metadata only, matching L19's separation between connection id and bind identity.
- RW connect timing and parsed-data wait defaults now match L19 defaults: connection waits briefly after BLE creation before service discovery, Android MTU is requested before discovery, `setBLEMTU:fail:internal` is treated as non-fatal during connect/discover, and `waitForParsedData()` defaults to 15 seconds.
- Adapter service caching now mirrors L19: `cacheServiceId(mac, serviceId)` and `getCachedServiceId(mac)` use the shared `deviceServiceCache` storage key, and successful `connectAndDiscover()` stores the discovered RW service id for the connected device id.
- Adapter connection primitives now mirror L19 callback semantics: `setMTU()` is Android-only and Promise-wrapped, `checkByRSSI()` resolves true/false from `uni.getBLEDeviceRSSI`, and `isDeviceConnected()` checks `uni.getConnectedBluetoothDevices` before falling back to RSSI.
- Manual RW `disconnect()` now mirrors L19 by only clearing listeners/current device and closing the BLE connection; unexpected disconnect notifications still flow through the registered BLE connection-state listener.
- BLE UUID candidates extracted from the RW SDK package and real-device testing:
  - Services: `0000a00a-0000-1000-8000-00805f9b34fb`, `0000b00b-0000-1000-8000-00805f9b34fb`
  - Notify: `0000b003-0000-1000-8000-00805f9b34fb`
  - Write: `0000b002-0000-1000-8000-00805f9b34fb`
  - OTA service/characteristic candidates are not used here.
- Frame format: `Frame Type + Frame ID + Cmd + Subcmd + Data`.
  - Time commands:
    - sync time: `cmd 0x10 / subcmd 0x00`
    - read time: `cmd 0x10 / subcmd 0x01`
    - `updateDeviceTime()` now mirrors L19 behavior by syncing time, waiting briefly, then reading device time back for confirmation; `sendNamedCommand(UpdateDeviceTime, payload)` also honors the legacy timestamp + timezone payload shape.
    - low-level legacy `sendCommand(0xa0, 0x00, payload)` honors the same timestamp + timezone payload before RW sync-time plus factory-reset.
- Key protocol commands:
  - AB key reads use the no-CRC App SDK request first for the SY03 path (`AB + op + payloadLen(2 bytes) + payload`). CRC16_X26 AB frames are retained as fallback variants for firmware that expects them.
  - battery: primary request is the RW no-CRC App SDK request `ab010003020310`; if no quick battery packet is parsed and compatibility debug fallback is enabled, the adapter also tries the CRC request `ab010003fca0020310`, the L19-compatible `cmd 0x12 / subcmd 0x00` frame, and older SY03/RW variants `c60100034045020310` and `c60100034045030210`.
  - firmware/software version: primary request is the RW no-CRC App SDK request `ab010003020410`; if no quick version packet is parsed and compatibility debug fallback is enabled, the adapter falls back to the CRC request `ab010003cca2020410`, the L19-compatible `cmd 0x11 / subcmd 0x01/0x00` frames, and older C6 big-endian/little-endian firmware read-key variants, response sample `ab110013xxxx02041002020900300040003330336530303031`.
  - user profile set: payload builder is present for key `0x0206`; payload shape is `[measureUnit, gender, age, heightFloat32LE, weightFloat32LE]`, response ACK parser handles key `0x0206`.
  - health monitoring read:
    - heart rate `0x0216`: `ab0100036cae021610`
    - SpO2 `0x0225`: `ab0100039cba022510`
    - HRV `0x026A`: `ab010003ac8e026a10`
    - stress `0x026B`: `ab0100033c8f026b10`
    - blood sugar `0x026E`: `ab0100036c8c026e10`
  - health monitoring response parser maps `[enabled, startHour, startMinute, endHour, endMinute, interval]`, for example `010000173b1e` means enabled, 00:00-23:59, 30-minute interval.
  - health monitoring interval set/read first tries the historical L19 collect-period frames (`cmd 0x37 / subcmd 0x00` with uint32 seconds and `cmd 0x37 / subcmd 0x01`), then falls back to RW monitoring config writes/reads that convert seconds to RW minutes and use all-day configs for heart rate, SpO2, HRV, stress, blood sugar, blood pressure, and temperature.
  - health data reads are mapped to legacy-style adapter method names, but RW realtime measurement now stays on the RW control plus no-CRC `0x05xx` health-data read path. Realtime reads must not mix in L19 realtime probes (`cmd 0x31/0x32/0x34`) or command storms:
    - `sendActiveMeasureCommand()` -> heart-rate control `0x0609/0x03` plus health-data heart-rate read `ab010003050310`.
    - `sendOxyGenCommand()` -> blood oxygen control `0x0609/0x09` plus health-data blood-oxygen read `ab010003050910`.
    - `sendBodyTemperatureCommand()` -> temperature control `0x0609/0x08` plus health-data temperature read `ab010003050810`.
    - `useRingBLE.readHrv()` / `readStress()` / `readBloodSugar()` / `readBloodPressure()` also send the matching RW control plus no-CRC `0x050A/0x050D/0x0510/0x0504` health-data read when the connected protocol is RW.
    - RW app data control keys: heart rate `0x03`, blood pressure `0x04`, temperature `0x08`, blood oxygen `0x09`, HRV `0x0A`, stress `0x0D`, blood sugar `0x10`.
    - Some SY03 firmware acknowledges `0x0609` with generic packet `ab11000351e6060900`, which omits the metric key. The adapter correlates this ACK with the serialized pending control queue and enriches it with metric name, control key, and enabled/disabled action for store/page diagnostics.
  - historical health data direct/delete compatibility uses the same SDK data keys below. For SY03 foreground measurements they are also the current primary realtime-read keys after enabling `0x0609` control:
    - heart rate `0x0503`
    - blood pressure `0x0504`
    - temperature `0x0508`
    - blood oxygen `0x0509`
    - HRV `0x050A`
    - stress `0x050D`
    - blood sugar `0x0510`
  - Real-device samples verified:
    - heart rate `ab110009a47302240031d5ac6b4100` -> value `65`
    - blood oxygen `ab11000997fc024e0031d5ac7e6300` -> value `99`
  - File-system commands:
    - read file list: `cmd 0x36 / subcmd 0x10`
    - delete local data: primary compatibility request is the L19-compatible `cmd 0x36 / subcmd 0x03`; if no quick delete packet is parsed, the adapter falls back to RW App SDK file-system format `cmd 0x36 / subcmd 0x13`
    - direct format file system: `cmd 0x36 / subcmd 0x13`
    - request upload: `cmd 0x36 / subcmd 0x1A`
  - upload/progress response parsers: `0x1B`, `0x1C`, `0x1D`
- Basic source-data record parser helper for the PPG raw structures shown in the document.
- The shared `syncHistory()` workflow now handles RW as a file-list plus upload sync: it reads `rw_file_list`, filters listed files with `sinceTimestamp` (defaulting to today's zero timestamp) unless `readAll` is enabled, requests upload for each selected file sequence, waits for `rw_upload_file` / progress / last-package events, maps parsed source records into `local_data.records`, calls the shared historical upload hook, and clears RW local files with `rw_format_file_system` when `deleteAfterUpload` is enabled. Filtered results preserve `totalFileCount`, `selectedFileCount`, `filteredFileCount`, `allFiles`, and `sinceTimestamp` so the business layer can distinguish "no RW history files" from "history files exist but are outside the current read range".
- RW `syncHistory()` generated `local_data` packets and upload records are enriched with the current runtime device identity (`deviceId`, `mac`, `uniMacId`, `advertis`) before entering the shared store/upload path, matching L19 parsed packets that already carry current-device identity from the BLE listener.
- Direct RW `readLocalData(options)` / `sendReadLocalDataCommand(sinceTimestamp, readAll)` calls preserve the same L19-style read-range intent on subsequent `rw_file_list` events via `readAll`, `sinceTimestamp`, `allFiles`, `selectedFiles`, `totalFileCount`, `selectedFileCount`, and `filteredFileCount`; the command bytes still use RW's file-list request because the RW protocol does not encode the range in the request frame.
- The legacy `useRingBLE.readLocalData(readAll, time)` compatibility facade now forwards `time` into the shared `sinceTimestamp` option (`'day'`/empty string defaults to today's zero timestamp; number, numeric string, Date, and parseable date strings are normalized to seconds), so RW and L19 receive the same historical read-range intent from old page code.
- RW filtered file lists (`selectedFileCount: 0` / empty `selectedFiles`) are treated as completed empty history reads for the requested range, and the store uses `selectedFiles` instead of all listed files when exposing pending local history records.
- The shared business refresh workflow now triggers a non-blocking RW history snapshot by reading the file list and forwarding `rw_file_list` / `local_data` / `rw_history_pending` status into the common parsed-data stream; command failures and timeouts surface as `rw_history_pending` so `historyStatus` / `historyMessage` stay protocol-independent.
- `sendNamedCommand()` is mapped for old compatibility calls, so legacy command names route to RW battery, version, health data, time, history, collect-period, delete, and reset operations.
- The RW parser now also accepts L19-style response frames as a compatibility fallback for battery, hardware/software version, heart rate, SpO2, temperature, local history, device time, collect-period read/write, local-data delete, and factory reset. These frames are normalized into the same legacy event names (`battery`, `hardwareVersion`, `softwareVersion`, `active_measure`, `active_OxyGenMeasure`, `active_Temperature`, `local_data`, etc.) so old pages and business metrics do not need RW-specific branches.

Pending true-device validation before calling RW/L19 parity complete:

- Build the WeChat experience package from `dist/build/mp-weixin` and verify the original mini-program connection pages, not only protocol unit tests.
- L19 baseline: connect one known-good L19 ring and confirm battery, firmware version, software version, heart rate, and SpO2 still reach the visible page/store fields.
- RW/SY03 baseline: connect one RW/SY03 ring and confirm battery, firmware version, software version, heart rate, and SpO2 reach the same visible page/store fields as L19.
- RW expanded active reads: confirm body temperature, HRV, stress, blood sugar, and blood pressure control+direct-read semantics on real devices.
- RW monitoring config: confirm health monitoring interval read/write behavior for blood pressure and temperature on real devices.
- RW lifecycle/history: real-device test time sync, file list, upload flow, delete/format after upload when enabled, disconnect, reconnect, and scan-origin stable identity after WeChat platform `deviceId` rotation.
