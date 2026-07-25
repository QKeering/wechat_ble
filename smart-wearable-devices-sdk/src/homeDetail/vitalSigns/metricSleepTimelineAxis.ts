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

const getDefaultAxisData = (): TimelineAxisData => {
  const xData = Array.from({ length: DEFAULT_AXIS_POINTS }, (_, index) => `${index.toString().padStart(2, '0')}:00`);
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

export const buildMetricSleepTimelineAxis = (
  chartData: Point[] | undefined,
  sleepSegmentObj?: sleepSegment,
  forceSleepRange = false
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

  if (!dataList.length) return getDefaultAxisData();

  const xData = dataList.map((item) => {
    const minutes = parseClockMinutes(item.time);
    return minutes == null ? String(item.time || '00:00') : formatClockMinutes(minutes);
  });
  return {
    xData,
    seriesData: dataList.map((item) => normalizeMetricPointValue(item.value)),
    labelIndexes: getFallbackLabelIndexes(xData.length),
    isSleepRangeAxis: false
  };
};

export const applyMetricSleepRangeAxisStyle = (option: any, axisData: TimelineAxisData) => {
  if (!axisData.isSleepRangeAxis) return;

  option.grid = {
    ...(option.grid || {}),
    left: '4%',
    right: '4%',
    bottom: '16%',
    containLabel: true
  };

  option.xAxis = {
    ...(option.xAxis || {}),
    axisLabel: {
      ...(option.xAxis?.axisLabel || {}),
      show: true,
      interval: 0,
      hideOverlap: false,
      margin: 12,
      color: '#9ca3af',
      fontSize: 12,
      formatter: (value: string, index: number) => (axisData.labelIndexes.has(index) ? value : '')
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
  forceSleepRange = false
): TimelineAxisTick[] => {
  const dataList = Array.isArray(chartData) ? chartData : [];
  const range = getSleepRange(sleepSegmentObj);
  const pointMinutes: number[] = [];

  dataList.forEach((item) => {
    const minutes = parseClockMinutes(item?.time);
    if (minutes == null) return;
    const normalized = range ? normalizeToRange(minutes, range) : minutes;
    if (range && forceSleepRange && (normalized < range.start || normalized > range.end)) return;
    pointMinutes.push(normalized);
  });

  if (forceSleepRange && range) {
    pointMinutes.push(range.start, range.end);
  }

  const uniqueMinutes = Array.from(new Set(pointMinutes.filter((item) => Number.isFinite(item)))).sort((a, b) => a - b);
  if (!uniqueMinutes.length) {
    const axisData = buildMetricSleepTimelineAxis(chartData, sleepSegmentObj, forceSleepRange);
    const lastIndex = axisData.xData.length - 1;
    return axisData.xData
      .map((label, index) => ({ label, index }))
      .filter(({ index }) => axisData.labelIndexes.has(index))
      .map(({ label, index }, order, list) => ({
        key: `fallback-${index}-${label}`,
        label,
        left: lastIndex <= 0 ? 0 : clampPercent((index / lastIndex) * 100),
        isFirst: order === 0,
        isLast: order === list.length - 1
      }));
  }

  const min = range && forceSleepRange ? range.start : uniqueMinutes[0];
  const max = range && forceSleepRange ? range.end : uniqueMinutes[uniqueMinutes.length - 1];
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
  if (!Array.isArray(ticks) || ticks.length <= maxCount) return ticks || [];
  const lastIndex = ticks.length - 1;
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
    ...ticks[index],
    isFirst: order === 0,
    isLast: order === list.length - 1
  }));
};
