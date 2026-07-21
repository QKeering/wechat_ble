import type { LegacyRingAdapter } from '../legacy/adapter';
import type { RingBleState, RingParsedData } from '../types';
import { bytesToHex } from './protocol';
import { parseRwFileTimestamp, syncRwHistoryFiles } from './history';
import { parseRwUploadRecords } from './parser';

const sent: string[] = [];
let readLocalDataCalled = false;
let readLocalDataOptions: any;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  deviceId: 'ios-random-history-device',
  uniMacId: 'ios-random-history-id',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  files: [
    {
      total: 1,
      seq: 2,
      fileSize: 65,
      fileName: 'u1_20260101010101_hr.txt',
      userId: 'u1',
      timestampText: '20260101010101',
      fileType: 'hr'
    },
    {
      total: 2,
      seq: 3,
      fileSize: 120,
      fileName: 'u1_20260101010202_spo2.txt',
      userId: 'u1',
      timestampText: '20260101010202',
      fileType: 'spo2'
    },
    {
      total: 3,
      seq: 4,
      fileSize: 80,
      fileName: 'u1_20260101010303_bp.txt',
      userId: 'u1',
      timestampText: '20260101010303',
      fileType: 'bp'
    },
    {
      total: 4,
      seq: 5,
      fileSize: 80,
      fileName: 'u1_20260101010404_sleep.txt',
      userId: 'u1',
      timestampText: '20260101010404',
      fileType: 'sleep'
    }
  ],
  raw: []
};

const uploadParsed: RingParsedData = {
  type: 'rw_upload_file',
  protocol: 'rw',
  seq: 2,
  status: 'completed',
  startTimestamp: 1767229200,
  endTimestamp: 1767229800,
  records: [
    {
      timestamp: 1767229261000,
      green: 100,
      red: 200,
      ir: 300,
      accX: 1,
      accY: 2,
      accZ: 3
    }
  ],
  raw: []
};

const fakeAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    readLocalDataCalled = true;
    readLocalDataOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    sent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(fileListParsed)) return fileListParsed;
    if (!sent.some((hex) => /^00[0-9a-f]{2}361a02$/i.test(hex)) && predicate(uploadParsed)) return uploadParsed;
    throw new Error('Unexpected RW history parity predicate.');
  }
} as unknown as LegacyRingAdapter;

const result = await syncRwHistoryFiles(fakeAdapter, { readAll: true, timeoutMs: 1000 });

if (
  !sent.some((hex) => /^00[0-9a-f]{2}360100000000$/i.test(hex)) ||
  !sent.some((hex) => /^00[0-9a-f]{2}361a02$/i.test(hex))
) {
  throw new Error(`RW history sync should try L19-compatible local data before file-list upload. sent=${JSON.stringify(sent)} options=${JSON.stringify(readLocalDataOptions)}`);
}

if (
  result.parsed.type !== 'local_data' ||
  result.parsed.status !== 'success' ||
  result.records.length !== 4 ||
  result.records[0].dataType !== 'heart_rate_raw' ||
  result.records[0].rawDataType !== 'hr' ||
  result.records[0].mac !== '3E:00:00:00:05:1B' ||
  result.records[0].uniMacId !== '3E:00:00:00:05:1B' ||
  result.records[0].advertis?.macInfo !== '3E:00:00:00:05:1B' ||
  result.records[0].startTimestamp !== 1767229200 ||
  result.records[0].endTimestamp !== 1767229800 ||
  result.records[0].unixTime !== 1767229261 ||
  result.records[0].accZ !== 3 ||
  result.records[1].dataType !== 'blood_oxygen_raw' ||
  result.records[1].rawDataType !== 'spo2' ||
  result.records[1].status !== 'pending_upload_payload' ||
  result.records[2].dataType !== 'blood_pressure' ||
  result.records[2].rawDataType !== 'bp' ||
  result.records[2].status !== 'pending_upload_payload' ||
  result.records[3].dataType !== 'sleep' ||
  result.records[3].rawDataType !== 'sleep' ||
  result.records[3].status !== 'pending_upload_payload' ||
  result.parsed.totalFileCount !== 4 ||
  result.parsed.mac !== '3E:00:00:00:05:1B' ||
  result.parsed.uniMacId !== '3E:00:00:00:05:1B' ||
  result.parsed.advertis?.macInfo !== '3E:00:00:00:05:1B' ||
  result.parsed.selectedFileCount !== 4 ||
  result.parsed.filteredFileCount !== 0 ||
  result.parsed.readAll !== true
) {
  throw new Error(`Unexpected RW history sync result: ${JSON.stringify(result)}`);
}

const legacyLocalDataSent: string[] = [];
let legacyLocalDataFallbackRead = false;
const legacyLocalDataParsed: RingParsedData = {
  type: 'local_data',
  protocol: 'rw',
  packetShape: 'legacy_compat',
  status: 'success',
  totalNum: 1,
  records: [
    {
      unixTime: 1767229261,
      stepCount: 1234,
      heartRate: 76,
      spo2: 98
    }
  ],
  mac: '3E:00:00:00:05:1B',
  raw: []
};
const legacyLocalDataAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async () => {
    legacyLocalDataFallbackRead = true;
  },
  sendBytes: async (bytes: Uint8Array) => {
    legacyLocalDataSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(legacyLocalDataParsed)) return legacyLocalDataParsed;
    throw new Error('Unexpected legacy local-data RW history parity predicate.');
  }
} as unknown as LegacyRingAdapter;
const legacyLocalDataResult = await syncRwHistoryFiles(legacyLocalDataAdapter, { readAll: false, sinceTimestamp: 1767229000, timeoutMs: 1000 });
if (
  legacyLocalDataFallbackRead ||
  !legacyLocalDataSent.some((hex) => /^00[0-9a-f]{2}360048c65569$/i.test(hex)) ||
  legacyLocalDataResult.records.length !== 1 ||
  legacyLocalDataResult.records[0].dataType !== 'daily_health' ||
  legacyLocalDataResult.records[0].heartRate !== 76 ||
  legacyLocalDataResult.records[0].spo2 !== 98 ||
  legacyLocalDataResult.parsed.readAll !== false ||
  legacyLocalDataResult.parsed.sinceTimestamp !== 1767229000 ||
  legacyLocalDataResult.parsed.mac !== '3E:00:00:00:05:1B'
) {
  throw new Error(`RW history sync should accept L19-compatible local_data directly: ${JSON.stringify({
    legacyLocalDataSent,
    legacyLocalDataFallbackRead,
    legacyLocalDataResult
  })}`);
}

const utf8HistorySent: string[] = [];
let utf8HistoryReadOptions: any;
const utf8HistoryFileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  files: [
    {
      total: 1,
      seq: 9,
      fileSize: 100,
      fileName: 'u1_20260101020101_daily_activity.txt',
      userId: 'u1',
      timestampText: '20260101020101',
      fileType: 'daily_activity'
    }
  ],
  raw: []
};
const utf8ActivityUploadParsed: RingParsedData = {
  type: 'rw_upload_file',
  protocol: 'rw',
  seq: 9,
  status: 'completed',
  records: parseRwUploadRecords(
    new TextEncoder().encode('时间=2026-01-01T01:03:03 步数=6789 卡路里=88 活动时长=32 距离=1.6 运动强度=2'),
    'daily_activity'
  ),
  raw: []
};
const utf8HistoryAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    utf8HistoryReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    utf8HistorySent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(utf8HistoryFileListParsed)) return utf8HistoryFileListParsed;
    if (predicate(utf8ActivityUploadParsed)) return utf8ActivityUploadParsed;
    throw new Error('Unexpected UTF-8 RW history parity predicate.');
  }
} as LegacyRingAdapter;
const utf8HistoryResult = await syncRwHistoryFiles(utf8HistoryAdapter, { readAll: true, timeoutMs: 1000 });
if (
  !utf8HistorySent.some((hex) => /^00[0-9a-f]{2}360100000000$/i.test(hex)) ||
  !utf8HistorySent.some((hex) => /^00[0-9a-f]{2}361a09$/i.test(hex)) ||
  utf8HistoryResult.records.length !== 1 ||
  utf8HistoryResult.records[0].dataType !== 'step' ||
  utf8HistoryResult.records[0].rawDataType !== 'daily_activity' ||
  utf8HistoryResult.records[0].stepCount !== 6789 ||
  utf8HistoryResult.records[0].calorie !== 88 ||
  utf8HistoryResult.records[0].activityMinutes !== 32 ||
  utf8HistoryResult.records[0].distance !== 1.6 ||
  utf8HistoryResult.records[0].activityLevel !== 2 ||
  utf8HistoryResult.records[0].unixTime !== 1767200583
) {
  throw new Error(`RW history sync should preserve parsed UTF-8 Chinese activity records: ${JSON.stringify({
    utf8HistorySent,
    utf8HistoryResult,
    utf8HistoryReadOptions
  })}`);
}

