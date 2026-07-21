# Ring BLE SDK Parity

Goal: encapsulate the existing mini-program ring BLE protocol into an SDK while keeping existing behavior unchanged.

Current migration decision:

- Keep old production pages untouched until the latest source pages are confirmed.
- Use `smart-wearable-devices-next/src/pages/ring/business.vue` as the publishable business verification page for the new SDK boundary.
- Keep legacy mini-program entry routes available with the shared unified SDK health entry until full UI migration is safe.
- Finish the legacy SDK boundary and RW second ring protocol SDK behind the same business controller before migrating the full page set.
- Use `docs/RING_BLE_RELEASE_CHECKLIST.md` as the fixed experience-version checklist for L19, SY03, legacy entries, pull-down refresh, and store compatibility verification.

Source reference:

- Old composable: `smart-wearable-devices/src/composables/useRingBLE.ts`
- New SDK entry: `smart-wearable-devices-next/src/composables/useRingBleSdk.ts`
- Store-backed entry: `smart-wearable-devices-next/src/composables/useRingBleStoreSdk.ts`
- Compatibility entry: `smart-wearable-devices-next/src/composables/useRingBLE.ts`
- OTA SDK entry: `smart-wearable-devices-next/src/sdk/ring-ota`
- RW protocol entry: `smart-wearable-devices-next/src/sdk/ring-ble/rw`
- QKeer V2 protocol entry: `smart-wearable-devices-next/src/sdk/ring-ble/qkeer-v2`
- Business verification page: `smart-wearable-devices-next/src/pages/ring/business.vue`
- Legacy route unified SDK entries: `pages/awareness/awareness`, `pages/health/health`, `pages/mine/mine`, `pagesA/mines/connectDevice`, `pagesA/mines/device`, `pagesA/mines/setting`, `pagesA/healths/deviceData`, and `homeDetail/vitalSigns/vitalSigns`
- Legacy routes with pull-down refresh register the unified SDK lifecycle: connected rings refresh business metrics, disconnected pages scan for nearby rings, and the WeChat pull-down animation is always stopped.

## Compatibility Import

New pages can import the legacy composable name while still using the SDK-backed implementation:

```ts
import { useRingBLE } from '@/composables/useRingBLE';
```

`useRingBLE()` delegates to `useRingBleStoreSdk()`, so page code can keep the old composable name during migration while protocol logic remains inside `src/sdk/ring-ble`.

`src/composables/useRingBLE.parity.ts` is both a TypeScript guard and a `verify:ring-ble` runtime guard. It fails if the compatibility entry stops exposing any public key from the old composable return object.

The compatibility entry also exposes `connectedDeviceId` for old test/debug pages that used it as a connection flag.

The same guard also type-checks old call signatures observed in existing pages, including:

- `readLocalData(false)` and `readLocalData(true)`
- `reScan('HR')` and `reScan(['HR', 'IF'])`
- `restartScan()`
- `connectDevice(deviceId)` and `connectDevice(deviceId, deviceName, iosMac)`
- `handleConnectDevice(deviceId, deviceName, iosMac)` and scan-origin calls with the fourth boolean argument
- `discoverServicesAndChars(deviceId)`
- `sendCollectPeriodSettingCommand(1200)`

## Public API Mapping

| Old `useRingBLE` export | New SDK/composable mapping | Status | Notes |
| --- | --- | --- | --- |
| `devices` | `useRingBleSdk().devices` | Covered | Same role: scanned target ring list. |
| `isScanning` | `useRingBleSdk().isScanning` | Covered | Same role: scan state. |
| `initBluetooth` | `initBluetooth` | Covered | Uses `ensureLegacyBluetoothReady()` and adapter init. |
| `startScan` | `startScan` | Covered | Keeps legacy name prefixes by default. |
| `restartScan` | `restartScan` | Covered | Stops then starts scan. |
| `stopScan` | `stopScan` | Covered | Removes device-found listener and stops discovery. |
| `connectDevice` | `connectDevice` compatibility wrapper | Covered | Supports old test-page signature while SDK internals use object params. |
| `handleConnectDevice` | `handleConnectDevice` | Covered | Compatibility wrapper around `connectLegacyRing()`. |
| Scan item metadata | `connectDevice(...sourceDevice)` | Covered | The selected scan item is forwarded into the routed protocol adapter so vendor SDK adapters can reuse advertisement data during connection. |
| `discoverServicesAndChars` | `discoverServicesAndChars` | Covered | Finds legacy BAE8 service and write/notify characteristics. |
| `disconnect` | `disconnect` | Covered | Closes BLE connection and clears runtime state. |
| `reScan` | `reScan` | Covered | Init, stop scan, disconnect if needed, clear data, scan again. |
| `autoConnectLastDevice` | `autoConnectLastDevice` | Covered | Alias for SDK reconnect workflow. |
| `registerGlobalListeners` | `registerGlobalListeners` | Covered | Registers BLE connection-state listener. |
| `cleanup` | `cleanup` | Covered | Stops scan and removes BLE listeners. |
| `isDeviceConnected` | `isDeviceConnected` | Covered | Includes RSSI fallback like old logic. |
| `sendBatteryCommand` | `sendBatteryCommand` | Covered | Command `0x12/0x00`. |
| `sendActiveMeasureCommand` | `sendActiveMeasureCommand` | Covered | Command `0x31/0x00`, payload `0x1e`. |
| `readLocalData` | `readLocalData` / `syncHistory` | Covered | Default reads from today's zero timestamp; `readAll: true` reads full history. |
| `readDeviceTime` | `readDeviceTime` | Covered | Command `0x10/0x01`. |
| `updateDeviceTime` | `updateDeviceTime` | Covered | Writes current timestamp then reads device time after delay. |
| `sendDeleteAllLocalDataCommand` | `sendDeleteAllLocalDataCommand` | Covered | Command `0x36/0x03`. |
| `sendOxyGenCommand` | `sendOxyGenCommand` | Covered | Command `0x32/0x00`, payload `0x1e`. |
| `sendBodyTemperatureCommand` | `sendBodyTemperatureCommand` | Covered | Command `0x34/0x00`, payload `0x00`. |
| `sendFirmwareVersion` | `sendFirmwareVersion` | Covered | Command `0x11/0x01`. |
| `sendSoftwareVersion` | `sendSoftwareVersion` | Covered | Command `0x11/0x00`. |
| `sendResetCommand` | `sendResetCommand` | Covered | Command `0x37/0x02`. |
| `sendCollectPeriodSettingCommand` | `sendCollectPeriodSettingCommand` | Covered | Uses uint32 little-endian seconds, default `1200`. |
| `readCollectPeriodCommand` | `readCollectPeriodCommand` | Covered | Command `0x37/0x01`. |

