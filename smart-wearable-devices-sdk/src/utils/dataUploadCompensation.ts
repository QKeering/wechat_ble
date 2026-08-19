import type { RingRawHistoryFrame } from '@/api/ringDevice';
import { getBoundRingIdentity } from '@/utils/ringBinding';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

export type UploadDataStatus = 'pending' | 'done' | 'partial' | 'failed' | 'empty';
export type UploadRawLocalStatus = 'done' | 'none' | 'failed';
export type UploadRawServerStatus = 'pending' | 'queued' | 'done' | 'failed' | 'none';
export type UploadCoverageStatus = 'complete' | 'partial' | 'missing';

export interface PendingUploadSession<T = Record<string, any>> {
  uploadSessionId: string;
  userId?: string | number;
  dataUserId?: string | number;
  bindingId?: string | number;
  bindingVersion?: string;
  deviceMac: string;
  deviceMacNorm: string;
  protocol?: string;
  dataList: T[];
  rawFrames: RingRawHistoryFrame[];
  dataListCount?: number;
  dataPersisted?: boolean;
  rawFrameCount?: number;
  rawFrameHashes?: string[];
  deviceBlockRefs?: unknown[];
  status: 'pending' | 'data_done' | 'raw_queued' | 'raw_done' | 'done' | 'data_failed' | 'raw_failed';
  dataStatus: UploadDataStatus;
  rawLocalStatus: UploadRawLocalStatus;
  rawStatus: UploadRawServerStatus;
  canDeleteDeviceBlocks: boolean;
  deviceReadDone: boolean;
  historyCompleted: boolean;
  partialUpload: boolean;
  coverageStatus: UploadCoverageStatus;
  retryCount: number;
  nextDataRetryAt?: number;
  rawRetryCount: number;
  lastError?: string;
  dataResponse?: unknown;
  rawResponse?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface BackendUploadBindingSnapshot {
  ok: boolean;
  reasonCode?: string;
  reason?: string;
  device?: Record<string, any> | null;
  bindingId?: string | number;
  bindingVersion?: string;
  dataUserId?: string | number;
  deviceMac?: string;
  protocol?: string;
  response?: unknown;
}

const PENDING_UPLOAD_QUEUE_STORAGE_KEY = 'qkeer:pending_upload_queue:v1';
const PENDING_UPLOAD_QUEUE_MAX_COUNT = 80;
const PENDING_UPLOAD_QUEUE_STORAGE_MAX_COUNT = 40;
const PENDING_UPLOAD_QUEUE_RAW_HASH_MAX_COUNT = 20;
const PENDING_UPLOAD_PAYLOAD_PREFIX = 'qkeer:pending_upload_payload:v1';
const PENDING_UPLOAD_PAYLOAD_CHUNK_SIZE = 40;
const BACKEND_UPLOAD_BINDING_TIMEOUT_MS = 8000;
const PENDING_UPLOAD_RETRY_BASE_DELAY_MS = 5 * 1000;
const PENDING_UPLOAD_RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

const getPendingUploadRetryDelayMs = (retryCount: number) => {
  const exponent = Math.max(0, Math.min(6, Math.floor(retryCount) - 1));
  return Math.min(PENDING_UPLOAD_RETRY_MAX_DELAY_MS, PENDING_UPLOAD_RETRY_BASE_DELAY_MS * 2 ** exponent);
};

interface PendingUploadPayloadManifest {
  version: 1;
  chunkCount: number;
  dataListCount: number;
  updatedAt: number;
}

const payloadManifestKey = (uploadSessionId: string) => `${PENDING_UPLOAD_PAYLOAD_PREFIX}:${uploadSessionId}:manifest`;
const payloadChunkKey = (uploadSessionId: string, index: number) =>
  `${PENDING_UPLOAD_PAYLOAD_PREFIX}:${uploadSessionId}:chunk:${index}`;

const readPersistedDataList = <T = Record<string, any>>(uploadSessionId: string): T[] => {
  try {
    const manifest = uni.getStorageSync(payloadManifestKey(uploadSessionId)) as PendingUploadPayloadManifest | undefined;
    if (!manifest || manifest.version !== 1 || !Number.isFinite(manifest.chunkCount)) return [];
    const result: T[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunk = uni.getStorageSync(payloadChunkKey(uploadSessionId, index));
      if (Array.isArray(chunk)) result.push(...chunk);
    }
    return result.slice(0, Math.max(0, Number(manifest.dataListCount || result.length)));
  } catch {
    return [];
  }
};

const removePersistedDataList = (uploadSessionId: string) => {
  try {
    const manifest = uni.getStorageSync(payloadManifestKey(uploadSessionId)) as PendingUploadPayloadManifest | undefined;
    const chunkCount = Math.max(0, Number(manifest?.chunkCount || 0));
    for (let index = 0; index < chunkCount; index += 1) {
      uni.removeStorageSync(payloadChunkKey(uploadSessionId, index));
    }
    uni.removeStorageSync(payloadManifestKey(uploadSessionId));
  } catch {
    // Compensation cleanup must not interrupt the live upload path.
  }
};

const persistDataList = <T = Record<string, any>>(uploadSessionId: string, dataList: T[]) => {
  const startedAt = Date.now();
  if (!dataList.length) {
    removePersistedDataList(uploadSessionId);
    return true;
  }
  try {
    const previous = uni.getStorageSync(payloadManifestKey(uploadSessionId)) as PendingUploadPayloadManifest | undefined;
    const chunks: T[][] = [];
    for (let index = 0; index < dataList.length; index += PENDING_UPLOAD_PAYLOAD_CHUNK_SIZE) {
      chunks.push(dataList.slice(index, index + PENDING_UPLOAD_PAYLOAD_CHUNK_SIZE));
    }
    chunks.forEach((chunk, index) => uni.setStorageSync(payloadChunkKey(uploadSessionId, index), chunk));
    const manifest: PendingUploadPayloadManifest = {
      version: 1,
      chunkCount: chunks.length,
      dataListCount: dataList.length,
      updatedAt: Date.now()
    };
    uni.setStorageSync(payloadManifestKey(uploadSessionId), manifest);
    const previousCount = Math.max(0, Number(previous?.chunkCount || 0));
    for (let index = chunks.length; index < previousCount; index += 1) {
      uni.removeStorageSync(payloadChunkKey(uploadSessionId, index));
    }
    appendRingDiagnosticLog('UPLOAD', 'pending-payload-persist-sync-result', {
      uploadSessionId,
      dataListCount: dataList.length,
      chunkCount: chunks.length,
      elapsedMs: Date.now() - startedAt
    });
    return true;
  } catch (error) {
    appendRingDiagnosticLog('UPLOAD', 'pending-payload-persist-failed', {
      uploadSessionId,
      dataListCount: dataList.length,
      error: error instanceof Error ? error.message : String(error || '')
    });
    return false;
  }
};

const getStorageAsync = <T = unknown>(key: string): Promise<T | undefined> =>
  new Promise((resolve) => {
    (uni as any).getStorage({
      key,
      success: (result: { data?: T }) => resolve(result?.data),
      fail: () => resolve(undefined)
    });
  });

const setStorageAsync = (key: string, data: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    (uni as any).setStorage({
      key,
      data,
      success: () => resolve(),
      fail: (error: unknown) => reject(error)
    });
  });

