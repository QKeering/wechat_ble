import type { heartRateDetail, Point } from '@/types/api/homeDetail';

export const getMetricNumber = (value: unknown, min = 0, max = Number.POSITIVE_INFINITY) => {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (numeric < min || numeric > max) return undefined;
  return numeric;
};

export const pickMetricNumber = (values: unknown[], min = 0, max = Number.POSITIVE_INFINITY) => {
  for (const value of values) {
    const metric = getMetricNumber(value, min, max);
    if (metric !== undefined) return metric;
  }
  return undefined;
};

const getMetricText = (value: unknown, min = 0, max = Number.POSITIVE_INFINITY) => {
  const metric = getMetricNumber(value, min, max);
  return metric !== undefined ? String(metric) : undefined;
};

export const sanitizeMetricChartData = (
  chartData: Point[] | undefined,
  min = 0,
  max = Number.POSITIVE_INFINITY
) => {
  if (!Array.isArray(chartData)) return [];
  return chartData
    .map((item) => {
      const metric = getMetricNumber(item?.value, min, max);
      return metric !== undefined ? { ...item, value: String(metric) } : undefined;
    })
    .filter(Boolean) as Point[];
};

export const withMetricDetailFallback = (
  source: heartRateDetail | undefined | null,
  fallbackValue: unknown,
  options: { min?: number; max?: number; extra?: Record<string, any> } = {}
) => {
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const sanitizedChartData = sanitizeMetricChartData(source?.chartData, min, max);
  const latestChartMetric = sanitizedChartData.length > 0
    ? sanitizedChartData[sanitizedChartData.length - 1]?.value
    : undefined;
  const metric = pickMetricNumber(
    [source?.newValue, source?.avgValue, source?.maxValue, fallbackValue, latestChartMetric],
    min,
    max
  );
  if (metric === undefined) {
    return {
      ...(source || {}),
      newValue: undefined,
      avgValue: undefined,
      maxValue: undefined,
      chartData: sanitizedChartData,
      ...(options.extra || {})
    } as heartRateDetail;
  }

  return {
    ...(source || {}),
    newValue: getMetricText(source?.newValue, min, max) ?? String(metric),
    avgValue: getMetricText(source?.avgValue, min, max) ?? String(metric),
    maxValue: getMetricText(source?.maxValue, min, max) ?? String(metric),
    chartData: sanitizedChartData.length > 0 ? sanitizedChartData : ([{ time: '00:00', value: String(metric) }] as Point[]),
    ...(options.extra || {})
  } as heartRateDetail;
};
