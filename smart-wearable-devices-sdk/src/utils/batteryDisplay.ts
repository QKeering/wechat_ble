const BATTERY_DISPLAY_RANGES = [
  { min: 85, max: 100, displayMin: 92, displayMax: 100 },
  { min: 65, max: 84, displayMin: 75, displayMax: 91 },
  { min: 40, max: 64, displayMin: 45, displayMax: 74 },
  { min: 20, max: 39, displayMin: 20, displayMax: 44 },
  { min: 8, max: 19, displayMin: 5, displayMax: 19 },
  { min: 0, max: 7, displayMin: 0, displayMax: 4 }
];

export const getRawBatteryPercent = (value: unknown) => {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(numeric)) return null;
  return Math.min(Math.max(numeric, 0), 100);
};

export const mapBatteryPercentForDisplay = (value: unknown) => {
  const raw = getRawBatteryPercent(value);
  if (raw == null) return null;

  const roundedRaw = Math.round(raw);
  const range = BATTERY_DISPLAY_RANGES.find((item) => roundedRaw >= item.min && roundedRaw <= item.max);
  if (!range) return roundedRaw;
  if (range.min === range.max) return range.displayMax;

  const ratio = (roundedRaw - range.min) / (range.max - range.min);
  const display = range.displayMin + ratio * (range.displayMax - range.displayMin);
  return Math.min(Math.max(Math.round(display), range.displayMin), range.displayMax);
};

export const formatBatteryPercentForDisplay = (value: unknown, emptyText = '-') => {
  if (value == null || value === '') return emptyText;
  const text = String(value).trim();
  const displayValue = mapBatteryPercentForDisplay(text);
  if (displayValue != null) return `${displayValue}%`;
  return text;
};
