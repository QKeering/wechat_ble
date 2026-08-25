import { parseQkeerV2AdvertisInfo, parseRwAdvertisInfo, registerRingProtocolDetector, resolveRingProtocol } from './protocolRegistry';

if (resolveRingProtocol({ name: 'HR-1234' }) !== 'legacy') {
  throw new Error('Legacy HR prefix should resolve to legacy protocol.');
}

if (resolveRingProtocol({ name: 'HR-1234', advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB'] }) !== 'legacy') {
  throw new Error('Legacy HR prefix should not be stolen by RW 180D fallback detection.');
}

if (resolveRingProtocol({ name: 'HR18N', advertisData: 'F802002105B0' }) !== 'legacy') {
  throw new Error('F802 manufacturer data must not route an HR/L19 device into the RW protocol.');
}

if (resolveRingProtocol({ name: 'RW_RING', advertisData: 'F802002105B0' }) !== 'legacy') {
  throw new Error('Manufacturer data alone must not route an unknown device into the RW protocol.');
}

if (resolveRingProtocol({ name: 'SY03' }) !== 'rw') {
  throw new Error('SY03 should resolve to rw protocol.');
}

if (resolveRingProtocol({ name: 'BH3' }) !== 'rw') {
  throw new Error('BH3 should resolve to rw protocol.');
}

if (resolveRingProtocol({ advertisData: '0502008100523E000000051B8043443330336530303031' }) !== 'legacy') {
  throw new Error('An RW-like MAC marker without an SY/BH3 identity must remain on the legacy path.');
}

if (resolveRingProtocol({ name: 'BH3', advertisData: 'D6060200810052351000001191804344433303353130303030' }) !== 'rw') {
  throw new Error('Named BH3 advertis data should resolve to the RW ring protocol path.');
}

if (resolveRingProtocol({ advertisData: 'D6060200810052351000001191804344433303353130303030' }) !== 'legacy') {
  throw new Error('Unnamed advertis-only data must remain legacy until an SY/BH3 identity is known.');
}

if (resolveRingProtocol({ advertisData: 'F811002105B0' }) !== 'legacy') {
  throw new Error('F811 manufacturer data alone must not route a device into the RW protocol.');
}

if (resolveRingProtocol({ advertisData: [0xf8, 0x11, 0x00, 0x21, 0x05, 0xb0] }) !== 'legacy') {
  throw new Error('Array manufacturer data alone must not route a device into the RW protocol.');
}

if (resolveRingProtocol({ name: 'HR18N', advertisServiceUUIDs: ['0000180D-0000-1000-8000-00805F9B34FB'] }) !== 'legacy') {
  throw new Error('The shared heart-rate service marker must not route an HR/L19 device into RW.');
}

if (resolveRingProtocol({ name: 'Unknown Ring' }) !== 'legacy') {
  throw new Error('Unknown ring should default to legacy until a second-protocol detector is configured.');
}

if (resolveRingProtocol({ name: 'MUSLEEP_RING_001' }) !== 'legacy') {
  throw new Error('An unregistered QKeer V2 prefix should remain on the legacy path.');
}

if (resolveRingProtocol({ advertisServiceUUIDs: ['0000F618-0000-1000-8000-00805F9B34FB'] }) !== 'legacy') {
  throw new Error('An unregistered F618 service marker should remain on the legacy path.');
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

if (resolveRingProtocol({ protocol: 'qkeer-v2', name: 'HR-1234' }) !== 'legacy') {
  throw new Error('An unregistered protocol hint must not override the active detector rules.');
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
