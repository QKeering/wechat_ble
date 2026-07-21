import {
  buildRingHistorySubmitRecords,
  formatRingHistoryRecordTime,
  getRingHistoryRecordSyncUnixTime,
  getRingHistoryRecordUnixTime,
  getRingSubmitDeviceMac,
  isRingHistoryPayload,
  isRingHistoryReadComplete,
  submitRingHistorySyncResult
} from './useRingHistoryUpload';

const rwUploadFile = {
  type: 'rw_upload_file',
  status: 'completed',
  records: [{ timestamp: 1767229261, heartRate: 72, ppg: [1, 2, 3] }]
};

if (!isRingHistoryPayload(rwUploadFile) || !isRingHistoryReadComplete([rwUploadFile])) {
  throw new Error('RW upload file should be treated as a completed history payload.');
}

const rwPendingFileList = {
  type: 'rw_file_list',
  files: [{ seq: 1, fileName: 'u1_20260101010101_hr.txt', fileType: 'hr' }]
};

const rwEmptyFileList = {
  type: 'rw_file_list',
  files: []
};

const rwFilteredFileList = {
  type: 'rw_file_list',
  files: [{ seq: 1, fileName: 'u1_20260101010101_hr.txt', fileType: 'hr' }],
  selectedFiles: [],
  selectedFileCount: 0,
  filteredFileCount: 1
};

const rwFilteredLocalData = {
  type: 'local_data',
  protocol: 'rw',
  status: 'filtered',
  records: [],
  totalFileCount: 1,
  selectedFileCount: 0,
  filteredFileCount: 1
};

const rwCompletedLocalData = {
  type: 'local_data',
  protocol: 'rw',
  status: 'success',
  totalNum: 2,
  records: [
    { seq: 8, fileName: 'u1_20260101010101_hr.txt', dataType: 'heart_rate_raw', unixTime: 1767229261, value: 73 },
    { seq: 9, fileName: 'u1_20260101010202_spo2.txt', dataType: 'blood_oxygen_raw', unixTime: 1767229322, value: 97 }
  ]
};

const rwCompletedNativeHealthList = {
  type: 'qkeer_v2_health_list',
  protocol: 'rw',
  status: 'success',
  records: [{ unixTime: 1767229380, heartRate: 71, bloodOxygen: 97 }]
};

const rwCompletedNativeLastData = {
  type: 'qkeer_v2_last_data',
  protocol: 'rw',
  status: 'success',
  records: [
    {
      unixTime: 1767229390,
      heartRate: 72,
      bloodOxygen: 98,
      hrv: 42,
      stress: 31,
      bloodSugar: 58,
      bloodPressure: { systolic: 121, diastolic: 80 }
    }
  ]
};

const l19IncompleteLocalData = {
  type: 'local_data',
  status: 'success',
  totalNum: 2,
  records: [{ seq: 1, unixTime: 1767229261, heartRate: 73 }]
};

if (isRingHistoryReadComplete([rwPendingFileList])) {
  throw new Error('RW history should not be treated as complete before listed files upload their payload.');
}

if (!isRingHistoryReadComplete([rwEmptyFileList])) {
  throw new Error('RW empty file list should be treated as a completed empty history sync.');
}

if (!isRingHistoryReadComplete([rwFilteredFileList])) {
  throw new Error('RW filtered file list should be treated as a completed empty history sync for the requested range.');
}

if (!isRingHistoryReadComplete([rwFilteredLocalData])) {
  throw new Error('RW filtered local_data alias should be treated as a completed empty history sync like L19 no_data aliases.');
}

if (!isRingHistoryReadComplete([rwCompletedLocalData])) {
  throw new Error('RW final local_data success should be treated as complete even when file seq differs from total record count.');
}

if (!isRingHistoryPayload(rwCompletedNativeHealthList) || !isRingHistoryReadComplete([rwCompletedNativeHealthList])) {
  throw new Error('RW native QKeer V2 health-list history should be treated as a completed history payload.');
}

if (!isRingHistoryPayload(rwCompletedNativeLastData) || !isRingHistoryReadComplete([rwCompletedNativeLastData])) {
  throw new Error('RW native QKeer V2 LastData should be treated as a completed history payload.');
}

if (isRingHistoryReadComplete([l19IncompleteLocalData])) {
  throw new Error('L19 local_data should still require totalNum to match the last packet seq before completion.');
}

const submitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229261, heart_rate: 72, bloodOxygenSaturation: 98, skinTemperature: '36.5°C' },
  { timestamp: 1767229262, ppg: [1, 2, 3], bloodSugar: 58, systolic: 120, diastolic: 79 },
  { unixTime: 1767229200, heartRate: 60 }
], 1767229261);

if (
  submitRecords.length !== 2 ||
  submitRecords[0].heartRate !== 72 ||
  submitRecords[0].spo2 !== 98 ||
  submitRecords[0].temperature !== 36.5 ||
  submitRecords[1].rrIntervals !== '[1,2,3]' ||
  submitRecords[1].bloodSugar !== 5.8 ||
  submitRecords[1].systolic !== 120 ||
  submitRecords[1].diastolic !== 79 ||
  submitRecords.some((record) => record.recordTime === '')
) {
  throw new Error(`History submit records should normalize aliases and preserve raw PPG only when timestamped: ${JSON.stringify(submitRecords)}`);
}

const stepSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229263, dataType: 'step', stepCount: 0 },
  { unixTime: 1767229264, dataType: 'step', stepCount: 128 }
]);

if (stepSubmitRecords.length !== 1 || stepSubmitRecords[0].stepCount !== 128) {
  throw new Error(`RW step submit records should ignore zero placeholders and keep positive steps: ${JSON.stringify(stepSubmitRecords)}`);
}

const unsafeSummaryStepSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229265, dataType: 'step', rawDataType: 'ab_activity_current_day_summary', stepCount: 9262 },
  { unixTime: 1767229266, dataType: 'summary', rawDataType: 'last_data', stepCount: 9262, heartRate: 72 },
  { unixTime: 1767229267, type: 'qkeer_v2_last_data', sourceType: 'qkeer_v2_last_data', stepCount: 9262, bloodOxygen: 98 },
  { unixTime: 1767229268, dataType: 'step', rawDataType: 'ab_activity_current_day_hour', stepCount: 128 },
  { unixTime: 1767229269, dataType: 'step', rawDataType: 'ab_activity_current_day_jl2_hour', stepCount: 512 },
  { unixTime: 1767229270, dataType: 'step', rawDataType: 'ab_activity_current_day_relative_hour', stepCount: 9262 },
  { unixTime: 1767229271, dataType: 'step', rawDataType: 'ab_activity_history_jl2', stepCount: 128 }
]);

if (
  unsafeSummaryStepSubmitRecords.length !== 4 ||
  unsafeSummaryStepSubmitRecords[0].heartRate !== 72 ||
  unsafeSummaryStepSubmitRecords[0].stepCount != null ||
  unsafeSummaryStepSubmitRecords[1].spo2 !== 98 ||
  unsafeSummaryStepSubmitRecords[1].stepCount != null ||
  unsafeSummaryStepSubmitRecords[2].stepCount != null ||
  unsafeSummaryStepSubmitRecords[2].rawStepCount !== 9262 ||
  unsafeSummaryStepSubmitRecords[2].stepCountSource !== 'rw_current_day_cumulative' ||
  unsafeSummaryStepSubmitRecords[3].stepCount !== 128
) {
  throw new Error(`RW summary/LastData step values should not be uploaded as historical step counts; current-day cumulative step candidates must be marked for backend delta conversion: ${JSON.stringify(unsafeSummaryStepSubmitRecords)}`);
}

const currentDayRelativeStepTime = (() => {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0).getTime() / 1000);
})();
const currentDayCumulativeStepSubmitRecords = buildRingHistorySubmitRecords([
  {
    unixTime: currentDayRelativeStepTime,
    dataType: 'step',
    rawDataType: 'ab_activity_current_day_relative_hour',
    timestampSource: 'current_day_key_relative_hour',
    stepCount: 118,
    hour: new Date(currentDayRelativeStepTime * 1000).getHours()
  },
  {
    unixTime: currentDayRelativeStepTime,
    dataType: 'step',
    rawDataType: 'ab_activity_current_day_relative_hour',
    stepCount: 9262
  }
]);

if (
  currentDayCumulativeStepSubmitRecords.length !== 2 ||
  currentDayCumulativeStepSubmitRecords.some((record) => record.stepCount != null) ||
  currentDayCumulativeStepSubmitRecords[0].rawStepCount !== 118 ||
  currentDayCumulativeStepSubmitRecords[0].cumulativeStepCount !== 118 ||
  currentDayCumulativeStepSubmitRecords[0].stepCountSource !== 'rw_current_day_cumulative' ||
  currentDayCumulativeStepSubmitRecords[1].rawStepCount !== 9262
) {
  throw new Error(`RW current-day relative step records should submit only raw cumulative values for backend daily delta conversion: ${JSON.stringify(currentDayCumulativeStepSubmitRecords)}`);
}

const overnightSleepSubmitRecords = buildRingHistorySubmitRecords([
  {
    recordTime: '2026-07-17 23:30:00',
    startTime: '2026-07-17 23:30:00',
    endTime: '2026-07-18 06:40:00',
    sleepState: 3,
    sleepDuration: 430
  },
  {
    recordTime: '2026-07-17 23:45:00',
    startTime: '2026-07-17 23:45:00',
    endTime: '2026-07-18 02:05:00',
    sleepState: 4,
    sleepDuration: 140,
    dateRef: '2026-07-17'
  }
]);

if (
  overnightSleepSubmitRecords.length !== 2 ||
  overnightSleepSubmitRecords[0].dateRef !== '2026-07-18' ||
  overnightSleepSubmitRecords[1].dateRef !== '2026-07-17'
) {
  throw new Error(`Overnight sleep should fall back to wake-date dateRef while preserving explicit dateRef: ${JSON.stringify(overnightSleepSubmitRecords)}`);
}

