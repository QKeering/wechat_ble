# RW v256 Addendum - 2026-07-18

Build tag: `rw-visible-build-tag-20260718-262`

## Change

Home-page RW history sync now attempts to sync the SY03 device clock before reading history. The sync is deduplicated for 10 minutes and is best-effort: a clock-sync failure is logged but does not block history upload.

New `RW HOME` diagnostics:

- `device-time-sync-start`
- `device-time-sync-result`
- `device-time-sync-failed`
- `device-time-sync-skip`

## Why

Real-device DB screenshots showed records whose `record_time` was later than the phone's current local time. The RW SDK already had `updateDeviceTime`, but the home/business refresh path was running with `includeDeviceTime: false`, so the device clock could drift and then poison uploaded history timestamps.

## What To Check On The Next Device Run

1. Confirm diagnostics show `rw-visible-build-tag-20260718-262`.
2. On the home page, wait for `device-time-sync-result` or `device-time-sync-failed`.
3. Then wait for `business-sync-background-result` and the paired `history-page-upload-result`.
4. Recheck DB `health_raw_hr.record_time`; it should no longer jump ahead of the phone's current local time after a successful `device-time-sync-result`.
5. If HRV/stress/temperature are absent from `rawMetricCounts`, keep debugging the RW parser/protocol response layer. If raw counts exist but `submitMetricCounts` omit them, debug `useRingHistoryUpload.ts`.

