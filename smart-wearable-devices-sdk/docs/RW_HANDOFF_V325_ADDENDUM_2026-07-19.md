# RW/SY03 v325 Step Parser Addendum

Visible build: `rw-visible-build-tag-20260719-325`.

Goal: fix a parser ordering issue found while validating the step path, while keeping the conservative upload rule unchanged.

## Latest v324 Log Result

- Mine page temperature probe buttons were hidden as intended by `MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false`.
- Temperature commands still appeared in logs, but they came from page/background history sync labels such as `history/ab-key/temperature-current/read` and `history/ab-key/temperature-history/read`, not from Mine-page temperature probe buttons.
- `activityHistory` / `history-key/activity/read` / `0x0502` was tested again:
  - TX: `ab010003ad10050210`
  - RX: `ab110003ad10050210`
  - Parsed as empty `rw_health_data_ack` for step key `0x0502`.
  - Conclusion: `0x0502` command path works, but the SY03 returned no upload-safe activity history payload.
- Page sync read `history-key/activity-current-day/read` / `0x051a` and received a non-empty long AB packet:
  - TX: `ab010003ad1a051a10`
  - RX started with `ab1100a32c9d051a10...`
  - The packet should be interpreted as `BLE_KEY_ACTIVITY_CURRENT_DAY` / `0x051a`.
  - It was incorrectly parsed as `rw_qkeer_v2_checksum_failed` because the payload byte at the QKeer V2 command position resembled `SleepList = 0x31`.

## v325 Change

- `parseRwRingData` now parses RW AB/C6 key frames before trying QKeer V2 compatibility frames.
- Added parser parity sample `realDeviceRelativeCurrentDayStepSleepCmdCollision`.
- Expected parser result for the new `0x051a` sample:
  - `type = rw_health_data`
  - `name = step`
  - `key = 0x051a`
  - `value = 62`
  - first record `rawDataType = ab_activity_current_day_relative_hour`
- This only fixes parsing visibility. It does not upload `0x051a` current-day relative/hourly step candidates to `admin_fastapi`.
- `health_raw.step_count` remains protected by the existing upload filter until the `0x051a` packet contract is proven safe against the true device step count.

## Current Step State

- `0x051a` is the only path currently returning step-like payloads on this SY03.
- `0x0502` is the preferred upload-safe history path but currently returns empty ACK.
- Next true-device test should publish v325, clear logs, tap `当天步数051a` / `stepCurrentDay`, and confirm the parsed result is no longer `rw_qkeer_v2_checksum_failed`.
