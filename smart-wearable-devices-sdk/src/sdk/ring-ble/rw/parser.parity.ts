import { parseRwRingData, parseRwUploadRecords } from './parser';
import { RwKey, RwQkeerV2HistoryCommand, buildRwQkeerV2Packet } from './protocol';

const encodeUtf8 = (value: string) => new TextEncoder().encode(value);
const hexToBytes = (hex: string) => {
  const clean = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};
const uint32Le = (value: number) => new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]);
const buildAbHealthHistoryPacket = (key: RwKey, data: Uint8Array) => {
  const length = 3 + data.length;
  return new Uint8Array([
    0xab,
    0x11,
    (length >> 8) & 0xff,
    length & 0xff,
    0,
    0,
    (key >> 8) & 0xff,
    key & 0xff,
    0x10,
    ...data
  ]);
};
const buildAbHealthHistoryRecordPayload = (unixTime: number, metricBytes: number[]) =>
  new Uint8Array([...uint32Le(unixTime), ...metricBytes]);
const buildQkeerV2HealthRecordPayload = (unixTime: number, heartRate: number, bloodOxygen: number, temperatureRaw = 0) =>
  new Uint8Array([
    ...uint32Le(unixTime),
    heartRate,
    bloodOxygen,
    temperatureRaw & 0xff,
    (temperatureRaw >> 8) & 0xff
  ]);
const uint16Le = (value: number) => new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
const buildQkeerV2SleepRecordPayload = (sleepType: number, unixTime: number, sleepStatus: number, durationMinutes: number) =>
  new Uint8Array([sleepType, ...uint32Le(unixTime), sleepStatus, ...uint16Le(durationMinutes)]);

