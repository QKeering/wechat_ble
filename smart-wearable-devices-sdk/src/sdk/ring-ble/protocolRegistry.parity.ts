import { parseQkeerV2AdvertisInfo, parseRwAdvertisInfo, registerRingProtocolDetector, resolveRingProtocol } from './protocolRegistry';

if (resolveRingProtocol({ name: 'HR-1234' }) !== 'legacy') {
  throw new Error('Legacy HR prefix should resolve to legacy protocol.');
}

if (resolveRingProtocol({ name: 'HR-1234', advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB'] }) !== 'legacy') {
  throw new Error('Legacy HR prefix should not be stolen by RW 180D fallback detection.');
}

if (resolveRingProtocol({ name: 'HR18N', advertisData: 'F802002105B0' }) !== 'rw') {
  throw new Error('RW HR device with F802 manufacturer data should resolve to rw protocol.');
}

if (resolveRingProtocol({ name: 'RW_RING', advertisData: 'F802002105B0' }) !== 'rw') {
  throw new Error('RW device with F802 manufacturer data should resolve to rw protocol regardless of name prefix.');
}

if (resolveRingProtocol({ name: 'SY03' }) !== 'rw') {
  throw new Error('SY03 should resolve to rw protocol.');
}

if (resolveRingProtocol({ name: 'BH3' }) !== 'rw') {
  throw new Error('BH3 should resolve to rw protocol.');
}

if (resolveRingProtocol({ advertisData: '0502008100523E000000051B8043443330336530303031' }) !== 'rw') {
  throw new Error('RW advertis data containing 3E000000 MAC prefix should resolve to rw protocol.');
}

if (resolveRingProtocol({ name: 'BH3', advertisData: 'D6060200810052351000001191804344433303353130303030' }) !== 'rw') {
  throw new Error('Named BH3 advertis data should resolve to the RW ring protocol path.');
}

if (resolveRingProtocol({ advertisData: 'D6060200810052351000001191804344433303353130303030' }) !== 'rw') {
  throw new Error('Unnamed RW advertis-only data should still resolve to rw protocol.');
}

if (resolveRingProtocol({ advertisData: 'F811002105B0' }) !== 'rw') {
  throw new Error('RW device with F811 manufacturer data should resolve to rw protocol even when name is empty.');
}

if (resolveRingProtocol({ advertisData: [0xf8, 0x11, 0x00, 0x21, 0x05, 0xb0] }) !== 'rw') {
  throw new Error('RW device with array manufacturer data should resolve to rw protocol even when name is empty.');
}

if (resolveRingProtocol({ name: 'HR18N', advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB'] }) !== 'rw') {
  throw new Error('RW-like HR device with heart-rate service marker should resolve to rw protocol.');
}

if (resolveRingProtocol({ name: 'Unknown Ring' }) !== 'legacy') {
  throw new Error('Unknown ring should default to legacy until a second-protocol detector is configured.');
}

if (resolveRingProtocol({ name: 'MUSLEEP_RING_001' }) !== 'qkeer-v2') {
  throw new Error('QKeer V2 MUSLEEP_RING prefix should resolve to qkeer-v2.');
}

if (resolveRingProtocol({ advertisServiceUUIDs: ['0000F618-0000-1000-8000-00805F9B34FB'] }) !== 'qkeer-v2') {
  throw new Error('QKeer V2 F618 advertised service should resolve to qkeer-v2.');
}

const qkeerAdvertis = parseQkeerV2AdvertisInfo({
  advertisData: '0000010166020BB7AABBCC',
  advertisServiceUUIDs: ['0000F618-0000-1000-8000-00805F9B34FB']
});

if (
  qkeerAdvertis?.protocolVersion !== 1 ||
  qkeerAdvertis.batteryLevel !== 2 ||
  qkeerAdvertis.isCharging !== 1 ||
  qkeerAdvertis.macInfo !== '02:0B:B7:AA:BB:CC'
) {
  throw new Error(`QKeer V2 advertis parser should expose vendor connection metadata: ${JSON.stringify(qkeerAdvertis)}`);
}

const rwSy03Advertis = parseRwAdvertisInfo({
  advertisData: 'D60602008100523E000000051B8043443330336530303031'
});
const rwBh3Advertis = parseRwAdvertisInfo({
  advertisData: 'D6060200810052351000001191804344433303353130303030'
});

if (rwSy03Advertis?.macInfo !== '3E:00:00:00:05:1B' || rwBh3Advertis?.macInfo !== '35:10:00:00:11:91') {
  throw new Error(`RW advertis parser should expose stable MAC metadata: ${JSON.stringify({ rwSy03Advertis, rwBh3Advertis })}`);
}

if (resolveRingProtocol({ protocol: 'qkeer-v2', name: 'HR-1234' }) !== 'qkeer-v2') {
  throw new Error('Explicit protocol should override detector rules.');
}

registerRingProtocolDetector({
  protocol: 'qkeer-v2',
  namePrefixes: ['QKV2'],
  productIds: ['QK-V2']
});

if (resolveRingProtocol({ name: 'QKV2-ABC' }) !== 'qkeer-v2') {
  throw new Error('Registered QKeer V2 name prefix should resolve to qkeer-v2.');
}

if (resolveRingProtocol({ productId: 'qk-v2' }) !== 'qkeer-v2') {
  throw new Error('Registered QKeer V2 productId should resolve to qkeer-v2.');
}

export const ringProtocolRegistryParityPassed = true;
