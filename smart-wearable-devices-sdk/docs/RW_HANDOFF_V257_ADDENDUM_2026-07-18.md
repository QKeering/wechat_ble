# RW v257 Addendum - 2026-07-18

Build tag: `rw-visible-build-tag-20260718-262`

## Change

Aligned RW frontend history upload and business metric rendering with the backend `admin_fastapi` health aliases. The same backend-compatible fields are now accepted before upload and after local normalization:

- `heartRateValue`
- `oxygenSaturation`
- `hrvValue`, `heartRateVariabilityValue`, `rmssd`
- `pressureValue`, `avgStressValue`
- `temperatureValue`, `bodyTemperatureValue`, `skinTemperatureValue`, `skinTemp`
- `bloodSugarValue`
- `bloodPressureValue`, `systolicValue`, `diastolicValue`

## Why

Recent device logs showed the BLE path could connect and receive ACK/history records, but business pages could still miss HRV, stress, temperature, blood sugar, or blood pressure when the record used backend-style field names. This is a conversion-layer issue, not a connection issue.

## Verification Added

- `useRingHistoryUpload.parity.ts` now proves backend-compatible aliases submit through L19-compatible backend fields.
- `businessMetrics.parity.ts` now proves the same aliases render in business metrics for pages.
- `audit-rw-l19-parity.mjs` now requires these aliases and parity cases.

## Next Real Device Check

1. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Let home sync finish and then open detail pages without manually triggering device sync.
3. If DB rows contain HRV/stress/temperature/blood pressure fields but detail pages still hide them, check API response field names first.
4. If DB rows do not contain those fields, continue at the RW parser/protocol layer, especially temperature history because that is still the least proven path on SY03.