const compactStatusHeartRate = parseRwRingData(hexToBytes('ab11000500000224101148'));
const compactInvalidStatusHeartRate = parseRwRingData(hexToBytes('ab110005000002241011f1'));
const compactStatusBloodOxygen = parseRwRingData(hexToBytes('ab1100050000024e101162'));
const compactInvalidStatusBloodOxygen = parseRwRingData(hexToBytes('ab1100050000024e10112e'));
const compactStatusTemperature = parseRwRingData(hexToBytes('ab1100060000023010117201'));
const realDeviceBloodOxygen = parseRwRingData(hexToBytes('ab11000951f1024e002e1fe4066300'));
const realDeviceInvalidBloodOxygen = parseRwRingData(hexToBytes('ab11000951f1024e002e1fe4062e00'));
const realDeviceHeartRate = parseRwRingData(hexToBytes('ab11000943e5022400033328cc4600'));
const realDeviceHrv = parseRwRingData(hexToBytes('ab110009135a0269000333281d2200'));
const qkeerV2LastData = parseRwRingData(
  buildRwQkeerV2Packet(
    RwQkeerV2HistoryCommand.LastData,
    new Uint8Array([
      77,
      1,
      0xd2,
      0x04,
      0x00,
      0x00,
      66,
      98,
      0xcd,
      0x11,
      10,
      0,
      80,
      0,
      120,
      0,
      20,
      0,
      0x40,
      0x01,
      0x8a,
      0x02
    ])
  )
);
const qkeerV2InvalidBloodOxygenHistory = parseRwRingData(
  buildRwQkeerV2Packet(RwQkeerV2HistoryCommand.HealthList, buildQkeerV2HealthRecordPayload(1767229820, 72, 46, 0x11cd))
);
const qkeerV2SleepHistory = parseRwRingData(
  buildRwQkeerV2Packet(
    RwQkeerV2HistoryCommand.SleepList,
    new Uint8Array([
      ...buildQkeerV2SleepRecordPayload(1, 1767229200, 1, 120),
      ...buildQkeerV2SleepRecordPayload(2, 1767236400, 2, 180),
      ...buildQkeerV2SleepRecordPayload(3, 1767247200, 5, 15)
    ])
  )
);
const bloodOxygenMonitoring = parseRwRingData(hexToBytes('c61100091234022510010000173b1e'));
const bodyTemperatureDetectingMonitoring = parseRwRingData(hexToBytes('c61100091234021b10ff0000173b3c'));
const bodyTemperatureMonitoring = parseRwRingData(hexToBytes('c61100091234027d10ff0000173b3c'));
const historicalHeartRate = parseRwRingData(hexToBytes('ab110009de9505031031e2aa454a00'));
const invalidHistoricalHeartRate = parseRwRingData(hexToBytes('ab110009de9505031031e2aa45f100'));
const realDeviceHistoricalHeartRate = parseRwRingData(hexToBytes('ab11000979d80503102e234ac14500'));
const realDeviceHistoricalBloodOxygen = parseRwRingData(hexToBytes('ab11000934920509102e234b086200'));
const realDeviceJlSleepHistory = parseRwRingData(
  buildAbHealthHistoryPacket(
    RwKey.Sleep,
    hexToBytes('2e2221701100002e2225a80100002e22283c0200002e222ff8010000')
  )
);
const realDeviceSingleJlSleepPoint = parseRwRingData(hexToBytes('ab11000a5c4e0505102e227f6c220000'));
const historicalTemperature = parseRwRingData(
  buildAbHealthHistoryPacket(RwKey.Temperature, buildAbHealthHistoryRecordPayload(1767229700, [0x74, 0x0e]))
);
const historicalDeciTemperature = parseRwRingData(
  buildAbHealthHistoryPacket(RwKey.Temperature, buildAbHealthHistoryRecordPayload(1767229701, [0x72, 0x01]))
);
const historicalSingleByteTemperature = parseRwRingData(
  buildAbHealthHistoryPacket(RwKey.Temperature, buildAbHealthHistoryRecordPayload(1767229702, [0x25, 0x00]))
);
const historicalBloodPressure = parseRwRingData(
  buildAbHealthHistoryPacket(RwKey.BloodPressure, buildAbHealthHistoryRecordPayload(1767229760, [118, 76]))
);
const historicalBloodSugar = parseRwRingData(
  buildAbHealthHistoryPacket(RwKey.BloodSugar, buildAbHealthHistoryRecordPayload(1767229820, [56, 0]))
);
const ambiguousCurrentDayStep = parseRwRingData(
  buildAbHealthHistoryPacket(RwKey.ActivityCurrentDay, new Uint8Array([0x2e, 0x24, 0x00, 0x00]))
);
const realDeviceCurrentDayStep = parseRwRingData(
  hexToBytes(
    'ab1100a31678051a102e23ad100000000000000000000000002e23bb200000000000000000000000002e23c9300000000000000000000000002e23d7400000002c00003d6e00057a802e23e550000002b10003c1c00055c9e02e23f3600000000000000000000000002e240170000001d300028c04003a25a02e240f800000002200002f7400043bc02e241d900000001500001d5200029d602e242ba00000004200005c24000837c0'
  )
);
const realDeviceCurrentDayStepContinue = parseRwRingData(
  hexToBytes(
    'ab11005383c5051a102e2439b00000000000000000000000002e2447c00000016b0001facf002d32a02e2455d00000000000000000000000002e2463e00000000000000000000000002e2471f0000000000000000000000000'
  )
);
const realDeviceRelativeCurrentDayStep = parseRwRingData(
  hexToBytes(
    'ab1100a36042051a10033329c200000035000049fd000699600332b3800000000000000000000000000332c1900000000000000000000000000332cfa00000000000000000000000000332ddb00000000000000000000000000332ebc00000000000000000000000000332f9d0000000000000000000000000033307e0000000000000000000000000033315f00000000000000000000000000333240000000035000049fd00069960'
  )
);
const realDeviceRelativeCurrentDayStepSleepCmdCollision = parseRwRingData(
  hexToBytes(
    'ab1100a32c9d051a10033331a20000003e000056910007b8400332b3800000000000000000000000000332c1900000000000000000000000000332cfa00000000000000000000000000332ddb00000000000000000000000000332ebc00000000000000000000000000332f9d0000000000000000000000000033307e0000000000000000000000000033315f0000000000000000000000000033324000000003e000056910007b840'
  )
);
const realDeviceRelativeCurrentDayStepCurrentSnapshot = parseRwRingData(
  hexToBytes(
    'ab1100a32069051a100333283d000002230002fbb700441ba00332b3800000000000000000000000000332c1900000000000000000000000000332cfa00000000000000000000000000332ddb00000000000000000000000000332ebc00000000000000000000000000332f9d0000000000000000000000000033307e0000000000000000000000000033315f000000000000000000000000003332400000001ec0002aeeb003d4280'
  )
);
const realDeviceActivityHistoryJl2 = parseRwRingData(
  hexToBytes(
    'ab1100a345930502102e232e800000000000000000000000002e233c90000001cc0002822a003946802e234aa00000000000000000000000002e2358b0000000400000595c0007f8002e2366c0000001660001f3c4002c93402e2374d00000000000000000000000002e2382e00000000000000000000000002e2390f00000000000000000000000002e239f000000000000000000000000002e23ad10000000000000000000000000'
  )
);
const realDeviceDateTimeKeyResponse = parseRwRingData(hexToBytes('ab11000900000201101a0712142c18'));
const realHealthReadAcks = [
  { hex: 'ab1100030d13050410', name: 'blood_pressure', key: 0x0504 },
  { hex: 'ab1100036d17050a10', name: 'hrv', key: 0x050a },
  { hex: 'ab1100035d15050d10', name: 'stress', key: 0x050d },
  { hex: 'ab1100030d1c051010', name: 'blood_sugar', key: 0x0510 },
  { hex: 'ab110003cddd051011', name: 'blood_sugar', key: 0x0510 }
].map((sample) => ({ ...sample, parsed: parseRwRingData(hexToBytes(sample.hex)) }));

