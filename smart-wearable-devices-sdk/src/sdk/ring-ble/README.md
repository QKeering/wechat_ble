# Ring BLE SDK

This folder is the new internal SDK boundary for ring Bluetooth protocols.

Current status:

- Old project `src/composables/useRingBLE.ts` is not changed by this SDK extraction.
- Production page migration is staged through `src/pages/ring/business.vue`, which reads protocol-independent business metrics from `useRingBusinessController()`.
- Legacy protocol extraction is staged here first.
- `legacy/adapter.ts` can scan legacy ring devices, connect, discover service/characteristics, enable notify, write common commands, and register a parsed-data callback.
- Legacy adapter command coverage includes battery, active measure, oxygen, temperature, firmware/software version, collect period read/write, local history read, device time read/write, factory reset, and local-data deletion.
- Legacy adapter preserves connection stability helpers from the old composable: serviceId cache, RSSI fallback connection check, and global listener cleanup.
- `legacy/workflows.ts` wraps app-level flows around the adapter: Bluetooth readiness, iOS MAC-to-UUID conversion, connect-and-bind, auto reconnect, and disconnect cleanup.
- `syncLegacyHistory()` reads local history, waits for `local_data`, calls the external upload hook, and can optionally delete local ring data after upload.
- `legacy/parser.ts` can parse the currently extracted core responses: version, battery, active measure, blood oxygen, temperature, history records, device time, collect-period read/write, reset, and local-data deletion.
- `storeBridge.ts` keeps the old parsed-data handoff and also creates normalized data for future SDK adapters.
- `src/composables/useRingBleSdk.ts` is the new frontend entry for pages/composables.
- `useRingBleSdk.ts` switches the active adapter at connect time based on the scanned device protocol, so RW devices use `rw/adapter.ts` while existing devices continue through `legacy/adapter.ts`.
- When the selected ring is different from the current connection, `useRingBleSdk.ts` disconnects the current BLE session before switching adapters and connecting the new ring.
- The connect workflow forwards the original scanned device metadata into the selected adapter, so SDK-backed protocols such as QKeer V2 keep their advertisement payload even when the first discovery list came from the generic scan surface.
- During connect, `useRingBleSdk.ts` records the expected target ring and ignores stale ready callbacks from other devices/protocols, preventing auto-restore or delayed BLE events from replacing the currently selected session.
- Business pages call the shared device-matching helper through `useRingBusinessController()`, so current-device UI state remains correct when WeChat reports different `deviceId`, `uniMacId`, or `mac` values for the same ring.
- Parsed BLE packets that carry a different `deviceId` or protocol than the current connection are ignored at the SDK entry, preventing late packets from a previous ring from polluting the active business metrics.
- `src/composables/useRingBleStoreSdk.ts` connects SDK state to Pinia and local API placeholders.
- `src/composables/useRingBLE.ts` keeps the legacy composable name as a compatibility wrapper, including the legacy debug-page `connectedDeviceId` flag.
- `App.vue` initializes Bluetooth through the compatibility wrapper on app show and resets the Bluetooth-ready store flag on app hide.
- `src/manifest.json` preserves WeChat location permission, `getLocation` private-info declaration, existing mini-program appid, and required-components lazy loading for real-device BLE scans.
- `src/stores/ring.ts` owns BLE state; `src/stores/user.ts` provides a legacy BLE-state facade for old pages that still import `useUserStore`.
- The ring store and legacy user-store facade expose `healthData`, a protocol-independent compatibility object with common legacy aliases (`heart_rate`, `blood_oxygen`, `spo2`, etc.) derived from unified business metrics.
- `latestMetrics` and `healthData` keep the latest valid same-device business values while an RW refresh is pending; clearing data, disconnecting, or switching devices resets that snapshot so values do not leak across rings.
- `src/common/api/device.ts` provides a legacy device API facade for old pages that still import `@/common/api/device`.
- `src/pages/ring/debug.vue` remains as an internal device-level verification file, but it is not exposed in `pages.json`.
- `src/pages/ring/business.vue` is the publishable business verification page for scan, connect, refresh, and unified metric display.
- Legacy mini-program routes render the shared `RingUnifiedHealthEntry` component, so old entry paths can directly scan, connect, refresh health data, sync history, and use pull-down refresh before full page migration.
- OTA is isolated in `src/sdk/ring-ota` and exposed through the legacy-compatible `src/composables/ring-ota-manager.ts` path.
- Business side effects are exposed as `RingBleRuntime` hooks, so the SDK does not import the old store/API directly.
- Third-party SDKs can be added as new adapters after the legacy boundary is stable.
- RW protocol is staged under `rw/` from `RW微信小程序协议开发文档251201.pdf`.
- QKeer V2 is staged under `qkeer-v2/`; the vendor uni-app BLE SDK is copied into `qkeer-v2/vendor`, and `qkeer-v2/adapter.ts` bridges scan/connect/read commands into the same SDK interface.
- `protocolRegistry.ts` owns device-to-protocol detection. RW is detected first, QKeer V2 is detected by `MUSLEEP_RING`/`QKV2` names, `QK-V2` productId, or advertised service marker `F618`, and unknown devices still default to `legacy`.
- Generic scans parse QKeer V2 `F618` advertisement payloads into the same `advertis` metadata shape used by the vendor SDK connection bridge.
- Business scans that pass `includeUnknown` keep legacy, RW, and QKeer V2 ring candidates even when the current connected adapter is RW or QKeer V2, so migrated pages can switch devices without returning to an old protocol-specific scan page.
- Public API parity is tracked in `docs/RING_BLE_SDK_PARITY.md`.

