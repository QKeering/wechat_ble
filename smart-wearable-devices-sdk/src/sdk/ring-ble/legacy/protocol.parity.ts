import { LegacyRingCommand, getLegacyCommandPacket } from './commands';
import { buildLegacyCommandBytes, concatBytes, numberToUint32LE, numberToUint64LE } from './protocol';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const bytes = (input: Uint8Array) => Array.from(input);

assert(JSON.stringify(bytes(buildLegacyCommandBytes(0x12, 0x00, { frameId: 0x7a }))) === JSON.stringify([0x00, 0x7a, 0x12, 0x00, 0x00]), 'battery command should match legacy bytes');

assert(JSON.stringify(bytes(buildLegacyCommandBytes(0x31, 0x00, { frameId: 0x7b, payload: 0x1e }))) === JSON.stringify([0x00, 0x7b, 0x31, 0x00, 0x1e]), 'active measure command should match legacy bytes');

assert(JSON.stringify(bytes(buildLegacyCommandBytes(0x37, 0x00, { frameId: 0x7c, payload: numberToUint32LE(1200) }))) === JSON.stringify([0x00, 0x7c, 0x37, 0x00, 0xb0, 0x04, 0x00, 0x00]), 'collect-period write should use uint32 little-endian');

assert(JSON.stringify(bytes(buildLegacyCommandBytes(0x36, 0x00, { frameId: 0x7d, payload: numberToUint32LE(0) }))) === JSON.stringify([0x00, 0x7d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00]), 'history incremental read should use subcmd 0x00');

assert(JSON.stringify(bytes(buildLegacyCommandBytes(0x36, 0x01, { frameId: 0x7e, payload: numberToUint32LE(0) }))) === JSON.stringify([0x00, 0x7e, 0x36, 0x01, 0x00, 0x00, 0x00, 0x00]), 'history full read should use subcmd 0x01');

assert(JSON.stringify(bytes(buildLegacyCommandBytes(0x10, 0x00, { frameType: 0x01, frameId: 0x7f, payload: concatBytes(numberToUint64LE(1), new Uint8Array([0x08])) }))) === JSON.stringify([0x01, 0x7f, 0x10, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08]), 'device-time write should keep legacy frame type 0x01');

assert(getLegacyCommandPacket(LegacyRingCommand.ReadDeviceTime).cmd === 0x10, 'read-device-time command map should use cmd 0x10');
assert(getLegacyCommandPacket(LegacyRingCommand.ReadDeviceTime).subcmd === 0x01, 'read-device-time command map should use subcmd 0x01');
assert(getLegacyCommandPacket(LegacyRingCommand.UpdateDeviceTime).cmd === 0x10, 'update-device-time command map should use cmd 0x10');
assert(getLegacyCommandPacket(LegacyRingCommand.UpdateDeviceTime).subcmd === 0x00, 'update-device-time command map should use subcmd 0x00');

export const legacyProtocolParityPassed = true;