if (
  compactStatusHeartRate?.type !== 'rw_health_data' ||
  compactStatusHeartRate.name !== 'heart_rate' ||
  compactStatusHeartRate.value !== 72 ||
  compactStatusBloodOxygen?.type !== 'rw_health_data' ||
  compactStatusBloodOxygen.name !== 'blood_oxygen' ||
  compactStatusBloodOxygen.value !== 98 ||
  realDeviceBloodOxygen?.type !== 'rw_health_data' ||
  realDeviceBloodOxygen.name !== 'blood_oxygen' ||
  realDeviceBloodOxygen.value !== 99 ||
  realDeviceHeartRate?.type !== 'rw_health_data' ||
  realDeviceHeartRate.name !== 'heart_rate' ||
  realDeviceHeartRate.value !== 70 ||
  compactStatusTemperature?.type !== 'rw_health_data' ||
  compactStatusTemperature.name !== 'temperature' ||
  compactStatusTemperature.value !== 37
) {
  throw new Error(
    `RW parser should treat compact status-prefixed realtime packets as values, not the ACK byte itself: ${JSON.stringify({
      compactStatusHeartRate,
      compactStatusBloodOxygen,
      realDeviceBloodOxygen,
      realDeviceHeartRate,
      compactStatusTemperature
    })}`
  );
}

if (
  compactInvalidStatusBloodOxygen?.type !== 'rw_health_data_ack' ||
  compactInvalidStatusBloodOxygen.name !== 'blood_oxygen' ||
  compactInvalidStatusBloodOxygen.value != null ||
  realDeviceInvalidBloodOxygen?.type !== 'rw_health_data_ack' ||
  realDeviceInvalidBloodOxygen.name !== 'blood_oxygen' ||
  realDeviceInvalidBloodOxygen.value != null
) {
  throw new Error(
    `RW parser should reject impossible realtime SpO2 values instead of surfacing them to the page: ${JSON.stringify({
      compactInvalidStatusBloodOxygen,
      realDeviceInvalidBloodOxygen
    })}`
  );
}

if (
  compactInvalidStatusHeartRate?.type !== 'rw_health_data_ack' ||
  compactInvalidStatusHeartRate.name !== 'heart_rate' ||
  compactInvalidStatusHeartRate.value != null
) {
  throw new Error(
    `RW parser should reject impossible realtime heart-rate values instead of surfacing them to the page: ${JSON.stringify(
      compactInvalidStatusHeartRate
    )}`
  );
}

if (
  realDeviceHrv?.type !== 'rw_health_data' ||
  realDeviceHrv.name !== 'hrv' ||
  realDeviceHrv.key !== RwKey.AppRealTimeHrv ||
  realDeviceHrv.value !== 34
) {
  throw new Error(
    `RW parser should decode real SY03 0x0269 APP realtime HRV value from the metric byte instead of the leading timestamp byte: ${JSON.stringify(
      realDeviceHrv
    )}`
  );
}

