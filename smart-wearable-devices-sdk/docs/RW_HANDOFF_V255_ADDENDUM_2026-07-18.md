# RW v255 Addendum - 2026-07-18

Build tag: `rw-visible-build-tag-20260718-262`

## Why This Patch Exists

The latest submitted diagnostic log was still from the older v249 package. It showed the vital-sign detail page was doing device history sync itself and uploading 4 records, with raw/submitted metrics limited to heart rate and SpO2. That made detail pages wait for BLE and still left HRV, stress, and temperature empty.

The product expectation is now explicit: RW data sync should happen on the home page. Business detail pages should read backend APIs only.

## Changes

- `src/pages/awareness/awareness.vue`
  - Added RW home background history sync through `useRingBusinessHistoryPageSync`.
  - Home sync covers `lastData`, `sleepData`, `activity`, `stress`, `heartRate`, `bloodOxygen`, `hrv`, `temperature`, `skinTemperature`, `bloodSugar`, and `bloodPressure`.
  - Connection-ready, reconnect-ready, page-show, and pull-down-refresh now start a deduplicated background home sync.
  - Home sync writes `RW HOME` diagnostics:
    - `business-sync-background-start`
    - `business-sync-background-result`
    - `business-sync-background-failed`
    - `business-sync-background-skip`
  - The old `localData` watcher now skips RW history payloads with `local-data-upload-skip-rw-bridge`, so the bridge owns RW upload and the legacy watcher does not duplicate submit.

- `src/pages/businessHistoryPageSync.parity.ts`
  - Added parity checks that home owns RW history sync while detail pages remain manual-only.

- `scripts/audit-rw-l19-parity.mjs`
  - Added release guard for the RW home sync entry, data type coverage, and diagnostics.

## Next Real-Device Check

1. Confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Enter or refresh the home page while SY03 is connected.
3. Copy diagnostics after `business-sync-background-result`.
4. Check whether the paired `history-page-upload-result` reports raw and submitted counts for sleep, activity, stress, HRV, temperature, and SpO2.
5. Then open detail pages. They should query backend and should no longer perform BLE history sync themselves.

If HRV, stress, or temperature are still absent from `rawMetricCounts`, the remaining problem is below the business page layer: either SY03 did not return those history records, or the RW parser/history converter has not mapped that frame type yet.

