export const RW_SERVICE_UUIDS = [
  '0000b00b-0000-1000-8000-00805f9b34fb',
  '0000a00a-0000-1000-8000-00805f9b34fb'
];

export const RW_NOTIFY_CHAR_UUID = '0000b003-0000-1000-8000-00805f9b34fb';
export const RW_WRITE_CHAR_UUID = '0000b002-0000-1000-8000-00805f9b34fb';
export const RW_CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';

export const RW_SCAN_NAME_PREFIXES = ['HR', 'SY', 'BH', 'RW', 'QK'];
export const RW_SCAN_SERVICE_MARKERS = ['180D'];
export const RW_MANUFACTURER_MARKERS = ['F802', 'F811'];

export const RW_FRAME_TYPE = 0x00;

export enum RwCommand {
  Time = 0x10,
  FileSystem = 0x36
}

export enum RwKey {
  Time = 0x0201,
  TimeZone = 0x0202,
  Battery = 0x0203,
  FirmwareVersion = 0x0204,
  UserProfile = 0x0206,
  TimeFormat = 0x020e,
  HrMonitoring = 0x0216,
  TemperatureDetecting = 0x021b,
  AppFunctionV2 = 0x0263,
  AppVideoHid = 0x0264,
  AppLedLevel = 0x0266,
  AppRingWearHand = 0x0268,
  Spo2Monitoring = 0x0225,
  HrvMonitoring = 0x026a,
  StressMonitoring = 0x026b,
  BloodSugarMonitoring = 0x026e,
  BloodPressureMonitoring = 0x027c,
  TemperatureMonitoring = 0x027d,
  RawSleep = 0x02fe,
  HeartRate = 0x0503,
  Activity = 0x0502,
  BloodPressure = 0x0504,
  Sleep = 0x0505,
  Temperature = 0x0508,
  BloodOxygen = 0x0509,
  Hrv = 0x050a,
  Stress = 0x050d,
  BloodSugar = 0x0510,
  ActivityCurrentDay = 0x051a,
  AppDataControl = 0x0609,
  AppRealTimeHeartRate = 0x0224,
  AppRealTimeBloodPressure = 0x0231,
  AppRealTimeTemperature = 0x0230,
  AppRealTimeBloodOxygen = 0x024e,
  AppRealTimeStress = 0x024f,
  AppRealTimeHrv = 0x0269,
  AppRealTimeBloodSugar = 0x026c,
  AppLoginBind = 0x0302
}

export enum RwHealthDataControlKey {
  HeartRate = 0x03,
  BloodPressure = 0x04,
  Temperature = 0x08,
  BloodOxygen = 0x09,
  Hrv = 0x0a,
  Stress = 0x0d,
  BloodSugar = 0x10
}

export enum RwKeyFlag {
  Update = 0x00,
  Read = 0x10,
  ReadContinue = 0x11,
  Create = 0x20,
  Delete = 0x30
}

export enum RwTimeSubcommand {
  Sync = 0x00,
  Read = 0x01
}

export enum RwFileSystemSubcommand {
  ReadFileList = 0x10,
  Format = 0x13,
  RequestUpload = 0x1a,
  UploadFile = 0x1b,
  UploadProgress = 0x1c,
  LastPackageProgress = 0x1d
}

export enum RwQkeerV2HistoryCommand {
  Sleep = 0x03,
  SleepList = 0x31,
  HealthList = 0x41,
  LastData = 0x70,
  StepList = 0x71,
  EnhanceSleepRead = 0x73
}

export interface RwFrame {
  frameType: number;
  frameId: number;
  cmd: number;
  subcmd: number;
  data: Uint8Array;
  raw: Uint8Array;
}

let frameId = 0x01;

export const nextRwFrameId = () => {
  const next = frameId & 0xff;
  frameId = (frameId + 1) & 0xff;
  if (frameId === 0) frameId = 1;
  return next;
};