if (
  qkeerV2LastData?.type !== 'qkeer_v2_last_data' ||
  qkeerV2LastData.battery !== 77 ||
  qkeerV2LastData.chargingStatusText !== '未充电' ||
  qkeerV2LastData.stepCount !== 1234 ||
  qkeerV2LastData.heartRate !== 66 ||
  qkeerV2LastData.bloodOxygen !== 98 ||
  qkeerV2LastData.temperature !== 36.9 ||
  qkeerV2LastData.sleepTotalMinutes !== 230 ||
  qkeerV2LastData.fatigue !== 320 ||
  qkeerV2LastData.anxiety !== 650
) {
  throw new Error(`RW QKeer V2 LastData should expose summary vitals and sleep totals: ${JSON.stringify(qkeerV2LastData)}`);
}

if (
  qkeerV2SleepHistory?.type !== 'qkeer_v2_sleep_list' ||
  qkeerV2SleepHistory.records?.length !== 3 ||
  qkeerV2SleepHistory.records[0]?.sleepStatusText !== '浅睡' ||
  qkeerV2SleepHistory.records[1]?.sleepStatusText !== '深睡' ||
  qkeerV2SleepHistory.records[2]?.sleepStatusText !== '退出睡眠' ||
  qkeerV2SleepHistory.records[0]?.sleepState !== 3 ||
  qkeerV2SleepHistory.records[1]?.sleepState !== 4 ||
  qkeerV2SleepHistory.records[2]?.sleepState != null ||
  qkeerV2SleepHistory.records[0]?.durationMinutes !== 120 ||
  qkeerV2SleepHistory.records[1]?.durationMinutes !== 180 ||
  qkeerV2SleepHistory.records[2]?.durationMinutes !== 15
) {
  throw new Error(`RW QKeer V2 sleep history should expose Chinese stage text, L19 sleep states, and durations: ${JSON.stringify(qkeerV2SleepHistory)}`);
}

if (
  qkeerV2InvalidBloodOxygenHistory?.type !== 'qkeer_v2_health_list' ||
  qkeerV2InvalidBloodOxygenHistory.records?.[0]?.heartRate !== 72 ||
  qkeerV2InvalidBloodOxygenHistory.records?.[0]?.bloodOxygen !== null ||
  qkeerV2InvalidBloodOxygenHistory.records?.[0]?.spo2 !== null
) {
  throw new Error(
    `RW QKeer V2 health history should reject invalid SpO2 bytes without dropping valid heart rate: ${JSON.stringify(
      qkeerV2InvalidBloodOxygenHistory
    )}`
  );
}

if (
  bloodOxygenMonitoring?.type !== 'rw_health_monitoring' ||
  bloodOxygenMonitoring.name !== 'blood_oxygen' ||
  bloodOxygenMonitoring.enabled !== true ||
  bloodOxygenMonitoring.interval !== 30
) {
  throw new Error(`RW parser should expose SpO2 monitoring config through the canonical blood_oxygen name: ${JSON.stringify(bloodOxygenMonitoring)}`);
}

if (
  bodyTemperatureDetectingMonitoring?.type !== 'rw_health_monitoring' ||
  bodyTemperatureDetectingMonitoring.name !== 'temperature' ||
  bodyTemperatureDetectingMonitoring.enabled !== true ||
  bodyTemperatureDetectingMonitoring.duration !== 60 ||
  JSON.stringify(bodyTemperatureDetectingMonitoring.repeatModel) !== JSON.stringify([1, 1, 1, 1, 1, 1, 1])
) {
  throw new Error(
    `RW parser should decode SDK-style body-temperature detecting flags: ${JSON.stringify(bodyTemperatureDetectingMonitoring)}`
  );
}

if (
  bodyTemperatureMonitoring?.type !== 'rw_health_monitoring' ||
  bodyTemperatureMonitoring.name !== 'temperature' ||
  bodyTemperatureMonitoring.enabled !== true ||
  bodyTemperatureMonitoring.duration !== 60 ||
  JSON.stringify(bodyTemperatureMonitoring.repeatModel) !== JSON.stringify([1, 1, 1, 1, 1, 1, 1])
) {
  throw new Error(`RW parser should decode 0x027d body-temperature monitoring flags: ${JSON.stringify(bodyTemperatureMonitoring)}`);
}

if (
  historicalHeartRate?.type !== 'rw_health_data' ||
  historicalHeartRate.name !== 'heart_rate' ||
  historicalHeartRate.key !== 0x0503 ||
  historicalHeartRate.value !== 74
) {
  throw new Error(`RW parser should read 0x0503 historical heart-rate records after their timestamp: ${JSON.stringify(historicalHeartRate)}`);
}