const removeStorageAsync = (key: string): Promise<void> =>
  new Promise((resolve) => {
    (uni as any).removeStorage({
      key,
      success: () => resolve(),
      fail: () => resolve()
    });
  });

const persistDataListAsync = async <T = Record<string, any>>(
  uploadSessionId: string,
  dataList: T[],
  version: number
) => {
  const startedAt = Date.now();
  const previous = await getStorageAsync<PendingUploadPayloadManifest>(payloadManifestKey(uploadSessionId));
  const previousCount = Math.max(0, Number(previous?.chunkCount || 0));
  if (!dataList.length) {
    // Remove the manifest first so stale chunks are no longer readable. Chunk
    // cleanup is best-effort and must not hold the upload/UI completion edge.
    await removeStorageAsync(payloadManifestKey(uploadSessionId));
    if (previousCount > 0) {
      setTimeout(() => {
        void Promise.all(
          Array.from({ length: previousCount }, (_, index) =>
            removeStorageAsync(payloadChunkKey(uploadSessionId, index))
          )
        );
      }, 0);
    }
    appendRingDiagnosticLog('UPLOAD', 'pending-payload-persist-async-result', {
      uploadSessionId,
      version,
      dataListCount: 0,
      chunkCount: 0,
      previousChunkCount: previousCount,
      elapsedMs: Date.now() - startedAt
    });
    return;
  }

  const chunks: T[][] = [];
  for (let index = 0; index < dataList.length; index += PENDING_UPLOAD_PAYLOAD_CHUNK_SIZE) {
    chunks.push(dataList.slice(index, index + PENDING_UPLOAD_PAYLOAD_CHUNK_SIZE));
  }
  const chunkTimings: number[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkStartedAt = Date.now();
    await setStorageAsync(payloadChunkKey(uploadSessionId, index), chunks[index]);
    chunkTimings.push(Date.now() - chunkStartedAt);
  }
  const manifest: PendingUploadPayloadManifest = {
    version: 1,
    chunkCount: chunks.length,
    dataListCount: dataList.length,
    updatedAt: Date.now()
  };
  await setStorageAsync(payloadManifestKey(uploadSessionId), manifest);
  for (let index = chunks.length; index < previousCount; index += 1) {
    await removeStorageAsync(payloadChunkKey(uploadSessionId, index));
  }
  appendRingDiagnosticLog('UPLOAD', 'pending-payload-persist-async-result', {
    uploadSessionId,
    version,
    dataListCount: dataList.length,
    chunkCount: chunks.length,
    previousChunkCount: previousCount,
    chunkTimings,
    maxChunkMs: chunkTimings.length > 0 ? Math.max(...chunkTimings) : 0,
    elapsedMs: Date.now() - startedAt
  });
};

export const normalizeUploadDeviceMac = (value: unknown) => String(value || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

export const createUploadSessionId = (prefix = 'upload') => {
  const randomText = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${randomText}`;
};

const safeObject = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;

const unwrapResponsePayload = (response: unknown): unknown => {
  const root = safeObject(response);
  if (!root) return response;
  if (safeObject(root.data)) return root.data;
  if (safeObject(root.result)) return root.result;
  return response;
};

const pickDeviceObject = (payload: unknown): Record<string, any> | null => {
  const source = safeObject(unwrapResponsePayload(payload));
  if (!source) return null;
  const directIdentity = getBoundRingIdentity(source as any) || source.mac || source.deviceMac || source.macNorm;
  if (directIdentity) return source;
  for (const key of ['device', 'current', 'currentDevice', 'boundDevice']) {
    const nested = safeObject(source[key]);
    if (nested && (getBoundRingIdentity(nested as any) || nested.mac || nested.deviceMac || nested.macNorm)) return nested;
  }
  return null;
};

const withManualTimeout = <T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} ${timeoutMs}ms`));
    }, timeoutMs);

    task
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

