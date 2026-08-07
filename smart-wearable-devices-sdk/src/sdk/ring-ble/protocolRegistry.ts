import type { RingDeviceInfo, RingProtocolDetector, RingProtocolKind } from './types';

export const LEGACY_RING_DETECTOR: RingProtocolDetector = {
  protocol: 'legacy',
  namePrefixes: ['HR', 'IF', 'QK', 'QKeeRing', 'PPlus']
};

export const QKEER_V2_RING_DETECTOR: RingProtocolDetector = {
  protocol: 'qkeer-v2',
  namePrefixes: ['MUSLEEP_RING', 'QKV2'],
  productIds: ['QK-V2'],
  serviceMarkers: ['F618']
};

const RW_NAME_PREFIXES = ['SY', 'BH3'];

const getProtocolNameCandidates = (device?: RingDeviceInfo) =>
  [
    device?.name,
    device?.localName,
    device?.bleName,
    device?.displayName,
    device?.deviceName,
    device?.model,
    device?.modelName,
    device?.deviceModel,
    device?.productName
  ]
    .filter(Boolean)
    .map((value) => `${value}`.trim())
    .filter(Boolean);

const hasProtocolNameCandidate = (device?: RingDeviceInfo) => getProtocolNameCandidates(device).length > 0;

export const isRwProtocolDeviceName = (device?: RingDeviceInfo) =>
  getProtocolNameCandidates(device).some((rawName) => {
    const name = rawName.toUpperCase();
    return (
      RW_NAME_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
      /(^|[^A-Z0-9])SY[0-9A-Z_-]*/.test(name) ||
      /(^|[^A-Z0-9])BH3([_-]?[0-9A-Z]+)?([^A-Z0-9]|$)/.test(name)
    );
  });

export const RW_RING_DETECTOR: RingProtocolDetector = {
  protocol: 'rw',
  namePrefixes: [],
  productIds: [],
  serviceMarkers: [],
  match: (device) => {
    // Current product rule: only SY / BH3 devices use RW. L19 devices may share
    // manufacturer/service markers, so advertis/service fields must not select RW.
    if (isRwProtocolDeviceName(device)) return true;

    return false;
  }
};

const LEGACY_PROTOCOL_DETECTORS: RingProtocolDetector[] = [RW_RING_DETECTOR, LEGACY_RING_DETECTOR];

const protocolDetectors: RingProtocolDetector[] = [...LEGACY_PROTOCOL_DETECTORS];

export const registerRingProtocolDetector = (detector: RingProtocolDetector) => {
  const existingIndex = protocolDetectors.findIndex((item) => item.protocol === detector.protocol);
  if (existingIndex >= 0) {
    protocolDetectors.splice(existingIndex, 1, detector);
    return;
  }
  protocolDetectors.unshift(detector);
};

export const getRingProtocolDetectors = () => [...protocolDetectors];

export const resolveRingProtocol = (device?: RingDeviceInfo): RingProtocolKind => {
  if (!device) return 'legacy';

  if (isRwProtocolDeviceName(device)) return 'rw';

  if (device.protocol === 'rw') {
    return hasProtocolNameCandidate(device) ? 'legacy' : 'rw';
  }

  if (device.protocol === 'legacy') return 'legacy';

  const name = `${device.name || device.localName || device.bleName || device.displayName || ''}`.toUpperCase();
  const productId = `${device.productId || ''}`.toUpperCase();
  const services = normalizeAdvertisedServices(device);

  const matched = protocolDetectors.find((detector) => {
    if (detector.match?.(device)) return true;

    const matchesName = detector.namePrefixes?.some((prefix) => name.startsWith(prefix.toUpperCase()));
    if (matchesName) return true;

    const matchesProduct = detector.productIds?.some((id) => productId === id.toUpperCase());
    if (matchesProduct) return true;

    return detector.serviceMarkers?.some((marker) =>
      services.some((serviceId) => serviceId.includes(marker.toUpperCase()))
    );
  });

  return matched?.protocol || 'legacy';
};

export const parseQkeerV2AdvertisInfo = (device?: RingDeviceInfo) => {
  const bytes = getAdvertisBytes(device);
  if (!bytes || bytes.length < 11) return null;

  const offset = 2;
  const batteryInfo = bytes[offset + 2] || 0;
  const battery = parseQkeerV2BatteryInfo(batteryInfo);
  const macBytes = bytes.slice(offset + 3, offset + 9);

  return {
    deviceType: bytes[offset] || 0,
    protocolVersion: bytes[offset + 1] || 1,
    isCharging: battery.isCharging,
    batteryLevel: battery.batteryLevel,
    macInfo: Array.from(macBytes, (byte) => byte.toString(16).padStart(2, '0')).join(':').toUpperCase()
  };
};

export const parseRwAdvertisInfo = (device?: RingDeviceInfo) => {
  const bytes = getAdvertisBytes(device);
  if (!bytes || bytes.length < 8) return null;

  const markerIndex = Array.from(bytes).findIndex((byte, index) => byte === 0x52 && index + 6 < bytes.length);
  if (markerIndex < 0) return null;

  const macBytes = bytes.slice(markerIndex + 1, markerIndex + 7);
  if (macBytes.length !== 6) return null;

  return {
    macInfo: Array.from(macBytes, (byte) => byte.toString(16).padStart(2, '0')).join(':').toUpperCase()
  };
};

function normalizeAdvertisedServices(device: RingDeviceInfo): string[] {
  const candidates = [
    device.serviceId,
    ...(Array.isArray(device.advertisServiceUUIDs) ? device.advertisServiceUUIDs : []),
    ...(Array.isArray(device.advertisServiceUUIDsList) ? device.advertisServiceUUIDsList : [])
  ];

  return candidates.filter(Boolean).map((value) => `${value}`.toUpperCase());
}

function getAdvertisBytes(device?: RingDeviceInfo): Uint8Array | null {
  const value = device?.advertisData;
  if (!value) return null;

  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === 'string') {
    const clean = value.replace(/\s+/g, '');
    if (clean.length % 2 !== 0) return null;
    const bytes = new Uint8Array(clean.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  return null;
}

function parseQkeerV2BatteryInfo(batteryInfo: number) {
  if (batteryInfo > 200) {
    return { batteryLevel: 255, isCharging: 0 };
  }

  if (batteryInfo > 100) {
    return { batteryLevel: batteryInfo - 100, isCharging: 1 };
  }

  return { batteryLevel: batteryInfo, isCharging: 0 };
}
