# RW/SY03 Handoff Addendum v248

Updated: 2026-07-17

Visible build tag: `rw-visible-build-tag-20260718-262`

## New Log Finding

Tester log `14:00:12` was from v246, so it is stale for v248 validation, but it contains useful evidence:

- Connection snapshot was ready.
- Stress page sync uploaded one record.
- Stress conversion path was proven in the copied compact report:
  - `rawMetrics.stress = 1`
  - `uploadRawMetrics.stress = 1`
  - `submitMetrics.stress = 1`
  - submitted sample contained `stress:50`
- Temperature foreground measurement was ACK-only:
  - control enable `060900080501` was written and acknowledged
  - `0508` read commands were written
  - no numeric `0508` or accepted `0230` temperature result appeared before the copied log ended

## Completed In v248

- Kept v247 conversion diagnostics and detail-date fixes.
- Added case-insensitive diagnostic sample extraction for Mine history reports so `skin_temperature`, `heart_rate_variability`, `stress_index`, and related aliases are visible in copied logs.
- Added raw/submit metric fields to the local RW log analyzer output.
- Changed foreground temperature measurement timing from the generic quick poll schedule to a slower temperature-specific schedule:
  - poll at `12000,24000,38000,52000` ms
  - result timeout `65000` ms

## Current Interpretation

- Stress is no longer suspected as a frontend conversion issue based on the v246 log.
- Temperature remains a bottom-layer or device-behavior gap until v248 proves otherwise.
- If v248 still shows temperature ACK-only after 65 seconds, the next suspect is device firmware/support/wearing-state behavior for `0508`/`0230`, not page conversion.

## Next Validation

Install v248 and test temperature from Mine diagnostics. Wait at least 65 seconds before copying logs.

Expected useful evidence:

- `buildTag` is `rw-visible-build-tag-20260718-262`
- temperature page flow includes polls at approximately `12000`, `24000`, `38000`, and `52000` ms
- pass condition: `single-metric-wait-hit`, `single-metric-direct-hit`, or `single-metric-diagnostic-log-hit` with `value` in 25-45
- fail condition: `single-metric-wait-timeout` with ACK-only and no `0x0508`/`0x0230` value


