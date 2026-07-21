import {
  formatMetricRecordTime,
  getLatestBloodPressureReading,
  getLatestBloodSugarReading,
  getLatestHeartRateReading,
  getLatestHrvReading,
  getLatestSpo2Reading,
  getLatestStressReading,
  getLatestTemperatureReading,
  getSubmitDeviceMac,
  requestMetricRefresh,
  toMetricNumber
} from './useRingMetricReadings';

const rwStore = {
  receivedData: [
    {
      type: 'rw_health_data',
      name: 'heart_rate',
      value: 68,
      timestamp: 1710000000000
    },
    {
      type: 'rw_health_data',
      name: 'blood_oxygen',
      value: 99,
      timestamp: 1710000001000
    },
    {
      type: 'rw_health_data',
      name: 'temperature',
      value: 0.59,
      timestamp: 1710000002000
    },
    {
      type: 'rw_health_data',
      name: 'hrv',
      value: 45,
      timestamp: 1710000002500
    },
    {
      type: 'rw_health_data',
      name: 'stress',
      value: 31,
      timestamp: 1710000003000
    },
    {
      type: 'rw_health_data',
      name: 'blood_sugar',
      value: 5.8,
      timestamp: 1710000004000
    },
    {
      type: 'rw_health_data',
      name: 'blood_pressure',
      value: {
        systolic: 120,
        diastolic: 79
      },
      timestamp: 1710000005000
    }
  ],
  healthData: {
    hrv: 42,
    temperature: 36.5,
    stressIndex: 28,
    bloodSugar: 5.6,
    bloodPressure: {
      systolic: 118,
      diastolic: 76
    },
    lastMetricUpdateAt: 1710000006000
  },
  normalMac: '00:05:1B',
  iosMacId: 'ios-mac-id',
  deviceInfo: {
    deviceId: '3E:00:00:00:05:1B'
  }
};

const heartRate = getLatestHeartRateReading(rwStore);
if (heartRate?.heartRate !== 68) {
  throw new Error(`RW heart rate should be readable through unified metric helper: ${JSON.stringify(heartRate)}`);
}

const rwHrvCompatKeyOnlyStore = {
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'hrv',
      key: 0x0269,
      flag: 0x00,
      value: 46,
      timestamp: 1710000007000
    }
  ],
  healthData: {},
  latestMetrics: {},
  deviceInfo: {
    protocol: 'rw'
  }
};
if (getLatestHrvReading(rwHrvCompatKeyOnlyStore)) {
  throw new Error('RW HRV should not be filled from 0x0269 update packets when 0x050A has not returned.');
}

const rwHrvAppRealtimeKeyStore = {
  ...rwHrvCompatKeyOnlyStore,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'hrv',
      key: 0x0269,
      flag: 0x10,
      value: 46,
      timestamp: 1710000007010
    }
  ]
};
if (getLatestHrvReading(rwHrvAppRealtimeKeyStore)?.heartRateVariability !== 46) {
  throw new Error('RW HRV should accept APP realtime 0x0269 read packets.');
}

const rwSubmitMacFromDeviceId = getSubmitDeviceMac(
  {
    deviceInfo: {
      protocol: 'rw',
      deviceId: '3E:00:00:00:05:1B'
    }
  },
  false
);
if (rwSubmitMacFromDeviceId !== '3E:00:00:00:05:1B') {
  throw new Error(`RW submit MAC should fall back to a colon-separated deviceId: ${rwSubmitMacFromDeviceId}`);
}

const activeMeasureStartedAt = 1710000100000;
const historicalPacketDuringActiveMeasure = {
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'heart_rate',
      key: 0x0503,
      value: 74,
      data: [0x31, 0xe2, 0xaa, 0x45, 0x4a, 0x00],
      timestamp: activeMeasureStartedAt + 100,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ],
  healthData: {},
  latestMetrics: {},
  deviceInfo: {
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B'
  }
};

if (getLatestHeartRateReading(historicalPacketDuringActiveMeasure, activeMeasureStartedAt) !== undefined) {
  throw new Error('RW active measurement must not accept a late 0x0503 historical record as realtime heart rate.');
}

const historicalKeyLatestDisplayStore = {
  ...historicalPacketDuringActiveMeasure,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'heart_rate',
      key: 0x0503,
      value: 188,
      data: [0x31, 0xe2, 0xaa, 0x45, 188, 0x00],
      timestamp: activeMeasureStartedAt + 100,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    },
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'blood_oxygen',
      key: 0x0509,
      value: 99,
      data: [0x31, 0xe2, 0xaa, 0x45, 99, 0x00],
      timestamp: activeMeasureStartedAt + 110,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    },
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'temperature',
      key: 0x0508,
      value: 36.7,
      data: [0x31, 0xe2, 0xaa, 0x45, 0x56, 0x0e],
      timestamp: activeMeasureStartedAt + 120,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ],
  healthData: {},
  latestMetrics: {}
};

if (
  getLatestHeartRateReading(historicalKeyLatestDisplayStore) ||
  getLatestSpo2Reading(historicalKeyLatestDisplayStore) ||
  getLatestTemperatureReading(historicalKeyLatestDisplayStore)
) {
  throw new Error('RW latest-value display must not accept 0x05xx historical packets as realtime vitals.');
}

const noCrcRealtimePacketStore = {
  ...historicalPacketDuringActiveMeasure,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'heart_rate',
      key: 0x0503,
      flag: 0x10,
      data: [73],
      timestamp: activeMeasureStartedAt + 200,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    },
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'blood_oxygen',
      key: 0x0509,
      flag: 0x10,
      value: 98,
      data: [98],
      timestamp: activeMeasureStartedAt + 210,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ]
};

if (
  getLatestHeartRateReading(noCrcRealtimePacketStore, activeMeasureStartedAt)?.heartRate !== 73 ||
  getLatestSpo2Reading(noCrcRealtimePacketStore, activeMeasureStartedAt)?.bloodOxygen !== 98
) {
  throw new Error('RW foreground metric helpers should accept v150 no-CRC 0x05xx short realtime packets.');
}

