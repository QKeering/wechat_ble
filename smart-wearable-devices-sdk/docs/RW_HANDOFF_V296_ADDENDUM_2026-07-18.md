# RW v296 Addendum - SY03 JL Sleep Parser

## Context

- Latest user log before this change was still `rw-visible-build-tag-20260718-294`, so the v295 backend log upload loop was not active in that test package.
- The log showed SY03 connected and ready, with AB history key `0x0505` sleep returning a non-empty payload:
  - `rawDataType: ab_health_key`
  - `key: 0x0505`
  - payload starts with `2e2221701100002e2225a8010000...`
- The old parser treated the first payload byte `0x2e` as a scalar sleep state (`46`), then upload filtered it as invalid.

## Change

- Added parser support for SY03/JL sleep history records:
  - 7-byte records
  - bytes `0..3`: big-endian seconds since `2000-01-01`, converted with local timezone offset to match the RW APP SDK
  - byte `4`: JL sleep model
  - bytes `5..6`: reserved
- Converts point pairs into segment records with `startTimestamp`, `endTimestamp`, `durationMinutes`, `sleepStatus`, and L19-compatible `sleepState`.
- Guards sleep scalar fallback so protocol bytes such as `0x2e` cannot be uploaded as business sleep data.
- Added parser parity coverage using the real SY03 payload prefix from the v294 log.

## Next Verification

- Publish/build tag must show `rw-visible-build-tag-20260718-297`.
- If backend v295 routes are deployed, prefer `https://sh.qkeering.com/rw-debug/logs?limit=1000` over copied vConsole text.
- If sleep records parse but do not show for the selected day, check `timestampSource=device_jl_seconds_since_2000` and the parsed year/date. The v294 payload appeared to contain an old device timestamp, so time sync or stale device history may be the next issue.
