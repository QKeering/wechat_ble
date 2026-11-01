import { t, tt } from '@/i18n';
import { normalizeHealthText } from '@/utils/healthText';

export interface HealthOverviewLike {
  trend?: unknown;
  trendValue?: unknown;
  dateRange?: unknown;
}

const HEALTH_DATE_RANGE_TEXT = /^(\d{1,2}-\d{1,2})\s*至\s*(\d{1,2}-\d{1,2})$/;

const parseTrendValue = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === '') return Number.NaN;
  return Number(value);
};

/**
 * 后端的趋势文案是拼好的中文（「较上期+5」「保持不变」），tt() 命中不到这类带数字的 key。
 * 变化数值另外下发在 trendValue，这里按当前语言重新拼；只有旧缓存缺 trendValue 时才退回文案。
 */
export const formatHealthTrendText = (overview: HealthOverviewLike | null | undefined, fallback = '--'): string => {
  const trendValue = parseTrendValue(overview?.trendValue);
  if (Number.isFinite(trendValue)) {
    if (trendValue > 0) return t('较上期+{value}', { value: trendValue });
    if (trendValue < 0) return t('较上期{value}', { value: trendValue });
    return t('保持不变');
  }
  return tt(normalizeHealthText(overview?.trend, fallback));
};

/** 后端 dateRange 形如「10-26 至 11-01」，中文分隔词要按当前语言替换。 */
export const formatHealthDateRangeText = (value: unknown, fallback = '--'): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const matched = raw.match(HEALTH_DATE_RANGE_TEXT);
  return matched ? t('{start} 至 {end}', { start: matched[1], end: matched[2] }) : raw;
};
