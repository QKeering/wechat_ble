import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

(globalThis as any).uni = {
  getSystemInfoSync: () => ({ platform: 'android', system: 'Android 14' }),
  onBLEConnectionStateChange: () => undefined,
  offBLEConnectionStateChange: () => undefined,
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined
};

setActivePinia(createPinia());

const { useRingStore } = await import('./ring');

const store = useRingStore();

const getConnectionState = () => ({
  isConnected: Boolean(store.isConnected),
  reconnectStatus: String(store.reconnectStatus),
  reconnectResult: store.reconnectResult as boolean | null
});

const getRuntimeCounts = () => ({
  normalizedData: store.normalizedData.length,
  receivedData: store.receivedData.length
});

store.updateDeviceInfo({
  deviceId: 'rw-partial-platform-id',
  name: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B'
} as any);
await nextTick();
const rwPartialConnectionState = getConnectionState();
if (
  rwPartialConnectionState.isConnected ||
  rwPartialConnectionState.reconnectStatus === 'success' ||
  rwPartialConnectionState.reconnectResult === true
) {
  throw new Error(
    `RW device identity without communication fields should not be treated as connected: ${JSON.stringify(rwPartialConnectionState)}`
  );
}

store.clearRuntime();
await nextTick();

store.updateDeviceInfo({
  deviceId: 'rw-ready-platform-id',
  name: 'SY03',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
} as any);
await nextTick();
store.updateIsConnected(false);
store.updateReconnectingStatus('0');
store.updateReconnectResult(false);
const rwReadyAfterLegacyDowngrade = getConnectionState();
if (
  !rwReadyAfterLegacyDowngrade.isConnected ||
  rwReadyAfterLegacyDowngrade.reconnectStatus !== 'success' ||
  rwReadyAfterLegacyDowngrade.reconnectResult !== true
) {
  throw new Error(
    `Ready RW communication fields should not be downgraded by legacy page reconnect failures: ${JSON.stringify(
      rwReadyAfterLegacyDowngrade
    )}`
  );
}

store.clearRuntime();
await nextTick();

store.setDevices([
  {
    deviceId: 'rw-scan-platform-id',
    protocol: 'rw',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    }
  },
  {
    deviceId: 'rw-scan-platform-id-2',
    protocol: 'rw',
    mac: '3E:00:00:00:05:1C',
    advertis: {
      macInfo: '3E:00:00:00:05:1D'
    }
  },
  {
    deviceId: 'rw-scan-platform-id-3',
    name: 'SY03',
    advertis: {
      macInfo: '3E:00:00:00:05:1E'
    }
  },
  {
    deviceId: 'legacy-scan-platform-id',
    protocol: 'qkeer-v2',
    advertis: {
      macInfo: 'AA:BB:CC:DD:EE:FF'
    }
  }
] as any);

if (
  store.devices[0]?.mac !== '3E:00:00:00:05:1B' ||
  store.devices[1]?.mac !== '3E:00:00:00:05:1C' ||
  store.devices[2]?.protocol !== 'rw' ||
  store.devices[2]?.mac !== '3E:00:00:00:05:1E' ||
  store.devices[3]?.mac
) {
  throw new Error(`Ring store scanned devices should expose RW stable MAC without changing legacy scan payloads: ${JSON.stringify(store.devices)}`);
}

store.handleParsedData({
  type: 'rw_health_data',
  name: 'heart_rate',
  value: 68,
  data: [68]
} as any);

store.handleParsedData({
  type: 'rw_health_data',
  name: 'blood_oxygen',
  value: 98,
  data: [98]
} as any);

store.handleParsedData({
  type: 'rw_health_data',
  name: 'heart_rate',
  value: 70,
  data: [70]
} as any);

if (store.receivedData.length !== 2) {
  throw new Error(`RW parsed data should keep one item per metric: ${JSON.stringify(store.receivedData)}`);
}

const heartRate = store.receivedData.find((item: any) => item.name === 'heart_rate') as any;
const bloodOxygen = store.receivedData.find((item: any) => item.name === 'blood_oxygen') as any;

if (heartRate?.value !== 70 || bloodOxygen?.value !== 98) {
  throw new Error(`RW parsed metrics should update independently: ${JSON.stringify(store.receivedData)}`);
}

store.setReceivedData([]);
store.appendReceivedData({
  type: 'rw_health_data',
  name: 'heart_rate',
  value: 61,
  data: [61]
} as any);
store.appendReceivedData({
  type: 'rw_health_data',
  name: 'blood_oxygen',
  value: 97,
  data: [97]
} as any);
store.appendReceivedData({
  type: 'rw_health_data',
  name: 'heart_rate',
  value: 63,
  data: [63]
} as any);

const appendedHeartRate = store.receivedData.find((item: any) => item.name === 'heart_rate') as any;
const appendedBloodOxygen = store.receivedData.find((item: any) => item.name === 'blood_oxygen') as any;
if (store.receivedData.length !== 2 || appendedHeartRate?.value !== 63 || appendedBloodOxygen?.value !== 97) {
  throw new Error(`RW appended parsed metrics should replace the same metric while keeping other metrics: ${JSON.stringify(store.receivedData)}`);
}

store.setNormalizedData([
  {
    sourceType: 'battery',
    metrics: {
      battery: 88,
      batteryStatus: 'normal'
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 68,
      data: [68]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_oxygen',
      value: 99,
      data: [99]
    }
  },
  {
    sourceType: 'active_Temperature',
    metrics: {
      temperature: 36.5
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'temperature',
      status: 'pending',
      message: 'temperature pending'
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'hrv',
      value: 55,
      data: [55]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'stress',
      value: 24,
      data: [24]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_sugar',
      value: 5.6,
      data: [56]
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'hrv',
      status: 'unsupported_realtime',
      message: 'hrv status'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'stress',
      status: 'unsupported_realtime',
      message: 'stress status'
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_pressure',
      value: {
        systolic: 118,
        diastolic: 76
      }
    }
  },
  {
    sourceType: 'rw_health_monitoring_ack',
    metrics: {
      name: 'spo2',
      success: true,
      status: 'success'
    }
  },
  {
    sourceType: 'firmware_version',
    metrics: {
      firmwareVersion: '2.2.9',
      hardwareVersion: '2.2.9',
      softwareVersion: '303e0001',
      uiVersion: '303e0001',
      screenWidth: 48,
      screenHeight: 64
    }
  },
  {
    sourceType: 'qkeer_v2_step',
    metrics: {
      stepCount: 1280,
      motionCalorie: 88,
      motionTime: 32,
      activityLevel: 2,
      distanceKm: 1.6,
      isWorn: true,
      fatigue: 320,
      fatigueLevel: 'light',
      anxiety: 120,
      anxietyLevel: 'normal'
    }
  },
  {
    sourceType: 'qkeer_v2_sleep',
    metrics: {
      sleepTotalMinutes: 420,
      sleepDeepMinutes: 120,
      sleepLightMinutes: 240,
      sleepAwakeMinutes: 20,
      sleepStatusText: 'sleep ok'
    }
  }
]);
await nextTick();
const firstMetricUpdateAt = store.lastMetricUpdateAt;