const pendingRefreshWithCachedMetrics = {
  receivedData: [
    {
      type: 'rw_health_data_pending',
      protocol: 'rw',
      name: 'heart_rate',
      status: 'pending',
      timestamp: activeMeasureStartedAt + 200,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ],
  healthData: {
    heartRate: 188,
    bloodOxygen: 88,
    temperature: 36.6,
    hrv: 66,
    stress: 44,
    bloodSugar: 6.6,
    bloodPressure: { systolic: 131, diastolic: 91 },
    lastMetricUpdateAt: activeMeasureStartedAt + 300
  },
  latestMetrics: {
    heartRate: 188,
    bloodOxygen: 88,
    temperature: 36.6,
    hrv: 66,
    stress: 44,
    bloodSugar: 6.6,
    bloodPressure: { systolic: 131, diastolic: 91 }
  },
  lastMetricUpdateAt: activeMeasureStartedAt + 300,
  deviceInfo: {
    protocol: 'rw',
    deviceId: '3E:00:00:00:05:1B',
    mac: '3E:00:00:00:05:1B'
  }
};

if (
  getLatestHeartRateReading(pendingRefreshWithCachedMetrics, activeMeasureStartedAt) ||
  getLatestSpo2Reading(pendingRefreshWithCachedMetrics, activeMeasureStartedAt) ||
  getLatestTemperatureReading(pendingRefreshWithCachedMetrics, activeMeasureStartedAt) ||
  getLatestHrvReading(pendingRefreshWithCachedMetrics, activeMeasureStartedAt) ||
  getLatestStressReading(pendingRefreshWithCachedMetrics, activeMeasureStartedAt) ||
  getLatestBloodSugarReading(pendingRefreshWithCachedMetrics, activeMeasureStartedAt) ||
  getLatestBloodPressureReading(pendingRefreshWithCachedMetrics, activeMeasureStartedAt)
) {
  throw new Error('RW foreground measurement must not submit cached metrics when only pending data arrived after measurement started.');
}

if (
  getLatestHeartRateReading(pendingRefreshWithCachedMetrics)?.heartRate !== 188 ||
  getLatestSpo2Reading(pendingRefreshWithCachedMetrics)?.bloodOxygen !== 88 ||
  getLatestTemperatureReading(pendingRefreshWithCachedMetrics)?.temperature !== 36.6
) {
  throw new Error('RW cached metric fallback should still work for ordinary latest-value display without a foreground measurement timestamp.');
}

const realtimePacketWithoutFlattenedValue = {
  ...historicalPacketDuringActiveMeasure,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'heart_rate',
      key: 0x0224,
      data: [0x31, 0xe2, 0xaa, 0x40, 73, 0x00],
      timestamp: activeMeasureStartedAt + 200,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ]
};
const realtimeReadingWithoutFlattenedValue = getLatestHeartRateReading(
  realtimePacketWithoutFlattenedValue,
  activeMeasureStartedAt
);
if (realtimeReadingWithoutFlattenedValue?.heartRate !== 73) {
  throw new Error(
    `RW metric fallback should read the confirmed value offset instead of a timestamp byte: ${JSON.stringify(
      realtimeReadingWithoutFlattenedValue
    )}`
  );
}

const realtimePacketWithNestedTimestamp = {
  ...historicalPacketDuringActiveMeasure,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'heart_rate',
      key: 0x0224,
      value: 72,
      metrics: {
        unixTime: Math.floor((activeMeasureStartedAt + 1000) / 1000)
      },
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    },
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'blood_oxygen',
      key: 0x024e,
      value: 98,
      raw: {
        recordTime: formatMetricRecordTime(activeMeasureStartedAt + 1500)
      },
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ]
};

if (
  getLatestHeartRateReading(realtimePacketWithNestedTimestamp, activeMeasureStartedAt)?.heartRate !== 72 ||
  getLatestSpo2Reading(realtimePacketWithNestedTimestamp, activeMeasureStartedAt)?.bloodOxygen !== 98
) {
  throw new Error('RW foreground metric helpers should accept metrics/raw nested realtime timestamps just like the foreground measurement waiter.');
}

const ackOnlyMetricStore = {
  ...historicalPacketDuringActiveMeasure,
  receivedData: [
    { type: 'rw_health_data_ack', protocol: 'rw', name: 'hrv', key: 0x050a, timestamp: activeMeasureStartedAt + 1 },
    { type: 'rw_health_data_ack', protocol: 'rw', name: 'stress', key: 0x050d, timestamp: activeMeasureStartedAt + 2 },
    { type: 'rw_health_data_ack', protocol: 'rw', name: 'blood_sugar', key: 0x0510, timestamp: activeMeasureStartedAt + 3 },
    { type: 'rw_health_data_ack', protocol: 'rw', name: 'blood_pressure', key: 0x0504, timestamp: activeMeasureStartedAt + 4 }
  ]
};
if (
  getLatestHrvReading(ackOnlyMetricStore, activeMeasureStartedAt) !== undefined ||
  getLatestStressReading(ackOnlyMetricStore, activeMeasureStartedAt) !== undefined ||
  getLatestBloodSugarReading(ackOnlyMetricStore, activeMeasureStartedAt) !== undefined ||
  getLatestBloodPressureReading(ackOnlyMetricStore, activeMeasureStartedAt) !== undefined
) {
  throw new Error('RW 0x05xx ACK-only packets must not become visible health values.');
}

const heartRateOnlyStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'rw_health_data',
      name: 'heart_rate',
      value: 70,
      timestamp: 1710000000500
    }
  ],
  healthData: {
    lastMetricUpdateAt: 1710000000500
  }
};
const heartRateOnly = getLatestHeartRateReading(heartRateOnlyStore);
if (
  heartRateOnly?.heartRate !== 70 ||
  heartRateOnly?.stressIndex !== undefined ||
  heartRateOnly?.heartRateVariability !== undefined
) {
  throw new Error(`RW heart-rate helper should not invent missing stress or HRV values: ${JSON.stringify(heartRateOnly)}`);
}

const heartRateWithStaleVitalsStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'rw_health_data',
      name: 'heart_rate',
      value: 71,
      timestamp: 1710000009000
    }
  ],
  healthData: {
    heartRateVariability: 41,
    stressIndex: 27,
    lastMetricUpdateAt: 1710000000500
  }
};
const heartRateWithStaleVitals = getLatestHeartRateReading(heartRateWithStaleVitalsStore, 1710000008000);
if (
  heartRateWithStaleVitals?.heartRate !== 71 ||
  heartRateWithStaleVitals?.stressIndex !== undefined ||
  heartRateWithStaleVitals?.heartRateVariability !== undefined
) {
  throw new Error(`RW heart-rate helper should not mix a fresh heart rate with stale HRV or stress: ${JSON.stringify(heartRateWithStaleVitals)}`);
}

const heartRateWithFreshVitalsStore = {
  ...heartRateWithStaleVitalsStore,
  receivedData: [
    ...heartRateWithStaleVitalsStore.receivedData,
    {
      type: 'rw_health_data',
      name: 'hrv',
      value: 47,
      timestamp: 1710000009010
    },
    {
      type: 'rw_health_data',
      name: 'stress',
      value: 30,
      timestamp: 1710000009020
    }
  ]
};
const heartRateWithFreshVitals = getLatestHeartRateReading(heartRateWithFreshVitalsStore, 1710000008000);
if (
  heartRateWithFreshVitals?.heartRate !== 71 ||
  heartRateWithFreshVitals?.heartRateVariability !== 47 ||
  heartRateWithFreshVitals?.stressIndex !== 30
) {
  throw new Error(`RW heart-rate helper should include HRV and stress only when they are fresh in the same measurement window: ${JSON.stringify(heartRateWithFreshVitals)}`);
}

const spo2 = getLatestSpo2Reading(rwStore);
if (spo2?.bloodOxygen !== 99) {
  throw new Error(`RW SpO2 should be readable through unified metric helper: ${JSON.stringify(spo2)}`);
}

const invalidRwSpo2Store = {
  ...rwStore,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'blood_oxygen',
      key: 0x024e,
      value: 46,
      timestamp: 1710000006045,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ],
  healthData: {},
  latestMetrics: {}
};