const overnightSleepMidnightTimestamp = Math.floor(Date.parse('2026/07/18 00:00:00') / 1000);
const overnightSleepStartTimestamp = Math.floor(Date.parse('2026/07/17 23:30:00') / 1000);
const overnightSleepEndTimestamp = Math.floor(Date.parse('2026/07/18 06:40:00') / 1000);
const overnightSleepFilteredByWakeTime = buildRingHistorySubmitRecords(
  [
    {
      recordTime: '2026-07-17 23:30:00',
      startTime: '2026-07-17 23:30:00',
      endTime: '2026-07-18 06:40:00',
      sleepState: 3,
      sleepDuration: 430
    }
  ],
  overnightSleepMidnightTimestamp
);
const overnightStartTimestamp = getRingHistoryRecordUnixTime({
  recordTime: '2026-07-17 23:30:00',
  startTime: '2026-07-17 23:30:00',
  endTime: '2026-07-18 06:40:00',
  sleepState: 3,
  sleepDuration: 430
});
const overnightSyncTimestamp = getRingHistoryRecordSyncUnixTime({
  recordTime: '2026-07-17 23:30:00',
  startTime: '2026-07-17 23:30:00',
  endTime: '2026-07-18 06:40:00',
  sleepState: 3,
  sleepDuration: 430
});
const overnightDurationSyncTimestamp = getRingHistoryRecordSyncUnixTime({
  recordTime: '2026-07-17 23:30:00',
  dataType: 'sleep',
  sleepState: 3,
  sleepDuration: 430
});

if (
  overnightSleepFilteredByWakeTime.length !== 1 ||
  overnightSleepFilteredByWakeTime[0].dateRef !== '2026-07-18' ||
  overnightStartTimestamp !== overnightSleepStartTimestamp ||
  overnightSyncTimestamp !== overnightSleepEndTimestamp ||
  overnightDurationSyncTimestamp !== overnightSleepEndTimestamp
) {
  throw new Error(
    `Overnight sleep should be retained by wake-time sync filters without changing record start time: ${JSON.stringify({
      overnightSleepFilteredByWakeTime,
      overnightStartTimestamp,
      overnightSyncTimestamp,
      overnightDurationSyncTimestamp
    })}`
  );
}

const rwAliasSubmitRecords = buildRingHistorySubmitRecords([
  {
    unixTime: 1767229263,
    hr: 74,
    bo: 97,
    heart_rate_variability: 43,
    stress_index: 30,
    body_temperature: '36.7°C',
    skin_temperature: 36.8,
    step_count: 3456,
    high_pressure: 122,
    low_pressure: 81
  },
  {
    unixTime: 1767229264,
    heartrate: 75,
    bloodOxy: 95,
    blood_oxygen: 95,
    pressure: 28,
    bodyTemp: 36.9,
    totalSteps: 4567,
    blood_pressure_high: 123,
    blood_pressure_low: 82
  }
]);

if (
  rwAliasSubmitRecords.length !== 2 ||
  rwAliasSubmitRecords[0].heartRate !== 74 ||
  rwAliasSubmitRecords[0].spo2 !== 97 ||
  rwAliasSubmitRecords[0].hrv !== 43 ||
  rwAliasSubmitRecords[0].stress !== 30 ||
  rwAliasSubmitRecords[0].temperature !== 36.7 ||
  rwAliasSubmitRecords[0].stepCount !== 3456 ||
  rwAliasSubmitRecords[0].systolic !== 122 ||
  rwAliasSubmitRecords[0].diastolic !== 81 ||
  rwAliasSubmitRecords[1].heartRate !== 75 ||
  rwAliasSubmitRecords[1].spo2 !== 95 ||
  rwAliasSubmitRecords[1].stress !== 28 ||
  rwAliasSubmitRecords[1].temperature !== 36.9 ||
  rwAliasSubmitRecords[1].stepCount !== 4567 ||
  rwAliasSubmitRecords[1].systolic !== 123 ||
  rwAliasSubmitRecords[1].diastolic !== 82
) {
  throw new Error(`RW history aliases should submit through L19-compatible fields: ${JSON.stringify(rwAliasSubmitRecords)}`);
}

const rwBackendAliasSubmitRecords = buildRingHistorySubmitRecords([
  {
    unixTime: 1767229320,
    heartRateValue: 77,
    oxygenSaturation: 97,
    hrvValue: 45,
    pressureValue: 26,
    temperatureValue: '36.6 C',
    bloodSugarValue: 59,
    bloodPressureValue: { systolicValue: 121, diastolicValue: 80 }
  },
  {
    unixTime: 1767229321,
    dataType: 'rmssd',
    value: 46
  },
  {
    unixTime: 1767229322,
    dataType: 'skin_temp',
    measureValue: '36.7'
  }
]);

