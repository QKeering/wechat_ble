import { enqueueRwDiagnosticUpload } from '@/utils/rwDiagnosticUpload';

export const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;

export const isRingDiagnosticNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);
const padDiagnosticNumber = (value: number, length: number) => `${value}`.padStart(length, '0');
const formatDiagnosticTime = (date = new Date()) =>
  `${padDiagnosticNumber(date.getHours(), 2)}:${padDiagnosticNumber(date.getMinutes(), 2)}:${padDiagnosticNumber(date.getSeconds(), 2)}.${padDiagnosticNumber(date.getMilliseconds(), 3)}`;

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
    const raw = uni.getStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatDiagnosticTime(),
      source,
      event,
      details: normalizeDiagnosticDetails(details)
    };
    logs.push(entry);
    uni.setStorageSync?.(RING_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
    enqueueRwDiagnosticUpload(entry);
  } catch {
    // Diagnostic logging must never affect Bluetooth sync.
  }
};
