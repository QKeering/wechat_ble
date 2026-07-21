# RW v258 Addendum - 2026-07-18

Build tag: `rw-visible-build-tag-20260718-262`

## Change

Closed the remaining frontend/backend alias gap for RW vital history:

- Backend sync now accepts `heartRateValue`, `oxygenSaturation`, `hrvValue`, `pressureValue`, `temperatureValue`, `bloodSugarValue`.
- Backend sync now accepts paired blood pressure via `bloodPressureValue`, `bpValue`, arrays, or strings like `121/80`.
- Frontend vital-sign summary now reads the selected date instead of always querying today for heart rate, SpO2, temperature, and HRV details.
- Frontend vital-sign summary includes both `temperature` and `skinTemperature` in its RW vital history type list.

## Why

v257 fixed the mini-program conversion layer, but the backend still had a narrower alias list for temperature, blood sugar, and blood pressure. If RW data reached `/app/data/sync` using backend-style value aliases, those fields could still be dropped before `health_raw`.

## Verification Added

- `scripts/verify-rw-backend-health.mjs` now asserts the backend alias contract exists before running Python checks.
- `admin_fastapi/scripts/verify_rw_health_sync.py` now covers a backend-compatible alias payload with HR, SpO2, HRV, stress, temperature, blood sugar, steps, and paired blood pressure.
- `audit-rw-l19-parity.mjs` now protects the selected-date query and blood-pressure alias handling in the vital-sign summary page.

## Next Device Check

After installing v258, use Mine diagnostics to confirm the build tag. Then check whether `/app/data/sync` produces `health_raw` rows with non-null `hrv`, `stress`, `temperature`, `spo2`, `systolic`, and `diastolic` when those values are present in RW history samples.

