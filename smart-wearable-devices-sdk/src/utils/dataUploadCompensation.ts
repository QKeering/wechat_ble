import type { RingRawHistoryFrame } from '@/api/ringDevice';
import { getBoundRingIdentity } from '@/utils/ringBinding';

export type UploadDataStatus = 'pending' | 'done' | 'partial' | 'failed' | 'empty';
export type UploadRawLocalStatus = 'done' | 'none' | 'failed';
export type UploadRawServerStatus = 'pending' | 'done' | 'failed' | 'none';

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
  deviceBlockRefs?: unknown[];
  status: 'pending' | 'data_done' | 'raw_done' | 'done' | 'data_failed' | 'raw_failed';
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
  let response: unknown;
  try {
    response = await (uni as any).$uv.http.get('/app/device/current', {
      timeout: 8000,
      custom: { toast: false, catch: true },
      ...config
    });
  } catch (error) {
    return {
      ok: false,
      reasonCode: 'CURRENT_BINDING_REQUEST_FAILED',
      reason: error instanceof Error ? error.message : String((error as any)?.errMsg || error || 'request failed')
    };
  }
  const device = pickDeviceObject(response);
  if (!device) {
    return { ok: false, reasonCode: 'NO_ACTIVE_BINDING', reason: 'backend has no active bound device', response };
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
    return {
      ok: false,
      reasonCode: 'BOUND_DEVICE_MISMATCH',
      reason: 'frontend upload device does not match backend current binding',
      device,
      deviceMac: String(backendDeviceMac || ''),
      response
    };
  }
  return {
    ok: true,
    device,
    bindingId: device.bindingId || device.id || device.deviceId,
    bindingVersion: device.bindingVersion || device.updateTime || device.createTime,
    dataUserId: device.dataUserId || device.userId || device.ownerUserId,
    deviceMac: String(backendDeviceMac || deviceMac),
    protocol: device.protocol,
    response
  };
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

const writeQueue = (queue: PendingUploadSession[]) => {
  const nextQueue = queue
    .filter((item) => item && item.uploadSessionId && item.deviceMac)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, PENDING_UPLOAD_QUEUE_MAX_COUNT);
  uni.setStorageSync(PENDING_UPLOAD_QUEUE_STORAGE_KEY, nextQueue);
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
  updatePendingUploadSession(uploadSessionId, (session) => ({
    ...session,
    status: session.dataStatus === 'done' || session.dataStatus === 'empty' ? 'done' : 'raw_done',
    rawStatus: 'done',
    rawResponse: response
  }));

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
  deviceBlockRefs: session.deviceBlockRefs,
  uploadStatus: {
    deviceReadDone: true,
    dataStatus: session.dataStatus,
    rawLocalStatus: session.rawLocalStatus,
    rawStatus: session.rawStatus
  }
});

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
  if (!session.rawFrames.length || session.rawStatus === 'done') return Promise.resolve(null);
  return uploader({
    uploadSessionId: session.uploadSessionId,
    deviceMac: session.deviceMac,
    bindingId: session.bindingId,
    bindingVersion: session.bindingVersion,
    protocol: session.protocol,
    frames: session.rawFrames
  })
    .then((response) => {
      markPendingUploadRawDone(session.uploadSessionId, response);
      return response;
    })
    .catch((error) => {
      markPendingUploadRawFailed(session.uploadSessionId, error);
      throw error;
    });
};
