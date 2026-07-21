# RW/SY03 v324 Step Diagnostic Addendum

Visible build: `rw-visible-build-tag-20260719-324`.

Goal: keep the step/sleep validation focused and remove body-temperature probe buttons from the Mine page for now.

## Latest True-Device Result

- `stepCurrentDay` / `history-key/activity-current-day/read` / `0x051a` was previously confirmed as a working diagnostic path.
- The primary sync read a `0x051a` packet and parsed one candidate step record:
  - `stepCount = 22`
  - `rawDataType = ab_activity_current_day_relative_hour`
- That candidate was intentionally not submitted to `admin_fastapi`:
  - `rawMetricCounts.stepCount = 1`
  - `submitMetricCounts = {}`
  - `filteredOutCount = 1`
  - `reason = no-submittable-records`
- Reason: `0x051a` current-day relative/hourly packets have previously produced false-high values, so they remain diagnostic-only for `health_raw.step_count`.
- `activityHistory` / `history-key/activity/read` / `0x0502` was tested alone in v323.
  - TX: `ab010003ad10050210`
  - RX: `ab110003ad10050210`
  - Parsed as `rw_health_data_ack` for step key `0x0502`.
  - This means the command path works, but the device returned empty activity history, so there was no upload-safe step payload.

## v324 Change

- Mine page now sets `MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false`.
- Body-temperature protocol probe buttons are hidden from the Mine diagnostics panel for now.
- Step buttons remain visible:
  - `当天步数051a` / `stepCurrentDay`
  - `活动历史0502` / `activityHistory`
  - `步数/睡眠单测`
- Underlying temperature command code is not deleted; only the visible diagnostic buttons are hidden.
- No parser, upload filter, backend API, or database logic was changed.

## Current Step Conclusion

- Data is not blocked by backend at this point.
- `0x051a` can produce a small current-day step candidate, but it is intentionally filtered before upload.
- `0x0502` is the preferred upload-safe route, but the SY03 returned empty ACK in the latest single-command test.
- Next step should decide whether to:
  - keep `0x051a` diagnostic-only and ask the vendor/SDK for the exact current-day total/hourly payload contract, or
  - add a stricter `0x051a` acceptance rule only when the packet shape and true step count can be proven on the same device.

## Next Test

After publishing v324, keep testing one command at a time:

1. Clear logs.
2. Walk a known small amount with the ring worn.
3. Tap only `当天步数051a`.
4. Upload logs.
5. If `0x051a` returns a candidate value close to the real walk, compare its raw packet and hour to the phone/watch truth before allowing upload.