if (
  rwBackendAliasSubmitRecords.length !== 3 ||
  rwBackendAliasSubmitRecords[0].heartRate !== 77 ||
  rwBackendAliasSubmitRecords[0].spo2 !== 97 ||
  rwBackendAliasSubmitRecords[0].hrv !== 45 ||
  rwBackendAliasSubmitRecords[0].stress !== 26 ||
  rwBackendAliasSubmitRecords[0].temperature !== 36.6 ||
  rwBackendAliasSubmitRecords[0].bloodSugar !== 5.9 ||
  rwBackendAliasSubmitRecords[0].systolic !== 121 ||
  rwBackendAliasSubmitRecords[0].diastolic !== 80 ||
  rwBackendAliasSubmitRecords[1].hrv !== 46 ||
  rwBackendAliasSubmitRecords[2].temperature !== 36.7
) {
  throw new Error(
    `RW backend-compatible aliases should submit without field loss: ${JSON.stringify(rwBackendAliasSubmitRecords)}`
  );
}

const rwInvalidVitalSubmitRecords = buildRingHistorySubmitRecords([
  {
    unixTime: 1767229265,
    hrv: 0,
    stress: 188,
    bloodSugar: 0x31,
    temp: '0.59°C',
    bloodPressure: '17/31',
    stepCount: 100
  }
]);

if (
  rwInvalidVitalSubmitRecords.length !== 1 ||
  rwInvalidVitalSubmitRecords[0].stepCount !== 100 ||
  rwInvalidVitalSubmitRecords[0].hrv !== undefined ||
  rwInvalidVitalSubmitRecords[0].stress !== undefined ||
  rwInvalidVitalSubmitRecords[0].bloodSugar !== undefined ||
  rwInvalidVitalSubmitRecords[0].temperature !== undefined ||
  rwInvalidVitalSubmitRecords[0].systolic !== undefined ||
  rwInvalidVitalSubmitRecords[0].diastolic !== undefined
) {
  throw new Error(`RW invalid HRV/stress/blood-sugar/temperature/blood-pressure values should not be submitted: ${JSON.stringify(rwInvalidVitalSubmitRecords)}`);
}

const rwMixedVitalSubmitRecords = buildRingHistorySubmitRecords([
  {
    unixTime: 1767229266,
    dataType: 'hrv',
    rawDataType: 'hrv',
    value: 0
  },
  {
    unixTime: 1767229267,
    dataType: 'hrv',
    rawDataType: 'hrv',
    value: 46
  },
  {
    unixTime: 1767229268,
    dataType: 'stress',
    rawDataType: 'stress',
    value: 188
  },
  {
    unixTime: 1767229269,
    dataType: 'stress',
    rawDataType: 'stress',
    value: 23
  },
  {
    unixTime: 1767229270,
    dataType: 'blood_pressure',
    rawDataType: 'bp',
    value: '17/31'
  },
  {
    unixTime: 1767229271,
    dataType: 'blood_pressure',
    rawDataType: 'bp',
    value: '122/80'
  }
]);

if (
  rwMixedVitalSubmitRecords.length !== 3 ||
  rwMixedVitalSubmitRecords[0].hrv !== 46 ||
  rwMixedVitalSubmitRecords[1].stress !== 23 ||
  rwMixedVitalSubmitRecords[2].systolic !== 122 ||
  rwMixedVitalSubmitRecords[2].diastolic !== 80
) {
  throw new Error(`RW valid submit vital records should survive after invalid samples are filtered: ${JSON.stringify(rwMixedVitalSubmitRecords)}`);
}

const rwMixedCaseAliasSubmitRecords = buildRingHistorySubmitRecords([
  {
    UnixTime: 1767229265,
    HR: 76,
    SpO2: 98,
    HeartRateVariability: 44,
    StressIndex: 27,
    BodyTemp: '36.6°C',
    TotalSteps: 5678,
    BP: '119/78',
    PPG: [4, 5, 6],
    SleepState: 2,
    SleepMinutes: 45,
    ActivityLevel: 3,
    PerfusionIndex: 8
  },
  {
    RecordTime: '2026-01-01 01:18:03',
    DataType: 'blood_oxygen_raw',
    RawDataType: 'SpO2',
    Value: 99
  }
]);

if (
  rwMixedCaseAliasSubmitRecords.length !== 2 ||
  rwMixedCaseAliasSubmitRecords[0].heartRate !== 76 ||
  rwMixedCaseAliasSubmitRecords[0].spo2 !== 98 ||
  rwMixedCaseAliasSubmitRecords[0].hrv !== 44 ||
  rwMixedCaseAliasSubmitRecords[0].stress !== 27 ||
  rwMixedCaseAliasSubmitRecords[0].temperature !== 36.6 ||
  rwMixedCaseAliasSubmitRecords[0].stepCount !== 5678 ||
  rwMixedCaseAliasSubmitRecords[0].systolic !== 119 ||
  rwMixedCaseAliasSubmitRecords[0].diastolic !== 78 ||
  rwMixedCaseAliasSubmitRecords[0].rrIntervals !== '[4,5,6]' ||
  rwMixedCaseAliasSubmitRecords[0].sleepState !== 2 ||
  rwMixedCaseAliasSubmitRecords[0].sleepDuration !== 45 ||
  rwMixedCaseAliasSubmitRecords[0].motionIntensity !== 3 ||
  rwMixedCaseAliasSubmitRecords[0].perfusionIndex !== 8 ||
  rwMixedCaseAliasSubmitRecords[1].recordTime !== '2026-01-01 01:18:03' ||
  rwMixedCaseAliasSubmitRecords[1].spo2 !== 99
) {
  throw new Error(
    `RW mixed-case history aliases should submit through L19-compatible fields: ${JSON.stringify(
      rwMixedCaseAliasSubmitRecords
    )}`
  );
}

