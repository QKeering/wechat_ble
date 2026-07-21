# RW v307 Addendum - Isolated Temperature Probe

Build tag: `rw-visible-build-tag-20260718-308`

## Why This Build Exists

The v306 true-device log proved that the temperature probe was not running on a clean BLE channel. After `protocol-probe-start`, multiple `history/...` reads continued to send during the same window, so the timeout list was contaminated by background history sync.

## Latest Log Conclusion

- SY03 was connected and ready on RW service `0000A00A`, write char `0000B002`, notify char `0000B003`.
- `temperature/control-enable` sent `ab010006359f060900080501`.
- The device replied `ab11000351e6060900`, parsed as `rw_health_data_control_ack`, key `0x0609`, status `success`, name `unknown`.
- That means the control path returned a generic success ACK. v306 counted it as timeout because the Mine predicate only accepted `name === temperature`.
- `temperature/control-disable` saw the same generic `0x0609` success ACK.
- No payload was observed for current temperature `0x0230` or historical temperature `0x0508` in that run, but this must be retested after isolating the command channel.

## Code Changes

- Added `src/utils/rwDiagnosticCommandLock.ts`.
- Mine protocol probe now:
  - sets a short TTL diagnostic lock before sending probe commands;
  - pauses business auto-refresh;
  - waits for the RW compat history queue to become quiet;
  - clears the lock and resumes refresh in `finally`.
- Business history page sync, business-controller history sync, and compat `readLocalData` all skip RW history reads while the diagnostic lock is active.
- Temperature `0x0609` control predicates now accept the generic success ACK when the parsed key is `RwKey.AppDataControl` and the name is blank/`unknown`.

## Next True-Device Test

1. Install v307.
2. Open Mine page.
3. Clear logs.
4. Tap `体温单测`.
5. Wait until the button stops loading.
6. Check backend logs.

Expected clean-log signs:

- `protocol-probe-diagnostic-lock-set` appears before command 1.
- `protocol-probe-history-idle` reports `idle: true` or at least logs how long it waited.
- Any background history attempt during the probe should log a skip reason `rw-diagnostic-command-lock`, not send `history/...` TX.

Interpretation after v307:

- If `temperature/control-enable` is OK and `0x0230` still times out on a clean channel, the current-temperature read path is not returning data from this firmware/state.
- If `0x0508` still times out on a clean channel, the historical temperature path is also not exposed or has an undocumented precondition.
- If either path returns payload, map it into backend upload next.