const recordTimestampSent: string[] = [];
const recordTimestampFileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  files: [
    {
      total: 1,
      seq: 10,
      fileSize: 80,
      fileName: 'u1_20260101030101_step.txt',
      userId: 'u1',
      timestampText: '20260101030101',
      fileType: 'step'
    }
  ],
  raw: []
};
const recordTimestampUploadParsed: RingParsedData = {
  type: 'rw_upload_file',
  protocol: 'rw',
  seq: 10,
  status: 'completed',
  records: [{ unixTime: 1767231000, stepCount: 2222 }],
  raw: []
};
const recordTimestampAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async () => undefined,
  sendBytes: async (bytes: Uint8Array) => {
    recordTimestampSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(recordTimestampFileListParsed)) return recordTimestampFileListParsed;
    if (predicate(recordTimestampUploadParsed)) return recordTimestampUploadParsed;
    throw new Error('Unexpected record timestamp RW history parity predicate.');
  }
} as LegacyRingAdapter;
const recordTimestampResult = await syncRwHistoryFiles(recordTimestampAdapter, { readAll: true, timeoutMs: 1000 });
if (recordTimestampResult.records[0]?.unixTime !== 1767231000 || recordTimestampResult.records[0]?.stepCount !== 2222) {
  throw new Error(`RW history sync should preserve record unixTime over file-name timestamp: ${JSON.stringify({
    recordTimestampSent,
    recordTimestampResult
  })}`);
}

const filteredSent: string[] = [];
const filteredFileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  files: [
    {
      total: 1,
      seq: 8,
      fileSize: 65,
      fileName: 'u1_20260101010101_hr.txt',
      userId: 'u1',
      timestampText: '20260101010101',
      fileType: 'hr'
    },
    {
      total: 2,
      seq: 9,
      fileSize: 80,
      fileName: 'u1_20260101020101_hr.txt',
      userId: 'u1',
      timestampText: '20260101020101',
      fileType: 'hr'
    }
  ],
  raw: []
};

const filteredUploadParsed: RingParsedData = {
  type: 'rw_upload_file',
  protocol: 'rw',
  seq: 9,
  status: 'completed',
  records: [{ timestamp: 1767232861000, heartRate: 74 }],
  raw: []
};

const filteredAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    filteredReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    filteredSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(filteredFileListParsed)) return filteredFileListParsed;
    if (predicate(filteredUploadParsed)) return filteredUploadParsed;
    throw new Error('Unexpected filtered RW history parity predicate.');
  }
} as LegacyRingAdapter;

let filteredReadOptions: any;
const filteredResult = await syncRwHistoryFiles(filteredAdapter, {
  readAll: false,
  sinceTimestamp: parseRwFileTimestamp('20260101020000'),
  timeoutMs: 1000
});

if (
  filteredSent.some((hex) => /^00[0-9a-f]{2}361a08$/i.test(hex)) ||
  !filteredSent.some((hex) => /^00[0-9a-f]{2}361a09$/i.test(hex)) ||
  filteredResult.records.length !== 1 ||
  filteredResult.records[0].seq !== 9 ||
  filteredResult.parsed.files?.length !== 1 ||
  filteredResult.parsed.allFiles?.length !== 2 ||
  filteredResult.parsed.totalFileCount !== 2 ||
  filteredResult.parsed.selectedFileCount !== 1 ||
  filteredResult.parsed.filteredFileCount !== 1 ||
  filteredResult.parsed.sinceTimestamp !== parseRwFileTimestamp('20260101020000')
) {
  throw new Error(`RW history sync should honor sinceTimestamp when readAll is false: ${JSON.stringify({ filteredSent, filteredResult, filteredReadOptions })}`);
}

const typeFilterSent: string[] = [];
const typeFilterUploadParsed: RingParsedData = {
  type: 'rw_upload_file',
  protocol: 'rw',
  seq: 4,
  status: 'completed',
  records: [{ timestamp: 1767229383000, systolic: 121, diastolic: 80 }],
  raw: []
};
const typeFilterAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    typeFilterReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    typeFilterSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(fileListParsed)) return fileListParsed;
    if (predicate(typeFilterUploadParsed)) return typeFilterUploadParsed;
    throw new Error('Unexpected type-filter RW history parity predicate.');
  }
} as LegacyRingAdapter;

let typeFilterReadOptions: any;
const typeFilterResult = await syncRwHistoryFiles(typeFilterAdapter, {
  readAll: true,
  dataType: 'blood_pressure',
  timeoutMs: 1000
});

if (
  typeFilterSent.some((hex) => /^00[0-9a-f]{2}361a0[235]$/i.test(hex)) ||
  !typeFilterSent.some((hex) => /^00[0-9a-f]{2}361a04$/i.test(hex)) ||
  typeFilterResult.records.length !== 1 ||
  typeFilterResult.records[0].dataType !== 'blood_pressure' ||
  typeFilterResult.records[0].systolic !== 121 ||
  typeFilterResult.parsed.files?.length !== 1 ||
  typeFilterResult.parsed.totalFileCount !== 4 ||
  typeFilterResult.parsed.selectedFileCount !== 1 ||
  typeFilterResult.parsed.filteredFileCount !== 3 ||
  typeFilterResult.parsed.dataType !== 'blood_pressure'
) {
  throw new Error(`RW history syncHealthDataByType should request only matching data files: ${JSON.stringify({ typeFilterSent, typeFilterResult, typeFilterReadOptions })}`);
}

const oxygenTypeFilterSent: string[] = [];
const oxygenTypeFilterUploadParsed: RingParsedData = {
  type: 'rw_upload_file',
  protocol: 'rw',
  seq: 3,
  status: 'completed',
  records: [{ timestamp: 1767229322000, bloodOxygen: 98 }],
  raw: []
};
const oxygenTypeFilterAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    oxygenTypeFilterReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    oxygenTypeFilterSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(fileListParsed)) return fileListParsed;
    if (predicate(oxygenTypeFilterUploadParsed)) return oxygenTypeFilterUploadParsed;
    throw new Error('Unexpected oxygen type-filter RW history parity predicate.');
  }
} as LegacyRingAdapter;

let oxygenTypeFilterReadOptions: any;
const oxygenTypeFilterResult = await syncRwHistoryFiles(oxygenTypeFilterAdapter, {
  readAll: true,
  dataType: 'blood_oxygen',
  timeoutMs: 1000
});

if (
  oxygenTypeFilterSent.some((hex) => /^00[0-9a-f]{2}361a0[245]$/i.test(hex)) ||
  !oxygenTypeFilterSent.some((hex) => /^00[0-9a-f]{2}361a03$/i.test(hex)) ||
  oxygenTypeFilterResult.records.length !== 1 ||
  oxygenTypeFilterResult.records[0].dataType !== 'blood_oxygen_raw' ||
  oxygenTypeFilterResult.records[0].bloodOxygen !== 98 ||
  oxygenTypeFilterResult.parsed.files?.length !== 1 ||
  oxygenTypeFilterResult.parsed.totalFileCount !== 4 ||
  oxygenTypeFilterResult.parsed.selectedFileCount !== 1 ||
  oxygenTypeFilterResult.parsed.filteredFileCount !== 3 ||
  oxygenTypeFilterResult.parsed.dataType !== 'blood_oxygen'
) {
  throw new Error(`RW blood-oxygen history syncHealthDataByType should request spo2/oxygen files: ${JSON.stringify({
    oxygenTypeFilterSent,
    oxygenTypeFilterResult,
    oxygenTypeFilterReadOptions
  })}`);
}

const skinTemperatureFileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  files: [
    {
      total: 1,
      seq: 12,
      fileSize: 64,
      fileName: 'u1_20260101030101_skinTemperature.txt',
      userId: 'u1',
      timestampText: '20260101030101',
      fileType: 'skin_temp'
    },
    {
      total: 2,
      seq: 13,
      fileSize: 65,
      fileName: 'u1_20260101030202_hr.txt',
      userId: 'u1',
      timestampText: '20260101030202',
      fileType: 'hr'
    }
  ],
  raw: []
};
const skinTemperatureSent: string[] = [];
const skinTemperatureUploadParsed: RingParsedData = {
  type: 'rw_upload_file',
  protocol: 'rw',
  seq: 12,
  status: 'completed',
  records: [{ timestamp: 1767236461000, skinTemperature: '36.6 C' }],
  raw: []
};
const skinTemperatureAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    skinTemperatureReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    skinTemperatureSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(skinTemperatureFileListParsed)) return skinTemperatureFileListParsed;
    if (predicate(skinTemperatureUploadParsed)) return skinTemperatureUploadParsed;
    throw new Error('Unexpected skin-temperature type-filter RW history parity predicate.');
  }
} as LegacyRingAdapter;