if (getLatestSpo2Reading(invalidRwSpo2Store)) {
  throw new Error('RW SpO2 helper should reject implausible 46% realtime values before the detail page displays them.');
}

const invalidLegacySpo2Store = {
  ...rwStore,
  receivedData: [
    {
      type: 'active_OxyGenMeasure',
      bloodOxygen: '46%',
      timestamp: 1710000006046
    }
  ],
  healthData: {},
  latestMetrics: {}
};

if (getLatestSpo2Reading(invalidLegacySpo2Store)) {
  throw new Error('Legacy SpO2 helper should reject implausible 46% values before old detail pages display them.');
}

const invalidCachedSpo2Store = {
  ...rwStore,
  receivedData: [],
  healthData: {
    bloodOxygen: 46,
    lastMetricUpdateAt: 1710000006047
  },
  latestMetrics: {
    spo2: 46
  }
};

if (getLatestSpo2Reading(invalidCachedSpo2Store)) {
  throw new Error('RW SpO2 helper should reject cached 46% values from healthData/latestMetrics.');
}

const rwSpo2DirectInvalidDataValidStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'blood_oxygen',
      key: 0x024e,
      value: 46,
      data: [98],
      timestamp: 1710000006048,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ],
  healthData: {},
  latestMetrics: {}
};

if (getLatestSpo2Reading(rwSpo2DirectInvalidDataValidStore)?.bloodOxygen !== 98) {
  throw new Error('RW SpO2 helper should ignore an invalid flattened value when the raw data carries a valid value.');
}

const invalidRwSpo2DataStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      name: 'blood_oxygen',
      key: 0x024e,
      data: [0x11, 46],
      timestamp: 1710000006049,
      deviceId: '3E:00:00:00:05:1B',
      mac: '3E:00:00:00:05:1B'
    }
  ],
  healthData: {},
  latestMetrics: {}
};

if (getLatestSpo2Reading(invalidRwSpo2DataStore)) {
  throw new Error('RW SpO2 helper should reject 46% values decoded from status-prefixed data arrays.');
}

const temperature = getLatestTemperatureReading(rwStore);
if (temperature?.temperature !== 36.5) {
  throw new Error(`Invalid RW temperature packets should be ignored and valid healthData fallback used: ${JSON.stringify(temperature)}`);
}

const legacyTemperatureValueOnlyStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'active_Temperature',
      temperatureValue: '36.8 C',
      timestamp: 1710000006035
    }
  ],
  healthData: {}
};

const legacyTemperatureValueOnly = getLatestTemperatureReading(legacyTemperatureValueOnlyStore);
if (legacyTemperatureValueOnly?.temperature !== 36.8) {
  throw new Error(`L19-compatible temperatureValue-only packets should still expose temperature: ${JSON.stringify(legacyTemperatureValueOnly)}`);
}

const rwTemperatureValueFallbackStore = {
  ...rwStore,
  receivedData: [],
  healthData: {
    bodyTemperatureValue: '36.9 C',
    lastMetricUpdateAt: 1710000006040
  }
};

const rwTemperatureValueFallback = getLatestTemperatureReading(rwTemperatureValueFallbackStore);
if (rwTemperatureValueFallback?.temperature !== 36.9) {
  throw new Error(`RW temperature value aliases should be readable through unified metric helper: ${JSON.stringify(rwTemperatureValueFallback)}`);
}

const lowTemperatureStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'rw_health_data',
      name: 'temperature',
      value: 20.5,
      timestamp: 1710000002000
    }
  ],
  healthData: {
    ...rwStore.healthData,
    temperature: 20.5
  }
};

if (getLatestTemperatureReading(lowTemperatureStore)) {
  throw new Error('Body temperature helper should reject values below the shared 25-45°C business range.');
}

const hrv = getLatestHrvReading(rwStore);
if (hrv?.heartRateVariability !== 45) {
  throw new Error(`RW HRV should be readable through unified metric helper: ${JSON.stringify(hrv)}`);
}

const stress = getLatestStressReading(rwStore);
if (stress?.stressIndex !== 31 || stress.stress !== 31) {
  throw new Error(`RW stress should be readable through unified metric helper: ${JSON.stringify(stress)}`);
}

const bloodSugar = getLatestBloodSugarReading(rwStore);
if (bloodSugar?.bloodSugar !== 5.8 || bloodSugar.glucose !== 5.8) {
  throw new Error(`RW blood sugar should be readable through unified metric helper: ${JSON.stringify(bloodSugar)}`);
}

const bloodPressure = getLatestBloodPressureReading(rwStore);
if (bloodPressure?.systolic !== 120 || bloodPressure.diastolic !== 79) {
  throw new Error(`RW blood pressure should be readable through unified metric helper: ${JSON.stringify(bloodPressure)}`);
}

const legacyUnitStringStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'active_measure',
      heartRate: '73 bpm',
      heartRateVariability: '48 ms',
      stressIndex: '31 level',
      timestamp: 1710000006010
    },
    {
      type: 'active_OxyGenMeasure',
      bloodOxygen: '98%',
      timestamp: 1710000006020
    },
    {
      type: 'active_Temperature',
      temperature: '36.6 C',
      timestamp: 1710000006030
    }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(legacyUnitStringStore)?.heartRate !== 73 ||
  getLatestHrvReading(legacyUnitStringStore)?.heartRateVariability !== 48 ||
  getLatestStressReading(legacyUnitStringStore)?.stressIndex !== 31 ||
  getLatestSpo2Reading(legacyUnitStringStore)?.bloodOxygen !== 98 ||
  getLatestTemperatureReading(legacyUnitStringStore)?.temperature !== 36.6
) {
  throw new Error(`Legacy/L19 unit strings should be normalized before old pages submit them: ${JSON.stringify({
    heartRate: getLatestHeartRateReading(legacyUnitStringStore),
    hrv: getLatestHrvReading(legacyUnitStringStore),
    stress: getLatestStressReading(legacyUnitStringStore),
    spo2: getLatestSpo2Reading(legacyUnitStringStore),
    temperature: getLatestTemperatureReading(legacyUnitStringStore)
  })}`);
}

const rwUnitStringMetricStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', value: '72 bpm', timestamp: 1710000006050 },
    { type: 'rw_health_data', name: 'blood_oxygen', value: '98%', timestamp: 1710000006060 },
    { type: 'rw_health_data', name: 'temperature', value: '36.7°C', timestamp: 1710000006070 },
    { type: 'rw_health_data', name: 'hrv', value: '47 ms', timestamp: 1710000006080 },
    { type: 'rw_health_data', name: 'stress', value: '30 level', timestamp: 1710000006090 },
    { type: 'rw_health_data', name: 'blood_sugar', value: '6 mmol/L', timestamp: 1710000006095 }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(rwUnitStringMetricStore)?.heartRate !== 72 ||
  getLatestSpo2Reading(rwUnitStringMetricStore)?.bloodOxygen !== 98 ||
  getLatestTemperatureReading(rwUnitStringMetricStore)?.temperature !== 36.7 ||
  getLatestHrvReading(rwUnitStringMetricStore)?.heartRateVariability !== 47 ||
  getLatestStressReading(rwUnitStringMetricStore)?.stressIndex !== 30 ||
  getLatestBloodSugarReading(rwUnitStringMetricStore)?.bloodSugar !== 6 ||
  toMetricNumber('121/80') !== null
) {
  throw new Error(`RW realtime unit strings should be readable without treating blood pressure strings as scalar values: ${JSON.stringify({
    heartRate: getLatestHeartRateReading(rwUnitStringMetricStore),
    spo2: getLatestSpo2Reading(rwUnitStringMetricStore),
    temperature: getLatestTemperatureReading(rwUnitStringMetricStore),
    hrv: getLatestHrvReading(rwUnitStringMetricStore),
    stress: getLatestStressReading(rwUnitStringMetricStore),
    bloodSugar: getLatestBloodSugarReading(rwUnitStringMetricStore),
    bloodPressureScalar: toMetricNumber('121/80')
  })}`);
}

const rwDataArrayMetricStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', data: [0x31, 72], timestamp: 1710000006100 },
    { type: 'rw_health_data', name: 'blood_oxygen', data: [98], timestamp: 1710000006110 },
    { type: 'rw_health_data', name: 'temperature', data: [0x51, 0x0e], timestamp: 1710000006120 },
    { type: 'rw_health_data', name: 'hrv', data: [47], timestamp: 1710000006130 },
    { type: 'rw_health_data', name: 'stress', data: [30], timestamp: 1710000006140 },
    { type: 'rw_health_data', name: 'blood_sugar', data: [6], timestamp: 1710000006150 }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(rwDataArrayMetricStore)?.heartRate !== 72 ||
  getLatestSpo2Reading(rwDataArrayMetricStore)?.bloodOxygen !== 98 ||
  getLatestTemperatureReading(rwDataArrayMetricStore)?.temperature !== 36.65 ||
  getLatestHrvReading(rwDataArrayMetricStore)?.heartRateVariability !== 47 ||
  getLatestStressReading(rwDataArrayMetricStore)?.stressIndex !== 30 ||
  getLatestBloodSugarReading(rwDataArrayMetricStore)?.bloodSugar !== 6
) {
  throw new Error(`RW realtime data byte arrays should be readable as L19-compatible readings: ${JSON.stringify({
    heartRate: getLatestHeartRateReading(rwDataArrayMetricStore),
    spo2: getLatestSpo2Reading(rwDataArrayMetricStore),
    temperature: getLatestTemperatureReading(rwDataArrayMetricStore),
    hrv: getLatestHrvReading(rwDataArrayMetricStore),
    stress: getLatestStressReading(rwDataArrayMetricStore),
    bloodSugar: getLatestBloodSugarReading(rwDataArrayMetricStore)
  })}`);
}

const rwScaledBloodSugarMetricStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'blood_sugar', value: 58, timestamp: 1710000006155 },
    { type: 'rw_health_data', name: 'blood_sugar', data: [0x11, 58], timestamp: 1710000006160 }
  ],
  healthData: {}
};

if (getLatestBloodSugarReading(rwScaledBloodSugarMetricStore)?.bloodSugar !== 5.8) {
  throw new Error(`RW raw blood sugar bytes should be displayed as mmol/L values: ${JSON.stringify({
    bloodSugar: getLatestBloodSugarReading(rwScaledBloodSugarMetricStore)
  })}`);
}

const rwStatusPrefixedArrayMetricStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', data: [0x11, 72], timestamp: 1710000006160 },
    { type: 'rw_health_data', name: 'blood_oxygen', data: [0x11, 98], timestamp: 1710000006170 },
    { type: 'rw_health_data', name: 'temperature', data: [0x11, 0x72, 0x01], timestamp: 1710000006180 },
    { type: 'rw_health_data', name: 'blood_pressure', data: [0x11, 120, 80], timestamp: 1710000006190 }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(rwStatusPrefixedArrayMetricStore)?.heartRate !== 72 ||
  getLatestSpo2Reading(rwStatusPrefixedArrayMetricStore)?.bloodOxygen !== 98 ||
  getLatestTemperatureReading(rwStatusPrefixedArrayMetricStore)?.temperature !== 37 ||
  getLatestBloodPressureReading(rwStatusPrefixedArrayMetricStore)?.systolic !== 120 ||
  getLatestBloodPressureReading(rwStatusPrefixedArrayMetricStore)?.diastolic !== 80
) {
  throw new Error(`RW compact status-prefixed realtime arrays should expose the real value after the status byte: ${JSON.stringify({
    heartRate: getLatestHeartRateReading(rwStatusPrefixedArrayMetricStore),
    spo2: getLatestSpo2Reading(rwStatusPrefixedArrayMetricStore),
    temperature: getLatestTemperatureReading(rwStatusPrefixedArrayMetricStore),
    bloodPressure: getLatestBloodPressureReading(rwStatusPrefixedArrayMetricStore)
  })}`);
}

const rwStatusOnlyArrayMetricStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', data: [0x31], timestamp: 1710000006200 },
    { type: 'rw_health_data', name: 'blood_oxygen', data: [0x31], timestamp: 1710000006210 },
    { type: 'rw_health_data', name: 'temperature', data: [0x31], timestamp: 1710000006220 },
    { type: 'rw_health_data', name: 'hrv', data: [0x31], timestamp: 1710000006230 },
    { type: 'rw_health_data', name: 'stress', data: [0x31], timestamp: 1710000006240 },
    { type: 'rw_health_data', name: 'blood_sugar', data: [0x31], timestamp: 1710000006250 }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(rwStatusOnlyArrayMetricStore) ||
  getLatestSpo2Reading(rwStatusOnlyArrayMetricStore) ||
  getLatestTemperatureReading(rwStatusOnlyArrayMetricStore) ||
  getLatestHrvReading(rwStatusOnlyArrayMetricStore) ||
  getLatestStressReading(rwStatusOnlyArrayMetricStore) ||
  getLatestBloodSugarReading(rwStatusOnlyArrayMetricStore)
) {
  throw new Error('RW realtime status-only byte arrays should not be treated as valid measurement values.');
}

const rwInvalidDirectMetricStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', value: 72, timestamp: 1710000006300 },
    { type: 'rw_health_data', name: 'heart_rate', value: 0x31, timestamp: 1710000006310 },
    { type: 'rw_health_data', name: 'heart_rate', value: 241, timestamp: 1710000006320 },
    { type: 'rw_health_data', name: 'hrv', value: 47, timestamp: 1710000006330 },
    { type: 'rw_health_data', name: 'hrv', value: -1, timestamp: 1710000006340 },
    { type: 'rw_health_data', name: 'stress', value: 30, timestamp: 1710000006350 },
    { type: 'rw_health_data', name: 'stress', value: 188, timestamp: 1710000006360 }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(rwInvalidDirectMetricStore)?.heartRate !== 72 ||
  getLatestHrvReading(rwInvalidDirectMetricStore)?.heartRateVariability !== 47 ||
  getLatestStressReading(rwInvalidDirectMetricStore)?.stressIndex !== 30
) {
  throw new Error(`RW direct realtime values should ignore invalid newer values and keep the latest valid reading: ${JSON.stringify({
    heartRate: getLatestHeartRateReading(rwInvalidDirectMetricStore),
    hrv: getLatestHrvReading(rwInvalidDirectMetricStore),
    stress: getLatestStressReading(rwInvalidDirectMetricStore)
  })}`);
}

const rwInvalidDirectOnlyMetricStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', value: 0x31, timestamp: 1710000006370 },
    { type: 'rw_health_data', name: 'heart_rate', value: 241, timestamp: 1710000006380 },
    { type: 'rw_health_data', name: 'hrv', value: 0, timestamp: 1710000006390 },
    { type: 'rw_health_data', name: 'stress', value: 188, timestamp: 1710000006400 }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(rwInvalidDirectOnlyMetricStore) ||
  getLatestHrvReading(rwInvalidDirectOnlyMetricStore) ||
  getLatestStressReading(rwInvalidDirectOnlyMetricStore)
) {
  throw new Error('RW direct realtime values should reject status bytes and out-of-range values when no valid reading exists.');
}

const rwArrayBloodPressureStore = {
  ...rwStore,
  receivedData: [
    {
      type: 'rw_health_data',
      name: 'blood_pressure',
      data: [119, 77],
      timestamp: 1710000006500
    }
  ],
  healthData: {}
};
const rwArrayBloodPressure = getLatestBloodPressureReading(rwArrayBloodPressureStore);
if (rwArrayBloodPressure?.systolic !== 119 || rwArrayBloodPressure.diastolic !== 77) {
  throw new Error(`RW blood pressure byte pairs should be readable as L19-compatible readings: ${JSON.stringify(rwArrayBloodPressure)}`);
}

const rwValueArrayBloodPressureStore = {
  ...rwArrayBloodPressureStore,
  receivedData: [
    {
      type: 'rw_health_data',
      name: 'blood_pressure',
      value: [123, 81],
      timestamp: 1710000006600
    }
  ]
};
const rwValueArrayBloodPressure = getLatestBloodPressureReading(rwValueArrayBloodPressureStore);
if (rwValueArrayBloodPressure?.systolic !== 123 || rwValueArrayBloodPressure.diastolic !== 81) {
  throw new Error(`RW blood pressure value arrays should be readable as L19-compatible readings: ${JSON.stringify(rwValueArrayBloodPressure)}`);
}

const rwAliasObjectBloodPressureStore = {
  ...rwArrayBloodPressureStore,
  receivedData: [
    {
      type: 'rw_health_data',
      name: 'blood_pressure',
      value: {
        bloodPressureHigh: '124 mmHg',
        bloodPressureLow: '82 mmHg'
      },
      timestamp: 1710000006650
    }
  ]
};
const rwAliasObjectBloodPressure = getLatestBloodPressureReading(rwAliasObjectBloodPressureStore);
if (rwAliasObjectBloodPressure?.systolic !== 124 || rwAliasObjectBloodPressure.diastolic !== 82) {
  throw new Error(`RW blood pressure object aliases should be readable as L19-compatible readings: ${JSON.stringify(rwAliasObjectBloodPressure)}`);
}

const rwFallbackVitalsStore = {
  ...rwStore,
  receivedData: [],
  healthData: {
    ...rwStore.healthData,
    lastMetricUpdateAt: 1710000007000
  }
};

if (
  getLatestHrvReading(rwFallbackVitalsStore)?.heartRateVariability !== 42 ||
  getLatestStressReading(rwFallbackVitalsStore)?.stressIndex !== 28 ||
  getLatestBloodSugarReading(rwFallbackVitalsStore)?.bloodSugar !== 5.6 ||
  getLatestBloodPressureReading(rwFallbackVitalsStore)?.systolic !== 118 ||
  getLatestBloodPressureReading(rwFallbackVitalsStore)?.diastolic !== 76
) {
  throw new Error(`Metric helpers should fall back to unified healthData for RW passive vitals: ${JSON.stringify(rwFallbackVitalsStore)}`);
}

const rwAliasFallbackVitalsStore = {
  ...rwStore,
  receivedData: [],
  healthData: {
    bloodPressureHigh: '117 mmHg',
    bloodPressureLow: '75 mmHg',
    lastMetricUpdateAt: 1710000007100
  }
};
if (
  getLatestBloodPressureReading(rwAliasFallbackVitalsStore)?.systolic !== 117 ||
  getLatestBloodPressureReading(rwAliasFallbackVitalsStore)?.diastolic !== 75
) {
  throw new Error(`Metric helpers should read RW/L19 blood pressure high/low aliases from unified healthData: ${JSON.stringify(rwAliasFallbackVitalsStore)}`);
}

const sinceAfterExistingData = 1710000008000;
if (
  getLatestHeartRateReading(rwStore, sinceAfterExistingData) ||
  getLatestSpo2Reading(rwStore, sinceAfterExistingData) ||
  getLatestTemperatureReading(rwStore, sinceAfterExistingData) ||
  getLatestHrvReading(rwStore, sinceAfterExistingData) ||
  getLatestStressReading(rwStore, sinceAfterExistingData) ||
  getLatestBloodSugarReading(rwStore, sinceAfterExistingData) ||
  getLatestBloodPressureReading(rwStore, sinceAfterExistingData)
) {
  throw new Error('Metric helpers should not treat old values as a new active measurement result.');
}

const rwStatusOnlyWithStaleCache = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', timestamp: 1710000009000 },
    { type: 'rw_health_data', name: 'blood_oxygen', timestamp: 1710000009001 },
    { type: 'rw_health_data', name: 'temperature', value: 0.59, timestamp: 1710000009002 },
    { type: 'rw_health_data', name: 'hrv', timestamp: 1710000009003 },
    { type: 'rw_health_data', name: 'stress', timestamp: 1710000009004 },
    { type: 'rw_health_data', name: 'blood_sugar', timestamp: 1710000009005 },
    { type: 'rw_health_data', name: 'blood_pressure', timestamp: 1710000009006 }
  ],
  healthData: {
    heartRate: 68,
    bloodOxygen: 99,
    temperature: 36.5,
    hrv: 42,
    stressIndex: 28,
    bloodSugar: 5.6,
    bloodPressure: {
      systolic: 118,
      diastolic: 76
    },
    lastMetricUpdateAt: 1710000006000
  }
};

if (
  getLatestHeartRateReading(rwStatusOnlyWithStaleCache, sinceAfterExistingData) ||
  getLatestSpo2Reading(rwStatusOnlyWithStaleCache, sinceAfterExistingData) ||
  getLatestTemperatureReading(rwStatusOnlyWithStaleCache, sinceAfterExistingData) ||
  getLatestHrvReading(rwStatusOnlyWithStaleCache, sinceAfterExistingData) ||
  getLatestStressReading(rwStatusOnlyWithStaleCache, sinceAfterExistingData) ||
  getLatestBloodSugarReading(rwStatusOnlyWithStaleCache, sinceAfterExistingData) ||
  getLatestBloodPressureReading(rwStatusOnlyWithStaleCache, sinceAfterExistingData)
) {
  throw new Error('RW status-only packets should not borrow stale cached values and count as a fresh measurement.');
}

