# RW v254 Addendum - Sleep Boundary Upload

- Build tag: `rw-visible-build-tag-20260718-262`.
- Frontend path: `E:\qkeer\code\wechatProgram\smart-wearable-devices-next`.
- Latest attached log `214274c4-8ee0-405f-9b6f-43842cc2ff22/pasted-text.txt` is still v250. It only proves SY03 was connected/notify-ready and blood sugar returned a control ACK plus an empty health-history ACK. It does not prove current v254 behavior for HRV, stress, temperature, sleep, or detail pages.

What changed:

- RW upload-file child records now inherit upload event `startTimestamp/endTimestamp` when the child record does not carry its own boundary times.
- `/app/data/sync` payload now preserves sleep `startTime`, `endTime`, and `dateRef` in addition to `recordTime`, `sleepState`, and `sleepDuration`.
- RW business page diagnostics now includes `startTime/endTime/dateRef/sleepDuration` in raw/upload samples, so the next log can show whether the sleep time issue is parser-side, upload-side, or backend-query-side.

Why:

- The backend sleep storage can use explicit `startTime/endTime/dateRef`. Without them, it falls back to `recordTime + sleepDuration`, which can shift sleep intervals when RW records use `recordTime` as an end time or file/event time instead of the sleep start.

Validation passed before release build:

- `npm.cmd run type-check`
- `npm.cmd run audit:rw-l19 -- --skip-dist`
- `npm.cmd run verify:ring-ble` with a longer timeout; first 120s run timed out, second 300s run passed.
- `npm.cmd run analyze:rw-log -- "C:\Users\Administrator\.codex\attachments\214274c4-8ee0-405f-9b6f-43842cc2ff22\pasted-text.txt"`

Next real-device check:

1. Import `dist/build/mp-weixin` and confirm Mine diagnostics show `rw-visible-build-tag-20260718-262`.
2. Clear diagnostics.
3. Connect SY03, stay on Awareness home until background/history sync finishes.
4. Open Sleep detail, Vital Signs details, and Stress/Relax detail. Details should primarily query backend after home sync.
5. Copy Mine diagnostics. The key lines are `history-page-sync-result`, `history-page-upload-result`, and `history-page-query-result`. For sleep, check `rawRecordSample`, `submitRecordSample`, `startTime`, `endTime`, and `dateRef`.
6. If HRV/stress/temperature are still blank, classify by evidence:
   - no `rawMetricCounts`/`submitMetricCounts`: device/protocol did not provide records;
   - uploaded records exist but query sample empty: backend storage/query aggregation issue;
   - backend query sample has values but page blank: frontend detail mapping issue.

