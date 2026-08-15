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

const readDeviceHistoryCheckpoints = (): DeviceHistoryCheckpoint[] => {
  try {
    const stored = uni.getStorageSync(DEVICE_HISTORY_CHECKPOINT_STORAGE_KEY);
    const list = Array.isArray(stored) ? stored : Array.isArray((stored as any)?.items) ? (stored as any).items : [];
    return list
      .filter((item: any) => item && item.key && (Number(item.timestamp) > 0 || Number(item.readTimestamp) > 0 || Number(item.emptyReadTimestamp) > 0))
      .map((item: any) => {
        const backendAckTimestamp = Math.floor(Number(item.backendAckTimestamp || item.timestamp || 0));
        const durableTimestamp = Math.max(backendAckTimestamp, Math.floor(Number(item.durableTimestamp || 0)));
        const readTimestamp = Math.max(durableTimestamp, Math.floor(Number(item.readTimestamp || 0)));
        return ({
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
        });
      });
  } catch {
    return [];
  }
};

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
  const backendAckTimestamp = stage === 'backendAck' ? Math.max(existing?.backendAckTimestamp || 0, numericTimestamp) : existing?.backendAckTimestamp || 0;
  const durableTimestamp = stage === 'durable' || stage === 'backendAck'
    ? Math.max(existing?.durableTimestamp || 0, numericTimestamp)
    : existing?.durableTimestamp || 0;
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
  return numericTimestamp;
};

export const setDeviceHistoryReadCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) =>
  setCheckpointStage(deviceMac, protocol, timestamp, 'read');

export const setDeviceHistoryDurableCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) =>
  setCheckpointStage(deviceMac, protocol, timestamp, 'durable');

export const setDeviceHistoryBackendAckCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) =>
  setCheckpointStage(deviceMac, protocol, timestamp, 'backendAck');

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
