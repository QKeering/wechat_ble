import {
  RwCommand,
  RwFileSystemSubcommand,
  RwHealthDataControlKey,
  RwKey,
  RwKeyFlag,
  RwQkeerV2HistoryCommand,
  RwTimeSubcommand,
  bytesToHex,
  checksum8Invert,
  decodeAscii,
  parseRwKeyFrame,
  parseRwFrame,
  readInt16LE,
  readUint32LE,
  readUint64LE
} from './protocol';
import type { RingParsedData } from '../types';

export interface RwFileListItem {
  total: number;
  seq: number;
  fileSize: number;
  fileName: string;
  userId?: string;
  timestampText?: string;
  fileType?: string;
}

const qkeerV2HistoryFragments = new Map<number, Uint8Array[]>();

export const parseRwRingData = (value: ArrayBuffer | Uint8Array): RingParsedData | null => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);

  const keyFrame = parseRwKeyFrame(bytes);
  if (keyFrame) return parseKeyFrame(keyFrame, bytes);

  const qkeerV2Frame = parseRwQkeerV2CompatFrame(bytes);
  if (qkeerV2Frame) return qkeerV2Frame;

  const frame = parseRwFrame(bytes);
  if (!frame) return null;

  const miniBattery = parseMiniBatteryFrame(frame.cmd, frame.subcmd, frame.frameId, frame.data, bytes);
  if (miniBattery) return miniBattery;

  const legacyCompatBattery = parseLegacyCompatBatteryFrame(frame.cmd, frame.subcmd, frame.frameId, frame.data, bytes);
  if (legacyCompatBattery) return legacyCompatBattery;

  const legacyCompatCore = parseLegacyCompatCoreFrame(frame.cmd, frame.subcmd, frame.frameId, frame.data, bytes);
  if (legacyCompatCore) return legacyCompatCore;

  if (frame.cmd === RwCommand.Time) {
    return parseTimeFrame(frame.subcmd, frame.frameId, frame.data, bytes);
  }

  if (frame.cmd === RwCommand.FileSystem) {
    return parseFileSystemFrame(frame.subcmd, frame.frameId, frame.data, bytes);
  }

  if (frame.cmd === 0x37) {
    return parseSystemFrame(frame.subcmd, frame.frameId, bytes);
  }

  return {
    type: 'rw_unknown',
    cmd: frame.cmd,
    subcmd: frame.subcmd,
    frameId: frame.frameId,
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

function parseRwQkeerV2CompatFrame(bytes: Uint8Array): RingParsedData | null {
  if (bytes.length < 13) return null;
  const packetSum = readUint32LE(bytes, 2);
  const packetIndex = readUint32LE(bytes, 6);
  const dataInfoLength = bytes[10] || 0;
  const cmd = bytes[11] || 0;
  const dataStart = 12;
  const dataEnd = dataStart + Math.max(0, dataInfoLength - 1);
  const checksumOffset = bytes.length - 1;

  if (packetSum <= 0 || packetIndex >= packetSum || dataInfoLength <= 0 || dataEnd > checksumOffset) return null;
  if (!isRwQkeerV2HistoryCommand(cmd)) return null;

  const checksumBytes = bytes.slice(1, checksumOffset);
  const checksum = bytes[checksumOffset] || 0;
  const checksumOk = checksum8Invert(checksumBytes) === checksum;
  if (!checksumOk) {
    return {
      type: 'rw_qkeer_v2_checksum_failed',
      protocol: 'rw',
      packetShape: 'qkeer_v2_compat',
      qkeerCommand: cmd,
      packetSum,
      packetIndex,
      timestamp: Date.now(),
      raw: Array.from(bytes)
    };
  }

  const payload = bytes.slice(dataStart, dataEnd);
  const payloadForParse = collectRwQkeerV2Payload(cmd, payload, packetSum, packetIndex);
  if (!payloadForParse) {
    return {
      type: 'rw_qkeer_v2_fragment',
      protocol: 'rw',
      packetShape: 'qkeer_v2_compat',
      qkeerCommand: cmd,
      packetSum,
      packetIndex,
      timestamp: Date.now(),
      raw: Array.from(bytes)
    };
  }

  return parseRwQkeerV2HistoryPayload(cmd, payloadForParse, bytes, {
    packetSum,
    packetIndex
  });
}

const isRwQkeerV2HistoryCommand = (cmd: number) => {
  return [
    RwQkeerV2HistoryCommand.Sleep,
    RwQkeerV2HistoryCommand.SleepList,
    RwQkeerV2HistoryCommand.HealthList,
    RwQkeerV2HistoryCommand.LastData,
    RwQkeerV2HistoryCommand.StepList,
    RwQkeerV2HistoryCommand.EnhanceSleepRead
  ].includes(cmd);
};

const collectRwQkeerV2Payload = (cmd: number, payload: Uint8Array, packetSum: number, packetIndex: number) => {
  if (packetSum <= 1) return payload;

  const fragments = qkeerV2HistoryFragments.get(cmd) || [];
  fragments[packetIndex] = payload;
  qkeerV2HistoryFragments.set(cmd, fragments);

  if (packetIndex < packetSum - 1) return null;

  qkeerV2HistoryFragments.delete(cmd);
  return concatUint8Arrays(Array.from({ length: packetSum }, (_, index) => fragments[index] || new Uint8Array()));
};

const parseRwQkeerV2HistoryPayload = (
  cmd: number,
  payload: Uint8Array,
  raw: Uint8Array,
  packet: { packetSum: number; packetIndex: number }
): RingParsedData => {
  if (cmd === RwQkeerV2HistoryCommand.Sleep) {
    const records = parseRwQkeerV2SleepRecords(payload);
    const record = records[0] || {};
    return {
      type: 'qkeer_v2_sleep',
      protocol: 'rw',
      packetShape: 'qkeer_v2_compat',
      qkeerCommand: cmd,
      dataType: 'sleep',
      status: records.length > 0 ? 'success' : 'empty',
      records,
      totalNum: records.length,
      packetSum: packet.packetSum,
      packetIndex: packet.packetIndex,
      ...record,
      timestamp: record.timestamp ?? Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === RwQkeerV2HistoryCommand.SleepList) {
    return createRwQkeerV2HistoryParsed('qkeer_v2_sleep_list', 'sleep', parseRwQkeerV2SleepRecords(payload), cmd, raw, packet);
  }

  if (cmd === RwQkeerV2HistoryCommand.StepList) {
    return createRwQkeerV2HistoryParsed('qkeer_v2_step_list', 'step', parseRwQkeerV2StepRecords(payload), cmd, raw, packet);
  }

  if (cmd === RwQkeerV2HistoryCommand.LastData) {
    const record = parseRwQkeerV2LastDataRecord(payload);
    return createRwQkeerV2LastDataParsed(record ? [record] : [], cmd, raw, packet);
  }

  if (cmd === RwQkeerV2HistoryCommand.EnhanceSleepRead) {
    return {
      type: 'qkeer_v2_enhance_sleep_read',
      protocol: 'rw',
      packetShape: 'qkeer_v2_compat',
      qkeerCommand: cmd,
      enabled: (payload[0] || 0) !== 0,
      value: payload[0] || 0,
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  return createRwQkeerV2HistoryParsed('qkeer_v2_health_list', 'vital', parseRwQkeerV2HealthRecords(payload), cmd, raw, packet);
};

const createRwQkeerV2HistoryParsed = (
  type: string,
  dataType: string,
  records: Array<Record<string, any>>,
  cmd: number,
  raw: Uint8Array,
  packet: { packetSum: number; packetIndex: number }
): RingParsedData => ({
  type,
  protocol: 'rw',
  packetShape: 'qkeer_v2_compat',
  qkeerCommand: cmd,
  dataType,
  status: records.length > 0 ? 'success' : 'empty',
  records,
  totalNum: records.length,
  packetSum: packet.packetSum,
  packetIndex: packet.packetIndex,
  timestamp: Date.now(),
  raw: Array.from(raw)
});

const createRwQkeerV2LastDataParsed = (
  records: Array<Record<string, any>>,
  cmd: number,
  raw: Uint8Array,
  packet: { packetSum: number; packetIndex: number }
): RingParsedData => ({
  type: 'qkeer_v2_last_data',
  protocol: 'rw',
  packetShape: 'qkeer_v2_compat',
  qkeerCommand: cmd,
  dataType: 'summary',
  status: records.length > 0 ? 'success' : 'empty',
  records,
  totalNum: records.length,
  packetSum: packet.packetSum,
  packetIndex: packet.packetIndex,
  timestamp: Date.now(),
  ...(records[0] || {}),
  raw: Array.from(raw)
});

const parseRwQkeerV2LastDataRecord = (payload: Uint8Array) => {
  if (payload.length < 22) return null;

  const batteryInfo = parseRwQkeerV2BatteryInfo(payload[0] || 0);
  const step = readUint32LE(payload, 2);
  const heartRate = parseRwQkeerV2NullableByte(payload[6], 25, 240);
  const bloodOxygen = parseRwQkeerV2NullableByte(payload[7], 70, 100);
  const temperatureRaw = readInt16LE(payload, 8);
  const temperature = parseQkeerV2Temperature(temperatureRaw);
  const sleepAwakeMinutes = readUint16LE(payload, 10);
  const sleepDeepMinutes = readUint16LE(payload, 12);
  const sleepLightMinutes = readUint16LE(payload, 14);
  const sleepRemMinutes = readUint16LE(payload, 16);
  const fatigueRaw = readUint16LE(payload, 18);
  const anxietyRaw = readUint16LE(payload, 20);
  const now = Date.now();

  return {
    dataType: 'summary',
    rawDataType: 'last_data',
    timestamp: Math.floor(now / 1000),
    receivedAt: now,
    unixTime: Math.floor(now / 1000),
    ...batteryInfo,
    isWorn: payload[1] === 0x01,
    step,
    stepCount: step,
    heartRate,
    heartrate: heartRate,
    bloodOxygen,
    spo2: bloodOxygen,
    temperature: temperature || null,
    temperatureRaw,
    sleepAwakeMinutes,
    sleepDeepMinutes,
    sleepLightMinutes,
    sleepRemMinutes,
    sleepTotalMinutes: sleepAwakeMinutes + sleepDeepMinutes + sleepLightMinutes + sleepRemMinutes,
    fatigueRaw,
    fatigue: fatigueRaw === 0xffff ? null : fatigueRaw,
    fatigueLevel: getQkeerV2FatigueLevel(fatigueRaw),
    anxietyRaw,
    anxiety: anxietyRaw === 0xffff ? null : anxietyRaw,
    anxietyLevel: getQkeerV2AnxietyLevel(anxietyRaw)
  };
};

const parseRwQkeerV2BatteryInfo = (batteryInfo: number) => {
  if (batteryInfo > 200) {
    return {
      battery: null,
      batteryLevel: null,
      chargingStatus: null,
      chargingStatusText: '\u672a\u77e5'
    };
  }

  const isCharging = batteryInfo > 100 ? 1 : 0;
  const batteryLevel = isCharging ? batteryInfo - 100 : batteryInfo;
  return {
    battery: batteryLevel,
    batteryLevel,
    chargingStatus: isCharging,
    chargingStatusText: isCharging ? '\u5145\u7535\u4e2d' : '\u672a\u5145\u7535'
  };
};

const parseRwQkeerV2NullableByte = (value: number | undefined, min = 1, max = 254) => {
  if (value == null || value === 0xff || value < min || value > max) return null;
  return value;
};

const parseRwQkeerV2SleepRecords = (payload: Uint8Array) => {
  const records: Array<Record<string, any>> = [];
  for (let offset = 0; offset + 8 <= payload.length; offset += 8) {
    const sleepType = payload[offset] || 0;
    const unixTime = readUint32LE(payload, offset + 1);
    const sleepStatus = payload[offset + 5] || 0;
    const sleepState = mapQkeerV2SleepStatusToL19SleepState(sleepStatus);
    const durationMinutes = readUint16LE(payload, offset + 6);
    records.push({
      dataType: 'sleep',
      sleepType,
      timestamp: unixTime,
      unixTime,
      sleepStatus,
      sleepStatusText: getQkeerV2SleepStatusText(sleepStatus),
      sleepState,
      durationMinutes,
      timeLen: durationMinutes
    });
  }
  return records;
};

const parseRwQkeerV2StepRecords = (payload: Uint8Array) => {
  const records: Array<Record<string, any>> = [];
  for (let offset = 0; offset + 8 <= payload.length; offset += 8) {
    const unixTime = readUint32LE(payload, offset);
    const step = readUint32LE(payload, offset + 4);
    records.push({
      dataType: 'step',
      timestamp: unixTime,
      unixTime,
      step,
      stepCount: step
    });
  }
  return records;
};

const parseRwQkeerV2HealthRecords = (payload: Uint8Array) => {
  const records: Array<Record<string, any>> = [];
  for (let offset = 0; offset + 8 <= payload.length; offset += 8) {
    const unixTime = readUint32LE(payload, offset);
    const heartRate = normalizeRwHeartRateValue(payload[offset + 4]);
    const bloodOxygen = normalizeRwBloodOxygenValue(payload[offset + 5]);
    const temperatureRaw = readUint16LE(payload, offset + 6);
    const temperature = parseQkeerV2Temperature(temperatureRaw);
    records.push({
      dataType: 'vital',
      timestamp: unixTime,
      unixTime,
      heartRate,
      heartrate: heartRate,
      bloodOxygen,
      spo2: bloodOxygen,
      temperature,
      temperatureRaw
    });
  }
  return records;
};

const normalizeRwHeartRateValue = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 25 || numeric > 240) return null;
  return numeric;
};

const normalizeRwBloodOxygenValue = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 70 || numeric > 100) return null;
  return numeric;
};