const recordTimeOnlySubmitRecords = buildRingHistorySubmitRecords(
  [
    { recordTime: '2000-01-01 00:00:00', heartRate: 61 },
    { recordTime: '2099-01-01 00:00:00', heartRate: 62 },
    { recordTime: 'not-a-time', heartRate: 63 }
  ],
  1767229261
);

if (
  recordTimeOnlySubmitRecords.length !== 2 ||
  recordTimeOnlySubmitRecords[0].recordTime !== '2099-01-01 00:00:00' ||
  recordTimeOnlySubmitRecords[0].heartRate !== 62 ||
  recordTimeOnlySubmitRecords[1].recordTime !== 'not-a-time'
) {
  throw new Error(`History submit records should filter parseable recordTime aliases by lastReadTimestamp: ${JSON.stringify(recordTimeOnlySubmitRecords)}`);
}

const parsedRecordTime = getRingHistoryRecordUnixTime({ recordTime: '2099-01-01 00:00:00' });
if (!parsedRecordTime || parsedRecordTime !== Math.floor(Date.parse('2099/01/01 00:00:00') / 1000)) {
  throw new Error(`History unix time helper should parse RW recordTime-only records: ${parsedRecordTime}`);
}

const typedSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229301, dataType: 'heart_rate_raw', value: 73 },
  { unixTime: 1767229302, dataType: 'blood_oxygen_raw', value: 97 },
  { unixTime: 1767229303, dataType: 'hrv', value: 41 },
  { unixTime: 1767229304, dataType: 'stress', value: 29 },
  { unixTime: 1767229305, dataType: 'blood_sugar', value: 59 },
  { unixTime: 1767229306, dataType: 'blood_pressure', value: '121/80' },
  { unixTime: 1767229307, dataType: 'temperature', value: '36.6' },
  { unixTime: 1767229308, dataType: 'step', value: 1234 },
  { unixTime: 1767229309, dataType: 'sleep', value: 3, durationMinutes: 45 }
]);

if (
  typedSubmitRecords.length !== 9 ||
  typedSubmitRecords[0].heartRate !== 73 ||
  typedSubmitRecords[1].spo2 !== 97 ||
  typedSubmitRecords[2].hrv !== 41 ||
  typedSubmitRecords[3].stress !== 29 ||
  typedSubmitRecords[4].bloodSugar !== 5.9 ||
  typedSubmitRecords[5].systolic !== 121 ||
  typedSubmitRecords[5].diastolic !== 80 ||
  typedSubmitRecords[6].temperature !== 36.6 ||
  typedSubmitRecords[7].stepCount !== 1234 ||
  typedSubmitRecords[8].sleepState !== 3 ||
  typedSubmitRecords[8].sleepDuration !== 45
) {
  throw new Error(`RW typed history records should submit through L19-compatible fields: ${JSON.stringify(typedSubmitRecords)}`);
}

const invalidBloodOxygenSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229312, bloodOxygen: 46 },
  { unixTime: 1767229313, dataType: 'blood_oxygen_raw', value: 46 },
  { unixTime: 1767229314, dataType: 'blood_oxygen_raw', value: 98 }
]);

if (
  invalidBloodOxygenSubmitRecords.length !== 1 ||
  invalidBloodOxygenSubmitRecords[0].spo2 !== 98 ||
  !invalidBloodOxygenSubmitRecords[0].recordTime
) {
  throw new Error(
    `RW history submit should reject invalid SpO2 values before backend detail refresh: ${JSON.stringify(
      invalidBloodOxygenSubmitRecords
    )}`
  );
}

const invalidHeartRateSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229315, heartRate: 0 },
  { unixTime: 1767229316, dataType: 'heart_rate_raw', value: 241 },
  { unixTime: 1767229317, dataType: 'heart_rate_raw', value: 73 }
]);

if (
  invalidHeartRateSubmitRecords.length !== 1 ||
  invalidHeartRateSubmitRecords[0].heartRate !== 73 ||
  !invalidHeartRateSubmitRecords[0].recordTime
) {
  throw new Error(
    `RW history submit should reject invalid heart-rate values before backend detail refresh: ${JSON.stringify(
      invalidHeartRateSubmitRecords
    )}`
  );
}

const scaledTemperatureSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229318, dataType: 'temperature', value: 3665 },
  { unixTime: 1767229319, dataType: 'skin_temp', value: 365 },
  { unixTime: 1767229320, bodyTemperature: 36.7 }
]);

if (
  scaledTemperatureSubmitRecords.length !== 3 ||
  scaledTemperatureSubmitRecords[0].temperature !== 36.65 ||
  scaledTemperatureSubmitRecords[1].temperature !== 36.5 ||
  scaledTemperatureSubmitRecords[2].temperature !== 36.7
) {
  throw new Error(
    `RW history submit should normalize deci/centi-degree temperature values before backend upload: ${JSON.stringify(
      scaledTemperatureSubmitRecords
    )}`
  );
}

const typedArrayBloodPressureSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229310, dataType: 'blood_pressure', value: [122, 81] },
  { unixTime: 1767229311, dataType: 'blood_pressure', data: [118, 76] }
]);

if (
  typedArrayBloodPressureSubmitRecords.length !== 2 ||
  typedArrayBloodPressureSubmitRecords[0].systolic !== 122 ||
  typedArrayBloodPressureSubmitRecords[0].diastolic !== 81 ||
  typedArrayBloodPressureSubmitRecords[1].systolic !== 118 ||
  typedArrayBloodPressureSubmitRecords[1].diastolic !== 76
) {
  throw new Error(`RW typed blood-pressure arrays should submit through L19-compatible fields: ${JSON.stringify(typedArrayBloodPressureSubmitRecords)}`);
}

const sleepDurationAliasSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229400, dataType: 'sleep', sleepState: 1, sleep_minutes: 20 },
  { unixTime: 1767229460, dataType: 'sleep', sleep_state: 2, len: 80 }
]);

if (
  sleepDurationAliasSubmitRecords.length !== 2 ||
  sleepDurationAliasSubmitRecords[0].sleepState !== 1 ||
  sleepDurationAliasSubmitRecords[0].sleepDuration !== 20 ||
  sleepDurationAliasSubmitRecords[1].sleepState !== 2 ||
  sleepDurationAliasSubmitRecords[1].sleepDuration !== 80
) {
  throw new Error(`RW sleep state and duration aliases should submit as L19-compatible sleep fields: ${JSON.stringify(sleepDurationAliasSubmitRecords)}`);
}

const snakeCaseSleepAliasSubmitRecords = buildRingHistorySubmitRecords([
  { unixTime: 1767229470, dataType: 'sleep', sleep_status: 'deep', total_sleep_time: 95 },
  { unixTime: 1767229480, dataType: 'sleep', sleep_stage: 4, duration_minutes: 25 },
  { unixTime: 1767229490, dataType: 'sleep', sleep_type: 3, sleep_duration_minutes: 15 }
]);

if (
  snakeCaseSleepAliasSubmitRecords.length !== 3 ||
  snakeCaseSleepAliasSubmitRecords[0].sleepState !== 4 ||
  snakeCaseSleepAliasSubmitRecords[0].sleepDuration !== 95 ||
  snakeCaseSleepAliasSubmitRecords[1].sleepState !== 4 ||
  snakeCaseSleepAliasSubmitRecords[1].sleepDuration !== 25 ||
  snakeCaseSleepAliasSubmitRecords[2].sleepState !== 3 ||
  snakeCaseSleepAliasSubmitRecords[2].sleepDuration !== 15
) {
  throw new Error(`RW snake_case sleep aliases should submit through L19-compatible fields: ${JSON.stringify(snakeCaseSleepAliasSubmitRecords)}`);
}

const sleepBoundarySubmitRecords = buildRingHistorySubmitRecords([
  {
    recordTime: '2026-01-02 07:00:00',
    dataType: 'sleep',
    sleep_state: 2,
    sleep_duration: 480,
    start_time: '2026-01-01 23:00:00',
    end_time: '2026-01-02 07:00:00',
    date_ref: '2026/01/01'
  },
  {
    recordTime: '2026-01-02 07:30:00',
    dataType: 'sleep',
    sleepStatus: 1,
    durationMinutes: 30,
    beginTime: '20260102070000',
    finishTime: '20260102073000',
    dateRef: '20260102'
  }
]);

if (
  sleepBoundarySubmitRecords.length !== 2 ||
  sleepBoundarySubmitRecords[0].startTime !== '2026-01-01 23:00:00' ||
  sleepBoundarySubmitRecords[0].endTime !== '2026-01-02 07:00:00' ||
  sleepBoundarySubmitRecords[0].dateRef !== '2026-01-01' ||
  sleepBoundarySubmitRecords[1].startTime !== '2026-01-02 07:00:00' ||
  sleepBoundarySubmitRecords[1].endTime !== '2026-01-02 07:30:00' ||
  sleepBoundarySubmitRecords[1].dateRef !== '2026-01-02'
) {
  throw new Error(`RW sleep boundary fields should be preserved for backend sleep storage: ${JSON.stringify(sleepBoundarySubmitRecords)}`);
}

const complexRwSubmitRecords = buildRingHistorySubmitRecords([
  {
    unixTime: 1767229500,
    bloodPressure: {
      systolic: 119,
      diastolic: 77
    },
    rrIntervals: '[810,790,805]'
  }
]);

if (
  complexRwSubmitRecords.length !== 1 ||
  complexRwSubmitRecords[0].systolic !== 119 ||
  complexRwSubmitRecords[0].diastolic !== 77 ||
  complexRwSubmitRecords[0].rrIntervals !== '[810,790,805]'
) {
  throw new Error(`RW object blood pressure and preformatted RR intervals should submit without data loss: ${JSON.stringify(complexRwSubmitRecords)}`);
}

