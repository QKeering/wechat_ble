export type DeviceIdentityCacheSource =
  | 'first-bind'
  | 'scan-match'
  | 'connect-verified'
  | 'device-info-refresh'
  | 'reconnect-scan-match'
  | 'bound-reconnect'
  | string;

export interface DeviceIdentityCacheRecord {
  userId: string;
  mac: string;
  deviceId: string;
  platform: string;
  name: string;
  verified: boolean;
  verifiedAt: number;
  lastConnectedAt: number;
  failCount: number;
  source: DeviceIdentityCacheSource;
}

export interface DeviceIdentityCacheInput {
  userId?: unknown;
  mac?: unknown;
  deviceId?: unknown;
  platform?: unknown;
  name?: unknown;
  source?: DeviceIdentityCacheSource;
}

const DEVICE_IDENTITY_CACHE_KEY = 'qkeer:device-identity-cache:v1';
const DEVICE_IDENTITY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_IDENTITY_CACHE_MAX_FAILURES = 3;

// Only these flows have direct identity evidence: the communication deviceId
// and the parsed stable MAC came from the same scan/bind record.
const DEVICE_IDENTITY_EVIDENCE_SOURCES = new Set<DeviceIdentityCacheSource>([
  'first-bind',
  'scan-match',
  'reconnect-scan-match'
]);

const normalizeStorageObject = (value: unknown): Record<string, DeviceIdentityCacheRecord> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, DeviceIdentityCacheRecord>;
};

const safeGetStorage = (key: string) => {
  try {
    return uni.getStorageSync(key);
  } catch {
    return undefined;
  }
};

const safeSetStorage = (key: string, value: unknown) => {
  try {
    uni.setStorageSync(key, value);
  } catch {
    // Local cache only accelerates connection. Write failures must not block the main BLE flow.
  }
};

