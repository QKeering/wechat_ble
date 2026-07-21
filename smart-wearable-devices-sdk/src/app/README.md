# App Layer

This folder owns app startup, permissions, global listeners, and cross-feature wiring.

Rules:

- Do not initialize Bluetooth directly in `App.vue`.
- Ring Bluetooth startup should go through the compatibility wrapper `useRingBLE()` or `features/ring`; `App.vue` may call `useRingBLE().initBluetooth()` only for legacy app lifecycle parity.
- AI pet devices should go through `features/pet`.
- Shared app lifecycle code should stay small and explicit.