const parseQkeerV2Temperature = (raw: number) => {
  if (!raw) return 0;
  return Number((raw * 0.0078125 + 1.3).toFixed(2));
};

const getQkeerV2SleepStatusText = (status: number) => {
  if (status === 0) return '进入睡眠';
  if (status === 1) return '浅睡';
  if (status === 2) return '深睡';
  if (status === 3) return '清醒';
  if (status === 4) return 'REM';
  if (status === 5) return '退出睡眠';
  return '未知';
};

const mapQkeerV2SleepStatusToL19SleepState = (status: number) => {
  if (status === 1) return 3;
  if (status === 2) return 4;
  if (status === 3) return 1;
  if (status === 4) return 2;
  return undefined;
};

const getQkeerV2FatigueLevel = (value: number) => {
  if (value === 0xffff) return '\u65e0\u6548';
  if (value < 300) return '\u4e0d\u75b2\u52b3';
  if (value <= 360) return '\u8f7b\u5ea6\u75b2\u52b3';
  if (value <= 420) return '\u4e2d\u5ea6\u75b2\u52b3';
  return '\u91cd\u5ea6\u75b2\u52b3';
};

const getQkeerV2AnxietyLevel = (value: number) => {
  if (value === 0xffff) return '\u65e0\u6548';
  if (value < 300) return '\u4e0d\u7126\u8651';
  if (value <= 700) return '\u8f7b\u5ea6\u7126\u8651';
  if (value <= 1000) return '\u4e2d\u5ea6\u7126\u8651';
  return '\u91cd\u5ea6\u7126\u8651';
};