let skinTemperatureReadOptions: any;
const skinTemperatureResult = await syncRwHistoryFiles(skinTemperatureAdapter, {
  readAll: true,
  dataType: 'skin-temp',
  timeoutMs: 1000
});

if (
  skinTemperatureSent.some((hex) => /^00[0-9a-f]{2}361a0d$/i.test(hex)) ||
  !skinTemperatureSent.some((hex) => /^00[0-9a-f]{2}361a0c$/i.test(hex)) ||
  skinTemperatureResult.records.length !== 1 ||
  skinTemperatureResult.records[0].dataType !== 'temperature' ||
  skinTemperatureResult.records[0].rawDataType !== 'skin_temp' ||
  skinTemperatureResult.records[0].skinTemperature !== '36.6 C' ||
  skinTemperatureResult.parsed.files?.length !== 1 ||
  skinTemperatureResult.parsed.totalFileCount !== 2 ||
  skinTemperatureResult.parsed.selectedFileCount !== 1 ||
  skinTemperatureResult.parsed.filteredFileCount !== 1 ||
  skinTemperatureResult.parsed.dataType !== 'skin-temp'
) {
  throw new Error(`RW skin-temperature history syncHealthDataByType should request only temperature files: ${JSON.stringify({
    skinTemperatureSent,
    skinTemperatureResult,
    skinTemperatureReadOptions
  })}`);
}

const metricTypeFilterFileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  files: [
    {
      total: 1,
      seq: 14,
      fileSize: 64,
      fileName: 'u1_20260101050101_hrv.txt',
      userId: 'u1',
      timestampText: '20260101050101',
      fileType: 'hrv'
    },
    {
      total: 2,
      seq: 15,
      fileSize: 64,
      fileName: 'u1_20260101050202_stress.txt',
      userId: 'u1',
      timestampText: '20260101050202',
      fileType: 'stress'
    },
    {
      total: 3,
      seq: 16,
      fileSize: 64,
      fileName: 'u1_20260101050303_glucose.txt',
      userId: 'u1',
      timestampText: '20260101050303',
      fileType: 'glucose'
    },
    {
      total: 4,
      seq: 17,
      fileSize: 64,
      fileName: 'u1_20260101050404_hr.txt',
      userId: 'u1',
      timestampText: '20260101050404',
      fileType: 'hr'
    }
  ],
  raw: []
};

const runMetricTypeFilterParity = async (
  dataType: string,
  seqHex: string,
  expectedDataType: string,
  record: Record<string, any>,
  expectedField: string,
  expectedValue: unknown
) => {
  const metricTypeFilterSent: string[] = [];
  let metricTypeFilterReadOptions: any;
  const metricTypeFilterUploadParsed: RingParsedData = {
    type: 'rw_upload_file',
    protocol: 'rw',
    seq: Number.parseInt(seqHex, 16),
    status: 'completed',
    records: [record],
    raw: []
  };
  const metricTypeFilterAdapter = {
    protocol: 'rw',
    state: {} as RingBleState,
    readLocalData: async (options?: any) => {
      metricTypeFilterReadOptions = options;
    },
    sendBytes: async (bytes: Uint8Array) => {
      metricTypeFilterSent.push(bytesToHex(bytes));
    },
    waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
      if (predicate(metricTypeFilterFileListParsed)) return metricTypeFilterFileListParsed;
      if (predicate(metricTypeFilterUploadParsed)) return metricTypeFilterUploadParsed;
      throw new Error(`Unexpected ${dataType} metric type-filter RW history parity predicate.`);
    }
  } as LegacyRingAdapter;

  const metricTypeFilterResult = await syncRwHistoryFiles(metricTypeFilterAdapter, {
    readAll: true,
    dataType,
    timeoutMs: 1000
  });

  const selectedSeqPattern = new RegExp(`^00[0-9a-f]{2}361a${seqHex}$`, 'i');
  const otherSeqPattern = /^00[0-9a-f]{2}361a(0e|0f|10|11)$/i;
  if (
    !metricTypeFilterSent.some((hex) => selectedSeqPattern.test(hex)) ||
    metricTypeFilterSent.some((hex) => otherSeqPattern.test(hex) && !selectedSeqPattern.test(hex)) ||
    metricTypeFilterResult.records.length !== 1 ||
    metricTypeFilterResult.records[0].dataType !== expectedDataType ||
    metricTypeFilterResult.records[0][expectedField] !== expectedValue ||
    metricTypeFilterResult.parsed.files?.length !== 1 ||
    metricTypeFilterResult.parsed.totalFileCount !== 4 ||
    metricTypeFilterResult.parsed.selectedFileCount !== 1 ||
    metricTypeFilterResult.parsed.filteredFileCount !== 3 ||
    metricTypeFilterResult.parsed.dataType !== dataType
  ) {
    throw new Error(`RW ${dataType} history syncHealthDataByType should request only matching metric files: ${JSON.stringify({
      metricTypeFilterSent,
      metricTypeFilterResult,
      metricTypeFilterReadOptions
    })}`);
  }
};

await runMetricTypeFilterParity('hrv', '0e', 'hrv', { timestamp: 1767243661000, hrv: 42 }, 'hrv', 42);
await runMetricTypeFilterParity('stress', '0f', 'stress', { timestamp: 1767243722000, stress: 33 }, 'stress', 33);
await runMetricTypeFilterParity('blood_sugar', '10', 'blood_sugar', { timestamp: 1767243783000, bloodSugar: 5.6 }, 'bloodSugar', 5.6);
await runMetricTypeFilterParity('heart_rate', '11', 'heart_rate_raw', { timestamp: 1767243844000, heartRate: 75 }, 'heartRate', 75);

const pageHistoryAliasFileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  files: [
    {
      total: 1,
      seq: 21,
      fileSize: 80,
      fileName: 'u1_20260101040101_sleep_detail.txt',
      userId: 'u1',
      timestampText: '20260101040101',
      fileType: 'sleep_detail'
    },
    {
      total: 2,
      seq: 22,
      fileSize: 90,
      fileName: 'u1_20260101040202_daily_activity.txt',
      userId: 'u1',
      timestampText: '20260101040202',
      fileType: 'activity'
    },
    {
      total: 3,
      seq: 23,
      fileSize: 65,
      fileName: 'u1_20260101040303_hr.txt',
      userId: 'u1',
      timestampText: '20260101040303',
      fileType: 'hr'
    }
  ],
  raw: []
};
const sleepAliasSent: string[] = [];
let sleepAliasReadOptions: any;
const sleepAliasAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    sleepAliasReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    sleepAliasSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(pageHistoryAliasFileListParsed)) return pageHistoryAliasFileListParsed;
    throw new Error('Unexpected sleep alias RW history parity predicate.');
  }
} as LegacyRingAdapter;
const sleepAliasResult = await syncRwHistoryFiles(sleepAliasAdapter, {
  readAll: true,
  dataType: 'sleepData',
  timeoutMs: 1000
});

if (
  !sleepAliasSent.some((hex) => /^00[0-9a-f]{2}361a15$/i.test(hex)) ||
  sleepAliasSent.some((hex) => /^00[0-9a-f]{2}361a1[67]$/i.test(hex)) ||
  sleepAliasResult.records.length !== 1 ||
  sleepAliasResult.records[0].dataType !== 'sleep' ||
  sleepAliasResult.records[0].rawDataType !== 'sleep_detail' ||
  sleepAliasResult.parsed.files?.length !== 1 ||
  sleepAliasResult.parsed.selectedFileCount !== 1 ||
  sleepAliasResult.parsed.filteredFileCount !== 2 ||
  sleepAliasResult.parsed.dataType !== 'sleepData'
) {
  throw new Error(`RW sleepData history syncHealthDataByType should request only sleep files: ${JSON.stringify({
    sleepAliasSent,
    sleepAliasResult,
    sleepAliasReadOptions
  })}`);
}

const activityAliasSent: string[] = [];
let activityAliasReadOptions: any;
const activityAliasAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    activityAliasReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    activityAliasSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(pageHistoryAliasFileListParsed)) return pageHistoryAliasFileListParsed;
    throw new Error('Unexpected activity alias RW history parity predicate.');
  }
} as LegacyRingAdapter;
const activityAliasResult = await syncRwHistoryFiles(activityAliasAdapter, {
  readAll: true,
  dataType: 'activity',
  timeoutMs: 1000
});

