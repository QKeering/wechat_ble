import { autoReconnectLegacyRing, connectLegacyRing, refreshLegacyBusinessMetrics, syncLegacyHistory, unbindLegacyRing } from './workflows';
import type { LegacyRingAdapter } from './adapter';
import { RING_PARSED_EMITTED, type RingParsedData } from '../types';

const received: RingParsedData[] = [];
const rwHistoryReads: unknown[] = [];
const rwRefreshCommandLog: string[] = [];

const makeParsedWaiter = (timeoutMs = 20) => {
  return new Promise<RingParsedData>((_, reject) => {
    setTimeout(() => reject(new Error('RW parsed data wait timeout.')), timeoutMs + 200);
  });
};

const markAdapterEmitted = <T extends RingParsedData>(parsed: T): T => {
  Object.defineProperty(parsed, RING_PARSED_EMITTED, {
    value: true,
    enumerable: false,
    configurable: true
  });
  return parsed;
};

const getRwCommandMarker = (bytes: Uint8Array) =>
  `${Number(bytes[2] || 0).toString(16).padStart(2, '0')}${Number(bytes[3] || 0).toString(16).padStart(2, '0')}`;

const isRwHistoryProbeCommand = (bytes: Uint8Array) => {
  const marker = getRwCommandMarker(bytes);
  return marker === '3600' || marker === '3601';
};

const isRwHistoryUploadCommand = (bytes: Uint8Array) => getRwCommandMarker(bytes) === '361a';

