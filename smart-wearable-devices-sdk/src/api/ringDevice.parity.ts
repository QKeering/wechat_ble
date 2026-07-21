const storage = new Map<string, unknown>();

(globalThis as any).uni = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => {
    storage.set(key, value);
  }
};

const { bindRingDevice, getBoundRingDevice, unbindRingDevice } = await import('./ringDevice');
const { uploadRingHistoryRecords } = await import('./ringDevice');

await bindRingDevice({
  mac: '00:05:1B',
  deviceId: '3E:00:00:00:05:1B',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  dataServiceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  uniMacId: '00:05:1B',
  deviceName: 'SY03',
  protocol: 'rw',
  advertis: {
    macInfo: '00:05:1B',
    batteryLevel: 57
  }
});

const bound = await getBoundRingDevice();

if (
  bound?.protocol !== 'rw' ||
  bound.deviceId !== '3E:00:00:00:05:1B' ||
  bound.cmdCharId !== '0000B002-0000-1000-8000-00805F9B34FB' ||
  bound.dataCharId !== '0000B003-0000-1000-8000-00805F9B34FB' ||
  bound.dataServiceId !== '0000A00A-0000-1000-8000-00805F9B34FB' ||
  bound.advertis?.batteryLevel !== 57
) {
  throw new Error(`Bound RW device should keep protocol and characteristic metadata: ${JSON.stringify(bound)}`);
}

await unbindRingDevice({ mac: '00:05:1B' });

if ((await getBoundRingDevice()) !== null) {
  throw new Error('Unbind should clear the stored ring device.');
}

await bindRingDevice({
  mac: '',
  deviceId: 'rw-random-platform-id',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  deviceName: 'SY03',
  protocol: 'rw',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  }
});

const rwAdvertisBound = await getBoundRingDevice();
if (rwAdvertisBound?.mac !== '3E:00:00:00:05:1B' || rwAdvertisBound.deviceId !== 'rw-random-platform-id') {
  throw new Error(`Bound RW device should use advertis macInfo as stable mac while keeping platform deviceId: ${JSON.stringify(rwAdvertisBound)}`);
}

await unbindRingDevice({ mac: '3E:00:00:00:05:1B' });

if ((await getBoundRingDevice()) !== null) {
  throw new Error('Unbind should clear RW devices bound from advertis macInfo fallback.');
}

await bindRingDevice({
  mac: '',
  deviceId: 'rw-random-platform-id',
  uniMacId: '3E:00:00:00:05:2A',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
});

const rwUniMacBound = await getBoundRingDevice();
if (rwUniMacBound?.mac !== '3E:00:00:00:05:2A') {
  throw new Error(`Bound RW device should use colon-separated uniMacId as last stable mac fallback: ${JSON.stringify(rwUniMacBound)}`);
}

await unbindRingDevice({ mac: '3E:00:00:00:05:2A' });

storage.set('qkeer:bound-ring-device', {
  protocol: 'rw',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  }
});

await unbindRingDevice({ mac: '3E:00:00:00:05:1B' });

if ((await getBoundRingDevice()) !== null) {
  throw new Error('Unbind should clear RW devices matched only by advertis macInfo.');
}

storage.set('qkeer:bound-ring-device', {
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  advertis: {
    macInfo: '3e-00-00-00-05-1b'
  }
});

await unbindRingDevice({ mac: '3e000000051b' });

if ((await getBoundRingDevice()) !== null) {
  throw new Error('Unbind should clear RW devices even when the stable MAC formatting changes.');
}

storage.set('qkeer:bound-ring-device', {
  protocol: 'rw',
  deviceId: 'wechat-random-id',
  uniMacId: 'B09FBA121E1C',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  }
});

await unbindRingDevice({ mac: 'wechat-random-id' });

if ((await getBoundRingDevice()) === null) {
  throw new Error('Unbind should not clear RW bindings by random platform deviceId.');
}

await unbindRingDevice({ mac: '3E:00:00:00:05:1B' });

if ((await getBoundRingDevice()) !== null) {
  throw new Error('Unbind should still clear RW bindings by stable advertis macInfo after ignoring random platform id.');
}

storage.set('qkeer:bound-ring-device', {
  protocol: 'legacy',
  deviceId: 'legacy-device-id',
  uniMacId: 'legacy-mac'
});

await unbindRingDevice({ mac: 'legacy-device-id' });

if ((await getBoundRingDevice()) !== null) {
  throw new Error('Unbind should preserve legacy/L19 deviceId fallback matching.');
}

await uploadRingHistoryRecords(
  [
    { unixTime: 1710000000, heartRate: 70 },
    { unixTime: 1710000300, heartRate: 72 }
  ],
  { type: 'local_data', protocol: 'rw', records: [] }
);