if (
  !activityAliasSent.some((hex) => /^00[0-9a-f]{2}361a16$/i.test(hex)) ||
  activityAliasSent.some((hex) => /^00[0-9a-f]{2}361a1[57]$/i.test(hex)) ||
  activityAliasResult.records.length !== 1 ||
  activityAliasResult.records[0].dataType !== 'step' ||
  activityAliasResult.records[0].rawDataType !== 'activity' ||
  activityAliasResult.parsed.files?.length !== 1 ||
  activityAliasResult.parsed.selectedFileCount !== 1 ||
  activityAliasResult.parsed.filteredFileCount !== 2 ||
  activityAliasResult.parsed.dataType !== 'activity'
) {
  throw new Error(`RW activity history syncHealthDataByType should request only step/activity files: ${JSON.stringify({
    activityAliasSent,
    activityAliasResult,
    activityAliasReadOptions
  })}`);
}

const multiTypeAliasSent: string[] = [];
let multiTypeAliasReadOptions: any;
const multiTypeAliasUploadParsed: RingParsedData[] = [
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    seq: 22,
    status: 'completed',
    records: [{ timestamp: 1767211322000, stepCount: 1288 }],
    raw: []
  } as RingParsedData,
  {
    type: 'rw_upload_file',
    protocol: 'rw',
    seq: 23,
    status: 'completed',
    records: [{ timestamp: 1767211383000, heartRate: 74 }],
    raw: []
  } as RingParsedData
];
const multiTypeAliasAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    multiTypeAliasReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    multiTypeAliasSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(pageHistoryAliasFileListParsed)) return pageHistoryAliasFileListParsed;
    const uploadParsed = multiTypeAliasUploadParsed.find(predicate);
    if (uploadParsed) return uploadParsed;
    throw new Error('Unexpected multi-type RW history parity predicate.');
  }
} as LegacyRingAdapter;
const multiTypeAliasResult = await syncRwHistoryFiles(multiTypeAliasAdapter, {
  readAll: true,
  dataTypes: ['activity', 'heartRate'],
  timeoutMs: 1000
});

if (
  multiTypeAliasResult.records.length !== 2 ||
  multiTypeAliasResult.records[0].dataType !== 'step' ||
  multiTypeAliasResult.records[1].dataType !== 'heart_rate_raw' ||
  multiTypeAliasResult.parsed.files?.length !== 2 ||
  multiTypeAliasResult.parsed.selectedFileCount !== 2 ||
  multiTypeAliasResult.parsed.filteredFileCount !== 1 ||
  JSON.stringify(multiTypeAliasResult.parsed.dataTypes) !== JSON.stringify(['step', 'heart_rate']) ||
  multiTypeAliasSent.filter((hex) => /^00[0-9a-f]{2}361a/i.test(hex)).length !== 2
) {
  throw new Error(`RW history sync should support one file-list read filtered by multiple page data types: ${JSON.stringify({
    multiTypeAliasSent,
    multiTypeAliasResult,
    multiTypeAliasReadOptions
  })}`);
}

const defaultRangeSent: string[] = [];
let defaultRangeReadOptions: any;
const defaultRangeAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: any) => {
    defaultRangeReadOptions = options;
  },
  sendBytes: async (bytes: Uint8Array) => {
    defaultRangeSent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(filteredFileListParsed)) return filteredFileListParsed;
    throw new Error('Unexpected default-range RW history parity predicate.');
  }
} as LegacyRingAdapter;

const defaultRangeResult = await syncRwHistoryFiles(defaultRangeAdapter, { timeoutMs: 1000 });

if (
  defaultRangeSent.some((hex) => /^00[0-9a-f]{2}361a0[89]$/i.test(hex)) ||
  defaultRangeResult.parsed.status !== 'filtered' ||
  defaultRangeResult.parsed.message !== 'RW history files are outside the current read range or type filter.' ||
  defaultRangeResult.records.length !== 0 ||
  defaultRangeResult.parsed.files?.length !== 0 ||
  defaultRangeResult.parsed.allFiles?.length !== 2 ||
  defaultRangeResult.parsed.totalFileCount !== 2 ||
  defaultRangeResult.parsed.selectedFileCount !== 0 ||
  defaultRangeResult.parsed.filteredFileCount !== 2 ||
  defaultRangeResult.parsed.readAll !== false ||
  !defaultRangeResult.parsed.sinceTimestamp
) {
  throw new Error(`RW history sync should default to today's records unless readAll is enabled: ${JSON.stringify({
    defaultRangeSent,
    defaultRangeResult,
    defaultRangeReadOptions
  })}`);
}

const emptyFileListParsed: RingParsedData = {
  type: 'rw_file_list',
  protocol: 'rw',
  files: [],
  raw: []
};
const emptySent: string[] = [];
const emptyAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async () => undefined,
  sendBytes: async (bytes: Uint8Array) => {
    emptySent.push(bytesToHex(bytes));
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(emptyFileListParsed)) return emptyFileListParsed;
    throw new Error('Unexpected empty RW history parity predicate.');
  }
} as LegacyRingAdapter;

const emptyResult = await syncRwHistoryFiles(emptyAdapter, { readAll: true, timeoutMs: 1000 });

if (
  !emptySent.some((hex) => /^00[0-9a-f]{2}360100000000$/i.test(hex)) ||
  emptySent.some((hex) => /^00[0-9a-f]{2}361a/i.test(hex)) ||
  emptyResult.parsed.status !== 'empty' ||
  emptyResult.parsed.message !== 'RW history file list is empty.' ||
  emptyResult.records.length !== 0 ||
  emptyResult.parsed.totalFileCount !== 0 ||
  emptyResult.parsed.selectedFileCount !== 0 ||
  emptyResult.parsed.filteredFileCount !== 0
) {
  throw new Error(`RW history sync should keep a truly empty file list distinct from filtered files: ${JSON.stringify({ emptySent, emptyResult })}`);
}

const delayedFileListReadOptions: unknown[] = [];
const delayedFileListAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    delayedFileListReadOptions.push(options);
  },
  sendBytes: async () => undefined,
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (predicate(emptyFileListParsed)) return emptyFileListParsed;
    throw new Error('Unexpected delayed file-list RW history parity predicate.');
  }
} as unknown as LegacyRingAdapter;

const delayedFileListResult = await syncRwHistoryFiles(delayedFileListAdapter, {
  readAll: true,
  timeoutMs: 1000,
  fileListRetryDelayMs: 5
});

if (
  delayedFileListResult.parsed.status !== 'empty' ||
  delayedFileListResult.records.length !== 0 ||
  delayedFileListResult.parsed.readAll !== true
) {
  throw new Error(`RW history sync should accept a delayed file-list response from the fallback wait: ${JSON.stringify({
    delayedFileListReadOptions,
    delayedFileListResult
  })}`);
}

const nativeHealthListParsed: RingParsedData = {
  type: 'qkeer_v2_health_list',
  protocol: 'rw',
  packetShape: 'qkeer_v2_compat',
  dataType: 'vital',
  status: 'success',
  totalNum: 3,
  deviceId: 'ios-random-history-device',
  uniMacId: 'ios-random-history-id',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  records: [
    {
      unixTime: 1767229400,
      heartRate: 71,
      bloodOxygen: 97,
      temperature: 36.4
    },
    {
      unixTime: 1767229460,
      heartrate: 72,
      spo2: 98,
      temperature: 36.5
    },
    {
      unixTime: 1767229520,
      heartRate: 73,
      bloodOxygen: 46,
      temperature: 36.6
    }
  ],
  raw: []
} as RingParsedData;
const nativeHealthSent: Array<{ hex: string; label?: string }> = [];
const nativeHealthReadOptions: unknown[] = [];
const nativeHealthAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    nativeHealthReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    nativeHealthSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(nativeHealthListParsed)) return nativeHealthListParsed;
    throw new Error('No legacy local_data response for native health-list parity.');
  }
} as LegacyRingAdapter;

const nativeHealthResult = await syncRwHistoryFiles(nativeHealthAdapter, {
  readAll: false,
  dataTypes: ['heartRate', 'bloodOxygen', 'skinTemperature'],
  sinceTimestamp: 1767229000,
  timeoutMs: 1000,
  fileListRetryDelayMs: 5
});
const nativeHealthCommands = nativeHealthSent.filter((item) => item.label?.startsWith('history/native-list/'));

