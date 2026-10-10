import { getApiBase } from '@/utils/apiBase';
import { getFullUrl } from '@/utils/utils.js';

export interface RwDiagnosticUploadEntry {
  id?: number;
  eventId?: string;
  time?: string;
  source?: string;
  event?: string;
  details?: unknown;
  buildTag?: string;
  deviceId?: string;
  userId?: number;
  sessionId?: string;
  /**
   * 高频噪声事件（`DIAGNOSTIC_NOISY_EVENT_RULES` 里那些，例如一次扫描每个设备一条的
   * `scan-device-record`）。队列溢出时优先淘汰这些，避免「一次成功扫描的几百条噪声
   * 把同一时刻的稀疏关键埋点挤掉」——那种丢失会让日志对成功路径完全撒谎。
   */
  noisy?: boolean;
}

const QUEUE_STORAGE_KEY = 'qkeer:rw-diagnostic-upload-queue';
const SESSION_STORAGE_KEY = 'qkeer:rw-diagnostic-session-id';
const MAX_QUEUE_COUNT = 160;
const BATCH_SIZE = 40;
const FLUSH_DELAY_MS = 12000;
const BUSINESS_UPLOAD_ACTIVE_RETRY_MS = 5000;
const QUEUE_PERSIST_DELAY_MS = 10000;
const REQUEST_TIMEOUT_MS = 3000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let queuePersistTimer: ReturnType<typeof setTimeout> | null = null;
let queuePersistInFlight = false;
let queuePersistPending = false;
let flushing = false;
let pendingFlush = false;
let queueCache: RwDiagnosticUploadEntry[] | null = null;
let diagnosticSessionIdCache = '';
let businessUploadActiveDepth = 0;

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);

const getRwDiagnosticLogsUrl = () => {
  const baseUrl = getApiBase();
  if (/^https:\/\/sh\.qkeering\.com$/i.test(baseUrl)) {
    return getFullUrl('/api/app/rw-debug/logs');
  }
  return getFullUrl('/app/rw-debug/logs');
};

const readQueue = (): RwDiagnosticUploadEntry[] => {
  if (isNodeRuntime()) return [];
  if (queueCache) return queueCache;
  try {
    const raw = uni.getStorageSync?.(QUEUE_STORAGE_KEY);
    queueCache = Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object').slice(-MAX_QUEUE_COUNT) : [];
  } catch {
    queueCache = [];
  }
  return queueCache;
};

const persistQueueNow = () => {
  if (isNodeRuntime() || !queueCache) return;
  if (queuePersistInFlight) {
    queuePersistPending = true;
    return;
  }
  const snapshot = queueCache.slice(-MAX_QUEUE_COUNT);
  queuePersistInFlight = true;
  try {
    uni.setStorage?.({
      key: QUEUE_STORAGE_KEY,
      data: snapshot,
      complete: () => {
        queuePersistInFlight = false;
        if (queuePersistPending) {
          queuePersistPending = false;
          persistQueueNow();
        }
      }
    });
  } catch {
    queuePersistInFlight = false;
    // Upload queue must never affect diagnostics.
  }
};

const writeQueue = (queue: RwDiagnosticUploadEntry[], immediate = true) => {
  if (isNodeRuntime()) return;
  queueCache = queue.slice(-MAX_QUEUE_COUNT);
  if (immediate) {
    persistQueueNow();
  } else if (!queuePersistTimer) {
    queuePersistTimer = setTimeout(() => {
      queuePersistTimer = null;
      persistQueueNow();
    }, QUEUE_PERSIST_DELAY_MS);
  }
};