const submitMac = getRingSubmitDeviceMac(
  {
    normalMac: 'AA:BB:CC:DD:EE:FF',
    deviceInfo: {
      deviceId: 'rw-device-id',
      mac: '11:22:33:44:55:66'
    }
  },
  true
);

if (submitMac !== 'AA:BB:CC:DD:EE:FF') {
  throw new Error(`iOS submit MAC should prefer normalMac: ${submitMac}`);
}

const rwAdvertisSubmitMac = getRingSubmitDeviceMac(
  {
    normalMac: '',
    deviceInfo: {
      deviceId: 'ios-random-id',
      protocol: 'rw',
      advertis: {
        macInfo: '3E:00:00:00:05:1B'
      }
    }
  },
  false
);

if (rwAdvertisSubmitMac !== '3E:00:00:00:05:1B') {
  throw new Error(`RW history submissions should prefer stable advertis macInfo over random platform id: ${rwAdvertisSubmitMac}`);
}

const rwCurrentStableSubmitMac = getRingSubmitDeviceMac(
  {
    normalMac: 'AA:BB:CC:DD:EE:FF',
    deviceInfo: {
      deviceId: 'ios-random-id',
      protocol: 'rw',
      advertis: {
        macInfo: '3E:00:00:00:05:1B'
      }
    }
  },
  true
);

if (rwCurrentStableSubmitMac !== '3E:00:00:00:05:1B') {
  throw new Error(`RW history submissions should prefer current stable macInfo over stale normalMac: ${rwCurrentStableSubmitMac}`);
}

const rwUniMacOnlySubmitMac = getRingSubmitDeviceMac(
  {
    normalMac: 'AA:BB:CC:DD:EE:FF',
    deviceInfo: {
      deviceId: 'ios-random-id',
      protocol: 'rw',
      uniMacId: '3E:00:00:00:05:1B'
    }
  },
  false
);

if (rwUniMacOnlySubmitMac !== '3E:00:00:00:05:1B') {
  throw new Error(`RW history submissions should use current uniMacId before random deviceId or stale normalMac: ${rwUniMacOnlySubmitMac}`);
}

const rwAndroidDeviceIdSubmitMac = getRingSubmitDeviceMac(
  {
    normalMac: '',
    deviceInfo: {
      deviceId: '3E:00:00:00:05:1B',
      protocol: 'rw'
    }
  },
  false
);

if (rwAndroidDeviceIdSubmitMac !== '3E:00:00:00:05:1B') {
  throw new Error(`RW Android history submissions should use stable colon-separated deviceId as device MAC: ${rwAndroidDeviceIdSubmitMac}`);
}

const rwRandomUniMacOnlySubmitMac = getRingSubmitDeviceMac(
  {
    normalMac: 'AA:BB:CC:DD:EE:FF',
    iosMacId: 'OLD:IOS:MAC',
    deviceInfo: {
      deviceId: 'ios-random-id',
      protocol: 'rw',
      uniMacId: '111111ABCDEF'
    }
  },
  false
);

if (rwRandomUniMacOnlySubmitMac !== '') {
  throw new Error(`RW history submissions should not submit random uniMacId values as stable device MACs: ${rwRandomUniMacOnlySubmitMac}`);
}

const rwMissingCurrentStableSubmitMac = getRingSubmitDeviceMac(
  {
    normalMac: 'AA:BB:CC:DD:EE:FF',
    iosMacId: 'OLD:IOS:MAC',
    deviceInfo: {
      deviceId: 'ios-random-id',
      protocol: 'rw'
    }
  },
  false
);

if (rwMissingCurrentStableSubmitMac !== '') {
  throw new Error(`RW history submissions should not fall back to stale cached identities: ${rwMissingCurrentStableSubmitMac}`);
}

const rwStoreFallbackSubmitMac = getRingSubmitDeviceMac(
  {
    normalMac: 'AA:BB:CC:DD:EE:FF',
    deviceInfo: {
      deviceId: 'ios-random-id',
      protocol: 'rw'
    }
  },
  false,
  {
    deviceId: 'ios-random-store-id',
    protocol: 'rw',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    }
  }
);

if (rwStoreFallbackSubmitMac !== '3E:00:00:00:05:1B') {
  throw new Error(`RW history submissions should fall back to current ring store identity before failing upload: ${rwStoreFallbackSubmitMac}`);
}

let submittedSyncPayload: any = null;
const submittedSyncResult = await submitRingHistorySyncResult(
  {
    records: [
      { unixTime: 1767229600, dataType: 'sleep', sleepState: 3, durationMinutes: 40 },
      { unixTime: 1767229660, dataType: 'history_file', fileName: 'metadata.txt' }
    ]
  },
  {
    deviceMac: '3E:00:00:00:05:1B',
    submit: async (payload) => {
      submittedSyncPayload = payload;
      return { success: true };
    }
  }
);