const rwValidThenStatusStore = {
  ...rwStatusOnlyWithStaleCache,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', value: 72, timestamp: 1710000009000 },
    { type: 'rw_health_data', name: 'heart_rate', timestamp: 1710000009010 },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 98, timestamp: 1710000009020 },
    { type: 'rw_health_data', name: 'blood_oxygen', timestamp: 1710000009030 },
    { type: 'rw_health_data', name: 'temperature', value: 36.6, timestamp: 1710000009040 },
    { type: 'rw_health_data', name: 'temperature', value: 0.59, timestamp: 1710000009050 },
    { type: 'rw_health_data', name: 'hrv', value: 46, timestamp: 1710000009060 },
    { type: 'rw_health_data', name: 'hrv', timestamp: 1710000009070 },
    { type: 'rw_health_data', name: 'stress', value: 29, timestamp: 1710000009080 },
    { type: 'rw_health_data', name: 'stress', timestamp: 1710000009090 },
    { type: 'rw_health_data', name: 'blood_sugar', value: 5.7, timestamp: 1710000009100 },
    { type: 'rw_health_data', name: 'blood_sugar', timestamp: 1710000009110 },
    { type: 'rw_health_data', name: 'blood_pressure', value: { systolic: 121, diastolic: 78 }, timestamp: 1710000009120 },
    { type: 'rw_health_data', name: 'blood_pressure', timestamp: 1710000009130 }
  ]
};

if (
  getLatestHeartRateReading(rwValidThenStatusStore, sinceAfterExistingData)?.heartRate !== 72 ||
  getLatestSpo2Reading(rwValidThenStatusStore, sinceAfterExistingData)?.bloodOxygen !== 98 ||
  getLatestTemperatureReading(rwValidThenStatusStore, sinceAfterExistingData)?.temperature !== 36.6 ||
  getLatestHrvReading(rwValidThenStatusStore, sinceAfterExistingData)?.heartRateVariability !== 46 ||
  getLatestStressReading(rwValidThenStatusStore, sinceAfterExistingData)?.stressIndex !== 29 ||
  getLatestBloodSugarReading(rwValidThenStatusStore, sinceAfterExistingData)?.bloodSugar !== 5.7 ||
  getLatestBloodPressureReading(rwValidThenStatusStore, sinceAfterExistingData)?.systolic !== 121 ||
  getLatestBloodPressureReading(rwValidThenStatusStore, sinceAfterExistingData)?.diastolic !== 78
) {
  throw new Error('RW metric helpers should use the latest valid value even when a newer status-only packet arrives afterward.');
}

const freshStore = {
  ...rwStore,
  receivedData: [
    ...rwStore.receivedData,
    {
      type: 'rw_health_data',
      name: 'heart_rate',
      value: 72,
      timestamp: 1710000009000
    }
  ]
};

const freshHeartRate = getLatestHeartRateReading(freshStore, sinceAfterExistingData);
if (freshHeartRate?.heartRate !== 72) {
  throw new Error(`Metric helpers should accept values returned after measurement starts: ${JSON.stringify(freshHeartRate)}`);
}

const rwReceivedAtOnlyStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', value: 73, receivedAt: 1710000009000 },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 97, receivedAt: 1710000009010 },
    { type: 'rw_health_data', name: 'temperature', value: 36.7, receivedAt: 1710000009020 },
    { type: 'rw_health_data', name: 'hrv', value: 48, received_at: 1710000009030 },
    { type: 'rw_health_data', name: 'stress', value: 32, parsedAt: '2024-03-10T00:00:09.040+08:00' },
    { type: 'rw_health_data', name: 'blood_sugar', value: 5.9, receivedAt: 1710000009050 },
    { type: 'rw_health_data', name: 'blood_pressure', value: { systolic: 122, diastolic: 80 }, receivedAt: 1710000009060 }
  ]
};

if (
  getLatestHeartRateReading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.heartRate !== 73 ||
  getLatestSpo2Reading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.bloodOxygen !== 97 ||
  getLatestTemperatureReading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.temperature !== 36.7 ||
  getLatestHrvReading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.heartRateVariability !== 48 ||
  getLatestStressReading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.stressIndex !== 32 ||
  getLatestBloodSugarReading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.bloodSugar !== 5.9 ||
  getLatestBloodPressureReading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.systolic !== 122 ||
  getLatestBloodPressureReading(rwReceivedAtOnlyStore, sinceAfterExistingData)?.diastolic !== 80
) {
  throw new Error('RW metric helpers should treat receivedAt-only realtime packets as fresh L19-compatible measurement results.');
}

if (
  getLatestHeartRateReading(
    {
      ...rwStore,
      receivedData: [{ type: 'rw_health_data', name: 'heart_rate', value: 73, receivedAt: 1710000007000 }]
    },
    sinceAfterExistingData
  )
) {
  throw new Error('RW receivedAt-only metric packets older than the active measurement window should stay filtered.');
}

const rwAliasTimestampStore = {
  ...rwStore,
  receivedData: [
    { type: 'rw_health_data', name: 'heart_rate', value: 74, unixTime: 1710000009 },
    { type: 'rw_health_data', name: 'blood_oxygen', value: 96, startTimestamp: 1710000009010 },
    { type: 'rw_health_data', name: 'temperature', value: 36.8, recordTimestamp: 1710000009020 },
    { type: 'rw_health_data', name: 'hrv', value: 49, recordTime: '2024-03-10 00:00:09' },
    { type: 'rw_health_data', name: 'stress', value: 33, unixTime: '1710000009' },
    { type: 'rw_health_data', name: 'blood_sugar', value: 6.1, recordTime: '2024-03-10T00:00:09.050+08:00' },
    { type: 'rw_health_data', name: 'blood_pressure', value: { systolic: 123, diastolic: 81 }, startTimestamp: 1710000009060 }
  ],
  healthData: {}
};

if (
  getLatestHeartRateReading(rwAliasTimestampStore, sinceAfterExistingData)?.heartRate !== 74 ||
  getLatestSpo2Reading(rwAliasTimestampStore, sinceAfterExistingData)?.bloodOxygen !== 96 ||
  getLatestTemperatureReading(rwAliasTimestampStore, sinceAfterExistingData)?.temperature !== 36.8 ||
  getLatestHrvReading(rwAliasTimestampStore, sinceAfterExistingData)?.heartRateVariability !== 49 ||
  getLatestStressReading(rwAliasTimestampStore, sinceAfterExistingData)?.stressIndex !== 33 ||
  getLatestBloodSugarReading(rwAliasTimestampStore, sinceAfterExistingData)?.bloodSugar !== 6.1 ||
  getLatestBloodPressureReading(rwAliasTimestampStore, sinceAfterExistingData)?.systolic !== 123 ||
  getLatestBloodPressureReading(rwAliasTimestampStore, sinceAfterExistingData)?.diastolic !== 81
) {
  throw new Error('RW metric helpers should treat unixTime/startTimestamp/recordTime aliases as fresh measurement timestamps.');
}

