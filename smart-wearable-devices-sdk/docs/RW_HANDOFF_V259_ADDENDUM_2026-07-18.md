# RW Handoff Addendum v259 - 2026-07-18

Visible build tag: `rw-visible-build-tag-20260718-262`

## What changed

- Tightened `useRingBusinessHistoryPageSync.ts` diagnostics for RW business pages.
- `history-page-sync-result` and `history-page-upload-result` now count and sample:
  - `bloodSugar`
  - `bloodPressure`
  - `systolic`
  - `diastolic`
- Query-result logging now recognizes backend aliases:
  - `bloodSugarValue`, `blood_sugar_value`, `bloodSugarAvg`
  - `bloodPressureValue`, `blood_pressure_value`, `bpValue`
  - `systolicValue`, `diastolicValue`
- No behavior change to the already passing upload path in `useRingHistoryUpload.ts`.

## Why

Latest attached device log was still from an older July 17 build, and it only covered one blood-sugar foreground test. It proved control ACK worked, but did not prove whether history sync or backend detail APIs were carrying blood sugar or blood pressure. v259 makes the next real-device log show those counts directly.

## Validation

- `npm.cmd run type-check`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Build output: `dist\build\mp-weixin`

Main package: `1,296,982` bytes, headroom `800,170` bytes.

## Next real-device check

After publishing v259, copy logs from Mine page and confirm the copied snapshot contains `rw-visible-build-tag-20260718-262`.

Look for:

- `history-page-sync-result.rawMetricCounts`
- `history-page-upload-result.rawMetricCounts`
- `history-page-upload-result.submitMetricCounts`
- `history-page-query-result.response.valueHints`

If `rawMetricCounts` has a metric but `submitMetricCounts` does not, the problem is frontend conversion/filtering. If `submitMetricCounts` has it but `valueHints` or backend pages do not, the problem is backend storage/detail response. If neither has it, the issue remains in the RW device/history command layer.

