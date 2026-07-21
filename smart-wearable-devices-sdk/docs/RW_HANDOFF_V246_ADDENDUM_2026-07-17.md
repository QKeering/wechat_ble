# RW/SY03 Handoff Addendum v246

Updated: 2026-07-17

Visible build tag: `rw-visible-build-tag-20260718-262`

## Log Finding

Tester log `13:27:06` was still from v244. It confirms the SY03 BLE connection was ready and the vital-sign page sync uploaded one record, but the compact Mine report did not include the raw/submit metric field counts or sample payload. That made it impossible to tell from the copied log whether missing detail-page fields were lost at device parse, frontend submit conversion, backend storage, or detail query.

No `0508` temperature RX evidence appeared in that log, so temperature is still treated as an unproven bottom-layer gap.

## Completed In v246

- Enriched Mine history diagnostic copy output with compact `rawMetrics`, `uploadRawMetrics`, `submitMetrics`, `rawSample`, and `submitSample` fields.
- Fixed the heart-rate, blood-oxygen, HRV, and temperature detail pages so API requests use the currently selected page date instead of always using a fresh `new Date()`.

Note: the generic business metrics bridge still keeps `0x0269` as an RW AppRealTime HRV compatibility key because the existing parity suite requires it. SY03 foreground/detail HRV validation should still rely on the stricter page-level `050A` path and the new history diagnostic counts.

## Next Validation

Install v246 and copy Mine diagnostics after opening the vital-sign/detail pages.

Check:

- `buildTag` is `rw-visible-build-tag-20260718-262`.
- `diagnostic-history-report.latest/upload` includes `rawMetrics` and `submitMetrics`.
- If `rawMetrics.temperature` is missing, keep debugging bottom-layer `0508`/temperature return.
- If `rawMetrics` has a metric but `submitMetrics` does not, debug frontend submit conversion.
- If both `rawMetrics` and `submitMetrics` have a metric but the page is empty, debug backend/detail query or page rendering.