if (
  getLatestHeartRateReading(
    {
      ...rwStore,
      receivedData: [{ type: 'rw_health_data', name: 'heart_rate', value: 74, unixTime: 1710000007 }]
    },
    sinceAfterExistingData
  )
) {
  throw new Error('RW unixTime metric packets older than the active measurement window should stay filtered.');
}

const rwIdentityScopedMetricStore = {
  ...rwStore,
  deviceInfo: {
    protocol: 'rw',
    deviceId: 'rw-current-platform-id',
    mac: '3E:00:00:00:05:1B'
  },
  receivedData: [
    { type: 'rw_health_data', protocol: 'rw', mac: '3E:00:00:00:05:1B', name: 'heart_rate', value: 74, timestamp: 1710000010000 },
    { type: 'rw_health_data', protocol: 'rw', mac: '3E:00:00:00:05:1B', name: 'blood_oxygen', value: 96, timestamp: 1710000010010 },
    { type: 'rw_health_data', protocol: 'rw', mac: '3E:00:00:00:05:1B', name: 'temperature', value: 36.8, timestamp: 1710000010020 },
    { type: 'rw_health_data', protocol: 'rw', mac: '3E:00:00:00:05:1B', name: 'hrv', value: 49, timestamp: 1710000010030 },
    { type: 'rw_health_data', protocol: 'rw', mac: '3E:00:00:00:05:1B', name: 'stress', value: 33, timestamp: 1710000010040 },
    { type: 'rw_health_data', protocol: 'rw', mac: '3E:00:00:00:05:1B', name: 'blood_sugar', value: 6.1, timestamp: 1710000010050 },
    {
      type: 'rw_health_data',
      protocol: 'rw',
      mac: '3E:00:00:00:05:1B',
      name: 'blood_pressure',
      value: { systolic: 123, diastolic: 81 },
      timestamp: 1710000010060
    },
    { type: 'active_measure', protocol: 'legacy', mac: '3E:00:00:00:05:1B', heartRate: 199, heartRateVariability: 199, stressIndex: 199, timestamp: 1710000019000 },
    { type: 'active_OxyGenMeasure', protocol: 'legacy', mac: '3E:00:00:00:05:1B', bloodOxygen: 100, timestamp: 1710000019010 },
    { type: 'active_Temperature', protocol: 'legacy', mac: '3E:00:00:00:05:1B', temperature: 39.9, timestamp: 1710000019020 },
    { type: 'rw_health_data', protocol: 'rw', mac: 'AA:BB:CC:DD:EE:FF', name: 'heart_rate', value: 188, timestamp: 1710000019030 },
    { type: 'rw_health_data', protocol: 'rw', mac: 'AA:BB:CC:DD:EE:FF', name: 'blood_oxygen', value: 100, timestamp: 1710000019040 },
    { type: 'rw_health_data', protocol: 'rw', mac: 'AA:BB:CC:DD:EE:FF', name: 'temperature', value: 39.8, timestamp: 1710000019050 },
    { type: 'rw_health_data', protocol: 'rw', mac: 'AA:BB:CC:DD:EE:FF', name: 'hrv', value: 188, timestamp: 1710000019060 },
    { type: 'rw_health_data', protocol: 'rw', mac: 'AA:BB:CC:DD:EE:FF', name: 'stress', value: 188, timestamp: 1710000019070 },
    { type: 'rw_health_data', protocol: 'rw', mac: 'AA:BB:CC:DD:EE:FF', name: 'blood_sugar', value: 9.9, timestamp: 1710000019080 },
    {
      type: 'rw_health_data',
      protocol: 'rw',
      mac: 'AA:BB:CC:DD:EE:FF',
      name: 'blood_pressure',
      value: { systolic: 188, diastolic: 99 },
      timestamp: 1710000019090
    }
  ]
};

if (
  getLatestHeartRateReading(rwIdentityScopedMetricStore)?.heartRate !== 74 ||
  getLatestSpo2Reading(rwIdentityScopedMetricStore)?.bloodOxygen !== 96 ||
  getLatestTemperatureReading(rwIdentityScopedMetricStore)?.temperature !== 36.8 ||
  getLatestHrvReading(rwIdentityScopedMetricStore)?.heartRateVariability !== 49 ||
  getLatestStressReading(rwIdentityScopedMetricStore)?.stressIndex !== 33 ||
  getLatestBloodSugarReading(rwIdentityScopedMetricStore)?.bloodSugar !== 6.1 ||
  getLatestBloodPressureReading(rwIdentityScopedMetricStore)?.systolic !== 123 ||
  getLatestBloodPressureReading(rwIdentityScopedMetricStore)?.diastolic !== 81
) {
  throw new Error(`Metric helpers should ignore conflicting-protocol and other-device readings before choosing latest values: ${JSON.stringify({
    heartRate: getLatestHeartRateReading(rwIdentityScopedMetricStore),
    spo2: getLatestSpo2Reading(rwIdentityScopedMetricStore),
    temperature: getLatestTemperatureReading(rwIdentityScopedMetricStore),
    hrv: getLatestHrvReading(rwIdentityScopedMetricStore),
    stress: getLatestStressReading(rwIdentityScopedMetricStore),
    bloodSugar: getLatestBloodSugarReading(rwIdentityScopedMetricStore),
    bloodPressure: getLatestBloodPressureReading(rwIdentityScopedMetricStore)
  })}`);
}

const rwRandomIdentityOnlyMetricStore = {
  ...rwStore,
  deviceInfo: {
    protocol: 'rw',
    deviceId: 'wechat-random-current',
    uniMacId: 'B09FBA121E1C'
  },
  receivedData: [
    {
      type: 'rw_health_data',
      protocol: 'rw',
      deviceId: 'wechat-random-current',
      uniMacId: 'B09FBA121E1C',
      name: 'heart_rate',
      value: 188,
      timestamp: 1710000020000
    }
  ],
  healthData: {}
};

if (getLatestHeartRateReading(rwRandomIdentityOnlyMetricStore)) {
  throw new Error('RW metric helpers should not match random platform identifiers as current-device measurement identity.');
}

const rwUntaggedMetricStore = {
  ...rwRandomIdentityOnlyMetricStore,
  receivedData: [{ type: 'rw_health_data', protocol: 'rw', name: 'heart_rate', value: 75, timestamp: 1710000020100 }]
};

if (getLatestHeartRateReading(rwUntaggedMetricStore)?.heartRate !== 75) {
  throw new Error('RW metric helpers should still accept untagged current-connection packets when no stable MAC is available.');
}

const legacyIdentityMetricStore = {
  ...rwStore,
  deviceInfo: {
    protocol: 'qkeer-v2',
    deviceId: 'legacy-platform-id',
    uniMacId: 'LEGACY-STABLE-ID'
  },
  receivedData: [
    {
      type: 'active_measure',
      protocol: 'qkeer-v2',
      deviceId: 'legacy-platform-id',
      uniMacId: 'LEGACY-STABLE-ID',
      heartRate: 77,
      timestamp: 1710000020200
    }
  ],
  healthData: {}
};

if (getLatestHeartRateReading(legacyIdentityMetricStore)?.heartRate !== 77) {
  throw new Error('Legacy/L19 metric helpers should preserve deviceId and uniMacId identity matching.');
}

