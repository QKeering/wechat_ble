const DEVICE_HISTORY_CHECKPOINT_STORAGE_KEY = 'qkeer:ring-device-history-checkpoints:v1';
const DEVICE_HISTORY_CHECKPOINT_MAX_COUNT = 80;

export type DeviceHistoryCheckpoint = {
  key: string;
  deviceMac: string;
  deviceMacNorm: string;
  protocol: string;
  timestamp: number;
  readTimestamp: number;
  durableTimestamp: number;
  backendAckTimestamp: number;
  emptyReadTimestamp: number;
  updatedAt: number;
  emptyReadUpdatedAt: number;
};

export const normalizeHistoryCheckpointDeviceMac = (value: unknown) =>
  String(value || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

export const buildHistoryCheckpointKey = (deviceMac: unknown, protocol?: unknown) => {
  const mac = normalizeHistoryCheckpointDeviceMac(deviceMac);
  const normalizedProtocol = String(protocol || 'legacy').trim().toLowerCase() || 'legacy';
  if (!mac) return '';
  return `${normalizedProtocol}:${mac}`;
};

const normalizeStoredDeviceHistoryCheckpoints = (stored: unknown): DeviceHistoryCheckpoint[] => {
  const list = Array.isArray(stored) ? stored : Array.isArray((stored as any)?.items) ? (stored as any).items : [];
  return list
    .filter((item: any) => item && item.key && (Number(item.timestamp) > 0 || Number(item.readTimestamp) > 0 || Number(item.emptyReadTimestamp) > 0))
    .map((item: any) => {
      const storedBackendAckTimestamp = Math.floor(Number(item.backendAckTimestamp || item.timestamp || 0));
      const storedDurableTimestamp = Math.floor(Number(item.durableTimestamp || 0));
      // Old v1 records only had `timestamp`; treat that legacy value as both
      // durable and acknowledged. Never move ACK beyond the durable fact.
      const durableTimestamp = storedDurableTimestamp > 0 ? storedDurableTimestamp : storedBackendAckTimestamp;
      const backendAckTimestamp = Math.min(storedBackendAckTimestamp, durableTimestamp);
      const readTimestamp = Math.max(durableTimestamp, Math.floor(Number(item.readTimestamp || 0)));
      return {
        key: String(item.key),
        deviceMac: String(item.deviceMac || ''),
        deviceMacNorm: normalizeHistoryCheckpointDeviceMac(item.deviceMacNorm || item.deviceMac),
        protocol: String(item.protocol || 'legacy'),
        timestamp: backendAckTimestamp,
        readTimestamp,
        durableTimestamp,
        backendAckTimestamp,
        emptyReadTimestamp: Math.floor(Number(item.emptyReadTimestamp || 0)),
        updatedAt: Math.floor(Number(item.updatedAt || 0)),
        emptyReadUpdatedAt: Math.floor(Number(item.emptyReadUpdatedAt || 0))
      };
    });
};

const readDeviceHistoryCheckpoints = (): DeviceHistoryCheckpoint[] => {
  try {
    const stored = uni.getStorageSync(DEVICE_HISTORY_CHECKPOINT_STORAGE_KEY);
    return normalizeStoredDeviceHistoryCheckpoints(stored);
  } catch {
    return [];
  }
};

const getDeviceHistoryStorageAsync = <T = unknown>(key: string): Promise<T | undefined> =>
  new Promise((resolve) => {
    (uni as any).getStorage({
      key,
      success: (result: { data?: T }) => resolve(result?.data),
      fail: () => resolve(undefined)
    });
  });

const setDeviceHistoryStorageAsync = (key: string, data: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    (uni as any).setStorage({
      key,
      data,
      success: () => resolve(),
      fail: (error: unknown) => reject(error)
    });
  });

const writeDeviceHistoryCheckpoints = (items: DeviceHistoryCheckpoint[]) => {
  const next = items
    .filter((item) => item && item.key && (item.backendAckTimestamp > 0 || item.readTimestamp > 0 || item.emptyReadTimestamp > 0))
    .sort(
      (left, right) =>
        Math.max(Number(right.updatedAt || 0), Number(right.emptyReadUpdatedAt || 0)) -
        Math.max(Number(left.updatedAt || 0), Number(left.emptyReadUpdatedAt || 0))
    )
    .slice(0, DEVICE_HISTORY_CHECKPOINT_MAX_COUNT);
  try {
    uni.setStorageSync(DEVICE_HISTORY_CHECKPOINT_STORAGE_KEY, next);
  } catch {
    // Checkpoint persistence must not break Bluetooth sync.
  }
  return next;
};

