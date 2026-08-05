import type { Point, sleepSegment } from '@/types/api/homeDetail';

export type TimelineAxisData = {
  xData: string[];
  seriesData: Array<number | null>;
  labelIndexes: Set<number>;
  isSleepRangeAxis: boolean;
};

export type TimelineAxisTick = {
  key: string;
  label: string;
  left: number;
  isFirst: boolean;
  isLast: boolean;
};

const DEFAULT_AXIS_POINTS = 24;
const SLEEP_AXIS_SLOT_MINUTES = 10;
const DAILY_AXIS_SLOT_MINUTES = 10;
const DAILY_METRIC_TICK_LABELS = ['00:00', '06:00', '12:00', '18:00', '24:00'];

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

const formatClockMinutes = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

const formatDailyClockMinutes = (minutes: number) => {
  if (Math.round(minutes) >= 1440) return '24:00';
  return formatClockMinutes(minutes);
};

const parseDailyAxisEndMinutes = (value?: unknown) => {
  const text = String(value ?? '').trim();
  if (text === '24:00') return 1440;
  const parsed = parseClockMinutes(text);
  if (parsed == null) return 1440;
  return Math.max(1, Math.min(1440, parsed));
};

const parseDailyTickMinutes = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (text === '24:00') return 1440;
  return parseClockMinutes(text) ?? 0;
};

export const normalizeTimelineLabel = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text || /^0+$/.test(text)) return '';
  return text;
};

const isVisibleTimelineTickLabel = (label: unknown) => Boolean(normalizeTimelineLabel(label));

const getSleepRange = (segment?: sleepSegment) => {
  const start = parseClockMinutes(segment?.startTime);
  let end = parseClockMinutes(segment?.endTime);
  if (start == null || end == null) return null;
  if (end <= start) end += 1440;
  if (end - start <= 0) return null;
  return { start, end };
};

const normalizeToRange = (minutes: number, range: { start: number; end: number }) => {
  if (range.end > 1440 && minutes < range.start) return minutes + 1440;
  return minutes;
};

const getDefaultAxisData = (dailyAxisEndTime?: string): TimelineAxisData => {
  const axisEndMinutes = parseDailyAxisEndMinutes(dailyAxisEndTime);
  const xData = Array.from({ length: DEFAULT_AXIS_POINTS }, (_, index) =>
    formatDailyClockMinutes((axisEndMinutes * index) / (DEFAULT_AXIS_POINTS - 1))
  );
  return {
    xData,
    seriesData: [],
    labelIndexes: new Set([0, 6, 12, 18, DEFAULT_AXIS_POINTS - 1]),
    isSleepRangeAxis: false
  };
};

const getFallbackLabelIndexes = (length: number) => {
  if (length <= 0) return new Set<number>();
  if (length <= 5) return new Set(Array.from({ length }, (_, index) => index));
  const lastIndex = length - 1;
  return new Set([
    0,
    Math.floor(lastIndex / 4),
    Math.floor(lastIndex / 2),
    Math.floor((lastIndex * 3) / 4),
    lastIndex
  ]);
};

const getSleepRangeLabelIndexes = (length: number) => {
  if (length <= 1) return new Set([0]);
  return new Set([0, length - 1]);
};

const normalizeMetricPointValue = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : null;
};

const buildDailyMetricAxisData = (dataList: Point[], dailyAxisEndTime?: string): TimelineAxisData => {
  const axisEndMinutes = parseDailyAxisEndMinutes(dailyAxisEndTime);
  const slotCount = Math.max(2, Math.ceil(axisEndMinutes / DAILY_AXIS_SLOT_MINUTES) + 1);
  const xData = Array.from({ length: slotCount }, (_, index) =>
    formatDailyClockMinutes((axisEndMinutes * index) / (slotCount - 1))
  );
  const bucketValues: number[][] = Array.from({ length: slotCount }, () => []);
  let parsedCount = 0;

  dataList.forEach((item) => {
    const minutes = parseClockMinutes(item.time);
    if (minutes == null || minutes > axisEndMinutes) return;
    const value = normalizeMetricPointValue(item.value);
    if (value == null) return;
    parsedCount += 1;
    const index = Math.max(0, Math.min(slotCount - 1, Math.round((minutes / axisEndMinutes) * (slotCount - 1))));
    bucketValues[index].push(value);
  });

  if (dataList.length && !parsedCount) {
    const fallbackXData = dataList.map((item) => normalizeTimelineLabel(item.time));
    return {
      xData: fallbackXData,
      seriesData: dataList.map((item) => normalizeMetricPointValue(item.value)),
      labelIndexes: getFallbackLabelIndexes(fallbackXData.length),
      isSleepRangeAxis: false
    };
  }

  return {
    xData,
    seriesData: bucketValues.map((values) => {
      if (!values.length) return null;
      return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
    }),
    labelIndexes: getFallbackLabelIndexes(xData.length),
    isSleepRangeAxis: false
  };
};