const rwHistorySyncEvents: RingParsedData[] = [];
const rwHistoryUploads: Array<Record<string, any>[]> = [];
const rwHistoryWaitMatchedTypes: string[] = [];
let rwDeleteAfterUploadCalled = false;
let rwHistoryProbeRequestCount = 0;
let rwUploadRequestCount = 0;
const rwHistorySyncAdapter = {
  protocol: 'rw',
  readLocalData: async () => undefined,
  sendBytes: async (bytes: Uint8Array) => {
    if (isRwHistoryProbeCommand(bytes)) rwHistoryProbeRequestCount += 1;
    if (isRwHistoryUploadCommand(bytes)) rwUploadRequestCount += 1;
  },
  sendDeleteAllLocalDataCommand: async () => {
    rwDeleteAfterUploadCalled = true;
    rwHistorySyncEvents.push(
      markAdapterEmitted({
        type: 'delete_all_local_data',
        protocol: 'rw',
        status: 'success',
        success: true,
        deviceId: 'rw-history-device',
        mac: '3E:00:00:00:05:1B',
        advertis: {
          macInfo: '3E:00:00:00:05:1B'
        }
      } as RingParsedData)
    );
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    const candidates: RingParsedData[] = [
      {
        type: 'rw_file_list',
        protocol: 'rw',
        files: [
          {
            total: 1,
            seq: 7,
            fileSize: 32,
            fileName: 'u1_20260101010101_hr.txt',
            userId: 'u1',
            timestampText: '20260101010101',
            fileType: 'hr'
          }
        ],
        raw: []
      } as RingParsedData,
      {
        type: 'rw_upload_file',
        protocol: 'rw',
        seq: 7,
        status: 'completed',
        records: [{ timestamp: 1767229261, heartRate: 73 }],
        raw: []
      } as RingParsedData,
      {
        type: 'delete_all_local_data',
        protocol: 'rw',
        status: 'success',
        success: true,
        statusCode: 1,
        deviceId: 'rw-history-device',
        mac: '3E:00:00:00:05:1B',
        advertis: {
          macInfo: '3E:00:00:00:05:1B'
        },
        raw: []
      } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    if (parsed) {
      rwHistoryWaitMatchedTypes.push(parsed.type);
      return parsed;
    }
    throw new Error('Unexpected RW sync history wait predicate.');
  }
} as unknown as LegacyRingAdapter;

const rwHistorySyncResult = await syncLegacyHistory(
  rwHistorySyncAdapter,
  {
    getDeviceInfo: () => ({
      deviceId: 'rw-history-device',
      uniMacId: 'ios-random-history-id',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      advertis: {
        macInfo: '3E:00:00:00:05:1B'
      }
    }),
    onParsedData: (parsed) => {
      rwHistorySyncEvents.push(parsed);
    },
    onUploadingStatusChange: () => undefined,
    uploadHistoricalRecords: async (records) => {
      rwHistoryUploads.push(records);
    }
  },
  {
    readAll: true,
    deleteAfterUpload: true,
    timeoutMs: 1000
  }
);

const rwHistoryDeleteEvent = rwHistorySyncEvents.find((item) => item.type === 'delete_all_local_data');

if (
  rwHistorySyncResult.status !== 'success' ||
  !rwHistorySyncResult.uploaded ||
  !rwHistorySyncResult.deleted ||
  !rwDeleteAfterUploadCalled ||
  rwHistoryProbeRequestCount !== 1 ||
  rwUploadRequestCount !== 1 ||
  !rwHistoryWaitMatchedTypes.includes('delete_all_local_data') ||
  rwHistoryUploads[0]?.[0]?.heartRate !== 73 ||
  rwHistoryUploads[0]?.[0]?.deviceId !== 'rw-history-device' ||
  rwHistoryUploads[0]?.[0]?.uniMacId !== '3E:00:00:00:05:1B' ||
  rwHistoryUploads[0]?.[0]?.mac !== '3E:00:00:00:05:1B' ||
  rwHistoryUploads[0]?.[0]?.advertis?.macInfo !== '3E:00:00:00:05:1B' ||
  rwHistorySyncResult.parsed.deviceId !== 'rw-history-device' ||
  rwHistorySyncResult.parsed.uniMacId !== '3E:00:00:00:05:1B' ||
  rwHistorySyncResult.parsed.mac !== '3E:00:00:00:05:1B' ||
  rwHistoryDeleteEvent?.deviceId !== 'rw-history-device' ||
  rwHistoryDeleteEvent?.mac !== '3E:00:00:00:05:1B' ||
  rwHistoryDeleteEvent?.advertis?.macInfo !== '3E:00:00:00:05:1B' ||
  rwHistorySyncEvents.some((item) => item.type === 'rw_format_file_system') ||
  !rwHistorySyncEvents.some((item) => item.type === 'local_data') ||
  !rwHistoryDeleteEvent
) {
  throw new Error(
    `RW syncHistory should upload records then clear local files when deleteAfterUpload is enabled: ${JSON.stringify({
      rwHistorySyncResult,
      rwDeleteAfterUploadCalled,
      rwHistoryProbeRequestCount,
      rwUploadRequestCount,
      rwHistoryWaitMatchedTypes,
      rwHistoryUploads,
      rwHistorySyncEvents
    })}`
  );
}

const rwAdvertisOnlyHistoryUploads: Array<Record<string, any>[]> = [];
const rwAdvertisOnlyHistoryEvents: RingParsedData[] = [];
const rwAdvertisOnlyHistoryAdapter = {
  protocol: 'rw',
  readLocalData: async () => undefined,
  sendBytes: async () => undefined,
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    const candidates: RingParsedData[] = [
      {
        type: 'rw_file_list',
        protocol: 'rw',
        files: [
          {
            total: 1,
            seq: 9,
            fileSize: 32,
            fileName: 'u1_20260101010101_hr.txt',
            userId: 'u1',
            timestampText: '20260101010101',
            fileType: 'hr'
          }
        ],
        raw: []
      } as RingParsedData,
      {
        type: 'rw_upload_file',
        protocol: 'rw',
        seq: 9,
        status: 'completed',
        records: [{ timestamp: 1767229261, heartRate: 76 }],
        raw: []
      } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    if (parsed) return parsed;
    throw new Error('Unexpected RW advertis-only history wait predicate.');
  }
} as unknown as LegacyRingAdapter;

const rwAdvertisOnlyHistoryResult = await syncLegacyHistory(
  rwAdvertisOnlyHistoryAdapter,
  {
    getDeviceInfo: () => ({
      deviceId: 'ios-random-history-device',
      uniMacId: 'ios-random-history-id',
      protocol: 'rw',
      advertis: {
        macInfo: '3E:00:00:00:05:1B'
      }
    }),
    onParsedData: (parsed) => {
      rwAdvertisOnlyHistoryEvents.push(parsed);
    },
    onUploadingStatusChange: () => undefined,
    uploadHistoricalRecords: async (records) => {
      rwAdvertisOnlyHistoryUploads.push(records);
    }
  },
  {
    readAll: true,
    timeoutMs: 1000
  }
);

if (
  rwAdvertisOnlyHistoryResult.status !== 'success' ||
  rwAdvertisOnlyHistoryUploads[0]?.[0]?.deviceId !== 'ios-random-history-device' ||
  rwAdvertisOnlyHistoryUploads[0]?.[0]?.uniMacId !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyHistoryUploads[0]?.[0]?.mac !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyHistoryUploads[0]?.[0]?.advertis?.macInfo !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyHistoryResult.parsed.uniMacId !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyHistoryResult.parsed.mac !== '3E:00:00:00:05:1B' ||
  rwAdvertisOnlyHistoryEvents[0]?.type !== 'local_data' ||
  rwAdvertisOnlyHistoryEvents[0]?.uniMacId !== '3E:00:00:00:05:1B'
) {
  throw new Error(
    `RW syncHistory should stamp advertis MAC onto upload records when iOS platform ids are random: ${JSON.stringify({
      rwAdvertisOnlyHistoryResult,
      rwAdvertisOnlyHistoryUploads,
      rwAdvertisOnlyHistoryEvents
    })}`
  );
}

const rwTypedHistoryUploadSeqs: number[] = [];
const rwTypedHistoryUploads: Array<Record<string, any>[]> = [];
const rwTypedHistoryEvents: RingParsedData[] = [];
const rwTypedHistoryReadOptions: unknown[] = [];
const rwTypedHistoryAdapter = {
  protocol: 'rw',
  readLocalData: async (options?: unknown) => {
    rwTypedHistoryReadOptions.push(options);
  },
  sendBytes: async (bytes: Uint8Array) => {
    if (isRwHistoryUploadCommand(bytes)) rwTypedHistoryUploadSeqs.push(bytes[4]);
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    const candidates: RingParsedData[] = [
      {
        type: 'rw_file_list',
        protocol: 'rw',
        files: [
          {
            total: 1,
            seq: 7,
            fileSize: 32,
            fileName: 'u1_20260101010101_hr.txt',
            userId: 'u1',
            timestampText: '20260101010101',
            fileType: 'hr'
          },
          {
            total: 2,
            seq: 8,
            fileSize: 32,
            fileName: 'u1_20260101010202_bp.txt',
            userId: 'u1',
            timestampText: '20260101010202',
            fileType: 'bp'
          }
        ],
        raw: []
      } as RingParsedData,
      {
        type: 'rw_upload_file',
        protocol: 'rw',
        seq: 8,
        status: 'completed',
        records: [{ timestamp: 1767229322, systolic: 121, diastolic: 80 }],
        raw: []
      } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    if (parsed) return parsed;
    throw new Error('Unexpected RW typed sync history wait predicate.');
  }
} as unknown as LegacyRingAdapter;

const rwTypedHistoryResult = await syncLegacyHistory(
  rwTypedHistoryAdapter,
  {
    getDeviceInfo: () => ({
      deviceId: 'rw-history-device',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B'
    }),
    onParsedData: (parsed) => {
      rwTypedHistoryEvents.push(parsed);
    },
    onUploadingStatusChange: () => undefined,
    uploadHistoricalRecords: async (records) => {
      rwTypedHistoryUploads.push(records);
    }
  },
  {
    readAll: true,
    dataType: 'blood_pressure',
    timeoutMs: 1000
  }
);

if (
  JSON.stringify(rwTypedHistoryUploadSeqs) !== JSON.stringify([8]) ||
  rwTypedHistoryResult.records.length !== 1 ||
  rwTypedHistoryResult.records[0].dataType !== 'blood_pressure' ||
  rwTypedHistoryResult.records[0].systolic !== 121 ||
  rwTypedHistoryResult.parsed.selectedFileCount !== 1 ||
  rwTypedHistoryResult.parsed.filteredFileCount !== 1 ||
  rwTypedHistoryResult.parsed.dataType !== 'blood_pressure' ||
  rwTypedHistoryUploads[0]?.[0]?.dataType !== 'blood_pressure' ||
  !rwTypedHistoryEvents.some((item) => item.type === 'local_data' && item.dataType === 'blood_pressure')
) {
  throw new Error(
    `RW syncHistory should preserve App SDK type filters through the full upload flow: ${JSON.stringify({
      rwTypedHistoryReadOptions,
      rwTypedHistoryUploadSeqs,
      rwTypedHistoryResult,
      rwTypedHistoryUploads,
      rwTypedHistoryEvents
    })}`
  );
}

const rwFilteredHistoryEvents: RingParsedData[] = [];
const rwFilteredHistoryUploads: Array<Record<string, any>[]> = [];
let rwFilteredDeleteAfterUploadCalled = false;
let rwFilteredHistoryProbeRequestCount = 0;
let rwFilteredUploadRequestCount = 0;
const rwFilteredHistoryAdapter = {
  protocol: 'rw',
  readLocalData: async () => undefined,
  sendBytes: async (bytes: Uint8Array) => {
    if (isRwHistoryProbeCommand(bytes)) rwFilteredHistoryProbeRequestCount += 1;
    if (isRwHistoryUploadCommand(bytes)) rwFilteredUploadRequestCount += 1;
  },
  sendDeleteAllLocalDataCommand: async () => {
    rwFilteredDeleteAfterUploadCalled = true;
  },
  waitForParsedData: async (predicate: (parsed: RingParsedData) => boolean) => {
    const parsed = {
      type: 'rw_file_list',
      protocol: 'rw',
      files: [
        {
          total: 1,
          seq: 7,
          fileSize: 32,
          fileName: 'u1_20260101010101_hr.txt',
          userId: 'u1',
          timestampText: '20260101010101',
          fileType: 'hr'
        }
      ],
      raw: []
    } as RingParsedData;
    if (predicate(parsed)) return parsed;
    throw new Error('Unexpected RW filtered sync history wait predicate.');
  }
} as unknown as LegacyRingAdapter;

const rwFilteredHistoryResult = await syncLegacyHistory(
  rwFilteredHistoryAdapter,
  {
    getDeviceInfo: () => ({
      deviceId: 'rw-history-device',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B'
    }),
    onParsedData: (parsed) => {
      rwFilteredHistoryEvents.push(parsed);
    },
    onUploadingStatusChange: () => undefined,
    uploadHistoricalRecords: async (records) => {
      rwFilteredHistoryUploads.push(records);
    }
  },
  {
    readAll: false,
    sinceTimestamp: 1767229322,
    deleteAfterUpload: true,
    timeoutMs: 1000
  }
);

if (
  rwFilteredHistoryResult.status !== 'filtered' ||
  rwFilteredHistoryResult.uploaded ||
  rwFilteredHistoryResult.deleted ||
  rwFilteredHistoryProbeRequestCount !== 1 ||
  rwFilteredUploadRequestCount !== 0 ||
  rwFilteredDeleteAfterUploadCalled ||
  rwFilteredHistoryUploads.length !== 0 ||
  rwFilteredHistoryResult.records.length !== 0 ||
  rwFilteredHistoryResult.parsed.totalFileCount !== 1 ||
  rwFilteredHistoryResult.parsed.selectedFileCount !== 0 ||
  rwFilteredHistoryResult.parsed.filteredFileCount !== 1 ||
  !rwFilteredHistoryEvents.some((item) => item.type === 'local_data' && item.status === 'filtered')
) {
  throw new Error(
    `RW syncHistory should return a visible filtered terminal state without upload/delete when files are outside the selected range: ${JSON.stringify({
      rwFilteredHistoryResult,
      rwFilteredHistoryProbeRequestCount,
      rwFilteredUploadRequestCount,
      rwFilteredDeleteAfterUploadCalled,
      rwFilteredHistoryUploads,
      rwFilteredHistoryEvents
    })}`
  );
}

const rwHistoryFailureEvents: RingParsedData[] = [];
const rwHistoryFailureUploadStatuses: string[] = [];
const rwHistoryFailureAdapter = {
  protocol: 'rw',
  sendBytes: async () => undefined,
  readLocalData: async () => undefined,
  waitForParsedData: async () => {
    throw new Error('file-list failed');
  }
} as unknown as LegacyRingAdapter;

let rwHistoryFailureError: unknown;
try {
  await syncLegacyHistory(
    rwHistoryFailureAdapter,
    {
      getDeviceInfo: () => ({
        deviceId: 'rw-history-device',
        protocol: 'rw',
        mac: '3E:00:00:00:05:1B'
      }),
      onParsedData: (parsed) => {
        rwHistoryFailureEvents.push(parsed);
      },
      onUploadingStatusChange: (status) => {
        rwHistoryFailureUploadStatuses.push(status);
      }
    },
    {
      timeoutMs: 20
    }
  );
} catch (error) {
  rwHistoryFailureError = error;
}

if (
  !(rwHistoryFailureError instanceof Error) ||
  !rwHistoryFailureError.message.includes('RW history response timeout after 20ms') ||
  !rwHistoryFailureError.message.includes('cause=file-list failed') ||
  rwHistoryFailureUploadStatuses.join(',') !== 'uploading,failed' ||
  rwHistoryFailureEvents[0]?.type !== 'rw_history_pending' ||
  rwHistoryFailureEvents[0]?.message !== 'RW 历史同步失败，请重试' ||
  !`${rwHistoryFailureEvents[0]?.error || ''}`.includes('RW history response timeout after 20ms') ||
  !`${rwHistoryFailureEvents[0]?.error || ''}`.includes('cause=file-list failed') ||
  rwHistoryFailureEvents[0]?.deviceId !== 'rw-history-device' ||
  rwHistoryFailureEvents[0]?.mac !== '3E:00:00:00:05:1B'
) {
  throw new Error(
    `RW failed syncHistory should fail like L19 while keeping current device identity in the pending diagnostic event: ${JSON.stringify({
      rwHistoryFailureError,
      rwHistoryFailureUploadStatuses,
      rwHistoryFailureEvents
    })}`
  );
}

const rwAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => {
    rwRefreshCommandLog.push('battery');
  },
  sendFirmwareVersion: async () => {
    rwRefreshCommandLog.push('firmware');
  },
  sendSoftwareVersion: async () => {
    rwRefreshCommandLog.push('software');
  },
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async (options?: unknown) => {
    rwHistoryReads.push(options);
  },
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  sendBodyTemperatureCommand: async () => {
    rwRefreshCommandLog.push('temperature');
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      {
        type: 'battery',
        value: 57,
        protocol: 'rw'
      } as RingParsedData,
      {
        type: 'firmware_version',
        firmwareVersion: '2.2.9',
        softwareVersion: '303e0001',
        protocol: 'rw'
      } as RingParsedData,
      {
        type: 'rw_health_monitoring',
        name: 'heart_rate',
        enabled: true,
        interval: 30,
        protocol: 'rw'
      } as RingParsedData,
      {
        type: 'rw_health_data',
        name: 'heart_rate',
        value: 68,
        data: [68],
        protocol: 'rw'
      } as RingParsedData,
      {
        type: 'rw_file_list',
        protocol: 'rw',
        files: [],
        raw: []
      } as RingParsedData
    ];

    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const startTime = Date.now();
const result = await refreshLegacyBusinessMetrics(
  rwAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => received.push(parsed)
  },
  {
    timeoutMs: 20
  }
);
const elapsedMs = Date.now() - startTime;
await new Promise((resolve) => setTimeout(resolve, 80));

if (elapsedMs > 1500) {
  throw new Error(`RW refresh should not block the business page for slow health data: ${elapsedMs}ms`);
}

if (result.status !== 'success' || !result.ok.includes('heart_rate')) {
  throw new Error(`RW refresh should settle when core metrics succeed and optional realtime metrics are pending: ${JSON.stringify(result)}`);
}

for (const step of ['battery', 'firmware', 'software']) {
  if (!result.ok.includes(step)) {
    throw new Error(`RW refresh should report ${step} as a completed L19-compatible core step: ${JSON.stringify(result)}`);
  }
}

for (const command of ['battery', 'firmware', 'temperature']) {
  if (!rwRefreshCommandLog.includes(command)) {
    throw new Error(`RW refresh should trigger ${command} command like L19: ${JSON.stringify({ result, rwRefreshCommandLog })}`);
  }
}

if (rwRefreshCommandLog.includes('software')) {
  throw new Error(`RW refresh should reuse the combined firmware response instead of probing software again: ${JSON.stringify(rwRefreshCommandLog)}`);
}

if (result.failed.some((item) => item.step === 'blood_oxygen')) {
  throw new Error(`RW refresh should not fail when optional blood oxygen realtime data is pending: ${JSON.stringify(result)}`);
}

if (!result.ok.includes('blood_oxygen_pending')) {
  throw new Error(`RW refresh should mark missing optional blood oxygen as pending success state: ${JSON.stringify(result)}`);
}

if (!received.some((item) => item.type === 'rw_health_data_pending' && item.name === 'blood_oxygen')) {
  throw new Error(`RW refresh should emit blood oxygen pending data: ${JSON.stringify(received)}`);
}

const zeroMetricRefreshReceived: RingParsedData[] = [];
const zeroMetricRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  sendSoftwareVersion: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  sendBodyTemperatureCommand: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 57, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 0, data: [0], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 0, data: [0], protocol: 'rw' } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const zeroMetricRefreshResult = await refreshLegacyBusinessMetrics(
  zeroMetricRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-zero-metric-device', protocol: 'rw' }),
    onParsedData: (parsed) => zeroMetricRefreshReceived.push(parsed)
  },
  {
    timeoutMs: 20,
    includeCollectPeriod: false
  }
);

