import { parseLegacyRingData } from './parser';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const battery = parseLegacyRingData(new Uint8Array([0x00, 0x01, 0x12, 0x00, 101]));
assert(battery?.type === 'battery', 'battery frame should parse');
assert(battery?.status === 'charging', 'battery status should keep legacy charging code');
assert(battery?.value === '充电中', 'battery value should keep legacy display text');

const activeMeasure = parseLegacyRingData(new Uint8Array([0x00, 0x02, 0x31, 0x00, 0x01, 70, 30, 36]));
assert(activeMeasure?.type === 'active_measure', 'active measure frame should parse');
assert(activeMeasure?.status === '佩戴', 'active measure status should keep legacy display text');
assert(activeMeasure?.temperature === '0.36°C', 'active measure temperature should keep legacy unit');

const collectPeriod = parseLegacyRingData(new Uint8Array([0x00, 0x03, 0x37, 0x01, 0xb0, 0x04, 0x00, 0x00]));
assert(collectPeriod?.type === 'collect_period_read', 'collect period frame should parse');
assert(collectPeriod?.period === 1200, 'collect period should decode uint32 little-endian');
assert(collectPeriod?.minutes === '20.0', 'collect period minutes should match legacy format');

const deviceTime = parseLegacyRingData(
  new Uint8Array([0x00, 0x04, 0x10, 0x01, 0x48, 0xb2, 0x6f, 0x09, 0x8b, 0x01, 0x00, 0x00, 0x08])
);
assert(deviceTime?.type === 'device_time', 'device-time frame should parse');
assert(deviceTime?.deviceTimestamp === 1696670397000, 'device-time frame should expose the device timestamp like RW');
assert(typeof deviceTime?.timestamp === 'number', 'device-time frame should keep the receive timestamp');
assert(deviceTime?.timezone === 8, 'device-time frame should decode timezone');

export const legacyParserParityPassed = true;
