# RW v294 handoff addendum

Build tag: `rw-visible-build-tag-20260718-294`

## Latest real-device finding

- The v293 log confirmed the false `9262` step path is blocked. No `/app/data/sync` upload was started, because the only raw record was not submittable.
- Primary sync returned one raw sleep-like record with `sleepState=46`; this is not a legal sleep stage, so it was correctly filtered out.
- The log was copied while sync was still running: `uploadStatus=uploading`, `isUploading=true`, and `history-page-missing-step-sleep-fallback-start` had appeared without a matching result yet. This means the focused `activity` fallback was still pending and cannot be judged from that copy.

## v294 change

- `history-page-sync-result.backendUploadPending` now reflects whether there are submittable records, not merely raw records.
- `history-page-upload-skip` now logs:
  - `currentSubmitRecordCount`
  - `rawMetricCounts`
  - `submitMetricCounts`
  - `rawRecordSample`
  - `filteredRecordSample`
  - `futureFilteredRecordSample`
- Record samples now include `rawDataType`, `key`, `flag`, `status`, `rawHex`, and `dataHex`, so the next log can show where invalid values such as `sleepState=46` came from.
- Mine compact diagnostic reports now preserve `filteredSample`, `rawHex`, `dataHex`, sleep state, and duration in copied logs.

## Next validation

- Retest with `rw-visible-build-tag-20260718-294`.
- Wait until the Mine panel no longer shows uploading, or at least wait 35-45 seconds after opening the homepage before copying logs.
- If step is still missing, inspect `history-page-missing-step-sleep-fallback-result` for the `activity` fallback.
- If sleep still shows `sleepState=46`, inspect its `rawHex/dataHex/key/rawDataType` before changing the parser.
