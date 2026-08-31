import type { sleepOverview } from '@/types/api/homeDetail';

export const SLEEP_OVERVIEW_UPDATED_EVENT = 'qkeer:sleep-overview-updated';

export interface SleepOverviewUpdatedPayload {
  date: string;
  overview: sleepOverview;
  source?: string;
}

export const normalizeSleepScore = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const score = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(score) || score <= 0 || score > 100) return null;
  return Math.round(score);
};

export const publishSleepOverviewUpdate = (payload: SleepOverviewUpdatedPayload) => {
  if (!payload.date || !payload.overview) return;
  uni.$emit(SLEEP_OVERVIEW_UPDATED_EVENT, payload);
};