export const normalizeDeviceIdentityMac = (value?: unknown) => {
  const hex = String(value || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase();
  if (hex.length !== 12) return '';
  return hex.match(/[0-9A-F]{2}/g)?.join(':') || '';
};

const normalizeDeviceIdentityUserId = (value?: unknown) => String(value || '').trim() || 'unknown';

const normalizeDeviceIdentityPlatform = (value?: unknown) => String(value || '').trim().toLowerCase() || 'unknown';

const isConflictingMacLikeDeviceIdForMac = (deviceId: unknown, mac: string) => {
  const normalizedDeviceIdAsMac = normalizeDeviceIdentityMac(deviceId);
  return Boolean(mac && normalizedDeviceIdAsMac && normalizedDeviceIdAsMac !== mac);
};

const isDeviceIdentityCacheRecordExpired = (record: DeviceIdentityCacheRecord | null | undefined, now = Date.now()) => {
  const verifiedAt = Number(record?.verifiedAt || record?.lastConnectedAt || 0);
  return !verifiedAt || now - verifiedAt > DEVICE_IDENTITY_CACHE_TTL_MS;
};

const isDeviceIdentityCacheRecordUsable = (
  record: DeviceIdentityCacheRecord | null | undefined,
  mac: string,
  userId: string
) => {
  const hasIdentityEvidence = Boolean(
    record &&
      (DEVICE_IDENTITY_EVIDENCE_SOURCES.has(record.source) || normalizeDeviceIdentityMac(record.deviceId) === mac)
  );
  return Boolean(
    record?.verified &&
      record?.deviceId &&
      record.mac === mac &&
      record.userId === userId &&
      hasIdentityEvidence &&
      Number(record.failCount || 0) < DEVICE_IDENTITY_CACHE_MAX_FAILURES &&
      !isDeviceIdentityCacheRecordExpired(record)
  );
};

export const getDeviceIdentityPlatform = () => {
  try {
    return normalizeDeviceIdentityPlatform(uni.getSystemInfoSync()?.platform);
  } catch {
    return 'unknown';
  }
};

export const getCurrentDeviceIdentityUserId = () => {
  const userInfo = safeGetStorage('userInfo') as Record<string, unknown> | undefined;
  return normalizeDeviceIdentityUserId(userInfo?.id ?? userInfo?.userId ?? userInfo?.user_id ?? userInfo?.uid);
};

const getDeviceIdentityCache = () => normalizeStorageObject(safeGetStorage(DEVICE_IDENTITY_CACHE_KEY));

const setDeviceIdentityCache = (cache: Record<string, DeviceIdentityCacheRecord>) => {
  safeSetStorage(DEVICE_IDENTITY_CACHE_KEY, cache);
};

const getDeviceIdentityCacheKey = (input: DeviceIdentityCacheInput) => {
  const userId = normalizeDeviceIdentityUserId(input.userId ?? getCurrentDeviceIdentityUserId());
  const platform = normalizeDeviceIdentityPlatform(input.platform ?? getDeviceIdentityPlatform());
  const mac = normalizeDeviceIdentityMac(input.mac);
  if (!mac) return '';
  return `${userId}:${platform}:${mac}`;
};

const findLatestDeviceIdentityCacheByMac = (mac: string, userId: unknown, platform?: unknown) => {
  const normalizedMac = normalizeDeviceIdentityMac(mac);
  if (!normalizedMac) return null;
  const normalizedUserId = normalizeDeviceIdentityUserId(userId);
  const normalizedPlatform = normalizeDeviceIdentityPlatform(platform ?? getDeviceIdentityPlatform());
  const records = Object.values(getDeviceIdentityCache()).filter(
    (record) =>
      isDeviceIdentityCacheRecordUsable(record, normalizedMac, normalizedUserId) &&
      (!normalizedPlatform || record.platform === normalizedPlatform)
  );
  records.sort((left, right) => (right.verifiedAt || right.lastConnectedAt || 0) - (left.verifiedAt || left.lastConnectedAt || 0));
  return records[0] || null;
};

export const readDeviceIdentityCache = (input: DeviceIdentityCacheInput) => {
  const mac = normalizeDeviceIdentityMac(input.mac);
  if (!mac) return null;
  const userId = normalizeDeviceIdentityUserId(input.userId ?? getCurrentDeviceIdentityUserId());
  const key = getDeviceIdentityCacheKey(input);
  const exactRecord = key ? getDeviceIdentityCache()[key] : null;
  return isDeviceIdentityCacheRecordUsable(exactRecord, mac, userId)
    ? exactRecord
    : findLatestDeviceIdentityCacheByMac(mac, userId, input.platform);
};

export const upsertDeviceIdentityCache = (input: DeviceIdentityCacheInput) => {
  const mac = normalizeDeviceIdentityMac(input.mac);
  const deviceId = String(input.deviceId || '').trim();
  if (!mac || !deviceId) return null;
  const now = Date.now();
  const userId = normalizeDeviceIdentityUserId(input.userId ?? getCurrentDeviceIdentityUserId());
  const platform = normalizeDeviceIdentityPlatform(input.platform ?? getDeviceIdentityPlatform());
  const key = getDeviceIdentityCacheKey({ userId, platform, mac });
  if (!key) return null;

  const cache = getDeviceIdentityCache();
  const previous = cache[key];
  const requestedSource = input.source || previous?.source || 'connect-verified';
  const hasScanOrBindEvidence = DEVICE_IDENTITY_EVIDENCE_SOURCES.has(requestedSource);
  const deviceIdIsStableMac = normalizeDeviceIdentityMac(deviceId) === mac;
  const refreshesSameMapping = Boolean(previous?.verified && previous.deviceId === deviceId && previous.mac === mac);

  // A successful connection alone cannot prove which physical ring was
  // connected. It may refresh an existing mapping, but only scan/bind evidence
  // (or Android's deviceId === MAC case) may create or replace one.
  if (!hasScanOrBindEvidence && !deviceIdIsStableMac && !refreshesSameMapping) return null;

  // A MAC-shaped platform id different from the stable MAC is valid on some
  // systems only when it came from the same scan/bind record.
  if (isConflictingMacLikeDeviceIdForMac(deviceId, mac) && !hasScanOrBindEvidence && !refreshesSameMapping) return null;

  const record: DeviceIdentityCacheRecord = {
    userId,
    mac,
    deviceId,
    platform,
    name: String(input.name || previous?.name || '').trim(),
    verified: true,
    verifiedAt: now,
    lastConnectedAt: now,
    failCount: 0,
    source: hasScanOrBindEvidence ? requestedSource : previous?.source || requestedSource
  };
  cache[key] = record;
  setDeviceIdentityCache(cache);
  return record;
};

export const markDeviceIdentityCacheConnected = upsertDeviceIdentityCache;

export const markDeviceIdentityCacheFailed = (input: DeviceIdentityCacheInput) => {
  const existing = readDeviceIdentityCache(input);
  if (!existing) return null;
  const cache = getDeviceIdentityCache();
  const key = getDeviceIdentityCacheKey(existing);
  if (!key) return null;
  const record: DeviceIdentityCacheRecord = {
    ...existing,
    failCount: (existing.failCount || 0) + 1,
    verified: (existing.failCount || 0) + 1 < DEVICE_IDENTITY_CACHE_MAX_FAILURES,
    // Keep the original identity-evidence source. A reconnect failure describes
    // connection health, not how the MAC/deviceId relationship was proven.
    source: existing.source
  };
  cache[key] = record;
  setDeviceIdentityCache(cache);
  return record;
};

export const removeDeviceIdentityCache = (input: DeviceIdentityCacheInput) => {
  const mac = normalizeDeviceIdentityMac(input.mac);
  if (!mac) return;
  const platform = normalizeDeviceIdentityPlatform(input.platform ?? getDeviceIdentityPlatform());
  const userId = normalizeDeviceIdentityUserId(input.userId ?? getCurrentDeviceIdentityUserId());
  const cache = getDeviceIdentityCache();
  Object.keys(cache).forEach((key) => {
    const record = cache[key];
    if (record?.mac !== mac) return;
    if (input.userId !== undefined && record.userId !== userId) return;
    if (input.platform !== undefined && record.platform !== platform) return;
    delete cache[key];
  });
  setDeviceIdentityCache(cache);
};

export const getDeviceIdentityCacheMacFromDevice = (device?: Record<string, any> | null) => {
  if (!device || typeof device !== 'object') return '';
  return (
    normalizeDeviceIdentityMac(device.mac) ||
    normalizeDeviceIdentityMac(device.macAddress) ||
    normalizeDeviceIdentityMac(device.deviceMac) ||
    normalizeDeviceIdentityMac(device.device_mac) ||
    normalizeDeviceIdentityMac(device.bluetoothMac) ||
    normalizeDeviceIdentityMac(device.bleMac) ||
    normalizeDeviceIdentityMac(device.macAddr) ||
    normalizeDeviceIdentityMac(device.mac_addr) ||
    normalizeDeviceIdentityMac(device.advertis?.macInfo) ||
    normalizeDeviceIdentityMac(device.advertis?.mac) ||
    normalizeDeviceIdentityMac(device.advertis?.macAddress) ||
    normalizeDeviceIdentityMac(device.advertis?.deviceMac) ||
    normalizeDeviceIdentityMac(device.advertis?.device_mac) ||
    normalizeDeviceIdentityMac(device.advertis?.bluetoothMac) ||
    normalizeDeviceIdentityMac(device.advertis?.bleMac) ||
    normalizeDeviceIdentityMac(device.advertis?.macAddr) ||
    normalizeDeviceIdentityMac(device.advertis?.mac_addr) ||
    normalizeDeviceIdentityMac(device.uniMacId)
  );
};

export const applyDeviceIdentityCacheToDevice = <T extends Record<string, any>>(device: T, input: DeviceIdentityCacheInput = {}) => {
  const mac = normalizeDeviceIdentityMac(input.mac) || getDeviceIdentityCacheMacFromDevice(device);
  if (!mac) return device;
  const cached = readDeviceIdentityCache({ ...input, mac });
  if (!cached?.verified || !cached.deviceId) return device;

  return {
    ...device,
    deviceId: cached.deviceId,
    platformDeviceId: cached.deviceId,
    wxDeviceId: cached.deviceId,
    bleDeviceId: cached.deviceId,
    bluetoothDeviceId: cached.deviceId,
    mac,
    uniMacId: mac,
    advertis: {
      ...(device.advertis || {}),
      macInfo: mac
    },
    __deviceIdCacheVerified: true,
    __deviceIdCacheSource: cached.source,
    __deviceIdCacheVerifiedAt: cached.verifiedAt,
    __deviceIdCacheFailCount: cached.failCount
  } as T;
};

export const hasVerifiedDeviceIdentityCacheDeviceId = (device?: Record<string, any> | null) =>
  Boolean(device?.deviceId && device?.__deviceIdCacheVerified);
