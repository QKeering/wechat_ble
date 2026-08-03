const DEVICE_HISTORY_CHECKPOINT_STORAGE_KEY = 'qkeer:ring-device-history-checkpoints:v1';
const DEVICE_HISTORY_CHECKPOINT_MAX_COUNT = 80;

type DeviceHistoryCheckpoint = {
  key: string;
  deviceMac: string;
  deviceMacNorm: string;
  protocol: string;
  timestamp: number;
  updatedAt: number;
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
      .filter((item: any) => item && item.key && Number(item.timestamp) > 0)
      .map((item: any) => ({
        key: String(item.key),
        deviceMac: String(item.deviceMac || ''),
        deviceMacNorm: normalizeHistoryCheckpointDeviceMac(item.deviceMacNorm || item.deviceMac),
        protocol: String(item.protocol || 'legacy'),
        timestamp: Math.floor(Number(item.timestamp || 0)),
        updatedAt: Math.floor(Number(item.updatedAt || 0))
      }));
  } catch {
    return [];
  }
};

const writeDeviceHistoryCheckpoints = (items: DeviceHistoryCheckpoint[]) => {
  const next = items
    .filter((item) => item && item.key && item.timestamp > 0)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
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
  return matched?.timestamp || 0;
};

export const setDeviceHistoryCheckpoint = (deviceMac: unknown, protocol: unknown, timestamp: unknown) => {
  const numericTimestamp = Math.floor(Number(timestamp || 0));
  const key = buildHistoryCheckpointKey(deviceMac, protocol);
  if (!key || !Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return 0;
  const deviceMacText = String(deviceMac || '');
  const nextItem: DeviceHistoryCheckpoint = {
    key,
    deviceMac: deviceMacText,
    deviceMacNorm: normalizeHistoryCheckpointDeviceMac(deviceMacText),
    protocol: String(protocol || 'legacy').trim().toLowerCase() || 'legacy',
    timestamp: numericTimestamp,
    updatedAt: Date.now()
  };
  writeDeviceHistoryCheckpoints([nextItem, ...readDeviceHistoryCheckpoints().filter((item) => item.key !== key)]);
  return numericTimestamp;
};