if (
  realDeviceHistoricalHeartRate?.type !== 'rw_health_data' ||
  realDeviceHistoricalHeartRate.name !== 'heart_rate' ||
  realDeviceHistoricalHeartRate.value !== 69 ||
  realDeviceHistoricalHeartRate.records?.[0]?.heartRate !== 69 ||
  realDeviceHistoricalHeartRate.records?.[0]?.timestampSource !== 'received_at' ||
  realDeviceHistoricalBloodOxygen?.type !== 'rw_health_data' ||
  realDeviceHistoricalBloodOxygen.name !== 'blood_oxygen' ||
  realDeviceHistoricalBloodOxygen.value !== 98 ||
  realDeviceHistoricalBloodOxygen.records?.[0]?.bloodOxygen !== 98 ||
  realDeviceHistoricalBloodOxygen.records?.[0]?.timestampSource !== 'received_at'
) {
  throw new Error(
    `RW parser should keep real SY03 AB history values even when the device timestamp bytes are not usable: ${JSON.stringify({
      realDeviceHistoricalHeartRate,
      realDeviceHistoricalBloodOxygen
    })}`
  );
}

if (
  realDeviceJlSleepHistory?.type !== 'rw_health_data' ||
  realDeviceJlSleepHistory.name !== 'sleep' ||
  realDeviceJlSleepHistory.value !== 4 ||
  realDeviceJlSleepHistory.records?.length !== 3 ||
  realDeviceJlSleepHistory.records?.[0]?.rawDataType !== 'ab_sleep_jl_segment' ||
  realDeviceJlSleepHistory.records?.[0]?.sleepStatus !== 0x11 ||
  realDeviceJlSleepHistory.records?.[0]?.sleepState !== 3 ||
  realDeviceJlSleepHistory.records?.[0]?.durationMinutes !== 18 ||
  realDeviceJlSleepHistory.records?.[1]?.sleepStatus !== 1 ||
  realDeviceJlSleepHistory.records?.[1]?.sleepState !== 3 ||
  realDeviceJlSleepHistory.records?.[1]?.durationMinutes !== 11 ||
  realDeviceJlSleepHistory.records?.[2]?.sleepStatus !== 2 ||
  realDeviceJlSleepHistory.records?.[2]?.sleepState !== 4 ||
  realDeviceJlSleepHistory.records?.[2]?.durationMinutes !== 33
) {
  throw new Error(
    `RW parser should decode real SY03 0x0505 JL sleep history as 7-byte segments instead of sleepState=46: ${JSON.stringify(
      realDeviceJlSleepHistory
    )}`
  );
}

if (
  realDeviceSingleJlSleepPoint?.type !== 'rw_health_data' ||
  realDeviceSingleJlSleepPoint.name !== 'sleep' ||
  realDeviceSingleJlSleepPoint.key !== RwKey.Sleep ||
  realDeviceSingleJlSleepPoint.status != null ||
  !Array.isArray(realDeviceSingleJlSleepPoint.data) ||
  realDeviceSingleJlSleepPoint.data.length !== 7 ||
  (Array.isArray(realDeviceSingleJlSleepPoint.records) && realDeviceSingleJlSleepPoint.records.length > 0)
) {
  throw new Error(
    `RW parser should treat a single 0x0505 JL sleep point as non-empty payload, not a status-only ACK: ${JSON.stringify(
      realDeviceSingleJlSleepPoint
    )}`
  );
}

if (
  invalidHistoricalHeartRate?.type !== 'rw_health_data_ack' ||
  invalidHistoricalHeartRate.name !== 'heart_rate' ||
  invalidHistoricalHeartRate.key !== 0x0503 ||
  invalidHistoricalHeartRate.value != null ||
  (Array.isArray(invalidHistoricalHeartRate.records) && invalidHistoricalHeartRate.records.length > 0)
) {
  throw new Error(`RW parser should reject invalid 0x0503 historical heart-rate bytes: ${JSON.stringify(invalidHistoricalHeartRate)}`);
}