## Additional SDK Capabilities

- `unbind()` calls the runtime unbind hook, disconnects, and clears runtime state.
- `syncHistory()` waits for `local_data`, calls the upload hook, and can optionally delete local ring data.
- `checkByRSSI()` is exposed for connection confirmation.
- `getCachedServiceId()` exposes the legacy service cache.
- `protocolRegistry.ts` provides protocol detection and registration for future second-protocol routing.
- QKeer V2 is routed through the vendor uni-app SDK copied under `src/sdk/ring-ble/qkeer-v2/vendor`.
- Generic scan results for QKeer V2 `F618` devices now include parsed `advertis` metadata (`deviceType`, `protocolVersion`, `batteryLevel`, `isCharging`, `macInfo`) before being passed into the vendor SDK connection bridge.
- RW history sync reads the file list, requests upload by file sequence, parses upload/progress/last-package frames, and returns unified `local_data.records` through the shared history workflow.
- RW history sync now returns terminal `filtered` when the ring has history files but none match the current time range or type filter, keeping it distinct from a truly empty file list and matching the business-page completed-state text.
- RW `rw_file_list` notifications converted for L19-compatible `local_data` listeners use the same `file_list` / `filtered` / `empty` terminal split as `syncHistory()`, so old pages and the business controller do not disagree on filtered SY03 history.
- RW business metrics treat explicit `local_data.status === "filtered"` as a terminal filtered history state before record-count text, localize the visible filtered message, and still accept older empty-with-filter-count packets for compatibility.
- RW history upload helpers now treat filtered `local_data` aliases as read-complete, matching L19 empty/no-data completion semantics for old page watchers.
- RW filtered `local_data` packets clear the current store `localData` list without deleting uploaded history cache, so old pages do not show stale RW history rows for a read range that produced no selected files.
- RW Store SDK local history aggregation now treats appended empty/filtered history packets as a reset point, so previous RW `receivedData` entries are not re-exposed after the current read range returns no selected files.
- RW history `local_data` packets and upload records are stamped with the current runtime device identity before store/upload handling, so late or filtered history results follow the same device-ownership rules as L19 parsed packets.
- RW history submissions use only the current RW stable identity (`mac`, `advertis.macInfo`, or `uniMacId`) and refuse stale cached `normalMac` fallback when the current RW identity is missing.
- Local RW unbind matching also ignores random platform `deviceId` / `uniMacId` values and clears only by stable `mac`, `advertis.macInfo`, or colon-form BLE MAC identity, while legacy/L19 keeps its original fallback matching.
- RW history `deleteAfterUpload` now waits for the L19-compatible `delete_all_local_data` alias and leaves raw `rw_format_file_system` events to the adapter, so upload-delete completion follows the same business event contract as L19 without duplicating format acknowledgements.
- RW compatibility `sendNamedCommand()` routes old command names to RW-specific battery, version, live health data, time, history, collect-period, delete, and reset commands.
- RW compatibility also guards the low-level legacy `sendCommand(cmd, subcmd, payload)` path for every `LegacyRingCommand`, so old callers that bypass command names still hit the same L19-equivalent primary frame before RW-native fallback.
- RW metric reading helpers accept `receivedAt` / `received_at` / `parsedAt` as fresh realtime packet timestamps, so RW packets without legacy `timestamp` fields are not filtered out after an active measurement request.
- RW metric reading helpers filter received realtime packets by current protocol and stable device identity when those fields are present, so stale L19/qkeer-v2 packets or another SY03 with a newer timestamp cannot be submitted as the active RW measurement result.
- RW metric reading helpers also parse realtime `data` byte arrays for heart rate, blood oxygen, temperature, HRV, stress, and blood sugar, matching the business metrics parser while still ignoring RW status-only bytes.
- RW metric reading helpers accept unit-suffixed realtime strings such as `72 bpm`, `98%`, and `36.7°C`, while still refusing paired blood-pressure strings such as `121/80` as scalar values.
- Legacy/L19 active measurement helper branches normalize unit-suffixed numeric strings before returning values to old pages, so submissions use numeric fields instead of raw display text.
- Legacy device-data measurement now resets local measurement values before both direct and restored connections, and rehydrates the report query from the unified metric helpers before opening `healthReport`, so RW/SY03 and L19 reports use the same latest returned metrics instead of stale or partially populated page refs.
- Legacy vital-sign single-metric measurement cards now exit the measuring state with a visible "no valid value returned" toast when RW/SY03 or L19 returns no realtime value, and still avoid submitting placeholder zero records.
- RW adapter exposes protocol-specific SDK methods through the unified adapter: `readRwHealthData`, `deleteRwHealthData`, `controlRwHealthData`, `readRwMonitoringConfig`, `setRwMonitoringConfig`, `setRwUserProfile`, and `formatRwFileSystem`.
- RW App SDK health method alignment: `getTimedHeartRateJL`, `getTimedBloodOxygenJL`, `getTimedHRVJL`, `getTimedStressJL`, `getTimedBloodSugarJL`, `getTimedBloodPressureJL`, and `getTimedTemperatureJL` map to RW monitoring reads; the matching `setTimed*JL` methods, including `setTimedTemperatureJL`, map to RW monitoring writes; `controlHealthDataJL` maps to RW real-time health control; `syncAllHealthData` and `syncHealthDataByType` map to the RW file-list/upload history flow.
- RW native App SDK methods intentionally deferred until complete key documentation is available: alarms, vibration count, screen brightness, raise-to-wake, camera control, find-device, sport/workout, message push, Muslim time/count modes, and power-off. These are not required for the current mini-program scan/connect/health-data flow and should not be guessed from native SDK method names alone.
- Bound devices now persist `protocol` and `deviceId`; reconnect switches to the proper protocol adapter before attempting connection.
- Reconnect also refreshes the stored service/characteristic metadata after discovery, avoiding stale write/notify ids after WeChat or the OS recreates a BLE session.
- Legacy awareness/mine pages no longer call `isDeviceConnected()` with a bound stable MAC when runtime `deviceInfo.deviceId` is missing; they restore through the SDK reconnect path so RW stable identities are not mistaken for platform BLE connection ids.
- Legacy vital-sign detail page now also restores through the SDK reconnect path before refreshing metrics when the runtime WeChat platform `deviceId` is missing or disconnected, so bound SY03/RW devices are not skipped after app resume or BLE id rotation.
- Legacy device settings page now restores a bound RW/L19 device through the business controller before reading battery and firmware/software versions, so SY03 is not left showing disconnected or stale version data after resume.
- Legacy function settings page now configures health monitoring through the business controller and routes history sync to `pagesA/healths/deviceData`, so RW/L19 use the same SDK command path instead of static release-page copy.
- Legacy, RW, and QKeer V2 adapters all report BLE disconnection into the unified SDK runtime. The runtime clears `deviceInfo`, resets upload state, and updates reconnect result so old pages reading store connection state do not keep a stale "connected" UI.
- Scanning while connected keeps the current adapter instead of silently switching back to legacy, so connected RW/QKeer V2 sessions keep using the correct command path.
- RW and QKeer V2 business scans with `includeUnknown` also keep legacy/RW/QKeer V2 ring candidates in the list, so the user can switch between SY03, L19, and V2 rings from the same business page.
- The formal business device list excludes confirmed false-positive `BH3` names, including common suffix variants like `BH3-001`, even if low-level protocol detection can still classify them for internal diagnostics.
- Connecting a different ring through the unified SDK explicitly disconnects the current ring before switching adapters, preventing stale BLE sessions and delayed packets from a previous device.
- While connecting, the unified SDK tracks the expected target ring and ignores stale ready callbacks from another protocol/device, so auto-restore or delayed connection events cannot replace the manually selected SY03/L19 session.
- Business pages use the same SDK device-matching helper as the connection workflow, so `deviceId`, `uniMacId`, and `mac` matches all identify the current ring in scanned lists.
- The shared device-matching helper now rejects matches when both sides have explicit but different protocols, so L19 and RW/SY03 cannot be treated as the same ring just because a platform id or stable MAC tail overlaps.
- The shared device-matching helper only uses last-6-hex fallback matching for stable identity fields, not arbitrary platform `deviceId` values, so RW scan id rotation does not introduce false same-device matches when two random ids share a suffix.
- Device lookup hints keep platform `deviceId` separate from stable `mac` / `uniMacId` fields, so helper calls cannot accidentally re-enable random-id tail matching by promoting a WeChat id into MAC identity slots.
- The legacy `useRingBLE` compatibility wrapper follows the same rule when resolving scanned devices: normalized full stable MACs can still find RW/SY03 scan rows, but arbitrary platform ids are not treated as MAC/uniMacId aliases.
- Shared business-data display helpers use the same stable identity priority (`mac`, then `advertis.macInfo`, then `uniMacId`, then platform `deviceId`), so RW/SY03 pages and AI context do not show or key off a random iOS/platform id when advertisement identity is available.
- The legacy `useRingBLE()` `iosMacId` alias now follows the same RW stable identity priority, so old pages do not display or submit a random iOS/platform `uniMacId` when RW advertisement MAC metadata is present.
- Parsed packets with a mismatched `deviceId` or protocol are dropped by the unified SDK entry so delayed data from a previous ring does not overwrite the current business page.
- Parsed packets are also dropped after the current device identity has been cleared, including identity-less RW pending/status packets, so disconnect/clear cannot be undone by late BLE notifications.
- Store-level appended parsed packets now use the same parsed-data key replacement as `handleParsedData`, so repeated RW realtime packets replace the same metric while preserving other metrics, matching L19's latest-value behavior.
- Store-level history/local-data dedupe now includes protocol and stable device identity, and `local_data` records inherit parsed-level RW identity before dedupe, preventing same-time metrics from another ring from being collapsed into the current ring.
- `App.vue` keeps the old lifecycle behavior: `onShow` attempts Bluetooth initialization through `useRingBLE()`, while `onHide` resets the store Bluetooth-ready flag without forcibly disconnecting the current device.
- `useRingBleStoreSdk()` synchronizes SDK state into Pinia and provides local API placeholders for bind/upload.
- The local bind/upload fallback in `src/api/ringDevice.ts` keeps protocol and characteristic metadata, backfills parsed-level RW stable identity into identity-less history records before dedupe, and caps stored fallback history to the latest 200 records.
- Bound devices also persist scan advertisement metadata when available. Auto reconnect forwards the stored device metadata back into the active protocol adapter, which helps SDK-backed protocols reuse bridge data after app resume.
- RW `advertis.macInfo` is treated as a first-class stable identity in the SDK helpers and legacy `useRingBLE` aliases, so old pages can still resolve `normalMac` / `iosMacId` and match scan candidates when WeChat rotates the platform `deviceId`.
- Unified SDK connect and RW scan-first reconnect also copy `advertis.macInfo` into legacy-compatible `uniMacId` / `mac` identity fields, so scan-origin restores carry the same stable RW identity shape as L19-compatible pages expect.
- Legacy device API `getBindInfo()` uses the shared bound-identity helper, so RW bindings that only retain `advertis.macInfo` are still considered valid and are not cleared before SDK reconnect can restore them.
- Legacy mine, awareness, and device settings pages also use the shared bound-identity rule when restoring or displaying a bound ring, so an RW/SY03 binding that only retains `advertis.macInfo` follows the same restore path as L19.
- Legacy no-binding and unbind paths now clear both the user compatibility facade and the unified business ring store, so RW/SY03 and L19 cannot keep stale current-device or health snapshots after a binding disappears.
- Family elder-mode binding display uses the same shared bound-identity rule, so RW/SY03 devices stored with only `advertis.macInfo` are shown as bound like L19 devices.
- Family member-detail binding display also uses the shared bound-identity rule and the family dashboard device type accepts RW identity metadata, so RW/SY03 bindings do not have to expose a top-level `mac` to look bound.
- Family member-list display and family-device binding payloads now carry the same RW identity metadata (`deviceId`, `uniMacId`, `protocol`, `advertis.macInfo`) and use the shared bound-identity rule, so parent/guardian flows do not fall back to L19-only `deviceMac` checks.
- Store bridge parsed-data filtering also accepts normalized MAC identity and the last 6 hex digits, so RW packets tagged with `00:05:1B` still belong to a current device whose scan identity is `3E:00:00:00:05:1B`.
- Store bridge local-history filtering now carries the parsed record protocol into device matching, so L19/qkeer-v2 history packets with an overlapping platform id or stable MAC cannot populate the active RW local-data list.
- RW connect/discover preserves scan-origin `advertis.macInfo` into the ready device, bind payload, and service cache, so reconnect does not fall back to the random platform `deviceId` after a successful connection.
- RW history and metric submission helpers prefer the stable RW `mac` / `advertis.macInfo` over a random platform id, while the store-backed SDK only fills `normalMac` from advertisement data when the existing `normalMac` is empty or belongs to another device.
- Business scan connections keep the WeChat platform `deviceId` as the BLE connection id and carry RW `uniMacId` / `mac` / `advertis.macInfo` only as stable identity metadata, preventing SY03 stable MAC values from being passed to `createBLEConnection`.
- The ring debug page follows the same RW scan-origin rule: it requires the scanned WeChat platform `deviceId` for RW connections and carries the SY03 stable identity only as metadata.
- The shared connect workflow parity guard now asserts RW bind/ready payloads keep the WeChat platform `deviceId` for BLE while binding `mac` to the stable RW advertisement identity.
- Legacy `useRingBLE` scan-origin RW connections now refuse to call BLE connect with only a stable RW advertisement identity when the short compatibility scan cannot find a WeChat platform `deviceId`; the user should re-search so the connection path matches L19's scan-selected device flow.
- RW auto-reconnect scans first and, when identity-only stored records cannot be matched to a WeChat platform `deviceId`, fails cleanly instead of falling back to direct `createBLEConnection` with the stable advertisement MAC.
- RW cold auto-reconnect now keeps the target protocol while scanning, so a stored SY03/RW binding with an empty current device state uses the RW scan adapter and reconnects through the fresh WeChat platform `deviceId` instead of falling back to the legacy cold-scan adapter.
- RW identity-only reconnect misses now clear runtime device, received, and normalized data while keeping the bound record available for the next scan, matching L19's visible disconnected state after restore failure.
- RW scan-first reconnect also fails cleanly and stops scanning when a scan candidate is found but the platform `createBLEConnection` / discovery step fails; if the stored record still has service/characteristic metadata, the SDK restores the original reconnect target before direct fallback, matching L19's non-throwing auto-reconnect status behavior.
- RW connection attempts now expire when the business layer cancels or disconnects; a delayed successful WeChat BLE callback is rejected and cannot refresh the SDK communication-ready timestamp after the visible connection flow has already failed.
- RW cleanup, unbind, and direct compatibility discovery calls share the same expiry guard, so delayed RW service discovery cannot repopulate the current device after a legacy page has been unloaded or cleared.
- RW communication-restore and auto-reconnect paths also share a lifecycle-expiry guard, so delayed notify restore or direct reconnect fallback cannot mark success after cleanup, page unload, or device clearing.
- RW utility checks match the current device by stable `mac` / `advertis.macInfo`, but `checkByRSSI()` and `isDeviceConnected()` call WeChat with the current platform `deviceId`, matching L19's RSSI fallback without passing SY03 stable MAC values into platform APIs.
- SDK device tools treat an explicit RW service UUID as the strongest protocol signal before stale scanned/current protocol metadata, so old-page `isDeviceConnected()` / notify helpers do not fall back to the legacy adapter when the page is checking an SY03 service.
- RW store health snapshots and local-history dedupe keys also prefer stable `mac` / `advertis.macInfo` over platform `deviceId`, so an SY03 can keep same-device metrics/history across WeChat BLE id rotation while still clearing data when the stable MAC changes.
- The formal `pagesA/mines/connectDevice` confirmation flow resolves the latest scanned business device with the shared stable-identity matcher before connecting, so RW/SY03 platform-id rotation follows the same selected-device behavior as L19.
- The formal connection page and business controller now prefer RW stable `mac` / `advertis.macInfo` over random `uniMacId` for confirmation metadata and iOS list display, while still using the WeChat platform `deviceId` for the actual BLE connection.
- Unified SDK and legacy `useRingBLE()` connect targets also prefer RW stable `mac` / `advertis.macInfo` before random `uniMacId` metadata, so non-formal callers cannot reintroduce random identity binding while the platform `deviceId` remains the BLE connection id.
- RW adapter ready payloads and service-cache keys follow the same stable identity priority after discovery, so a scan row carrying random `uniMacId` metadata cannot overwrite the stable `advertis.macInfo` identity used for reconnect/cache behavior.
- RW bind payloads, ready-device aliases, history `local_data`, and the local fallback history store now also write `uniMacId` from stable `mac` / `advertis.macInfo` when available, preventing old compatibility fields from carrying random platform identity after SDK parsing.
- RW business metric snapshot merging keeps the last valid heart-rate and blood-oxygen values plus their returned-data status when a later realtime read only reports pending/requested, matching L19's stable display behavior on release pages.
- RW business metric snapshot merging applies the same pending/requested protection to temperature, HRV, stress, blood sugar, and blood pressure, so later SY03 realtime retries do not overwrite existing valid values or statuses with "waiting" text.
- RW business metric status text hides internal timeout, listener cleanup, and communication-not-ready messages from release pages, while keeping L19-style pending text for visible SY03 health, battery, and monitoring states.
- RW status-only health-data NACK packets also resolve the matching L19-compatible realtime metric alias, so old pages see an explicit SY03 failure status instead of waiting for a timeout when the device rejects a measurement request.
- RW failed realtime-control ACK packets resolve the same L19-compatible metric aliases as health-data NACK packets, so SY03 command rejection does not leave old pages waiting for a measurement timeout.
- RW adapter parity now covers direct active-control/read command paths for blood sugar alongside SpO2, HRV, stress, and blood pressure, keeping old extended measurement entries on the same guarded RW SDK path.
- RW history records with semantic `dataType` / `rawDataType` now backfill the same business metrics as L19 even when the parsed record only has a generic `value`, covering heart rate, blood oxygen, temperature, HRV, stress, blood sugar, blood pressure, and steps.
- RW text history uploads now accept key/value rows in `key=value`, `key:value`, and spaced `key: value` forms, such as `time=... sbp=120 dbp=79` or `time: ... hr: 73`, plus paired blood-pressure strings such as `bp=120/79`; these normalize into the same business metric objects used by L19-style history.
- RW key/value text history now treats metric field aliases as case-insensitive and can infer visible metrics from semantic fields such as `HR`, `SpO2`, `Temp`, or `BP` even when the uploaded file name is generic, matching L19's page-level expectation that health fields surface by meaning rather than file naming alone.
- Business metric history aggregation also treats record aliases and type metadata case-insensitively, so RW records entering through parser, unified `local_data`, or App-SDK-style beans can still backfill L19-visible fields when keys are mixed-case, for example `HR`, `SpO2`, `Temp`, `BP`, `DataType`, or `RawDataType`.
- History upload submission now uses the same case-insensitive alias normalization, so RW records with mixed-case keys such as `HR`, `SpO2`, `BodyTemp`, `BP`, `PPG`, `RecordTime`, `DataType`, and `RawDataType` are submitted through the L19-compatible backend field names instead of being displayed locally but omitted from upload payloads.
- Local fallback history storage and Pinia history merging use the same case-insensitive record-time and metric-identity keys, so RW records with `DataType` / `dataType` or `RecordTime` / `recordTime` variants dedupe like L19 records instead of appearing twice in cached history.
- RW key/value text-history parity now covers heart rate, SpO2, temperature, HRV, stress, blood sugar, and step files through parser, normalizer, and business metrics, matching the L19 history backfill path for visible health fields.
- RW text history uploads also accept a whole-file JSON array such as `[{"time":"...","hr":72}]`, so SDK-exported history files do not have to be split into one JSON object per line before entering the L19-compatible business backfill path.
- RW history blood-pressure records also accept byte-pair arrays from `value` or raw `data`, mapping them to L19-compatible `systolic` / `diastolic` upload fields.
- RW history sleep records accept snake_case state and duration aliases such as `sleep_state`, `sleep_status`, `sleep_stage`, `sleep_type`, and `total_sleep_time`, mapping them to L19-compatible `sleepState` / `sleepDuration` upload fields.
- RW history uploads accept the same common metric aliases used by business snapshots, including `hr`, `heartrate`, `bo`, `blood_oxygen`, `bloodOxy`, `heart_rate_variability`, `stress_index`, `pressure`, `body_temperature`, `bodyTemp`, `skin_temperature`, `step_count`, `totalSteps`, `high_pressure`, and `low_pressure`.
- RW notify parsed packets and `syncRwHistoryFiles()` unified `local_data` results now carry the current stable `mac` / `advertis.macInfo`, so SDK-level RW history and live events preserve the same device identity before store/upload fallback handling.
- RW business refresh no longer duplicates parsed packets that the RW adapter has already emitted, matching the L19 listener model where one notify packet enters the unified store once.
- RW business refresh now reports `collect_period` when monitoring config returns quickly, while still falling back to non-blocking `collect_period_pending` when the device is slow, matching L19 success semantics without reintroducing a stuck refresh.
- RW multi-service discovery now keeps trying other candidate services when one service's characteristic read fails, so SY03 connection can still complete when WeChat exposes a stale or inaccessible service before the usable write/notify service.
- RW connect/discover and direct RW `setMTU()` calls treat Android `setBLEMTU:fail:internal` as non-fatal, so SY03 can continue service discovery/notify setup when the BLE link is otherwise usable.
- RW communication restore re-discovers services when a cached/bound SY03 has core write/notify fields but lacks a usable `notifyCandidates` discovery snapshot, including empty notify-candidate arrays and platform-ID-only states without a stable MAC, then restores primary and alternate notify channels before command reads continue.
- RW battery reads first send the L19-compatible `0x12/0x00` battery frame used by the earlier manually verified mini-program flow, then fall back to the RW App SDK read-key command and known SY03/C6 battery command variants when no quick battery reply arrives.
- RW firmware/software reads first send the L19-compatible `0x11/0x01` / `0x11/0x00` frames used by the old mini-program, then fall back to the RW App SDK firmware read-key command, so historical SY03 firmware can return version fields through the same L19 event contract.
- RW realtime reads for heart rate, blood oxygen, and temperature first send the L19-compatible `0x31/0x00`, `0x32/0x00`, and `0x34/0x00` frames used by the old mini-program, then fall back to RW App SDK control/read pairs when no quick legacy packet arrives.
- RW business refresh now treats L19-compatible realtime alias events (`active_measure`, `active_OxyGenMeasure`, `active_Temperature`) as valid returned RW metric values, so historical SY03 firmware that answers the old frames completes the same heart-rate/blood-oxygen refresh steps as L19.
- RW business refresh now actively calls the temperature command after heart-rate and blood-oxygen refresh commands, matching L19's realtime refresh sequence and giving SY03 firmware a direct chance to answer the old `0x34/0x00` temperature frame before RW native fallback paths.
- RW collect-period read/write first sends the L19-compatible `0x37/0x01` / `0x37/0x00` frames used by the old mini-program, then falls back to RW App SDK monitoring config read/write when no quick legacy packet arrives.
- RW local-data delete first sends the L19-compatible `0x36/0x03` frame used by the old mini-program, then falls back to RW App SDK file-system format `0x36/0x13` when no quick legacy delete acknowledgement arrives; direct `formatRwFileSystem()` remains native RW-only.
- RW low-level `sendCommand(0xa0, 0x00, payload)` now preserves the legacy timestamp/timezone payload before issuing the RW sync-time plus factory-reset sequence, matching L19 callers that bypass the named reset helper.
- RW BLE connection-state callbacks now filter by the runtime current device id like L19, so adapter restore/recreation does not treat an unrelated BLE disconnect as the active SY03 disconnect.
- RW connection-state listener registration now clears the previous global BLE listener before registering, matching L19 and preventing stale protocol listeners after adapter switching.
- RW `clearDataListener()` now clears pending L19-compatible alias state for firmware, metrics, collect-period, history, and delete events, so stale SY03 packets from a previous listener/session cannot be emitted as new L19-style results.
- RW `openBluetoothAdapter()` now matches L19 as a pure adapter open; `initBluetooth()` remains responsible for registering the connection-state listener.
- RW connect, auto-reconnect, and communication-restore paths re-register the active protocol connection listener after adapter switching, so RW owns disconnect events after the legacy adapter has been cleaned up.
- Legacy measurement submission pages, including `pagesA/healths/deviceData.vue`, route through the shared submit-MAC helper so RW uploads use the same stable identity rule as L19, and RW submissions now require a current-device stable identity instead of falling back to stale store-only `normalMac` or platform-random `deviceId`.
- Default `useRingBleStoreSdk()` calls share one SDK instance, so legacy entry pages keep the same BLE adapter, connection state, and command path when users move between old routes. Calls with custom options still create isolated instances for tests or special flows.
- `useRingBusinessController()` exposes protocol-independent scan, connect, refresh, refresh-result, history-sync result, and metric state for migrated business pages.
- Default `useRingBusinessController()` calls share one business controller instance, so legacy entry pages keep the same refresh, history, and in-flight status when users move between old routes. Calls with custom options still create isolated instances for tests or special flows.
- `useRingBusinessController()` shares in-flight restore attempts, so page `onMounted`, page `onShow`, and app resume paths do not start duplicate BLE reconnect/refresh flows.
- `useRingBusinessController()` settles hanging refresh, health-monitoring setup, and history calls with business-level timeout results, so pages do not stay in a permanent "refreshing" or "syncing" state when a BLE command never resolves.
- `useRingBusinessController()` also records a visible failed history result when history sync rejects, so RW/SY03 pages leave "syncing" and show a readable history failure while preserving the existing page error toast path.
- `useRingBusinessController()` now restores the last bound device before history sync and health-monitoring setup, and fails without issuing history read or collect-period commands when communication fields are incomplete, so RW/SY03 and L19 do not start half-ready upload or monitoring flows from formal pages.
- `useRingBusinessController()` cancels stale refresh and history writes when the user clears data, disconnects, or switches devices, preventing late BLE results from overwriting the current page state.
- `useRingBusinessController().refreshDeviceInfoData()` now follows the same restore-or-fail rule before reading battery and firmware/software versions, and stale device-info reads cannot rewrite the visible refresh result after clear/disconnect.
- `useRingBleStoreSdk().clearData()` clears SDK refs and Pinia business metrics synchronously, so quick RW/SY03 retries or device switches do not briefly read stale L19/RW battery or version snapshots while Vue watchers catch up.
- RW empty-refresh recovery requeues when a retry timer fires during an in-flight refresh, so slow SY03 battery/version responses are retried or escalated to the visible reconnect hint instead of being silently abandoned.
- `useRingBusinessController()` also watches the current ready device identity, so an in-flight RW refresh/history result from one ready SY03 is ignored if the SDK switches to another ready ring before the request settles.
- `useRingBusinessController()` also swallows errors from stale cancelled refresh/history requests, so a late RW communication-not-ready or history-sync failure after device clearing cannot bubble into release pages or overwrite the cleared state.
- Legacy, RW, and QKeer V2 parsed-data waiters attach a background rejection handler, so business-level timeouts can abandon stale waits without a delayed BLE packet timeout surfacing as an unhandled page error.
- Legacy, RW, and QKeer V2 parsed-data waiters are cleared immediately on listener cleanup/disconnect, so page unloads, manual disconnects, and protocol switches do not leave abandoned reads waiting for their full timeout.
- Shared ring page pull-down refresh is guarded to refresh when connected, restore/scan when disconnected, and always call `uni.stopPullDownRefresh()` from `finally`, matching L19 release-page behavior for RW/SY03.
- Formal source files with `onPullDownRefresh` are now covered by a release parity guard that requires `finally` plus `uni.stopPullDownRefresh()`, so scattered legacy pages cannot regress into a stuck WeChat pull-down animation.
- `useRingBusinessData()` forwards device, parsed, and normalized data through Pinia `storeToRefs`, so migrated pages receive live business values instead of store snapshots.
- The `pages/health/growth-girlfriend` extension page is guarded to read health data through `useRingBusinessData()` and pass `businessDataFreshnessText`, data age, stale state, and current device identity into AI chat context instead of reading protocol-specific stores directly.
- Business pages should render `businessDevices`, while debug pages can still render all scanned BLE devices.
- `stores/user.ts` is a compatibility facade for old pages that still import `useUserStore`; BLE-related fields delegate to `stores/ring.ts`.
- `stores/user.ts` forwards BLE fields through Pinia `storeToRefs`, so old pages keep receiving live reactive values instead of a snapshot.
- `stores/user.parity.ts` guards old BLE store fields, update methods, and runtime status delegation used by existing pages.
- `stores/ring.ts` and the `stores/user.ts` facade expose `healthData` as a protocol-independent compatibility object, including legacy aliases such as `heart_rate`, `blood_oxygen`, and `spo2` mapped from unified SDK metrics.
- Legacy clear calls such as `updateDeviceInfo({})` followed by `updateReceivedData([])` now clear normalized data, local history, metric snapshots, and freshness timestamps too, so L19/RW health values cannot leak after logout, disconnect, or device switching.
- Shared frontend binding cleanup also resets `ringStore.boundDevice` and runtime business data when called by legacy release pages, keeping user-store compatibility state and unified SDK state aligned.
- WeChat location permission is declared in `src/manifest.json` with both `scope.userLocation.desc` and `requiredPrivateInfos: ["getLocation"]`, matching the Bluetooth scan permission flow.
- `src/manifest.json` keeps the existing WeChat appid and `lazyCodeLoading: "requiredComponents"` so the real-device package matches the old mini-program app and subpackage loading behavior.

