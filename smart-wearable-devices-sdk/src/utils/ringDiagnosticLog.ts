import { enqueueRwDiagnosticUpload } from '@/utils/rwDiagnosticUpload';

export const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
export const RING_DIAGNOSTIC_VERBOSE_STORAGE_KEY = 'qkeer:ring-diagnostic-verbose';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;

export const isRingDiagnosticNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);
const padDiagnosticNumber = (value: number, length: number) => `${value}`.padStart(length, '0');
const formatDiagnosticTime = (date = new Date()) =>
  `${padDiagnosticNumber(date.getHours(), 2)}:${padDiagnosticNumber(date.getMinutes(), 2)}:${padDiagnosticNumber(date.getSeconds(), 2)}.${padDiagnosticNumber(date.getMilliseconds(), 3)}`;

type DiagnosticNoiseState = {
  lastAt: number;
  skipped: number;
};

type DiagnosticNoiseRule = {
  throttleMs: number;
  maxSkipped: number;
};

const DIAGNOSTIC_NOISY_EVENT_RULES: Record<string, DiagnosticNoiseRule> = {
  'scan-device-record': { throttleMs: 8000, maxSkipped: 20 },
  'scan-device-raw-record': { throttleMs: 8000, maxSkipped: 20 },
  'legacy-notify-received': { throttleMs: 1200, maxSkipped: 20 },
  'legacy-notify-parsed': { throttleMs: 1200, maxSkipped: 20 },
  'legacy-notify-unparsed': { throttleMs: 5000, maxSkipped: 20 },
  'legacy-command-write-start': { throttleMs: 800, maxSkipped: 10 },
  'legacy-command-write-result': { throttleMs: 800, maxSkipped: 10 }
};

const DIAGNOSTIC_DEFAULT_HIDDEN_EVENTS = new Set([
  'scan-device-raw-record',
  'legacy-notify-received',
  'legacy-notify-parsed',
  'legacy-command-write-start',
  'legacy-command-write-result',
  'business-overview-request-start',
  'business-overview-request-success',
  'business-overview-refresh-stage-start',
  'business-overview-refresh-stage-result',
  'business-overview-chart-refresh-start',
  'business-overview-chart-refresh-result',
  'business-aux-request-start',
  'business-aux-request-success',
  'business-aux-request-storage-hit',
  'girl-health-home-module-state',
  'business-overview-page-show-refresh-skip',
  'page-show',
  'page-show-already-connected',
  'page-show-skip-auto-refresh',
  'history-page-sync-skip',
  'history-page-upload-skip',
  'history-page-fallback-skip',
  'history-sync-skip',
  'history-sync-reuse-inflight',
  'refresh-skip-history-exclusive',
  'device-info-refresh-skip-history-exclusive',
  'device-info-wait-active-refresh',
  'device-info-refresh-reuse-active-result',
  'post-connect-device-info-refresh-skip',
  'maintain-ready-check',
  'maintain-ready-result',
  'single-metric-poll-read',
  'single-metric-control-enabled',
  'single-metric-skip-disable'
]);

const DIAGNOSTIC_DEFAULT_HIDDEN_PREFIXES = [
  'legacy-notify-',
  'legacy-command-write-'
];

const DIAGNOSTIC_IMPORTANT_EVENT_KEYWORDS = [
  'fail',
  'error',
  'timeout',
  'mismatch',
  'blocked',
  'invalid',
  'unparsed',
  'disconnect'
];

const DIAGNOSTIC_NOISY_STATE_MAX_COUNT = 240;
const diagnosticNoiseStates = new Map<string, DiagnosticNoiseState>();

export const isRingDiagnosticVerboseLoggingEnabled = () => {
  if (isRingDiagnosticNodeRuntime()) return false;
  try {
    const value = uni.getStorageSync?.(RING_DIAGNOSTIC_VERBOSE_STORAGE_KEY);
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'verbose';
  } catch {
    return false;
  }
};

export const setRingDiagnosticVerboseLogging = (enabled: boolean) => {
  if (isRingDiagnosticNodeRuntime()) return;
  try {
    if (enabled) {
      uni.setStorageSync?.(RING_DIAGNOSTIC_VERBOSE_STORAGE_KEY, '1');
    } else {
      uni.removeStorageSync?.(RING_DIAGNOSTIC_VERBOSE_STORAGE_KEY);
    }
  } catch {
    // Diagnostic logging controls must never affect Bluetooth sync.
  }
};

const shouldHideDiagnosticLogByDefault = (event: string) => {
  if (!event || isRingDiagnosticVerboseLoggingEnabled()) return false;
  const lowerEvent = event.toLowerCase();
  if (DIAGNOSTIC_IMPORTANT_EVENT_KEYWORDS.some((keyword) => lowerEvent.includes(keyword))) return false;
  if (DIAGNOSTIC_DEFAULT_HIDDEN_EVENTS.has(event)) return true;
  return DIAGNOSTIC_DEFAULT_HIDDEN_PREFIXES.some((prefix) => event.startsWith(prefix));
};

