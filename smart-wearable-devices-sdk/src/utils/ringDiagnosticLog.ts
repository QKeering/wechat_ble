import { enqueueRwDiagnosticUpload } from '@/utils/rwDiagnosticUpload';
import { QKEER_BUILD_INFO, QKEER_BUILD_TAG } from '@/utils/buildInfo';

export const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
export const RING_DIAGNOSTIC_VERBOSE_STORAGE_KEY = 'qkeer:ring-diagnostic-verbose';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;
const RING_DIAGNOSTIC_LOG_FLUSH_DELAY_MS = 2500;

type RingDiagnosticLogEntry = {
  id: number;
  time: string;
  source: string;
  event: string;
  details: string;
};

let diagnosticLogCache: RingDiagnosticLogEntry[] | null = null;
let diagnosticLogFlushTimer: ReturnType<typeof setTimeout> | null = null;

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
  'home-sync-cooldown-mark',
  'home-sync-cooldown-skip',
  'home-sync-session-skipped',
  'home-sync-session-claimed',
  'home-sync-session-released',
  'home-sync-global-session-skipped',
  'page-show',
  'page-show-already-connected',
  'page-show-skip-auto-refresh',
  'history-page-sync-skip',
  'history-page-upload-skip',
  'history-page-fallback-skip',
  'history-page-query-result',
  'history-sync-skip',
  'history-sync-reuse-inflight',
  'legacy-local-data-stable-wait-skip',
  'legacy-local-data-stable-wait-progress',
  'legacy-local-data-incomplete-flush-schedule-skip',
  'legacy-local-data-incomplete-flush-scheduled',
  'legacy-local-data-incomplete-flush-timer-fired',
  'legacy-local-data-incomplete-flush-immediate',
  'legacy-local-data-incomplete-flush-early',
  'legacy-local-data-upload-pending',
  'legacy-home-history-read-completed-skip',
  'legacy-home-history-read-completed-marked',
  'legacy-home-history-long-retry-skip',
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

const readDiagnosticLogCache = () => {
  if (diagnosticLogCache) return diagnosticLogCache;
  if (isRingDiagnosticNodeRuntime()) {
    diagnosticLogCache = [];
    return diagnosticLogCache;
  }
  try {
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    diagnosticLogCache = Array.isArray(raw)
      ? raw.filter((item): item is RingDiagnosticLogEntry => Boolean(item && typeof item === 'object')).slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT)
      : [];
  } catch {
    diagnosticLogCache = [];
  }
  return diagnosticLogCache;
};

export const flushRingDiagnosticLogs = () => {
  if (isRingDiagnosticNodeRuntime() || !diagnosticLogCache) return;
  try {
    uni.setStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY, diagnosticLogCache.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
  } catch {
    // Diagnostic logging must never affect Bluetooth sync.
  }
};

const scheduleDiagnosticLogFlush = () => {
  if (isRingDiagnosticNodeRuntime() || diagnosticLogFlushTimer) return;
  diagnosticLogFlushTimer = setTimeout(() => {
    diagnosticLogFlushTimer = null;
    flushRingDiagnosticLogs();
  }, RING_DIAGNOSTIC_LOG_FLUSH_DELAY_MS);
};

export const appendRingDiagnosticLog = (source: string, event: string, details?: unknown) => {
  if (isRingDiagnosticNodeRuntime()) return;
  try {
    if (shouldHideDiagnosticLogByDefault(event)) return;
    const sampled = sampleDiagnosticLog(source, event, details);
    if (!sampled.keep) return;
    const logs = readDiagnosticLogCache();
    const versionedDetails = sampled.details && typeof sampled.details === 'object' && !Array.isArray(sampled.details)
      ? { ...(sampled.details as Record<string, unknown>), appBuild: QKEER_BUILD_INFO }
      : { value: sampled.details, appBuild: QKEER_BUILD_INFO };
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatDiagnosticTime(),
      source,
      event,
      details: normalizeDiagnosticDetails(versionedDetails),
      buildTag: QKEER_BUILD_TAG
    };
    logs.push(entry);
    if (logs.length > RING_DIAGNOSTIC_LOG_MAX_COUNT) {
      logs.splice(0, logs.length - RING_DIAGNOSTIC_LOG_MAX_COUNT);
    }
    scheduleDiagnosticLogFlush();
    enqueueRwDiagnosticUpload(entry);
  } catch {
    // Diagnostic logging must never affect Bluetooth sync.
  }
};
