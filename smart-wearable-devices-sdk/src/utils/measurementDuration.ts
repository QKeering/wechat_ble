export const MIN_VITAL_MEASUREMENT_DURATION_MS = 30000;
export const MAX_VITAL_MEASUREMENT_DURATION_MS = 60000;

export const getRemainingVitalMeasurementMs = (
  startedAt: number,
  minDurationMs = MIN_VITAL_MEASUREMENT_DURATION_MS
) => {
  if (!startedAt) return minDurationMs;
  return Math.max(0, minDurationMs - (Date.now() - startedAt));
};
