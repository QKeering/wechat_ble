# Ring OTA SDK

This folder isolates the legacy ring OTA packet protocol from the main BLE protocol SDK.

Status:

- `manager.ts` ports the old `RingOTAManager.start(deviceId, hexString, onProgress)` entry.
- `src/composables/ring-ota-manager.ts` re-exports the manager so migrated old pages can keep importing `@/composables/ring-ota-manager`.
- OTA service/characteristic UUIDs and response codes are exported as constants.
- Intel HEX parsing and CRC16 calculation are public on the manager for focused verification.
- BLE writes still require a real BOOT-mode ring device before this flow can be considered production-verified.

Keep OTA separate from `src/sdk/ring-ble` because normal APP-mode communication and BOOT-mode firmware transfer have different services, packet sizes, retries, and failure modes.