if (
  !submittedSyncResult.submitted ||
  submittedSyncResult.count !== 1 ||
  submittedSyncResult.maxTimestamp !== 1767232000 ||
  submittedSyncPayload?.deviceMac !== '3E:00:00:00:05:1B' ||
  submittedSyncPayload?.dataList?.[0]?.sleepState !== 3 ||
  submittedSyncPayload?.dataList?.[0]?.sleepDuration !== 40
) {
  throw new Error(`Completed typed history should be submitted directly to the backend before a detail refresh: ${JSON.stringify({
    submittedSyncResult,
    submittedSyncPayload
  })}`);
}

const rwNativeHistoryRecords = [
  {
    dataType: 'sleep',
    unixTime: 1767229700,
    sleepType: 0,
    sleepStatus: 2,
    sleepStatusText: '深睡',
    durationMinutes: 130
  },
  {
    dataType: 'step',
    unixTime: 1767229760,
    stepCount: 6789,
    motion_intensity: 2
  },
  {
    dataType: 'vital',
    unixTime: 1767229820,
    heartRate: 72,
    bloodOxygen: 98,
    temperature: 36.6
  }
];

const rwNativeHistorySubmitRecords = buildRingHistorySubmitRecords(rwNativeHistoryRecords);
if (
  rwNativeHistorySubmitRecords.length !== 3 ||
  rwNativeHistorySubmitRecords[0].sleepState !== 4 ||
  rwNativeHistorySubmitRecords[0].sleepDuration !== 130 ||
  rwNativeHistorySubmitRecords[1].stepCount !== 6789 ||
  rwNativeHistorySubmitRecords[1].motionIntensity !== 2 ||
  rwNativeHistorySubmitRecords[2].heartRate !== 72 ||
  rwNativeHistorySubmitRecords[2].spo2 !== 98 ||
  rwNativeHistorySubmitRecords[2].temperature !== 36.6
) {
  throw new Error(`RW native sleep/step/vital list records should submit with L19-compatible fields: ${JSON.stringify(rwNativeHistorySubmitRecords)}`);
}

let submittedNativeHistoryPayload: any = null;
const submittedNativeHistoryResult = await submitRingHistorySyncResult(
  { records: rwNativeHistoryRecords },
  {
    deviceMac: '3E:00:00:00:05:1B',
    submit: async (payload) => {
      submittedNativeHistoryPayload = payload;
      return { success: true };
    }
  }
);

if (
  !submittedNativeHistoryResult.submitted ||
  submittedNativeHistoryResult.count !== 3 ||
  submittedNativeHistoryResult.maxTimestamp !== 1767237500 ||
  submittedNativeHistoryPayload?.deviceMac !== '3E:00:00:00:05:1B' ||
  submittedNativeHistoryPayload?.dataList?.[0]?.sleepState !== 4 ||
  submittedNativeHistoryPayload?.dataList?.[0]?.sleepDuration !== 130 ||
  submittedNativeHistoryPayload?.dataList?.[1]?.stepCount !== 6789 ||
  submittedNativeHistoryPayload?.dataList?.[1]?.motionIntensity !== 2 ||
  submittedNativeHistoryPayload?.dataList?.[2]?.spo2 !== 98
) {
  throw new Error(`RW native history list records should be submitted before backend detail refresh: ${JSON.stringify({
    submittedNativeHistoryResult,
    submittedNativeHistoryPayload
  })}`);
}

let submittedNativeLastDataPayload: any = null;
const submittedNativeLastDataResult = await submitRingHistorySyncResult(rwCompletedNativeLastData, {
  deviceMac: '3E:00:00:00:05:1B',
  submit: async (payload) => {
    submittedNativeLastDataPayload = payload;
    return { success: true };
  }
});

if (
  !submittedNativeLastDataResult.submitted ||
  submittedNativeLastDataResult.count !== 1 ||
  submittedNativeLastDataResult.maxTimestamp !== 1767229390 ||
  submittedNativeLastDataPayload?.dataList?.[0]?.heartRate !== 72 ||
  submittedNativeLastDataPayload?.dataList?.[0]?.spo2 !== 98 ||
  submittedNativeLastDataPayload?.dataList?.[0]?.hrv !== 42 ||
  submittedNativeLastDataPayload?.dataList?.[0]?.stress !== 31 ||
  submittedNativeLastDataPayload?.dataList?.[0]?.bloodSugar !== 5.8 ||
  submittedNativeLastDataPayload?.dataList?.[0]?.systolic !== 121 ||
  submittedNativeLastDataPayload?.dataList?.[0]?.diastolic !== 80
) {
  throw new Error(`RW native LastData records should submit through L19-compatible fields: ${JSON.stringify({
    submittedNativeLastDataResult,
    submittedNativeLastDataPayload
  })}`);
}

let emptySyncSubmitCount = 0;
const emptySyncResult = await submitRingHistorySyncResult(
  { records: [] },
  {
    deviceMac: '3E:00:00:00:05:1B',
    submit: async () => {
      emptySyncSubmitCount += 1;
    }
  }
);

if (emptySyncResult.submitted || emptySyncResult.count !== 0 || emptySyncSubmitCount !== 0) {
  throw new Error(`Empty history sync should not call the backend: ${JSON.stringify({ emptySyncResult, emptySyncSubmitCount })}`);
}