if (
  historicalTemperature?.type !== 'rw_health_data' ||
  historicalTemperature.name !== 'temperature' ||
  historicalTemperature.value !== 37 ||
  historicalTemperature.records?.[0]?.temperature !== 37 ||
  historicalTemperature.records?.[0]?.unixTime !== 1767229700 ||
  historicalDeciTemperature?.type !== 'rw_health_data' ||
  historicalDeciTemperature.name !== 'temperature' ||
  historicalDeciTemperature.value !== 37 ||
  historicalDeciTemperature.records?.[0]?.temperature !== 37 ||
  historicalSingleByteTemperature?.type !== 'rw_health_data' ||
  historicalSingleByteTemperature.name !== 'temperature' ||
  historicalSingleByteTemperature.value !== 37 ||
  historicalSingleByteTemperature.records?.[0]?.temperature !== 37 ||
  historicalBloodPressure?.type !== 'rw_health_data' ||
  historicalBloodPressure.name !== 'blood_pressure' ||
  historicalBloodPressure.value?.systolic !== 118 ||
  historicalBloodPressure.value?.diastolic !== 76 ||
  historicalBloodPressure.records?.[0]?.systolic !== 118 ||
  historicalBloodPressure.records?.[0]?.diastolic !== 76 ||
  historicalBloodSugar?.type !== 'rw_health_data' ||
  historicalBloodSugar.name !== 'blood_sugar' ||
  historicalBloodSugar.value !== 5.6 ||
  historicalBloodSugar.records?.[0]?.bloodSugar !== 5.6
) {
  throw new Error(
    `RW parser should decode AB health history records for temperature, blood pressure, and blood sugar: ${JSON.stringify({
      historicalTemperature,
      historicalDeciTemperature,
      historicalSingleByteTemperature,
      historicalBloodPressure,
      historicalBloodSugar
    })}`
  );
}

for (const sample of realHealthReadAcks) {
  if (
    sample.parsed?.type !== 'rw_health_data_ack' ||
    sample.parsed.name !== sample.name ||
    sample.parsed.key !== sample.key ||
    sample.parsed.value != null ||
    (Array.isArray(sample.parsed.data) && sample.parsed.data.length > 0)
  ) {
    throw new Error(`RW real-device 0x05xx read ACK must remain value-less: ${JSON.stringify(sample)}`);
  }
}

if (
  ambiguousCurrentDayStep?.type !== 'rw_health_data_ack' ||
  ambiguousCurrentDayStep.value != null ||
  (Array.isArray(ambiguousCurrentDayStep.records) && ambiguousCurrentDayStep.records.length > 0)
) {
  throw new Error(`RW current-day activity must not treat ambiguous leading bytes as today's step total: ${JSON.stringify(ambiguousCurrentDayStep)}`);
}

if (
  realDeviceCurrentDayStep?.type !== 'rw_health_data' ||
  realDeviceCurrentDayStep.name !== 'step' ||
  realDeviceCurrentDayStep.value !== 1321 ||
  realDeviceCurrentDayStep.records?.length !== 6 ||
  realDeviceCurrentDayStep.records?.[0]?.rawDataType !== 'ab_activity_current_day_jl2_hour' ||
  realDeviceCurrentDayStep.records?.[0]?.hour !== 12 ||
  realDeviceCurrentDayStep.records?.[0]?.stepCount !== 44 ||
  realDeviceCurrentDayStep.records?.[0]?.timestampSource !== 'current_day_key_hour' ||
  realDeviceCurrentDayStep.records?.[5]?.hour !== 18 ||
  realDeviceCurrentDayStep.records?.[5]?.stepCount !== 66 ||
  realDeviceCurrentDayStepContinue?.type !== 'rw_health_data' ||
  realDeviceCurrentDayStepContinue.name !== 'step' ||
  realDeviceCurrentDayStepContinue.value !== 363 ||
  realDeviceCurrentDayStepContinue.records?.length !== 1 ||
  realDeviceCurrentDayStepContinue.records?.[0]?.rawDataType !== 'ab_activity_current_day_jl2_hour' ||
  realDeviceCurrentDayStepContinue.records?.[0]?.hour !== 20 ||
  realDeviceCurrentDayStepContinue.records?.[0]?.stepCount !== 363
) {
  throw new Error(
    `RW parser should decode real SY03 0x051A JL2 current-day step packets by hour instead of surfacing bogus totals: ${JSON.stringify({
      realDeviceCurrentDayStep,
      realDeviceCurrentDayStepContinue
    })}`
  );
}

