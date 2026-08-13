import { normalizeHealthText } from '@/utils/healthText';

const PRESSURE_LEVEL_STATUS_TEXTS = new Set([
  '\u538b\u529b\u504f\u9ad8',
  '\u5f88\u9ad8',
  '\u538b\u529b\u6b63\u5e38',
  '\u538b\u529b\u4e2d\u7b49',
  '\u9ad8\u538b\u529b',
  '\u7b49\u7ea7'
]);

const STRESS_LEVEL_STATUS_MAP: Record<number, string> = {
  1: '\u504f\u9ad8',
  2: '\u4e2d\u7b49',
  3: '\u6b63\u5e38',
  4: '\u653e\u677e'
};

const STRESS_STATUS_LEVEL_MAP: Record<string, number> = {
  '\u504f\u9ad8': 1,
  '\u7d27\u5f20': 1,
  '\u7d27\u5f20\u72b6\u6001': 1,
  '\u4e2d\u7b49': 2,
  '\u8f7b\u5fae\u7d27\u5f20': 2,
  '\u6b63\u5e38': 3,
  '\u5e73\u7a33': 3,
  '\u5e73\u7a33\u72b6\u6001': 3,
  '\u653e\u677e': 4,
  '\u653e\u677e\u72b6\u6001': 4
};

const STRESS_ALGORITHM_EMOTION_KEYS = [
  'stressEmotion',
  'pressureEmotion',
  'emotion',
  'emotionLabel',
  'emotionStatus',
  'emotionalState',
  'mood',
  'moodLabel',
  'moodStatus',
  'mentalState',
  'stressMood'
];

const compactPressureStatusText = (value: unknown) => normalizeHealthText(value, '').replace(/\s+/g, '');

export const isPressureLevelStatusText = (value: unknown) => {
  const text = compactPressureStatusText(value);
  return !!text && PRESSURE_LEVEL_STATUS_TEXTS.has(text);
};

export const isPendingStressStatusText = (value: unknown) =>
  /[\u91c7\u96c6\u4e2d\u6d4b\u91cf\u8bfb\u53d6\u8bf7\u6c42\u7b49\u5f85]/.test(String(value ?? ''));

export const getRelaxStatusByScore = (score: number) => {
  if (score >= 80) return '\u5e73\u7a33\u72b6\u6001';
  if (score >= 60) return '\u8f7b\u5fae\u7d27\u5f20';
  if (score > 0) return '\u7d27\u5f20\u72b6\u6001';
  return '';
};

const parseStressNumber = (value: unknown) => {
  if (value == null || value === '') return 0;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
};

export const isStressLevelValue = (value: unknown) => {
  const numeric = parseStressNumber(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 4;
};

export const getStressStatusByLevel = (level: unknown) => STRESS_LEVEL_STATUS_MAP[parseStressNumber(level)] || '';

export const getStressScoreNumber = (...values: unknown[]) => {
  for (const value of values) {
    const numeric = parseStressNumber(value);
    if (numeric > 4 && numeric <= 100) return Math.round(numeric);
  }
  return 0;
};

export const getStressLevelNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (isStressLevelValue(value)) return parseStressNumber(value);
    const text = compactPressureStatusText(value);
    if (text && STRESS_STATUS_LEVEL_MAP[text]) return STRESS_STATUS_LEVEL_MAP[text];
  }
  return 0;
};

export const readStressLevelValue = (payload: unknown, depth = 0): number => {
  if (!payload || typeof payload !== 'object' || depth > 4) return 0;
  const source = payload as Record<string, any>;
  const directLevel = getStressLevelNumber(
    source.stressValue,
    source.stressLevel,
    source.pressureLevel,
    source.level,
    source.stressGrade,
    source.grade,
    source.status,
    source.state
  );
  if (directLevel) return directLevel;
  return (
    readStressLevelValue(source.algorithm, depth + 1) ||
    readStressLevelValue(source.algorithmResult, depth + 1) ||
    readStressLevelValue(source.result, depth + 1)
  );
};

export const readStressAlgorithmEmotion = (payload: unknown, depth = 0): string => {
  if (!payload || typeof payload !== 'object' || depth > 4) return '';
  const source = payload as Record<string, any>;

  for (const key of STRESS_ALGORITHM_EMOTION_KEYS) {
    const value = source[key];
    const text =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? value.text || value.label || value.name || value.value || value.status || value.state || ''
          : '';
    const normalized = normalizeHealthText(text, '');
    if (normalized && !isPressureLevelStatusText(normalized)) return normalized;
  }

  return (
    readStressAlgorithmEmotion(source.algorithm, depth + 1) ||
    readStressAlgorithmEmotion(source.algorithmResult, depth + 1) ||
    readStressAlgorithmEmotion(source.result, depth + 1)
  );
};

export const resolveStressDisplayStatus = (params: {
  detail?: unknown;
  summary?: unknown;
  fallbackStatus?: unknown;
  score?: number;
  level?: number;
  fallbackText?: string;
}) => {
  const score = Number(params.score) || 0;
  const levelStatus =
    getStressStatusByLevel(params.level) ||
    getStressStatusByLevel(readStressLevelValue(params.detail)) ||
    getStressStatusByLevel(readStressLevelValue(params.summary));
  const rawStatus =
    readStressAlgorithmEmotion(params.detail) ||
    readStressAlgorithmEmotion(params.summary) ||
    params.fallbackStatus;

  if (score > 0 && isPendingStressStatusText(rawStatus)) {
    return getRelaxStatusByScore(score) || params.fallbackText || '\u5e73\u7a33\u72b6\u6001';
  }

  const normalized = normalizeHealthText(rawStatus, '');
  if (
    isPressureLevelStatusText(normalized) ||
    /^\s*\d+\s*(?:\u7ea7|\u7b49\u7ea7)\s*$/.test(normalized) ||
    normalized === '\u7b49\u7ea7'
  ) {
    return levelStatus || getRelaxStatusByScore(score) || params.fallbackText || '\u5e73\u7a33\u72b6\u6001';
  }

  return normalized || levelStatus || getRelaxStatusByScore(score) || params.fallbackText || '\u5e73\u7a33\u72b6\u6001';
};