await uploadRingHistoryRecords(
  [
    { unixTime: 1710000000, heartRate: 70 },
    { unixTime: 1710000600, heartRate: 74 }
  ],
  { type: 'local_data', protocol: 'rw', records: [] }
);

const storedHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
if (
  storedHistory.length !== 3 ||
  !storedHistory.every((record) => record.protocol === 'rw' && record.sourceType === 'local_data' && record.uploadedAt)
) {
  throw new Error(`History upload should deduplicate records and preserve source metadata: ${JSON.stringify(storedHistory)}`);
}

await uploadRingHistoryRecords(
  [
    { recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', heartRate: 76, mac: '3E:00:00:00:05:1B' },
    { recordTime: '2099-01-01 00:00:00', dataType: 'blood_oxygen_raw', spo2: 98, mac: '3E:00:00:00:05:1B' },
    { recordTime: '2000-01-01 00:00:00', dataType: 'sleep', sleepState: 1, mac: '3E:00:00:00:05:1B' }
  ],
  { type: 'local_data', protocol: 'rw', records: [] }
);

await uploadRingHistoryRecords(
  [
    { recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', heartRate: 76, mac: '3E:00:00:00:05:1B' },
    { recordTime: '2099-01-01 00:00:00', dataType: 'blood_sugar', bloodSugar: 5.8, mac: '3E:00:00:00:05:1B' }
  ],
  { type: 'local_data', protocol: 'rw', records: [] }
);

const recordTimeHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
const recordTimeRows = recordTimeHistory.filter((record) => record.recordTime);
if (
  recordTimeRows.length !== 4 ||
  recordTimeRows[0].recordTime !== '2099-01-01 00:00:00' ||
  recordTimeRows.filter((record) => record.dataType === 'heart_rate_raw').length !== 1 ||
  !recordTimeRows.some((record) => record.dataType === 'blood_oxygen_raw') ||
  !recordTimeRows.some((record) => record.dataType === 'blood_sugar') ||
  !recordTimeRows.some((record) => record.dataType === 'sleep')
) {
  throw new Error(
    `History upload fallback should sort and dedupe RW recordTime-only rows by metric identity: ${JSON.stringify(recordTimeRows)}`
  );
}

await uploadRingHistoryRecords(
  [
    { unixTime: 1710000900, dataType: 'heart_rate', heartRate: 75, mac: '3E:00:00:00:05:1B' },
    { unixTime: 1710000900, dataType: 'heart_rate', heartRate: 82, mac: '3E:00:00:00:05:2A' }
  ],
  { type: 'local_data', protocol: 'rw', records: [] }
);

const multiDeviceHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
const sameTimeHeartRateRecords = multiDeviceHistory.filter(
  (record) => record.unixTime === 1710000900 && record.dataType === 'heart_rate'
);
if (
  sameTimeHeartRateRecords.length !== 2 ||
  !sameTimeHeartRateRecords.some((record) => record.mac === '3E:00:00:00:05:1B' && record.heartRate === 75) ||
  !sameTimeHeartRateRecords.some((record) => record.mac === '3E:00:00:00:05:2A' && record.heartRate === 82)
) {
  throw new Error(`History upload should keep same-time RW records from different stable devices: ${JSON.stringify(multiDeviceHistory)}`);
}

storage.set('qkeer:ring-history-records', []);

await uploadRingHistoryRecords([{ unixTime: 1710001200, dataType: 'heart_rate', heartRate: 76 }], {
  type: 'local_data',
  protocol: 'rw',
  deviceId: 'wechat-platform-a',
  mac: '3E:00:00:00:05:1B',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  records: []
});

await uploadRingHistoryRecords([{ unixTime: 1710001200, dataType: 'heart_rate', heartRate: 77 }], {
  type: 'local_data',
  protocol: 'rw',
  deviceId: 'wechat-platform-b',
  mac: '3E:00:00:00:05:1B',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  records: []
});

const rotatedPlatformHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
if (
  rotatedPlatformHistory.length !== 1 ||
  rotatedPlatformHistory[0].mac !== '3E:00:00:00:05:1B' ||
  rotatedPlatformHistory[0].deviceId !== 'wechat-platform-b' ||
  rotatedPlatformHistory[0].heartRate !== 77
) {
  throw new Error(
    `History upload should dedupe identity-less RW records by parsed stable identity across platform id rotation: ${JSON.stringify(
      rotatedPlatformHistory
    )}`
  );
}

await uploadRingHistoryRecords([{ unixTime: 1710001200, dataType: 'heart_rate', heartRate: 82 }], {
  type: 'local_data',
  protocol: 'rw',
  deviceId: 'wechat-platform-c',
  advertis: {
    macInfo: '3E:00:00:00:05:2A'
  },
  records: []
});

const parsedIdentityHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
if (
  parsedIdentityHistory.length !== 2 ||
  !parsedIdentityHistory.some((record) => record.mac === '3E:00:00:00:05:1B' && record.heartRate === 77) ||
  !parsedIdentityHistory.some((record) => record.mac === '3E:00:00:00:05:2A' && record.heartRate === 82)
) {
  throw new Error(
    `History upload should backfill parsed RW stable identity without merging different devices: ${JSON.stringify(
      parsedIdentityHistory
    )}`
  );
}

storage.set('qkeer:ring-history-records', []);

await uploadRingHistoryRecords(
  [
    {
      unixTime: 1710001500,
      dataType: 'heart_rate',
      heartRate: 70,
      protocol: 'rw',
      deviceId: 'rw-random-platform-a',
      uniMacId: '111111ABCDEF'
    },
    {
      unixTime: 1710001500,
      dataType: 'heart_rate',
      heartRate: 71,
      protocol: 'rw',
      deviceId: 'rw-random-platform-b',
      uniMacId: '111111ABCDEF'
    }
  ],
  {
    type: 'local_data',
    protocol: 'rw',
    records: []
  }
);

const randomUniMacHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
if (
  randomUniMacHistory.length !== 2 ||
  !randomUniMacHistory.some((record) => record.deviceId === 'rw-random-platform-a' && record.heartRate === 70) ||
  !randomUniMacHistory.some((record) => record.deviceId === 'rw-random-platform-b' && record.heartRate === 71)
) {
  throw new Error(
    `History upload should not collapse RW random uniMacId records without a stable MAC: ${JSON.stringify(randomUniMacHistory)}`
  );
}

storage.set('qkeer:ring-history-records', []);

await uploadRingHistoryRecords(
  [{ RecordTime: '2099-01-01 00:00:00', DataType: 'Heart_Rate_Raw', HR: 76, mac: '3E:00:00:00:05:1B' }],
  { type: 'local_data', protocol: 'rw', records: [] }
);

await uploadRingHistoryRecords(
  [{ recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', heartRate: 77, mac: '3E:00:00:00:05:1B' }],
  { type: 'local_data', protocol: 'rw', records: [] }
);

const mixedCaseFallbackHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
if (
  mixedCaseFallbackHistory.length !== 1 ||
  mixedCaseFallbackHistory[0].recordTime !== '2099-01-01 00:00:00' ||
  mixedCaseFallbackHistory[0].dataType !== 'heart_rate_raw' ||
  mixedCaseFallbackHistory[0].heartRate !== 77
) {
  throw new Error(
    `Local fallback history should dedupe mixed-case RW record metadata by the same L19-compatible identity: ${JSON.stringify(
      mixedCaseFallbackHistory
    )}`
  );
}

storage.set('qkeer:ring-history-records', []);

await uploadRingHistoryRecords(
  [
    {
      unixTime: 1767229261,
      dataType: 'heart_rate_raw',
      rawDataType: 'hr',
      status: 'pending_upload_payload',
      seq: 7,
      fileName: 'u1_20260101010101_hr.txt',
      mac: '3E:00:00:00:05:1B'
    }
  ],
  { type: 'rw_file_list', protocol: 'rw', records: [] }
);

await uploadRingHistoryRecords(
  [
    {
      unixTime: 1767229261,
      dataType: 'heart_rate_raw',
      rawDataType: 'hr',
      status: 'completed',
      seq: 7,
      fileName: 'u1_20260101010101_hr.txt',
      value: 76,
      mac: '3E:00:00:00:05:1B'
    }
  ],
  { type: 'rw_upload_file', protocol: 'rw', records: [] }
);

const completedRwFileHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
if (
  completedRwFileHistory.length !== 1 ||
  completedRwFileHistory[0].sourceType !== 'rw_upload_file' ||
  completedRwFileHistory[0].status !== 'completed' ||
  completedRwFileHistory[0].value !== 76
) {
  throw new Error(
    `RW local fallback history should replace pending file-list records with completed upload records: ${JSON.stringify(
      completedRwFileHistory
    )}`
  );
}

storage.set('qkeer:ring-history-records', []);

await uploadRingHistoryRecords(
  Array.from({ length: 220 }, (_, index) => ({ unixTime: 1720000000 + index, stepCount: index })),
  { type: 'qkeer_v2_step_list', protocol: 'qkeer-v2', records: [] }
);

const cappedHistory = storage.get('qkeer:ring-history-records') as Array<Record<string, any>>;
if (cappedHistory.length !== 200 || cappedHistory[0].unixTime !== 1720000219) {
  throw new Error(`History upload should cap local fallback records to the latest 200: ${JSON.stringify(cappedHistory.slice(0, 3))}`);
}

export {};