export const isSameUploadDeviceMac = (left: unknown, right: unknown) => {
  const leftNorm = normalizeUploadDeviceMac(left);
  const rightNorm = normalizeUploadDeviceMac(right);
  if (!leftNorm || !rightNorm) return false;
  if (leftNorm === rightNorm) return true;
  return leftNorm.length >= 6 && rightNorm.length >= 6 && leftNorm.slice(-6) === rightNorm.slice(-6);
};

export const assertBackendUploadBinding = async (
  deviceMac: string,
  config: Record<string, any> = {}
): Promise<BackendUploadBindingSnapshot> => {
  const startedAt = Date.now();
  const requestedDeviceMacNorm = normalizeUploadDeviceMac(deviceMac);
  appendRingDiagnosticLog('UPLOAD', 'binding-check-start', {
    deviceMac,
    requestedDeviceMacNorm,
    endpoint: '/app/device/current',
    timeoutMs: BACKEND_UPLOAD_BINDING_TIMEOUT_MS
  });
  let response: unknown;
  try {
    const custom = safeObject(config.custom) || {};
    response = await withManualTimeout(
      (uni as any).$uv.http.get('/app/device/current', {
        ...config,
        timeout: BACKEND_UPLOAD_BINDING_TIMEOUT_MS,
        custom: { ...custom, toast: false, catch: true }
      }),
      BACKEND_UPLOAD_BINDING_TIMEOUT_MS,
      'backend upload binding request timeout'
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String((error as any)?.errMsg || error || 'request failed');
    const isTimeout = /timeout|time\s*out|超时/i.test(reason);
    const result = {
      ok: false,
      reasonCode: isTimeout ? 'CURRENT_BINDING_REQUEST_TIMEOUT' : 'CURRENT_BINDING_REQUEST_FAILED',
      reason
    };
    appendRingDiagnosticLog('UPLOAD', 'binding-check-failed', {
      deviceMac,
      requestedDeviceMacNorm,
      elapsedMs: Date.now() - startedAt,
      reasonCode: result.reasonCode,
      reason: result.reason
    });
    return result;
  }
  const device = pickDeviceObject(response);
  if (!device) {
    const result = { ok: false, reasonCode: 'NO_ACTIVE_BINDING', reason: 'backend has no active bound device', response };
    appendRingDiagnosticLog('UPLOAD', 'binding-check-result', {
      deviceMac,
      requestedDeviceMacNorm,
      elapsedMs: Date.now() - startedAt,
      ok: false,
      reasonCode: result.reasonCode,
      reason: result.reason
    });
    return result;
  }
  const backendDeviceMac =
    device.deviceMac ||
    device.mac ||
    device.macNorm ||
    device.normalMac ||
    getBoundRingIdentity(device as any) ||
    device.uniMacId ||
    device.deviceId;
  if (!isSameUploadDeviceMac(deviceMac, backendDeviceMac)) {
    const result = {
      ok: false,
      reasonCode: 'BOUND_DEVICE_MISMATCH',
      reason: 'frontend upload device does not match backend current binding',
      device,
      deviceMac: String(backendDeviceMac || ''),
      response
    };
    appendRingDiagnosticLog('UPLOAD', 'binding-check-result', {
      deviceMac,
      requestedDeviceMacNorm,
      backendDeviceMac: String(backendDeviceMac || ''),
      backendDeviceMacNorm: normalizeUploadDeviceMac(backendDeviceMac),
      elapsedMs: Date.now() - startedAt,
      ok: false,
      reasonCode: result.reasonCode,
      reason: result.reason
    });
    return result;
  }
  const result = {
    ok: true,
    device,
    bindingId: device.bindingId || device.id || device.deviceId,
    bindingVersion: device.bindingVersion || device.updateTime || device.createTime,
    dataUserId: device.dataUserId || device.userId || device.ownerUserId,
    deviceMac: String(backendDeviceMac || deviceMac),
    protocol: device.protocol,
    response
  };
  appendRingDiagnosticLog('UPLOAD', 'binding-check-result', {
    deviceMac,
    requestedDeviceMacNorm,
    backendDeviceMac: String(backendDeviceMac || ''),
    backendDeviceMacNorm: normalizeUploadDeviceMac(backendDeviceMac),
    elapsedMs: Date.now() - startedAt,
    ok: true,
    bindingId: result.bindingId,
    bindingVersion: result.bindingVersion,
    dataUserId: result.dataUserId,
    protocol: result.protocol
  });
  return result;
};

const readQueue = <T = Record<string, any>>(): PendingUploadSession<T>[] => {
  try {
    const stored = uni.getStorageSync(PENDING_UPLOAD_QUEUE_STORAGE_KEY);
    const list = Array.isArray(stored) ? stored : Array.isArray((stored as any)?.sessions) ? (stored as any).sessions : [];
    return list
      .filter((item: any) => item && item.uploadSessionId && item.deviceMac)
      .map((item: PendingUploadSession<T>) => ({
        ...item,
        dataList:
          item.dataStatus === 'done' || item.dataStatus === 'empty'
            ? []
            : readPersistedDataList<T>(item.uploadSessionId),
        rawFrames: Array.isArray(item.rawFrames) ? item.rawFrames : []
      }));
  } catch {
    return [];
  }
};

const summarizeResponseForStorage = (response: unknown) => {
  const payload = unwrapResponsePayload(response);
  const source = safeObject(payload);
  if (!source) return response == null ? undefined : String(response).slice(0, 300);
  return {
    code: source.code,
    msg: source.msg,
    dataStatus: source.dataStatus,
    rawStatus: source.rawStatus,
    canDeleteDeviceBlocks: source.canDeleteDeviceBlocks,
    uploadSessionId: source.uploadSessionId
  };
};

const buildStorageSession = (session: PendingUploadSession): PendingUploadSession => {
  const rawFrames = Array.isArray(session.rawFrames) ? session.rawFrames : [];
  const dataList = Array.isArray(session.dataList) ? session.dataList : [];
  return {
    ...session,
    dataList: [],
    rawFrames: [],
    deviceBlockRefs: undefined,
    dataListCount: session.dataListCount ?? dataList.length,
    rawFrameCount: session.rawFrameCount ?? rawFrames.length,
    rawFrameHashes: rawFrames
      .map((frame) => frame?.rawHash)
      .filter((hash): hash is string => Boolean(hash))
      .slice(-PENDING_UPLOAD_QUEUE_RAW_HASH_MAX_COUNT),
    dataResponse: summarizeResponseForStorage(session.dataResponse),
    rawResponse: summarizeResponseForStorage(session.rawResponse),
    lastError: session.lastError ? String(session.lastError).slice(0, 500) : undefined
  };
};

const writeQueue = (queue: PendingUploadSession[]) => {
  const nextQueue = queue
    .filter((item) => item && item.uploadSessionId && item.deviceMac)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, PENDING_UPLOAD_QUEUE_MAX_COUNT);
  const storageQueue = nextQueue.slice(0, PENDING_UPLOAD_QUEUE_STORAGE_MAX_COUNT).map(buildStorageSession);
  try {
    uni.setStorageSync(PENDING_UPLOAD_QUEUE_STORAGE_KEY, storageQueue);
  } catch {
    try {
      uni.setStorageSync(PENDING_UPLOAD_QUEUE_STORAGE_KEY, storageQueue.slice(0, 10).map((session) => ({
        uploadSessionId: session.uploadSessionId,
        deviceMac: session.deviceMac,
        deviceMacNorm: session.deviceMacNorm,
        protocol: session.protocol,
        bindingId: session.bindingId,
        bindingVersion: session.bindingVersion,
        dataUserId: session.dataUserId,
        status: session.status,
        dataStatus: session.dataStatus,
        rawLocalStatus: session.rawLocalStatus,
        rawStatus: session.rawStatus,
        canDeleteDeviceBlocks: session.canDeleteDeviceBlocks,
        retryCount: session.retryCount,
        rawRetryCount: session.rawRetryCount,
        dataList: [],
        rawFrames: [],
        dataListCount: session.dataListCount,
        rawFrameCount: session.rawFrameCount,
        lastError: session.lastError,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      })));
    } catch {
      // Pending queue is diagnostic/compensation state. Never let local storage quota break the live upload path.
    }
  }
  return nextQueue;
};