if (
  store.healthData.battery !== 88 ||
  store.healthData.batteryValue !== 88 ||
  store.healthData.battery_value !== 88 ||
  store.healthData.batteryLevel !== 88 ||
  store.healthData.battery_level !== 88 ||
  store.healthData.batteryPercent !== 88 ||
  store.healthData.battery_percent !== 88 ||
  store.healthData.batteryPercentage !== 88 ||
  store.healthData.battery_percentage !== 88 ||
  store.healthData.electricity !== 88 ||
  store.healthData.power !== 88 ||
  store.healthData.powerPercent !== 88 ||
  store.healthData.power_percent !== 88 ||
  store.healthData.battery_status !== 'normal' ||
  store.healthData.batteryLevelStatus !== 'normal' ||
  store.healthData.battery_level_status !== 'normal' ||
  store.healthData.heartRate !== 68 ||
  store.healthData.heart_rate !== 68 ||
  store.healthData.heartRateValue !== 68 ||
  store.healthData.heart_rate_value !== 68 ||
  store.healthData.HR !== 68 ||
  store.healthData.hr !== 68 ||
  store.healthData.heartbeatStatus !== store.healthData.heartRateStatus ||
  !store.healthData.heart_rate_status ||
  store.healthData.bloodOxygen !== 99 ||
  store.healthData.bloodOxygenSaturation !== 99 ||
  store.healthData.blood_oxygen_saturation !== 99 ||
  store.healthData.spo2 !== 99 ||
  store.healthData.SpO2 !== 99 ||
  store.healthData.SPO2 !== 99 ||
  store.healthData.oxygenSaturation !== 99 ||
  store.healthData.oxygen_saturation !== 99 ||
  store.healthData.bloodOxygenValue !== 99 ||
  store.healthData.blood_oxygen_value !== 99 ||
  !store.healthData.blood_oxygen_status ||
  store.healthData.bloodOxygenSaturationStatus !== store.healthData.bloodOxygenStatus ||
  store.healthData.SpO2Status !== store.healthData.bloodOxygenStatus ||
  store.healthData.SPO2Status !== store.healthData.bloodOxygenStatus ||
  store.healthData.oxygen !== 99 ||
  (store.healthData.bloodPressure as any)?.systolic !== 118 ||
  (store.healthData.blood_pressure as any)?.diastolic !== 76 ||
  store.healthData.bloodPressureHigh !== 118 ||
  store.healthData.blood_pressure_high !== 118 ||
  store.healthData.highPressure !== 118 ||
  store.healthData.high_pressure !== 118 ||
  store.healthData.high !== 118 ||
  store.healthData.bloodPressureLow !== 76 ||
  store.healthData.blood_pressure_low !== 76 ||
  store.healthData.lowPressure !== 76 ||
  store.healthData.low_pressure !== 76 ||
  store.healthData.low !== 76 ||
  store.healthData.systolic !== 118 ||
  store.healthData.diastolic !== 76 ||
  store.healthData.sbp !== 118 ||
  store.healthData.dbp !== 76 ||
  !`${store.healthData.bodyTemp}`.includes('36.5') ||
  !`${store.healthData.body_temp}`.includes('36.5') ||
  !`${store.healthData.skinTemperature}`.includes('36.5') ||
  !`${store.healthData.skin_temperature}`.includes('36.5') ||
  store.healthData.temperatureValue !== 36.5 ||
  store.healthData.temperature_value !== 36.5 ||
  store.healthData.bodyTemperatureValue !== 36.5 ||
  store.healthData.body_temperature_value !== 36.5 ||
  store.healthData.skinTemperatureValue !== 36.5 ||
  store.healthData.skin_temperature_value !== 36.5 ||
  store.healthData.temperatureStatus !== 'temperature pending' ||
  store.healthData.temperature_status !== 'temperature pending' ||
  store.healthData.skinTemperatureStatus !== 'temperature pending' ||
  store.healthData.bodyTempStatus !== 'temperature pending' ||
  store.healthData.hrv !== 55 ||
  store.healthData.HRV !== 55 ||
  store.healthData.heartRateVariability !== 55 ||
  store.healthData.heart_rate_variability !== 55 ||
  store.healthData.hrvValue !== 55 ||
  store.healthData.hrv_value !== 55 ||
  store.healthData.HRVValue !== 55 ||
  store.healthData.hrv_status !== 'hrv status' ||
  store.healthData.HRVStatus !== 'hrv status' ||
  store.healthData.heartRateVariabilityStatus !== 'hrv status' ||
  store.healthData.stressIndex !== 24 ||
  store.healthData.stress_index !== 24 ||
  store.healthData.stress_status !== 'stress status' ||
  store.healthData.stressIndexStatus !== 'stress status' ||
  store.healthData.bloodSugar !== 5.6 ||
  store.healthData.blood_sugar !== 5.6 ||
  store.healthData.glucose !== 5.6 ||
  store.healthData.step !== 1280 ||
  store.healthData.step_count !== 1280 ||
  store.healthData.calorie !== 88 ||
  store.healthData.calories !== 88 ||
  store.healthData.motionCalorie !== 88 ||
  store.healthData.motion_calorie !== 88 ||
  store.healthData.activityMinutes !== 32 ||
  store.healthData.activeMinutes !== 32 ||
  store.healthData.motionTime !== 32 ||
  store.healthData.activityLevel !== 2 ||
  store.healthData.intensityLevel !== 2 ||
  store.healthData.distanceKm !== 1.6 ||
  store.healthData.mileage !== 1.6 ||
  store.healthData.is_worn !== true ||
  store.healthData.fatigue !== 320 ||
  store.healthData.fatigue_level !== 'light' ||
  store.healthData.anxiety !== 120 ||
  store.healthData.anxiety_level !== 'normal' ||
  store.healthData.sleep !== 420 ||
  store.healthData.sleep_status !== 'sleep ok' ||
  store.healthData.sleep_deep_minutes !== 120 ||
  store.healthData.firmwareVersion !== '2.2.9' ||
  store.healthData.firmware_version !== '2.2.9' ||
  store.healthData.firmware !== '2.2.9' ||
  store.healthData.firmwareVer !== '2.2.9' ||
  store.healthData.firmware_ver !== '2.2.9' ||
  store.healthData.hardwareVersion !== '2.2.9' ||
  store.healthData.hardware_version !== '2.2.9' ||
  store.healthData.hardware !== '2.2.9' ||
  store.healthData.hardwareVer !== '2.2.9' ||
  store.healthData.hardware_ver !== '2.2.9' ||
  store.healthData.softwareVersion !== '303e0001' ||
  store.healthData.software_version !== '303e0001' ||
  store.healthData.software !== '303e0001' ||
  store.healthData.softwareVer !== '303e0001' ||
  store.healthData.software_ver !== '303e0001' ||
  store.healthData.uiVersion !== '303e0001' ||
  store.healthData.ui_version !== '303e0001' ||
  store.healthData.ui !== '303e0001' ||
  store.healthData.uiVer !== '303e0001' ||
  store.healthData.ui_ver !== '303e0001' ||
  store.healthData.screen_width !== 48 ||
  store.healthData.screen_height !== 64 ||
  !store.healthData.monitoring_status ||
  store.healthData.raw_health_data.temperature?.message !== 'temperature pending' ||
  !store.healthData.lastMetricUpdateAt ||
  store.healthData.last_metric_update_at !== firstMetricUpdateAt
) {
  throw new Error(`Ring store healthData should expose protocol-independent legacy aliases: ${JSON.stringify(store.healthData)}`);
}