if (
  zeroMetricRefreshResult.ok.includes('heart_rate') ||
  zeroMetricRefreshResult.ok.includes('blood_oxygen') ||
  !zeroMetricRefreshResult.ok.includes('heart_rate_pending') ||
  !zeroMetricRefreshResult.ok.includes('blood_oxygen_pending')
) {
  throw new Error(
    `RW refresh should not treat zero realtime values as completed L19 heart-rate/blood-oxygen data: ${JSON.stringify({
      zeroMetricRefreshResult,
      zeroMetricRefreshReceived
    })}`
  );
}

const rwDirectTemperatureRefreshCommands: string[] = [];
const rwDirectTemperatureRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  sendSoftwareVersion: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  sendBodyTemperatureCommand: async () => {
    rwDirectTemperatureRefreshCommands.push('temperature');
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 57, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'temperature', value: 36.8, data: [96, 1], protocol: 'rw' } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwDirectTemperatureRefreshResult = await refreshLegacyBusinessMetrics(
  rwDirectTemperatureRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' })
  },
  {
    timeoutMs: 20,
    includeDeviceTime: false,
    includeCollectPeriod: false
  }
);

if (
  !rwDirectTemperatureRefreshCommands.includes('temperature') ||
  !rwDirectTemperatureRefreshResult.ok.includes('temperature') ||
  rwDirectTemperatureRefreshResult.ok.includes('temperature_pending') ||
  rwDirectTemperatureRefreshResult.failed.some((item) => item.step === 'temperature')
) {
  throw new Error(
    `RW refresh should accept direct rw_health_data temperature packets as the L19 temperature step: ${JSON.stringify({
      rwDirectTemperatureRefreshResult,
      rwDirectTemperatureRefreshCommands
    })}`
  );
}

const rwSkinTemperatureRefreshCommands: string[] = [];
const rwSkinTemperatureRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  sendSoftwareVersion: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  sendBodyTemperatureCommand: async () => {
    rwSkinTemperatureRefreshCommands.push('temperature');
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'active_measure', hr: 68, protocol: 'rw' } as RingParsedData,
      { type: 'active_OxyGenMeasure', oxygen: 98, protocol: 'rw' } as RingParsedData,
      { type: 'active_Temperature', skinTemperature: '36.6 C', protocol: 'rw' } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwSkinTemperatureRefreshResult = await refreshLegacyBusinessMetrics(
  rwSkinTemperatureRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' })
  },
  {
    timeoutMs: 20,
    includeDeviceInfo: false,
    includeDeviceTime: false,
    includeCollectPeriod: false
  }
);

if (
  !rwSkinTemperatureRefreshCommands.includes('temperature') ||
  !rwSkinTemperatureRefreshResult.ok.includes('heart_rate') ||
  !rwSkinTemperatureRefreshResult.ok.includes('blood_oxygen') ||
  !rwSkinTemperatureRefreshResult.ok.includes('temperature') ||
  rwSkinTemperatureRefreshResult.ok.includes('heart_rate_pending') ||
  rwSkinTemperatureRefreshResult.ok.includes('blood_oxygen_pending') ||
  rwSkinTemperatureRefreshResult.ok.includes('temperature_pending') ||
  rwSkinTemperatureRefreshResult.failed.some((item) => item.step === 'heart_rate') ||
  rwSkinTemperatureRefreshResult.failed.some((item) => item.step === 'blood_oxygen') ||
  rwSkinTemperatureRefreshResult.failed.some((item) => item.step === 'temperature')
) {
  throw new Error(
    `RW refresh should accept L19-compatible realtime aliases for heart rate, blood oxygen, and skin temperature: ${JSON.stringify({
      rwSkinTemperatureRefreshResult,
      rwSkinTemperatureRefreshCommands
    })}`
  );
}

if (!result.ok.includes('history_snapshot_pending') || rwHistoryReads.length !== 1) {
  throw new Error(`RW refresh should trigger a non-blocking history snapshot: ${JSON.stringify({ result, rwHistoryReads })}`);
}

rwHistoryReads.length = 0;
const lightHistoryResult = await refreshLegacyBusinessMetrics(
  rwAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' })
  },
  {
    timeoutMs: 20,
    includeDeviceInfo: false,
    includeDeviceTime: false,
    includeCollectPeriod: false,
    includeRealtimeMetrics: false,
    includeHistorySnapshot: false
  }
);

if (!lightHistoryResult.ok.includes('history_snapshot_skipped') || rwHistoryReads.length !== 0) {
  throw new Error(`RW light refresh should skip history snapshot reads: ${JSON.stringify({ lightHistoryResult, rwHistoryReads })}`);
}