interface DeferredPendingUploadPersistenceResult {
  ok: boolean;
  version: number;
  elapsedMs: number;
  error?: string;
}

interface DeferredPendingUploadPersistenceWaiter {
  version: number;
  resolve: (result: DeferredPendingUploadPersistenceResult) => void;
}

interface DeferredPendingUploadPersistenceState {
  requestedVersion: number;
  completedVersion: number;
  running: boolean;
  snapshot: PendingUploadSession<any>;
  waiters: DeferredPendingUploadPersistenceWaiter[];
}

const deferredPendingUploadPersistence = new Map<string, DeferredPendingUploadPersistenceState>();
let pendingUploadQueueAsyncWriteChain: Promise<void> = Promise.resolve();

const clonePendingUploadSession = <T = Record<string, any>>(
  session: PendingUploadSession<T>
): PendingUploadSession<T> => ({
  ...session,
  dataList: Array.isArray(session.dataList) ? session.dataList.slice() : [],
  rawFrames: Array.isArray(session.rawFrames) ? session.rawFrames.slice() : []
});

const persistStorageSessionAsync = (
  session: PendingUploadSession,
  version: number
): Promise<void> => {
  const task = pendingUploadQueueAsyncWriteChain
    .catch(() => undefined)
    .then(async () => {
      const startedAt = Date.now();
      const stored = await getStorageAsync<any>(PENDING_UPLOAD_QUEUE_STORAGE_KEY);
      const list = (Array.isArray(stored) ? stored : Array.isArray(stored?.sessions) ? stored.sessions : [])
        .filter((item: any) => item && item.uploadSessionId && item.deviceMac);
      const next = [
        buildStorageSession(session),
        ...list.filter((item: PendingUploadSession) => item.uploadSessionId !== session.uploadSessionId)
      ]
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
        .slice(0, PENDING_UPLOAD_QUEUE_STORAGE_MAX_COUNT);
      await setStorageAsync(PENDING_UPLOAD_QUEUE_STORAGE_KEY, next);
      appendRingDiagnosticLog('UPLOAD', 'pending-queue-persist-async-result', {
        uploadSessionId: session.uploadSessionId,
        version,
        queueCount: next.length,
        elapsedMs: Date.now() - startedAt
      });
    });
  pendingUploadQueueAsyncWriteChain = task.catch((error) => {
    appendRingDiagnosticLog('UPLOAD', 'pending-queue-persist-async-failed', {
      uploadSessionId: session.uploadSessionId,
      version,
      error: error instanceof Error ? error.message : String(error || '')
    });
  });
  return task;
};