## Store Compatibility

Old pages commonly read these user-store fields:

- `deviceInfo`, `receivedData`, `localData`, `normalMac`, `lastReadTimestamp`
- `iosMacId`, `deviceTime`
- `isBluetoothReady`, `isReconnecting`, `isUploading`, `isManualReconnecting`, `isUnbinding`
- `reconnectResult`

The new ring store provides the same BLE-related state and update methods. It also keeps old direct handlers:

- `handleParsedData(parsed)`
- `updateIsConnected(boolean)`
- `updateIosMacId(value)`

Legacy status strings are accepted:

- Reconnect: `'0' -> idle`, `'1' -> reconnecting`, `'2' -> success`
- Upload: `'0' -> idle`, `'1' -> uploading`, `'2' -> success`

## Device API Compatibility

Old pages import device APIs from `@/common/api/device`. The new project provides a compatibility module at the same path:

- `bind(params)`
- `unbind(params)`
- `getBindInfo()`
- `scan({ sn })`
- `deviceModelList()`
- `getInfo()`
- `getOtaInfo({ currentVersion, deviceModel })`

`bind`, `unbind`, and `getBindInfo` delegate to the local ring-device API placeholder. `scan`, model list, device info, and OTA info currently return safe local placeholder data so migrated pages can compile before the real backend client is wired.