export const getRwDiagnosticUploadSessionId = () => {
  if (isNodeRuntime()) return '';
  if (diagnosticSessionIdCache) return diagnosticSessionIdCache;
  try {
    const existing = uni.getStorageSync?.(SESSION_STORAGE_KEY);
    if (existing) {
      diagnosticSessionIdCache = String(existing);
      return diagnosticSessionIdCache;
    }
    const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    diagnosticSessionIdCache = created;
    uni.setStorageSync?.(SESSION_STORAGE_KEY, created);
    return diagnosticSessionIdCache;
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
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
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
    details?.deviceMac ||
    details?.mac ||
    details?.snapshot?.deviceId ||
    details?.snapshot?.deviceMac ||
    details?.snapshot?.currentDevice?.deviceId ||
    details?.snapshot?.storeDevice?.deviceId ||
    details?.snapshot?.userDevice?.deviceId
  );
};

const pickUserId = (entry: RwDiagnosticUploadEntry) => {
  if (typeof entry.userId === 'number' && Number.isFinite(entry.userId)) return entry.userId;
  const details = parseDetails(entry.details);
  const value = Number(details?.userId ?? details?.snapshot?.userId ?? details?.snapshot?.userInfo?.id);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const normalizeUploadEntry = (entry: RwDiagnosticUploadEntry): RwDiagnosticUploadEntry => {
  const id = typeof entry.id === 'number' ? entry.id : Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const sessionId = entry.sessionId || getRwDiagnosticUploadSessionId();
  return {
    id,
    // A retry sends the same eventId, allowing the server to make ingestion
    // idempotent even when the request succeeded but its response was lost.
    eventId: entry.eventId || `${sessionId || 'anonymous'}:${id}`,
    time: entry.time ? String(entry.time) : undefined,
    source: String(entry.source || 'RW').slice(0, 64),
    event: String(entry.event || 'log').slice(0, 128),
    details: entry.details ?? '',
    buildTag: pickBuildTag(entry),
    deviceId: pickDeviceId(entry),
    userId: pickUserId(entry),
    sessionId,
    noisy: entry.noisy === true
  };
};

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
  if (businessUploadActiveDepth > 0) {
    pendingFlush = true;
    scheduleRwDiagnosticUploadFlush(BUSINESS_UPLOAD_ACTIVE_RETRY_MS);
    return;
  }
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
    queue.splice(0, batch.length);
    persistQueueNow();
    if (queue.length > 0) {
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

export const scheduleRwDiagnosticUploadFlush = (delayMs = FLUSH_DELAY_MS) => {
  if (isNodeRuntime()) return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushRwDiagnosticUploadQueue();
  }, delayMs);
};

export const setRwDiagnosticBusinessUploadActive = (active: boolean) => {
  businessUploadActiveDepth = active ? businessUploadActiveDepth + 1 : Math.max(0, businessUploadActiveDepth - 1);
  if (businessUploadActiveDepth === 0 && (pendingFlush || readQueue().length > 0)) {
    pendingFlush = false;
    scheduleRwDiagnosticUploadFlush();
  }
};

/**
 * 淘汰到上限以内。先按「最旧的噪声事件」淘汰，只有噪声不够淘汰时才动最旧的普通事件——
 * 否则一次搜到几百个设备的扫描会瞬间灌满队列，把同一时刻的 `scan-start` 之类的
 * 稀疏关键埋点冲掉，排查时会误判成「那段代码根本没执行」。
 */
const trimQueue = (queue: RwDiagnosticUploadEntry[]) => {
  let overflow = queue.length - MAX_QUEUE_COUNT;
  if (overflow <= 0) return queue;

  for (let index = 0; index < queue.length && overflow > 0;) {
    if (queue[index]?.noisy === true) {
      queue.splice(index, 1);
      overflow -= 1;
      continue;
    }
    index += 1;
  }

  if (overflow > 0) queue.splice(0, overflow);
  return queue;
};

export const enqueueRwDiagnosticUpload = (entry: RwDiagnosticUploadEntry) => {
  if (isNodeRuntime()) return;
  const queue = readQueue();
  queue.push(normalizeUploadEntry(entry));
  trimQueue(queue);
  writeQueue(queue, false);
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