export const buildMetricSleepTimelineAxis = (
  chartData: Point[] | undefined,
  sleepSegmentObj?: sleepSegment,
  forceSleepRange = false,
  dailyAxisEndTime?: string
): TimelineAxisData => {
  const dataList = Array.isArray(chartData) ? chartData : [];
  const range = forceSleepRange ? getSleepRange(sleepSegmentObj) : null;

  if (range) {
    const totalMinutes = range.end - range.start;
    const slotCount = Math.max(2, Math.ceil(totalMinutes / SLEEP_AXIS_SLOT_MINUTES) + 1);
    const xData = Array.from({ length: slotCount }, (_, index) =>
      formatClockMinutes(range.start + (totalMinutes * index) / (slotCount - 1))
    );
    const bucketValues: number[][] = Array.from({ length: slotCount }, () => []);

    dataList.forEach((item) => {
      const rawMinutes = parseClockMinutes(item.time);
      if (rawMinutes == null) return;
      const minutes = normalizeToRange(rawMinutes, range);
      if (minutes < range.start || minutes > range.end) return;
      const value = normalizeMetricPointValue(item.value);
      if (value == null) return;
      const index = Math.max(0, Math.min(slotCount - 1, Math.round(((minutes - range.start) / totalMinutes) * (slotCount - 1))));
      bucketValues[index].push(value);
    });

    return {
      xData,
      seriesData: bucketValues.map((values) => {
        if (!values.length) return null;
        return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
      }),
      labelIndexes: getSleepRangeLabelIndexes(slotCount),
      isSleepRangeAxis: true
    };
  }

  if (!dataList.length) return getDefaultAxisData(dailyAxisEndTime);

  return buildDailyMetricAxisData(dataList, dailyAxisEndTime);
};

export const applyMetricSleepRangeAxisStyle = (option: any, _axisData: TimelineAxisData) => {
  option.grid = {
    ...(option.grid || {}),
    left: 24,
    right: 24,
    top: 56,
    bottom: 34,
    containLabel: false
  };

  option.xAxis = {
    ...(option.xAxis || {}),
    boundaryGap: false,
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: {
      ...(option.xAxis?.axisLabel || {}),
      show: false
    }
  };
};

export const getMetricTimelineEdgeLabels = (axisData: TimelineAxisData) => {
  const start = axisData.xData[0] || '00:00';
  const end = axisData.xData[axisData.xData.length - 1] || start;
  return { start, end };
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export const getMetricTimelineTicks = (
  chartData: Point[] | undefined,
  sleepSegmentObj?: sleepSegment,
  forceSleepRange = false,
  dailyAxisEndTime?: string
): TimelineAxisTick[] => {
  if (!forceSleepRange) {
    const axisEndMinutes = parseDailyAxisEndMinutes(dailyAxisEndTime);
    const labels = DAILY_METRIC_TICK_LABELS
      .map((label) => ({ label, minutes: parseDailyTickMinutes(label) }))
      .filter((item) => item.minutes <= axisEndMinutes);
    const endLabel = formatDailyClockMinutes(axisEndMinutes);
    if (!labels.some((item) => item.label === endLabel)) {
      labels.push({ label: endLabel, minutes: axisEndMinutes });
    }
    return labels.map((item, index, list) => ({
      key: `daily-${item.label}`,
      label: item.label,
      left: clampPercent((item.minutes / axisEndMinutes) * 100),
      isFirst: index === 0,
      isLast: index === list.length - 1
    }));
  }

  const dataList = Array.isArray(chartData) ? chartData : [];
  const range = getSleepRange(sleepSegmentObj);
  const pointMinutes: number[] = [];

  if (range) {
    return [
      {
        key: `sleep-start-${range.start}`,
        label: formatClockMinutes(range.start),
        left: 0,
        isFirst: true,
        isLast: false
      },
      {
        key: `sleep-end-${range.end}`,
        label: formatClockMinutes(range.end),
        left: 100,
        isFirst: false,
        isLast: true
      }
    ].filter((tick, index, list) => tick.label && !(index === list.length - 1 && tick.label === '00'));
  }

  dataList.forEach((item) => {
    const minutes = parseClockMinutes(item?.time);
    if (minutes == null) return;
    pointMinutes.push(minutes);
  });

  const uniqueMinutes = Array.from(new Set(pointMinutes.filter((item) => Number.isFinite(item)))).sort((a, b) => a - b);
  if (!uniqueMinutes.length) {
    if (dataList.length) return [];
    const axisData = buildMetricSleepTimelineAxis(chartData, sleepSegmentObj, forceSleepRange);
    const lastIndex = axisData.xData.length - 1;
    return axisData.xData
      .map((label, index) => ({ label, index }))
      .filter(({ label, index }) => axisData.labelIndexes.has(index) && isVisibleTimelineTickLabel(label))
      .map(({ label, index }, order, list) => ({
        key: `fallback-${index}-${label}`,
        label,
        left: lastIndex <= 0 ? 0 : clampPercent((index / lastIndex) * 100),
        isFirst: order === 0,
        isLast: order === list.length - 1
      }));
  }

  const min = uniqueMinutes[0];
  const max = uniqueMinutes[uniqueMinutes.length - 1];
  const span = Math.max(1, max - min);

  return uniqueMinutes.map((minutes, index, list) => ({
    key: `${minutes}-${index}`,
    label: formatClockMinutes(minutes),
    left: clampPercent(((minutes - min) / span) * 100),
    isFirst: index === 0,
    isLast: index === list.length - 1
  }));
};

export const compactMetricTimelineTicks = (ticks: TimelineAxisTick[], maxCount = 5): TimelineAxisTick[] => {
  const visibleTicks = (Array.isArray(ticks) ? ticks : []).filter((tick) => isVisibleTimelineTickLabel(tick.label));
  if (visibleTicks.length <= maxCount) {
    return visibleTicks.map((tick, order, list) => ({
      ...tick,
      isFirst: order === 0,
      isLast: order === list.length - 1
    }));
  }
  const lastIndex = visibleTicks.length - 1;
  const indexes = Array.from(
    new Set([
      0,
      Math.floor(lastIndex / 4),
      Math.floor(lastIndex / 2),
      Math.floor((lastIndex * 3) / 4),
      lastIndex
    ])
  ).sort((a, b) => a - b);
  return indexes.map((index, order, list) => ({
    ...visibleTicks[index],
    isFirst: order === 0,
    isLast: order === list.length - 1
  }));
};