`src/common/api/device.parity.ts` guards the old call signatures.

## OTA Compatibility

Old OTA pages import:

```ts
import RingOTAManager from '@/composables/ring-ota-manager';
import { getOtaInfo } from '@/common/api/device';
```

The new project keeps both paths compatible:

- `src/composables/ring-ota-manager.ts` re-exports the isolated OTA SDK from `src/sdk/ring-ota`.
- `RingOTAManager.start(deviceId, hexString, onProgress)` keeps the old call shape.
- OTA UUIDs and response codes are exported from `src/sdk/ring-ota`.
- `getOtaInfo(params, { custom: { returnAll: true } })` returns the old-style `{ code, data, msg, message }` shape.

OTA is intentionally not merged into the normal ring BLE SDK. APP-mode ring communication and BOOT-mode firmware transfer use different services and failure handling, so keeping them separate reduces risk when third-party SDKs are added later.

## Verification Gates

Run after each migration step:

```bash
npm run verify:ring-ble
npm run type-check
npm run build:mp-weixin
```

`verify:ring-ble` executes parser and protocol parity samples through esbuild and Node. It currently guards:

- Legacy display output for battery charging text, active-measure status text, and temperature unit.
- Collect-period decoding.
- Command bytes for battery, active measure, collect-period write, incremental/full history reads, and device-time write.
- Device-time command map values.
- App lifecycle BLE initialization and hide-state reset compatibility.
- WeChat manifest appid, location permission, required private info, and lazy-code-loading settings.
- Protocol registry defaults, RW detection, and QKeer V2 routing samples.
- RW frame builders/parsers for time and file-system commands.
- Legacy `@/common/api/device` facade signatures.
- Local bind/history-upload fallback persistence, deduplication, and latest-record cap.
- Legacy `useRingBLE()` compatibility entry runtime shape and old call signatures.
- Default `useRingBleStoreSdk()` singleton behavior and custom-options isolation.
- `useRingBusinessController()` business-page entry runtime shape, supported-device filtering, singleton state sharing, custom-option isolation, stale-request cancellation, and clear-state behavior.
- Business refresh, health-monitoring setup, and history sync timeout settling, covering BLE promises that never resolve.
- `useRingBusinessData()` live device and health-data refs used by migrated read-only business pages.
- Legacy user-store facade signatures and live BLE status delegation.
- OTA HEX parsing and OTA UUID/response-code constants.
- Legacy route registration, page file existence, and `RingUnifiedHealthEntry` usage for the first real-device test entry points.
- Business page `onShow`/`onMounted` restore behavior and duplicate restore suppression.
- Shared legacy entry `RingUnifiedHealthEntry` exposes recovery actions for stop scan, clear data, and disconnect, matching the standalone business page.
- Shared legacy route files register unified SDK pull-down refresh so old mini-program gestures drive the same scan/refresh controller.

