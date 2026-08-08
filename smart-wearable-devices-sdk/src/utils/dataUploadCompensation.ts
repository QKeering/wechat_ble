import type { RingRawHistoryFrame } from '@/api/ringDevice';
import { getBoundRingIdentity } from '@/utils/ringBinding';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

export type UploadDataStatus = 'pending' | 'done' | 'partial' | 'failed' | 'empty';
export type UploadRawLocalStatus = 'done' | 'none' | 'failed';
export type UploadRawServerStatus = 'pending' | 'queued' | 'done' | 'failed' | 'none';

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
  rawFrameCount?: number;
  rawFrameHashes?: string[];
  deviceBlockRefs?: unknown[];
  status: 'pending' | 'data_done' | 'raw_queued' | 'raw_done' | 'done' | 'data_failed' | 'raw_failed';
  dataStatus: UploadDataStatus;
  rawLocalStatus: UploadRawLocalStatus;
  rawStatus: UploadRawServerStatus;
  canDeleteDeviceBlocks: boolean;
  retryCount: number;
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
const BACKEND_UPLOAD_BINDING_TIMEOUT_MS = 8000;

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
    return list.filter((item: any) => item && item.uploadSessionId && item.deviceMac);
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
    rawFrames,
    deviceBlockRefs: input.deviceBlockRefs || existing?.deviceBlockRefs,
    status: existing?.status || 'pending',
    dataStatus: dataList.length > 0 ? existing?.dataStatus || 'pending' : 'empty',
    rawLocalStatus,
    rawStatus: rawFrames.length > 0 ? existing?.rawStatus || 'pending' : 'none',
    canDeleteDeviceBlocks: Boolean(existing?.canDeleteDeviceBlocks),
    retryCount: Number(existing?.retryCount || 0),
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

export const markPendingUploadDataDone = (uploadSessionId: string, response?: unknown) =>
  updatePendingUploadSession(uploadSessionId, (session) => {
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
      lastError: nextDataStatus === 'failed' ? session.lastError : undefined,
      canDeleteDeviceBlocks
    };
  });

export const markPendingUploadDataFailed = (uploadSessionId: string, error: unknown) =>
  updatePendingUploadSession(uploadSessionId, (session) => ({
    ...session,
    status: 'data_failed',
    dataStatus: 'failed',
    retryCount: Number(session.retryCount || 0) + 1,
    lastError: error instanceof Error ? error.message : String((error as any)?.errMsg || error || 'data upload failed'),
    canDeleteDeviceBlocks: false
  }));

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

export const buildUploadSyncMeta = (session: PendingUploadSession) => ({
  uploadSessionId: session.uploadSessionId,
  bindingId: session.bindingId,
  bindingVersion: session.bindingVersion,
  dataUserId: session.dataUserId,
  protocol: session.protocol,
  rawLocalStatus: session.rawLocalStatus,
  rawFrameCount: session.rawFrames.length,
  ...(session.rawFrames.length > 0 ? { rawFrames: session.rawFrames } : {}),
  deviceBlockRefs: session.deviceBlockRefs,
  uploadStatus: {
    deviceReadDone: true,
    dataStatus: session.dataStatus,
    rawLocalStatus: session.rawLocalStatus,
    rawStatus: session.rawStatus
  }
});

export const buildParsedUploadSyncMeta = (session: PendingUploadSession) => {
  const meta = { ...buildUploadSyncMeta(session) } as Record<string, unknown>;
  // 解析后的 /app/data/sync 只提交 dataList。
  // 原始帧由 rawHistory/enqueue 独立补偿入库，避免同一请求体重复携带 rawFrames 导致等待过长。
  delete meta.rawFrames;
  return meta;
};

const RAW_BACKGROUND_UPLOAD_DEDUP_MS = 10 * 60 * 1000;
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
        rawUploadRecentSuccessAt.set(signature, Date.now());
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