export const buildRwFrameWithType = (
  frameType: number,
  cmd: number,
  subcmd: number,
  data: Uint8Array = new Uint8Array(),
  id = nextRwFrameId()
) => {
  const bytes = new Uint8Array(4 + data.length);
  bytes[0] = frameType & 0xff;
  bytes[1] = id & 0xff;
  bytes[2] = cmd & 0xff;
  bytes[3] = subcmd & 0xff;
  bytes.set(data, 4);
  return bytes;
};

export const buildRwFrame = (cmd: number, subcmd: number, data: Uint8Array = new Uint8Array(), id = nextRwFrameId()) => {
  return buildRwFrameWithType(RW_FRAME_TYPE, cmd, subcmd, data, id);
};

export const parseRwFrame = (bytes: Uint8Array): RwFrame | null => {
  if (bytes.length < 4) return null;
  return {
    frameType: bytes[0],
    frameId: bytes[1],
    cmd: bytes[2],
    subcmd: bytes[3],
    data: bytes.slice(4),
    raw: bytes
  };
};

export const buildRwSyncTimeCommand = (timestampMs = Date.now(), timezone = 8) => {
  const data = new Uint8Array(9);
  writeUint64LE(data, 0, timestampMs);
  data[8] = timezone & 0xff;
  return buildRwFrame(RwCommand.Time, RwTimeSubcommand.Sync, data);
};

export const buildRwLegacyCompatSyncTimeCommand = (timestampMs = Date.now(), timezone = 8) => {
  const data = new Uint8Array(9);
  writeUint64LE(data, 0, timestampMs);
  data[8] = timezone & 0xff;
  return buildRwFrameWithType(0x01, RwCommand.Time, RwTimeSubcommand.Sync, data);
};

export const buildRwReadTimeCommand = () => buildRwFrame(RwCommand.Time, RwTimeSubcommand.Read);

export const buildRwSetDateTimeKeyCommand = (timestampMs = Date.now()) => {
  const date = new Date(timestampMs);
  const payload = new Uint8Array([
    RwKey.Time >> 8,
    RwKey.Time & 0xff,
    RwKeyFlag.Update,
    clampByte(date.getFullYear() - 2000),
    clampByte(date.getMonth() + 1),
    clampByte(date.getDate()),
    clampByte(date.getHours()),
    clampByte(date.getMinutes()),
    clampByte(date.getSeconds())
  ]);
  return buildRwKeyCommand(payload);
};

export const buildRwSetTimeZoneKeyCommand = (timezone = getLocalRwTimezoneHours(), daylightSaving = 0x02) => {
  const payload = new Uint8Array([
    RwKey.TimeZone >> 8,
    RwKey.TimeZone & 0xff,
    RwKeyFlag.Update,
    normalizeRwTimezoneQuarterHours(timezone) & 0xff,
    clampByte(daylightSaving)
  ]);
  return buildRwKeyCommand(payload);
};

export const buildRwSetTimeFormatKeyCommand = (use24Hour = true) => {
  const payload = new Uint8Array([
    RwKey.TimeFormat >> 8,
    RwKey.TimeFormat & 0xff,
    RwKeyFlag.Update,
    use24Hour ? 1 : 0
  ]);
  return buildRwKeyCommand(payload);
};

export const buildRwReadDateTimeKeyCommand = () => buildRwReadKeyCommand(RwKey.Time);

export const buildRwLoginBindCommand = () => {
  return buildRwKeyCommand(new Uint8Array([RwKey.AppLoginBind >> 8, RwKey.AppLoginBind & 0xff, RwKeyFlag.Create]));
};

export const buildRwReadFunctionV2Command = () => buildRwReadKeyCommand(RwKey.AppFunctionV2);

export const buildRwReadLedLevelCommand = () => buildRwReadKeyCommand(RwKey.AppLedLevel);

export const buildRwReadVideoHidCommand = () => buildRwReadKeyCommand(RwKey.AppVideoHid);