const rwTargetedMetricCommands: string[] = [];
const rwTargetedMetricAdapter = {
  protocol: 'rw',
  sendActiveMeasureCommand: async () => rwTargetedMetricCommands.push('heart_rate'),
  sendOxyGenCommand: async () => rwTargetedMetricCommands.push('blood_oxygen'),
  sendBodyTemperatureCommand: async () => rwTargetedMetricCommands.push('temperature'),
  controlRwHealthData: async (name: string) => rwTargetedMetricCommands.push(`control:${name}`),
  readRwHealthData: async (name: string) => rwTargetedMetricCommands.push(`read:${name}`),
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const heartRate = {
      type: 'rw_health_data',
      name: 'heart_rate',
      value: 72,
      protocol: 'rw'
    } as RingParsedData;
    return predicate(heartRate) ? Promise.resolve(heartRate) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwTargetedMetricResult = await refreshLegacyBusinessMetrics(
  rwTargetedMetricAdapter,
  { getDeviceInfo: () => ({ deviceId: 'rw-targeted-device', protocol: 'rw' }) },
  {
    timeoutMs: 20,
    includeDeviceInfo: false,
    includeDeviceTime: false,
    includeCollectPeriod: false,
    includeHistorySnapshot: false,
    realtimeMetricNames: ['heart_rate']
  }
);
await new Promise((resolve) => setTimeout(resolve, 180));

if (
  !rwTargetedMetricResult.ok.includes('heart_rate') ||
  !rwTargetedMetricResult.ok.includes('blood_oxygen_skipped') ||
  rwTargetedMetricCommands.some((command) => /blood_oxygen|temperature|blood_sugar|hrv|stress|blood_pressure/.test(command))
) {
  throw new Error(
    `RW targeted refresh should only issue the requested realtime metric commands: ${JSON.stringify({
      rwTargetedMetricResult,
      rwTargetedMetricCommands
    })}`
  );
}

if (!received.some((item) => item.type === 'rw_file_list')) {
  throw new Error(`RW refresh should forward background history file-list status: ${JSON.stringify(received)}`);
}

const rwHistoryPendingMessage = received.find((item) => item.type === 'rw_history_pending' && item.status === 'requested')?.message;
const rwRealtimePendingMessages = received
  .filter((item) => item.type === 'rw_health_data_pending' && ['temperature', 'blood_sugar', 'hrv', 'stress', 'blood_pressure'].includes(`${item.name}`))
  .map((item) => `${item.message || ''}`);

if (
  !`${rwHistoryPendingMessage || ''}`.includes('\u5386\u53f2\u5feb\u7167') ||
  !rwRealtimePendingMessages.some((message) => message.includes('\u5f53\u524dRW\u8bbe\u5907\u672a\u8fd4\u56de\u5b9e\u65f6\u4f53\u6e29')) ||
  rwRealtimePendingMessages.some((message) => message.includes('getRwMetricLabel'))
) {
  throw new Error(
    `RW refresh should emit readable pending messages for old pages: ${JSON.stringify({
      rwHistoryPendingMessage,
      rwRealtimePendingMessages,
      received
    })}`
  );
}

const rwBatteryFallbackRefreshReceived: RingParsedData[] = [];
const rwBatteryFallbackRefreshCommands: string[] = [];
const rwBatteryFallbackWaiters: Array<{
  predicate: (parsed: RingParsedData) => boolean;
  resolve: (parsed: RingParsedData) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];
const emitRwBatteryFallbackRefreshParsed = (parsed: RingParsedData) => {
  rwBatteryFallbackRefreshReceived.push(parsed);
  for (let index = rwBatteryFallbackWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = rwBatteryFallbackWaiters[index];
    if (!waiter.predicate(parsed)) continue;
    clearTimeout(waiter.timer);
    rwBatteryFallbackWaiters.splice(index, 1);
    waiter.resolve(parsed);
  }
};
const rwBatteryFallbackRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => {
    rwBatteryFallbackRefreshCommands.push('battery');
    await new Promise((resolve) => setTimeout(resolve, 0));
    emitRwBatteryFallbackRefreshParsed({
      type: 'battery',
      protocol: 'rw',
      battery: 78,
      value: '78%',
      raw: [0xc6, 0x11, 0x00, 0x05, 0xaa, 0xaa, 0x02, 0x03, 0x10, 0x4e, 0x00]
    } as RingParsedData);
  },
  sendFirmwareVersion: async () => {
    rwBatteryFallbackRefreshCommands.push('firmware');
    emitRwBatteryFallbackRefreshParsed({
      type: 'firmware_version',
      protocol: 'rw',
      firmwareVersion: '2.2.9',
      softwareVersion: '303e0001'
    } as RingParsedData);
  },
  sendSoftwareVersion: async () => {
    rwBatteryFallbackRefreshCommands.push('software');
    emitRwBatteryFallbackRefreshParsed({
      type: 'firmware_version',
      protocol: 'rw',
      firmwareVersion: '2.2.9',
      softwareVersion: '303e0001'
    } as RingParsedData);
  },
  readLocalData: async () => {
    emitRwBatteryFallbackRefreshParsed({
      type: 'rw_file_list',
      protocol: 'rw',
      files: [],
      raw: []
    } as RingParsedData);
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs = 20) => {
    const existing = rwBatteryFallbackRefreshReceived.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise<RingParsedData>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = rwBatteryFallbackWaiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) rwBatteryFallbackWaiters.splice(index, 1);
        reject(new Error('RW parsed data wait timeout.'));
      }, timeoutMs + 200);
      rwBatteryFallbackWaiters.push({ predicate, resolve, reject, timer });
    });
  }
} as unknown as LegacyRingAdapter;

const rwBatteryFallbackRefreshResult = await refreshLegacyBusinessMetrics(
  rwBatteryFallbackRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwBatteryFallbackRefreshReceived.push(parsed)
  },
  {
    timeoutMs: 20,
    includeDeviceTime: false,
    includeCollectPeriod: false,
    includeRealtimeMetrics: false
  }
);

if (
  rwBatteryFallbackRefreshResult.ok.includes('battery_pending') ||
  !rwBatteryFallbackRefreshResult.ok.includes('battery') ||
  !rwBatteryFallbackRefreshResult.ok.includes('firmware') ||
  !rwBatteryFallbackRefreshResult.ok.includes('software') ||
  rwBatteryFallbackRefreshResult.failed.some((item) => item.step === 'battery') ||
  rwBatteryFallbackRefreshCommands.join(',') !== 'battery,firmware' ||
  !rwBatteryFallbackRefreshReceived.some(
    (item) => item.type === 'battery' && item.protocol === 'rw' && item.battery === 78 && item.raw?.[0] === 0xc6
  )
) {
  throw new Error(
    `RW refresh should treat SY03/C6 battery fallback responses as the L19 battery core step: ${JSON.stringify({
      rwBatteryFallbackRefreshResult,
      rwBatteryFallbackRefreshCommands,
      rwBatteryFallbackRefreshReceived
    })}`
  );
}

const rwVersionAliasOnlyRefreshReceived: RingParsedData[] = [];
const rwVersionAliasOnlyRefreshCommands: string[] = [];
const rwVersionAliasOnlyRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => {
    rwVersionAliasOnlyRefreshCommands.push('battery');
  },
  sendFirmwareVersion: async () => {
    rwVersionAliasOnlyRefreshCommands.push('firmware');
  },
  sendSoftwareVersion: async () => {
    rwVersionAliasOnlyRefreshCommands.push('software');
  },
  readLocalData: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 80, battery: 80, protocol: 'rw' } as RingParsedData,
      { type: 'hardwareVersion', value: '0.3.3', protocol: 'rw' } as RingParsedData,
      { type: 'softwareVersion', value: '0B060503', protocol: 'rw' } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwVersionAliasOnlyRefreshResult = await refreshLegacyBusinessMetrics(
  rwVersionAliasOnlyRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwVersionAliasOnlyRefreshReceived.push(parsed)
  },
  {
    timeoutMs: 20,
    includeDeviceTime: false,
    includeCollectPeriod: false,
    includeRealtimeMetrics: false
  }
);

if (
  rwVersionAliasOnlyRefreshResult.ok.includes('firmware_pending') ||
  rwVersionAliasOnlyRefreshResult.ok.includes('software_pending') ||
  !rwVersionAliasOnlyRefreshResult.ok.includes('firmware') ||
  !rwVersionAliasOnlyRefreshResult.ok.includes('software') ||
  rwVersionAliasOnlyRefreshResult.failed.some((item) => item.step === 'firmware' || item.step === 'software') ||
  rwVersionAliasOnlyRefreshCommands.join(',') !== 'battery,firmware' ||
  !rwVersionAliasOnlyRefreshReceived.some((item) => item.type === 'hardwareVersion' && item.value === '0.3.3') ||
  !rwVersionAliasOnlyRefreshReceived.some((item) => item.type === 'softwareVersion' && item.value === '0B060503')
) {
  throw new Error(
    `RW refresh should treat L19-compatible version alias events as completed core firmware/software steps: ${JSON.stringify({
      rwVersionAliasOnlyRefreshResult,
      rwVersionAliasOnlyRefreshCommands,
      rwVersionAliasOnlyRefreshReceived
    })}`
  );
}

const rwSpo2RefreshReceived: RingParsedData[] = [];
const rwSpo2RefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  sendBodyTemperatureCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'spo2', value: 97, data: [97], protocol: 'rw' } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];

    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwSpo2RefreshResult = await refreshLegacyBusinessMetrics(
  rwSpo2RefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwSpo2RefreshReceived.push(parsed)
  },
  {
    timeoutMs: 20,
    includeDeviceInfo: false,
    includeCollectPeriod: false
  }
);

if (
  !rwSpo2RefreshResult.ok.includes('blood_oxygen') ||
  rwSpo2RefreshResult.ok.includes('blood_oxygen_pending') ||
  rwSpo2RefreshResult.failed.some((item) => item.step === 'blood_oxygen')
) {
  throw new Error(
    `RW refresh should treat spo2 health-data packets as the L19 blood_oxygen step: ${JSON.stringify({
      rwSpo2RefreshResult,
      rwSpo2RefreshReceived
    })}`
  );
}

const rwSlowRealtimeRefreshReceived: RingParsedData[] = [];
const rwSlowRealtimeRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  sendBodyTemperatureCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const fileList = { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData;
    if (predicate(fileList)) return Promise.resolve(fileList);

    const heartRate = { type: 'rw_health_data', name: 'heart_rate', value: 73, data: [73], protocol: 'rw' } as RingParsedData;
    if (predicate(heartRate)) {
      return new Promise<RingParsedData>((resolve, reject) => {
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        const timer = setTimeout(() => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(heartRate);
        }, 1100);
        if ((timeoutMs ?? 0) > 0) {
          timeoutTimer = setTimeout(() => {
            clearTimeout(timer);
            reject(new Error('slow heart rate timeout'));
          }, timeoutMs);
        }
      });
    }

    const bloodOxygen = { type: 'rw_health_data', name: 'blood_oxygen', value: 97, data: [97], protocol: 'rw' } as RingParsedData;
    if (predicate(bloodOxygen)) {
      return new Promise<RingParsedData>((resolve, reject) => {
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        const timer = setTimeout(() => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(bloodOxygen);
        }, 1200);
        if ((timeoutMs ?? 0) > 0) {
          timeoutTimer = setTimeout(() => {
            clearTimeout(timer);
            reject(new Error('slow blood oxygen timeout'));
          }, timeoutMs);
        }
      });
    }

    return makeParsedWaiter(20);
  }
} as unknown as LegacyRingAdapter;

const rwSlowRealtimeRefreshResult = await refreshLegacyBusinessMetrics(
  rwSlowRealtimeRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-slow-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwSlowRealtimeRefreshReceived.push(parsed)
  },
  {
    timeoutMs: 12000,
    includeDeviceInfo: false,
    includeCollectPeriod: false
  }
);

