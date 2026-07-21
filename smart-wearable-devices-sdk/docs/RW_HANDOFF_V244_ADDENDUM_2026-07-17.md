# RW/SY03 Handoff Addendum v244

Updated: 2026-07-17

Visible build tag: `rw-visible-build-tag-20260718-262`

## Log Finding

Tester log `13:04:48` confirmed the package is v243 and BLE connection is healthy:

- `connected=true`, `ready=true`, `notifyEnabled=true`
- history sync returned one `0503` heart-rate record
- `0509` SpO2 frame actually returned a value byte `0x62 = 98`, but parser treated it as a pending ACK
- foreground HRV expected `050A`, but page accepted a `0269 / flag=00` packet and showed `46`, which is not a confirmed `050A` HRV result

## Completed In v244

- AB health history parser now keeps 6-byte metric records even when the device timestamp bytes are unusable.
- Invalid/future RW history timestamps are replaced with phone receive time before upload/page normalization.
- `0509` blood oxygen history records now parse the metric value from the fifth payload byte, so the real SY03 sample returns SpO2 `98`.
- Foreground/detail metric helpers no longer use `0269` packets as HRV fallback. HRV now requires the primary `050A` path before display.
- Parser parity now includes real SY03 samples:
  - `ab11000979d80503102e234ac14500` -> heart rate `69`
  - `ab11000934920509102e234b086200` -> SpO2 `98`

## Next Validation

Install v244 and copy Mine diagnostics after one SY03 sync.

Check:

- `buildTag` is `rw-visible-build-tag-20260718-262`
- blood oxygen history should no longer be reported as ACK-only when `0509` payload contains `0x62`
- HRV should stay empty unless a real `050A` response returns data
- backend `record_time` should no longer move ahead of phone local time because malformed/future device timestamps are normalized at parse/upload time

