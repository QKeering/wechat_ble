# RW Handoff Addendum - v233

Build tag: `rw-visible-build-tag-20260718-262`
Date: 2026-07-17

## Latest Real-Device Log

Attachment analyzed: `fedd829d-ef5f-4fd7-8e52-dc89dce0b227/pasted-text.txt`.

Confirmed:
- Connection is ready: connected/store/user/current are all true, notify is enabled.
- Sleep history sync can succeed: latest copy showed 23 sleep records uploaded.
- Device still returns empty AB ACKs for vital history: heart rate, SpO2, HRV, stress, and blood sugar returned `Len=3` ACK-only frames; temperature did not return in that compact report.
- Activity was still empty in the business background summary.
- The copied log was too compact to show raw RW HISTORY lines, so the page report must expose whether LastData fallback was attempted.

## Changes In v233

- Added explicit empty-primary-AB decision logging:
  - `history-primary-ab-empty-last-data-decision`
  - `history-primary-ab-empty-last-data-fallback`
  - `history-primary-ab-empty-last-data-failed`
- Expanded empty AB fallback eligibility from only vital metrics to vital metrics plus `step`, so activity/step can use QKeer V2 LastData when AB activity history returns only empty ACKs.
- Strengthened LastData mapping for `blood_sugar` and `blood_pressure` edge fields.
- Added parity coverage for:
  - vital page empty ACKs including `stress`
  - activity page empty ACKs falling back to LastData step count
- Trimmed Mine diagnostic reports so copied logs are less likely to be truncated:
  - compact `result` summaries
  - keep LastData decision/fallback events in counts
  - filter raw RW HISTORY logs to decision/result/failure events
- Updated `scripts/analyze-rw-ble-log.mjs` to expand compact history report counts and print the empty-AB-to-LastData decision chain:
  - `primaryAbDecision`
  - `primaryAbFallback`
  - `primaryAbFail`
  - `last-data-fallback-not-used`
  - `last-data-fallback-no-response`
  - `last-data-fallback-failed`

## Current Expected Test Focus

After installing v233, use the Mine page diagnostic copy after real-device testing.

Check these items first:
1. For vital/stress empty AB ACKs, confirm the report counts include `history-primary-ab-empty-last-data-decision`.
2. If `useFallback:true`, confirm `history-native-last-data-fallback` and either `history-last-data-only-response` or `history-last-data-wait-response`.
3. If activity is still empty, confirm whether `history/native-last-data` was sent after `activity-current-day` and `activity` ACK-only responses.
4. For business pages, data sync should be owned by the home/background path; detail pages should query backend data and not wait on BLE sync.

## Validation

Passed on 2026-07-17:
- `npm.cmd run type-check`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run build:mp-weixin`
- `npm.cmd run verify:mp-weixin-artifact`
- `npm.cmd run check:mp-weixin-size`
- `npm.cmd run audit:rw-l19`

Additional source-only validation after the analyzer update:
- `node --check scripts/analyze-rw-ble-log.mjs`
- `npm.cmd run audit:rw-l19 -- --skip-dist`

Package:
- `dist/build/mp-weixin`
- main package: 1,265,328 bytes
- headroom under 2M: 831,824 bytes
- total artifact: 1,563,518 bytes