if (
  realDeviceRelativeCurrentDayStep?.type !== 'rw_health_data' ||
  realDeviceRelativeCurrentDayStep.name !== 'step' ||
  realDeviceRelativeCurrentDayStep.key !== RwKey.ActivityCurrentDay ||
  realDeviceRelativeCurrentDayStep.value !== 53 ||
  realDeviceRelativeCurrentDayStep.records?.length !== 1 ||
  realDeviceRelativeCurrentDayStep.records?.[0]?.rawDataType !== 'ab_activity_current_day_relative_hour' ||
  realDeviceRelativeCurrentDayStep.records?.[0]?.timestampSource !== 'current_day_key_relative_hour' ||
  realDeviceRelativeCurrentDayStep.records?.[0]?.stepCount !== 53
) {
  throw new Error(
    `RW parser should decode the current SY03 0x051A relative current-day step packet without reviving bogus totals: ${JSON.stringify(
      realDeviceRelativeCurrentDayStep
    )}`
  );
}

if (
  realDeviceRelativeCurrentDayStepSleepCmdCollision?.type !== 'rw_health_data' ||
  realDeviceRelativeCurrentDayStepSleepCmdCollision.name !== 'step' ||
  realDeviceRelativeCurrentDayStepSleepCmdCollision.key !== RwKey.ActivityCurrentDay ||
  realDeviceRelativeCurrentDayStepSleepCmdCollision.value !== 62 ||
  realDeviceRelativeCurrentDayStepSleepCmdCollision.records?.length !== 1 ||
  realDeviceRelativeCurrentDayStepSleepCmdCollision.records?.[0]?.rawDataType !== 'ab_activity_current_day_relative_hour' ||
  realDeviceRelativeCurrentDayStepSleepCmdCollision.records?.[0]?.timestampSource !== 'current_day_key_relative_hour' ||
  realDeviceRelativeCurrentDayStepSleepCmdCollision.records?.[0]?.stepCount !== 62
) {
  throw new Error(
    `RW parser should decode SY03 0x051A packets even when payload bytes resemble QKeer V2 commands: ${JSON.stringify(
      realDeviceRelativeCurrentDayStepSleepCmdCollision
    )}`
  );
}

if (
  realDeviceRelativeCurrentDayStepCurrentSnapshot?.type !== 'rw_health_data' ||
  realDeviceRelativeCurrentDayStepCurrentSnapshot.name !== 'step' ||
  realDeviceRelativeCurrentDayStepCurrentSnapshot.key !== RwKey.ActivityCurrentDay ||
  realDeviceRelativeCurrentDayStepCurrentSnapshot.value !== 547 ||
  realDeviceRelativeCurrentDayStepCurrentSnapshot.records?.length !== 1 ||
  realDeviceRelativeCurrentDayStepCurrentSnapshot.records?.[0]?.rawDataType !== 'ab_activity_current_day_relative_hour' ||
  realDeviceRelativeCurrentDayStepCurrentSnapshot.records?.[0]?.timestampSource !== 'current_day_key_relative_hour' ||
  realDeviceRelativeCurrentDayStepCurrentSnapshot.records?.[0]?.stepCount !== 547
) {
  throw new Error(
    `RW parser should prefer the leading current-day activity snapshot over the stale current-hour bucket: ${JSON.stringify(
      realDeviceRelativeCurrentDayStepCurrentSnapshot
    )}`
  );
}

if (
  realDeviceActivityHistoryJl2?.type !== 'rw_health_data' ||
  realDeviceActivityHistoryJl2.name !== 'step' ||
  realDeviceActivityHistoryJl2.key !== RwKey.Activity ||
  realDeviceActivityHistoryJl2.value !== 358 ||
  realDeviceActivityHistoryJl2.records?.length !== 3 ||
  realDeviceActivityHistoryJl2.records?.[0]?.rawDataType !== 'ab_activity_history_jl2' ||
  realDeviceActivityHistoryJl2.records?.[0]?.stepCount !== 460 ||
  realDeviceActivityHistoryJl2.records?.[0]?.hour !== 1 ||
  realDeviceActivityHistoryJl2.records?.[0]?.timestampSource !== 'jl_device_time' ||
  realDeviceActivityHistoryJl2.records?.[1]?.stepCount !== 64 ||
  realDeviceActivityHistoryJl2.records?.[2]?.stepCount !== 358 ||
  realDeviceActivityHistoryJl2.records?.[2]?.hour !== 4
) {
  throw new Error(
    `RW parser should decode real SY03 0x0502 JL2 activity history packets instead of surfacing bogus short-record steps: ${JSON.stringify(
      realDeviceActivityHistoryJl2
    )}`
  );
}