const concatUint8Arrays = (chunks: Uint8Array[]) => {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

function parseKeyFrame(frame: NonNullable<ReturnType<typeof parseRwKeyFrame>>, raw: Uint8Array): RingParsedData {
  if (frame.key === RwKey.Time) {
    return parseRwDateTimeKeyFrame(frame, raw);
  }

  if (frame.key === RwKey.TimeZone) {
    return {
      type: 'rw_time_zone_ack',
      protocol: 'rw',
      frameId: frame.checksum,
      timestamp: Date.now(),
      key: frame.key,
      flag: frame.flag,
      timezone: frame.data[0],
      daylightSaving: frame.data[1],
      success: frame.flag === RwKeyFlag.Update,
      status: frame.flag === RwKeyFlag.Update ? 'success' : 'ack',
      data: Array.from(frame.data),
      raw: Array.from(raw)
    };
  }

  if (isRwBatteryKey(frame.key)) {
    if (frame.data.length === 0) {
      return createRwBatteryPendingParsedData(frame, raw);
    }

    const battery = frame.data[0] ?? 0;
    const chargingStatus = frame.data[1];
    return createRwBatteryParsedData({
      battery,
      chargingStatus,
      frameId: frame.checksum,
      key: RwKey.Battery,
      flag: frame.flag,
      raw
    });
  }

  if (isRwFirmwareVersionKey(frame.key)) {
    if (frame.data.length === 0) {
      return createRwKeyPendingParsedData(frame, raw, 'firmware_version', '等待版本信息返回');
    }

    return parseFirmwareVersionFrame(frame, raw);
  }

  if (frame.key === RwKey.UserProfile) {
    return {
      type: 'rw_user_profile_ack',
      protocol: 'rw',
      frameId: frame.checksum,
      timestamp: Date.now(),
      key: frame.key,
      flag: frame.flag,
      success: frame.flag === 0,
      status: frame.flag === 0 ? 'success' : 'failed',
      raw: Array.from(raw)
    };
  }

  if (frame.key === RwKey.AppDataControl) {
    return {
      type: 'rw_health_data_control_ack',
      protocol: 'rw',
      frameId: frame.checksum,
      timestamp: Date.now(),
      key: frame.key,
      name: getControlledHealthDataName(frame.data[0]),
      controlKey: frame.data[0],
      controlAction: frame.data[2],
      flag: frame.flag,
      success: frame.flag === 0,
      status: frame.flag === 0 ? 'success' : 'failed',
      data: Array.from(frame.data),
      raw: Array.from(raw)
    };
  }

  if (isMonitoringKey(frame.key)) {
    if (frame.data.length >= 6) {
      const config = parseMonitoringConfig(frame.key, frame.data);
      return {
        type: 'rw_health_monitoring',
        protocol: 'rw',
        frameId: frame.checksum,
        timestamp: Date.now(),
        key: frame.key,
        name: getMonitoringName(frame.key),
        flag: frame.flag,
        ...config,
        raw: Array.from(raw)
      };
    }

    return {
      type: 'rw_health_monitoring_ack',
      protocol: 'rw',
      frameId: frame.checksum,
      timestamp: Date.now(),
      key: frame.key,
      name: getMonitoringName(frame.key),
      flag: frame.flag,
      success: frame.flag === 0,
      status: frame.flag === 0 ? 'success' : 'failed',
      raw: Array.from(raw)
    };
  }

  if (isHealthDataKey(frame.key)) {
    const value = parseHealthDataValue(frame.key, frame.data);
    const records = parseHealthDataRecords(frame.key, frame.data);
    const hasValue = value !== undefined && value !== null;
    const hasRecords = records.length > 0;
    const hasRawPayload = (frame.key === RwKey.Sleep || frame.key === RwKey.RawSleep) && frame.data.length > 1;
    const isStatusOnly = frame.data.length === 1 && !hasValue;
    const statusCode = isStatusOnly ? frame.data[0] : undefined;
    return {
      type: hasValue || hasRecords || hasRawPayload ? 'rw_health_data' : 'rw_health_data_ack',
      protocol: 'rw',
      frameId: frame.checksum,
      timestamp: Date.now(),
      key: frame.key,
      name: getHealthDataName(frame.key),
      flag: frame.flag,
      value,
      status: isStatusOnly ? getHealthDataStatus(frame.data[0]) : undefined,
      statusCode,
      statusText: isStatusOnly ? getHealthDataStatus(frame.data[0]) : undefined,
      message: isStatusOnly ? getHealthDataStatusMessage(frame.data[0]) : undefined,
      records,
      totalNum: records.length || undefined,
      data: Array.from(frame.data),
      raw: Array.from(raw)
    };
  }

  return {
    type: 'rw_key',
    protocol: 'rw',
    frameId: frame.checksum,
    timestamp: Date.now(),
    key: frame.key,
    flag: frame.flag,
    data: Array.from(frame.data),
    raw: Array.from(raw)
  };
}

function parseRwDateTimeKeyFrame(frame: NonNullable<ReturnType<typeof parseRwKeyFrame>>, raw: Uint8Array): RingParsedData {
  const data = frame.data;
  if (data.length >= 6) {
    const year = 2000 + (data[0] || 0);
    const month = data[1] || 1;
    const day = data[2] || 1;
    const hour = data[3] || 0;
    const minute = data[4] || 0;
    const second = data[5] || 0;
    const deviceTimestamp = new Date(year, month - 1, day, hour, minute, second).getTime();
    return {
      type: 'device_time',
      protocol: 'rw',
      packetShape: 'ab_time_key',
      frameId: frame.checksum,
      timestamp: Date.now(),
      key: frame.key,
      flag: frame.flag,
      deviceTimestamp,
      deviceUnixTime: Math.floor(deviceTimestamp / 1000),
      deviceTimeFields: { year, month, day, hour, minute, second },
      readable: new Date(deviceTimestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      data: Array.from(data),
      raw: Array.from(raw)
    };
  }

  return {
    type: 'rw_time_ack',
    protocol: 'rw',
    packetShape: 'ab_time_key',
    frameId: frame.checksum,
    timestamp: Date.now(),
    key: frame.key,
    flag: frame.flag,
    success: frame.flag === RwKeyFlag.Update,
    status: frame.flag === RwKeyFlag.Update ? 'success' : 'ack',
    data: Array.from(data),
    raw: Array.from(raw)
  };
}

function parseMiniBatteryFrame(
  cmd: number,
  subcmd: number,
  frameId: number,
  data: Uint8Array,
  raw: Uint8Array
): RingParsedData | null {
  if (cmd !== 0x03 || (subcmd !== RwKeyFlag.Read && subcmd !== RwKeyFlag.ReadContinue)) return null;

  const batteryPayload = getMiniBatteryPayload(data);
  if (!batteryPayload) return null;

  return createRwBatteryParsedData({
    battery: batteryPayload.battery,
    chargingStatus: batteryPayload.chargingStatus,
    frameId,
    key: RwKey.Battery,
    flag: subcmd,
    raw,
    packetShape: 'mini'
  });
}

function parseLegacyCompatBatteryFrame(
  cmd: number,
  subcmd: number,
  frameId: number,
  data: Uint8Array,
  raw: Uint8Array
): RingParsedData | null {
  if (cmd !== 0x12 || !isLegacyCompatReadSubcommand(subcmd) || !isRwBatteryCode(data[0])) return null;

  return createRwBatteryParsedData({
    battery: data[0],
    chargingStatus: isRwChargingStatus(data[1]) ? data[1] : undefined,
    frameId,
    key: RwKey.Battery,
    flag: subcmd,
    raw,
    packetShape: 'legacy_compat'
  });
}

function parseLegacyCompatCoreFrame(
  cmd: number,
  subcmd: number,
  frameId: number,
  data: Uint8Array,
  raw: Uint8Array
): RingParsedData | null {
  if (cmd === 0x11 && (subcmd === 0x00 || subcmd === 0x01)) {
    const isHardware = subcmd === 0x01;
    const value = decodeAscii(data.slice(0, 10)).trim();
    return {
      type: isHardware ? 'hardwareVersion' : 'softwareVersion',
      protocol: 'rw',
      frameId,
      value,
      status: 'normal',
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === 0x31 && isLegacyCompatReadSubcommand(subcmd) && data.length >= 2) {
    const status = data[0];
    const heartRate = data[1];
    const heartRateVariability = data[2];
    const temperature = data[3];
    return {
      type: 'active_measure',
      protocol: 'rw',
      frameId,
      status: getLegacyMeasureStatus(status),
      heartRate: normalizeRwHeartRateValue(heartRate),
      heartRateVariability: heartRateVariability > 0 ? heartRateVariability : null,
      hrv: heartRateVariability > 0 ? heartRateVariability : null,
      stressIndex: heartRateVariability >= 0 && heartRateVariability <= 100 ? heartRateVariability : null,
      stress: heartRateVariability >= 0 && heartRateVariability <= 100 ? heartRateVariability : null,
      temperature: temperature > 0 ? `${(temperature / 100).toFixed(2)}\u00b0C` : null,
      heartbeatStatus: status,
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === 0x32 && isLegacyCompatReadSubcommand(subcmd) && data.length >= 3) {
    const status = data[0];
    const heartRate = data[1];
    const bloodOxygen = data[2];
    const temperature = data[3];
    return {
      type: 'active_OxyGenMeasure',
      protocol: 'rw',
      frameId,
      status: getLegacyMeasureStatus(status),
      heartRate: normalizeRwHeartRateValue(heartRate),
      bloodOxygen: normalizeRwBloodOxygenValue(bloodOxygen),
      temperature: temperature > 0 ? `${temperature}\u00b0C` : null,
      bloodOxygenStatus: status,
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === 0x34 && isLegacyCompatReadSubcommand(subcmd) && data.length >= 3) {
    const status = data[0];
    const temperatureValue = Number((readInt16LE(data, 1) / 100).toFixed(2));
    return {
      type: 'active_Temperature',
      protocol: 'rw',
      frameId,
      status: getLegacyTemperatureStatus(status),
      temperature: temperatureValue.toFixed(2),
      temperatureValue,
      temperatureStatus: status,
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === 0x36 && (subcmd === 0x00 || subcmd === 0x01) && data.length >= 4) {
    return parseLegacyCompatLocalDataFrame(frameId, data, raw);
  }

  if (cmd === 0x36 && subcmd === 0x03) {
    return {
      type: 'delete_all_local_data',
      protocol: 'rw',
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === 0x37 && subcmd === 0x00 && data.length >= 1) {
    return {
      type: 'collect_period_set',
      protocol: 'rw',
      frameId,
      status: data[0] === 1 ? 'success' : 'failed',
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === 0x37 && subcmd === 0x01 && data.length >= 4) {
    const period = readUint32LE(data, 0);
    return {
      type: 'collect_period_read',
      protocol: 'rw',
      frameId,
      period,
      minutes: (period / 60).toFixed(1),
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (cmd === 0x37 && subcmd === 0x02) {
    return {
      type: 'restore_factory_settings',
      protocol: 'rw',
      frameId,
      success: true,
      status: 'success',
      statusCode: 1,
      statusText: 'success',
      packetShape: 'legacy_compat',
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  return null;
}

function parseLegacyCompatLocalDataFrame(frameId: number, data: Uint8Array, raw: Uint8Array): RingParsedData {
  const totalNum = readUint32LE(data, 0);

  if (totalNum === 0xffffffff) {
    return {
      type: 'local_data',
      protocol: 'rw',
      packetShape: 'legacy_compat',
      status: 'no_data',
      records: [],
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  if (totalNum === 0) {
    return {
      type: 'local_data',
      protocol: 'rw',
      packetShape: 'legacy_compat',
      status: 'empty',
      totalNum: 0,
      records: [],
      timestamp: Date.now(),
      raw: Array.from(raw)
    };
  }

  const records: Array<Record<string, any>> = [];
  let offset = 4;

  while (offset + 21 <= data.length) {
    const seq = readUint32LE(data, offset);
    const unixTime = readUint32LE(data, offset + 4);
    const stepCount = (data[offset + 8] || 0) | ((data[offset + 9] || 0) << 8);
    const heartRate = data[offset + 10] || 0;
    const spo2 = data[offset + 11] || 0;
    const hrv = data[offset + 12] || 0;
    const stress = data[offset + 13] || 0;
    const temperature = Number((readInt16LE(data, offset + 14) / 100).toFixed(2));
    const activityLevel = data[offset + 16];
    const sleepType = data[offset + 17];
    const perfusion = data[offset + 18] || 0;
    const rrCount = data[offset + 20] || 0;
    const rrIntervals: number[] = [];
    const rrStart = offset + 21;

    for (let index = 0; index < rrCount && rrStart + index * 2 + 1 < data.length; index += 1) {
      rrIntervals.push((data[rrStart + index * 2] || 0) | ((data[rrStart + index * 2 + 1] || 0) << 8));
    }

    records.push({
      seq,
      unixTime,
      timestamp: new Date(unixTime * 1000).toLocaleString(),
      recordTime: formatLegacyCompatRecordTime(unixTime * 1000),
      stepCount,
      heartRate: heartRate > 0 ? heartRate : null,
      spo2: normalizeRwBloodOxygenValue(spo2),
      hrv: hrv > 0 ? hrv : null,
      stress: stress >= 0 && stress <= 100 ? stress : null,
      temperature,
      activityLevel,
      sleepType,
      perfusion: perfusion > 0 ? perfusion : null,
      rrCount,
      rrIntervals
    });

    offset += 21 + rrCount * 2;
  }

  return {
    type: 'local_data',
    protocol: 'rw',
    packetShape: 'legacy_compat',
    frameId,
    status: 'success',
    totalNum,
    records,
    timestamp: Date.now(),
    raw: Array.from(raw)
  };
}

function formatLegacyCompatRecordTime(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  const second = `${date.getSeconds()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function getLegacyMeasureStatus(value?: number) {
  if (value === 0x0) return '\u672a\u4f69\u6234';
  if (value === 0x1) return '\u4f69\u6234';
  if (value === 0x2) return '\u5145\u7535\u4e2d\u4e0d\u5141\u8bb8\u91c7\u96c6';
  if (value === 0x3) return '\u91c7\u96c6\u4e2d';
  if (value === 0x4) return '\u7e41\u5fd9\uff0c\u4e0d\u6267\u884c';
  return '\u672a\u77e5';
}

function getLegacyTemperatureStatus(value?: number) {
  if (value === 0x0) return '\u6d4b\u91cf\u4e2d';
  if (value === 0x1) return '\u6d4b\u91cf\u5b8c\u6210';
  if (value === 0x2) return '\u6d4b\u91cf\u5931\u8d25\u5e76\u7ed3\u675f';
  if (value === 0x3) return '\u7e41\u5fd9\uff0c\u4e0d\u6267\u884c';
  return '\u672a\u77e5';
}

function getMiniBatteryPayload(data: Uint8Array) {
  if (data.length >= 3 && data[0] === 0x02 && data[1] === 0x03 && isRwBatteryCode(data[2])) {
    return { battery: data[2], chargingStatus: data[3] };
  }

  if (data.length >= 3 && data[0] === 0x03 && data[1] === 0x02 && isRwBatteryCode(data[2])) {
    return { battery: data[2], chargingStatus: data[3] };
  }

  if (data.length === 1 && isRwBatteryCode(data[0])) {
    return { battery: data[0], chargingStatus: undefined };
  }

  if (data.length === 2 && isRwBatteryCode(data[0]) && isRwChargingStatus(data[1])) {
    return { battery: data[0], chargingStatus: data[1] };
  }

  return null;
}

function isRwBatteryKey(key: number) {
  return key === RwKey.Battery || key === 0x0302;
}

function isRwFirmwareVersionKey(key: number) {
  return key === RwKey.FirmwareVersion || key === 0x0402;
}

function createRwBatteryParsedData({
  battery,
  chargingStatus,
  frameId,
  key,
  flag,
  raw,
  packetShape
}: {
  battery: number;
  chargingStatus?: number;
  frameId: number;
  key: number;
  flag: number;
  raw: Uint8Array;
  packetShape?: string;
}): RingParsedData {
  const chargingStatusText = chargingStatus == null ? undefined : getChargingStatusText(chargingStatus);
  const legacyBattery = normalizeRwBatteryForLegacyShape(battery, chargingStatus, chargingStatusText);
  return {
    type: 'battery',
    protocol: 'rw',
    frameId,
    timestamp: Date.now(),
    value: legacyBattery.value,
    valueText: legacyBattery.value,
    battery,
    numericValue: battery,
    status: legacyBattery.status,
    batteryStatus: chargingStatusText,
    chargingStatus,
    chargingStatusText,
    key,
    flag,
    packetShape,
    raw: Array.from(raw)
  };
}

function createRwBatteryPendingParsedData(frame: NonNullable<ReturnType<typeof parseRwKeyFrame>>, raw: Uint8Array): RingParsedData {
  return createRwKeyPendingParsedData(frame, raw, 'battery', '等待电量返回');
}

function createRwKeyPendingParsedData(
  frame: NonNullable<ReturnType<typeof parseRwKeyFrame>>,
  raw: Uint8Array,
  name: string,
  message: string
): RingParsedData {
  return {
    type: 'rw_health_data_pending',
    protocol: 'rw',
    name,
    key: frame.key,
    flag: frame.flag,
    status: 'pending',
    message,
    timestamp: Date.now(),
    raw: Array.from(raw)
  };
}

function isRwBatteryCode(value: number | undefined) {
  return value != null && value >= 0 && value <= 102;
}

function isLegacyCompatReadSubcommand(subcmd: number) {
  return subcmd === 0x00 || subcmd === 0x01;
}

function isRwChargingStatus(value: number | undefined) {
  return value === 0 || value === 1 || value === 2;
}

function parseFirmwareVersionFrame(frame: NonNullable<ReturnType<typeof parseRwKeyFrame>>, raw: Uint8Array): RingParsedData {
  const data = frame.data;
  const isTextPayload = isRwFirmwareTextPayload(data);
  const firmwareVersion = decodeRwFirmwareVersion(data);
  const screenWidth = !isTextPayload && data.length >= 8 ? readUint16LE(data, 4) : undefined;
  const screenHeight = !isTextPayload && data.length >= 8 ? readUint16LE(data, 6) : undefined;
  const uiVersion = !isTextPayload && data.length >= 16 ? decodeAscii(data.slice(8, 16)) : undefined;
  const softwareVersion = uiVersion || firmwareVersion;

  return {
    type: 'firmware_version',
    protocol: 'rw',
    frameId: frame.checksum,
    timestamp: Date.now(),
    key: RwKey.FirmwareVersion,
    flag: frame.flag,
    firmwareVersion,
    hardwareVersion: firmwareVersion,
    softwareVersion,
    uiVersion,
    screenWidth,
    screenHeight,
    payloadHex: Array.from(data)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
    raw: Array.from(raw)
  };
}

function decodeRwFirmwareVersion(data: Uint8Array) {
  const text = decodeAscii(data).replace(/\0/g, '').trim();
  if (isRwFirmwareTextPayload(data) && text) return text;
  return data.length >= 3 ? `${data[0]}.${data[1]}.${data[2]}` : text;
}

function isRwFirmwareTextPayload(data: Uint8Array) {
  return data.length > 0 && Array.from(data).every((byte) => byte === 0 || (byte >= 0x20 && byte <= 0x7e));
}

function parseMonitoringConfig(key: number, data: Uint8Array) {
  const flag = data[0] ?? 0;
  const isBodyTemperatureConfig = key === RwKey.TemperatureDetecting || key === RwKey.TemperatureMonitoring;
  const baseConfig = {
    enabled: isBodyTemperatureConfig ? flag === 1 || (flag & 0x80) !== 0 : flag === 1,
    startHour: data[1] ?? 0,
    startMinute: data[2] ?? 0,
    endHour: data[3] ?? 0,
    endMinute: data[4] ?? 0,
    interval: data[5] ?? 0
  };
  if (!isBodyTemperatureConfig) return baseConfig;
  return {
    ...baseConfig,
    duration: data[5] ?? 0,
    repeatModel: [
      (flag >> 6) & 1,
      flag & 1,
      (flag >> 1) & 1,
      (flag >> 2) & 1,
      (flag >> 3) & 1,
      (flag >> 4) & 1,
      (flag >> 5) & 1
    ]
  };
}

function isMonitoringKey(key: number) {
  return [
    RwKey.HrMonitoring,
    RwKey.Spo2Monitoring,
    RwKey.TemperatureDetecting,
    RwKey.HrvMonitoring,
    RwKey.StressMonitoring,
    RwKey.BloodSugarMonitoring,
    RwKey.BloodPressureMonitoring,
    RwKey.TemperatureMonitoring
  ].includes(key);
}

function getMonitoringName(key: number) {
  if (key === RwKey.HrMonitoring) return 'heart_rate';
  if (key === RwKey.TemperatureDetecting) return 'temperature';
  if (key === RwKey.Spo2Monitoring) return 'blood_oxygen';
  if (key === RwKey.HrvMonitoring) return 'hrv';
  if (key === RwKey.StressMonitoring) return 'stress';
  if (key === RwKey.BloodSugarMonitoring) return 'blood_sugar';
  if (key === RwKey.BloodPressureMonitoring) return 'blood_pressure';
  if (key === RwKey.TemperatureMonitoring) return 'temperature';
  return 'unknown';
}

function isHealthDataKey(key: number) {
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
    RwKey.ActivityCurrentDay,
    RwKey.AppRealTimeHeartRate,
    RwKey.AppRealTimeBloodPressure,
    RwKey.AppRealTimeTemperature,
    RwKey.AppRealTimeBloodOxygen,
    RwKey.AppRealTimeStress,
    RwKey.AppRealTimeHrv,
    RwKey.AppRealTimeBloodSugar
  ].includes(key);
}

function getHealthDataName(key: number) {
  if (key === RwKey.Activity || key === RwKey.ActivityCurrentDay) return 'step';
  if (key === RwKey.HeartRate || key === RwKey.AppRealTimeHeartRate) return 'heart_rate';
  if (key === RwKey.BloodPressure || key === RwKey.AppRealTimeBloodPressure) return 'blood_pressure';
  if (key === RwKey.Sleep || key === RwKey.RawSleep) return 'sleep';
  if (key === RwKey.Temperature || key === RwKey.AppRealTimeTemperature) return 'temperature';
  if (key === RwKey.BloodOxygen || key === RwKey.AppRealTimeBloodOxygen) return 'blood_oxygen';
  if (key === RwKey.Hrv || key === RwKey.AppRealTimeHrv) return 'hrv';
  if (key === RwKey.Stress || key === RwKey.AppRealTimeStress) return 'stress';
  if (key === RwKey.BloodSugar || key === RwKey.AppRealTimeBloodSugar) return 'blood_sugar';
  return 'unknown';
}

function getControlledHealthDataName(controlKey?: number) {
  if (controlKey === RwHealthDataControlKey.HeartRate) return 'heart_rate';
  if (controlKey === RwHealthDataControlKey.BloodPressure) return 'blood_pressure';
  if (controlKey === RwHealthDataControlKey.Temperature) return 'temperature';
  if (controlKey === RwHealthDataControlKey.BloodOxygen) return 'blood_oxygen';
  if (controlKey === RwHealthDataControlKey.Hrv) return 'hrv';
  if (controlKey === RwHealthDataControlKey.Stress) return 'stress';
  if (controlKey === RwHealthDataControlKey.BloodSugar) return 'blood_sugar';
  return 'unknown';
}

function parseHealthDataValue(key: number, data: Uint8Array) {
  if (data.length === 0) return undefined;
  if (data.length === 1 && isHealthDataStatusByte(data[0])) return undefined;
  if (key === RwKey.ActivityCurrentDay) return parseCurrentDayStepValue(data);
  if (key === RwKey.Sleep || key === RwKey.RawSleep) {
    const records = parseHealthDataRecords(key, data);
    const latest = records[records.length - 1];
    return latest?.sleepState;
  }
  const historyValue = parseLatestHealthDataRecordValue(key, data);
  if (historyValue !== undefined) return historyValue;
  if (isStatusPrefixedRealtimePayload(key, data)) {
    if (key === RwKey.AppRealTimeTemperature && data.length >= 6) return parseRwTemperatureValue(data, 4);
    if (key === RwKey.AppRealTimeBloodPressure && data.length >= 6) {
      return {
        systolic: data[4],
        diastolic: data[5]
      };
    }
    if (key === RwKey.AppRealTimeBloodOxygen) return normalizeRwBloodOxygenValue(data[4]);
    if (key === RwKey.AppRealTimeHeartRate) return normalizeRwHeartRateValue(data[4]);
    return data[4];
  }
  if (isHealthDataStatusByte(data[0])) {
    return parseCompactStatusPrefixedHealthDataValue(key, data);
  }
  if (
    (key === RwKey.AppRealTimeHeartRate || key === RwKey.AppRealTimeBloodOxygen) &&
    data.length >= 5 &&
    isHealthDataStatusByte(data[0])
  ) {
    if (key === RwKey.AppRealTimeBloodOxygen) return normalizeRwBloodOxygenValue(data[4]);
    return normalizeRwHeartRateValue(data[4]);
  }
  if (key === RwKey.AppRealTimeBloodOxygen && data.length >= 6) {
    return normalizeRwBloodOxygenValue(data[4]);
  }
  if (key === RwKey.AppRealTimeHeartRate && data.length >= 6) {
    return normalizeRwHeartRateValue(data[4]);
  }
  if (key === RwKey.AppRealTimeHrv && data.length >= 5) {
    return data[4] > 0 ? data[4] : undefined;
  }
  if (key === RwKey.AppRealTimeTemperature && data.length >= 2) {
    return parseRwTemperatureValue(data, 0);
  }
  if ((key === RwKey.BloodPressure || key === RwKey.AppRealTimeBloodPressure) && data.length >= 2) {
    return {
      systolic: data[0],
      diastolic: data[1]
    };
  }
  if (key === RwKey.Temperature && data.length >= 2) {
    return parseRwTemperatureValue(data, 0);
  }
  if (key === RwKey.BloodOxygen || key === RwKey.AppRealTimeBloodOxygen) {
    return normalizeRwBloodOxygenValue(data[0]);
  }
  if (key === RwKey.HeartRate || key === RwKey.AppRealTimeHeartRate) {
    return normalizeRwHeartRateValue(data[0]);
  }
  return data[0];
}

function parseHealthDataRecords(key: number, data: Uint8Array): Array<Record<string, any>> {
  if (!isReadableHistoryHealthDataKey(key)) return [];
  if (key === RwKey.Activity || key === RwKey.ActivityCurrentDay) return parseRwActivityHistoryRecords(key, data);
  if (key === RwKey.Sleep || key === RwKey.RawSleep) return parseRwSleepHistoryRecords(data);
  if (data.length < 6 || data.length % 6 !== 0) return [];

  const records: Record<string, any>[] = [];
  for (let offset = 0; offset + 6 <= data.length; offset += 6) {
    const rawUnixTime = readUint32LE(data, offset);
    const unixTime = normalizeRwHistoryRecordTimestamp(rawUnixTime) || Math.floor(Date.now() / 1000);
    const rawRecord = data.slice(offset, offset + 6);
    const metric = parseCompactHistoryMetricValue(key, data[offset + 4], rawRecord);
    if (!metric) continue;
    records.push({
      dataType: getHealthDataName(key),
      rawDataType: 'ab_health_key',
      unixTime,
      timestamp: unixTime,
      rawUnixTime,
      timestampSource: unixTime === rawUnixTime ? 'device' : 'received_at',
      key,
      ...metric,
      rawData: Array.from(data.slice(offset, offset + 6))
    });
  }
  return records;
}

function isReadableHistoryHealthDataKey(key: number) {
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
}

function parseLatestHealthDataRecordValue(key: number, data: Uint8Array) {
  if (!isReadableHistoryHealthDataKey(key) || data.length < 6) return undefined;
  const records = parseHealthDataRecords(key, data);
  if (records.length > 0) {
    const last = records[records.length - 1] as Record<string, any>;
    if (key === RwKey.Activity || key === RwKey.ActivityCurrentDay) return last.stepCount;
    if (key === RwKey.Sleep || key === RwKey.RawSleep) return last.sleepState;
    if (key === RwKey.BloodPressure) {
      return {
        systolic: last.systolic,
        diastolic: last.diastolic
      };
    }
    if (key === RwKey.Temperature) return last.temperature;
    if (key === RwKey.BloodSugar) return last.bloodSugar;
    if (key === RwKey.BloodOxygen) return last.bloodOxygen;
    if (key === RwKey.HeartRate) return last.heartRate;
    if (key === RwKey.Hrv) return last.hrv;
    if (key === RwKey.Stress) return last.stress;
  }

  if (data.length % 6 !== 0) return undefined;
  for (let offset = 0; offset + 6 <= data.length; offset += 6) {
    if (isPlausibleRwHistoryTimestamp(readUint32LE(data, offset))) return null;
  }
  if (data.length >= 6 && data.length % 6 === 0) return null;
  return undefined;
}

function parseCompactHistoryMetricValue(key: number, value: number | undefined, rawRecord?: Uint8Array) {
  if (value == null) return null;
  if (key === RwKey.Activity || key === RwKey.ActivityCurrentDay) {
    const stepCount = parseRwStepCountValue(value);
    return stepCount == null ? null : { stepCount, step: stepCount };
  }
  if (key === RwKey.Sleep || key === RwKey.RawSleep) {
    const sleepState = mapRwJlSleepModelToL19SleepState(value);
    return sleepState == null ? null : { sleepState, sleepStatus: value, sleepStatusText: getRwJlSleepStatusText(value) };
  }
  if (key === RwKey.HeartRate) {
    const heartRate = normalizeRwHeartRateValue(value);
    return heartRate == null ? null : { heartRate, heartrate: heartRate };
  }
  if (key === RwKey.BloodOxygen) {
    const bloodOxygen = normalizeRwBloodOxygenValue(value);
    return bloodOxygen == null ? null : { bloodOxygen, spo2: bloodOxygen };
  }
  if (key === RwKey.Hrv) return value > 0 ? { hrv: value, heartRateVariability: value } : null;
  if (key === RwKey.Stress) return value >= 0 && value <= 100 ? { stress: value, stressIndex: value } : null;
  if (key === RwKey.Temperature && rawRecord && rawRecord.length >= 6) {
    const temperature = normalizeRwTemperatureValue(parseRwTemperatureValue(rawRecord, 4));
    return temperature == null ? null : { temperature };
  }
  if (key === RwKey.BloodPressure && rawRecord && rawRecord.length >= 6) {
    const bloodPressure = normalizeRwBloodPressureValue(rawRecord[4], rawRecord[5]);
    return bloodPressure;
  }
  if (key === RwKey.BloodSugar) {
    const bloodSugar = normalizeRwBloodSugarValue(value);
    return bloodSugar == null ? null : { bloodSugar };
  }
  return null;
}

function parseCurrentDayStepValue(data: Uint8Array) {
  const records = parseRwCurrentDayActivityRecords(data);
  const totalStep = records.reduce((total, record) => total + (parseRwStepCountValue(record.stepCount) ?? 0), 0);
  return totalStep > 0 ? totalStep : undefined;
}

function parseRwActivityHistoryRecords(key: number, data: Uint8Array): Array<Record<string, any>> {
  const textRecords = parseRwTextRecords(data, 'activity')
    .map((record) => normalizeRwActivityRecord(record))
    .filter(Boolean) as Array<Record<string, any>>;
  if (textRecords.length > 0) return textRecords;

  if (key === RwKey.ActivityCurrentDay) {
    const currentDayRecords = parseRwCurrentDayActivityRecords(data);
    return currentDayRecords;
  }

  const jl2HistoryRecords = parseRwJl2ActivityRecords(data, false);
  if (jl2HistoryRecords.length > 0) return jl2HistoryRecords;

  return selectBestRwFixedHistoryRecords([
    parseRwActivityRecordsBySize(data, 17, parseRwStepRecordWithTimestampAndMetrics),
    parseRwActivityRecordsBySize(data, 13, parseRwStepRecordWithHourAndMetrics),
    parseRwActivityRecordsBySize(data, 12, parseRwStepRecordWithMetrics),
    parseRwActivityRecordsBySize(data, 8, parseRwStepRecordWithTimestamp32),
    parseRwActivityRecordsBySize(data, 6, parseRwStepRecordWithTimestamp16)
  ]);
}

function parseRwCurrentDayActivityRecords(data: Uint8Array): Array<Record<string, any>> {
  const jl2HourlyRecords = parseRwCurrentDayJl2ActivityRecords(data);
  if (jl2HourlyRecords.length > 0) return jl2HourlyRecords;

  const relativeHourlyRecords = parseRwCurrentDayRelativeActivityRecords(data);
  if (relativeHourlyRecords.length > 0) return relativeHourlyRecords;

  const hourlyWithIndex = parseRwActivityRecordsBySize(data, 13, (record, offset, index) =>
    parseRwStepRecordWithHourAndMetrics(record, offset, index, true)
  );
  if (hourlyWithIndex.length > 0) return hourlyWithIndex;

  const hourlyMetrics = parseRwActivityRecordsBySize(data, 12, (record, offset, index) =>
    parseRwStepRecordWithMetrics(record, offset, index, true)
  );
  if (hourlyMetrics.length > 0) return hourlyMetrics;

  const hourlyCompact = parseRwActivityRecordsBySize(data, 9, (record, offset, index) => {
    const hour = clampRwHour(record[0] ?? index);
    const stepCount = parseRwStepCountValue(readUint32LE(record, 1));
    if (stepCount == null || stepCount <= 0) return null;
    const calorie = readUint16LE(record, 5);
    const distance = readUint16LE(record, 7);
    return createRwStepHistoryRecord({
      rawDataType: 'ab_activity_current_day_hour',
      unixTime: getRwCurrentDayHourTimestamp(hour),
      stepCount,
      hour,
      calorie,
      distance,
      rawData: Array.from(record)
    });
  });
  if (hourlyCompact.length > 0) return hourlyCompact;

  return [];
}

function parseRwCurrentDayJl2ActivityRecords(data: Uint8Array): Array<Record<string, any>> {
  return parseRwJl2ActivityRecords(data, true);
}

function parseRwCurrentDayRelativeActivityRecords(data: Uint8Array): Array<Record<string, any>> {
  const recordSize = 16;
  if (data.length < recordSize * 2 || data.length % recordSize !== 0) return [];

  const records = parseRwActivityRecordsBySize(data, recordSize, (record, _offset, index) => {
    return {
      sequenceIndex: index,
      rawTime: readUint32BE(record, 0),
      stepCount: parseRwStepCountValue(readUint24BE(record, 5)),
      calorieRaw: readUint32BE(record, 8),
      distanceRaw: readUint32BE(record, 12),
      rawData: Array.from(record)
    };
  });
  if (records.length < 2) return [];

  const hourlyRecords = getRwRelativeHourlyRecords(records);
  if (hourlyRecords.length === 0) return [];

  const sequenceStartIndex = records.findIndex((record) => record === hourlyRecords[0]);
  const leadingCurrentSnapshot = sequenceStartIndex > 0 ? records[0] : null;
  const lastHourlyRecord = hourlyRecords[hourlyRecords.length - 1];
  const leadingStepCount = leadingCurrentSnapshot == null ? null : parseRwStepCountValue(leadingCurrentSnapshot.stepCount);
  const lastHourlyStepCount = parseRwStepCountValue(lastHourlyRecord?.stepCount);
  const shouldUseLeadingCurrentSnapshot =
    leadingCurrentSnapshot != null &&
    leadingStepCount != null &&
    leadingStepCount > 0 &&
    Number(leadingCurrentSnapshot.rawTime) > Number(lastHourlyRecord?.rawTime || 0) &&
    (lastHourlyStepCount == null || leadingStepCount >= lastHourlyStepCount);
  const displayRecords = shouldUseLeadingCurrentSnapshot
    ? [...hourlyRecords.slice(0, -1), leadingCurrentSnapshot]
    : hourlyRecords;

  const currentHour = new Date().getHours();
  const lastHourlyIndex = displayRecords.length - 1;
  return displayRecords
    .map((record, index) => {
      const stepCount = parseRwStepCountValue(record.stepCount);
      if (stepCount == null || stepCount <= 0) return null;
      const hour = clampRwHour(currentHour - (lastHourlyIndex - index));
      return createRwStepHistoryRecord({
        rawDataType: 'ab_activity_current_day_relative_hour',
        unixTime: getRwCurrentDayHourTimestamp(hour),
        hour,
        stepCount,
        calorie: Math.floor(Number(record.calorieRaw || 0) / 10),
        distance: Math.floor(Number(record.distanceRaw || 0) / 10000),
        calorieRaw: record.calorieRaw,
        distanceRaw: record.distanceRaw,
        rawJlTimeSeconds: record.rawTime,
        timestampSource: 'current_day_key_relative_hour',
        sequenceIndex: record.sequenceIndex,
        rawData: record.rawData
      });
    })
    .filter(Boolean) as Array<Record<string, any>>;
}

function getRwRelativeHourlyRecords(records: Array<Record<string, any>>): Array<Record<string, any>> {
  const isHourlySequence = (items: Array<Record<string, any>>) => {
    if (items.length < 2) return false;
    let sequentialCount = 0;
    for (let index = 1; index < items.length; index += 1) {
      if (Number(items[index].rawTime) - Number(items[index - 1].rawTime) === 3600) sequentialCount += 1;
    }
    return sequentialCount >= Math.max(1, items.length - 2);
  };

  if (records.length > 2 && isHourlySequence(records.slice(1))) return records.slice(1);
  return isHourlySequence(records) ? records : [];
}

function parseRwJl2ActivityRecords(data: Uint8Array, currentDay: boolean): Array<Record<string, any>> {
  const recordSize = 16;
  if (data.length < recordSize || data.length % recordSize !== 0) return [];

  const records: Array<Record<string, any>> = [];
  const offsetSeconds = getRwJlTimezoneOffsetSeconds();
  let validTimestampCount = 0;
  for (let offset = 0, index = 0; offset + recordSize <= data.length; offset += recordSize, index += 1) {
    const record = data.slice(offset, offset + recordSize);
    const rawTime = readUint32BE(record, 0);
    const deviceUnixTime = normalizeRwHistoryRecordTimestamp(rawTime + RW_JL_EPOCH_2000_SECONDS - offsetSeconds);
    if (deviceUnixTime != null) validTimestampCount += 1;
    const hour = deviceUnixTime == null ? clampRwHour(index) : new Date(deviceUnixTime * 1000).getHours();
    const stepCount = parseRwStepCountValue(readUint24BE(record, 5));
    if (stepCount == null || stepCount <= 0) continue;

    const calorieRaw = readUint32BE(record, 8);
    const distanceRaw = readUint32BE(record, 12);
    records.push(createRwStepHistoryRecord({
      rawDataType: currentDay ? 'ab_activity_current_day_jl2_hour' : 'ab_activity_history_jl2',
      unixTime: currentDay ? getRwCurrentDayHourTimestamp(hour) : deviceUnixTime,
      hour,
      stepCount,
      calorie: Math.floor(calorieRaw / 10),
      distance: Math.floor(distanceRaw / 10000),
      calorieRaw,
      distanceRaw,
      rawJlTimeSeconds: rawTime,
      deviceUnixTime,
      timestampSource: currentDay ? 'current_day_key_hour' : 'jl_device_time',
      sequenceIndex: index,
      rawData: Array.from(record)
    }));
  }

  if (validTimestampCount === 0) return [];
  return records;
}

function parseRwActivityRecordsBySize(
  data: Uint8Array,
  size: number,
  parseRecord: (record: Uint8Array, offset: number, index: number) => Record<string, any> | null
) : Array<Record<string, any>> {
  if (data.length < size || data.length % size !== 0) return [];
  const records: Array<Record<string, any>> = [];
  for (let offset = 0, index = 0; offset + size <= data.length; offset += size, index += 1) {
    const record = parseRecord(data.slice(offset, offset + size), offset, index);
    if (record) records.push(record);
  }
  return records;
}

function parseRwStepRecordWithTimestampAndMetrics(record: Uint8Array): Record<string, any> | null {
  const unixTime = normalizeRwHistoryRecordTimestamp(readUint32LE(record, 0));
  const hour = clampRwHour(record[4]);
  const stepCount = parseRwStepCountValue(readUint32LE(record, 5));
  if (!unixTime || stepCount == null || stepCount <= 0) return null;
  return createRwStepHistoryRecord({
    rawDataType: 'ab_activity_history_metrics',
    unixTime,
    hour,
    stepCount,
    calorie: readUint32LE(record, 9),
    distance: readUint32LE(record, 13),
    rawData: Array.from(record)
  });
}

function parseRwStepRecordWithHourAndMetrics(record: Uint8Array, _offset: number, index: number, currentDay = false): Record<string, any> | null {
  const hour = clampRwHour(record[0] ?? index);
  const stepCount = parseRwStepCountValue(readUint32LE(record, 1));
  if (stepCount == null || stepCount <= 0) return null;
  return createRwStepHistoryRecord({
    rawDataType: currentDay ? 'ab_activity_current_day_hour' : 'ab_activity_history_hour',
    unixTime: currentDay ? getRwCurrentDayHourTimestamp(hour) : Math.floor(Date.now() / 1000),
    hour,
    stepCount,
    calorie: readUint32LE(record, 5),
    distance: readUint32LE(record, 9),
    rawData: Array.from(record)
  });
}

function parseRwStepRecordWithMetrics(record: Uint8Array, _offset: number, index: number, currentDay = false): Record<string, any> | null {
  const stepCount = parseRwStepCountValue(readUint32LE(record, 0));
  if (stepCount == null || stepCount <= 0) return null;
  const hour = currentDay ? clampRwHour(index) : undefined;
  return createRwStepHistoryRecord({
    rawDataType: currentDay ? 'ab_activity_current_day_hour' : 'ab_activity_history_metrics',
    unixTime: currentDay ? getRwCurrentDayHourTimestamp(hour) : Math.floor(Date.now() / 1000),
    hour,
    stepCount,
    calorie: readUint32LE(record, 4),
    distance: readUint32LE(record, 8),
    rawData: Array.from(record)
  });
}

function parseRwStepRecordWithTimestamp32(record: Uint8Array): Record<string, any> | null {
  const unixTime = normalizeRwHistoryRecordTimestamp(readUint32LE(record, 0));
  const stepCount = parseRwStepCountValue(readUint32LE(record, 4));
  if (!unixTime || stepCount == null || stepCount <= 0) return null;
  return createRwStepHistoryRecord({
    rawDataType: 'ab_activity_history',
    unixTime,
    stepCount,
    rawData: Array.from(record)
  });
}

function parseRwStepRecordWithTimestamp16(record: Uint8Array): Record<string, any> | null {
  const unixTime = normalizeRwHistoryRecordTimestamp(readUint32LE(record, 0));
  const stepCount = parseRwStepCountValue(readUint16LE(record, 4));
  if (!unixTime || stepCount == null || stepCount <= 0) return null;
  return createRwStepHistoryRecord({
    rawDataType: 'ab_activity_history_compact',
    unixTime,
    stepCount,
    rawData: Array.from(record)
  });
}

function normalizeRwActivityRecord(record: Record<string, any>): Record<string, any> | null {
  const stepCount = parseRwStepCountValue(record.stepCount ?? record.step ?? record.steps);
  if (stepCount == null || stepCount <= 0) return null;
  const unixTime = normalizeRwHistoryRecordTimestamp(Number(record.timestamp || record.unixTime || record.time)) ||
    Math.floor(Date.now() / 1000);
  return createRwStepHistoryRecord({
    ...record,
    rawDataType: record.rawDataType || 'ab_activity_text',
    unixTime,
    stepCount
  });
}

function createRwStepHistoryRecord(record: Record<string, any>): Record<string, any> {
  const unixTime = normalizeRwHistoryRecordTimestamp(Number(record.unixTime || record.timestamp)) ||
    Math.floor(Date.now() / 1000);
  return {
    dataType: 'step',
    rawDataType: 'ab_activity_history',
    timestamp: unixTime,
    unixTime,
    ...record,
    step: record.stepCount,
    stepCount: record.stepCount
  };
}

function parseRwSleepHistoryRecords(data: Uint8Array): Array<Record<string, any>> {
  const textRecords = parseRwTextRecords(data, 'sleep')
    .map((record) => normalizeRwSleepRecord(record))
    .filter(Boolean) as Array<Record<string, any>>;
  if (textRecords.length > 0) return textRecords;

  const jlSegmentRecords = parseRwJlSleepHistoryRecords(data);
  if (jlSegmentRecords.length > 0) return jlSegmentRecords;

  return selectBestRwFixedHistoryRecords([
    parseRwSleepRecordsBySize(data, 8, parseRwSleepRecordWithTypeAndDuration),
    parseRwSleepRecordsBySize(data, 6, parseRwSleepRecordWithDuration),
    parseRwSleepRecordsBySize(data, 5, parseRwSleepRecordCompact)
  ]);
}

interface RwJlSleepPoint {
  index: number;
  rawTime: number;
  unixTime: number;
  sleepModel: number;
  reserved: number[];
  rawData: number[];
  timestampSource: string;
}

function parseRwJlSleepHistoryRecords(data: Uint8Array): Array<Record<string, any>> {
  const points = parseRwJlSleepPoints(data);
  if (points.length < 2) return [];

  const records: Array<Record<string, any>> = [];
  let active = false;
  let blockStart: RwJlSleepPoint | null = null;
  let previous: RwJlSleepPoint | null = null;

  for (const point of points) {
    if (point.sleepModel === RW_JL_SLEEP_START_MODEL) {
      active = true;
      blockStart = point;
      previous = point;
      continue;
    }

    if (point.sleepModel === RW_JL_SLEEP_END_MODEL) {
      if (active && previous) {
        const record = createRwJlSleepSegmentRecord(previous, point, blockStart);
        if (record) records.push(record);
      }
      active = false;
      blockStart = null;
      previous = null;
      continue;
    }

    if (!active) {
      active = true;
      blockStart = point;
      previous = point;
      continue;
    }

    if (previous) {
      const record = createRwJlSleepSegmentRecord(previous, point, blockStart);
      if (record) records.push(record);
    }
    previous = point;
  }

  return records;
}

function parseRwJlSleepPoints(data: Uint8Array): RwJlSleepPoint[] {
  if (data.length < RW_JL_SLEEP_RECORD_SIZE * 2 || data.length % RW_JL_SLEEP_RECORD_SIZE !== 0) return [];

  const offsetSeconds = getRwJlTimezoneOffsetSeconds();
  const points: RwJlSleepPoint[] = [];
  for (let offset = 0, index = 0; offset + RW_JL_SLEEP_RECORD_SIZE <= data.length; offset += RW_JL_SLEEP_RECORD_SIZE, index += 1) {
    const rawRecord = data.slice(offset, offset + RW_JL_SLEEP_RECORD_SIZE);
    const sleepModel = rawRecord[4] || 0;
    if (!isRwJlSleepModel(sleepModel)) return [];

    const rawTime = readUint32BE(rawRecord, 0);
    const unixTime = normalizeRwHistoryRecordTimestamp(rawTime + RW_JL_EPOCH_2000_SECONDS - offsetSeconds);
    if (!unixTime) return [];

    points.push({
      index,
      rawTime,
      unixTime,
      sleepModel,
      reserved: [rawRecord[5] || 0, rawRecord[6] || 0],
      rawData: Array.from(rawRecord),
      timestampSource: 'device_jl_seconds_since_2000'
    });
  }

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].unixTime <= points[index - 1].unixTime) return [];
  }

  return points;
}

function createRwJlSleepSegmentRecord(
  previous: RwJlSleepPoint,
  current: RwJlSleepPoint,
  blockStart: RwJlSleepPoint | null
): Record<string, any> | null {
  const durationMinutes = Math.floor((current.unixTime - previous.unixTime) / 60);
  if (durationMinutes <= 0 || durationMinutes > 24 * 60) return null;

  return createRwSleepHistoryRecord({
    rawDataType: 'ab_sleep_jl_segment',
    unixTime: previous.unixTime,
    startTimestamp: previous.unixTime,
    endTimestamp: current.unixTime,
    startTime: previous.unixTime,
    endTime: current.unixTime,
    blockStartTimestamp: blockStart?.unixTime,
    sleepStatus: previous.sleepModel,
    sleepModel: previous.sleepModel,
    sdkSleepType: mapRwJlSleepModelToSdkSleepType(previous.sleepModel),
    durationMinutes,
    rawJlTimeSeconds: previous.rawTime,
    rawJlEndTimeSeconds: current.rawTime,
    timestampSource: previous.timestampSource,
    rawData: previous.rawData,
    rawNextData: current.rawData,
    rawSegmentData: [...previous.rawData, ...current.rawData]
  });
}

function parseRwSleepRecordsBySize(
  data: Uint8Array,
  size: number,
  parseRecord: (record: Uint8Array) => Record<string, any> | null
) : Array<Record<string, any>> {
  if (data.length < size || data.length % size !== 0) return [];
  const records: Array<Record<string, any>> = [];
  for (let offset = 0; offset + size <= data.length; offset += size) {
    const record = parseRecord(data.slice(offset, offset + size));
    if (record) records.push(record);
  }
  return records;
}

function parseRwSleepRecordWithTypeAndDuration(record: Uint8Array): Record<string, any> | null {
  const sleepType = record[0] || 0;
  const unixTime = normalizeRwHistoryRecordTimestamp(readUint32LE(record, 1));
  const sleepStatus = record[5] || 0;
  const durationMinutes = readUint16LE(record, 6);
  return createRwSleepHistoryRecord({
    rawDataType: 'ab_sleep_history',
    unixTime,
    sleepType,
    sleepStatus,
    durationMinutes,
    rawData: Array.from(record)
  });
}

function parseRwSleepRecordWithDuration(record: Uint8Array): Record<string, any> | null {
  const unixTime = normalizeRwHistoryRecordTimestamp(readUint32LE(record, 0));
  const sleepStatus = record[4] || 0;
  const durationMinutes = record[5] || RW_JL_SLEEP_DEFAULT_DURATION_MINUTES;
  return createRwSleepHistoryRecord({
    rawDataType: 'ab_sleep_history_compact_duration',
    unixTime,
    sleepStatus,
    durationMinutes,
    rawData: Array.from(record)
  });
}

function parseRwSleepRecordCompact(record: Uint8Array): Record<string, any> | null {
  const unixTime = normalizeRwHistoryRecordTimestamp(readUint32LE(record, 0));
  const sleepStatus = record[4] || 0;
  return createRwSleepHistoryRecord({
    rawDataType: 'ab_sleep_history_compact',
    unixTime,
    sleepStatus,
    durationMinutes: RW_JL_SLEEP_DEFAULT_DURATION_MINUTES,
    rawData: Array.from(record)
  });
}

function normalizeRwSleepRecord(record: Record<string, any>): Record<string, any> | null {
  return createRwSleepHistoryRecord({
    ...record,
    rawDataType: record.rawDataType || 'ab_sleep_text',
    unixTime: normalizeRwHistoryRecordTimestamp(Number(record.timestamp || record.unixTime || record.time)),
    sleepStatus: record.sleepStatus ?? record.sleepState ?? record.sleepType ?? record.sleepModel,
    durationMinutes: record.durationMinutes ?? record.sleepDurationMinutes ?? record.sleepMinutes ?? record.len
  });
}

function createRwSleepHistoryRecord(record: Record<string, any>): Record<string, any> | null {
  const unixTime = normalizeRwHistoryRecordTimestamp(Number(record.unixTime || record.timestamp));
  const sleepStatus = Number(record.sleepStatus ?? record.sleepState ?? record.sleepType ?? record.sleepModel);
  const sleepState = mapRwJlSleepModelToL19SleepState(sleepStatus);
  const durationMinutes = normalizeRwSleepDurationMinutes(record.durationMinutes);
  if (!unixTime || sleepState == null || durationMinutes == null) return null;
  return {
    dataType: 'sleep',
    rawDataType: 'ab_sleep_history',
    timestamp: unixTime,
    unixTime,
    sleepStatus,
    sleepStatusText: getRwJlSleepStatusText(sleepStatus),
    sleepState,
    durationMinutes,
    timeLen: durationMinutes,
    ...record
  };
}

function parseRwStepCountValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 300000) return null;
  return Math.floor(numeric);
}

const RW_JL_SLEEP_DEFAULT_DURATION_MINUTES = 5;
const RW_JL_SLEEP_RECORD_SIZE = 7;
const RW_JL_EPOCH_2000_SECONDS = 946684800;
const RW_JL_SLEEP_START_MODEL = 0x11;
const RW_JL_SLEEP_END_MODEL = 0x22;

function mapRwJlSleepModelToL19SleepState(status: number) {
  if (status === 0) return 1;
  if (status === 1) return 3;
  if (status === 2) return 4;
  if (status === 3) return 1;
  if (status === 4) return 2;
  if (status === RW_JL_SLEEP_START_MODEL) return 3;
  return undefined;
}

function mapRwJlSleepModelToSdkSleepType(status: number) {
  if (status === RW_JL_SLEEP_START_MODEL) return 1;
  if (status === 1) return 2;
  if (status === 2) return 1;
  if (status === 3) return 0;
  if (status === 4) return 3;
  return 0;
}

function getRwJlSleepStatusText(status: number) {
  if (status === 0 || status === 3) return '清醒';
  if (status === 1 || status === RW_JL_SLEEP_START_MODEL) return '浅睡';
  if (status === 2) return '深睡';
  if (status === 4) return '快速眼动';
  if (status === RW_JL_SLEEP_END_MODEL) return '睡眠结束';
  return '未知';
}

function isRwJlSleepModel(value: number) {
  return [0, 1, 2, 3, 4, RW_JL_SLEEP_START_MODEL, RW_JL_SLEEP_END_MODEL].includes(value);
}

function getRwJlTimezoneOffsetSeconds() {
  return -new Date().getTimezoneOffset() * 60;
}

function normalizeRwSleepDurationMinutes(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 24 * 60) return null;
  return Math.floor(numeric);
}

function selectBestRwFixedHistoryRecords(candidates: Array<Array<Record<string, any>>>) {
  return candidates.reduce<Array<Record<string, any>>>((best, records) => (records.length > best.length ? records : best), []);
}

function getRwCurrentDayHourTimestamp(hour?: number) {
  const date = new Date();
  date.setHours(clampRwHour(hour), 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function clampRwHour(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(23, Math.floor(numeric)));
}

function isPlausibleRwHistoryTimestamp(value: number) {
  return normalizeRwHistoryRecordTimestamp(value) != null;
}

function normalizeRwHistoryRecordTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const minTimestamp = 1577836800;
  const maxTimestamp = Math.floor(Date.now() / 1000) + 10 * 60;
  return value >= minTimestamp && value <= maxTimestamp ? value : null;
}

function parseCompactStatusPrefixedHealthDataValue(key: number, data: Uint8Array) {
  if (data.length < 2) return undefined;
  if ((key === RwKey.Temperature || key === RwKey.AppRealTimeTemperature) && data.length >= 3) {
    return parseRwTemperatureValue(data, 1);
  }
  if ((key === RwKey.BloodPressure || key === RwKey.AppRealTimeBloodPressure) && data.length >= 3) {
    return {
      systolic: data[1],
      diastolic: data[2]
    };
  }
  if (key === RwKey.BloodOxygen || key === RwKey.AppRealTimeBloodOxygen) {
    return normalizeRwBloodOxygenValue(data[1]);
  }
  if (key === RwKey.HeartRate || key === RwKey.AppRealTimeHeartRate) {
    return normalizeRwHeartRateValue(data[1]);
  }
  return data[1];
}

function parseRwTemperatureValue(data: Uint8Array, offset: number) {
  const raw = readInt16LE(data, offset);
  if (isHumanTemperature(raw)) return raw;

  const centiDegree = Number((raw / 100).toFixed(2));
  if (isHumanTemperature(centiDegree)) return centiDegree;

  const deciDegree = Number((raw / 10).toFixed(1));
  if (isHumanTemperature(deciDegree)) return deciDegree;

  return deciDegree;
}

function isHumanTemperature(value: number) {
  return value >= 25 && value <= 45;
}

function normalizeRwTemperatureValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !isHumanTemperature(numeric)) return null;
  return numeric;
}

function normalizeRwBloodPressureValue(systolicValue: unknown, diastolicValue: unknown) {
  const systolic = Number(systolicValue);
  const diastolic = Number(diastolicValue);
  if (
    !Number.isFinite(systolic) ||
    !Number.isFinite(diastolic) ||
    systolic < 60 ||
    systolic > 260 ||
    diastolic < 30 ||
    diastolic > 180 ||
    systolic <= diastolic
  ) {
    return null;
  }
  return {
    systolic,
    diastolic,
    bloodPressure: `${systolic}/${diastolic}`
  };
}

function normalizeRwBloodSugarValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const normalized = numeric > 30 && numeric <= 300 ? Number((numeric / 10).toFixed(1)) : numeric;
  return normalized > 0 && normalized <= 30 ? normalized : null;
}

function isStatusPrefixedRealtimePayload(key: number, data: Uint8Array) {
  return [
    RwKey.AppRealTimeHeartRate,
    RwKey.AppRealTimeBloodPressure,
    RwKey.AppRealTimeTemperature,
    RwKey.AppRealTimeBloodOxygen,
    RwKey.AppRealTimeStress,
    RwKey.AppRealTimeHrv,
    RwKey.AppRealTimeBloodSugar
  ].includes(key) && data.length >= 5 && isHealthDataStatusByte(data[0]);
}

function isHealthDataStatusByte(value?: number) {
  return value === 0x11 || value === 0x31;
}

function getHealthDataStatus(value?: number) {
  if (value === 0x11) return 'ack';
  if (value === 0x31) return 'nack';
  return 'pending';
}

function getHealthDataStatusMessage(value?: number) {
  if (value === 0x11) return '设备已确认测量请求，等待真实数据';
  if (value === 0x31) return '设备返回失败应答，未返回真实数据';
  return '设备未返回真实数据';
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] || 0) * 0x1000000) +
    ((bytes[offset + 1] || 0) << 16) +
    ((bytes[offset + 2] || 0) << 8) +
    (bytes[offset + 3] || 0)
  );
}

function readUint24BE(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] || 0) << 16) + ((bytes[offset + 1] || 0) << 8) + (bytes[offset + 2] || 0);
}

function parseTimeFrame(subcmd: number, frameId: number, data: Uint8Array, raw: Uint8Array): RingParsedData {
  if (subcmd === RwTimeSubcommand.Read && data.length >= 9) {
    const deviceTimestamp = readUint64LE(data, 0);
    return {
      type: 'device_time',
      protocol: 'rw',
      frameId,
      timestamp: Date.now(),
      deviceTimestamp,
      timezone: data[8],
      readable: new Date(deviceTimestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      raw: Array.from(raw)
    };
  }

  return {
    type: 'rw_time_ack',
    protocol: 'rw',
    subcmd,
    frameId,
    timestamp: Date.now(),
    raw: Array.from(raw)
  };
}

function parseFileSystemFrame(subcmd: number, frameId: number, data: Uint8Array, raw: Uint8Array): RingParsedData {
  if (subcmd === RwFileSystemSubcommand.ReadFileList) {
    return {
      type: 'rw_file_list',
      protocol: 'rw',
      frameId,
      timestamp: Date.now(),
      files: parseFileList(data),
      raw: Array.from(raw)
    };
  }

  if (subcmd === RwFileSystemSubcommand.RequestUpload && data.length >= 9) {
    const status = data[0];
    return {
      type: 'rw_upload_request',
      protocol: 'rw',
      frameId,
      timestamp: Date.now(),
      status: getUploadRequestStatusText(status),
      statusCode: status,
      statusText: getUploadRequestStatusText(status),
      startTimestamp: readUint32LE(data, 1),
      endTimestamp: readUint32LE(data, 5),
      raw: Array.from(raw)
    };
  }

  if (subcmd === RwFileSystemSubcommand.UploadFile && data.length >= 46) {
    const fileName = decodeAscii(data.slice(10, 46));
    const fileType = fileName.split('_')[2]?.replace(/\.txt$/i, '');
    const payload = data.slice(46);
    const ppgGroupSize = /red|ir|spo2|oxygen/i.test(fileType || fileName) ? 12 : 5;
    return {
      type: 'rw_upload_file',
      protocol: 'rw',
      frameId,
      timestamp: Date.now(),
      seq: data[0],
      status: getUploadFileStatusText(data[1]),
      statusCode: data[1],
      startTimestamp: readUint32LE(data, 2),
      endTimestamp: readUint32LE(data, 6),
      fileName,
      fileType,
      payloadHex: payload.length > 0 ? bytesToHex(payload) : undefined,
      records: payload.length > 0 ? parseRwUploadRecords(payload, fileType, fileName, ppgGroupSize) : [],
      raw: Array.from(raw)
    };
  }

  if (subcmd === RwFileSystemSubcommand.UploadProgress || subcmd === RwFileSystemSubcommand.LastPackageProgress) {
    return {
      type: subcmd === RwFileSystemSubcommand.UploadProgress ? 'rw_upload_progress' : 'rw_last_package_progress',
      protocol: 'rw',
      frameId,
      timestamp: Date.now(),
      seq: data[0],
      progress: data[1],
      raw: Array.from(raw)
    };
  }

  if (subcmd === RwFileSystemSubcommand.Format) {
    return {
      type: 'rw_format_file_system',
      protocol: 'rw',
      frameId,
      timestamp: Date.now(),
      status: data[0] === 1 ? 'success' : 'failed',
      statusCode: data[0],
      statusText: data[0] === 1 ? 'success' : 'failed',
      raw: Array.from(raw)
    };
  }

  return {
    type: 'rw_file_system',
    protocol: 'rw',
    subcmd,
    frameId,
    timestamp: Date.now(),
    raw: Array.from(raw)
  };
}

function parseSystemFrame(subcmd: number, frameId: number, raw: Uint8Array): RingParsedData {
  if (subcmd === 0x02) {
    return {
      type: 'restore_factory_settings',
      protocol: 'rw',
      frameId,
      success: true,
      status: 'success',
      statusCode: 1,
      statusText: 'success',
      raw: Array.from(raw),
      timestamp: Date.now()
    };
  }

  return {
    type: 'rw_system',
    protocol: 'rw',
    subcmd,
    frameId,
    timestamp: Date.now(),
    raw: Array.from(raw)
  };
}

export const parseFileList = (data: Uint8Array): RwFileListItem[] => {
  const items: RwFileListItem[] = [];
  const itemSize = 39;

  for (let offset = 0; offset + itemSize <= data.length; offset += itemSize) {
    const total = readUint32LE(data, offset);
    const seq = readUint32LE(data, offset + 4);
    const fileSize = readUint32LE(data, offset + 8);
    const fileName = decodeAscii(data.slice(offset + 12, offset + itemSize));
    if (total === 0 && seq === 0 && !fileName) continue;

    const parts = fileName.split('_');
    items.push({
      total,
      seq,
      fileSize,
      fileName,
      userId: parts[0],
      timestampText: parts[1],
      fileType: parts[2]?.replace(/\.txt$/i, '')
    });
  }

  return items;
};

export const parseRwSourceRecords = (data: Uint8Array, ppgGroupSize: 5 | 12) => {
  const headerSize = 17;
  const itemSize = 8 + 30 + ppgGroupSize * 2;
  const records: any[] = [];

  if (data.length < headerSize) return records;

  for (let offset = headerSize; offset + itemSize <= data.length; offset += itemSize) {
    const timestamp = readUint64LE(data, offset);
    const ppgOffset = offset + 8;
    const ppg: number[] = [];
    for (let index = 0; index < ppgGroupSize; index++) {
      ppg.push(readInt16LE(data, ppgOffset + index * 2));
    }

    records.push({
      timestamp,
      green: ppg[0],
      red: ppg[1],
      ir: ppg[2],
      ppg,
      accX: readInt16LE(data, ppgOffset + ppgGroupSize * 2),
      accY: readInt16LE(data, ppgOffset + ppgGroupSize * 2 + 2),
      accZ: readInt16LE(data, ppgOffset + ppgGroupSize * 2 + 4)
    });
  }

  return records;
};

export const parseRwUploadRecords = (data: Uint8Array, fileType = '', fileName = '', ppgGroupSize: 5 | 12 = 5) => {
  const textRecords = parseRwTextRecords(data, fileType || fileName);
  if (textRecords.length > 0) return textRecords;
  return parseRwSourceRecords(data, ppgGroupSize);
};

const parseRwTextRecords = (data: Uint8Array, typeHint: string) => {
  const text = decodeUtf8Text(data).trim();
  if (!isMostlyPrintableText(text)) return [];
  if (!text) return [];

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((record) =>
            record && typeof record === 'object'
              ? normalizeRwTextHistoryRecord(record as Record<string, any>, typeHint)
              : null
          )
          .filter((record): record is Record<string, any> => Boolean(record));
      }
    } catch {
      return [];
    }
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseRwTextRecordLine(line, typeHint))
    .filter((record): record is Record<string, any> => Boolean(record));
};

const parseRwTextRecordLine = (line: string, typeHint: string) => {
  if (line.startsWith('{') && line.endsWith('}')) {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === 'object' ? normalizeRwTextHistoryRecord(parsed as Record<string, any>, typeHint) : null;
    } catch {
      return null;
    }
  }

  const keyValueRecord = parseRwKeyValueTextRecord(line, typeHint);
  if (keyValueRecord) return keyValueRecord;

  const values = line.split(/[\s,;|]+/).filter(Boolean);
  if (values.length < 2) return null;
  const timestamp = parseRwTextTimestamp(values[0]);
  const numericValues = values.slice(1).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numericValues.length === 0) return null;
  return normalizeRwTextHistoryRecord({ timestamp, values: numericValues }, typeHint);
};

const parseRwKeyValueTextRecord = (line: string, typeHint: string) => {
  const record: Record<string, any> = {};
  let hasKeyValue = false;
  const keyValuePattern = /(?:^|[\s,;|])([^:=\s,;|]+)\s*[:=]\s*(.*?)(?=(?:[\s,;|]+[^:=\s,;|]+\s*[:=])|$)/g;
  let matched: RegExpExecArray | null;

  while ((matched = keyValuePattern.exec(line)) !== null) {
    const rawValue = matched[2].trim();
    if (!rawValue) continue;

    hasKeyValue = true;
    const key = matched[1].trim();
    const numericValue = Number(rawValue);
    record[key] = Number.isFinite(numericValue) ? numericValue : rawValue;
  }

  if (record.timestamp == null) {
    const firstToken = line.split(/[\s,;|]+/).find((token) => token && !/[:=]/.test(token));
    const timestamp = parseRwTextTimestamp(firstToken);
    if (timestamp) record.timestamp = timestamp;
  }

  if (!hasKeyValue) return null;
  return normalizeRwTextHistoryRecord(record, typeHint);
};

const normalizeRwTextHistoryRecord = (record: Record<string, any>, typeHint: string) => {
  const normalized: Record<string, any> = { ...record };
  const values = Array.isArray(record.values) ? record.values : [];
  const type = typeHint.toLowerCase();

  normalized.timestamp =
    parseRwTextTimestamp(getRecordAliasValue(record, ['timestamp', 'time', 'unixTime', 'dateTime', 'recordTime', '时间', '日期', '记录时间'])) ||
    record.timestamp;

  const heartRateAliases = ['heartRate', 'heart_rate', 'hr', '心率'];
  const bloodOxygenAliases = ['bloodOxygen', 'blood_oxygen', 'bloodOxy', 'spo2', 'oxygen', '血氧', '血氧饱和度'];
  const temperatureAliases = [
    'temperature',
    'temperatureValue',
    'temperature_value',
    'temp',
    'bodyTemperature',
    'body_temperature',
    'bodyTemperatureValue',
    'body_temperature_value',
    'bodyTemp',
    'body_temp',
    'bodyTempValue',
    'body_temp_value',
    'skinTemperature',
    'skin_temperature',
    'skinTemperatureValue',
    'skin_temperature_value',
    'skinTemp',
    'skin_temp',
    '体温',
    '皮温',
    '温度'
  ];
  const hrvAliases = ['hrv', 'hrvValue', 'hrv_value', 'heartRateVariability', 'heart_rate_variability', 'heartRateVariabilityValue', 'heart_rate_variability_value', 'rmssd', '心率变异性'];
  const stressAliases = ['stress', 'stressValue', 'stress_value', 'stressIndex', 'stress_index', 'avgStress', 'avg_stress', 'avgStressValue', 'avg_stress_value', 'pressure', 'pressureValue', 'pressure_value', '压力', '压力值'];
  const bloodSugarAliases = ['bloodSugar', 'blood_sugar', 'bloodSugarValue', 'blood_sugar_value', 'glucose', 'sugar', '血糖', '葡萄糖'];
  const systolicAliases = ['systolic', 'systolicValue', 'systolic_value', 'sbp', 'sp', 'high', 'highPressure', 'high_pressure', 'bloodPressureHigh', 'blood_pressure_high', '收缩压', '高压'];
  const diastolicAliases = ['diastolic', 'diastolicValue', 'diastolic_value', 'dbp', 'dp', 'low', 'lowPressure', 'low_pressure', 'bloodPressureLow', 'blood_pressure_low', '舒张压', '低压'];
  const pairedBloodPressureAliases = ['bloodPressure', 'blood_pressure', 'bloodPressureValue', 'blood_pressure_value', 'bp', 'bpValue', 'bp_value', '血压'];
  const stepAliases = ['stepCount', 'step_count', 'steps', 'step', '步数', '步'];
  const calorieAliases = ['calorie', 'calories', 'calorieValue', 'calorie_value', 'kcal', 'motionCalorie', 'motion_calorie', '卡路里', '千卡', '热量'];
  const activityMinutesAliases = ['activityMinutes', 'activity_minutes', 'activeMinutes', 'active_minutes', 'motionTime', 'motion_time', '活动分钟', '活动时长', '运动时长'];
  const distanceAliases = ['distance', 'distanceKm', 'distance_km', 'mileage', '距离', '里程'];
  const activityLevelAliases = ['activityLevel', 'activity_level', 'motionLevel', 'motion_level', 'intensity', 'intensityLevel', 'intensity_level', '活动等级', '运动等级', '运动强度', '强度'];


  if (/heart|(^|[_\-.])hr($|[_\-.])/.test(type) || hasRecordAlias(record, heartRateAliases)) {
    normalized.heartRate = getFirstFiniteNumber(record, values, heartRateAliases);
  }
  if (/spo2|oxygen|blood[_-]?oxy|\bbo\b/.test(type) || hasRecordAlias(record, bloodOxygenAliases)) {
    const bloodOxygen = normalizeRwBloodOxygenValue(getFirstFiniteNumber(record, values, bloodOxygenAliases));
    if (bloodOxygen == null) {
      delete normalized.bloodOxygen;
      delete normalized.blood_oxygen;
      delete normalized.bloodOxy;
      delete normalized.bloodOxygenSaturation;
      delete normalized.spo2;
      delete normalized.oxygen;
      delete normalized.bo;
    } else {
      normalized.bloodOxygen = bloodOxygen;
      normalized.spo2 = bloodOxygen;
    }
  }
  if (/temperature|temp|body[_-]?temp|skin[_-]?temp/.test(type) || hasRecordAlias(record, temperatureAliases)) {
    normalized.temperature = getFirstFiniteNumber(record, values, temperatureAliases);
  }
  if (/hrv/.test(type) || hasRecordAlias(record, hrvAliases)) normalized.hrv = getFirstFiniteNumber(record, values, hrvAliases);
  if (/stress|(^|[_\-.])pressure($|[_\-.])|fatigue/.test(type) || hasRecordAlias(record, stressAliases)) {
    normalized.stress = getFirstFiniteNumber(record, values, stressAliases);
  }
  if (/blood[_-]?sugar|glucose|\bbs\b/.test(type) || hasRecordAlias(record, bloodSugarAliases)) {
    normalized.bloodSugar = getFirstFiniteNumber(record, values, bloodSugarAliases);
  }
  if (
    /blood[_-]?pressure|(^|[_\-.])bp($|[_\-.])/.test(type) ||
    hasRecordAlias(record, [...systolicAliases, ...diastolicAliases, ...pairedBloodPressureAliases])
  ) {
    normalized.systolic = getFirstFiniteNumber(record, values, systolicAliases);
    normalized.diastolic = getSecondFiniteNumber(record, values, diastolicAliases);
    const pairedBloodPressure = getPairedBloodPressure(record, pairedBloodPressureAliases);
    normalized.systolic = normalized.systolic ?? pairedBloodPressure?.systolic;
    normalized.diastolic = normalized.diastolic ?? pairedBloodPressure?.diastolic;
  }
  if (/step|sport|activity/.test(type) || hasRecordAlias(record, stepAliases)) {
    normalized.stepCount = getFirstFiniteNumber(record, values, stepAliases);
  }
  if (
    /step|sport|activity/.test(type) ||
    hasRecordAlias(record, [...calorieAliases, ...activityMinutesAliases, ...distanceAliases, ...activityLevelAliases])
  ) {
    normalized.calorie = getFiniteNumberAt(record, values, calorieAliases, 1);
    normalized.activityMinutes = getFiniteNumberAt(record, values, activityMinutesAliases, 2);
    normalized.distance = getFiniteNumberAt(record, values, distanceAliases, 3);
    normalized.activityLevel = getFiniteNumberAt(record, values, activityLevelAliases, 4);
  }
  if (/sleep/.test(type)) {
    normalized.sleepState = getFirstFiniteNumber(record, values, [
      'sleepState',
      'sleep_state',
      'sleepStatus',
      'sleep_status',
      'sleepType',
      'sleep_type',
      'sleepStage',
      'sleep_stage',
      'state',
      'stage',
      'status',
      '睡眠状态',
      '睡眠阶段',
      '睡眠类型',
      '状态',
      '阶段'
    ]);
    normalized.durationMinutes = getSecondFiniteNumber(record, values, [
      'totalSleepTime',
      'total_sleep_time',
      'sleepTotalMinutes',
      'sleep_total_minutes',
      'sleepDuration',
      'sleep_duration',
      'durationMinutes',
      'duration_minutes',
      'sleepDurationMinutes',
      'sleep_duration_minutes',
      'sleepMinutes',
      'sleep_minutes',
      'totalMinutes',
      'total_minutes',
      'minutes',
      'minute',
      'duration',
      'sleepLen',
      'sleep_len',
      'len',
      '睡眠时长',
      '总睡眠',
      '总睡眠时长',
      '持续时间',
      '时长',
      '分钟'
    ]);
  }

  return normalized;
};

const parseRwTextTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  if (typeof value !== 'string' || !value.trim()) return 0;
  const compactDate = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compactDate) {
    const parsedCompact = Date.parse(`${compactDate[1]}-${compactDate[2]}-${compactDate[3]}T${compactDate[4]}:${compactDate[5]}:${compactDate[6]}`);
    return Number.isFinite(parsedCompact) ? Math.floor(parsedCompact / 1000) : 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
};

const getFirstFiniteNumber = (record: Record<string, any>, values: unknown[], aliases: string[]) => {
  const aliasValue = getRecordAliasValue(record, aliases);
  const numericAliasValue = Number(aliasValue);
  if (Number.isFinite(numericAliasValue)) return numericAliasValue;
  const value = Number(values[0]);
  return Number.isFinite(value) ? value : undefined;
};

const getSecondFiniteNumber = (record: Record<string, any>, values: unknown[], aliases: string[]) => {
  const aliasValue = getRecordAliasValue(record, aliases);
  const numericAliasValue = Number(aliasValue);
  if (Number.isFinite(numericAliasValue)) return numericAliasValue;
  const value = Number(values[1] ?? values[0]);
  return Number.isFinite(value) ? value : undefined;
};

const getFiniteNumberAt = (record: Record<string, any>, values: unknown[], aliases: string[], index: number) => {
  const aliasValue = getRecordAliasValue(record, aliases);
  const numericAliasValue = Number(aliasValue);
  if (Number.isFinite(numericAliasValue)) return numericAliasValue;
  const value = Number(values[index]);
  return Number.isFinite(value) ? value : undefined;
};

const getPairedBloodPressure = (record: Record<string, any>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = getRecordAliasValue(record, [alias]);
    if (value && typeof value === 'object') {
      const systolic = getFirstFiniteNumber(value as Record<string, any>, [], ['systolic', 'systolicValue', 'systolic_value', 'sbp', 'sp', 'high', 'highPressure', 'high_pressure']);
      const diastolic = getFirstFiniteNumber(value as Record<string, any>, [], ['diastolic', 'diastolicValue', 'diastolic_value', 'dbp', 'dp', 'low', 'lowPressure', 'low_pressure']);
      if (systolic != null || diastolic != null) return { systolic, diastolic };
    }
    if (typeof value === 'string') {
      const matched = value.match(/(\d{2,3})\D+(\d{2,3})/);
      if (matched) {
        return {
          systolic: Number(matched[1]),
          diastolic: Number(matched[2])
        };
      }
    }
  }
  return null;
};

const getRecordAliasValue = (record: Record<string, any>, aliases: string[]) => {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, alias)) return record[alias];
  }

  const lowerCaseEntries = Object.entries(record).reduce<Record<string, any>>((result, [key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(result, normalizedKey)) result[normalizedKey] = value;
    return result;
  }, {});

  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(lowerCaseEntries, normalizedAlias)) return lowerCaseEntries[normalizedAlias];
  }

  return undefined;
};

const hasRecordAlias = (record: Record<string, any>, aliases: string[]) =>
  getRecordAliasValue(record, aliases) !== undefined;

const decodeUtf8Text = (bytes: Uint8Array) => {
  let result = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0) continue;
    if (byte < 0x80) {
      result += String.fromCharCode(byte);
      continue;
    }

    if (byte >= 0xc2 && byte <= 0xdf && index + 1 < bytes.length) {
      const next = bytes[index + 1];
      if ((next & 0xc0) === 0x80) {
        result += String.fromCharCode(((byte & 0x1f) << 6) | (next & 0x3f));
        index += 1;
        continue;
      }
    }

    if (byte >= 0xe0 && byte <= 0xef && index + 2 < bytes.length) {
      const next = bytes[index + 1];
      const third = bytes[index + 2];
      if ((next & 0xc0) === 0x80 && (third & 0xc0) === 0x80) {
        result += String.fromCharCode(((byte & 0x0f) << 12) | ((next & 0x3f) << 6) | (third & 0x3f));
        index += 2;
        continue;
      }
    }

    result += '\uFFFD';
  }
  return result.replace(/\0+$/g, '');
};

const isMostlyPrintableText = (text: string) => {
  if (text.length === 0) return false;
  let printable = 0;
  let replacement = 0;
  for (const char of text) {
    if (char === '\uFFFD') {
      replacement += 1;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) printable += 1;
  }
  return printable / text.length >= 0.85 && replacement / text.length <= 0.02;
};

function getUploadRequestStatusText(status: number) {
  if (status === 1) return 'ready';
  if (status === 2) return 'completed';
  if (status === 3) return 'seq_mismatch';
  return 'idle';
}

function getUploadFileStatusText(status: number) {
  if (status === 1) return 'start';
  if (status === 2) return 'completed';
  return 'idle';
}

function getChargingStatusText(status: number) {
  if (status === 1) return '充电中';
  if (status === 2) return '充电完成';
  return '未充电';
}

function normalizeRwBatteryForLegacyShape(battery: number, chargingStatus?: number, chargingStatusText?: string) {
  if (battery === 101) {
    return {
      status: 'charging',
      value: chargingStatusText || '\u5145\u7535\u4e2d'
    };
  }

  if (battery === 102) {
    return {
      status: 'charged',
      value: chargingStatusText || '\u5145\u7535\u5b8c\u6210'
    };
  }

  if (chargingStatus === 1) {
    return {
      status: 'charging',
      value: chargingStatusText || '充电中'
    };
  }

  if (chargingStatus === 2) {
    return {
      status: 'charged',
      value: chargingStatusText || '充电完成'
    };
  }

  if (battery >= 0 && battery <= 100) {
    return {
      status: 'normal',
      value: `${battery}%`
    };
  }

  return {
    status: 'unknown',
    value: 'unknown'
  };
}
