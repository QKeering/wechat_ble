# RW/SY03 v323 Step Diagnostic Addendum

Visible build: `rw-visible-build-tag-20260719-323`.

Goal: keep all validated RW/SY03 paths unchanged and isolate the step-count path one protocol command at a time.

## Current Step Finding

- The database screenshot from 2026-07-19 shows only one recent `health_raw.step_count` value, `738` at `2026-07-19 06:00:00`.
- Current code intentionally does not upload ambiguous current-day step candidates from `0x051a` source types such as `ab_activity_current_day_jl2_hour` and `ab_activity_current_day_relative_hour`, because earlier true-device tests produced false high values such as 9000+ steps.
- `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a` remains useful diagnostic evidence, but it is not trusted as business `health_raw.step_count` unless its source is proven safe.
- `BLE_KEY_ACTIVITY` / `0x0502` remains the preferred upload-safe activity history path for `admin_fastapi` and `health_raw.step_count`.

## v323 Change

- Added Mine-page single protocol probe mode `stepCurrentDay`.
  - Sends only `history-key/activity-current-day/read`.
  - Command key: `0x051a`.
  - Button text: `当天步数051a`.
- Added Mine-page single protocol probe mode `activityHistory`.
  - Sends only `history-key/activity/read`.
  - Command key: `0x0502`.
  - Button text: `活动历史0502`.
- The existing grouped `步数/睡眠单测` remains available, but the next true-device pass should use the single buttons first.
- No parser, upload filter, backend API, or database logic was changed.

## Next True-Device Test Order

1. Publish v323 and confirm Mine diagnostics show `rw-visible-build-tag-20260719-323`.
2. Clear logs.
3. Tap only `当天步数051a`.
4. Wait until it stops, then upload/check logs.
5. Clear logs again.
6. Tap only `活动历史0502`.
7. Wait until it stops, then upload/check logs.

## How To Interpret Logs

- If `0x051a` returns records but `0x0502` returns empty ACK, the ring has current-day diagnostic step candidates but no upload-safe activity history. The missing database rows are expected under the current safety rule.
- If `0x0502` returns valid `ab_activity_history_jl2` records but the backend still has no new `health_raw.step_count`, inspect the front-end upload summary and `/app/data/sync` payload next.
- If both `0x051a` and `0x0502` return empty ACK after walking, the device is not exposing updated step history at that point; retry after a longer wear/walk interval or after the official app proves when the firmware flushes step history.
- Do not re-enable loose `0x051a` total parsing without a true SY03 packet sample that matches the real step count.
