import type { RingParsedData } from '../types';

const RESPONSE_FRAME_TYPES = new Set([0x00, 0x01]);

const measureStatusMap: Record<number, string> = {
  0x0: '未佩戴',
  0x1: '佩戴',
  0x2: '充电中不允许采集',
  0x3: '采集中',
  0x4: '繁忙，不执行'
};

const temperatureStatusMap: Record<number, string> = {
  0x0: '测量中',
  0x1: '测量完成',
  0x2: '测量失败并结束',
  0x3: '繁忙，不执行'
};

const readUint32LE = (bytes: Uint8Array, offset: number) => {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
};

const readInt16LE = (bytes: Uint8Array, offset: number) => {
  const value = bytes[offset] | (bytes[offset + 1] << 8);
  return value > 32767 ? value - 65536 : value;
};

const readAscii = (bytes: Uint8Array, start: number, end: number, trim = false) => {
  const value = Array.from(bytes.slice(start, end))
    .map((byte) => String.fromCharCode(byte))
    .join('');
  return trim ? value.trim() : value;
};

const formatRecordTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  const second = `${date.getSeconds()}`.padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const parseVersion = (bytes: Uint8Array, frameId: number, subcmd: number): RingParsedData => {
  const isHardware = subcmd === 0x01;
  const version = readAscii(bytes, 4, 14, !isHardware);

  return {
    type: isHardware ? 'hardwareVersion' : 'softwareVersion',
    frameId,
    value: version,
    status: 'normal',
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseBattery = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const batteryLevel = bytes[4];
  let status = 'normal';
  let value: string | number = batteryLevel;

  if (batteryLevel === 101) {
    status = 'charging';
    value = '充电中';
  } else if (batteryLevel === 102) {
    status = 'charged';
    value = '充电完成';
  } else if (batteryLevel >= 0 && batteryLevel <= 100) {
    value = `${batteryLevel}%`;
  } else {
    status = 'unknown';
    value = 'unknown';
  }

  return {
    type: 'battery',
    frameId,
    value,
    status,
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseActiveMeasure = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const status = bytes[4];
  const heartRate = bytes[5];
  const heartRateVariability = bytes[6];
  const stressIndex = bytes[6];
  const temperature = bytes[7];

  return {
    type: 'active_measure',
    frameId,
    status: measureStatusMap[status] || '未知',
    heartRate: heartRate > 0 ? heartRate : null,
    heartRateVariability: heartRateVariability > 0 ? heartRateVariability : null,
    temperature: temperature > 0 ? `${(temperature / 100).toFixed(2)}°C` : null,
    stressIndex: stressIndex >= 0 && stressIndex <= 100 ? stressIndex : null,
    heartbeatStatus: status,
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseBloodOxygen = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const status = bytes[4];
  const heartRate = bytes[5];
  const bloodOxygen = bytes[6];
  const temperature = bytes[7];

  return {
    type: 'active_OxyGenMeasure',
    frameId,
    status: measureStatusMap[status] || '未知',
    heartRate: heartRate > 0 ? heartRate : 0,
    bloodOxygen: bloodOxygen > 0 ? bloodOxygen : 0,
    temperature: temperature > 0 ? `${temperature}°C` : null,
    bloodOxygenStatus: status,
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseTemperature = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const status = bytes[4];
  const temperature = (readInt16LE(bytes, 5) / 100).toFixed(2);

  return {
    type: 'active_Temperature',
    frameId,
    status: temperatureStatusMap[status] || '未知',
    temperature,
    timestamp: Date.now(),
    temperatureStatus: status,
    raw: Array.from(bytes)
  };
};

const getAckCode = (bytes: Uint8Array) => (bytes.length > 4 ? bytes[4] : undefined);

const parseDeviceTimeUpdateAck = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const ackCode = getAckCode(bytes);
  return {
    type: 'device_time_update_ack',
    frameId,
    status: ackCode === undefined || ackCode === 0 ? 'success' : 'failed',
    ackCode,
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseActiveMeasureProgress = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const progress = getAckCode(bytes);
  return {
    type: 'active_measure_progress',
    frameId,
    status: 'progress',
    progress,
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseActiveMeasureControlAck = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const ackCode = getAckCode(bytes);
  return {
    type: 'active_measure_control_ack',
    frameId,
    status: ackCode === undefined || ackCode === 0 ? 'success' : 'failed',
    ackCode,
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseLocalDataErrorAck = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const ackCode = getAckCode(bytes);
  return {
    type: 'local_data',
    frameId,
    status: 'failed',
    ackStatus: 'command_rejected',
    ackCode,
    totalNum: 0,
    records: [],
    timestamp: Date.now(),
    raw: Array.from(bytes)
  };
};

const parseLocalData = (bytes: Uint8Array, frameId: number): RingParsedData => {
  const totalNum = readUint32LE(bytes, 4);

  if (totalNum === 0xffffffff) {
    return { type: 'local_data', status: 'no_data', records: [], raw: Array.from(bytes) };
  }

  if (totalNum === 0) {
    return { type: 'local_data', status: 'empty', records: [], totalNum: 0, raw: Array.from(bytes) };
  }

  let offset = 8;
  const records: Array<Record<string, any>> = [];

  while (offset + 21 <= bytes.length) {
    const seq = readUint32LE(bytes, offset);
    const unixTime = readUint32LE(bytes, offset + 4);
    const stepCount = bytes[offset + 8] | (bytes[offset + 9] << 8);
    const heartRate = bytes[offset + 10];
    const spo2 = bytes[offset + 11];
    const hrv = bytes[offset + 12];
    const stress = bytes[offset + 13];
    const temperature = Number((readInt16LE(bytes, offset + 14) / 100).toFixed(2));
    const activityLevel = bytes[offset + 16];
    const sleepType = bytes[offset + 17];
    const perfusion = bytes[offset + 18];
    const rrCount = bytes[offset + 20];
    const rrIntervals: number[] = [];
    const rrStart = offset + 21;

    for (let i = 0; i < rrCount && rrStart + i * 2 + 1 < bytes.length; i += 1) {
      rrIntervals.push(bytes[rrStart + i * 2] | (bytes[rrStart + i * 2 + 1] << 8));
    }

    records.push({
      seq,
      unixTime,
      timestamp: new Date(unixTime * 1000).toLocaleString(),
      recordTime: formatRecordTime(unixTime * 1000),
      stepCount,
      heartRate: heartRate > 0 ? heartRate : null,
      spo2: spo2 > 0 ? spo2 : null,
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
    frameId,
    status: 'success',
    totalNum,
    records,
    raw: Array.from(bytes)
  };
};

const parseDeviceTime = (bytes: Uint8Array, frameId: number): RingParsedData | null => {
  const dataStart = 4;
  if (bytes.length < dataStart + 9) return null;

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  for (let i = 0; i < 8; i += 1) {
    view.setUint8(i, bytes[dataStart + i]);
  }

  const timestamp = Number(view.getBigUint64(0, true));
  const timezone = bytes[dataStart + 8];

  return {
    type: 'device_time',
    frameId,
    timestamp: Date.now(),
    deviceTimestamp: timestamp,
    timezone,
    readable: new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    raw: Array.from(bytes)
  };
};

export const parseLegacyRingData = (bytes: Uint8Array): RingParsedData | null => {
  if (bytes.length < 4) return null;

  const frameType = bytes[0];
  const frameId = bytes[1];
  const cmd = bytes[2];
  const subcmd = bytes[3];

  if (!RESPONSE_FRAME_TYPES.has(frameType)) return null;

  if (cmd === 0x11 && (subcmd === 0x00 || subcmd === 0x01)) return parseVersion(bytes, frameId, subcmd);
  if (cmd === 0x12 && subcmd === 0x00) return parseBattery(bytes, frameId);
  if (cmd === 0x31 && subcmd === 0x00) return parseActiveMeasure(bytes, frameId);
  if (cmd === 0x31 && subcmd === 0xff) return parseActiveMeasureProgress(bytes, frameId);
  if (cmd === 0x31 && subcmd === 0x02) return parseActiveMeasureControlAck(bytes, frameId);
  if (cmd === 0x32 && subcmd === 0x00) return parseBloodOxygen(bytes, frameId);
  if (cmd === 0x34 && subcmd === 0x00) return parseTemperature(bytes, frameId);
  if (cmd === 0x36 && subcmd === 0xff) return parseLocalDataErrorAck(bytes, frameId);
  if (cmd === 0x36 && (subcmd === 0x00 || subcmd === 0x01)) return parseLocalData(bytes, frameId);
  if (cmd === 0x10 && subcmd === 0x00) return parseDeviceTimeUpdateAck(bytes, frameId);
  if (cmd === 0x10 && subcmd === 0x01) return parseDeviceTime(bytes, frameId);
  if (cmd === 0x36 && subcmd === 0x03) return { type: 'delete_all_local_data', raw: Array.from(bytes) };

  if (cmd === 0x37 && subcmd === 0x00) {
    if (bytes.length < 5) return null;
    return {
      type: 'collect_period_set',
      frameId,
      status: bytes[4] === 1 ? 'success' : 'failed',
      raw: Array.from(bytes),
      timestamp: Date.now()
    };
  }

  if (cmd === 0x37 && subcmd === 0x01) {
    if (bytes.length < 8) return null;
    const period = readUint32LE(bytes, 4);
    return {
      type: 'collect_period_read',
      frameId,
      period,
      minutes: (period / 60).toFixed(1),
      raw: Array.from(bytes),
      timestamp: Date.now()
    };
  }

  if (cmd === 0x37 && subcmd === 0x02) {
    return {
      type: 'restore_factory_settings',
      frameId,
      success: true,
      raw: Array.from(bytes),
      timestamp: Date.now()
    };
  }

  return null;
};