const flushDeferredPendingUploadPersistence = async (uploadSessionId: string) => {
  const state = deferredPendingUploadPersistence.get(uploadSessionId);
  if (!state || state.running) return;
  state.running = true;
  try {
    while (state.completedVersion < state.requestedVersion) {
      const version = state.requestedVersion;
      const snapshot = clonePendingUploadSession(state.snapshot);
      const startedAt = Date.now();
      let result: DeferredPendingUploadPersistenceResult;
      try {
        await persistDataListAsync(uploadSessionId, snapshot.dataList, version);
        await persistStorageSessionAsync(snapshot, version);
        result = { ok: true, version, elapsedMs: Date.now() - startedAt };
        appendRingDiagnosticLog('UPLOAD', 'pending-upload-ack-persist-result', {
          uploadSessionId,
          version,
          dataListCount: snapshot.dataList.length,
          elapsedMs: result.elapsedMs
        });
      } catch (error) {
        result = {
          ok: false,
          version,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error || '')
        };
        appendRingDiagnosticLog('UPLOAD', 'pending-upload-ack-persist-failed', {
          uploadSessionId,
          version,
          dataListCount: snapshot.dataList.length,
          elapsedMs: result.elapsedMs,
          error: result.error
        });
      }
      state.completedVersion = version;
      const resolved = state.waiters.filter((waiter) => waiter.version <= version);
      state.waiters = state.waiters.filter((waiter) => waiter.version > version);
      resolved.forEach((waiter) => waiter.resolve(result));
    }
  } finally {
    state.running = false;
    if (state.completedVersion >= state.requestedVersion && state.waiters.length === 0) {
      deferredPendingUploadPersistence.delete(uploadSessionId);
    } else {
      setTimeout(() => void flushDeferredPendingUploadPersistence(uploadSessionId), 0);
    }
  }
};

const schedulePendingUploadSessionPersistence = <T = Record<string, any>>(
  session: PendingUploadSession<T>,
  reason: string
): Promise<DeferredPendingUploadPersistenceResult> => {
  const existing = deferredPendingUploadPersistence.get(session.uploadSessionId);
  const state: DeferredPendingUploadPersistenceState = existing || {
    requestedVersion: 0,
    completedVersion: 0,
    running: false,
    snapshot: clonePendingUploadSession(session),
    waiters: []
  };
  state.requestedVersion += 1;
  state.snapshot = clonePendingUploadSession(session);
  deferredPendingUploadPersistence.set(session.uploadSessionId, state);
  const version = state.requestedVersion;
  appendRingDiagnosticLog('UPLOAD', 'pending-upload-ack-persist-scheduled', {
    uploadSessionId: session.uploadSessionId,
    version,
    reason,
    dataListCount: session.dataList.length,
    coalesced: state.running || state.waiters.length > 0
  });
  const task = new Promise<DeferredPendingUploadPersistenceResult>((resolve) => {
    state.waiters.push({ version, resolve });
  });
  if (!state.running) {
    setTimeout(() => void flushDeferredPendingUploadPersistence(session.uploadSessionId), 0);
  }
  return task;
};

const dedupeRawFrames = (frames: RingRawHistoryFrame[] = []) => {
  const keyed = new Map<string, RingRawHistoryFrame>();
  frames.forEach((frame) => {
    if (!frame || typeof frame !== 'object') return;
    const key = frame.rawHash || `${frame.protocol || ''}|${frame.sourceType || ''}|${frame.rawHex || ''}`;
    if (!key.trim()) return;
    keyed.set(key, frame);
  });
  return Array.from(keyed.values());
};

export const stagePendingUploadSession = <T = Record<string, any>>(
  input: Partial<PendingUploadSession<T>> & {
    deviceMac: string;
    dataList?: T[];
    rawFrames?: RingRawHistoryFrame[];
  }
): PendingUploadSession<T> => {
  const now = Date.now();
  const uploadSessionId = input.uploadSessionId || createUploadSessionId(input.protocol || 'upload');
  const queue = readQueue<T>();
  const existing = queue.find((item) => item.uploadSessionId === uploadSessionId) as PendingUploadSession<T> | undefined;
  const rawFrames = dedupeRawFrames([...(existing?.rawFrames || []), ...(input.rawFrames || [])]);
  const dataList = Array.isArray(input.dataList)
    ? input.dataList
    : Array.isArray(existing?.dataList)
      ? existing.dataList
      : [];
  const rawLocalStatus: UploadRawLocalStatus = rawFrames.length > 0 ? 'done' : 'none';
  const deviceReadDone = input.deviceReadDone ?? existing?.deviceReadDone ?? true;
  const historyCompleted = input.historyCompleted ?? existing?.historyCompleted ?? deviceReadDone;
  const coverageStatus = (input.coverageStatus || existing?.coverageStatus || (historyCompleted ? 'complete' : 'partial')) as UploadCoverageStatus;
  const partialUpload = input.partialUpload ?? existing?.partialUpload ?? (!deviceReadDone || !historyCompleted || coverageStatus !== 'complete');
  const dataPersisted = dataList.length > 0 ? persistDataList(uploadSessionId, dataList) : true;
  const next: PendingUploadSession<T> = {
    uploadSessionId,
    userId: input.userId ?? existing?.userId,
    dataUserId: input.dataUserId ?? existing?.dataUserId,
    bindingId: input.bindingId ?? existing?.bindingId,
    bindingVersion: input.bindingVersion || existing?.bindingVersion,
    deviceMac: input.deviceMac,
    deviceMacNorm: normalizeUploadDeviceMac(input.deviceMac),
    protocol: input.protocol || existing?.protocol,
    dataList,
    dataPersisted,
    rawFrames,
    deviceBlockRefs: input.deviceBlockRefs || existing?.deviceBlockRefs,
    status: existing?.status || 'pending',
    dataStatus: dataList.length > 0 ? existing?.dataStatus || 'pending' : 'empty',
    rawLocalStatus,
    rawStatus: rawFrames.length > 0 ? existing?.rawStatus || 'pending' : 'none',
    canDeleteDeviceBlocks: Boolean(input.canDeleteDeviceBlocks ?? existing?.canDeleteDeviceBlocks) && !partialUpload,
    deviceReadDone,
    historyCompleted,
    partialUpload,
    coverageStatus,
    retryCount: Number(existing?.retryCount || 0),
    nextDataRetryAt: Number(existing?.nextDataRetryAt || 0) || undefined,
    rawRetryCount: Number(existing?.rawRetryCount || 0),
    lastError: input.lastError || existing?.lastError,
    dataResponse: existing?.dataResponse,
    rawResponse: existing?.rawResponse,
    createdAt: Number(existing?.createdAt || now),
    updatedAt: now
  };
  const nextQueue = [next, ...queue.filter((item) => item.uploadSessionId !== uploadSessionId)];
  writeQueue(nextQueue as PendingUploadSession[]);
  return next;
};

