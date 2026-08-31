import { parseLegacyRingData } from './parser';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const battery = parseLegacyRingData(new Uint8Array([0x00, 0x01, 0x12, 0x00, 101]));
assert(battery?.type === 'battery', 'battery frame should parse');
assert(battery?.status === 'charging', 'battery status should keep legacy charging code');
assert(battery?.value === '充电中', 'battery value should keep legacy display text');
assert(battery?.batteryLevel == null, 'charging status should not be mistaken for 101 percent');
assert(battery?.batteryRawValue === 101, 'battery log should preserve the raw charging code');

const normalBattery = parseLegacyRingData(new Uint8Array([0x00, 0x01, 0x12, 0x00, 55]));
assert(normalBattery?.batteryLevel === 55, 'normal battery frame should expose numeric batteryLevel');
assert(normalBattery?.value === '55%', 'normal battery frame should expose display value');

// Captured from B7 after CCCD subscription: firmware sends 0x12/0x02 without
// a preceding battery command, so it must follow the same update path as the
// explicit 0x12/0x00 response.
const pushedBattery = parseLegacyRingData(new Uint8Array([0x00, 0x00, 0x12, 0x02, 0x50]));
assert(pushedBattery?.type === 'battery', 'unsolicited battery notification should parse');
assert(pushedBattery?.batteryLevel === 80, 'unsolicited battery notification should expose batteryLevel');
assert(pushedBattery?.value === '80%', 'unsolicited battery notification should expose display value');

const pushedCharging = parseLegacyRingData(new Uint8Array([0x00, 0x00, 0x12, 0x02, 101]));
assert(pushedCharging?.status === 'charging', 'unsolicited charging notification should preserve charging status');
assert(pushedCharging?.batteryLevel == null, 'charging notification should not be treated as 101 percent');

const pushedCharged = parseLegacyRingData(new Uint8Array([0x00, 0x00, 0x12, 0x02, 102]));
assert(pushedCharged?.status === 'charged', 'unsolicited charged notification should preserve charged status');
assert(pushedCharged?.batteryLevel == null, 'charged notification should not be treated as 102 percent');

const pushedAfterCharging = parseLegacyRingData(new Uint8Array([0x00, 0x00, 0x12, 0x02, 68]));
assert(pushedAfterCharging?.status === 'normal', 'normal notification should clear the charging state');
assert(pushedAfterCharging?.batteryLevel === 68, 'normal notification should restore the actual battery percent');

const activeMeasure = parseLegacyRingData(new Uint8Array([0x00, 0x02, 0x31, 0x00, 0x01, 70, 30, 36, 0x6f, 0x0d]));
assert(activeMeasure?.type === 'active_measure', 'active measure frame should parse');
assert(activeMeasure?.status === '佩戴', 'active measure status should keep legacy display text');
assert(activeMeasure?.temperature === '34.39°C', 'active measure temperature should decode the signed int16 field');

const bloodOxygenMeasure = parseLegacyRingData(new Uint8Array([0x00, 0x03, 0x32, 0x00, 0x01, 70, 98, 0x6f, 0x0d]));
assert(bloodOxygenMeasure?.type === 'active_OxyGenMeasure', 'blood-oxygen measure frame should parse');
assert(bloodOxygenMeasure?.bloodOxygen === 98, 'blood-oxygen measure frame should expose SpO2');
assert(bloodOxygenMeasure?.temperature === '34.39°C', 'blood-oxygen temperature should decode the signed int16 field');

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
