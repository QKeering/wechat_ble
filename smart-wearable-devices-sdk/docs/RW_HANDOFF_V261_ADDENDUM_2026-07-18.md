# RW Handoff Addendum v261

Build tag: `rw-visible-build-tag-20260718-262`

## What Changed

- Added `temperature` to the Mine page RW realtime diagnostic buttons.
- Added `metric:temperature` to the Mine page RW/L19 acceptance steps.
- Updated the RW log analyzer acceptance expectation so diagnostic reports now track the current unresolved realtime set: temperature, HRV, stress, blood pressure, and blood sugar.
- Kept the higher-level RW/L19 gate strict: heart rate and blood oxygen are still part of the final evidence requirement and are not removed from the overall goal.

## Why

The latest usable log was from an old build, so it could not prove or disprove current behavior. The code review showed the Mine page had focused buttons for HRV, stress, blood pressure, and blood sugar, but temperature was missing even though it is still an unresolved bottom-layer item. v261 adds it back to the diagnostic surface without reopening already-verified heart-rate and SpO2 buttons.

## Next Real-Device Test

1. Import `dist/build/mp-weixin`.
2. Open Mine and confirm copied diagnostics show `rw-visible-build-tag-20260718-262`.
3. Run the Mine realtime buttons for temperature, HRV, stress, blood pressure, and blood sugar.
4. Run history sync for sleep, activity, stress, and vital.
5. Copy the full Mine diagnostics. The analyzer should now list any failing command by `metric:*` or `history:*`.