export const buildRwReadRingWearHandCommand = () => buildRwReadKeyCommand(RwKey.AppRingWearHand);

export const buildRwReadFileListCommand = () => buildRwFrame(RwCommand.FileSystem, RwFileSystemSubcommand.ReadFileList);

export const buildRwReadLocalDataCommand = (sinceTimestamp = 0, readAll = false) => {
  const payload = new Uint8Array(4);
  writeUint32LE(payload, 0, sinceTimestamp);
  return buildRwFrame(RwCommand.FileSystem, readAll ? 0x01 : 0x00, payload);
};

export const buildRwQkeerV2HistoryListCommand = (
  cmd: RwQkeerV2HistoryCommand,
  startTimestamp = 0,
  endTimestamp = Math.floor(Date.now() / 1000),
  deviceType = 0x00,
  protocolVersion = 0x01
) => {
  const payload = new Uint8Array(8);
  writeUint32LE(payload, 0, startTimestamp);
  writeUint32LE(payload, 4, endTimestamp);
  return buildRwQkeerV2Packet(cmd, payload, { deviceType, protocolVersion });
};

export const buildRwQkeerV2LastDataCommand = (
  deviceType = 0x00,
  protocolVersion = 0x01
) => buildRwQkeerV2Packet(RwQkeerV2HistoryCommand.LastData, new Uint8Array([0x00]), { deviceType, protocolVersion });

export const buildRwFormatFileSystemCommand = () => buildRwFrame(RwCommand.FileSystem, RwFileSystemSubcommand.Format);

export const buildRwRequestUploadCommand = (fileSeq: number) => {
  return buildRwFrame(RwCommand.FileSystem, RwFileSystemSubcommand.RequestUpload, new Uint8Array([fileSeq & 0xff]));
};

export const buildRwReadKeyCommand = (key: RwKey) => {
  return buildRwKeyCommand(new Uint8Array([key >> 8, key & 0xff, RwKeyFlag.Read]));
};

export const buildRwReadContinueKeyCommand = (key: RwKey) => {
  return buildRwKeyCommand(new Uint8Array([key >> 8, key & 0xff, RwKeyFlag.ReadContinue]));
};

export const buildRwKeyCommandWithoutChecksum = (payload: Uint8Array) => {
  const bytes = new Uint8Array(4 + payload.length);
  bytes[0] = 0xab;
  bytes[1] = 0x01;
  bytes[2] = (payload.length >> 8) & 0xff;
  bytes[3] = payload.length & 0xff;
  bytes.set(payload, 4);
  return bytes;
};

export const buildRwReadKeyCommandWithoutChecksum = (key: RwKey) => {
  return buildRwKeyCommandWithoutChecksum(new Uint8Array([key >> 8, key & 0xff, RwKeyFlag.Read]));
};

export const buildRwReadContinueKeyCommandWithoutChecksum = (key: RwKey) => {
  return buildRwKeyCommandWithoutChecksum(new Uint8Array([key >> 8, key & 0xff, RwKeyFlag.ReadContinue]));
};

export const buildRwReadBatteryCommand = () => buildRwReadKeyCommandWithoutChecksum(RwKey.Battery);

export const buildRwReadFirmwareVersionCommand = () => buildRwReadKeyCommandWithoutChecksum(RwKey.FirmwareVersion);

