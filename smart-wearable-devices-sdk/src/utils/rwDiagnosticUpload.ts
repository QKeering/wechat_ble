import { getFullUrl } from '@/utils/utils.js';

export interface RwDiagnosticUploadEntry {
  id?: number;
  time?: string;
  source?: string;
  event?: string;
  details?: unknown;
  buildTag?: string;
  deviceId?: string;
  userId?: number;
  sessionId?: string;
}

const QUEUE_STORAGE_KEY = 'qkeer:rw-diagnostic-upload-queue';
const SESSION_STORAGE_KEY = 'qkeer:rw-diagnostic-session-id';
const MAX_QUEUE_COUNT = 600;
const BATCH_SIZE = 80;
const FLUSH_DELAY_MS = 1200;
const REQUEST_TIMEOUT_MS = 5000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let pendingFlush = false;

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);

const getRwDiagnosticLogsUrl = () => {
  const baseUrl = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
  if (/^https:\/\/sh\.qkeering\.com$/i.test(baseUrl)) {
    return getFullUrl('/api/app/rw-debug/logs');
  }
  return getFullUrl('/app/rw-debug/logs');
};

const readQueue = (): RwDiagnosticUploadEntry[] => {
  if (isNodeRuntime()) return [];
  try {
    const raw = uni.getStorageSync?.(QUEUE_STORAGE_KEY);
    return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
};

const writeQueue = (queue: RwDiagnosticUploadEntry[]) => {
  if (isNodeRuntime()) return;
  try {
    uni.setStorageSync?.(QUEUE_STORAGE_KEY, queue.slice(-MAX_QUEUE_COUNT));
  } catch {
    // Upload queue must never affect diagnostics.
  }
};

export const getRwDiagnosticUploadSessionId = () => {
  if (isNodeRuntime()) return '';
  try {
    const existing = uni.getStorageSync?.(SESSION_STORAGE_KEY);
    if (existing) return String(existing);
    const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    uni.setStorageSync?.(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return '';
  }
};

const parseDetails = (details: unknown): Record<string, any> | null => {
  if (!details) return null;
  if (typeof details === 'object') return details as Record<string, any>;
  if (typeof details !== 'string') return null;
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

const pickBuildTag = (entry: RwDiagnosticUploadEntry) => {
  if (entry.buildTag) return entry.buildTag;
  const details = parseDetails(entry.details);
  return details?.buildTag || details?.snapshot?.buildTag;
};

const pickDeviceId = (entry: RwDiagnosticUploadEntry) => {
  if (entry.deviceId) return entry.deviceId;
  const details = parseDetails(entry.details);
  return (
    details?.deviceId ||
    details?.snapshot?.deviceId ||
    details?.snapshot?.currentDevice?.deviceId ||
    details?.snapshot?.storeDevice?.deviceId ||
    details?.snapshot?.userDevice?.deviceId
  );
};

const normalizeUploadEntry = (entry: RwDiagnosticUploadEntry): RwDiagnosticUploadEntry => ({
  id: typeof entry.id === 'number' ? entry.id : Date.now() * 1000 + Math.floor(Math.random() * 1000),
  time: entry.time ? String(entry.time) : undefined,
  source: String(entry.source || 'RW').slice(0, 64),
  event: String(entry.event || 'log').slice(0, 128),
  details: entry.details ?? '',
  buildTag: pickBuildTag(entry),
  deviceId: pickDeviceId(entry),
  userId: typeof entry.userId === 'number' ? entry.userId : undefined,
  sessionId: entry.sessionId || getRwDiagnosticUploadSessionId()
});

const requestRwDiagnosticUpload = (entries: RwDiagnosticUploadEntry[]) =>
  new Promise<boolean>((resolve) => {
    if (!entries.length || isNodeRuntime()) {
      resolve(true);
      return;
    }
    try {
      uni.request({
        url: getRwDiagnosticLogsUrl(),
        method: 'POST',
        timeout: REQUEST_TIMEOUT_MS,
        header: {
          'content-type': 'application/json'
        },
        data: {
          sessionId: getRwDiagnosticUploadSessionId(),
          entries
        },
        success: (response) => {
          const data = (response as any)?.data || {};
          const code = Number(data.code ?? (response as any)?.statusCode);
          resolve(code === 200 || code === 0);
        },
        fail: () => resolve(false)
      });
    } catch {
      resolve(false);
    }
  });

export const flushRwDiagnosticUploadQueue = async () => {
  if (flushing || isNodeRuntime()) {
    pendingFlush = true;
    return;
  }
  flushing = true;
  try {
    const queue = readQueue();
    if (!queue.length) return;
    const batch = queue.slice(0, BATCH_SIZE);
    const ok = await requestRwDiagnosticUpload(batch);
    if (!ok) return;
    writeQueue(queue.slice(batch.length));
    if (readQueue().length > 0) {
      pendingFlush = true;
    }
  } finally {
    flushing = false;
    if (pendingFlush) {
      pendingFlush = false;
      scheduleRwDiagnosticUploadFlush();
    }
  }
};

export const scheduleRwDiagnosticUploadFlush = () => {
  if (isNodeRuntime()) return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushRwDiagnosticUploadQueue();
  }, FLUSH_DELAY_MS);
};

export const enqueueRwDiagnosticUpload = (entry: RwDiagnosticUploadEntry) => {
  if (isNodeRuntime()) return;
  const queue = readQueue();
  queue.push(normalizeUploadEntry(entry));
  writeQueue(queue);
  scheduleRwDiagnosticUploadFlush();
};

export const clearRwDiagnosticUploadQueue = () => writeQueue([]);

export const clearRwDiagnosticRemoteLogs = () =>
  new Promise<boolean>((resolve) => {
    if (isNodeRuntime()) {
      resolve(true);
      return;
    }
    try {
      clearRwDiagnosticUploadQueue();
      uni.request({
        url: getRwDiagnosticLogsUrl(),
        method: 'DELETE',
        timeout: REQUEST_TIMEOUT_MS,
        success: (response) => {
          const data = (response as any)?.data || {};
          const code = Number(data.code ?? (response as any)?.statusCode);
          resolve(code === 200 || code === 0);
        },
        fail: () => resolve(false)
      });
    } catch {
      resolve(false);
    }
  });
