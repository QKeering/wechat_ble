#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distRoot = join(process.cwd(), 'dist', 'build', 'mp-weixin');
const vitalSignsDetailDir = join(distRoot, 'homeDetail', 'vitalSignsHeartDetail');
const metricFallbackPath = join(vitalSignsDetailDir, 'metricFallback.js');

const metricFallbackSource = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getMetricNumber = (value, min = 0, max = Number.POSITIVE_INFINITY) => {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Number(String(value).replace(/[^\\d.-]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (numeric < min || numeric > max) return undefined;
  return numeric;
};
const pickMetricNumber = (values, min = 0, max = Number.POSITIVE_INFINITY) => {
  for (const value of values || []) {
    const metric = getMetricNumber(value, min, max);
    if (metric !== undefined) return metric;
  }
  return undefined;
};
const sanitizeMetricChartData = (chartData, min = 0, max = Number.POSITIVE_INFINITY) => {
  if (!Array.isArray(chartData)) return [];
  return chartData.map((item) => {
    const metric = getMetricNumber(item && item.value, min, max);
    return metric !== undefined ? { ...item, value: String(metric) } : undefined;
  }).filter(Boolean);
};
const getMetricText = (value, min = 0, max = Number.POSITIVE_INFINITY) => {
  const metric = getMetricNumber(value, min, max);
  return metric !== undefined ? String(metric) : undefined;
};
const withMetricDetailFallback = (source, fallbackValue, options = {}) => {
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const sanitizedChartData = sanitizeMetricChartData(source && source.chartData, min, max);
  const latestChartMetric = sanitizedChartData.length > 0 ? sanitizedChartData[sanitizedChartData.length - 1].value : undefined;
  const metric = pickMetricNumber([source && source.newValue, source && source.avgValue, source && source.maxValue, fallbackValue, latestChartMetric], min, max);
  if (metric === undefined) {
    return {
      ...(source || {}),
      newValue: undefined,
      avgValue: undefined,
      maxValue: undefined,
      chartData: sanitizedChartData,
      ...(options.extra || {})
    };
  }
  return {
    ...(source || {}),
    newValue: getMetricText(source && source.newValue, min, max) ?? String(metric),
    avgValue: getMetricText(source && source.avgValue, min, max) ?? String(metric),
    maxValue: getMetricText(source && source.maxValue, min, max) ?? String(metric),
    chartData: sanitizedChartData.length > 0 ? sanitizedChartData : [{ time: "00:00", value: String(metric) }],
    ...(options.extra || {})
  };
};
exports.getMetricNumber = getMetricNumber;
exports.pickMetricNumber = pickMetricNumber;
exports.sanitizeMetricChartData = sanitizeMetricChartData;
exports.withMetricDetailFallback = withMetricDetailFallback;
`;

if (!existsSync(vitalSignsDetailDir)) {
  throw new Error(`mp-weixin vital detail dir is missing: ${vitalSignsDetailDir}`);
}

mkdirSync(dirname(metricFallbackPath), { recursive: true });
writeFileSync(metricFallbackPath, metricFallbackSource, 'utf8');
console.log(`patched mp-weixin artifact: ${metricFallbackPath}`);