if (
  !rwSlowRealtimeRefreshResult.ok.includes('heart_rate') ||
  !rwSlowRealtimeRefreshResult.ok.includes('blood_oxygen') ||
  rwSlowRealtimeRefreshResult.ok.includes('heart_rate_pending') ||
  rwSlowRealtimeRefreshResult.ok.includes('blood_oxygen_pending')
) {
  throw new Error(
    `RW refresh should wait long enough for SY03 realtime packets that arrive after the old 1s window: ${JSON.stringify({
      rwSlowRealtimeRefreshResult,
      rwSlowRealtimeRefreshReceived
    })}`
  );
}

const rwLegacyRealtimeAliasRefreshReceived: RingParsedData[] = [];
const rwLegacyRealtimeAliasRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'active_measure', protocol: 'rw', heartRate: 72, heartbeatStatus: 1 } as RingParsedData,
      { type: 'active_OxyGenMeasure', protocol: 'rw', bloodOxygen: 98, bloodOxygenStatus: 1 } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];

    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwLegacyRealtimeAliasRefreshResult = await refreshLegacyBusinessMetrics(
  rwLegacyRealtimeAliasRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwLegacyRealtimeAliasRefreshReceived.push(parsed)
  },
  {
    timeoutMs: 20,
    includeDeviceInfo: false,
    includeCollectPeriod: false
  }
);

if (
  !rwLegacyRealtimeAliasRefreshResult.ok.includes('heart_rate') ||
  !rwLegacyRealtimeAliasRefreshResult.ok.includes('blood_oxygen') ||
  rwLegacyRealtimeAliasRefreshResult.ok.includes('heart_rate_pending') ||
  rwLegacyRealtimeAliasRefreshResult.ok.includes('blood_oxygen_pending') ||
  !rwLegacyRealtimeAliasRefreshReceived.some((item) => item.type === 'active_measure' && item.heartRate === 72) ||
  !rwLegacyRealtimeAliasRefreshReceived.some((item) => item.type === 'active_OxyGenMeasure' && item.bloodOxygen === 98)
) {
  throw new Error(
    `RW refresh should treat L19-compatible realtime alias events as completed heart-rate/blood-oxygen steps: ${JSON.stringify({
      rwLegacyRealtimeAliasRefreshResult,
      rwLegacyRealtimeAliasRefreshReceived
    })}`
  );
}

const rwLightRefreshCommands: string[] = [];
const rwLightRefreshAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => {
    rwLightRefreshCommands.push('battery');
  },
  sendFirmwareVersion: async () => {
    rwLightRefreshCommands.push('firmware');
  },
  sendSoftwareVersion: async () => {
    rwLightRefreshCommands.push('software');
  },
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => {
    rwLightRefreshCommands.push('heart_rate');
  },
  sendOxyGenCommand: async () => {
    rwLightRefreshCommands.push('blood_oxygen');
  },
  sendBodyTemperatureCommand: async () => {
    rwLightRefreshCommands.push('temperature');
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'rw_health_data', name: 'heart_rate', value: 71, data: [71], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 96, data: [96], protocol: 'rw' } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];

    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwLightRefreshResult = await refreshLegacyBusinessMetrics(
  rwLightRefreshAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' })
  },
  {
    timeoutMs: 20,
    includeDeviceInfo: false,
    includeCollectPeriod: false
  }
);

if (
  rwLightRefreshCommands.some((command) => command === 'battery' || command === 'firmware' || command === 'software') ||
  !rwLightRefreshCommands.includes('heart_rate') ||
  !rwLightRefreshCommands.includes('blood_oxygen') ||
  !rwLightRefreshCommands.includes('temperature') ||
  !rwLightRefreshResult.ok.includes('battery_cached') ||
  !rwLightRefreshResult.ok.includes('firmware_cached') ||
  !rwLightRefreshResult.ok.includes('software_cached')
) {
  throw new Error(
    `RW light refresh should reuse cached device info while refreshing realtime metrics: ${JSON.stringify({
      rwLightRefreshCommands,
      rwLightRefreshResult
    })}`
  );
}

const rwAdditionalRealtimeReceived: RingParsedData[] = [];
const rwAdditionalRealtimeCommands: string[] = [];
const rwAdditionalRealtimeAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  sendBodyTemperatureCommand: async () => {
    rwAdditionalRealtimeCommands.push('temperature');
  },
  controlRwHealthData: async (name: string) => {
    rwAdditionalRealtimeCommands.push(`control:${name}`);
  },
  readRwHealthData: async (name: string) => {
    rwAdditionalRealtimeCommands.push(`read:${name}`);
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 57, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'temperature', value: 36.7, data: [111, 1], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_sugar', value: 5.8, data: [58], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'hrv', value: 44, data: [44], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'stress', value: 31, data: [31], protocol: 'rw' } as RingParsedData,
      {
        type: 'rw_health_data',
        name: 'blood_pressure',
        value: { systolic: 120, diastolic: 79 },
        data: [120, 79],
        protocol: 'rw'
      } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];

    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwAdditionalRealtimeResult = await refreshLegacyBusinessMetrics(
  rwAdditionalRealtimeAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwAdditionalRealtimeReceived.push(parsed)
  },
  {
    timeoutMs: 20
  }
);

for (const step of ['temperature', 'blood_sugar', 'hrv', 'stress', 'blood_pressure']) {
  if (!rwAdditionalRealtimeResult.ok.includes(step) || rwAdditionalRealtimeResult.ok.includes(`${step}_pending`)) {
    throw new Error(
      `RW refresh should mark quickly returned expanded realtime metrics as ok: ${JSON.stringify({
        step,
        rwAdditionalRealtimeResult,
        rwAdditionalRealtimeReceived
      })}`
    );
  }
}

if (
  !rwAdditionalRealtimeReceived.some((item) => item.type === 'rw_health_data' && item.name === 'temperature') ||
  !rwAdditionalRealtimeReceived.some((item) => item.type === 'rw_health_data' && item.name === 'blood_pressure')
) {
  throw new Error(`RW expanded realtime metrics should be forwarded when they arrive quickly: ${JSON.stringify(rwAdditionalRealtimeReceived)}`);
}

await new Promise((resolve) => setTimeout(resolve, 1200));

if (
  !rwAdditionalRealtimeCommands.includes('temperature') ||
  rwAdditionalRealtimeCommands.includes('control:temperature') ||
  rwAdditionalRealtimeCommands.includes('read:temperature') ||
  !rwAdditionalRealtimeCommands.includes('control:blood_sugar') ||
  !rwAdditionalRealtimeCommands.includes('read:blood_pressure')
) {
  throw new Error(
    `RW expanded realtime refresh should not duplicate the primary temperature command through additional fallbacks: ${JSON.stringify(
      rwAdditionalRealtimeCommands
    )}`
  );
}

const rwFastActiveRealtimeReceived: RingParsedData[] = [];
const rwFastActiveWaiters: Array<{
  predicate: (parsed: RingParsedData) => boolean;
  resolve: (parsed: RingParsedData) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];
const emitRwFastActiveParsed = (parsed: RingParsedData) => {
  for (let index = rwFastActiveWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = rwFastActiveWaiters[index];
    if (!waiter.predicate(parsed)) continue;
    clearTimeout(waiter.timer);
    rwFastActiveWaiters.splice(index, 1);
    waiter.resolve(parsed);
  }
};
const rwFastActiveRealtimeAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  controlRwHealthData: async () => undefined,
  readRwHealthData: async () => undefined,
  sendActiveMeasureCommand: async () => {
    emitRwFastActiveParsed({ type: 'rw_health_data', name: 'hrv', value: 46, data: [46], protocol: 'rw' } as RingParsedData);
    emitRwFastActiveParsed({ type: 'rw_health_data', name: 'stress', value: 29, data: [29], protocol: 'rw' } as RingParsedData);
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 57, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'temperature', value: 36.7, data: [111, 1], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_sugar', value: 5.8, data: [58], protocol: 'rw' } as RingParsedData,
      {
        type: 'rw_health_data',
        name: 'blood_pressure',
        value: { systolic: 120, diastolic: 79 },
        data: [120, 79],
        protocol: 'rw'
      } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    if (parsed) return Promise.resolve(parsed);

    return new Promise<RingParsedData>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RW fast active metric waiter missed packet.')), timeoutMs ?? 50);
      rwFastActiveWaiters.push({ predicate, resolve, reject, timer });
    });
  }
} as unknown as LegacyRingAdapter;

const rwFastActiveRealtimeResult = await refreshLegacyBusinessMetrics(
  rwFastActiveRealtimeAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwFastActiveRealtimeReceived.push(parsed)
  },
  {
    timeoutMs: 80
  }
);

if (
  !rwFastActiveRealtimeResult.ok.includes('hrv') ||
  !rwFastActiveRealtimeResult.ok.includes('stress') ||
  rwFastActiveRealtimeResult.ok.includes('hrv_pending') ||
  rwFastActiveRealtimeResult.ok.includes('stress_pending') ||
  !rwFastActiveRealtimeReceived.some((item) => item.type === 'rw_health_data' && item.name === 'hrv' && item.value === 46) ||
  !rwFastActiveRealtimeReceived.some((item) => item.type === 'rw_health_data' && item.name === 'stress' && item.value === 29)
) {
  throw new Error(
    `RW refresh should register expanded realtime waiters before active-measure commands can return fast packets: ${JSON.stringify({
      rwFastActiveRealtimeResult,
      rwFastActiveRealtimeReceived
    })}`
  );
}

