const HEALTH_TEXT_MAP: Record<string, string> = {
  needsimprovement: '\u5f85\u6539\u5584',
  needimprovement: '\u5f85\u6539\u5584',
  improvementneeded: '\u5f85\u6539\u5584',
  improvement: '\u5f85\u6539\u5584',
  poor: '\u8f83\u5dee',
  bad: '\u8f83\u5dee',
  weak: '\u8f83\u5f31',
  fair: '\u4e00\u822c',
  average: '\u4e00\u822c',
  moderate: '\u4e2d\u7b49',
  medium: '\u4e2d\u7b49',
  normal: '\u6b63\u5e38',
  good: '\u826f\u597d',
  great: '\u4f18\u79c0',
  excellent: '\u4f18\u79c0',
  best: '\u4f18\u79c0',
  low: '\u504f\u4f4e',
  lower: '\u504f\u4f4e',
  high: '\u504f\u9ad8',
  higher: '\u504f\u9ad8',
  mild: '\u8f7b\u5ea6',
  light: '\u8f7b\u5ea6',
  severe: '\u4e25\u91cd',
  roomforimprovement: '\u5f85\u6539\u5584',
  notideal: '\u5f85\u6539\u5584',
  notgood: '\u5f85\u6539\u5584',
  stable: '\u57fa\u672c\u6301\u5e73',
  nochange: '\u57fa\u672c\u6301\u5e73',
  unchanged: '\u57fa\u672c\u6301\u5e73',
  increase: '\u4e0a\u5347',
  increased: '\u4e0a\u5347',
  increasing: '\u4e0a\u5347',
  up: '\u4e0a\u5347',
  rise: '\u4e0a\u5347',
  rising: '\u4e0a\u5347',
  decrease: '\u4e0b\u964d',
  decreased: '\u4e0b\u964d',
  decreasing: '\u4e0b\u964d',
  down: '\u4e0b\u964d',
  drop: '\u4e0b\u964d',
  falling: '\u4e0b\u964d',
  improved: '\u6709\u6539\u5584',
  better: '\u6709\u6539\u5584',
  worsened: '\u6709\u4e0b\u964d',
  worse: '\u6709\u4e0b\u964d',
  timeout: '\u8bbe\u5907\u54cd\u5e94\u8d85\u65f6',
  unsupported: '\u5f53\u524d\u8bbe\u5907\u6682\u4e0d\u652f\u6301',
  unsupportedrealtime: '\u5f53\u524d\u8bbe\u5907\u6682\u4e0d\u652f\u6301\u5b9e\u65f6\u8bfb\u53d6',
  lowactivity: '\u6d3b\u52a8\u504f\u4f4e',
  highactivity: '\u6d3b\u52a8\u504f\u9ad8',
  insufficientactivity: '\u6d3b\u52a8\u4e0d\u8db3',
  sleepok: '\u7761\u7720\u6b63\u5e38',
  lifestyle: '\u751f\u6d3b\u4e60\u60ef',
  sleepactivation: '\u7761\u7720\u6fc0\u6d3b',
  sleeppreparation: '\u7761\u524d\u51c6\u5907',
  sleeprecovery: '\u7761\u7720\u6062\u590d',
  sleeprhythm: '\u7761\u7720\u8282\u5f8b',
  activityrisk: '\u6d3b\u52a8\u5f3a\u5ea6',
  sedentaryrisk: '\u4e45\u5750\u98ce\u9669',
  exerciseregularity: '\u8fd0\u52a8\u89c4\u5f8b\u6027',
  activityintensity: '\u6d3b\u52a8\u5f3a\u5ea6',
  vitalsigns: '\u751f\u547d\u4f53\u5f81',
  heartrate: '\u5fc3\u7387',
  bloodoxygen: '\u8840\u6c27',
  bodytemperature: '\u4f53\u6e29',
  deepsleep: '\u6df1\u7761',
  lightsleep: '\u6d45\u7761',
  remsleep: '\u5feb\u901f\u773c\u52a8\u7761\u7720',
  awake: '\u6e05\u9192',
  sedentary: '\u4e45\u5750',
  inactive: '\u4e0d\u6d3b\u8dc3',
  active: '\u6d3b\u8dc3',
  heavyload: '\u91cd\u5ea6\u8d1f\u8377',
  suboptimal: '\u4e0d\u7406\u60f3',
  ok: '\u6b63\u5e38'
};

