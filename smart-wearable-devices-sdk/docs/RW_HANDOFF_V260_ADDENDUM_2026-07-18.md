# RW Handoff Addendum v260 - 2026-07-18

Visible build tag: `rw-visible-build-tag-20260718-262`

## What changed

- Sleep business page now queries backend detail APIs with the selected page date.
- Fixed `getSleepDetailInfo` and `getTemperatureDetail` in `src/homeDetail/sleepPage/sleepPage.vue` so they use `formatLocalDate(currentDate)` instead of always using today.
- Confirmed the RW business inner pages keep `allowRwDeviceSync: false`; device/history synchronization remains owned by the home/Mine entry points.
- Added audit protection so sleep page detail APIs cannot regress to `formatLocalDate(new Date())`.

## Why

The project direction is that RW data sync happens at the main entry, while inner business pages read backend interfaces directly. A fixed "today" date inside a sleep detail page could make yesterday/selected-date sleep and temperature details appear wrong even when backend data exists.

## Validation

- `npm.cmd run type-check`
- `npm.cmd run verify:rw-backend-health`
- `npm.cmd run verify:ring-ble`
- `npm.cmd run audit:rw-l19 -- --skip-dist`

Build and artifact validation should be rerun after this addendum if a new package is required for device testing.