if (
  nativeHealthReadOptions.length !== 0 ||
  nativeHealthCommands.length !== 0 ||
  !nativeHealthSent.some((item) => item.label === 'history/read-local-data-incremental' && /^00[0-9a-f]{2}360048c65569$/i.test(item.hex)) ||
  nativeHealthResult.parsed.type !== 'local_data' ||
  nativeHealthResult.parsed.packetShape !== 'qkeer_v2_compat' ||
  nativeHealthResult.parsed.sourceType !== 'qkeer_v2_health_list' ||
  nativeHealthResult.parsed.dataType !== 'vital' ||
  JSON.stringify(nativeHealthResult.parsed.dataTypes) !== JSON.stringify(['heart_rate', 'blood_oxygen', 'temperature']) ||
  nativeHealthResult.records.length !== 3 ||
  nativeHealthResult.records[0].dataType !== 'vital' ||
  nativeHealthResult.records[0].rawDataType !== 'vital' ||
  nativeHealthResult.records[0].heartRate !== 71 ||
  nativeHealthResult.records[0].bloodOxygen !== 97 ||
  nativeHealthResult.records[1].heartRate !== 72 ||
  nativeHealthResult.records[1].bloodOxygen !== 98 ||
  nativeHealthResult.records[2].heartRate !== 73 ||
  nativeHealthResult.records[2].bloodOxygen != null ||
  nativeHealthResult.records[2].spo2 != null ||
  nativeHealthResult.parsed.totalNum !== 3
) {
  throw new Error(`RW initial qkeer_v2_health_list history should map to L19-compatible local_data without fallback: ${JSON.stringify({
    nativeHealthSent,
    nativeHealthReadOptions,
    nativeHealthResult
  })}`);
}

