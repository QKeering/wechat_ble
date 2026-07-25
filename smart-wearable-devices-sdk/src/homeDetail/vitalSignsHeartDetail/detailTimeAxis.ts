import type { Point } from '@/types/api/homeDetail';

export type DetailTimeTick = {
  key: string;
  label: string;
  left: number;
  isFirst: boolean;
  isLast: boolean;
};

const formatTickLabel = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return '--';
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

export const buildDetailTimeTicks = (chartData?: Point[]): DetailTimeTick[] => {
  const dataList = Array.isArray(chartData) ? chartData : [];
  const labels = dataList.length
    ? dataList.map((item) => formatTickLabel((item as any)?.time || (item as any)?.recordTime || (item as any)?.collectTime))
    : ['00:00', '06:00', '12:00', '18:00', '23:00'];
  const indexes = getDisplayIndexes(labels.length);
  const lastIndex = Math.max(1, labels.length - 1);

  return indexes.map((dataIndex, order, list) => ({
    key: `${dataIndex}-${labels[dataIndex]}`,
    label: labels[dataIndex],
    left: Math.max(0, Math.min(100, (dataIndex / lastIndex) * 100)),
    isFirst: order === 0,
    isLast: order === list.length - 1
  }));
};
