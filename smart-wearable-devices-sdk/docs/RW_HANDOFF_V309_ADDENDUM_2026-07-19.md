# RW v309 Addendum - Temperature Realtime Single Path

Build tag: `rw-visible-build-tag-20260719-309`

## Latest Log Conclusion

- Latest v308 backend logs show RW/SY03 connected and notify-ready on service `0000A00A`, write characteristic `0000B002`, notify characteristic `0000B003`.
- Diagnostic lock worked: business history sync was skipped while protocol probe was running.
- Temperature control `0x0609/0x08` returned ACK `ab11000351e6060900` for enable and disable.
- Temperature realtime read `0x0230` did not produce any `rx-parsed` frame during the 45-second window. Logs only showed repeated `tx-ok`.
- Temperature history read `0x0508` also timed out with no `rx-parsed` frame.

## v309 True-Device Result

- Backend log ids `3123`-`3159` are build `rw-visible-build-tag-20260719-309`.
- `temperature/control-enable` sent `ab010006359f060900080501` and received ACK `ab11000351e6060900` in 569 ms.
- `temperature/app-realtime-read` sent `ab0100030cb4023010` at 1.5 s, 8 s, 18 s, and 28 s polling points. Every write completed with `tx-ok`, but no `rx-parsed` frame arrived before the 45-second timeout.
- `temperature/control-disable` sent `ab010006f55e060900080500` and received ACK `ab11000351e6060900`.
- v309 therefore confirms the focused realtime temperature route still fails at device response: control is accepted, but `0x0230` produces no payload.

Current interpretation: temperature is not a frontend conversion/display issue. The verified control path is open, but the device did not return a temperature payload for the SDK realtime or historical keys in this state.

## v309 Change

- Mine page `体温单测` now runs only one realtime route:
  - `temperature/control-enable` -> `ab010006359f060900080501`
  - `temperature/app-realtime-read` -> `ab0100030cb4023010`
  - `temperature/control-disable` -> `ab010006f55e060900080500`
- Removed C6/no-CRC repeats, monitoring config reads/writes, and historical `0x0508` from the focused temperature run.
- Added `protocol-probe-ready-settle` before commands. If the page had to restore the BLE device first, it waits 9 seconds so reconnect/time-sync tail commands do not contaminate the first protocol command.

## Next True-Device Step

Install v309, clear logs, connect SY03, tap `体温单测`, then wait for completion and inspect backend logs. The decisive evidence is whether any `rx-parsed` frame appears after `temperature/app-realtime-read` with key `0x0230`.

If v309 still has only `tx-ok` for `0x0230` and no `rx-parsed`, treat SY03 temperature as firmware/state unsupported until an official APP BLE trace or vendor SDK sample proves another precondition or key.