export const updatePendingUploadSession = (
  uploadSessionId: string,
  updater: (session: PendingUploadSession) => PendingUploadSession
) => {
  const queue = readQueue();
  const index = queue.findIndex((item) => item.uploadSessionId === uploadSessionId);
  if (index < 0) return null;
  const next = updater({ ...queue[index], updatedAt: Date.now() });
  queue[index] = next;
  writeQueue(queue);
  return next;
};

export const markPendingUploadDataDone = (uploadSessionId: string, response?: unknown) => {
  const updated = updatePendingUploadSession(uploadSessionId, (session) => {
    const payload = unwrapResponsePayload(response) as Record<string, any> | null;
    const nextDataStatus = ['done', 'partial', 'failed', 'empty'].includes(String(payload?.dataStatus))
      ? (String(payload?.dataStatus) as UploadDataStatus)
      : 'done';
    const canDeleteDeviceBlocks = Boolean(payload?.canDeleteDeviceBlocks);

    return {
      ...session,
      status:
        nextDataStatus === 'failed'
          ? 'data_failed'
          : nextDataStatus === 'done' && (session.rawStatus === 'done' || session.rawStatus === 'none')
            ? 'done'
            : 'data_done',
      dataStatus: nextDataStatus,
      dataResponse: response,
      nextDataRetryAt: nextDataStatus === 'failed' ? session.nextDataRetryAt : undefined,
      lastError: nextDataStatus === 'failed' ? session.lastError : undefined,
      canDeleteDeviceBlocks
    };
  });
  if (updated && (updated.dataStatus === 'done' || updated.dataStatus === 'empty')) {
    removePersistedDataList(uploadSessionId);
  }
  return updated;
};

export const listPendingUploadSessions = <T = Record<string, any>>(options: { includeDeferred?: boolean } = {}) => {
  const now = Date.now();
  return readQueue<T>().filter(
    (session) =>
      session.dataPersisted !== false &&
      Array.isArray(session.dataList) &&
      session.dataList.length > 0 &&
      (session.dataStatus === 'pending' || session.dataStatus === 'failed') &&
      (options.includeDeferred === true || Number(session.nextDataRetryAt || 0) <= now)
  );
};

export const markPendingUploadDataFailed = (uploadSessionId: string, error: unknown) =>
  updatePendingUploadSession(uploadSessionId, (session) => {
    const retryCount = Number(session.retryCount || 0) + 1;
    return {
      ...session,
      status: 'data_failed',
      dataStatus: 'failed',
      retryCount,
      nextDataRetryAt: Date.now() + getPendingUploadRetryDelayMs(retryCount),
      lastError: error instanceof Error ? error.message : String((error as any)?.errMsg || error || 'data upload failed'),
      canDeleteDeviceBlocks: false
    };
  });

export const acknowledgePendingUploadBatch = <T = Record<string, any>>(
  uploadSessionId: string,
  acceptedCount: number,
  response?: unknown
) => {
  const queue = readQueue<T>();
  const index = queue.findIndex((item) => item.uploadSessionId === uploadSessionId);
  if (index < 0) return null;
  const session = queue[index];
  const count = Math.max(0, Math.min(session.dataList.length, Math.floor(acceptedCount)));
  if (count <= 0) return session;
  const remaining = session.dataList.slice(count);
  const dataPersisted = persistDataList(uploadSessionId, remaining);
  const dataDone = remaining.length === 0;
  const next: PendingUploadSession<T> = {
    ...session,
    dataList: remaining,
    dataListCount: remaining.length,
    dataPersisted,
    dataStatus: dataDone ? 'done' : 'pending',
    nextDataRetryAt: undefined,
    status: dataDone
      ? session.rawStatus === 'done' || session.rawStatus === 'none'
        ? 'done'
        : 'data_done'
      : 'pending',
    dataResponse: response,
    lastError: undefined,
    updatedAt: Date.now()
  };
  queue[index] = next;
  writeQueue(queue as PendingUploadSession[]);
  return next;
};

/**
 * Advances the live upload cursor in memory and defers the durable snapshot.
 *
 * The original staged payload remains on disk until the asynchronous writer
 * succeeds. If the app exits before then, the deterministic batch id allows
 * the old snapshot to be replayed safely without losing records.
 */