export const buildRwBatteryCommandVariants = () => [
  { label: 'ab-no-crc', bytes: buildRwReadBatteryCommand() },
  { label: 'ab-no-crc-read-continue', bytes: buildRwReadContinueKeyCommandWithoutChecksum(RwKey.Battery) },
  { label: 'app-sdk-ab-crc-read', bytes: buildRwReadKeyCommand(RwKey.Battery) },
  { label: 'app-sdk-ab-crc-read-continue', bytes: buildRwReadContinueKeyCommand(RwKey.Battery) },
  { label: 'legacy-l19', bytes: buildRwFrame(0x12, 0x00, new Uint8Array([0x00])) },
  { label: 'c6-pdf', bytes: hexToBytes('c60100034045020310') },
  { label: 'c6-pdf-read-continue', bytes: hexToBytes('c60100034045020311') },
  { label: 'c6-key-le', bytes: hexToBytes('c60100034045030210') },
  { label: 'c6-key-le-read-continue', bytes: hexToBytes('c60100034045030211') },
  { label: 'c6-no-crc', bytes: hexToBytes('c6010003020310') },
  { label: 'c6-no-crc-read-continue', bytes: hexToBytes('c6010003020311') },
  { label: 'mini-key', bytes: buildRwFrame(0x03, 0x10, new Uint8Array([0x02, 0x03])) },
  { label: 'mini-key-read-continue', bytes: buildRwFrame(0x03, 0x11, new Uint8Array([0x02, 0x03])) },
  { label: 'mini-key-le', bytes: buildRwFrame(0x03, 0x10, new Uint8Array([0x03, 0x02])) },
  { label: 'mini-key-le-read-continue', bytes: buildRwFrame(0x03, 0x11, new Uint8Array([0x03, 0x02])) },
  { label: 'ab-no-crc-key-le', bytes: hexToBytes('ab010003030210') },
  { label: 'ab-no-crc-key-le-read-continue', bytes: hexToBytes('ab010003030211') }
];

export type RwFirmwareVersionTarget = 'hardwareVersion' | 'softwareVersion';

export const buildRwFirmwareVersionCommandVariants = (target: RwFirmwareVersionTarget = 'hardwareVersion') => [
  { label: 'ab-no-crc', bytes: buildRwReadFirmwareVersionCommand() },
  { label: 'ab-no-crc-read-continue', bytes: buildRwReadContinueKeyCommandWithoutChecksum(RwKey.FirmwareVersion) },
  { label: 'app-sdk-ab-crc-read', bytes: buildRwReadKeyCommand(RwKey.FirmwareVersion) },
  { label: 'app-sdk-ab-crc-read-continue', bytes: buildRwReadContinueKeyCommand(RwKey.FirmwareVersion) },
  {
    label: target === 'softwareVersion' ? 'legacy-l19-software' : 'legacy-l19-hardware',
    bytes: buildRwFrame(0x11, target === 'softwareVersion' ? 0x00 : 0x01, new Uint8Array([0x00]))
  },
  { label: 'c6-pdf', bytes: hexToBytes('c60100034045020410') },
  { label: 'c6-pdf-read-continue', bytes: hexToBytes('c60100034045020411') },
  { label: 'c6-key-le', bytes: hexToBytes('c60100034045040210') },
  { label: 'c6-key-le-read-continue', bytes: hexToBytes('c60100034045040211') },
  { label: 'c6-no-crc', bytes: hexToBytes('c6010003020410') },
  { label: 'c6-no-crc-read-continue', bytes: hexToBytes('c6010003020411') }
];

export interface RwUserProfile {
  measureUnit?: number;
  gender: number;
  age: number;
  height: number;
  weight: number;
  stepGoal?: number;
}

export interface RwHealthMonitoringConfig {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  interval: number;
}

export interface RwBodyTemperatureDetectingConfig {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  duration: number;
  repeatModel?: number[];
}

export type RwChecksumProvider = (payload: Uint8Array) => number;

export const buildRwReadHealthMonitoringCommand = (key: RwKey) => {
  if (!isRwMonitoringKey(key)) throw new Error(`RW read health monitoring command is not supported for key 0x${key.toString(16)}.`);
  return buildRwReadKeyCommand(key);
};

export const buildRwReadHealthDataCommand = (key: RwKey) => {
  if (!isRwHealthDataKey(key)) throw new Error(`RW read health data command is not supported for key 0x${key.toString(16)}.`);
  return buildRwReadKeyCommand(key);
};