if (
  realDeviceDateTimeKeyResponse?.type !== 'device_time' ||
  realDeviceDateTimeKeyResponse.packetShape !== 'ab_time_key' ||
  realDeviceDateTimeKeyResponse.key !== RwKey.Time ||
  realDeviceDateTimeKeyResponse.deviceTimeFields?.year !== 2026 ||
  realDeviceDateTimeKeyResponse.deviceTimeFields?.month !== 7 ||
  realDeviceDateTimeKeyResponse.deviceTimeFields?.day !== 18 ||
  realDeviceDateTimeKeyResponse.deviceTimeFields?.hour !== 20 ||
  realDeviceDateTimeKeyResponse.deviceTimeFields?.minute !== 44 ||
  realDeviceDateTimeKeyResponse.deviceTimeFields?.second !== 24
) {
  throw new Error(`RW parser should expose 0x0201 date-time key replies as device_time: ${JSON.stringify(realDeviceDateTimeKeyResponse)}`);
}

const chineseVitalRecords = parseRwUploadRecords(
  encodeUtf8('时间=2026-01-01T01:02:03 心率=72 血氧=98 体温=36.5 压力=42 血糖=5.6 血压=120/80'),
  'health'
);

if (
  chineseVitalRecords.length !== 1 ||
  chineseVitalRecords[0].heartRate !== 72 ||
  chineseVitalRecords[0].bloodOxygen !== 98 ||
  chineseVitalRecords[0].temperature !== 36.5 ||
  chineseVitalRecords[0].stress !== 42 ||
  chineseVitalRecords[0].bloodSugar !== 5.6 ||
  chineseVitalRecords[0].systolic !== 120 ||
  chineseVitalRecords[0].diastolic !== 80
) {
  throw new Error(`RW parser should normalize Chinese UTF-8 health text records: ${JSON.stringify(chineseVitalRecords)}`);
}

const chineseActivityRecords = parseRwUploadRecords(
  encodeUtf8('时间=2026-01-01T01:03:03 步数=6789 卡路里=88 活动时长=32 距离=1.6 运动强度=2'),
  'daily_activity'
);

if (
  chineseActivityRecords.length !== 1 ||
  chineseActivityRecords[0].stepCount !== 6789 ||
  chineseActivityRecords[0].calorie !== 88 ||
  chineseActivityRecords[0].activityMinutes !== 32 ||
  chineseActivityRecords[0].distance !== 1.6 ||
  chineseActivityRecords[0].activityLevel !== 2
) {
  throw new Error(`RW parser should normalize Chinese UTF-8 activity text records: ${JSON.stringify(chineseActivityRecords)}`);
}

const chineseSleepRecords = parseRwUploadRecords(
  encodeUtf8(['时间=2026-01-01T01:04:03 睡眠状态=1 睡眠时长=260', '时间=2026-01-01T05:24:03 睡眠阶段=2 时长=130'].join('\n')),
  'sleep'
);

if (
  chineseSleepRecords.length !== 2 ||
  chineseSleepRecords[0].sleepState !== 1 ||
  chineseSleepRecords[0].durationMinutes !== 260 ||
  chineseSleepRecords[1].sleepState !== 2 ||
  chineseSleepRecords[1].durationMinutes !== 130
) {
  throw new Error(`RW parser should normalize Chinese UTF-8 sleep text records: ${JSON.stringify(chineseSleepRecords)}`);
}

const chineseJsonRecords = parseRwUploadRecords(
  encodeUtf8(JSON.stringify([{ 时间: '2026-01-01T01:05:03', 步数: 4321, 热量: 66, 运动时长: 28, 里程: 1.2 }])),
  'activity'
);

if (
  chineseJsonRecords.length !== 1 ||
  chineseJsonRecords[0].stepCount !== 4321 ||
  chineseJsonRecords[0].calorie !== 66 ||
  chineseJsonRecords[0].activityMinutes !== 28 ||
  chineseJsonRecords[0].distance !== 1.2
) {
  throw new Error(`RW parser should normalize Chinese UTF-8 JSON history records: ${JSON.stringify(chineseJsonRecords)}`);
}

export const rwParserParityPassed = true;