Target shape:

```text
src/composables/useRingBLE.ts
  -> src/sdk/ring-ble/facade.ts
     -> legacy/adapter.ts
     -> rw/adapter.ts
     -> qkeer-v2/adapter.ts
```

Migration order:

1. Keep current app behavior unchanged.
2. Move command definitions into `legacy/commands.ts`.
3. Move response parsing into `legacy/parser.ts`.
4. Move parsed data normalization into `legacy/normalizer.ts`.
5. Move store writes into `storeBridge.ts`.
6. Move connection and send-command logic into `legacy/adapter.ts`.
7. Move business workflows into `legacy/workflows.ts`.
8. Complete the RW second protocol adapter from the vendor document.
9. Add QKeer V2 vendor SDK behind the same adapter interface.
10. Route migrated pages through `useRingBusinessController()` so pages read unified business metrics instead of protocol-specific packets.

Do not put AI pet device logic here. Pet devices should use a separate module such as `src/sdk/pet-device/`.

RW protocol checklist:

1. Confirm RW identification rules in `RW_RING_DETECTOR`.
2. Verify RW scan/connect/service discovery in `rw/adapter.ts` on a real device.
3. Use `pages/ring/business.vue` to verify the business result: battery, firmware, software, heart rate, blood oxygen, temperature status text, passive metric status, monitoring status, history status, and refresh result.
4. Keep `pages/ring/debug.vue` for local-only command diagnosis when a real device exposes a protocol issue.
5. Map RW parsed file/source data into the same `RingParsedData` shape used by legacy pages.
6. Add parity samples before enabling the route in production page flows.

QKeer V2 protocol checklist:

1. Verify QKeer V2 device discovery through advertised service `0000F618-0000-1000-8000-00805F9B34FB`.
2. Verify vendor SDK connection through service `49535343-FE7D-4AE5-8FA9-9FAFD205E455`, write characteristic `49535343-8841-43F4-A8D4-ECBE34729BB3`, and notify characteristic `49535343-1E4D-4BD9-BA61-23C647249616`.
3. Verify device info maps to battery and firmware metrics.
4. Verify active measure maps to heart rate and blood oxygen metrics.
5. Verify latest data maps to battery, heart rate, blood oxygen, temperature, steps, sleep summary, fatigue, and anxiety metrics.
6. Verify health-list, step-list, and sleep-list history commands return records before using them for upload/delete workflows.
7. Verify ECG and enhanced-sleep read results on a real device before presenting them as business metrics.

