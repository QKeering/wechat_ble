# RW Handoff Addendum v326 - 2026-07-19

Visible build tag: `rw-visible-build-tag-20260719-326`

## Scope

Continue the one-command-at-a-time RW/SY03 verification flow. Temperature Mine-page probes remain hidden through `MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false`; the visible Mine diagnostics should focus on step/activity paths.

## Latest backend-log conclusion

The v325 backend log proved the `0x051a` current-day step path is now parsed correctly:

- Command: `history-key/activity-current-day/read`
- Mine mode: `stepCurrentDay`
- TX: `ab010003ad1a051a10`
- RX: long `ab1100a3...051a10...` packet
- Parsed: `rw_health_data`, `name=step`, `key=0x051a`, `value=118`
- Record raw type: `ab_activity_current_day_relative_hour`
- Record timestamp source: `current_day_key_relative_hour`

The remaining blocker was not BLE or parser. The page upload layer logged `history-page-upload-skip` with `reason=no-submittable-records`, because `ab_activity_current_day_relative_hour` had previously been guarded as an unsafe step candidate.

## v326 change

`src/composables/useRingHistoryUpload.ts` now keeps the old unsafe-step guard, but adds a narrow exception for the verified current-day relative-hour record:

- `rawDataType` must be `ab_activity_current_day_relative_hour`
- `dataType` must be `step`
- `timestampSource` must be `current_day_key_relative_hour`
- record time must be the current local day
- `stepCount` must normalize to a positive valid number

This should allow the v325-style `step=118` record to be submitted while continuing to block untagged or summary-like candidates, including old `stepCount=9262` diagnostic samples.

## True-device verification

User confirmed after publishing v326 that the step data was written into the database. Treat this path as closed for now:

- `0x051a` current-day step command: working
- RW parser for `ab_activity_current_day_relative_hour`: working
- guarded upload conversion through `admin_fastapi` to `health_raw.step_count`: working
- do not keep retesting this path unless a regression appears

## Next focus

Step is now verified, so the next one-command lane should move to sleep:

1. Keep the step probes available but do not use them as the primary test path.
2. Test sleep with `history-key/sleep/read` / `0x0505`.
3. Confirm whether the device returns only `ab1100039d12050510` empty ACK or an actual sleep payload.
4. If an actual sleep payload appears, check parser output first, then upload conversion to the backend.
5. Keep `activityHistory` / `history-key/activity/read` / `0x0502` visible but secondary. In the latest v325 log it still returned only `ab110003ad10050210`, which means the device had no upload-safe activity history payload for that read.

Do not re-open temperature in the Mine page during this step unless the user explicitly asks. Temperature reached a temporary stop point before this step; the current focus is sleep verification.
