# RW v308 Addendum - Diagnostic Lock Fallback

Build tag: `rw-visible-build-tag-20260718-308`

## Latest v307 Log Result

The backend logs for `rw-visible-build-tag-20260718-307` showed:

- `temperature/control-enable` succeeded in 542ms.
  - TX: `ab010006359f060900080501`
  - RX: parsed `rw_health_data_control_ack`, `key=1545` (`0x0609`), `name=unknown`, `status=success`
- `temperature/control-disable` wrote successfully and also had a matching `0x0609` ACK nearby.
- Still timed out:
  - `monitoring/temperature/read`: `ab0100035c81027d10`
  - `monitoring/temperature-detecting/write`: `ab010009f5ee021b00ff0000173b3c`
  - current temperature `0x0230` AB CRC: `ab0100030cb4023010`
  - current temperature `0x0230` AB short: `ab010003023010`
  - current temperature `0x0230` C6 CRC: `c60100030cb4023010`
  - current temperature `0x0230` C6 short: `c6010003023010`
  - history temperature `0x0508` AB CRC: `ab0100030d16050810`
  - history temperature `0x0508` AB short: `ab010003050810`

Important caveat: `protocol-probe-start` had `diagnosticLock: null`, so the probe was not fully isolated. Business/history logs still appeared in the same time window.

## Change In v308

- `rwDiagnosticCommandLock` now keeps an in-memory module lock first, and only uses `uni.setStorageSync` as persistence.
- `setRwDiagnosticCommandLock` now returns a valid lock even if storage is unavailable.
- `getRwDiagnosticCommandLock` checks the in-memory lock before storage.
- `clearRwDiagnosticCommandLock` clears memory even if storage removal is unavailable.

## Next Test

Install v308, clear logs, tap `体温单测`.

The first checkpoint is not temperature data yet. First confirm isolation:

- `protocol-probe-start.diagnosticLock.owner` should be non-empty.
- `protocol-probe-diagnostic-lock-set.lock.owner` should be non-empty.
- `protocol-probe-diagnostic-lock-clear.cleared` should be `true`.
- If business history starts during the probe, it should log skip reason `rw-diagnostic-command-lock` and should not send `history/...` TX.

After isolation is confirmed, interpret the temperature path:

- `0x0609` control is already considered pass.
- If `0x0230` still has no payload in an isolated run, current temperature is likely unsupported or requires a firmware-side precondition.
- If `0x0508` still has no payload in an isolated run, historical temperature is likely unsupported or not stored by this SY03 state.
