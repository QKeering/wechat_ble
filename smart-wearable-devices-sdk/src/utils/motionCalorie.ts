export interface MotionCalorieNormalizeContext {
  stepCount?: unknown;
  targetCalorie?: unknown;
  unit?: unknown;
}

export const MOTION_CALORIE_DISPLAY_UNIT = '卡';

const toFiniteNumber = (value: unknown) => {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : null;
};

const roundKcal = (value: number) => {
  if (value >= 100) return Math.round(value);
  return Number(value.toFixed(1).replace(/\.0$/, ''));
};

export const normalizeMotionCalorieKcal = (
  value: unknown,
  context: MotionCalorieNormalizeContext = {}
) => {
  const numeric = toFiniteNumber(value);
  if (numeric == null || numeric < 0) return null;

  const stepCount = toFiniteNumber(context.stepCount);
  const targetCalorie = toFiniteNumber(context.targetCalorie);
  const explicitKcal = ['卡', '千卡', 'kcal'].includes(String(context.unit || '').trim().toLowerCase());
  const looksLikeSmallCalorie =
    !explicitKcal &&
    numeric >= 1000 &&
    ((stepCount != null && stepCount > 0 && numeric / stepCount > 1) ||
      (targetCalorie != null && targetCalorie > 0 && numeric > targetCalorie * 10) ||
      numeric > 5000);

  return roundKcal(looksLikeSmallCalorie ? numeric / 1000 : numeric);
};

export const formatMotionCalorieKcal = (value: unknown, emptyText = '00') => {
  const numeric = toFiniteNumber(value);
  if (numeric == null || numeric <= 0) return emptyText;
  return String(roundKcal(numeric));
};

export const normalizeMotionCalorieDisplayUnit = () => MOTION_CALORIE_DISPLAY_UNIT;
