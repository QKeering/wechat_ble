# RW Handoff Addendum v249 - 2026-07-17

Visible build tag: `rw-visible-build-tag-20260718-262`

## Scope

This round keeps the already-validated RW stress upload path intact and focuses on business-page display and diagnostics.

## Latest Log Conclusion

The latest real-device log was still from build 246, not this v249 package. It proves:

- SY03 was connected and ready.
- `relaxStatus` stress sync uploaded one record successfully.
- Submit sample included `stress=50` at `2026-07-17 22:00:10`.
- Temperature foreground still only returned control ACK plus `0508` read tx/tx-ok, with no accepted numeric temperature value.

Conclusion: stress is no longer a BLE/parser conversion suspect. If pressure page is blank, check backend query response and page rendering. Temperature remains a bottom-layer/device-response gap.

## Changes

- Rebuilt `homeDetail/relaxStatus/relaxStatus.vue` to remove broken mojibake labels and a malformed navbar/title attribute.
- Rebuilt `relaxValue.vue` with `stressValue -> avgStressValue -> stress/value` fallback and clean HRV labels.
- Rebuilt `pressureRatio.vue` with real Chinese pressure buckets: `閺€鐐緱`, `濮濓絽鐖禶, `娑擃厾鐡慲, `閸嬪繘鐝甡.
- Rebuilt `stressSummary.vue` to remove broken template literals and malformed visible text.
- Added compact query diagnostics to Mine history report:
  - `queryEndpoint`
  - `queryItems`
  - `queryHints`
  - `queryRootKeys`
  - `queryPayloadKeys`
- Updated `analyze-rw-ble-log.mjs` to display these query fields.

## Next Test

Use build `rw-visible-build-tag-20260718-262`.

1. Open Mine, copy diagnostics once to confirm the tag.
2. Enter the pressure page and wait for sync/query to complete.
3. Copy Mine diagnostics again.
4. Check `diagnostic-history-report.query`:
   - If `queryHints.stress` or stress-related payload keys are present but UI is blank, continue fixing page render binding.
   - If query payload lacks stress fields, inspect `admin_fastapi` stress endpoint date/user/mac filtering.
5. For temperature, wait at least 65 seconds after triggering measurement. A valid fix requires a numeric `0508` or equivalent temperature frame, not only `rw_health_data_control_ack`.