store.updateDeviceInfo({
  deviceId: 'snapshot-rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
await nextTick();
store.setNormalizedData([
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 70,
      data: [70]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_oxygen',
      value: 97,
      data: [97]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'hrv',
      value: 52,
      data: [52]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'stress',
      value: 21,
      data: [21]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_sugar',
      value: 5.4,
      data: [54]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_pressure',
      value: {
        systolic: 116,
        diastolic: 75
      }
    }
  }
]);
await nextTick();
store.setNormalizedData([
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'heart_rate',
      status: 'pending',
      message: 'pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'blood_oxygen',
      status: 'pending',
      message: 'pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'hrv',
      status: 'pending',
      message: 'pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'stress',
      status: 'pending',
      message: 'pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'blood_sugar',
      status: 'pending',
      message: 'pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'blood_pressure',
      status: 'pending',
      message: 'pending'
    }
  }
]);
await nextTick();
const pendingMetricUpdateAt = store.lastMetricUpdateAt;

if (
  Number(store.latestMetrics.heartRate) !== 70 ||
  Number(store.latestMetrics.bloodOxygen) !== 97 ||
  Number(store.latestMetrics.hrv) !== 52 ||
  Number(store.latestMetrics.stress) !== 21 ||
  Number(store.latestMetrics.bloodSugar) !== 5.4 ||
  (store.latestMetrics.bloodPressure as any)?.systolic !== 116 ||
  (store.latestMetrics.bloodPressure as any)?.diastolic !== 75 ||
  Number(store.healthData.heartRate) !== 70 ||
  Number(store.healthData.hrv) !== 52 ||
  Number(store.healthData.stress) !== 21 ||
  Number(store.healthData.bloodSugar) !== 5.4 ||
  Number(store.healthData.systolic) !== 116 ||
  Number(store.healthData.diastolic) !== 75 ||
  !pendingMetricUpdateAt
) {
  throw new Error(`Ring store latestMetrics should keep same-device values while RW refresh is pending: ${JSON.stringify(store.latestMetrics)}`);
}

store.setNormalizedData([
  {
    sourceType: 'battery',
    metrics: {
      battery: 55,
      batteryStatus: 'normal'
    }
  },
  {
    sourceType: 'firmware_version',
    metrics: {
      firmwareVersion: '2.2.9',
      hardwareVersion: '2.2.9',
      softwareVersion: '303e0001',
      uiVersion: '303e0001'
    }
  }
]);
await nextTick();
store.setNormalizedData([
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'battery',
      status: 'pending',
      message: 'battery pending'
    }
  },
  {
    sourceType: 'rw_health_data_pending',
    metrics: {
      name: 'firmware',
      status: 'pending',
      message: 'firmware pending'
    }
  }
]);
await nextTick();

if (
  Number(store.latestMetrics.battery) !== 55 ||
  store.latestMetrics.firmwareVersion !== '2.2.9' ||
  store.latestMetrics.softwareVersion !== '303e0001' ||
  Number(store.healthData.battery) !== 55 ||
  store.healthData.firmwareVersion !== '2.2.9' ||
  store.healthData.batteryStatus !== 'battery pending' ||
  store.healthData.raw_health_data.firmware?.message !== 'firmware pending'
) {
  throw new Error(`Ring store should keep same-device core values while RW core refresh is pending: ${JSON.stringify(store.healthData)}`);
}