const parseDiagnosticDetailsObject = (details: unknown): Record<string, any> => {
  if (details && typeof details === 'object') return details as Record<string, any>;
  if (typeof details !== 'string' || !details.trim()) return {};
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
};

const pickDiagnosticDetailText = (details: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = details[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
};

const buildNoisyDiagnosticKey = (source: string, event: string, details: unknown) => {
  const parsedDetails = parseDiagnosticDetailsObject(details);
  const deviceKey = pickDiagnosticDetailText(parsedDetails, ['canonicalDeviceMac', 'deviceMac', 'mac', 'parsedMac', 'deviceId']);
  if (event === 'scan-device-record' || event === 'scan-device-raw-record') {
    const scanKey = pickDiagnosticDetailText(parsedDetails, ['advertisHex', 'name']);
    return [source, event, deviceKey, scanKey].filter(Boolean).join('|') || `${source}|${event}`;
  }
  if (event === 'legacy-notify-received' || event === 'legacy-notify-parsed' || event === 'legacy-notify-unparsed') {
    const notifyKey = [
      pickDiagnosticDetailText(parsedDetails, ['cmd']),
      pickDiagnosticDetailText(parsedDetails, ['subcmd']),
      pickDiagnosticDetailText(parsedDetails, ['status'])
    ].filter(Boolean).join('/');
    return [source, event, deviceKey, notifyKey].filter(Boolean).join('|') || `${source}|${event}`;
  }
  const commandKey = [
    pickDiagnosticDetailText(parsedDetails, ['label']),
    pickDiagnosticDetailText(parsedDetails, ['cmd']),
    pickDiagnosticDetailText(parsedDetails, ['subcmd']),
    pickDiagnosticDetailText(parsedDetails, ['status'])
  ].filter(Boolean).join('/');
  return [source, event, deviceKey, commandKey].filter(Boolean).join('|') || `${source}|${event}`;
};

const appendSampledSkipCount = (details: unknown, skipped: number) => {
  if (skipped <= 0) return details;
  const parsedDetails = parseDiagnosticDetailsObject(details);
  if (Object.keys(parsedDetails).length > 0) {
    return {
      ...parsedDetails,
      sampledSkippedCount: skipped
    };
  }
  return {
    message: typeof details === 'string' ? details : String(details ?? ''),
    sampledSkippedCount: skipped
  };
};

const cleanupNoisyDiagnosticStates = () => {
  if (diagnosticNoiseStates.size <= DIAGNOSTIC_NOISY_STATE_MAX_COUNT) return;
  const overflow = diagnosticNoiseStates.size - Math.floor(DIAGNOSTIC_NOISY_STATE_MAX_COUNT * 0.75);
  Array.from(diagnosticNoiseStates.keys()).slice(0, overflow).forEach((key) => diagnosticNoiseStates.delete(key));
};

const sampleDiagnosticLog = (source: string, event: string, details: unknown) => {
  const rule = DIAGNOSTIC_NOISY_EVENT_RULES[event];
  if (!rule) return { keep: true, details };

  const now = Date.now();
  const key = buildNoisyDiagnosticKey(source, event, details);
  const state = diagnosticNoiseStates.get(key);
  if (!state) {
    diagnosticNoiseStates.set(key, { lastAt: now, skipped: 0 });
    cleanupNoisyDiagnosticStates();
    return { keep: true, details };
  }

  const shouldFlush = now - state.lastAt >= rule.throttleMs || state.skipped >= rule.maxSkipped;
  if (!shouldFlush) {
    state.skipped += 1;
    return { keep: false, details };
  }

  const skipped = state.skipped;
  state.lastAt = now;
  state.skipped = 0;
  return {
    keep: true,
    details: appendSampledSkipCount(details, skipped)
  };
};

const normalizeDiagnosticDetails = (details: unknown) => {
  if (details == null) return '';
  let text = '';
  if (typeof details === 'string') {
    text = details;
  } else {
    try {
      text = JSON.stringify(details);
    } catch {
      text = String(details);
    }
  }
  return text.length > RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH
    ? `${text.slice(0, RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH)}...<truncated>`
    : text;
};

export const appendRingDiagnosticLog = (source: string, event: string, details?: unknown) => {
  if (isRingDiagnosticNodeRuntime()) return;
  try {
    if (shouldHideDiagnosticLogByDefault(event)) return;
    const sampled = sampleDiagnosticLog(source, event, details);
    if (!sampled.keep) return;
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatDiagnosticTime(),
      source,
      event,
      details: normalizeDiagnosticDetails(sampled.details)
    };
    logs.push(entry);
    uni.setStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
    enqueueRwDiagnosticUpload(entry);
  } catch {
    // Diagnostic logging must never affect Bluetooth sync.
  }
};