const CHINESE_HEALTH_TEXT = /[\u4e00-\u9fff]/;
const ASCII_TEXT = /^[\x00-\x7f]+$/;
const NUMBER_OR_VERSION_TEXT = /^[-+]?\d+(?:\.\d+)*(?:\s*(?:%|bpm|mmhg|mmol\/l|\u2103|\u00b0c|\u5206\u949f|\u5c0f\u65f6|\u6b65|\u5361|\u5343\u5361|kcal))?$/i;
const DATE_OR_RANGE_TEXT = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s*[~-]\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2})?$/;
const MOJIBAKE_TEXT =
  /[\ufffd\u951f]|[\ue000-\uf8ff]|\u95bc\?[\s\S]*\u9288\?|(?:\u93c8|\u7481|\u9422|\u7e51|\u934a){2,}/;

const MOJIBAKE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u5bf0\u5446\u657c\u934e\??/, '\u5f85\u6539\u5584'],
  [/\u9479\ue1c8\u5abe/, '\u826f\u597d'],
  [/\u6d7c\u6a3c\ue745/, '\u4f18\u79c0'],
  [/\u9359\u70d8\u6e6c\u93b8\u4f7a\u5e73/, '\u57fa\u672c\u6301\u5e73'],
  [/\u6d93\u5d0c/, '\u4e0a\u5347'],
  [/\u6d93\u5a07\u6aac/, '\u4e0b\u964d'],
  [/\u7481\u60e7[\s\S]*\u93c8[\s\S]*\u7e51/, '\u8bbe\u5907\u672a\u8fd4\u56de\u5b9e\u65f6\u6570\u503c'],
  [/\u7481\u60e7[\s\S]*\u669f[\s\S]*\u934a/, '\u8bbe\u5907\u672a\u8fd4\u56de\u5b9e\u65f6\u6570\u503c'],
  [/\u74d2\u546e\u6902/, '\u8bbe\u5907\u54cd\u5e94\u8d85\u65f6'],
  [/\u93c8[\ue000-\uf8ff]?\u5396\u9422/, '\u672a\u5145\u7535']
];

const compactHealthText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s_./:-]+/g, '')
    .replace(/[^\da-z]+/g, '');

export const isLikelyMojibakeHealthText = (value: unknown) => {
  const text = String(value ?? '').trim();
  return Boolean(text && MOJIBAKE_TEXT.test(text));
};

export const normalizeHealthText = (value: unknown, fallback = '--') => {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value).trim();
  if (!text) return fallback;

  const mappedMojibake = MOJIBAKE_TEXT_REPLACEMENTS.find(([pattern]) => pattern.test(text));
  if (mappedMojibake) return mappedMojibake[1];

  if (isLikelyMojibakeHealthText(text)) return fallback;
  if (CHINESE_HEALTH_TEXT.test(text)) return text;
  if (NUMBER_OR_VERSION_TEXT.test(text) || DATE_OR_RANGE_TEXT.test(text)) return text;

  const compact = compactHealthText(text);
  if (HEALTH_TEXT_MAP[compact]) return HEALTH_TEXT_MAP[compact];

  if (!ASCII_TEXT.test(text)) return text;
  return fallback;
};

export const normalizeHealthLevel = (value: unknown, score = 0, fallback = '') => {
  const normalized = normalizeHealthText(value, '');
  if (normalized) return normalized;
  if (score >= 80) return '\u4f18\u79c0';
  if (score >= 60) return '\u826f\u597d';
  return fallback || '\u5f85\u6539\u5584';
};