store.updateDeviceInfo({
  deviceId: 'snapshot-rw',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
await nextTick();

if (Number(store.latestMetrics.heartRate) !== 70 || Number(store.latestMetrics.bloodOxygen) !== 97) {
  throw new Error(`Ring store should preserve cached metrics while the same device gains communication fields: ${JSON.stringify(store.latestMetrics)}`);
}

store.updateDeviceInfo({
  deviceId: 'snapshot-sy03',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
await nextTick();

const switchedDeviceCounts = getRuntimeCounts();
if (
  switchedDeviceCounts.normalizedData !== 0 ||
  switchedDeviceCounts.receivedData !== 0 ||
  store.latestMetrics.heartRate !== null ||
  store.latestMetrics.bloodOxygen !== null ||
  store.lastMetricUpdateAt !== 0
) {
  throw new Error(`Ring store should clear business metrics when switching devices: ${JSON.stringify(store.latestMetrics)}`);
}

store.setNormalizedData([]);
await nextTick();

if (
  store.latestMetrics.heartRate !== null ||
  store.latestMetrics.bloodOxygen !== null ||
  store.healthData.heartRate !== null ||
  store.lastMetricUpdateAt !== 0
) {
  throw new Error(`Ring store metric snapshot should reset when business data is cleared: ${JSON.stringify(store.latestMetrics)}`);
}

store.updateDeviceInfo({
  deviceId: 'rw-stable-platform-1',
  mac: '3E:00:00:00:05:1B',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
store.setNormalizedData([
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 76,
      data: [76]
    }
  }
]);
await nextTick();
store.updateDeviceInfo({
  deviceId: 'rw-stable-platform-2',
  mac: '3E:00:00:00:05:1B',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
await nextTick();

if (Number(store.latestMetrics.heartRate) !== 76 || getRuntimeCounts().normalizedData === 0) {
  throw new Error(`Ring store should keep RW metrics when platform deviceId changes but stable MAC matches: ${JSON.stringify(store.latestMetrics)}`);
}

store.updateDeviceInfo({
  deviceId: 'rw-stable-platform-2b',
  mac: '3e000000051b',
  advertis: {
    macInfo: '3e-00-00-00-05-1b'
  },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
await nextTick();

if (Number(store.latestMetrics.heartRate) !== 76 || getRuntimeCounts().normalizedData === 0) {
  throw new Error(`Ring store should keep RW metrics when stable MAC formatting changes: ${JSON.stringify(store.latestMetrics)}`);
}

store.updateDeviceInfo({
  deviceId: 'rw-stable-platform-3',
  mac: '3E:00:00:00:05:2A',
  advertis: {
    macInfo: '3E:00:00:00:05:2A'
  },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
await nextTick();

if (getRuntimeCounts().normalizedData !== 0 || store.latestMetrics.heartRate !== null || store.lastMetricUpdateAt !== 0) {
  throw new Error(`Ring store should clear RW metrics when stable MAC changes: ${JSON.stringify(store.latestMetrics)}`);
}

store.updateDeviceInfo({
  deviceId: 'rw-random-platform-a',
  uniMacId: '111111ABCDEF',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
store.setNormalizedData([
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 78,
      data: [78]
    }
  }
]);
await nextTick();
store.updateDeviceInfo({
  deviceId: 'rw-random-platform-b',
  uniMacId: '111111ABCDEF',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
await nextTick();

if (getRuntimeCounts().normalizedData !== 0 || store.latestMetrics.heartRate !== null || store.lastMetricUpdateAt !== 0) {
  throw new Error(
    `Ring store should not keep RW metrics across platform deviceId changes just because random uniMacId matches: ${JSON.stringify({
      latestMetrics: store.latestMetrics,
      counts: getRuntimeCounts()
    })}`
  );
}

store.updateDeviceInfo({
  deviceId: 'rw-disconnect-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
store.setNormalizedData([
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 82,
      data: [82]
    }
  }
]);
await nextTick();
store.updateDeviceInfo({});
await nextTick();

const clearedDeviceCounts = getRuntimeCounts();
if (
  clearedDeviceCounts.normalizedData !== 0 ||
  clearedDeviceCounts.receivedData !== 0 ||
  store.latestMetrics.heartRate !== null ||
  store.healthData.heartRate !== null ||
  store.lastMetricUpdateAt !== 0
) {
  throw new Error(`Ring store should clear business metrics when device info is cleared: ${JSON.stringify(store.latestMetrics)}`);
}

store.updateDeviceInfo({
  deviceId: 'rw-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB'
} as any);
if (store.isConnected) {
  throw new Error('Ring store should not mark a half-discovered BLE device as connected.');
}
store.updateDeviceInfo({
  deviceId: 'rw-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB'
} as any);
if (!store.isConnected || store.reconnectStatus !== 'success' || store.reconnectResult !== true) {
  throw new Error('Ring store should mark a BLE device connected only after write and notify characteristics are ready.');
}
store.updateReconnectingStatus('reconnecting');
let connectionState = getConnectionState();
if (connectionState.reconnectStatus !== 'success' || connectionState.reconnectResult !== true) {
  throw new Error('Ring store should not let a late reconnecting status override an already-ready BLE device.');
}
store.updateReconnectResult(null);
connectionState = getConnectionState();
if (connectionState.reconnectStatus !== 'success' || connectionState.reconnectResult !== true) {
  throw new Error('Ring store should not let a late empty reconnect result override an already-ready BLE device.');
}
store.updateIsConnected(false);
connectionState = getConnectionState();
if (!connectionState.isConnected || connectionState.reconnectStatus !== 'success' || connectionState.reconnectResult !== true) {
  throw new Error('Ring store should not let a legacy page false connected flag override an already-ready BLE device.');
}
store.updateReconnectingStatus('failed');
store.updateReconnectResult(false);
connectionState = getConnectionState();
if (!connectionState.isConnected || connectionState.reconnectStatus !== 'success' || connectionState.reconnectResult !== true) {
  throw new Error('Ring store should not let late legacy reconnect failures override an already-ready BLE device.');
}
store.updateDeviceInfo({
  deviceId: 'rw-device',
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB'
} as any);
connectionState = getConnectionState();
if (connectionState.isConnected || connectionState.reconnectStatus === 'success' || connectionState.reconnectResult !== null) {
  throw new Error('Ring store should not keep success status when a device update loses communication characteristics.');
}
store.updateNormalMac('AA:BB:CC:DD:EE:FF');
store.updateIosMacId('stale-l19-ios-id');
store.updateDeviceInfo({
  deviceId: 'rw-direct-store-platform-id',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);
if (
  store.deviceInfo.mac !== '3E:00:00:00:05:1B' ||
  store.normalMac !== '3E:00:00:00:05:1B' ||
  store.iosMacId !== '3E:00:00:00:05:1B'
) {
  throw new Error(
    `Ring store direct RW deviceInfo updates should expose stable MAC aliases: ${JSON.stringify({
      deviceInfo: store.deviceInfo,
      normalMac: store.normalMac,
      iosMacId: store.iosMacId
    })}`
  );
}
store.handleParsedData({
  type: 'device_time',
  protocol: 'rw',
  timestamp: 2000,
  deviceTimestamp: 1696670397000,
  timezone: 8
} as any);
if (store.deviceTime !== 1696670397000) {
  throw new Error(`Ring store should keep RW device_time deviceTimestamp, not the receive timestamp: ${store.deviceTime}`);
}

store.updateDeviceInfo({
  deviceId: 'rw-direct-store-platform-id',
  mac: '3E:00:00:00:05:1C',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);

if (String(store.deviceInfo.mac) !== '3E:00:00:00:05:1C') {
  throw new Error(`Ring store should not overwrite an explicit RW mac with advertis macInfo: ${JSON.stringify(store.deviceInfo)}`);
}

store.updateDeviceInfo({
  deviceId: 'rw-direct-store-platform-id',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  serviceId: '0000A00A-0000-1000-8000-00805F9B34FB',
  cmdCharId: '0000B002-0000-1000-8000-00805F9B34FB',
  dataCharId: '0000B003-0000-1000-8000-00805F9B34FB',
  protocol: 'rw'
} as any);

store.handleParsedData({
  type: 'rw_upload_file',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  seq: 11,
  status: 'completed',
  fileName: 'u1_20260101010400_hr.txt',
  fileType: 'hr',
  timestampText: '20260101010400',
  records: [
    {
      timestamp: 1767229440,
      value: 74
    }
  ]
} as any);
const directRwUploadRecord = store.localData.find((record: any) => record.sourceType === 'rw_upload_file' && record.seq === 11) as any;
if (
  directRwUploadRecord?.value !== 74 ||
  directRwUploadRecord?.dataType !== 'heart_rate_raw' ||
  directRwUploadRecord?.rawDataType !== 'hr' ||
  directRwUploadRecord?.fileName !== 'u1_20260101010400_hr.txt' ||
  directRwUploadRecord?.mac !== '3E:00:00:00:05:1B'
) {
  throw new Error(`Ring store should handle direct RW upload-file parsed data like legacy local_data: ${JSON.stringify(store.localData)}`);
}
store.handleParsedData({
  type: 'rw_file_list',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  selectedFiles: [
    {
      seq: 12,
      fileName: 'u1_20260101010500_hr.txt',
      fileType: 'hr',
      timestampText: '20260101010500'
    }
  ]
} as any);
const directRwPendingFileRecord = store.localData.find((record: any) => record.sourceType === 'rw_file_list' && record.seq === 12) as any;
if (
  directRwPendingFileRecord?.status !== 'pending_upload_payload' ||
  directRwPendingFileRecord?.dataType !== 'heart_rate_raw' ||
  directRwPendingFileRecord?.rawDataType !== 'hr'
) {
  throw new Error(`Ring store should expose direct RW file-list entries as typed pending upload records: ${JSON.stringify(store.localData)}`);
}
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  status: 'filtered',
  dataType: 'bloodOxygen',
  records: []
} as any);
if (
  !store.localData.some((record: any) => record.seq === 11 && record.dataType === 'heart_rate_raw') ||
  !store.localData.some((record: any) => record.seq === 12 && record.dataType === 'heart_rate_raw')
) {
  throw new Error(`Ring store direct typed filtered packets should preserve other RW history types: ${JSON.stringify(store.localData)}`);
}
store.handleParsedData({
  type: 'rw_file_list',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  selectedFiles: [],
  dataType: 'heartRate',
  filteredFileCount: 1
} as any);
if (store.localData.some((record: any) => record.dataType === 'heart_rate_raw')) {
  throw new Error(`Ring store direct typed empty RW file-list should clear only the matching RW history type: ${JSON.stringify(store.localData)}`);
}
store.updateReconnectingStatus('failed');
store.updateUploadingStatus('uploading');
store.clearRuntime();

connectionState = getConnectionState();
if (connectionState.isConnected || connectionState.reconnectStatus !== 'idle' || String(store.uploadingStatus) !== 'idle') {
  throw new Error(
    `Runtime cleanup should reset connection flags: ${JSON.stringify({
      isConnected: connectionState.isConnected,
      reconnectStatus: connectionState.reconnectStatus,
      uploadingStatus: store.uploadingStatus
    })}`
  );
}

store.clearRuntime();
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  status: 'success',
  records: [
    { unixTime: 1710000000, dataType: 'heart_rate_raw', rawDataType: 'hr', value: 72 },
    { unixTime: 1710000000, dataType: 'blood_oxygen_raw', rawDataType: 'spo2', value: 98 }
  ]
} as any);
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  status: 'success',
  records: [
    { unixTime: 1710000000, dataType: 'heart_rate_raw', rawDataType: 'hr', value: 72 },
    { timestamp: 1710000060000, dataType: 'sleep', rawDataType: 'sleep', sleepState: 1, durationMinutes: 30 }
  ]
} as any);

if (
  store.localData.length !== 3 ||
  store.localData[0].dataType !== 'sleep' ||
  !store.localData.some((record: any) => record.dataType === 'heart_rate_raw') ||
  !store.localData.some((record: any) => record.dataType === 'blood_oxygen_raw') ||
  !store.localData.some((record: any) => record.dataType === 'sleep')
) {
  throw new Error(`RW same-timestamp history records should dedupe by metric identity, not only unixTime: ${JSON.stringify(store.localData)}`);
}

const historyCountBeforeFiltered = store.historyRecords.length;
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  status: 'filtered',
  records: [],
  totalFileCount: 2,
  selectedFileCount: 0,
  filteredFileCount: 2
} as any);

const localCountAfterFiltered: number = store.localData.length;
const historyCountAfterFiltered: number = store.historyRecords.length;
if (localCountAfterFiltered !== 0 || historyCountAfterFiltered !== historyCountBeforeFiltered) {
  throw new Error(`RW filtered local_data should clear the current local list without deleting uploaded history cache: ${JSON.stringify({
    localData: store.localData,
    historyRecords: store.historyRecords
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  status: 'success',
  records: [
    { recordTime: '2000-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 60 },
    { recordTime: '2099-01-01 00:00:00', dataType: 'sleep', rawDataType: 'sleep', sleepState: 1 }
  ]
} as any);
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  status: 'success',
  records: [
    { recordTime: '2000-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 60 },
    { recordTime: '2099-01-01 00:00:00', dataType: 'blood_oxygen_raw', rawDataType: 'spo2', value: 98 }
  ]
} as any);

if (
  store.localData.length !== 3 ||
  store.localData[0].recordTime !== '2099-01-01 00:00:00' ||
  store.localData[1].recordTime !== '2099-01-01 00:00:00' ||
  store.localData[2].recordTime !== '2000-01-01 00:00:00' ||
  store.localData.filter((record: any) => record.dataType === 'heart_rate_raw').length !== 1
) {
  throw new Error(`Ring store should sort and dedupe history records using recordTime when unixTime is absent: ${JSON.stringify(store.localData)}`);
}

store.clearRuntime();
store.appendHistoryRecords([
  { recordTime: '2000-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 60 },
  { recordTime: '2099-01-01 00:00:00', dataType: 'sleep', rawDataType: 'sleep', sleepState: 1 }
] as any);
store.appendHistoryRecords([
  { recordTime: '2000-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 60 },
  { recordTime: '2099-01-01 00:00:00', dataType: 'blood_oxygen_raw', rawDataType: 'spo2', value: 98 }
] as any);

if (
  store.historyRecords.length !== 3 ||
  store.localData.length !== 3 ||
  store.historyRecords[0].recordTime !== '2099-01-01 00:00:00' ||
  store.localData[0].recordTime !== '2099-01-01 00:00:00' ||
  store.historyRecords.filter((record: any) => record.dataType === 'heart_rate_raw').length !== 1 ||
  store.localData.filter((record: any) => record.dataType === 'heart_rate_raw').length !== 1
) {
  throw new Error(`Ring store appendHistoryRecords should dedupe and sort uploaded history like local_data: ${JSON.stringify({
    historyRecords: store.historyRecords,
    localData: store.localData
  })}`);
}

store.clearRuntime();
const historyRecordsAfterClear: number = store.historyRecords.length;
const localDataAfterClear: number = store.localData.length;
if (historyRecordsAfterClear !== 0 || localDataAfterClear !== 0) {
  throw new Error(`Ring store clearRuntime should clear both uploaded history cache and visible local data: ${JSON.stringify({
    historyRecords: store.historyRecords,
    localData: store.localData
  })}`);
}

store.clearRuntime();
store.appendHistoryRecords([
  {
    protocol: 'rw',
    mac: '3E:00:00:00:05:1B',
    recordTime: '2099-01-01 00:00:00',
    dataType: 'heart_rate_raw',
    rawDataType: 'hr',
    value: 61
  },
  {
    protocol: 'rw',
    mac: '3e000000051b',
    recordTime: '2099-01-01 00:00:00',
    dataType: 'heart_rate_raw',
    rawDataType: 'hr',
    value: 62
  },
  {
    protocol: 'rw',
    mac: '3E:00:00:00:05:2A',
    recordTime: '2099-01-01 00:00:00',
    dataType: 'heart_rate_raw',
    rawDataType: 'hr',
    value: 63
  },
  {
    protocol: 'l19',
    deviceId: '3E:00:00:00:05:1B',
    recordTime: '2099-01-01 00:00:00',
    dataType: 'heart_rate_raw',
    rawDataType: 'hr',
    value: 64
  }
] as any);

const identityScopedHistoryRecords = (store.historyRecords as any[]).filter(
  (record) =>
    record.recordTime === '2099-01-01 00:00:00' &&
    record.dataType === 'heart_rate_raw' &&
    [61, 63, 64].includes(record.value)
);

if (
  store.localData.length !== 3 ||
  identityScopedHistoryRecords.length !== 3
) {
  throw new Error(`Ring store history dedupe should include protocol and stable device identity: ${JSON.stringify({
    historyRecords: store.historyRecords,
    localData: store.localData
  })}`);
}

store.clearRuntime();
store.appendHistoryRecords([
  {
    protocol: 'rw',
    mac: '3E:00:00:00:05:2B',
    RecordTime: '2099-01-01 00:01:00',
    DataType: 'Heart_Rate_Raw',
    RawDataType: 'HR',
    value: 76
  }
] as any);
store.appendHistoryRecords([
  {
    protocol: 'rw',
    mac: '3e000000052b',
    recordTime: '2099-01-01 00:01:00',
    dataType: 'heart_rate_raw',
    rawDataType: 'hr',
    value: 77
  }
] as any);

const mixedCaseHistoryRows = (store.historyRecords as any[]).filter(
  (record) =>
    (record.recordTime === '2099-01-01 00:01:00' || record.RecordTime === '2099-01-01 00:01:00') &&
    [76, 77].includes(record.value)
);
const mixedCaseLocalRows = (store.localData as any[]).filter(
  (record) =>
    (record.recordTime === '2099-01-01 00:01:00' || record.RecordTime === '2099-01-01 00:01:00') &&
    [76, 77].includes(record.value)
);

if (
  mixedCaseHistoryRows.length !== 1 ||
  mixedCaseLocalRows.length !== 1 ||
  mixedCaseHistoryRows[0].value !== 76 ||
  mixedCaseLocalRows[0].value !== 76
) {
  throw new Error(`Ring store should dedupe mixed-case RW history metadata using the same stable identity key: ${JSON.stringify({
    historyRecords: store.historyRecords,
    localData: store.localData
  })}`);
}

store.clearRuntime();
store.appendHistoryRecords([
  {
    protocol: 'rw',
    deviceId: 'rw-random-history-platform-a',
    uniMacId: '111111ABCDEF',
    recordTime: '2099-01-01 00:00:00',
    dataType: 'heart_rate_raw',
    rawDataType: 'hr',
    value: 65
  },
  {
    protocol: 'rw',
    deviceId: 'rw-random-history-platform-b',
    uniMacId: '111111ABCDEF',
    recordTime: '2099-01-01 00:00:00',
    dataType: 'heart_rate_raw',
    rawDataType: 'hr',
    value: 66
  }
] as any);

const randomIdentityLocalDataCount: number = store.localData.length;
if (
  randomIdentityLocalDataCount !== 2 ||
  !store.historyRecords.some((record: any) => record.deviceId === 'rw-random-history-platform-a' && record.value === 65) ||
  !store.historyRecords.some((record: any) => record.deviceId === 'rw-random-history-platform-b' && record.value === 66) ||
  !store.localData.some((record: any) => record.deviceId === 'rw-random-history-platform-a' && record.value === 65) ||
  !store.localData.some((record: any) => record.deviceId === 'rw-random-history-platform-b' && record.value === 66)
) {
  throw new Error(
    `Ring store history should not dedupe RW random uniMacId records without a stable MAC: ${JSON.stringify({
      historyRecords: store.historyRecords,
      localData: store.localData
    })}`
  );
}

store.clearRuntime();
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  mac: '3E:00:00:00:05:1B',
  status: 'success',
  records: [
    { recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 61 }
  ]
} as any);
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  mac: '3E:00:00:00:05:2A',
  status: 'success',
  records: [
    { recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 63 }
  ]
} as any);

const parsedLocalDataRecords = store.localData as any[];
if (parsedLocalDataRecords.length !== 2) {
  throw new Error(`Ring store local_data should preserve parsed-level RW device identity before dedupe: ${JSON.stringify(parsedLocalDataRecords)}`);
}

store.clearRuntime();
store.updateDeviceInfo({
  deviceId: 'rw-current-random-platform',
  uniMacId: '111111ABCDEF',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  protocol: 'rw'
} as any);
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  deviceId: 'rw-current-random-platform',
  uniMacId: '111111ABCDEF',
  status: 'success',
  records: [
    { recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 66 }
  ]
} as any);

const randomIdentityParsedLocalData = [...store.localData];
const randomIdentityParsedReceivedData = [...store.receivedData];
if (randomIdentityParsedLocalData.length !== 0 || randomIdentityParsedReceivedData.length !== 0) {
  throw new Error(`Ring store should ignore direct RW parsed data tagged only with random platform identity: ${JSON.stringify({
    localData: randomIdentityParsedLocalData,
    receivedData: randomIdentityParsedReceivedData
  })}`);
}

store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  status: 'success',
  records: [
    { recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 67 }
  ]
} as any);

const untaggedParsedLocalData = [...store.localData];
const untaggedParsedReceivedData = [...store.receivedData];
if (untaggedParsedLocalData.length !== 1 || (untaggedParsedLocalData[0] as any)?.value !== 67 || untaggedParsedReceivedData.length !== 1) {
  throw new Error(`Ring store should still accept untagged direct RW parsed data for the current connection: ${JSON.stringify({
    localData: untaggedParsedLocalData,
    receivedData: untaggedParsedReceivedData
  })}`);
}

store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  mac: '3E:00:00:00:05:2A',
  status: 'success',
  records: [
    { recordTime: '2099-01-01 00:00:00', dataType: 'heart_rate_raw', rawDataType: 'hr', value: 68 }
  ]
} as any);

const otherMacParsedLocalData = [...store.localData];
const otherMacParsedReceivedData = [...store.receivedData];
if (otherMacParsedLocalData.length !== 1 || otherMacParsedReceivedData.length !== 1) {
  throw new Error(`Ring store should ignore direct RW parsed data from another stable MAC: ${JSON.stringify({
    localData: otherMacParsedLocalData,
    receivedData: otherMacParsedReceivedData
  })}`);
}

store.clearRuntime();
store.setNormalizedData([
  {
    sourceType: 'hardwareVersion',
    metrics: {
      value: '0.2.2',
      protocol: 'rw'
    }
  },
  {
    sourceType: 'softwareVersion',
    metrics: {
      value: '0A050402',
      protocol: 'rw'
    }
  }
] as any);
await nextTick();

if (
  String(store.latestMetrics.firmwareVersion) !== '0.2.2' ||
  String(store.latestMetrics.hardwareVersion) !== '0.2.2' ||
  String(store.latestMetrics.softwareVersion) !== '0A050402' ||
  String(store.latestMetrics.uiVersion) !== '0A050402' ||
  String(store.healthData.firmwareVersion) !== '0.2.2' ||
  String(store.healthData.hardware_version) !== '0.2.2' ||
  String(store.healthData.softwareVersion) !== '0A050402' ||
  String(store.healthData.ui_version) !== '0A050402'
) {
  throw new Error(`Ring store should expose RW L19-compatible version alias events through legacy healthData fields: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData
  })}`);
}

store.clearRuntime();
store.setNormalizedData([
  {
    sourceType: 'firmware_version',
    metrics: {
      firmwareVersion: '2.3.8.91',
      hardwareVersion: '2.3.8.91',
      protocol: 'rw'
    }
  }
] as any);
await nextTick();

if (
  String(store.latestMetrics.firmwareVersion) !== '2.3.8.91' ||
  String(store.latestMetrics.hardwareVersion) !== '2.3.8.91' ||
  String(store.latestMetrics.softwareVersion) !== '2.3.8.91' ||
  String(store.latestMetrics.uiVersion) !== '2.3.8.91' ||
  String(store.healthData.softwareVersion) !== '2.3.8.91' ||
  String(store.healthData.software_version) !== '2.3.8.91' ||
  String(store.healthData.uiVersion) !== '2.3.8.91' ||
  String(store.healthData.ui_version) !== '2.3.8.91'
) {
  throw new Error(`Ring store should let RW single-version firmware payloads fill legacy software display fields: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'battery',
  protocol: 'rw',
  value: 82,
  status: 'normal'
} as any);
store.handleParsedData({
  type: 'hardwareVersion',
  protocol: 'rw',
  value: '0.3.3'
} as any);
store.handleParsedData({
  type: 'softwareVersion',
  protocol: 'rw',
  value: '0B060503'
} as any);
await nextTick();

const directParsedSourceTypes = store.normalizedData.map((item: any) => item?.sourceType);
if (
  Number(store.latestMetrics.battery) !== 82 ||
  String(store.latestMetrics.firmwareVersion) !== '0.3.3' ||
  String(store.latestMetrics.hardwareVersion) !== '0.3.3' ||
  String(store.latestMetrics.softwareVersion) !== '0B060503' ||
  String(store.latestMetrics.uiVersion) !== '0B060503' ||
  Number(store.healthData.battery) !== 82 ||
  String(store.healthData.firmware_version) !== '0.3.3' ||
  String(store.healthData.hardwareVersion) !== '0.3.3' ||
  String(store.healthData.software_version) !== '0B060503' ||
  String(store.healthData.uiVersion) !== '0B060503' ||
  !directParsedSourceTypes.includes('battery') ||
  !directParsedSourceTypes.includes('hardwareVersion') ||
  !directParsedSourceTypes.includes('softwareVersion')
) {
  throw new Error(`Ring store should normalize direct RW parsed battery/version events for legacy pages: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData,
    normalizedData: store.normalizedData
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'battery',
  protocol: 'rw',
  value: '78%',
  status: 'normal'
} as any);
store.handleParsedData({
  type: 'battery',
  protocol: 'rw',
  battery: 101,
  value: 'charging',
  status: 'charging'
} as any);
await nextTick();

if (
  Number(store.latestMetrics.battery) !== 78 ||
  Number(store.healthData.battery) !== 78 ||
  Number(store.healthData.batteryPercent) !== 78 ||
  Number(store.healthData.powerPercent) !== 78 ||
  String(store.healthData.batteryStatus) !== 'charging'
) {
  throw new Error(`Ring store should normalize RW battery text to L19 numeric aliases and ignore status codes as percentages: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData,
    normalizedData: store.normalizedData
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'rw_health_data',
  protocol: 'rw',
  name: 'heart_rate',
  value: 73,
  data: [73],
  status: 'normal'
} as any);
store.handleParsedData({
  type: 'rw_health_data',
  protocol: 'rw',
  name: 'blood_oxygen',
  value: 97,
  data: [97],
  status: 'normal'
} as any);
await nextTick();

const directRwRealtimeSourceTypes = store.normalizedData.map((item: any) => item?.sourceType);
if (
  Number(store.latestMetrics.heartRate) !== 73 ||
  Number(store.latestMetrics.bloodOxygen) !== 97 ||
  Number(store.healthData.heartRate) !== 73 ||
  Number(store.healthData.heart_rate) !== 73 ||
  Number(store.healthData.hr) !== 73 ||
  Number(store.healthData.bloodOxygen) !== 97 ||
  Number(store.healthData.blood_oxygen) !== 97 ||
  Number(store.healthData.spo2) !== 97 ||
  !directRwRealtimeSourceTypes.every((sourceType) => sourceType === 'rw_health_data')
) {
  throw new Error(`Ring store should normalize direct RW realtime metrics for legacy L19 pages: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData,
    normalizedData: store.normalizedData
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'rw_health_data',
  protocol: 'rw',
  name: 'hr',
  value: 74,
  data: [74],
  status: 'normal'
} as any);
store.handleParsedData({
  type: 'rw_health_data',
  protocol: 'rw',
  name: 'oxygen',
  value: 96,
  data: [96],
  status: 'normal'
} as any);
await nextTick();

if (
  Number(store.latestMetrics.heartRate) !== 74 ||
  Number(store.latestMetrics.bloodOxygen) !== 96 ||
  Number(store.healthData.hr) !== 74 ||
  Number(store.healthData.spo2) !== 96 ||
  store.healthData.raw_health_data.heart_rate?.originalName !== 'hr' ||
  store.healthData.raw_health_data.blood_oxygen?.originalName !== 'oxygen'
) {
  throw new Error(`Ring store should normalize RW realtime short-name aliases for legacy L19 pages: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData,
    normalizedData: store.normalizedData
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'rw_health_data',
  protocol: 'rw',
  name: 'heart_rate',
  value: 0,
  data: [0],
  status: 'normal'
} as any);
store.handleParsedData({
  type: 'rw_health_data',
  protocol: 'rw',
  name: 'blood_oxygen',
  value: 0,
  data: [0],
  status: 'normal'
} as any);
await nextTick();

if (
  store.latestMetrics.heartRate !== null ||
  store.latestMetrics.bloodOxygen !== null ||
  store.healthData.heartRate !== null ||
  store.healthData.bloodOxygen !== null ||
  store.healthData.spo2 !== null
) {
  throw new Error(`Ring store should not surface RW zero realtime metrics as L19-compatible live values: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData,
    normalizedData: store.normalizedData
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'active_OxyGenMeasure',
  protocol: 'rw',
  heartRate: 70,
  bloodOxygen: 46,
  status: 'invalid sample'
} as any);
store.handleParsedData({
  type: 'qkeer_v2_health',
  protocol: 'rw',
  heartRate: 71,
  bloodOxygen: 46
} as any);
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  status: 'success',
  records: [
    {
      unixTime: 1710000000,
      dataType: 'blood_oxygen_raw',
      rawDataType: 'spo2',
      value: 46,
      bloodOxygen: 46
    }
  ]
} as any);
await nextTick();

if (
  store.latestMetrics.bloodOxygen !== null ||
  store.healthData.bloodOxygen !== null ||
  store.healthData.spo2 !== null
) {
  throw new Error(`Ring store should reject invalid RW blood oxygen values from every L19-compatible path: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData,
    normalizedData: store.normalizedData
  })}`);
}

store.clearRuntime();
store.handleParsedData({
  type: 'local_data',
  protocol: 'rw',
  sourceType: 'qkeer_v2_last_data',
  status: 'success',
  dataType: 'summary',
  records: [
    {
      unixTime: 1710000000,
      dataType: 'summary',
      rawDataType: 'last_data',
      battery: 77,
      batteryStatus: 'normal',
      chargingStatus: 0,
      chargingStatusText: 'not_charging',
      heartRate: 66,
      bloodOxygen: 98,
      temperature: 36.9,
      stepCount: 1234,
      sleepTotalMinutes: 230,
      sleepDeepMinutes: 80,
      sleepLightMinutes: 120,
      sleepRemMinutes: 20,
      sleepAwakeMinutes: 10,
      fatigue: 320,
      fatigueLevel: 'mild',
      anxiety: 650,
      anxietyLevel: 'high'
    }
  ]
} as any);
await nextTick();

if (
  Number(store.latestMetrics.battery) !== 77 ||
  Number(store.healthData.batteryPercent) !== 77 ||
  Number(store.latestMetrics.heartRate) !== 66 ||
  Number(store.healthData.hr) !== 66 ||
  Number(store.latestMetrics.bloodOxygen) !== 98 ||
  Number(store.healthData.spo2) !== 98 ||
  Number(store.healthData.temperatureValue) !== 36.9 ||
  Number(store.latestMetrics.stepCount) !== 1234 ||
  Number(store.healthData.sleepTotalMinutes) !== 230 ||
  Number(store.healthData.sleepDeepMinutes) !== 80 ||
  Number(store.healthData.sleepLightMinutes) !== 120 ||
  Number(store.healthData.sleepRemMinutes) !== 20 ||
  Number(store.healthData.sleepAwakeMinutes) !== 10 ||
  Number(store.healthData.fatigue) !== 320 ||
  store.healthData.fatigueLevel !== 'mild' ||
  Number(store.healthData.anxiety) !== 650 ||
  store.healthData.anxietyLevel !== 'high' ||
  store.latestMetrics.historyStatus !== 'success'
) {
  throw new Error(`Ring store should surface RW LastData history fallback as L19-compatible page metrics: ${JSON.stringify({
    latestMetrics: store.latestMetrics,
    healthData: store.healthData,
    normalizedData: store.normalizedData
  })}`);
}
