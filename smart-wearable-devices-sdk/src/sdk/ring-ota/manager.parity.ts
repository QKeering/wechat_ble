import RingOTAManager, { RING_OTA_RESPONSE_CODES, RING_OTA_UUIDS } from './manager';

const manager = new RingOTAManager();
const partitions = manager.parseHexFile(':020000041100EA\n:0400000001020304F2\n:00000001FF');

if (partitions.length !== 1) {
  throw new Error(`Expected 1 OTA partition, got ${partitions.length}`);
}

const [partition] = partitions;

if (partition.baseAddr !== 0x11000000) {
  throw new Error(`Unexpected OTA baseAddr: ${partition.baseAddr.toString(16)}`);
}

if (partition.data.length !== 4 || partition.data[0] !== 0x01 || partition.data[3] !== 0x04) {
  throw new Error(`Unexpected OTA data bytes: ${Array.from(partition.data).join(',')}`);
}

if (typeof manager.calculateCRC16ByLines(partition.rawLines) !== 'number') {
  throw new Error('OTA CRC calculation did not return a number');
}

if (RING_OTA_UUIDS.service !== '5833FF01-9B8B-5191-6142-22A4536EF123') {
  throw new Error('OTA service UUID changed');
}

if (RING_OTA_RESPONSE_CODES.partitionCountOk !== '0081') {
  throw new Error('OTA partition-count response code changed');
}

export const ringOtaManagerParityPassed = true;

