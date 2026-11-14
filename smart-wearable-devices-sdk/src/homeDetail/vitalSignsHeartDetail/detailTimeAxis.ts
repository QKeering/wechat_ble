import type { Point } from '@/types/api/homeDetail';

export type DetailTimeTick = {
  key: string;
  label: string;
  left: number;
  isFirst: boolean;
  isLast: boolean;
};

export type DetailChartAxis = {
  xData: string[];
  seriesData: Array<number | null>;
};

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const DAILY_AXIS_STEP_MINUTES = 15;
const DAILY_AXIS_END_MINUTES = 24 * 60;
const DAILY_AXIS_SLOT_COUNT = DAILY_AXIS_END_MINUTES / DAILY_AXIS_STEP_MINUTES + 1;
const MAX_RANGE_AXIS_DAYS = 32;
const FALLBACK_TICK_LABELS = ['00:00', '06:00', '12:00', '18:00', '23:00'];
const DAILY_DETAIL_TICK_LABELS = ['00:00', '06:00', '12:00', '18:00', '24:00'];

const formatTickLabel = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return '--';
  if (/^0+$/.test(text)) return '';
  const timeMatch = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }
  const dateMatch = text.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})/);
  if (dateMatch) {
    return `${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
  }
  return text.length > 5 ? text.slice(0, 5) : text;
};

const isVisibleTickLabel = (label: string) => {
  const text = String(label ?? '').trim();
  return Boolean(text && text !== '--' && !/^0+$/.test(text));
};

const parseClockMinutes = (value: unknown): number | null => {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute + Math.floor(second / 60);
};

const formatDailyClockMinutes = (minutes: number) => {
  if (Math.round(minutes) >= DAILY_AXIS_END_MINUTES) return '24:00';
  const normalized = ((Math.round(minutes) % DAILY_AXIS_END_MINUTES) + DAILY_AXIS_END_MINUTES) % DAILY_AXIS_END_MINUTES;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

const parseIsoDate = (value: unknown): Date | null => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatMonthDay = (date: Date) =>
  `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const averageBucketValue = (values: number[]): number | null => {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  // 保留 1 位小数，体温等指标不能被取整。
  return Math.round((total / values.length) * 10) / 10;
};

const normalizeChartValue = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : null;
};

/**
 * 日视图横轴固定为 00:00-24:00 的完整一天（15 分钟一个槽位），
 * 样本按自身时间落位，避免把 08:00-10:00 的样本拉伸铺满整个横轴。
 */
export const buildDailyDetailAxis = (chartData?: Point[]): DetailChartAxis => {
  const xData = Array.from({ length: DAILY_AXIS_SLOT_COUNT }, (_, index) =>
    formatDailyClockMinutes(index * DAILY_AXIS_STEP_MINUTES)
  );
  const buckets: number[][] = Array.from({ length: DAILY_AXIS_SLOT_COUNT }, () => []);
  (Array.isArray(chartData) ? chartData : []).forEach((item) => {
    const minutes = parseClockMinutes(item?.time);
    const value = normalizeChartValue(item?.value);
    if (minutes == null || value == null) return;
    const index = Math.max(
      0,
      Math.min(DAILY_AXIS_SLOT_COUNT - 1, Math.round(minutes / DAILY_AXIS_STEP_MINUTES))
    );
    buckets[index].push(value);
  });
  return { xData, seriesData: buckets.map(averageBucketValue) };
};

/**
 * 周/月视图横轴覆盖接口返回的完整区间（startDate-endDate），
 * 没有数据的日期留空，避免只有 2 天数据时被拉成整周/整月。
 */
const buildRangeDetailAxis = (
  chartData: Point[],
  startDate?: unknown,
  endDate?: unknown
): DetailChartAxis | null => {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return null;
  const dayCount = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (dayCount < 1 || dayCount > MAX_RANGE_AXIS_DAYS) return null;

  const xData = Array.from({ length: dayCount }, (_, index) =>
    formatMonthDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  );
  const indexByLabel = new Map(xData.map((label, index) => [label, index]));
  const buckets: number[][] = Array.from({ length: dayCount }, () => []);
  chartData.forEach((item) => {
    const label = formatTickLabel(item?.time);
    const value = normalizeChartValue(item?.value);
    const index = indexByLabel.get(label);
    if (value == null || index == null) return;
    buckets[index].push(value);
  });
  return { xData, seriesData: buckets.map(averageBucketValue) };
};

export const buildDetailChartAxis = (
  chartData: Point[] | undefined,
  period: string,
  range?: { startDate?: string; endDate?: string }
): DetailChartAxis => {
  const dataList = Array.isArray(chartData) ? chartData : [];
  if (period !== 'week' && period !== 'month') {
    return buildDailyDetailAxis(dataList);
  }
  const rangeAxis = buildRangeDetailAxis(dataList, range?.startDate, range?.endDate);
  if (rangeAxis) return rangeAxis;
  // 缺少区间信息时退回按数据点顺序排布。
  return {
    xData: dataList.map((item) => formatTickLabel(item?.time)),
    seriesData: dataList.map((item) => normalizeChartValue(item?.value))
  };
};

export const buildDailyDetailTimeTicks = (): DetailTimeTick[] => {
  const lastIndex = DAILY_DETAIL_TICK_LABELS.length - 1;
  return DAILY_DETAIL_TICK_LABELS.map((label, index) => ({
    key: `daily-${label}`,
    label,
    left: lastIndex <= 0 ? 0 : (index / lastIndex) * 100,
    isFirst: index === 0,
    isLast: index === lastIndex
  }));
};

const getDisplayIndexes = (length: number) => {
  if (length <= 0) return [];
  if (length <= 5) return Array.from({ length }, (_, index) => index);
  const lastIndex = length - 1;
  return Array.from(new Set([
    0,
    Math.floor(lastIndex / 4),
    Math.floor(lastIndex / 2),
    Math.floor((lastIndex * 3) / 4),
    lastIndex
  ])).sort((a, b) => a - b);
};

export const buildDetailRangeTimeTicks = (labels?: string[]): DetailTimeTick[] => {
  const formatted = (Array.isArray(labels) ? labels : [])
    .map((label) => formatTickLabel(label))
    .filter((label) => isVisibleTickLabel(label));
  const visibleLabels = formatted.length ? formatted : FALLBACK_TICK_LABELS;
  const indexes = getDisplayIndexes(visibleLabels.length);
  const lastIndex = Math.max(1, visibleLabels.length - 1);

  const ticks = indexes
    .map((dataIndex) => ({
      key: `${dataIndex}-${visibleLabels[dataIndex]}`,
      label: visibleLabels[dataIndex],
      left: Math.max(0, Math.min(100, (dataIndex / lastIndex) * 100))
    }))
    .filter((tick, index, list) => isVisibleTickLabel(tick.label) && !(index === list.length - 1 && tick.label === '00'));

  return ticks.map((tick, order, list) => ({
    ...tick,
    isFirst: order === 0,
    isLast: order === list.length - 1
  }));
};