export const buildRwDeleteHealthDataCommand = (key: RwKey) => {
  if (!isRwHealthDataKey(key)) throw new Error(`RW delete health data command is not supported for key 0x${key.toString(16)}.`);
  return buildRwKeyCommand(new Uint8Array([key >> 8, key & 0xff, RwKeyFlag.Delete]));
};

export const buildRwControlHealthDataCommand = (dataKey: RwKey | RwHealthDataControlKey, enabled = true) => {
  const controlKey = toRwHealthDataControlKey(dataKey);
  if (!isRwHealthDataControlKey(controlKey)) {
    throw new Error(`RW health-data control command is not supported for key 0x${dataKey.toString(16)}.`);
  }
  const payload = new Uint8Array([
    RwKey.AppDataControl >> 8,
    RwKey.AppDataControl & 0xff,
    RwKeyFlag.Update,
    controlKey,
    0x05,
    enabled ? 1 : 0
  ]);
  return buildRwKeyCommand(payload);
};

export const buildRwSetHealthMonitoringCommand = (
  key: RwKey,
  config: RwHealthMonitoringConfig,
  checksumProvider?: RwChecksumProvider
) => {
  assertRwWritableKey(key);
  const payload = new Uint8Array([
    key >> 8,
    key & 0xff,
    RwKeyFlag.Update,
    config.enabled ? 1 : 0,
    clampByte(config.startHour),
    clampByte(config.startMinute),
    clampByte(config.endHour),
    clampByte(config.endMinute),
    clampByte(config.interval)
  ]);
  return buildRwKeyCommand(payload, checksumProvider);
};

const buildRwBodyTemperatureDetectingFlags = (enabled: boolean, repeatModel?: number[]) => {
  const repeat = repeatModel && repeatModel.length >= 7 ? repeatModel : [1, 1, 1, 1, 1, 1, 1];
  const bits = [
    enabled ? 1 : 0,
    repeat[0] ? 1 : 0,
    repeat[6] ? 1 : 0,
    repeat[5] ? 1 : 0,
    repeat[4] ? 1 : 0,
    repeat[3] ? 1 : 0,
    repeat[2] ? 1 : 0,
    repeat[1] ? 1 : 0
  ];
  return parseInt(bits.join(''), 2) & 0xff;
};

export const buildRwSetBodyTemperatureDetectingCommand = (
  config: RwBodyTemperatureDetectingConfig,
  checksumProvider?: RwChecksumProvider
) => {
  const payload = new Uint8Array([
    RwKey.TemperatureDetecting >> 8,
    RwKey.TemperatureDetecting & 0xff,
    RwKeyFlag.Update,
    buildRwBodyTemperatureDetectingFlags(config.enabled, config.repeatModel),
    clampByte(config.startHour),
    clampByte(config.startMinute),
    clampByte(config.endHour),
    clampByte(config.endMinute),
    clampByte(config.duration)
  ]);
  return buildRwKeyCommand(payload, checksumProvider);
};

export const buildRwSetUserProfileCommand = (profile: RwUserProfile, checksumProvider?: RwChecksumProvider) => {
  const payload = new Uint8Array(14);
  payload[0] = RwKey.UserProfile >> 8;
  payload[1] = RwKey.UserProfile & 0xff;
  payload[2] = RwKeyFlag.Update;
  payload[3] = clampByte(profile.measureUnit ?? 0);
  payload[4] = profile.gender === 1 ? 1 : 0;
  payload[5] = clampByte(profile.age);
  writeFloat32LE(payload, 6, profile.height);
  writeFloat32LE(payload, 10, profile.weight);
  return buildRwKeyCommand(payload, checksumProvider);
};

export const buildRwKeyCommand = (payload: Uint8Array, checksumProvider?: RwChecksumProvider) => {
  const bytes = new Uint8Array(6 + payload.length);
  bytes[0] = 0xab;
  bytes[1] = 0x01;
  bytes[2] = (payload.length >> 8) & 0xff;
  bytes[3] = payload.length & 0xff;
  const checksum = (checksumProvider?.(payload) ?? rwCrc16X26(payload)) & 0xffff;
  bytes[4] = checksum >> 8;
  bytes[5] = checksum & 0xff;
  bytes.set(payload, 6);
  return bytes;
};

