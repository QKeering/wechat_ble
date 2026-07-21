# RW v293 handoff addendum

Build tag: `rw-visible-build-tag-20260718-293`

## Latest real-device finding

- The v292 Mine-page log proved connection and backend upload were healthy: `connected=true`, `ready=true`, `notifyEnabled=true`, and `/app/data/sync` returned `success=true`.
- The same log submitted `step=9262` at `2026-07-18 16:41:55`, but the user confirmed this was not real movement for today.
- Therefore the problem is not backend-calculated step inflation. The false value came from the frontend history conversion path before `/app/data/sync`.

## v293 change

- `0x051A / ActivityCurrentDay` parsing no longer treats the first 2 or 4 payload bytes as today's total steps.
- ActivityCurrentDay now only emits step records when the payload can be parsed as structured hourly current-day activity.
- History upload now blocks step values from ambiguous summary sources:
  - `ab_activity_current_day_summary`
  - `last_data`
  - `qkeer_v2_last_data`
  - generic `dataType=summary`
- Summary/LastData records can still carry other valid metrics such as heart rate, SPO2, HRV, or stress; only their step field is ignored for historical upload.

## Next validation

- Retest with build tag `rw-visible-build-tag-20260718-293`.
- Expected result: the previous false `9262` step should not be uploaded again.
- If step becomes missing again, keep it missing for now and verify only the concrete activity history path:
  - `0x0502 / Activity`
  - structured `0x051A / ActivityCurrentDay` hourly payloads
- Do not re-enable loose summary-byte parsing without a real SY03 payload sample proving its byte layout.
