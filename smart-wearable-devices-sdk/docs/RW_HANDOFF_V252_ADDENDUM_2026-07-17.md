# RW V252 Addendum - 2026-07-17

## Scope

This round moves RW closer to L19 business behavior by removing device-sync waits from business detail pages and tightening vital detail display fallback.

## Done

- Changed RW business detail pages to query backend directly instead of starting BLE history sync before every query.
- Affected pages: sleep detail, activity detail, stress detail, and vital-sign overview.
- RW vital-sign overview no longer runs BLE restore/refresh on page show or pull-down refresh; non-RW behavior is kept.
- Heart-rate, blood-oxygen, and HRV detail pages now update their top value from backend detail response first, then latest chart point, then valid cached metric.
- Removed default test value `56` from those detail pages; no valid value now displays `--`.
- Blood oxygen detail applies valid range `70-100`, so invalid values such as `46` are not used as display fallback.

## Next Real-Device Checks

- Confirm the My page build tag is `rw-visible-build-tag-20260718-262`.
- Open sleep/activity/stress/vital detail pages after homepage sync and verify they no longer wait around 18-20 seconds.
- If a detail page still has no data, inspect the `RW PAGE history-page-query-result` value hints first; that distinguishes backend-empty from frontend-display issues.
- Continue bottom protocol checks for metrics whose backend remains empty, especially stress, HRV, body temperature, and blood oxygen.