export const buildRwKeyResponseCommand = (payload: Uint8Array, checksumProvider?: RwChecksumProvider) => {
  const bytes = new Uint8Array(6 + payload.length);
  bytes[0] = 0xab;
  bytes[1] = 0x11;
  bytes[2] = (payload.length >> 8) & 0xff;
  bytes[3] = payload.length & 0xff;
  const checksum = (checksumProvider?.(payload) ?? rwCrc16X26(payload)) & 0xffff;
  bytes[4] = checksum >> 8;
  bytes[5] = checksum & 0xff;
  bytes.set(payload, 6);
  return bytes;
};

export const buildRwAppDataControlAckCommand = () => {
  return buildRwKeyResponseCommand(new Uint8Array([
    RwKey.AppDataControl >> 8,
    RwKey.AppDataControl & 0xff,
    RwKeyFlag.Update,
    0x00
  ]));
};

export const buildRwQkeerV2Packet = (
  cmd: number,
  payload: Uint8Array = new Uint8Array(),
  options: { deviceType?: number; protocolVersion?: number; packetIndex?: number; packetCount?: number } = {}
) => {
  const deviceType = options.deviceType ?? 0x00;
  const protocolVersion = options.protocolVersion ?? 0x01;
  const packetIndex = options.packetIndex ?? 0;
  const packetCount = options.packetCount ?? 1;
  const dataInfoLength = 1 + payload.length;
  const contentLength = 1 + 4 + 4 + 1 + 1 + payload.length;
  const content = new Uint8Array(contentLength);
  content[0] = protocolVersion & 0xff;
  writeUint32LE(content, 1, packetCount);
  writeUint32LE(content, 5, packetIndex);
  content[9] = dataInfoLength & 0xff;
  content[10] = cmd & 0xff;
  content.set(payload, 11);

  const bytes = new Uint8Array(1 + content.length + 1);
  bytes[0] = deviceType & 0xff;
  bytes.set(content, 1);
  bytes[bytes.length - 1] = checksum8Invert(content);
  return bytes;
};

export interface RwKeyFrame {
  packetType: number;
  op: number;
  length: number;
  checksum: number;
  key: number;
  flag: number;
  data: Uint8Array;
  raw: Uint8Array;
}

export const parseRwKeyFrame = (bytes: Uint8Array): RwKeyFrame | null => {
  if (bytes.length < 9 || (bytes[0] !== 0xc6 && bytes[0] !== 0xab)) return null;
  const length = bytes[0] === 0xab ? (((bytes[2] || 0) << 8) | (bytes[3] || 0)) : (bytes[3] || 0);
  return {
    packetType: bytes[0],
    op: bytes[1],
    length,
    checksum: ((bytes[4] || 0) << 8) | (bytes[5] || 0),
    key: ((bytes[6] || 0) << 8) | (bytes[7] || 0),
    flag: bytes[8],
    data: bytes.slice(9, 9 + Math.max(0, length - 3)),
    raw: bytes
  };
};

export const readUint32LE = (bytes: Uint8Array, offset: number) => {
  return ((bytes[offset] || 0) |
    ((bytes[offset + 1] || 0) << 8) |
    ((bytes[offset + 2] || 0) << 16) |
    ((bytes[offset + 3] || 0) << 24)) >>> 0;
};

export const readInt16LE = (bytes: Uint8Array, offset: number) => {
  const value = (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8);
  return value & 0x8000 ? value - 0x10000 : value;
};

export const readUint64LE = (bytes: Uint8Array, offset: number) => {
  let value = 0;
  for (let index = 7; index >= 0; index--) {
    value = value * 256 + (bytes[offset + index] || 0);
  }
  return value;
};