Main workflow entries:

- `ensureLegacyBluetoothReady(adapter, runtime)`
- `connectLegacyRing(adapter, runtime, options)`
- `autoReconnectLegacyRing(adapter, runtime)`
- `syncLegacyHistory(adapter, runtime, options)`
- `disconnectLegacyRing(adapter, runtime)`

Frontend entry:

- `useRingBleSdk()` exposes state and actions for pages: scan, connect, disconnect, reconnect, command reads, and history sync.
- `useRingBleStoreSdk()` adds store synchronization plus default bind/upload hooks from `src/api/ringDevice.ts`; default calls are shared as one SDK instance across migrated legacy entries, while custom-option calls remain isolated.
- `src/api/ringDevice.ts` is the current mini-program fallback for bind and history upload. It persists the bound device locally and deduplicates uploaded history records with a latest-200 cap until the real backend contract is wired.
- `useRingBusinessData()` exposes protocol-independent business metrics and live store refs for read-only migrated pages.
- `useRingBusinessController()` is the preferred entry for migrated business pages. Default calls share one controller instance across migrated legacy entries, while custom-option calls remain isolated for tests or special flows. It wraps scan, connect, refresh, health-monitoring setup, refresh result, metrics, history-pending status, and business-level timeout settling in one place. Business pages call the controller from both mounted and show lifecycles; the controller shares in-flight restore attempts so app resume and page re-entry do not start duplicate BLE reconnect flows. Shared legacy entries expose stop-scan, clear-data, disconnect recovery actions, and pull-down refresh registration.

```ts
const ring = useRingBusinessController();
await ring.scanForBusinessDevices();
await ring.connectBusinessDevice(device);
await ring.refreshBusinessData();
const battery = ring.metrics.value.battery;
const failed = ring.refreshFailedText.value;
```

- Business pages should read from `ring.metrics` instead of parsing `receivedData` or branching by protocol.
- Business pages should pass the selected list item into `connectBusinessDevice()`/`connectDevice()` so the protocol adapter can reuse scan-time metadata during connection.
- Bind/reconnect persistence keeps protocol, service/characteristic ids, and scan advertisement metadata. Auto reconnect passes that stored device metadata back into the selected adapter.

Compatibility notes:

- Parser display values intentionally keep legacy output where pages may depend on it, including Chinese battery charging text, Chinese measurement statuses, and `°C` temperature units.
- Default history sync follows the old behavior of reading from today's zero timestamp; pass `readAll: true` for full local-history reads.
- `updateDeviceTime()` writes current time then reads device time after a short delay, matching the old composable behavior.
- `updateDeviceTime()` keeps the old command frame type `0x01`; other normal commands keep frame type `0x00`.
- `sendFactoryResetWithTimeCommand()` preserves the old experimental `0xA0` reset-with-time command as a separate method from the normal factory reset.
- `isDeviceConnected()` falls back to RSSI detection when `getConnectedBluetoothDevices` does not report the device.
- `cleanupLegacyRing()` removes scan, characteristic, and connection-state listeners for page teardown.
- `unbindLegacyRing()` calls the runtime unbind hook before disconnecting and clearing runtime state.
- `autoReconnectLegacyRing()` refreshes bound service and characteristic metadata after reconnect, so restored sessions keep the right protocol write/notify path.
- Legacy, RW, and QKeer V2 adapters notify the unified runtime on BLE disconnection, so `deviceInfo` and store connection state are cleared consistently for migrated pages.

OTA status:

- Normal APP-mode BLE stays in `src/sdk/ring-ble`.
- BOOT-mode firmware transfer stays in `src/sdk/ring-ota`.
- Treat OTA as compile-ready but hardware-pending until a real BOOT-mode ring completes firmware transfer and reconnects back to APP mode.