const writeDeviceHistoryCheckpointsAsync = async (items: DeviceHistoryCheckpoint[]) => {
  const next = items
    .filter((item) => item && item.key && (item.backendAckTimestamp > 0 || item.readTimestamp > 0 || item.emptyReadTimestamp > 0))
    .sort(
      (left, right) =>
        Math.max(Number(right.updatedAt || 0), Number(right.emptyReadUpdatedAt || 0)) -
        Math.max(Number(left.updatedAt || 0), Number(left.emptyReadUpdatedAt || 0))
    )
    .slice(0, DEVICE_HISTORY_CHECKPOINT_MAX_COUNT);
  await setDeviceHistoryStorageAsync(DEVICE_HISTORY_CHECKPOINT_STORAGE_KEY, next);
  return next;
};

export const getDeviceHistoryCheckpoint = (deviceMac: unknown, protocol?: unknown) => {
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key) return 0;
  const matched = readDeviceHistoryCheckpoints().find((item) => item.key === key);
  return matched?.backendAckTimestamp || matched?.timestamp || 0;
};

export const getDeviceHistoryReadCheckpoint = (deviceMac: unknown, protocol?: unknown) => {
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key) return 0;
  return readDeviceHistoryCheckpoints().find((item) => item.key === key)?.readTimestamp || 0;
};

export const getDeviceHistoryDurableCheckpoint = (deviceMac: unknown, protocol?: unknown) => {
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key) return 0;
  return readDeviceHistoryCheckpoints().find((item) => item.key === key)?.durableTimestamp || 0;
};

export const getDeviceHistoryBackendAckCheckpoint = getDeviceHistoryCheckpoint;

export const getDeviceHistoryEmptyReadCheckpoint = (deviceMac: unknown, protocol?: unknown) => {
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key) return 0;
  const matched = readDeviceHistoryCheckpoints().find((item) => item.key === key);
  return matched?.emptyReadTimestamp || 0;
};

export const getDeviceHistoryCheckpointMeta = (deviceMac: unknown, protocol?: unknown): DeviceHistoryCheckpoint | null => {
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key) return null;
  const matched = readDeviceHistoryCheckpoints().find((item) => item.key === key);
  return matched || null;
};

const setCheckpointStage = (
  deviceMac: unknown,
  protocol: unknown,
  timestamp: unknown,
  stage: 'read' | 'durable' | 'backendAck'
) => {
  const numericTimestamp = Math.floor(Number(timestamp || 0));
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key || !Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return 0;
  const existingItems = readDeviceHistoryCheckpoints();
  const existing = existingItems.find((item) => item.key === key);
  const existingEmptyReadTimestamp = existing?.emptyReadTimestamp || 0;
  const durableTimestamp = stage === 'durable'
    ? Math.max(existing?.durableTimestamp || 0, numericTimestamp)
    : existing?.durableTimestamp || 0;
  const requestedBackendAckTimestamp = stage === 'backendAck'
    ? Math.max(existing?.backendAckTimestamp || 0, numericTimestamp)
    : existing?.backendAckTimestamp || 0;
  const backendAckTimestamp = Math.min(requestedBackendAckTimestamp, durableTimestamp);
  const readTimestamp = Math.max(existing?.readTimestamp || 0, stage === 'read' ? numericTimestamp : 0, durableTimestamp);
  const nextEmptyReadTimestamp = existingEmptyReadTimestamp > numericTimestamp ? existingEmptyReadTimestamp : 0;
  const deviceMacText = String(deviceMac || '');
  const nextItem: DeviceHistoryCheckpoint = {
    key,
    deviceMac: deviceMacText,
    deviceMacNorm: normalizeHistoryCheckpointDeviceMac(deviceMacText),
    protocol: String(protocol || 'legacy').trim().toLowerCase() || 'legacy',
    timestamp: backendAckTimestamp,
    readTimestamp,
    durableTimestamp,
    backendAckTimestamp,
    emptyReadTimestamp: nextEmptyReadTimestamp,
    updatedAt: Date.now(),
    emptyReadUpdatedAt: nextEmptyReadTimestamp > 0 ? existing?.emptyReadUpdatedAt || existing?.updatedAt || 0 : 0
  };
  writeDeviceHistoryCheckpoints([nextItem, ...existingItems.filter((item) => item.key !== key)]);
  if (stage === 'backendAck') return backendAckTimestamp;
  if (stage === 'durable') return durableTimestamp;
  return readTimestamp;
};