export const writeUint64LE = (bytes: Uint8Array, offset: number, value: number) => {
  let next = Math.max(0, Math.floor(value));
  for (let index = 0; index < 8; index++) {
    bytes[offset + index] = next & 0xff;
    next = Math.floor(next / 256);
  }
};

export const writeUint32LE = (bytes: Uint8Array, offset: number, value: number) => {
  const next = Math.max(0, Math.floor(value)) >>> 0;
  bytes[offset] = next & 0xff;
  bytes[offset + 1] = (next >> 8) & 0xff;
  bytes[offset + 2] = (next >> 16) & 0xff;
  bytes[offset + 3] = (next >> 24) & 0xff;
};

export const writeFloat32LE = (bytes: Uint8Array, offset: number, value: number) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setFloat32(offset, Number.isFinite(value) ? value : 0, true);
};

export const bytesToHex = (bytes: Uint8Array) => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const hexToBytes = (hex: string) => {
  const clean = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const decodeAscii = (bytes: Uint8Array) => {
  return Array.from(bytes)
    .map((byte) => (byte > 0 ? String.fromCharCode(byte) : ''))
    .join('')
    .replace(/\0+$/g, '');
};

const clampByte = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.floor(value)));
};

const getLocalRwTimezoneHours = () => {
  const offsetMinutes = -new Date().getTimezoneOffset();
  return offsetMinutes / 60;
};

const normalizeRwTimezoneQuarterHours = (timezone: number) => {
  if (!Number.isFinite(timezone)) return normalizeRwTimezoneQuarterHours(getLocalRwTimezoneHours());
  const quarterHours = Math.abs(timezone) <= 14 ? timezone * 4 : timezone;
  return Math.max(-48, Math.min(56, Math.round(quarterHours)));
};

export const rwCrc16X26 = (payload: Uint8Array) => {
  let crc = 0;
  for (const byte of payload) {
    crc = ((crc >>> 8) ^ RW_CRC_TABLE[(crc ^ byte) & 0xff]) & 0xffff;
  }
  return crc;
};

export const checksum8Invert = (bytes: Uint8Array) => {
  let sum = 0;
  for (const byte of bytes) {
    sum = (sum + (byte & 0xff)) & 0xff;
  }
  return (~sum) & 0xff;
};

const RW_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
});

const isRwMonitoringKey = (key: RwKey) => {
  return [
    RwKey.HrMonitoring,
    RwKey.TemperatureDetecting,
    RwKey.Spo2Monitoring,
    RwKey.HrvMonitoring,
    RwKey.StressMonitoring,
    RwKey.BloodSugarMonitoring,
    RwKey.BloodPressureMonitoring,
    RwKey.TemperatureMonitoring
  ].includes(key);
};

const isRwHealthDataKey = (key: RwKey) => {
  return [
    RwKey.Activity,
    RwKey.HeartRate,
    RwKey.BloodPressure,
    RwKey.RawSleep,
    RwKey.Sleep,
    RwKey.Temperature,
    RwKey.BloodOxygen,
    RwKey.Hrv,
    RwKey.Stress,
    RwKey.BloodSugar,
    RwKey.ActivityCurrentDay
  ].includes(key);
};

const toRwHealthDataControlKey = (key: RwKey | RwHealthDataControlKey) => {
  return key > 0xff ? key & 0xff : key;
};

const isRwHealthDataControlKey = (key: number) => {
  return [
    RwHealthDataControlKey.HeartRate,
    RwHealthDataControlKey.BloodPressure,
    RwHealthDataControlKey.Temperature,
    RwHealthDataControlKey.BloodOxygen,
    RwHealthDataControlKey.Hrv,
    RwHealthDataControlKey.Stress,
    RwHealthDataControlKey.BloodSugar
  ].includes(key);
};

const assertRwWritableKey = (key: RwKey) => {
  if (!isRwMonitoringKey(key)) {
    throw new Error(`RW health monitoring set command is not supported for key 0x${key.toString(16)}.`);
  }
};