if (getSubmitDeviceMac(rwStore, true) !== '00:05:1B') {
  throw new Error('iOS submissions should prefer normalized ring mac.');
}

if (getSubmitDeviceMac(rwStore, false) !== '3E:00:00:00:05:1B') {
  throw new Error('Legacy/L19 Android submissions should preserve the existing platform deviceId fallback.');
}

const rwAdvertisOnlyStore = {
  ...rwStore,
  normalMac: '',
  iosMacId: '',
  deviceInfo: {
    deviceId: 'ios-random-id',
    protocol: 'rw',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    }
  }
};

if (getSubmitDeviceMac(rwAdvertisOnlyStore, false) !== '3E:00:00:00:05:1B') {
  throw new Error('RW metric submissions should prefer stable advertis macInfo over random platform id.');
}

const rwMacWithRandomPlatformStore = {
  ...rwAdvertisOnlyStore,
  deviceInfo: {
    deviceId: 'android-random-device-id',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    uniMacId: '111111ABCDEF'
  }
};

if (getSubmitDeviceMac(rwMacWithRandomPlatformStore, false) !== '3E:00:00:00:05:1B') {
  throw new Error('RW Android metric submissions should prefer the current stable mac over random deviceId/uniMacId values.');
}

const rwStaleCachedMacStore = {
  ...rwAdvertisOnlyStore,
  normalMac: 'OLD:RW:MAC',
  deviceInfo: {
    ...rwAdvertisOnlyStore.deviceInfo,
    advertis: {
      macInfo: 'NEW:RW:MAC'
    }
  }
};

if (getSubmitDeviceMac(rwStaleCachedMacStore, false) !== 'NEW:RW:MAC') {
  throw new Error('RW metric submissions should prefer the current device stable MAC over a stale cached normalMac.');
}

const rwUniMacOnlyStore = {
  ...rwAdvertisOnlyStore,
  normalMac: 'OLD:RW:MAC',
  deviceInfo: {
    deviceId: 'ios-random-id',
    protocol: 'rw',
    uniMacId: '3E:00:00:00:05:1B'
  }
};

if (getSubmitDeviceMac(rwUniMacOnlyStore, false) !== '3E:00:00:00:05:1B') {
  throw new Error('RW metric submissions should use current uniMacId before random Android deviceId or stale normalMac.');
}

const rwRandomUniMacOnlyStore = {
  ...rwAdvertisOnlyStore,
  normalMac: 'OLD:RW:MAC',
  iosMacId: 'OLD:IOS:MAC',
  deviceInfo: {
    deviceId: 'ios-random-id',
    protocol: 'rw',
    uniMacId: '111111ABCDEF'
  }
};

if (getSubmitDeviceMac(rwRandomUniMacOnlyStore, false) !== '') {
  throw new Error('RW metric submissions should not submit random uniMacId values as stable device MACs.');
}

const rwMissingCurrentStableIdentityStore = {
  ...rwAdvertisOnlyStore,
  normalMac: 'OLD:RW:MAC',
  iosMacId: 'OLD:IOS:MAC',
  deviceInfo: {
    deviceId: 'ios-random-id',
    protocol: 'rw'
  }
};

if (getSubmitDeviceMac(rwMissingCurrentStableIdentityStore, false) !== '') {
  throw new Error('RW metric submissions should not fall back to a stale store normalMac when current stable identity is missing.');
}

if (formatMetricRecordTime(1710000000000) !== '2024-03-10 00:00:00') {
  throw new Error(`Metric record time formatting changed unexpectedly: ${formatMetricRecordTime(1710000000000)}`);
}

const fallbackCalls: string[] = [];
const getFallbackCallCount = () => fallbackCalls.length;
let refreshParams: Record<string, any> | undefined;
await requestMetricRefresh(
  async (params) => {
    refreshParams = params;
    return { status: 'failed', ok: [], failed: [{ step: 'refresh', message: 'timeout' }] };
  },
  async () => {
    fallbackCalls.push('failed');
  }
);

if (
  getFallbackCallCount() !== 1 ||
  refreshParams?.includeDeviceTime !== false ||
  refreshParams?.includeCollectPeriod !== false ||
  refreshParams?.includeDeviceInfo !== false ||
  refreshParams?.includeRealtimeMetrics !== undefined ||
  refreshParams?.includeHistorySnapshot !== false ||
  refreshParams?.timeoutMs !== 35000
) {
  throw new Error(
    `Metric refresh should use the SY03 realtime measurement window and run fallback only after a failed result: ${JSON.stringify({
      fallbackCount: getFallbackCallCount(),
      refreshParams
    })}`
  );
}

await requestMetricRefresh(
  async () => ({ status: 'partial', ok: ['heart_rate'], failed: [{ step: 'blood_oxygen', message: 'timeout' }] }),
  async () => {
    fallbackCalls.push('generic-partial');
  }
);

if (getFallbackCallCount() !== 1) {
  throw new Error('Metric refresh should keep partial unified refresh results without duplicate fallback commands.');
}

let targetedRefreshParams: Record<string, any> | undefined;
await requestMetricRefresh(
  async (params) => {
    targetedRefreshParams = params;
    return { status: 'partial', ok: ['heart_rate'], failed: [{ step: 'blood_oxygen', message: 'timeout' }] };
  },
  async () => {
    fallbackCalls.push('missing-blood-oxygen');
  },
  { expectedSteps: 'blood_oxygen' }
);

if (
  getFallbackCallCount() !== 2 ||
  targetedRefreshParams?.includeRealtimeMetrics !== true ||
  JSON.stringify(targetedRefreshParams?.realtimeMetricNames) !== JSON.stringify(['blood_oxygen'])
) {
  throw new Error('Metric refresh should explicitly enable RW realtime reads for the requested metric and fallback only when it is missing.');
}

await requestMetricRefresh(
  async () => ({ status: 'partial', ok: ['blood_oxygen'], failed: [{ step: 'heart_rate', message: 'timeout' }] }),
  async () => {
    fallbackCalls.push('present-blood-oxygen');
  },
  { expectedSteps: 'blood_oxygen' }
);

if (getFallbackCallCount() !== 2) {
  throw new Error('Metric refresh should not duplicate fallback commands once the requested metric is present in partial RW results.');
}

await requestMetricRefresh(
  async () => ({ status: 'success', ok: ['heart_rate', 'blood_oxygen_pending'], failed: [] }),
  async () => {
    fallbackCalls.push('pending-blood-oxygen');
  },
  { expectedSteps: 'blood_oxygen' }
);

if (getFallbackCallCount() !== 2) {
  throw new Error('Metric refresh should not send a duplicate fallback command when the requested RW metric is already pending.');
}

await requestMetricRefresh(
  async () => ({ status: 'success', ok: ['blood_oxygen_pending', 'blood_oxygen'], failed: [] }),
  async () => {
    fallbackCalls.push('exact-blood-oxygen');
  },
  { expectedSteps: 'blood_oxygen' }
);

if (getFallbackCallCount() !== 2) {
  throw new Error('Metric refresh should not fallback when the requested RW metric exact step is present even if a pending alias also exists.');
}