const rwCollectPeriodReceived: RingParsedData[] = [];
const rwCollectPeriodAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 57, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_monitoring', name: 'heart_rate', enabled: true, interval: 30, protocol: 'rw' } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwCollectPeriodResult = await refreshLegacyBusinessMetrics(
  rwCollectPeriodAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwCollectPeriodReceived.push(parsed)
  },
  {
    timeoutMs: 20
  }
);

if (
  !rwCollectPeriodResult.ok.includes('collect_period') ||
  rwCollectPeriodResult.ok.includes('collect_period_pending') ||
  !rwCollectPeriodReceived.some((item) => item.type === 'rw_health_monitoring' && item.name === 'heart_rate')
) {
  throw new Error(
    `RW refresh should mark quickly returned monitoring config as collect_period like L19: ${JSON.stringify({
      rwCollectPeriodResult,
      rwCollectPeriodReceived
    })}`
  );
}

const rwDeviceTimeReceived: RingParsedData[] = [];
let rwDeviceTimeReadCount = 0;
const rwDeviceTimeAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readDeviceTime: async () => {
    rwDeviceTimeReadCount += 1;
  },
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 57, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'device_time', timestamp: 1710000000000, timezone: 8, protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' } as RingParsedData,
      { type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const rwDeviceTimeResult = await refreshLegacyBusinessMetrics(
  rwDeviceTimeAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => rwDeviceTimeReceived.push(parsed)
  },
  {
    timeoutMs: 20,
    includeDeviceTime: true
  }
);

if (
  rwDeviceTimeReadCount !== 1 ||
  !rwDeviceTimeResult.ok.includes('device_time') ||
  !rwDeviceTimeReceived.some((item) => item.type === 'device_time' && item.timestamp === 1710000000000)
) {
  throw new Error(
    `RW refresh should honor includeDeviceTime like L19: ${JSON.stringify({
      rwDeviceTimeReadCount,
      rwDeviceTimeResult,
      rwDeviceTimeReceived
    })}`
  );
}

rwDeviceTimeReadCount = 0;
const rwDeviceTimeSkippedResult = await refreshLegacyBusinessMetrics(
  rwDeviceTimeAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' })
  },
  {
    timeoutMs: 20,
    includeDeviceTime: false
  }
);

if (rwDeviceTimeReadCount !== 0 || rwDeviceTimeSkippedResult.ok.includes('device_time')) {
  throw new Error(
    `RW refresh should skip device time when includeDeviceTime is false: ${JSON.stringify({
      rwDeviceTimeReadCount,
      rwDeviceTimeSkippedResult
    })}`
  );
}

const duplicateGuardReceived: RingParsedData[] = [];
const duplicateGuardAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      markAdapterEmitted({ type: 'battery', value: 57, protocol: 'rw' } as RingParsedData),
      markAdapterEmitted({ type: 'firmware_version', firmwareVersion: '2.2.9', protocol: 'rw' } as RingParsedData),
      markAdapterEmitted({ type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData),
      markAdapterEmitted({ type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' } as RingParsedData),
      markAdapterEmitted({ type: 'rw_file_list', protocol: 'rw', files: [], raw: [] } as RingParsedData)
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

await refreshLegacyBusinessMetrics(
  duplicateGuardAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => duplicateGuardReceived.push(parsed)
  },
  {
    timeoutMs: 20
  }
);

if (
  duplicateGuardReceived.some((item) =>
    item.type === 'battery' ||
    item.type === 'firmware_version' ||
    item.type === 'rw_health_data' ||
    item.type === 'rw_file_list'
  )
) {
  throw new Error(`RW refresh should not duplicate parsed packets already emitted by the adapter: ${JSON.stringify(duplicateGuardReceived)}`);
}

const historyFailureReceived: RingParsedData[] = [];
const historyFailureAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  readLocalData: async () => {
    throw new Error('history read failed');
  },
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 61, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 69, data: [69], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 97, data: [97], protocol: 'rw' } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const historyFailureResult = await refreshLegacyBusinessMetrics(
  historyFailureAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => historyFailureReceived.push(parsed)
  },
  {
    timeoutMs: 20
  }
);

if (
  historyFailureResult.status !== 'success' ||
  !historyFailureResult.ok.includes('history_snapshot_command_pending') ||
  !historyFailureReceived.some((item) => item.type === 'rw_history_pending' && item.status === 'pending') ||
  historyFailureReceived.some((item) => item.type === 'rw_health_data_pending' && item.name === 'history_snapshot_command')
) {
  throw new Error(
    `RW history snapshot command failures should surface as history status, not health-data status: ${JSON.stringify({
      historyFailureResult,
      historyFailureReceived
    })}`
  );
}

const hangingCommandAdapter = {
  protocol: 'rw',
  sendBatteryCommand: () => new Promise(() => undefined),
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 68, data: [68], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 99, data: [99], protocol: 'rw' } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const hangingCommandStart = Date.now();
const hangingCommandResult = await refreshLegacyBusinessMetrics(
  hangingCommandAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' })
  },
  {
    timeoutMs: 20
  }
);
const hangingCommandElapsedMs = Date.now() - hangingCommandStart;

if (
  hangingCommandElapsedMs > 700 ||
  hangingCommandResult.status !== 'success' ||
  !hangingCommandResult.ok.includes('heart_rate') ||
  !hangingCommandResult.ok.includes('battery_command_pending') ||
  hangingCommandResult.failed.length !== 0
) {
  throw new Error(
    `RW refresh should settle and downgrade command timeouts to pending when a BLE command never resolves: ${JSON.stringify({
      hangingCommandElapsedMs,
      hangingCommandResult
    })}`
  );
}

const fallbackDirectReads: string[] = [];
const directReadFallbackAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  readRwHealthData: async (name: string) => {
    fallbackDirectReads.push(name);
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', value: 60, protocol: 'rw' } as RingParsedData,
      { type: 'firmware_version', firmwareVersion: '2.2.9', softwareVersion: '303e0001', protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'heart_rate', value: 70, data: [70], protocol: 'rw' } as RingParsedData,
      { type: 'rw_health_data', name: 'blood_oxygen', value: 99, data: [99], protocol: 'rw' } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const directReadFallbackStart = Date.now();
const directReadFallbackResult = await refreshLegacyBusinessMetrics(
  directReadFallbackAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' })
  },
  {
    timeoutMs: 20
  }
);
const directReadFallbackElapsedMs = Date.now() - directReadFallbackStart;

if (directReadFallbackElapsedMs > 700 || directReadFallbackResult.status !== 'success') {
  throw new Error(`RW direct read fallback should not block foreground refresh: ${JSON.stringify({ directReadFallbackElapsedMs, directReadFallbackResult })}`);
}

await new Promise((resolve) => setTimeout(resolve, 50));
if (fallbackDirectReads.length > 0) {
  throw new Error(`RW refresh should not fan out background reads after one-shot metric commands: ${JSON.stringify(fallbackDirectReads)}`);
}