## QKeer V2 SDK Progress

Compiled and routed:

- Vendor SDK staged at `src/sdk/ring-ble/qkeer-v2/vendor`.
- Vendor SDK local fixes: connection-failure cleanup uses the selected device id, notify characteristic lookup no longer depends on characteristic order, and single-measure command keeps the requested measure type instead of overwriting it with the open flag.
- Protocol detection by `MUSLEEP_RING`/`QKV2` name prefixes, `QK-V2` productId, and advertised service marker `F618`.
- Scan/connect bridge wraps the vendor SDK and exposes the same adapter contract used by legacy and RW.
- Device info maps to battery and firmware metrics.
- Active measure maps to heart rate and blood oxygen metrics.
- Latest-data and heartbeat packets map battery, heart rate, blood oxygen, temperature, steps, sleep summary, fatigue, and anxiety when returned by the vendor parser.
- Health-list, step-list, and sleep-list history are wired as explicit `qkeer_v2_health_list`, `qkeer_v2_step_list`, and `qkeer_v2_sleep_list` parsed data, and they also feed unified business metrics where possible.
- QKeer V2 health-list history backfills the unified business metrics with the latest heart-rate, blood-oxygen, and temperature record; step-list history backfills the latest step value.
- ECG and enhanced-sleep setting/read packets are surfaced as protocol parsed data, but not interpreted into business UI metrics until real-device payloads are confirmed.
- Vendor parser fixes are applied for single health, step, and sleep packets where the original SDK referenced an undefined `offset`.

