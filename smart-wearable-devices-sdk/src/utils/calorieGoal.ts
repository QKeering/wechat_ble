export const DEFAULT_CALORIE_GOAL_KCAL = 2000;
export const FEMALE_MIN_CALORIE_GOAL_KCAL = 1200;
export const MALE_MIN_CALORIE_GOAL_KCAL = 1500;
export const FEMALE_MAX_CALORIE_GOAL_KCAL = 3000;
export const MALE_MAX_CALORIE_GOAL_KCAL = 3500;
export const CALORIE_GOAL_STEP_KCAL = 100;

export type CalorieGoalSex = 'male' | 'female' | 'unknown';

export const normalizeCalorieGoalSex = (value: unknown): CalorieGoalSex => {
  const text = String(value ?? '').trim().toLowerCase();
  if (['0', 'male', 'man', 'm', '男'].includes(text)) return 'male';
  if (['1', 'female', 'woman', 'f', '女'].includes(text)) return 'female';
  return 'unknown';
};

export const getCalorieGoalRange = (sex: unknown) => {
  const normalizedSex = normalizeCalorieGoalSex(sex);
  if (normalizedSex === 'male') {
    return { min: MALE_MIN_CALORIE_GOAL_KCAL, max: MALE_MAX_CALORIE_GOAL_KCAL };
  }
  if (normalizedSex === 'female') {
    return { min: FEMALE_MIN_CALORIE_GOAL_KCAL, max: FEMALE_MAX_CALORIE_GOAL_KCAL };
  }
  return { min: FEMALE_MIN_CALORIE_GOAL_KCAL, max: MALE_MAX_CALORIE_GOAL_KCAL };
};

export const buildCalorieGoalOptions = (sex: unknown) => {
  const { min, max } = getCalorieGoalRange(sex);
  const values: string[] = [];
  for (let value = min; value <= max; value += CALORIE_GOAL_STEP_KCAL) {
    values.push(String(value));
  }
  return values;
};

export const normalizeCalorieGoalKcal = (
  value: unknown,
  fallback = DEFAULT_CALORIE_GOAL_KCAL,
  sex?: unknown
) => {
  const numeric = Number(value);
  const { min, max } = getCalorieGoalRange(sex);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return fallback;
  return Math.round(numeric / CALORIE_GOAL_STEP_KCAL) * CALORIE_GOAL_STEP_KCAL;
};