export const acknowledgePendingUploadBatchDeferred = <T = Record<string, any>>(
  session: PendingUploadSession<T>,
  acceptedCount: number,
  response?: unknown
) => {
  const startedAt = Date.now();
  const count = Math.max(0, Math.min(session.dataList.length, Math.floor(acceptedCount)));
  if (count <= 0) {
    return {
      session,
      persistence: Promise.resolve<DeferredPendingUploadPersistenceResult>({
        ok: true,
        version: 0,
        elapsedMs: 0
      })
    };
  }
  const remaining = session.dataList.slice(count);
  const dataDone = remaining.length === 0;
  Object.assign(session, {
    dataList: remaining,
    dataListCount: remaining.length,
    dataPersisted: true,
    dataStatus: dataDone ? 'done' : 'pending',
    nextDataRetryAt: undefined,
    status: dataDone
      ? session.rawStatus === 'done' || session.rawStatus === 'none'
        ? 'done'
        : 'data_done'
      : 'pending',
    dataResponse: response,
    lastError: undefined,
    updatedAt: Date.now()
  } satisfies Partial<PendingUploadSession<T>>);
  appendRingDiagnosticLog('UPLOAD', 'pending-upload-ack-memory-result', {
    uploadSessionId: session.uploadSessionId,
    acceptedCount: count,
    remainingRecordCount: remaining.length,
    elapsedMs: Date.now() - startedAt
  });
  // Do not rewrite the complete remaining payload after every HTTP batch.
  // The original durable snapshot can be replayed safely because batch ids are
  // deterministic and backend ingestion is idempotent. Persist once at the
  // pause/failure/final completion edge instead.
  return {
    session,
    persistence: Promise.resolve<DeferredPendingUploadPersistenceResult>({
      ok: true,
      version: 0,
      elapsedMs: Date.now() - startedAt
    })
  };
};

export const persistPendingUploadSessionDeferred = <T = Record<string, any>>(
  session: PendingUploadSession<T>,
  reason = 'explicit-checkpoint'
) => schedulePendingUploadSessionPersistence(session, reason);

export const markPendingUploadDataFailedDeferred = <T = Record<string, any>>(
  session: PendingUploadSession<T>,
  error: unknown
) => {
  const retryCount = Number(session.retryCount || 0) + 1;
  Object.assign(session, {
    status: 'data_failed',
    dataStatus: 'failed',
    retryCount,
    nextDataRetryAt: Date.now() + getPendingUploadRetryDelayMs(retryCount),
    lastError: error instanceof Error ? error.message : String((error as any)?.errMsg || error || 'data upload failed'),
    canDeleteDeviceBlocks: false,
    updatedAt: Date.now()
  } satisfies Partial<PendingUploadSession<T>>);
  return schedulePendingUploadSessionPersistence(session, 'data-failed');
};

export const markPendingUploadDataDoneDeferred = <T = Record<string, any>>(
  session: PendingUploadSession<T>,
  response?: unknown
) => {
  const payload = unwrapResponsePayload(response) as Record<string, any> | null;
  const nextDataStatus = ['done', 'partial', 'failed', 'empty'].includes(String(payload?.dataStatus))
    ? (String(payload?.dataStatus) as UploadDataStatus)
    : 'done';
  Object.assign(session, {
    status:
      nextDataStatus === 'failed'
        ? 'data_failed'
        : nextDataStatus === 'done' && (session.rawStatus === 'done' || session.rawStatus === 'none')
          ? 'done'
          : 'data_done',
    dataStatus: nextDataStatus,
    dataResponse: response,
    nextDataRetryAt: nextDataStatus === 'failed' ? session.nextDataRetryAt : undefined,
    lastError: nextDataStatus === 'failed' ? session.lastError : undefined,
    canDeleteDeviceBlocks: Boolean(payload?.canDeleteDeviceBlocks),
    updatedAt: Date.now()
  } satisfies Partial<PendingUploadSession<T>>);
  return schedulePendingUploadSessionPersistence(session, 'data-done');
};

export const markPendingUploadRawDone = (uploadSessionId: string, response?: unknown) =>
  updatePendingUploadSession(uploadSessionId, (session) => {
    const payload = unwrapResponsePayload(response) as Record<string, any> | null;
    const queued = Boolean(payload?.rawQueued) || String(payload?.rawStatus || '').toLowerCase() === 'queued';
    const nextRawStatus: UploadRawServerStatus = queued ? 'queued' : 'done';
    return {
      ...session,
      status:
        session.dataStatus === 'done' || session.dataStatus === 'empty'
          ? 'done'
          : queued
            ? 'raw_queued'
            : 'raw_done',
      rawStatus: nextRawStatus,
      rawResponse: response
    };
  });

export const markPendingUploadRawFailed = (uploadSessionId: string, error: unknown) =>
  updatePendingUploadSession(uploadSessionId, (session) => ({
    ...session,
    status: session.dataStatus === 'done' ? 'raw_failed' : session.status,
    rawStatus: 'failed',
    rawRetryCount: Number(session.rawRetryCount || 0) + 1,
    lastError: error instanceof Error ? error.message : String((error as any)?.errMsg || error || 'raw upload failed')
  }));

export const buildUploadSyncMeta = (session: PendingUploadSession) => {
  const deviceReadDone = session.deviceReadDone !== false;
  const historyCompleted = session.historyCompleted !== false && deviceReadDone;
  const coverageStatus = session.coverageStatus || (historyCompleted ? 'complete' : 'partial');
  const partialUpload = session.partialUpload === true || !deviceReadDone || !historyCompleted || coverageStatus !== 'complete';
  return {
    uploadSessionId: session.uploadSessionId,
    bindingId: session.bindingId,
    bindingVersion: session.bindingVersion,
    dataUserId: session.dataUserId,
    protocol: session.protocol,
    deviceReadDone,
    historyCompleted,
    partialUpload,
    coverageStatus,
    canDeleteDeviceBlocks: session.canDeleteDeviceBlocks && !partialUpload,
    rawLocalStatus: session.rawLocalStatus,
    rawFrameCount: session.rawFrames.length,
    ...(session.rawFrames.length > 0 ? { rawFrames: session.rawFrames } : {}),
    deviceBlockRefs: session.deviceBlockRefs,
    uploadStatus: {
      deviceReadDone,
      historyCompleted,
      partialUpload,
      coverageStatus,
      dataStatus: session.dataStatus,
      rawLocalStatus: session.rawLocalStatus,
      rawStatus: session.rawStatus
    }
  };
};