Needs real-device verification before replacing old pages:

- QKeer V2 appears in `pages/ring/business.vue` device list as protocol `qkeer-v2`.
- Connection succeeds and the current-device panel shows service/connection state through the vendor SDK.
- Refresh business data returns battery and firmware first.
- Heart-rate and blood-oxygen commands return real values, not only pending/status text.
- Temperature appears if the device supports it; otherwise it should remain a non-blocking status.
- Local-history health list returns records before enabling upload/delete behavior.
- Step-list and sleep-list records can be requested and retained in received/normalized data.
- ECG and enhanced-sleep values should be verified against the vendor app before user-facing display.

## RW Real-Device Progress

Verified on SY03:

- Device scan and connection through RW service `0000A00A-0000-1000-8000-00805F9B34FB`.
- Write characteristic `0000B002-0000-1000-8000-00805F9B34FB`.
- Notify characteristic `0000B003-0000-1000-8000-00805F9B34FB`.
- Battery and firmware read.
- Heart-rate real-time command through app-data control key `0x0609`, returning real measurement values.
- Blood-oxygen real-time command through app-data control key `0x0609`, returning real measurement values.
- Temperature currently displays a status text because this RW device did not return a confirmed real-time temperature value.
- HRV, stress, blood sugar, and blood pressure are exposed as passive/non-blocking RW metric statuses when only monitoring config or request acknowledgement is available. They are not treated as failed active real-time reads unless a real payload is later verified.

