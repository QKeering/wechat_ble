# RW/SY03 Handoff Addendum v243

Updated: 2026-07-17

Visible build tag: `rw-visible-build-tag-20260718-262`

## Final Goal

RW/SY03 must behave like the original L19 path at the business layer:

- one SDK-facing protocol abstraction for scan, connect, device info, battery and versions
- realtime and historical health metrics normalized to L19-compatible fields
- home page performs device sync; detail pages should primarily query backend data
- backend stores/query returns correct local-day data, with no future records
- Mine page keeps RW diagnostics only; product pages stay normal business pages
- mini-program main package remains under 2 MB

## Completed In v243

- Restored Mine page visual icons from frontend rendering regression.
  - Replaced fragile `uv-image`/`uv-icon` usages for Mine page background, avatar, Bluetooth status, logo, menu icons and arrows with native `image` / `text`.
  - Removed the `uv-button` scan icon dependency that produced square placeholders on real device.
- Added upload-side future timestamp guard.
  - `submitRingHistorySyncResult()` now rejects records whose timestamp is more than 10 minutes after the phone receive time.
  - This is intended to stop rows like `2026-07-17 23:06:37` from being uploaded while the phone is still around `20:00`.
- Tightened history sync diagnostics.
  - `history-page-sync-result` now logs raw metric counts and raw record samples.
  - `history-page-upload-result` now logs raw count, submit count, filtered count, future-filtered count, metric counts and submit response summary.
  - Next logs can distinguish:
    - `rawMetricCounts.hrv = 0`: bottom parser/device did not produce HRV.
    - `rawMetricCounts.hrv > 0` and `submitMetricCounts.hrv = 0`: upload normalization/filtering blocked it.
    - `submitMetricCounts.hrv > 0` but detail page empty: backend storage/query/page mapping problem.

## Current Working Theory

- Database future-time rows are caused by RW activity/summary records carrying device-side timestamps ahead of phone local time.
- Upload filtering now blocks those records before backend submission. If future records still appear after v243, inspect backend ingestion or another upload path.
- HRV, pressure, SpO2, temperature and stress must be judged metric by metric from the new raw/submit counters instead of screenshots.
- Detail pages currently still trigger `syncBusinessHistoryPage()` before querying. The target architecture should move device sync back to the home page and keep detail pages backend-only after the data path is stable.

## Pending Validation

Ask tester to install v243 package and paste Mine diagnostics after:

1. Open Mine page and confirm menu icons, Bluetooth icon, avatar and arrows are no longer square placeholders.
2. Connect SY03 and wait for one normal history sync from the home/business entry.
3. Copy Mine diagnostics.
4. Check:
   - `buildTag` is `rw-visible-build-tag-20260718-262`
   - `futureFilteredOutCount`
   - `rawMetricCounts`
   - `submitMetricCounts`
   - backend DB `record_time` no longer contains rows later than phone local time plus 10 minutes

## Verification Done

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Final v243 artifact: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`

Main package: 1,218,490 bytes. Headroom: 878,662 bytes.