const delayedMonitoringReceived: RingParsedData[] = [];
let monitoringWaitsCreated = 0;
const delayedMonitoringAdapter = {
  protocol: 'rw',
  sendBatteryCommand: async () => undefined,
  sendFirmwareVersion: async () => undefined,
  readCollectPeriodCommand: async () => undefined,
  sendActiveMeasureCommand: async () => undefined,
  sendOxyGenCommand: async () => undefined,
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const battery = { type: 'battery', value: 81, protocol: 'rw' } as RingParsedData;
    const firmware = {
      type: 'firmware_version',
      firmwareVersion: '2.2.9',
      softwareVersion: '303e0001',
      protocol: 'rw'
    } as RingParsedData;
    const heartRate = { type: 'rw_health_data', name: 'heart_rate', value: 72, data: [72], protocol: 'rw' } as RingParsedData;
    const bloodOxygen = { type: 'rw_health_data', name: 'blood_oxygen', value: 98, data: [98], protocol: 'rw' } as RingParsedData;
    const immediate = [battery, firmware, heartRate, bloodOxygen].find(predicate);
    if (immediate) return Promise.resolve(immediate);

    const delayedMonitoring = {
      type: 'rw_health_monitoring',
      name: 'stress',
      enabled: true,
      interval: 30,
      protocol: 'rw'
    } as RingParsedData;
    if (predicate(delayedMonitoring)) {
      monitoringWaitsCreated += 1;
      return new Promise<RingParsedData>((resolve) => setTimeout(() => resolve(delayedMonitoring), 60));
    }

    return makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const delayedMonitoringStart = Date.now();
const delayedMonitoringResult = await refreshLegacyBusinessMetrics(
  delayedMonitoringAdapter,
  {
    getDeviceInfo: () => ({ deviceId: 'rw-device', protocol: 'rw' }),
    onParsedData: (parsed) => delayedMonitoringReceived.push(parsed)
  },
  {
    timeoutMs: 20
  }
);
const delayedMonitoringElapsedMs = Date.now() - delayedMonitoringStart;

if (delayedMonitoringElapsedMs > 700) {
  throw new Error(`RW refresh should not wait for delayed monitoring config: ${delayedMonitoringElapsedMs}ms`);
}

if (!delayedMonitoringResult.ok.includes('collect_period_pending') || monitoringWaitsCreated === 0) {
  throw new Error(`RW refresh should mark monitoring config as pending without blocking: ${JSON.stringify(delayedMonitoringResult)}`);
}

await new Promise((resolve) => setTimeout(resolve, 90));
if (!delayedMonitoringReceived.some((item) => item.type === 'rw_health_monitoring' && item.name === 'stress')) {
  throw new Error(`Delayed RW monitoring config should still flow into parsed data: ${JSON.stringify(delayedMonitoringReceived)}`);
}

const reconnectEvents: unknown[] = [];
const rebindPayloads: unknown[] = [];
let reconnectSourceDevice: unknown;
const reconnectAdapter = {
  protocol: 'rw',
  connectAndDiscover: async (deviceId: string, deviceName: string, sourceDevice: unknown) => {
    reconnectSourceDevice = sourceDevice;
    reconnectEvents.push({ type: 'connect', deviceId, deviceName });
    return {
      protocol: 'rw',
      deviceId,
      name: deviceName,
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
      dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
    };
  }
} as unknown as LegacyRingAdapter;

const reconnectSuccess = await autoReconnectLegacyRing(
  reconnectAdapter,
  {
    getDeviceInfo: () => ({}),
    getBoundDevice: async () => ({
      protocol: 'rw',
      deviceId: '3E:00:00:00:05:1B',
      mac: '00:05:1B',
      deviceName: 'SY03',
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
      dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
    }),
    onDeviceReady: (device) => reconnectEvents.push({ type: 'ready', device }),
    onReconnectStatusChange: (status) => reconnectEvents.push({ type: 'status', status }),
    onReconnectResultChange: (success) => reconnectEvents.push({ type: 'result', success }),
    bindDevice: async (payload) => {
      rebindPayloads.push(payload);
      return payload;
    }
  },
  {
    maxAttempts: 1,
    delayMs: 1
  }
);

if (!reconnectSuccess) {
  throw new Error('RW auto reconnect should succeed when a bound device is available.');
}

if (!reconnectEvents.some((event: any) => event.type === 'connect' && event.deviceId === '3E:00:00:00:05:1B')) {
  throw new Error(`RW auto reconnect should use the stored deviceId: ${JSON.stringify(reconnectEvents)}`);
}

if ((reconnectSourceDevice as any)?.protocol !== 'rw' || (reconnectSourceDevice as any)?.deviceName !== 'SY03') {
  throw new Error(`Auto reconnect should pass stored device metadata into the adapter: ${JSON.stringify(reconnectSourceDevice)}`);
}

if (!reconnectEvents.some((event: any) => event.type === 'result' && event.success === true)) {
  throw new Error(`RW auto reconnect should report success: ${JSON.stringify(reconnectEvents)}`);
}

const reconnectReadyEvent = reconnectEvents.find((event: any) => event.type === 'ready') as any;
if (
  reconnectReadyEvent?.device?.mac !== '00:05:1B' ||
  reconnectReadyEvent?.device?.deviceName !== 'SY03' ||
  reconnectReadyEvent?.device?.protocol !== 'rw'
) {
  throw new Error(`RW auto reconnect should restore stable bound identity to deviceInfo: ${JSON.stringify(reconnectEvents)}`);
}

if (
  !rebindPayloads.some(
    (payload: any) =>
      payload.protocol === 'rw' &&
      payload.serviceId === '0000A00A-0000-1000-8000-00805F9B34FB' &&
      payload.cmdCharId === '0000B002-0000-1000-8000-00805F9B34FB' &&
      payload.dataCharId === '0000B003-0000-1000-8000-00805F9B34FB'
  )
) {
  throw new Error(`RW auto reconnect should refresh bound service metadata: ${JSON.stringify(rebindPayloads)}`);
}

const currentReconnectEvents: unknown[] = [];
const currentReconnectRebindPayloads: unknown[] = [];
const currentReconnectSuccess = await autoReconnectLegacyRing(
  {
    protocol: 'rw',
    connectAndDiscover: async (deviceId: string, deviceName: string) => {
      currentReconnectEvents.push({ type: 'connect', deviceId, deviceName });
      return {
        protocol: 'rw',
        deviceId,
        name: deviceName,
        serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
        cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
        dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
      };
    }
  } as unknown as LegacyRingAdapter,
  {
    getDeviceInfo: () => ({
      protocol: 'rw',
      deviceId: '3E:00:00:00:05:1B',
      name: 'SY03',
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB'
    }),
    getBoundDevice: async () => undefined,
    onDeviceReady: (device) => currentReconnectEvents.push({ type: 'ready', device }),
    onReconnectStatusChange: (status) => currentReconnectEvents.push({ type: 'status', status }),
    onReconnectResultChange: (success) => currentReconnectEvents.push({ type: 'result', success }),
    bindDevice: async (payload) => {
      currentReconnectRebindPayloads.push(payload);
      return payload;
    }
  },
  {
    maxAttempts: 1,
    delayMs: 1
  }
);

if (
  !currentReconnectSuccess ||
  !currentReconnectEvents.some((event: any) => event.type === 'connect' && event.deviceName === 'SY03') ||
  !currentReconnectEvents.some((event: any) => event.type === 'ready' && event.device.deviceName === 'SY03' && event.device.protocol === 'rw')
) {
  throw new Error(`RW auto reconnect should reuse current device name when already selected: ${JSON.stringify(currentReconnectEvents)}`);
}

if (!currentReconnectRebindPayloads.some((payload: any) => payload.mac === '3E:00:00:00:05:1B')) {
  throw new Error(
    `RW auto reconnect should fall back to deviceId when rebinding without a stable MAC: ${JSON.stringify(currentReconnectRebindPayloads)}`
  );
}

const rwRandomDirectReconnectEvents: unknown[] = [];
const rwRandomDirectReconnectPayloads: unknown[] = [];
const rwRandomDirectReconnectSuccess = await autoReconnectLegacyRing(
  {
    protocol: 'rw',
    connectAndDiscover: async (deviceId: string, deviceName: string) => {
      rwRandomDirectReconnectEvents.push({ type: 'connect', deviceId, deviceName });
      return {
        protocol: 'rw',
        deviceId,
        name: deviceName,
        serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
        cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
        dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
      };
    }
  } as unknown as LegacyRingAdapter,
  {
    getDeviceInfo: () => ({
      protocol: 'rw',
      deviceId: 'rw-random-platform-id',
      name: 'SY03',
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
      dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
    }),
    getBoundDevice: async () => undefined,
    onDeviceReady: (device) => rwRandomDirectReconnectEvents.push({ type: 'ready', device }),
    onReconnectStatusChange: (status) => rwRandomDirectReconnectEvents.push({ type: 'status', status }),
    onReconnectResultChange: (success) => rwRandomDirectReconnectEvents.push({ type: 'result', success }),
    bindDevice: async (payload) => {
      rwRandomDirectReconnectPayloads.push(payload);
      return payload;
    }
  },
  {
    maxAttempts: 1,
    delayMs: 1
  }
);

const rwRandomDirectReadyEvent = rwRandomDirectReconnectEvents.find((event: any) => event.type === 'ready') as any;
if (
  !rwRandomDirectReconnectSuccess ||
  rwRandomDirectReadyEvent?.device?.mac ||
  rwRandomDirectReadyEvent?.device?.uniMacId ||
  rwRandomDirectReconnectPayloads.length !== 0
) {
  throw new Error(
    `RW auto reconnect should not promote random platform ids into stable identity fields: ${JSON.stringify({
      events: rwRandomDirectReconnectEvents,
      payloads: rwRandomDirectReconnectPayloads
    })}`
  );
}

const reconnectWithoutNetworkEvents: unknown[] = [];
const reconnectWithoutNetworkSuccess = await autoReconnectLegacyRing(
  {
    protocol: 'rw',
    connectAndDiscover: async (deviceId: string, deviceName: string, sourceDevice: unknown) => {
      reconnectWithoutNetworkEvents.push({ type: 'connect', deviceId, deviceName, sourceDevice });
      return {
        protocol: 'rw',
        deviceId,
        name: deviceName,
        serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
        cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
        dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
      };
    }
  } as unknown as LegacyRingAdapter,
  {
    getDeviceInfo: () => ({
      protocol: 'rw',
      deviceId: '3E:00:00:00:05:1B',
      mac: '00:05:1B',
      name: 'SY03'
    }),
    getBoundDevice: async () => {
      throw new Error('network unavailable');
    },
    onDeviceReady: (device) => reconnectWithoutNetworkEvents.push({ type: 'ready', device }),
    onReconnectStatusChange: (status) => reconnectWithoutNetworkEvents.push({ type: 'status', status }),
    onReconnectResultChange: (success) => reconnectWithoutNetworkEvents.push({ type: 'result', success })
  },
  {
    maxAttempts: 1,
    delayMs: 1
  }
);

if (
  !reconnectWithoutNetworkSuccess ||
  !reconnectWithoutNetworkEvents.some((event: any) => event.type === 'connect' && event.deviceId === '3E:00:00:00:05:1B') ||
  !reconnectWithoutNetworkEvents.some((event: any) => event.type === 'ready' && event.device.mac === '00:05:1B')
) {
  throw new Error(`RW auto reconnect should not depend on the bind-info request when current device info is available: ${JSON.stringify(reconnectWithoutNetworkEvents)}`);
}

const rwUnbindEvents: unknown[] = [];
const rwUnbindSuccess = await unbindLegacyRing(
  {
    protocol: 'rw',
    disconnect: async (deviceId?: string) => {
      rwUnbindEvents.push({ type: 'disconnect', deviceId });
      return true;
    }
  } as unknown as LegacyRingAdapter,
  {
    getDeviceInfo: () => ({
      protocol: 'rw',
      deviceId: 'ios-random-rw-id',
      uniMacId: 'ios-random-uni-id',
      advertis: {
        macInfo: '3E:00:00:00:05:1B'
      }
    }),
    unbindDevice: async (payload) => {
      rwUnbindEvents.push({ type: 'unbind', payload });
      return payload;
    },
    onUploadingStatusChange: (status) => rwUnbindEvents.push({ type: 'uploading', status }),
    onReconnectStatusChange: (status) => rwUnbindEvents.push({ type: 'status', status }),
    onReconnectResultChange: (success) => rwUnbindEvents.push({ type: 'result', success }),
    onDeviceReady: (device) => rwUnbindEvents.push({ type: 'ready', device })
  }
);

if (
  !rwUnbindSuccess ||
  !rwUnbindEvents.some((event: any) => event.type === 'unbind' && event.payload.mac === '3E:00:00:00:05:1B') ||
  !rwUnbindEvents.some((event: any) => event.type === 'disconnect' && event.deviceId === 'ios-random-rw-id') ||
  !rwUnbindEvents.some((event: any) => event.type === 'result' && event.success === null)
) {
  throw new Error(
    `RW unbind should remove the stable bound MAC while disconnecting the current platform deviceId: ${JSON.stringify(rwUnbindEvents)}`
  );
}

const rwColdUnbindEvents: unknown[] = [];
await unbindLegacyRing(
  {
    protocol: 'rw',
    disconnect: async (deviceId?: string) => {
      rwColdUnbindEvents.push({ type: 'disconnect', deviceId });
      return true;
    }
  } as unknown as LegacyRingAdapter,
  {
    getDeviceInfo: () => ({}),
    unbindDevice: async (payload) => {
      rwColdUnbindEvents.push({ type: 'unbind', payload });
      return payload;
    },
    onDeviceReady: (device) => rwColdUnbindEvents.push({ type: 'ready', device })
  },
  '3E:00:00:00:05:1B'
);

if (
  !rwColdUnbindEvents.some((event: any) => event.type === 'unbind' && event.payload.mac === '3E:00:00:00:05:1B') ||
  !rwColdUnbindEvents.some((event: any) => event.type === 'disconnect' && event.deviceId === undefined)
) {
  throw new Error(
    `RW cold unbind should clear the stable bound MAC without treating it as a BLE platform deviceId: ${JSON.stringify(rwColdUnbindEvents)}`
  );
}

let forwardedSourceDevice: unknown;
let connectBindPayload: unknown;
const connectAdapter = {
  protocol: 'qkeer-v2',
  stopScan: async () => undefined,
  connectAndDiscover: async (deviceId: string, deviceName: string, sourceDevice: unknown) => {
    forwardedSourceDevice = sourceDevice;
    return {
      protocol: 'qkeer-v2',
      deviceId,
      name: deviceName,
      serviceId: '49535343-FE7D-4AE5-8FA9-9FAFD205E455',
      cmdCharId: '49535343-8841-43F4-A8D4-ECBE34729BB3',
      dataCharId: '49535343-1E4D-4BD9-BA61-23C647249616'
    };
  }
} as unknown as LegacyRingAdapter;

await connectLegacyRing(
  connectAdapter,
  {
    getDeviceInfo: () => ({}),
    bindDevice: async (payload) => {
      connectBindPayload = payload;
      return payload;
    },
    onDeviceReady: () => undefined
  },
  {
    deviceId: '40:9C:A7:0E:9C:61',
    deviceName: 'QKeeRingL19',
    sourceDevice: {
      deviceId: '40:9C:A7:0E:9C:61',
      protocol: 'qkeer-v2',
      advertis: {
        macInfo: '02:0B:B7'
      }
    } as any
  }
);

if ((forwardedSourceDevice as any)?.advertis?.macInfo !== '02:0B:B7') {
  throw new Error(`connect workflow should forward scan metadata to protocol adapter: ${JSON.stringify(forwardedSourceDevice)}`);
}

if ((connectBindPayload as any)?.advertis?.macInfo !== '02:0B:B7') {
  throw new Error(`connect workflow should persist scan advertis metadata for reconnect: ${JSON.stringify(connectBindPayload)}`);
}

let rwConnectBindPayload: unknown;
let rwReadyDevice: unknown;
let rwConnectListenerRegistrations = 0;
const rwConnectAdapter = {
  protocol: 'rw',
  stopScan: async () => undefined,
  registerConnectionStateListener: () => {
    rwConnectListenerRegistrations += 1;
  },
  connectAndDiscover: async (deviceId: string, deviceName: string, sourceDevice: any) => {
    return {
      protocol: 'rw',
      deviceId,
      name: deviceName,
      serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
      dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
      dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
      advertis: sourceDevice?.advertis
    };
  }
} as unknown as LegacyRingAdapter;

await connectLegacyRing(
  rwConnectAdapter,
  {
    getDeviceInfo: () => ({}),
    bindDevice: async (payload) => {
      rwConnectBindPayload = payload;
      return payload;
    },
    onDeviceReady: (device) => {
      rwReadyDevice = device;
    }
  },
  {
    deviceId: 'ios-random-2',
    deviceName: 'SY03',
    uniMacId: 'ios-random-uni-id',
    sourceDevice: {
      deviceId: 'ios-random-2',
      uniMacId: 'ios-random-uni-id',
      protocol: 'rw',
      advertis: {
        macInfo: '3E:00:00:00:05:1B'
      }
    } as any
  }
);

if (
  (rwConnectBindPayload as any)?.deviceId !== 'ios-random-2' ||
  (rwConnectBindPayload as any)?.mac !== '3E:00:00:00:05:1B' ||
  (rwConnectBindPayload as any)?.uniMacId !== '3E:00:00:00:05:1B' ||
  (rwReadyDevice as any)?.deviceId !== 'ios-random-2' ||
  (rwReadyDevice as any)?.mac !== '3E:00:00:00:05:1B' ||
  (rwReadyDevice as any)?.uniMacId !== '3E:00:00:00:05:1B' ||
  rwConnectListenerRegistrations !== 1
) {
  throw new Error(
    `RW connect workflow should keep the platform deviceId for BLE while binding the stable advertis MAC: ${JSON.stringify({
      rwConnectBindPayload,
      rwReadyDevice,
      rwConnectListenerRegistrations
    })}`
  );
}

const qkeerV2Sent: string[] = [];
const qkeerV2Adapter = {
  protocol: 'qkeer-v2',
  sendBatteryCommand: async () => {
    qkeerV2Sent.push('battery');
  },
  sendFirmwareVersion: async () => {
    qkeerV2Sent.push('firmware');
  },
  readDeviceTime: async () => {
    qkeerV2Sent.push('device_time');
  },
  sendActiveMeasureCommand: async () => {
    qkeerV2Sent.push('heart_rate');
  },
  sendOxyGenCommand: async () => {
    qkeerV2Sent.push('blood_oxygen');
  },
  sendBodyTemperatureCommand: async () => {
    qkeerV2Sent.push('last_data');
  },
  readCollectPeriodCommand: async () => {
    qkeerV2Sent.push('collect_period');
  },
  readLocalData: async () => {
    qkeerV2Sent.push('history_snapshot');
  },
  waitForParsedData: (predicate: (parsed: RingParsedData) => boolean, timeoutMs?: number) => {
    const candidates: RingParsedData[] = [
      { type: 'battery', protocol: 'qkeer-v2', battery: 88 } as RingParsedData,
      { type: 'firmware_version', protocol: 'qkeer-v2', firmwareVersion: '603SV9.4.3', softwareVersion: '2.8.8.3Z3G' } as RingParsedData,
      { type: 'device_time', protocol: 'qkeer-v2', timestamp: Date.now(), timezone: 8 } as RingParsedData,
      { type: 'active_measure', protocol: 'qkeer-v2', heartRate: 72 } as RingParsedData,
      { type: 'active_OxyGenMeasure', protocol: 'qkeer-v2', bloodOxygen: 98 } as RingParsedData,
      { type: 'qkeer_v2_last_data', protocol: 'qkeer-v2', step: 1234, isWorn: true } as RingParsedData,
      { type: 'collect_period_read', protocol: 'qkeer-v2', period: 1800, minutes: 30 } as RingParsedData,
      {
        type: 'qkeer_v2_sleep_list',
        protocol: 'qkeer-v2',
        records: [{ sleepStatus: 2, durationMinutes: 80 }],
        status: 'success'
      } as RingParsedData
    ];
    const parsed = candidates.find(predicate);
    return parsed ? Promise.resolve(parsed) : makeParsedWaiter(timeoutMs);
  }
} as unknown as LegacyRingAdapter;

const qkeerV2RefreshResult = await refreshLegacyBusinessMetrics(
  qkeerV2Adapter,
  {
    getDeviceInfo: () => ({ deviceId: 'qkeer-v2-device', protocol: 'qkeer-v2' })
  },
  {
    timeoutMs: 20
  }
);

for (const step of ['battery', 'firmware', 'software', 'device_time', 'heart_rate', 'blood_oxygen', 'last_data', 'collect_period', 'history_snapshot']) {
  if (!qkeerV2RefreshResult.ok.includes(step)) {
    throw new Error(`QKeer V2 business refresh should include ${step}: ${JSON.stringify(qkeerV2RefreshResult)}`);
  }
}

for (const command of ['battery', 'firmware', 'device_time', 'heart_rate', 'blood_oxygen', 'last_data', 'collect_period', 'history_snapshot']) {
  if (!qkeerV2Sent.includes(command)) {
    throw new Error(`QKeer V2 business refresh should trigger ${command}: ${JSON.stringify(qkeerV2Sent)}`);
  }
}

if (qkeerV2RefreshResult.status !== 'success') {
  throw new Error(`QKeer V2 business refresh should complete when SDK data is returned: ${JSON.stringify(qkeerV2RefreshResult)}`);
}
