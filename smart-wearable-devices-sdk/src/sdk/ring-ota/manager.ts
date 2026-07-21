import type {
  RingOtaOptions,
  RingOtaPartition,
  RingOtaProgressCallback,
  RingOtaResponseCodes,
  RingOtaUuids
} from './types';

export const RING_OTA_UUIDS: RingOtaUuids = {
  service: '5833FF01-9B8B-5191-6142-22A4536EF123',
  command: '5833FF02-9B8B-5191-6142-22A4536EF123',
  notify: '5833FF03-9B8B-5191-6142-22A4536EF123',
  data: '5833FF04-9B8B-5191-6142-22A4536EF123'
};

export const RING_OTA_RESPONSE_CODES: RingOtaResponseCodes = {
  partitionCountOk: '0081',
  partitionInfoOk: '0084',
  blockOk: '0087',
  partitionDone: '0085',
  allDone: '0083'
};

const DEFAULT_OPTIONS: Required<RingOtaOptions> = {
  mtu: 247,
  responseTimeoutMs: 8000,
  chunkSize: 237,
  groupSize: 16,
  writeDelayMs: 30
};

const CRC16_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400
];

export default class RingOTAManager {
  private deviceId = '';
  private currentFlashAddr = 0;
  private notifyResolver: (() => void) | null = null;
  private notifyRejecter: ((reason?: unknown) => void) | null = null;
  private expectedResponse = '';
  private responseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: Required<RingOtaOptions>;

  constructor(options: RingOtaOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  public async start(
    deviceId: string,
    hexString: string,
    onProgress: RingOtaProgressCallback = () => {}
  ): Promise<void> {
    try {
      this.deviceId = deviceId;
      onProgress(0, 'parsing firmware');

      const partitions = this.parseHexFile(hexString);
      if (partitions.length === 0) {
        throw new Error('Firmware parse failed: no valid partition');
      }

      try {
        await uni.setBLEMTU({ deviceId: this.deviceId, mtu: this.options.mtu });
      } catch (error) {
        console.warn('[RingOTA] set MTU failed, continue with default MTU.', error);
      }

      onProgress(12, 'initializing ota channel');
      await this.enableNotify();

      const countWait = this.waitForResponse(RING_OTA_RESPONSE_CODES.partitionCountOk);
      await this.sendCommand(new Uint8Array([0x01, partitions.length, 0x00]));
      await countWait;

      this.currentFlashAddr = 0;
      const totalBytes = partitions.reduce((total, partition) => total + partition.data.length, 0);
      let sentBytes = 0;

      for (let index = 0; index < partitions.length; index++) {
        const partition = partitions[index];
        const percent = 15 + Math.floor((sentBytes / totalBytes) * 80);
        onProgress(percent, `writing partition ${index + 1}/${partitions.length}`);
        await this.processPartition(index, partition, index === partitions.length - 1);
        sentBytes += partition.data.length;
      }

      onProgress(100, 'ota complete, rebooting');
      try {
        await this.sendCommand(new Uint8Array([0x04]));
      } catch (error) {
        console.warn('[RingOTA] reboot command may be interrupted by device restart.', error);
      }
    } finally {
      this.cleanNotifyPromise();
    }
  }

  public parseHexFile(hexString: string): RingOtaPartition[] {
    const lines = hexString.split(/\r?\n/);
    const partitions: RingOtaPartition[] = [];
    let currentPartition: RingOtaPartition | null = null;
    let lastExtendedAddrBase = 0;

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine.startsWith(':')) continue;

      const byteCount = Number.parseInt(cleanLine.substring(1, 3), 16);
      const addr = Number.parseInt(cleanLine.substring(3, 7), 16);
      const recordType = Number.parseInt(cleanLine.substring(7, 9), 16);
      const dataHex = cleanLine.substring(9, 9 + byteCount * 2);

      if (recordType === 0x02 || recordType === 0x04) {
        if (currentPartition) partitions.push(currentPartition);
        lastExtendedAddrBase = Number.parseInt(dataHex, 16) << 16;
        currentPartition = {
          baseAddr: lastExtendedAddrBase,
          offset: 0,
          data: new Uint8Array(0),
          firstLineAddr: -1,
          rawLines: []
        };
        continue;
      }

      if (recordType === 0x00 && currentPartition) {
        if (currentPartition.firstLineAddr === -1) {
          currentPartition.firstLineAddr = addr;
          currentPartition.offset = addr;
        }
        const newData = new Uint8Array((dataHex.match(/.{1,2}/g) || []).map((byte) => Number.parseInt(byte, 16)));
        currentPartition.rawLines.push(newData);
        currentPartition.data = concatBytes(currentPartition.data, newData);
        continue;
      }

      if (recordType === 0x01 && currentPartition) {
        partitions.push(currentPartition);
        currentPartition = null;
      }
    }