const nativeLastDataParsed: RingParsedData = {
  type: 'qkeer_v2_last_data',
  protocol: 'rw',
  packetShape: 'qkeer_v2_compat',
  dataType: 'summary',
  status: 'success',
  totalNum: 1,
  deviceId: 'ios-random-history-device',
  uniMacId: 'ios-random-history-id',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  records: [
    {
      dataType: 'summary',
      rawDataType: 'last_data',
      unixTime: 1767229600,
      battery: 77,
      stepCount: 1234,
      heartRate: 66,
      bloodOxygen: 98,
      temperature: 36.9,
      sleepTotalMinutes: 230,
      fatigue: 320,
      anxiety: 650
    }
  ],
  raw: []
} as RingParsedData;
const nativeLastDataSent: Array<{ hex: string; label?: string }> = [];
const nativeLastDataReadOptions: unknown[] = [];
const waitForNativeLastDataCommand = () =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (nativeLastDataSent.some((item) => item.label === 'history/native-last-data')) {
        resolve(nativeLastDataParsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error('native LastData fallback command was not sent.'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const nativeLastDataAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    nativeLastDataReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    nativeLastDataSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (!predicate(nativeLastDataParsed)) throw new Error('No immediate legacy/native history response for LastData parity.');
    return waitForNativeLastDataCommand();
  }
} as LegacyRingAdapter;

const nativeLastDataPromise = syncRwHistoryFiles(nativeLastDataAdapter, {
  readAll: false,
  dataTypes: ['sleepData'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});
await delay(50);
if (nativeLastDataSent.some((item) => item.label === 'history/native-last-data')) {
  throw new Error(`RW sleep history fallback should wait for native-list response before sending LastData: ${JSON.stringify({
    nativeLastDataSent
  })}`);
}
const nativeLastDataResult = await nativeLastDataPromise;
const nativeLastDataCommands = nativeLastDataSent.filter((item) => item.label?.startsWith('history/native-list/'));

if (
  nativeLastDataReadOptions.length !== 0 ||
  nativeLastDataCommands.length !== 1 ||
  nativeLastDataCommands[0]?.label !== 'history/native-list/sleep' ||
  !nativeLastDataSent.some((item) => item.label === 'history/native-last-data') ||
  nativeLastDataResult.parsed.type !== 'local_data' ||
  nativeLastDataResult.parsed.packetShape !== 'qkeer_v2_compat' ||
  nativeLastDataResult.parsed.sourceType !== 'qkeer_v2_last_data' ||
  JSON.stringify(nativeLastDataResult.parsed.dataTypes) !== JSON.stringify(['sleep']) ||
  nativeLastDataResult.records.length !== 1 ||
  nativeLastDataResult.records[0].dataType !== 'sleep' ||
  nativeLastDataResult.records[0].rawDataType !== 'last_data' ||
  nativeLastDataResult.records[0].sleepTotalMinutes !== 230 ||
  nativeLastDataResult.records[0].heartRate !== 66 ||
  nativeLastDataResult.records[0].bloodOxygen !== 98 ||
  nativeLastDataResult.parsed.totalNum !== 1
) {
  throw new Error(`RW LastData fallback should become L19-compatible sleep local_data when file-list responses are silent: ${JSON.stringify({
    nativeLastDataSent,
    nativeLastDataReadOptions,
    nativeLastDataResult
  })}`);
}

const nativeLastDataOnlySent: Array<{ hex: string; label?: string }> = [];
const nativeLastDataOnlyReadOptions: unknown[] = [];
const waitForNativeLastDataOnlyCommand = () =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (nativeLastDataOnlySent.some((item) => item.label === 'history/native-last-data')) {
        resolve(nativeLastDataParsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error('native LastData-only command was not sent.'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const nativeLastDataOnlyAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    nativeLastDataOnlyReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    nativeLastDataOnlySent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (!predicate(nativeLastDataParsed)) throw new Error('No immediate native LastData response for LastData-only parity.');
    return waitForNativeLastDataOnlyCommand();
  }
} as LegacyRingAdapter;

const nativeLastDataOnlyResult = await syncRwHistoryFiles(nativeLastDataOnlyAdapter, {
  readAll: false,
  dataType: 'lastData',
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});
const nativeLastDataOnlyListCommands = nativeLastDataOnlySent.filter((item) => item.label?.startsWith('history/native-list/'));

if (
  nativeLastDataOnlyReadOptions.length !== 0 ||
  nativeLastDataOnlyListCommands.length !== 0 ||
  nativeLastDataOnlySent.filter((item) => item.label === 'history/native-last-data').length !== 1 ||
  nativeLastDataOnlyResult.parsed.type !== 'local_data' ||
  nativeLastDataOnlyResult.parsed.packetShape !== 'qkeer_v2_compat' ||
  nativeLastDataOnlyResult.parsed.sourceType !== 'qkeer_v2_last_data' ||
  nativeLastDataOnlyResult.parsed.dataType !== 'lastData' ||
  JSON.stringify(nativeLastDataOnlyResult.parsed.dataTypes) !== JSON.stringify(['summary']) ||
  nativeLastDataOnlyResult.records.length !== 1 ||
  nativeLastDataOnlyResult.records[0].dataType !== 'summary' ||
  nativeLastDataOnlyResult.records[0].rawDataType !== 'last_data' ||
  nativeLastDataOnlyResult.records[0].heartRate !== 66 ||
  nativeLastDataOnlyResult.records[0].bloodOxygen !== 98
) {
  throw new Error(`RW LastData-only diagnostic should send exactly one native LastData command: ${JSON.stringify({
    nativeLastDataOnlySent,
    nativeLastDataOnlyReadOptions,
  nativeLastDataOnlyResult
  })}`);
}

const nativeLastDataVitalOnlyParsed: RingParsedData = {
  type: 'qkeer_v2_last_data',
  protocol: 'rw',
  packetShape: 'qkeer_v2_compat',
  dataType: 'summary',
  status: 'success',
  totalNum: 1,
  records: [
    {
      dataType: 'summary',
      rawDataType: 'last_data',
      unixTime: 1767229700,
      hrv: 42,
      stress: 58,
      bloodSugar: 5.7,
      bloodPressure: {
        systolic: 118,
        diastolic: 76
      }
    }
  ],
  raw: []
} as RingParsedData;
const nativeLastDataVitalOnlySent: Array<{ hex: string; label?: string }> = [];
const nativeLastDataVitalOnlyReadOptions: unknown[] = [];
const waitForNativeLastDataVitalOnlyCommand = () =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (nativeLastDataVitalOnlySent.some((item) => item.label === 'history/native-last-data')) {
        resolve(nativeLastDataVitalOnlyParsed);
        return;
      }
      if (Date.now() - startedAt > 6500) {
        reject(new Error('native LastData vital fallback command was not sent.'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const nativeLastDataVitalOnlyAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    nativeLastDataVitalOnlyReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    nativeLastDataVitalOnlySent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean, timeoutMs = 1000) => {
    if (!predicate(nativeLastDataVitalOnlyParsed)) {
      return new Promise<RingParsedData>((_resolve, reject) => {
        setTimeout(() => reject(new Error('No matching native LastData vital response.')), Math.min(timeoutMs, 50));
      });
    }
    return waitForNativeLastDataVitalOnlyCommand();
  }
} as LegacyRingAdapter;

const nativeLastDataVitalOnlyResult = await syncRwHistoryFiles(nativeLastDataVitalOnlyAdapter, {
  readAll: false,
  dataTypes: ['vital'],
  sinceTimestamp: 1767229000,
  timeoutMs: 8000,
  fileListRetryDelayMs: 5
});

if (
  nativeLastDataVitalOnlyReadOptions.length !== 0 ||
  !nativeLastDataVitalOnlySent.some((item) => item.label === 'history/native-last-data') ||
  nativeLastDataVitalOnlyResult.parsed.type !== 'local_data' ||
  nativeLastDataVitalOnlyResult.parsed.sourceType !== 'qkeer_v2_last_data' ||
  JSON.stringify(nativeLastDataVitalOnlyResult.parsed.dataTypes) !== JSON.stringify(['vital']) ||
  nativeLastDataVitalOnlyResult.records.length !== 1 ||
  nativeLastDataVitalOnlyResult.records[0].dataType !== 'vital' ||
  nativeLastDataVitalOnlyResult.records[0].rawDataType !== 'last_data' ||
  nativeLastDataVitalOnlyResult.records[0].hrv !== 42 ||
  nativeLastDataVitalOnlyResult.records[0].stress !== 58 ||
  nativeLastDataVitalOnlyResult.records[0].bloodSugar !== 5.7 ||
  nativeLastDataVitalOnlyResult.records[0].bloodPressure?.systolic !== 118 ||
  nativeLastDataVitalOnlyResult.records[0].bloodPressure?.diastolic !== 76
) {
  throw new Error(`RW LastData vital fallback should keep all L19-compatible vital metrics: ${JSON.stringify({
    nativeLastDataVitalOnlySent,
    nativeLastDataVitalOnlyReadOptions,
    nativeLastDataVitalOnlyResult
  })}`);
}

const abPreNativeHistoryParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x0503,
  name: 'heart_rate',
  value: 72,
  recordTime: 1767229700,
  flag: 0x10,
  deviceId: 'ios-random-history-device',
  uniMacId: 'ios-random-history-id',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  raw: []
} as RingParsedData;
const abPreNativeSent: Array<{ hex: string; label?: string }> = [];
const abPreNativeReadOptions: unknown[] = [];
const waitForPreNativeAbCommand = () =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (abPreNativeSent.some((item) => item.label === 'history/ab-key/heart-rate/read')) {
        resolve(abPreNativeHistoryParsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error('pre-native AB heart-rate history command was not sent.'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const abPreNativeAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    abPreNativeReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    abPreNativeSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (!predicate(abPreNativeHistoryParsed)) throw new Error('No immediate legacy/native history response before AB key parity.');
    return waitForPreNativeAbCommand();
  }
} as LegacyRingAdapter;

const abPreNativeResult = await syncRwHistoryFiles(abPreNativeAdapter, {
  readAll: false,
  dataTypes: ['heartRate'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  abPreNativeReadOptions.length !== 0 ||
  !abPreNativeSent.some((item) => item.label === 'history/read-local-data-incremental') ||
  !abPreNativeSent.some((item) => item.label === 'history/ab-key/heart-rate/read') ||
  abPreNativeSent.some((item) => item.label === 'history/ab-key/heart-rate/read-continue') ||
  abPreNativeSent.some((item) => item.label?.startsWith('history/native-list/')) ||
  abPreNativeSent.some((item) => item.label === 'history/native-last-data') ||
  abPreNativeResult.parsed.type !== 'local_data' ||
  abPreNativeResult.parsed.packetShape !== 'ab_health_key' ||
  abPreNativeResult.parsed.sourceType !== 'rw_ab_health_history' ||
  JSON.stringify(abPreNativeResult.parsed.dataTypes) !== JSON.stringify(['heart_rate']) ||
  abPreNativeResult.records.length !== 1 ||
  abPreNativeResult.records[0].dataType !== 'heart_rate' ||
  abPreNativeResult.records[0].rawDataType !== 'ab_health_key' ||
  abPreNativeResult.records[0].heartRate !== 72 ||
  abPreNativeResult.records[0].unixTime !== 1767229700
) {
  throw new Error(`RW history should prefer targeted AB key fallback before silent QKeer V2 history commands: ${JSON.stringify({
    abPreNativeSent,
    abPreNativeReadOptions,
    abPreNativeResult
  })}`);
}

const abPreNativeTemperatureParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x0230,
  name: 'temperature',
  value: 36.7,
  recordTime: 1767229700,
  flag: 0x10,
  raw: []
} as RingParsedData;
const abPreNativeTemperatureSent: Array<{ hex: string; label?: string }> = [];
const abPreNativeTemperatureReadOptions: unknown[] = [];
const waitForPreNativeTemperatureCommand = () =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (abPreNativeTemperatureSent.some((item) => item.label === 'history/ab-key/temperature-current/read')) {
        resolve(abPreNativeTemperatureParsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error('pre-native AB current-temperature command was not sent.'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const abPreNativeTemperatureAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    abPreNativeTemperatureReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    abPreNativeTemperatureSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean, timeoutMs = 1000) => {
    if (!predicate(abPreNativeTemperatureParsed)) {
      return new Promise<RingParsedData>((_resolve, reject) => {
        setTimeout(() => reject(new Error('No matching current-temperature history response.')), Math.min(timeoutMs, 25));
      });
    }
    return waitForPreNativeTemperatureCommand();
  }
} as LegacyRingAdapter;

const abPreNativeTemperatureResult = await syncRwHistoryFiles(abPreNativeTemperatureAdapter, {
  readAll: false,
  dataTypes: ['temperature'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  !abPreNativeTemperatureSent.some((item) => item.label === 'history/read-local-data-incremental') ||
  !abPreNativeTemperatureSent.some((item) => item.label === 'history/ab-key/temperature-current/read') ||
  !abPreNativeTemperatureSent.some((item) => item.label === 'history/ab-key/temperature-history/read') ||
  abPreNativeTemperatureSent.findIndex((item) => item.label === 'history/ab-key/temperature-current/read') >
    abPreNativeTemperatureSent.findIndex((item) => item.label === 'history/ab-key/temperature-history/read') ||
  abPreNativeTemperatureResult.parsed.type !== 'local_data' ||
  abPreNativeTemperatureResult.parsed.packetShape !== 'ab_health_key' ||
  abPreNativeTemperatureResult.parsed.sourceType !== 'rw_ab_health_history' ||
  JSON.stringify(abPreNativeTemperatureResult.parsed.dataTypes) !== JSON.stringify(['temperature']) ||
  abPreNativeTemperatureResult.records.length !== 1 ||
  abPreNativeTemperatureResult.records[0].dataType !== 'temperature' ||
  abPreNativeTemperatureResult.records[0].rawDataType !== 'ab_health_key' ||
  abPreNativeTemperatureResult.records[0].key !== 0x0230 ||
  abPreNativeTemperatureResult.records[0].temperature !== 36.7 ||
  abPreNativeTemperatureResult.records[0].unixTime !== 1767229700
) {
  throw new Error(`RW history should probe SDK current-temperature key before historical temperature key: ${JSON.stringify({
    abPreNativeTemperatureSent,
    abPreNativeTemperatureReadOptions,
    abPreNativeTemperatureResult
  })}`);
}

const abMergePreNativeHeartRateParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x0503,
  name: 'heart_rate',
  value: 72,
  recordTime: 1767229700,
  flag: 0x10,
  raw: []
} as RingParsedData;
const abMergeFinalHrvParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x050a,
  name: 'hrv',
  value: 42,
  recordTime: 1767229760,
  flag: 0x10,
  raw: []
} as RingParsedData;
const abMergeFinalStressParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x050d,
  name: 'stress',
  value: 31,
  recordTime: 1767229820,
  flag: 0x10,
  raw: []
} as RingParsedData;
const abMergeSent: Array<{ hex: string; label?: string }> = [];
const abMergeReadOptions: unknown[] = [];
const waitForAbMergeCommand = (label: string, parsed: RingParsedData) =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (abMergeSent.some((item) => item.label === label)) {
        resolve(parsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error(`${label} was not sent for merged AB history parity.`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const abMergeAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    abMergeReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    abMergeSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(abMergePreNativeHeartRateParsed)) {
      return waitForAbMergeCommand('history/ab-key/heart-rate/read', abMergePreNativeHeartRateParsed);
    }
    if (predicate(abMergeFinalHrvParsed)) {
      return waitForAbMergeCommand('history/ab-key/hrv/read', abMergeFinalHrvParsed);
    }
    if (predicate(abMergeFinalStressParsed)) {
      return waitForAbMergeCommand('history/ab-key/stress/read', abMergeFinalStressParsed);
    }
    throw new Error('No immediate legacy/native history response before merged AB key parity.');
  }
} as LegacyRingAdapter;

const abMergeResult = await syncRwHistoryFiles(abMergeAdapter, {
  readAll: false,
  dataTypes: ['heartRate', 'hrv', 'stress'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  abMergeReadOptions.length !== 0 ||
  !abMergeSent.some((item) => item.label === 'history/ab-key/heart-rate/read') ||
  !abMergeSent.some((item) => item.label === 'history/ab-key/hrv/read') ||
  !abMergeSent.some((item) => item.label === 'history/ab-key/stress/read') ||
  abMergeSent.some((item) => item.label === 'history/ab-key/heart-rate/read-continue') ||
  abMergeSent.some((item) => item.label?.startsWith('history/native-list/')) ||
  abMergeSent.some((item) => item.label === 'history/native-last-data') ||
  abMergeResult.parsed.type !== 'local_data' ||
  abMergeResult.parsed.packetShape !== 'ab_health_key' ||
  abMergeResult.parsed.sourceType !== 'rw_ab_health_history' ||
  JSON.stringify(abMergeResult.parsed.dataTypes) !== JSON.stringify(['heart_rate', 'hrv', 'stress']) ||
  abMergeResult.records.length !== 3 ||
  abMergeResult.records[0].dataType !== 'heart_rate' ||
  abMergeResult.records[0].heartRate !== 72 ||
  abMergeResult.records[1].dataType !== 'hrv' ||
  abMergeResult.records[1].hrv !== 42 ||
  abMergeResult.records[2].dataType !== 'stress' ||
  abMergeResult.records[2].stress !== 31 ||
  abMergeResult.parsed.totalNum !== 3 ||
  abMergeResult.parsed.sourceResponses?.length !== 3
) {
  throw new Error(`RW history must merge pre-native AB payloads with later AB key payloads instead of stopping after the first metric: ${JSON.stringify({
    abMergeSent,
    abMergeReadOptions,
    abMergeResult
  })}`);
}

const abPreNativeWithEmptyNativeParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x0503,
  name: 'heart_rate',
  value: 72,
  recordTime: 1767229700,
  flag: 0x10,
  raw: []
} as RingParsedData;
const emptyFinalHrvReadAck: RingParsedData = {
  type: 'rw_health_data_ack',
  protocol: 'rw',
  key: 0x050a,
  name: 'hrv',
  status: 'pending',
  flag: 0x10,
  raw: []
} as RingParsedData;
const emptyFinalHrvContinueAck: RingParsedData = {
  type: 'rw_health_data_ack',
  protocol: 'rw',
  key: 0x050a,
  name: 'hrv',
  status: 'pending',
  flag: 0x11,
  raw: []
} as RingParsedData;
const abPreNativeEmptyNativeSent: Array<{ hex: string; label?: string }> = [];
const waitForAbPreNativeEmptyNativeCommand = (label: string, parsed: RingParsedData) =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (abPreNativeEmptyNativeSent.some((item) => item.label === label)) {
        resolve(parsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error(`${label} was not sent for empty-native AB fallback parity.`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const abPreNativeEmptyNativeAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async () => undefined,
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    abPreNativeEmptyNativeSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(abPreNativeWithEmptyNativeParsed)) {
      return waitForAbPreNativeEmptyNativeCommand('history/ab-key/heart-rate/read', abPreNativeWithEmptyNativeParsed);
    }
    if (predicate(emptyFinalHrvContinueAck)) {
      return waitForAbPreNativeEmptyNativeCommand('history/ab-key/hrv/read-continue', emptyFinalHrvContinueAck);
    }
    if (predicate(emptyFinalHrvReadAck)) {
      return waitForAbPreNativeEmptyNativeCommand('history/ab-key/hrv/read', emptyFinalHrvReadAck);
    }
    throw new Error('No matching empty-native AB fallback response.');
  }
} as LegacyRingAdapter;

const abPreNativeEmptyNativeResult = await syncRwHistoryFiles(abPreNativeEmptyNativeAdapter, {
  readAll: false,
  dataTypes: ['heartRate', 'hrv'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  !abPreNativeEmptyNativeSent.some((item) => item.label === 'history/ab-key/heart-rate/read') ||
  !abPreNativeEmptyNativeSent.some((item) => item.label === 'history/ab-key/hrv/read') ||
  abPreNativeEmptyNativeSent.some((item) => item.label?.startsWith('history/native-list/')) ||
  abPreNativeEmptyNativeSent.some((item) => item.label === 'history/ab-key/hrv/read-continue') ||
  abPreNativeEmptyNativeResult.parsed.type !== 'local_data' ||
  abPreNativeEmptyNativeResult.parsed.packetShape !== 'ab_health_key' ||
  abPreNativeEmptyNativeResult.parsed.sourceType !== 'rw_ab_health_history' ||
  abPreNativeEmptyNativeResult.records.length !== 1 ||
  abPreNativeEmptyNativeResult.records[0].dataType !== 'heart_rate' ||
  abPreNativeEmptyNativeResult.records[0].heartRate !== 72
) {
  throw new Error(`RW history must keep pre-native AB payload and skip legacy fallback when final AB keys are empty: ${JSON.stringify({
    abPreNativeEmptyNativeSent,
    abPreNativeEmptyNativeResult
  })}`);
}

const emptyAbThenContinueAck: RingParsedData = {
  type: 'rw_health_data_ack',
  protocol: 'rw',
  key: 0x0503,
  name: 'heart_rate',
  status: 'pending',
  flag: 0x10,
  raw: []
} as RingParsedData;
const continueAbHistoryParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x0503,
  name: 'heart_rate',
  value: 74,
  recordTime: 1767229750,
  flag: 0x11,
  deviceId: 'ios-random-history-device',
  uniMacId: 'ios-random-history-id',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  raw: []
} as RingParsedData;
const abReadContinueSent: Array<{ hex: string; label?: string }> = [];
const abReadContinueReadOptions: unknown[] = [];
const waitForAbReadContinueCommand = (label: string, parsed: RingParsedData) =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (abReadContinueSent.some((item) => item.label === label)) {
        resolve(parsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error(`${label} was not sent.`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const abReadContinueAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    abReadContinueReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    abReadContinueSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (abReadContinueSent.some((item) => item.label === 'history/ab-key/heart-rate/read') && predicate(continueAbHistoryParsed)) {
      return waitForAbReadContinueCommand('history/ab-key/heart-rate/read-continue', continueAbHistoryParsed);
    }
    if (predicate(emptyAbThenContinueAck)) {
      return waitForAbReadContinueCommand('history/ab-key/heart-rate/read', emptyAbThenContinueAck);
    }
    throw new Error('No matching AB read-continue RW history response.');
  }
} as LegacyRingAdapter;

const abReadContinueResult = await syncRwHistoryFiles(abReadContinueAdapter, {
  readAll: false,
  dataTypes: ['heartRate'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  abReadContinueReadOptions.length !== 0 ||
  !abReadContinueSent.some((item) => item.label === 'history/read-local-data-incremental') ||
  !abReadContinueSent.some((item) => item.label === 'history/ab-key/heart-rate/read') ||
  abReadContinueSent.some((item) => item.label === 'history/ab-key/heart-rate/read-continue') ||
  abReadContinueSent.some((item) => item.label === 'history/native-last-data') ||
  abReadContinueResult.parsed.type !== 'local_data' ||
  abReadContinueResult.parsed.packetShape !== 'ab_health_key' ||
  abReadContinueResult.parsed.sourceType !== 'rw_ab_health_history' ||
  JSON.stringify(abReadContinueResult.parsed.dataTypes) !== JSON.stringify(['heart_rate']) ||
  abReadContinueResult.records.length !== 0
) {
  throw new Error(`RW history should stop automatic AB read-continue when the first AB read returns an empty ack: ${JSON.stringify({
    abReadContinueSent,
    abReadContinueReadOptions,
    abReadContinueResult
  })}`);
}

const emptyAbPreNativeHistoryParsed: RingParsedData = {
  type: 'rw_health_data_ack',
  protocol: 'rw',
  key: 0x0503,
  name: 'heart_rate',
  status: 'pending',
  flag: 0x10,
  raw: []
} as RingParsedData;
const emptyAbThenNativeSent: Array<{ hex: string; label?: string }> = [];
const emptyAbThenNativeReadOptions: unknown[] = [];
const waitForEmptyAbCommand = () =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (emptyAbThenNativeSent.some((item) => item.label === 'history/ab-key/heart-rate/read')) {
        resolve(emptyAbPreNativeHistoryParsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error('empty pre-native AB heart-rate history command was not sent.'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const emptyAbThenNativeAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    emptyAbThenNativeReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    emptyAbThenNativeSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(emptyAbPreNativeHistoryParsed)) return waitForEmptyAbCommand();
    throw new Error('No matching empty-AB/native RW history response.');
  }
} as LegacyRingAdapter;

const emptyAbThenNativeResult = await syncRwHistoryFiles(emptyAbThenNativeAdapter, {
  readAll: false,
  dataTypes: ['heartRate'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  emptyAbThenNativeReadOptions.length !== 0 ||
  !emptyAbThenNativeSent.some((item) => item.label === 'history/ab-key/heart-rate/read') ||
  emptyAbThenNativeSent.some((item) => item.label === 'history/ab-key/heart-rate/read-continue') ||
  emptyAbThenNativeSent.some((item) => item.label?.startsWith('history/native-list/')) ||
  emptyAbThenNativeResult.parsed.type !== 'local_data' ||
  emptyAbThenNativeResult.parsed.packetShape !== 'ab_health_key' ||
  emptyAbThenNativeResult.parsed.sourceType !== 'rw_ab_health_history' ||
  JSON.stringify(emptyAbThenNativeResult.parsed.dataTypes) !== JSON.stringify(['heart_rate']) ||
  emptyAbThenNativeResult.records.length !== 0
) {
  throw new Error(`RW history should stop after an empty pre-native AB ack without automatic read-continue or legacy fallback: ${JSON.stringify({
    emptyAbThenNativeSent,
    emptyAbThenNativeReadOptions,
    emptyAbThenNativeResult
  })}`);
}

const missingFlagAbHistoryParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x0503,
  name: 'heart_rate',
  value: 88,
  recordTime: 1767229701,
  raw: []
} as RingParsedData;
const nativeAfterMissingFlagAbParsed: RingParsedData = {
  type: 'qkeer_v2_health_list',
  protocol: 'rw',
  packetShape: 'qkeer_v2_compat',
  dataType: 'vital',
  status: 'success',
  totalNum: 1,
  records: [
    {
      unixTime: 1767229900,
      heartRate: 71,
      bloodOxygen: 97,
      temperature: 36.4
    }
  ],
  raw: []
} as RingParsedData;
const missingFlagAbSent: Array<{ hex: string; label?: string }> = [];
const missingFlagAbReadOptions: unknown[] = [];
let missingFlagAbMatched = false;
const waitForMissingFlagNativeCommand = () =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (missingFlagAbSent.some((item) => item.label === 'history/native-list/health')) {
        resolve(nativeAfterMissingFlagAbParsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error('native health-list command after missing AB flag was not sent.'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const missingFlagAbAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    missingFlagAbReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    missingFlagAbSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    if (predicate(missingFlagAbHistoryParsed)) {
      missingFlagAbMatched = true;
      throw new Error('AB history payload without an identifiable flag must not match a pending attempt.');
    }
    if (predicate(nativeAfterMissingFlagAbParsed)) return waitForMissingFlagNativeCommand();
    throw new Error('simulated missing flagged AB history response');
  }
} as LegacyRingAdapter;

const missingFlagAbResult = await syncRwHistoryFiles(missingFlagAbAdapter, {
  readAll: false,
  dataTypes: ['heartRate'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  missingFlagAbMatched ||
  missingFlagAbReadOptions.length !== 0 ||
  !missingFlagAbSent.some((item) => item.label === 'history/ab-key/heart-rate/read') ||
  missingFlagAbSent.some((item) => item.label === 'history/ab-key/heart-rate/read-continue') ||
  !missingFlagAbSent.some((item) => item.label === 'history/native-list/health') ||
  missingFlagAbSent.some((item) => item.label === 'history/native-last-data') ||
  missingFlagAbResult.parsed.type !== 'local_data' ||
  missingFlagAbResult.parsed.packetShape !== 'qkeer_v2_compat' ||
  missingFlagAbResult.parsed.sourceType !== 'qkeer_v2_health_list' ||
  JSON.stringify(missingFlagAbResult.parsed.dataTypes) !== JSON.stringify(['heart_rate']) ||
  missingFlagAbResult.records.length !== 1 ||
  missingFlagAbResult.records[0].heartRate !== 71 ||
  missingFlagAbResult.records[0].bloodOxygen !== 97 ||
  missingFlagAbResult.records[0].heartRate === 88
) {
  throw new Error(`RW history must ignore AB key payloads that do not expose a response flag: ${JSON.stringify({
    missingFlagAbMatched,
    missingFlagAbSent,
    missingFlagAbReadOptions,
    missingFlagAbResult
  })}`);
}

const partialNativeHeartOnlyParsed: RingParsedData = {
  type: 'qkeer_v2_health_list',
  protocol: 'rw',
  packetShape: 'qkeer_v2_compat',
  dataType: 'vital',
  status: 'success',
  totalNum: 1,
  records: [
    {
      dataType: 'vital',
      rawDataType: 'vital',
      unixTime: 1767229901,
      heartRate: 70
    }
  ],
  raw: []
} as RingParsedData;
const partialNativeFinalHrvParsed: RingParsedData = {
  type: 'rw_health_data',
  protocol: 'rw',
  key: 0x050a,
  name: 'hrv',
  value: 45,
  recordTime: 1767229961,
  flag: 0x10,
  raw: []
} as RingParsedData;
const partialNativeThenAbSent: Array<{ hex: string; label?: string }> = [];
const partialNativeThenAbReadOptions: unknown[] = [];
const waitForPartialNativeThenAbCommand = (label: string, parsed: RingParsedData) =>
  new Promise<RingParsedData>((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (partialNativeThenAbSent.some((item) => item.label === label)) {
        resolve(parsed);
        return;
      }
      if (Date.now() - startedAt > 2500) {
        reject(new Error(`${label} was not sent for partial native/final AB merge parity.`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
const partialNativeThenAbAdapter = {
  protocol: 'rw',
  state: {} as RingBleState,
  readLocalData: async (options?: unknown) => {
    partialNativeThenAbReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array, label?: string) => {
    partialNativeThenAbSent.push({ hex: bytesToHex(bytes), label });
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean, timeoutMs = 1000) => {
    if (predicate(partialNativeHeartOnlyParsed)) {
      return waitForPartialNativeThenAbCommand('history/native-list/health', partialNativeHeartOnlyParsed);
    }
    if (predicate(partialNativeFinalHrvParsed)) {
      return waitForPartialNativeThenAbCommand('history/ab-key/hrv/read', partialNativeFinalHrvParsed);
    }
    return new Promise<RingParsedData>((_resolve, reject) => {
      setTimeout(() => reject(new Error('No matching partial native/final AB response.')), Math.min(timeoutMs, 25));
    });
  }
} as LegacyRingAdapter;

const partialNativeThenAbResult = await syncRwHistoryFiles(partialNativeThenAbAdapter, {
  readAll: false,
  dataTypes: ['heartRate', 'hrv'],
  sinceTimestamp: 1767229000,
  timeoutMs: 3000,
  fileListRetryDelayMs: 5
});

if (
  partialNativeThenAbReadOptions.length !== 0 ||
  !partialNativeThenAbSent.some((item) => item.label === 'history/native-list/health') ||
  !partialNativeThenAbSent.some((item) => item.label === 'history/ab-key/hrv/read') ||
  partialNativeThenAbSent.filter((item) => item.label === 'history/ab-key/heart-rate/read').length !== 1 ||
  partialNativeThenAbResult.parsed.type !== 'local_data' ||
  partialNativeThenAbResult.parsed.packetShape !== 'ab_health_key' ||
  JSON.stringify(partialNativeThenAbResult.parsed.dataTypes) !== JSON.stringify(['heart_rate', 'hrv']) ||
  partialNativeThenAbResult.records.length !== 2 ||
  partialNativeThenAbResult.records[0].heartRate !== 70 ||
  partialNativeThenAbResult.records[1].hrv !== 45
) {
  throw new Error(`RW history should merge partial native metrics with final AB key payloads: ${JSON.stringify({
    partialNativeThenAbSent,
    partialNativeThenAbReadOptions,
    partialNativeThenAbResult
  })}`);
}

export const rwHistoryParityPassed = true;
