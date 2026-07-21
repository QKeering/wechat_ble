import { getLegacyCommandPacket, LegacyRingCommand } from './commands';

export type LegacyCommandPayload = number | number[] | Uint8Array;

export interface BuildLegacyCommandOptions {
  frameType?: number;
  frameId?: number;
  payload?: LegacyCommandPayload;
}

const normalizePayload = (payload?: LegacyCommandPayload) => {
  if (payload === undefined) return new Uint8Array([0x00]);
  if (payload instanceof Uint8Array) return payload;
  if (Array.isArray(payload)) return new Uint8Array(payload);

  return new Uint8Array([payload]);
};

export const createLegacyFrameId = () => Math.floor(Math.random() * 0xff) & 0xff;

export const buildLegacyCommandBytes = (cmd: number, subcmd: number, options: BuildLegacyCommandOptions = {}) => {
  const frameType = options.frameType ?? 0x00;
  const frameId = options.frameId ?? createLegacyFrameId();
  const payload = normalizePayload(options.payload);
  const header = new Uint8Array([frameType, frameId, cmd, subcmd]);
  const commandBytes = new Uint8Array(header.length + payload.length);

  commandBytes.set(header);
  commandBytes.set(payload, header.length);

  return commandBytes;
};

export const buildLegacyCommandByName = (command: LegacyRingCommand, options: BuildLegacyCommandOptions = {}) => {
  const packet = getLegacyCommandPacket(command);
  return buildLegacyCommandBytes(packet.cmd, packet.subcmd, {
    ...options,
    payload: options.payload ?? packet.payload
  });
};

export const numberToUint32LE = (value: number) => {
  const bytes = new Uint8Array(4);
  bytes[0] = value & 0xff;
  bytes[1] = (value >> 8) & 0xff;
  bytes[2] = (value >> 16) & 0xff;
  bytes[3] = (value >> 24) & 0xff;
  return bytes;
};

export const numberToUint64LE = (value: number | bigint) => {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(value), true);
  return bytes;
};

export const concatBytes = (...chunks: Uint8Array[]) => {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
};

export const getLegacyPlatformType = () => {
  const platform = `${uni.getSystemInfoSync().platform || ''}`.toLowerCase();
  if (platform.includes('ios')) return 0x01;
  if (platform.includes('harmony')) return 0x02;
  if (platform.includes('windows')) return 0x03;
  return 0x00;
};

export const getTodayZeroTimestamp = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
};

export const toHexString = (bytes: Uint8Array) => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
};