    if (currentPartition) partitions.push(currentPartition);
    return partitions;
  }

  public calculateCRC16ByLines(rawLines: Uint8Array[]): number {
    let crc = 0;
    for (const lineData of rawLines) {
      crc = this.crc16TableLookup(lineData, crc);
    }
    return crc & 0xffff;
  }

  private async processPartition(index: number, partition: RingOtaPartition, isLastPartition: boolean): Promise<void> {
    const runAddr = partition.baseAddr + partition.offset;
    let flashAddr = 0;

    if (runAddr >= 0x11000000 && runAddr <= 0x1107ffff) {
      flashAddr = runAddr;
    } else {
      flashAddr = this.currentFlashAddr;
      this.currentFlashAddr += partition.data.length + 8;
    }

    const headerBuffer = new ArrayBuffer(16);
    const view = new DataView(headerBuffer);
    view.setUint8(0, 0x02);
    view.setUint8(1, index);
    view.setUint32(2, flashAddr, true);
    view.setUint32(6, runAddr, true);
    view.setUint32(10, partition.data.length, true);
    view.setUint16(14, this.calculateCRC16ByLines(partition.rawLines), true);

    const headWait = this.waitForResponse(RING_OTA_RESPONSE_CODES.partitionInfoOk);
    await this.writeCharacteristic(RING_OTA_UUIDS.command, headerBuffer);
    await headWait;

    await this.sendPartitionData(partition.data, isLastPartition);
  }

  private async sendPartitionData(data: Uint8Array, isLastPartition: boolean): Promise<void> {
    let offset = 0;
    let packetCount = 0;

    while (offset < data.length) {
      const end = Math.min(offset + this.options.chunkSize, data.length);
      const chunk = data.slice(offset, end);
      await this.writeCharacteristic(RING_OTA_UUIDS.data, chunk.buffer as unknown as ArrayBuffer, true);
      await sleep(this.options.writeDelayMs);

      offset += chunk.length;
      packetCount++;

      const isPartitionEnd = offset >= data.length;
      const isGroupEnd = packetCount % this.options.groupSize === 0;
      if (!isPartitionEnd && !isGroupEnd) continue;

      const expected = isPartitionEnd
        ? isLastPartition
          ? RING_OTA_RESPONSE_CODES.allDone
          : RING_OTA_RESPONSE_CODES.partitionDone
        : RING_OTA_RESPONSE_CODES.blockOk;
      await this.waitForResponse(expected);
    }
  }

  private enableNotify(): Promise<void> {
    return new Promise((resolve, reject) => {
      uni.notifyBLECharacteristicValueChange({
        state: true,
        deviceId: this.deviceId,
        serviceId: RING_OTA_UUIDS.service,
        characteristicId: RING_OTA_UUIDS.notify,
        success: () => {
          uni.onBLECharacteristicValueChange((res) => {
            if (res.deviceId !== this.deviceId) return;

            const cleanHex = arrayBufferToHex(res.value as unknown as ArrayBuffer).toUpperCase();
            if (cleanHex.length >= 2 && !cleanHex.startsWith('00')) {
              const descriptions: Record<string, string> = {
                '66': 'CRC check failed',
                '67': 'invalid data length',
                '68': 'flash write failed',
                '6887': 'data write too fast'
              };
              const message = `OTA device error ${cleanHex}: ${descriptions[cleanHex] || 'unknown error'}`;
              this.notifyRejecter?.(new Error(message));
              this.cleanNotifyPromise();
              return;
            }

            if (this.notifyResolver && this.expectedResponse && cleanHex.includes(this.expectedResponse)) {
              this.notifyResolver();
              this.cleanNotifyPromise();
            }
          });
          resolve();
        },
        fail: (err) => reject(new Error(`Enable OTA notify failed: ${err.errMsg}`))
      });
    });
  }

  private waitForResponse(hexCode: string): Promise<void> {
    this.cleanNotifyPromise();
    return new Promise((resolve, reject) => {
      this.expectedResponse = hexCode;
      this.notifyResolver = resolve;
      this.notifyRejecter = reject;
      this.responseTimer = setTimeout(() => {
        this.cleanNotifyPromise();
        reject(new Error(`OTA response timeout: expected ${hexCode}`));
      }, this.options.responseTimeoutMs);
    });
  }

  private cleanNotifyPromise(): void {
    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
    this.notifyResolver = null;
    this.notifyRejecter = null;
    this.expectedResponse = '';
  }

  private async sendCommand(data: Uint8Array): Promise<void> {
    await this.writeCharacteristic(RING_OTA_UUIDS.command, data.buffer as ArrayBuffer);
  }

  private writeCharacteristic(characteristicId: string, buffer: ArrayBuffer, noResponse = false): Promise<void> {
    return new Promise((resolve, reject) => {
      uni.writeBLECharacteristicValue({
        deviceId: this.deviceId,
        serviceId: RING_OTA_UUIDS.service,
        characteristicId,
        value: buffer as unknown as any[],
        writeType: noResponse ? 'writeNoResponse' : 'write',
        success: () => resolve(),
        fail: (err) => reject(new Error(`OTA write failed: ${err.errMsg}`))
      });
    });
  }

  private crc16TableLookup(data: Uint8Array, seed: number): number {
    let crc = seed;
    for (let index = 0; index < data.length; index++) {
      crc = this.crc16Byte(crc, data[index]);
    }
    return crc;
  }

  private crc16Byte(crc: number, byte: number): number {
    let temp = CRC16_TABLE[crc & 0xf];
    crc = (crc >>> 4) & 0x0fff;
    crc = crc ^ temp ^ CRC16_TABLE[byte & 0xf];

    temp = CRC16_TABLE[crc & 0xf];
    crc = (crc >>> 4) & 0x0fff;
    crc = crc ^ temp ^ CRC16_TABLE[(byte >>> 4) & 0xf];

    return crc & 0xffff;
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left);
  merged.set(right, left.length);
  return merged;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map.call(new Uint8Array(buffer), (byte: number) => byte.toString(16).padStart(2, '0')).join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