Business page expectation:

- `pages/ring/business.vue` should show battery, firmware, software, heart rate, blood oxygen, temperature status text, and passive metric statuses from `ring.metrics`.
- The refresh result panel should show successful steps and any non-blocking failed steps.
- The history result should show legacy record count or RW file-list/pending status.

Current known non-blocking build output:

- Sass legacy JS API deprecation warning from dependencies.
- `os - Alias not found.` emitted by the uni build environment.

## Still Needs Real Device Verification

These are covered in code but need device testing before replacing old pages:

- WeChat permission flow on Android and iOS.
- iOS MAC-to-UUID conversion during scan-to-connect.
- Reconnect after forced BLE disconnect.
- Full local-history read vs today's-history read.
- Upload success followed by optional local data deletion.
- Legacy vital-sign measurement buttons and submissions route through the shared submit-MAC helper, so RW can use stable MAC/advertis `macInfo` instead of a platform-random `deviceId`, and submit is blocked from reusing stale store-level `normalMac` after a device switch or identity reset.
- Device time write/read round trip.
- Factory reset and experimental reset-with-time command.
- RSSI fallback connection detection.
- OTA firmware download source, BOOT-mode scan/connect, packet transfer, reboot, and reconnect to APP mode.

## Observed Old Page Call Sites

The old mini-program uses `useRingBLE` or BLE store state in these areas:

- App lifecycle: `App.vue`
- Main ring pages: `pages/awareness/awareness.vue`, `pages/mine/mine.vue`, `pages/health/health.vue`
- Device settings: `pagesA/mines/connectDevice.vue`, `device.vue`, `setting.vue`, `profile.vue`, `otaUpgrade.vue`
- Health detail pages: `homeDetail/vitalSigns/**`, `pagesA/healths/deviceData.vue`, `healthReport.vue`
- Test page: `pages/test/testEquipment.vue`

The compatibility layer currently covers the BLE methods and store fields observed in those files. Migrating those pages into the new project should still be followed by `type-check`, mini-program build, and real-device regression.