export const buildParsedUploadSyncMeta = (session: PendingUploadSession) => {
  const meta = { ...buildUploadSyncMeta(session) } as Record<string, unknown>;
  // 解析后的 /app/data/sync 只提交 dataList。
  // 原始帧由 rawHistory/enqueue 独立补偿入库，避免同一请求体重复携带 rawFrames 导致等待过长。
  delete meta.rawFrames;
  return meta;
};

const RAW_BACKGROUND_UPLOAD_DEDUP_MS = 10 * 60 * 1000;
const RAW_BACKGROUND_UPLOAD_RECENT_SUCCESS_MAX_COUNT = 500;
const rawUploadInflightByDevice = new Map<string, Promise<unknown>>();
const rawUploadInflightBySignature = new Map<string, Promise<unknown>>();
const rawUploadRecentSuccessAt = new Map<string, number>();

const buildRawUploadSignature = (session: PendingUploadSession) => {
  const rawKeys = session.rawFrames
    .map((frame) => {
      if (!frame || typeof frame !== 'object') return '';
      return frame.rawHash || `${frame.protocol || ''}|${frame.sourceType || ''}|${frame.rawHex || ''}`;
    })
    .filter(Boolean);
  const firstKey = rawKeys[0] || '';
  const lastKey = rawKeys[rawKeys.length - 1] || '';
  return `${session.deviceMacNorm || normalizeUploadDeviceMac(session.deviceMac)}|${session.protocol || ''}|${rawKeys.length}|${firstKey}|${lastKey}`;
};

const pruneRawUploadRecentSuccessAt = (now = Date.now()) => {
  for (const [signature, successAt] of rawUploadRecentSuccessAt) {
    if (now - successAt > RAW_BACKGROUND_UPLOAD_DEDUP_MS) {
      rawUploadRecentSuccessAt.delete(signature);
    }
  }
  if (rawUploadRecentSuccessAt.size <= RAW_BACKGROUND_UPLOAD_RECENT_SUCCESS_MAX_COUNT) return;
  const removeCount = rawUploadRecentSuccessAt.size - RAW_BACKGROUND_UPLOAD_RECENT_SUCCESS_MAX_COUNT;
  Array.from(rawUploadRecentSuccessAt.keys())
    .slice(0, removeCount)
    .forEach((signature) => rawUploadRecentSuccessAt.delete(signature));
};

export const uploadPendingRawFramesInBackground = (
  session: PendingUploadSession,
  uploader: (params: {
    uploadSessionId: string;
    deviceMac: string;
    bindingId?: string | number;
    bindingVersion?: string;
    protocol?: string;
    frames: RingRawHistoryFrame[];
  }) => Promise<unknown>
) => {
  if (!session.rawFrames.length || session.rawStatus === 'done' || session.rawStatus === 'queued') {
    return Promise.resolve(null);
  }
  const now = Date.now();
  pruneRawUploadRecentSuccessAt(now);
  const deviceKey = session.deviceMacNorm || normalizeUploadDeviceMac(session.deviceMac) || session.deviceMac;
  const signature = buildRawUploadSignature(session);
  const sameSignatureUploading = rawUploadInflightBySignature.get(signature);
  if (sameSignatureUploading) {
    return sameSignatureUploading
      .then((response) => {
        markPendingUploadRawDone(session.uploadSessionId, response);
        return response;
      })
      .catch((error) => {
        markPendingUploadRawFailed(session.uploadSessionId, error);
        throw error;
      });
  }
  const recentSuccessAt = rawUploadRecentSuccessAt.get(signature);
  if (recentSuccessAt && now - recentSuccessAt <= RAW_BACKGROUND_UPLOAD_DEDUP_MS) {
    const response = {
      rawQueued: true,
      rawStatus: 'queued',
      rawSkipped: true,
      reasonCode: 'DUPLICATE_RAW_BACKGROUND_UPLOAD',
      uploadSessionId: session.uploadSessionId,
      rawFrameCount: session.rawFrames.length
    };
    markPendingUploadRawDone(session.uploadSessionId, response);
    return Promise.resolve(response);
  }
  const runUpload = () =>
    uploader({
      uploadSessionId: session.uploadSessionId,
      deviceMac: session.deviceMac,
      bindingId: session.bindingId,
      bindingVersion: session.bindingVersion,
      protocol: session.protocol,
      frames: session.rawFrames
    })
      .then((response) => {
        const finishedAt = Date.now();
        rawUploadRecentSuccessAt.set(signature, finishedAt);
        pruneRawUploadRecentSuccessAt(finishedAt);
        markPendingUploadRawDone(session.uploadSessionId, response);
        return response;
      })
      .catch((error) => {
        rawUploadRecentSuccessAt.delete(signature);
        markPendingUploadRawFailed(session.uploadSessionId, error);
        throw error;
      });
  const previousDeviceUpload = rawUploadInflightByDevice.get(deviceKey);
  const scheduledUpload = (previousDeviceUpload ? previousDeviceUpload.catch(() => null).then(runUpload) : runUpload()).finally(() => {
    if (rawUploadInflightByDevice.get(deviceKey) === scheduledUpload) rawUploadInflightByDevice.delete(deviceKey);
    if (rawUploadInflightBySignature.get(signature) === scheduledUpload) rawUploadInflightBySignature.delete(signature);
  });
  rawUploadInflightByDevice.set(deviceKey, scheduledUpload);
  rawUploadInflightBySignature.set(signature, scheduledUpload);
  return scheduledUpload;
};
