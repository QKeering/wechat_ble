# RW Handoff Addendum v327 - 2026-07-19

Visible build tag: `rw-visible-build-tag-20260719-327`

## Closed Path

Step is closed for now.

- `0x051a` / `history-key/activity-current-day/read` returns SY03 current-day relative-hour step records.
- Parser output is `ab_activity_current_day_relative_hour` with `current_day_key_relative_hour`.
- v326 guarded upload wrote the value through `admin_fastapi` into `health_raw.step_count`.
- User confirmed a realistic increase from `118` to `136` after walking only a few steps.

Do not keep retesting step unless a regression appears.

## v327 Focus

Move to one-command sleep verification.

- Mine page temperature probes remain hidden: `MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false`.
- Verified step probes are hidden by default: `MINE_SHOW_STEP_PROTOCOL_PROBES = false`.
- The visible protocol probe is sleep-only: `MINE_SHOW_SLEEP_PROTOCOL_PROBE = true`.
- New mode: `sleepHistory`.
- New single command: `history-key/sleep/read` / `0x0505`.

The old `stepSleep` path still exists in code as a fallback, but it should not be used for this focused round because it mixes step, activity, and sleep.

## True-Device Test Checklist

1. Publish v327 and confirm the diagnostic copy shows `rw-visible-build-tag-20260719-327`.
2. On Mine page, tap `sleep history 0505` / `sleepHistory`.
3. Expected clean log shape:
   - `protocol-probe-start` with `mode=sleepHistory`
   - `protocol-probe-plan` with exactly one required command
   - TX `ab0100039d12050510`
   - response either empty ACK `ab1100039d12050510` or a longer `rw_health_data:sleep` payload
4. If the device only returns `ab1100039d12050510`, the BLE command path is working but SY03 currently has no sleep payload to upload.
5. If a longer sleep payload appears, verify parser fields first, then check upload conversion into `health_raw.sleep_state` and any duration/start/end fields accepted by `admin_fastapi`.

## Next Decision

- Empty ACK: verify whether the device has enough overnight sleep data and whether a read-continue command is needed.
- Real payload but no page/database data: fix parser or upload conversion, not BLE.
- Timeout/no RX: revisit `0x0505` command form and SDK reference for sleep history.