export const setDeviceHistoryReadCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) =>
  setCheckpointStage(deviceMac, protocol, timestamp, 'read');

export const setDeviceHistoryDurableCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) =>
  setCheckpointStage(deviceMac, protocol, timestamp, 'durable');

export const setDeviceHistoryBackendAckCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) =>
  setCheckpointStage(deviceMac, protocol, timestamp, 'backendAck');

export const setDeviceHistoryBackendAckCheckpointAsync = async (
  deviceMac: unknown,
  protocol: unknown,
  timestamp: unknown
) => {
  const numericTimestamp = Math.floor(Number(timestamp || 0));
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key || !Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return 0;
  const stored = await getDeviceHistoryStorageAsync(DEVICE_HISTORY_CHECKPOINT_STORAGE_KEY);
  const existingItems = normalizeStoredDeviceHistoryCheckpoints(stored);
  const existing = existingItems.find((item) => item.key === key);
  const durableTimestamp = existing?.durableTimestamp || 0;
  const backendAckTimestamp = Math.min(
    Math.max(existing?.backendAckTimestamp || 0, numericTimestamp),
    durableTimestamp
  );
  const existingEmptyReadTimestamp = existing?.emptyReadTimestamp || 0;
  const nextEmptyReadTimestamp = existingEmptyReadTimestamp > numericTimestamp ? existingEmptyReadTimestamp : 0;
  const deviceMacText = String(deviceMac || '');
  const nextItem: DeviceHistoryCheckpoint = {
    key,
    deviceMac: deviceMacText,
    deviceMacNorm: normalizeHistoryCheckpointDeviceMac(deviceMacText),
    protocol: String(protocol || 'legacy').trim().toLowerCase() || 'legacy',
    timestamp: backendAckTimestamp,
    readTimestamp: Math.max(existing?.readTimestamp || 0, durableTimestamp),
    durableTimestamp,
    backendAckTimestamp,
    emptyReadTimestamp: nextEmptyReadTimestamp,
    updatedAt: Date.now(),
    emptyReadUpdatedAt: nextEmptyReadTimestamp > 0 ? existing?.emptyReadUpdatedAt || existing?.updatedAt || 0 : 0
  };
  await writeDeviceHistoryCheckpointsAsync([nextItem, ...existingItems.filter((item) => item.key !== key)]);
  return backendAckTimestamp;
};

export const setDeviceHistoryCheckpoint = setDeviceHistoryBackendAckCheckpoint;

export const setDeviceHistoryEmptyReadCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) => {
  const numericTimestamp = Math.floor(Number(timestamp || 0));
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key || !Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return 0;
  const existingItems = readDeviceHistoryCheckpoints();
  const existing = existingItems.find((item) => item.key === key);
  const successfulTimestamp = existing?.backendAckTimestamp || existing?.timestamp || 0;
  const emptyReadTimestamp = Math.max(existing?.emptyReadTimestamp || 0, numericTimestamp);
  if (successfulTimestamp >= emptyReadTimestamp) return 0;
  const deviceMacText = String(deviceMac || '');
  const nextItem: DeviceHistoryCheckpoint = {
    key,
    deviceMac: existing?.deviceMac || deviceMacText,
    deviceMacNorm: normalizeHistoryCheckpointDeviceMac(existing?.deviceMacNorm || deviceMacText),
    protocol: String(existing?.protocol || protocol || 'legacy').trim().toLowerCase() || 'legacy',
    timestamp: successfulTimestamp,
    readTimestamp: existing?.readTimestamp || successfulTimestamp,
    durableTimestamp: existing?.durableTimestamp || successfulTimestamp,
    backendAckTimestamp: successfulTimestamp,
    emptyReadTimestamp,
    updatedAt: existing?.updatedAt || 0,
    emptyReadUpdatedAt: Date.now()
  };
  writeDeviceHistoryCheckpoints([nextItem, ...existingItems.filter((item) => item.key !== key)]);
  return emptyReadTimestamp;
};
