import type { RingDeviceInfo, RingParsedData, RingStoreBridgeTarget } from './types';
import { normalizeRingData } from './legacy/normalizer';

export interface HandleRingParsedDataOptions {
  normalize?: boolean;
}

export const handleRingParsedData = (
  store: RingStoreBridgeTarget,
  parsed: RingParsedData | null | undefined,
  options: HandleRingParsedDataOptions = {}
) => {
  if (!parsed || !parsed.type) return;
  if (!shouldAcceptParsedData(store.deviceInfo, parsed)) return;

  if (typeof store.handleParsedData === 'function') {
    store.handleParsedData(parsed);
  }

  const shouldNormalize = options.normalize ?? true;
  if (!shouldNormalize) return;

  const normalized = normalizeRingData(parsed);
  if (!normalized) return;

  if (typeof store.handleNormalizedRingData === 'function') {
    store.handleNormalizedRingData(normalized);
    return;
  }

  if (typeof store.updateNormalizedRingData === 'function') {
    store.updateNormalizedRingData([...(store.normalizedRingData || []), normalized]);
  }
};

export const resetRingRuntimeState = (store: RingStoreBridgeTarget) => {
  if (typeof store.updateDeviceInfo === 'function') {
    store.updateDeviceInfo({});
  }

  if (typeof store.updateReceivedData === 'function') {
    store.updateReceivedData([]);
  }

  if (typeof store.updateNormalizedRingData === 'function') {
    store.updateNormalizedRingData([]);
  }
};

const IDENTITY_FIELDS = ['deviceId', 'uniMacId', 'mac', 'normalMac', 'iosMacId'] as const;
const STABLE_IDENTITY_FIELDS = new Set<string>(['mac', 'normalMac', 'iosMacId']);

const shouldAcceptParsedData = (currentDevice: RingDeviceInfo | undefined, parsed: RingParsedData) => {
  if (currentDevice?.protocol && parsed.protocol && currentDevice.protocol !== parsed.protocol) {
    return false;
  }

  const parsedKeys = getDeviceIdentityKeys(parsed);
  const currentKeys = getDeviceIdentityKeys(currentDevice);
  if (currentKeys.size === 0) return false;
  if (parsedKeys.size === 0) return true;

  for (const key of parsedKeys) {
    if (currentKeys.has(key)) return true;
  }

  return false;
};

const getDeviceIdentityKeys = (source: Record<string, any> | null | undefined) => {
  const keys = new Set<string>();
  if (!source || typeof source !== 'object') return keys;

  for (const field of IDENTITY_FIELDS) {
    addDeviceIdentityKey(keys, source[field], shouldAllowTailIdentity(field, source[field]));
  }

  addDeviceIdentityKey(keys, source.advertis?.macInfo, true);
  addDeviceIdentityKey(keys, source.advertis?.mac, true);
  addDeviceIdentityKey(keys, source.advertis?.deviceId, shouldAllowTailIdentity('deviceId', source.advertis?.deviceId));
  addDeviceIdentityKey(keys, source.device?.deviceId, shouldAllowTailIdentity('deviceId', source.device?.deviceId));
  addDeviceIdentityKey(keys, source.device?.mac, true);
  addDeviceIdentityKey(keys, source.device?.uniMacId, shouldAllowTailIdentity('uniMacId', source.device?.uniMacId));

  return keys;
};

const addDeviceIdentityKey = (keys: Set<string>, value: unknown, allowTailIdentity = false) => {
  const key = normalizeDeviceIdentity(value);
  if (key) keys.add(key);

  const hexKey = normalizeHexIdentity(value);
  if (!hexKey) return;

  keys.add(`hex:${hexKey}`);
  if (allowTailIdentity && hexKey.length >= 6) {
    keys.add(`tail:${hexKey.slice(-6)}`);
  }
};

const shouldAllowTailIdentity = (field: string, value: unknown) => {
  if (STABLE_IDENTITY_FIELDS.has(field)) return true;
  return looksLikeBleMac(value);
};

const looksLikeBleMac = (value: unknown) => {
  if (value == null) return false;
  const text = String(value).trim();
  return /^[a-fA-F0-9]{2}(:[a-fA-F0-9]{2}){2,5}$/.test(text);
};

const normalizeDeviceIdentity = (value: unknown) => {
  if (value == null) return '';

  const text = String(value).trim();
  if (!text || text === '-' || text.toLowerCase() === 'undefined' || text.toLowerCase() === 'null') {
    return '';
  }

  return text.toLowerCase();
};

const normalizeHexIdentity = (value: unknown) => {
  if (value == null) return '';
  const text = String(value).replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return text.length >= 6 ? text : '';
};
