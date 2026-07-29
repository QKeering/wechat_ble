import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type {
  RingBoundDevice,
  RingBusinessMetrics,
  RingDeviceInfo,
  RingHistoricalRecord,
  RingParsedData,
  RingReconnectStatus,
  RingUploadingStatus
} from '@/sdk/ring-ble';
import { buildRingBusinessMetrics, mergeRingBusinessMetricSnapshot, normalizeRingData, resolveRingProtocol } from '@/sdk/ring-ble';

const LAST_READ_TIMESTAMP_KEY = 'qkeer:ring-last-read-timestamp';
const NORMAL_MAC_KEY = 'qkeer:ring-normal-mac';
const IOS_MAC_KEY = 'qkeer:ring-ios-mac';

type LegacyReconnectStatus = RingReconnectStatus | '0' | '1' | '2';
type LegacyUploadingStatus = RingUploadingStatus | '0' | '1' | '2';

const normalizeReconnectStatus = (status: LegacyReconnectStatus): RingReconnectStatus => {
  if (status === '0') return 'idle';
  if (status === '1') return 'reconnecting';
  if (status === '2') return 'success';
  return status;
};

const normalizeUploadingStatus = (status: LegacyUploadingStatus): RingUploadingStatus => {
  if (status === '0') return 'idle';
  if (status === '1') return 'uploading';
  if (status === '2') return 'success';
  return status;
};

const getMetricNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const matched = value.match(/-?\d+(?:\.\d+)?/);
    if (!matched) return null;
    const parsed = Number(matched[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getBatteryMetricNumber = (value: unknown) => {
  const numeric = getMetricNumber(value);
  return numeric != null && numeric >= 0 && numeric <= 100 ? numeric : null;
};

const getNormalizedBatteryMetricValue = (item: any) => {
  const metrics = item?.metrics || {};
  const value = metrics.battery ?? metrics.value ?? metrics.batteryValue;
  return getBatteryMetricNumber(value);
};

const getNormalizedDataKey = (item: any) => {
  const sourceType = item?.sourceType;
  if (!sourceType) return '';

  const metricName = item?.metrics?.name;
  if (metricName) {
    if (
      sourceType === 'rw_health_data' ||
      sourceType === 'rw_health_data_ack' ||
      sourceType === 'rw_health_data_control_ack' ||
      sourceType === 'rw_health_data_pending'
    ) {
      return `rw_health_data:${metricName}`;
    }

    if (sourceType === 'rw_health_monitoring' || sourceType === 'rw_health_monitoring_ack') {
      return `rw_health_monitoring:${metricName}`;
    }
  }

  return sourceType;
};

const getParsedDataKey = (item: RingParsedData) => {
  const type = item?.type;
  if (!type) return '';

  const metricName = (item as Record<string, any>).name;
  if (
    metricName &&
    (type === 'rw_health_data' ||
      type === 'rw_health_data_ack' ||
      type === 'rw_health_data_control_ack' ||
      type === 'rw_health_data_pending' ||
      type === 'rw_health_monitoring' ||
      type === 'rw_health_monitoring_ack')
  ) {
    return `${type}:${metricName}`;
  }

  return type;
};

const HISTORY_PARSED_DATA_TYPES = new Set([
  'local_data',
  'qkeer_v2_health_list',
  'qkeer_v2_last_data',
  'qkeer_v2_step_list',
  'qkeer_v2_sleep_list',
  'rw_upload_file',
  'rw_file_list'
]);

const isHistoryParsedData = (item: RingParsedData) => HISTORY_PARSED_DATA_TYPES.has(item?.type);

export const useRingStore = defineStore('ring', () => {
  const devices = ref<RingDeviceInfo[]>([]);
  const deviceInfo = ref<RingDeviceInfo>({});
  const boundDevice = ref<RingBoundDevice | null>(null);
  const receivedData = ref<RingParsedData[]>([]);
  const normalizedData = ref<any[]>([]);
  const historyRecords = ref<RingHistoricalRecord[]>([]);
  const localData = ref<RingHistoricalRecord[]>([]);
  const normalMac = ref<string>(uni.getStorageSync(NORMAL_MAC_KEY) || '');
  const iosMacId = ref<string>(uni.getStorageSync(IOS_MAC_KEY) || '');
  const deviceTime = ref(0);
  const lastReadTimestamp = ref<number>(uni.getStorageSync(LAST_READ_TIMESTAMP_KEY) || 0);
  const isBluetoothReady = ref(false);
  const isScanning = ref(false);
  const isListenerRegistered = ref(false);
  const hasRegisteredAdapterListener = ref(false);
  const isManualReconnecting = ref(false);
  const isMinePageButtomClick = ref(false);
  const isUnbinding = ref(false);
  const isSending = ref(false);
  const reconnectStatus = ref<RingReconnectStatus>('idle');
  const reconnectResult = ref<boolean | null>(null);
  const uploadingStatus = ref<RingUploadingStatus>('idle');

  const isConnected = ref(false);
  const isReconnecting = computed(() => reconnectStatus.value === 'reconnecting');
  const isUploading = computed(() => uploadingStatus.value === 'uploading');
  const metricSnapshot = ref<Partial<RingBusinessMetrics>>({});
  const metricSnapshotDeviceKey = ref('');
  const lastMetricUpdateAt = ref(0);
  const rawLatestMetrics = computed(() => buildRingBusinessMetrics(normalizedData.value));
  const latestMetrics = computed(() => mergeRingBusinessMetricSnapshot(rawLatestMetrics.value, metricSnapshot.value));
  const bloodPressureSystolic = computed(() => {
    const value = latestMetrics.value.bloodPressure;
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, any>;
    return record.systolic ?? record.high ?? record.sbp ?? null;
  });
  const bloodPressureDiastolic = computed(() => {
    const value = latestMetrics.value.bloodPressure;
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, any>;
    return record.diastolic ?? record.low ?? record.dbp ?? null;
  });
  const healthData = computed(() => {
    const metrics = latestMetrics.value;
    const temperatureValue = getMetricNumber(metrics.temperature);
    return {
      battery: metrics.battery,
      batteryValue: metrics.battery,
      battery_value: metrics.battery,
      batteryLevel: metrics.battery,
      battery_level: metrics.battery,
      batteryPercent: metrics.battery,
      battery_percent: metrics.battery,
      batteryPercentage: metrics.battery,
      battery_percentage: metrics.battery,
      electricity: metrics.battery,
      power: metrics.battery,
      powerPercent: metrics.battery,
      power_percent: metrics.battery,
      batteryStatus: metrics.batteryStatus,
      battery_status: metrics.batteryStatus,
      batteryLevelStatus: metrics.batteryStatus,
      battery_level_status: metrics.batteryStatus,
      chargingStatus: metrics.chargingStatus,
      charging_status: metrics.chargingStatus,
      chargeStatus: metrics.chargingStatus,
      charge_status: metrics.chargingStatus,
      chargingStatusText: metrics.chargingStatusText,
      charging_status_text: metrics.chargingStatusText,
      chargeStatusText: metrics.chargingStatusText,
      charge_status_text: metrics.chargingStatusText,
      heartRate: metrics.heartRate,
      heart_rate: metrics.heartRate,
      heartRateValue: metrics.heartRate,
      heart_rate_value: metrics.heartRate,
      HR: metrics.heartRate,
      hr: metrics.heartRate,
      heartRateStatus: metrics.heartRateStatus,
      heart_rate_status: metrics.heartRateStatus,
      heartbeatStatus: metrics.heartRateStatus,
      heartbeat_status: metrics.heartRateStatus,
      bloodOxygen: metrics.bloodOxygen,
      blood_oxygen: metrics.bloodOxygen,
      bloodOxygenSaturation: metrics.bloodOxygen,
      blood_oxygen_saturation: metrics.bloodOxygen,
      spo2: metrics.bloodOxygen,
      SpO2: metrics.bloodOxygen,
      SPO2: metrics.bloodOxygen,
      oxygen: metrics.bloodOxygen,
      oxygenSaturation: metrics.bloodOxygen,
      oxygen_saturation: metrics.bloodOxygen,
      bloodOxygenValue: metrics.bloodOxygen,
      blood_oxygen_value: metrics.bloodOxygen,
      bloodOxygenStatus: metrics.bloodOxygenStatus,
      blood_oxygen_status: metrics.bloodOxygenStatus,
      bloodOxygenSaturationStatus: metrics.bloodOxygenStatus,
      blood_oxygen_saturation_status: metrics.bloodOxygenStatus,
      spo2Status: metrics.bloodOxygenStatus,
      spo2_status: metrics.bloodOxygenStatus,
      SpO2Status: metrics.bloodOxygenStatus,
      SPO2Status: metrics.bloodOxygenStatus,
      temperature: metrics.temperature,
      temp: metrics.temperature,
      bodyTemperature: metrics.temperature,
      body_temperature: metrics.temperature,
      bodyTemp: metrics.temperature,
      body_temp: metrics.temperature,
      skinTemperature: metrics.temperature,
      skin_temperature: metrics.temperature,
      temperatureValue,
      temperature_value: temperatureValue,
      bodyTemperatureValue: temperatureValue,
      body_temperature_value: temperatureValue,
      bodyTempValue: temperatureValue,
      body_temp_value: temperatureValue,
      skinTemperatureValue: temperatureValue,
      skin_temperature_value: temperatureValue,
      temperatureStatus: metrics.temperatureStatus,
      temperature_status: metrics.temperatureStatus,
      bodyTemperatureStatus: metrics.temperatureStatus,
      body_temperature_status: metrics.temperatureStatus,
      bodyTempStatus: metrics.temperatureStatus,
      body_temp_status: metrics.temperatureStatus,
      skinTemperatureStatus: metrics.temperatureStatus,
      skin_temperature_status: metrics.temperatureStatus,
      hrv: metrics.hrv,
      HRV: metrics.hrv,
      heartRateVariability: metrics.hrv,
      heart_rate_variability: metrics.hrv,
      hrvValue: metrics.hrv,
      hrv_value: metrics.hrv,
      HRVValue: metrics.hrv,
      hrvStatus: metrics.hrvStatus,
      hrv_status: metrics.hrvStatus,
      HRVStatus: metrics.hrvStatus,
      heartRateVariabilityStatus: metrics.hrvStatus,
      heart_rate_variability_status: metrics.hrvStatus,
      stress: metrics.stress,
      stressIndex: metrics.stress,
      stress_index: metrics.stress,
      stressStatus: metrics.stressStatus,
      stress_status: metrics.stressStatus,
      stressIndexStatus: metrics.stressStatus,
      stress_index_status: metrics.stressStatus,
      bloodSugar: metrics.bloodSugar,
      blood_sugar: metrics.bloodSugar,
      glucose: metrics.bloodSugar,
      bloodSugarStatus: metrics.bloodSugarStatus,
      blood_sugar_status: metrics.bloodSugarStatus,
      glucoseStatus: metrics.bloodSugarStatus,
      glucose_status: metrics.bloodSugarStatus,
      bloodPressure: metrics.bloodPressure,
      blood_pressure: metrics.bloodPressure,
      bloodPressureSystolic: bloodPressureSystolic.value,
      blood_pressure_systolic: bloodPressureSystolic.value,
      bloodPressureHigh: bloodPressureSystolic.value,
      blood_pressure_high: bloodPressureSystolic.value,
      highPressure: bloodPressureSystolic.value,
      high_pressure: bloodPressureSystolic.value,
      high: bloodPressureSystolic.value,
      systolic: bloodPressureSystolic.value,
      sbp: bloodPressureSystolic.value,
      bloodPressureDiastolic: bloodPressureDiastolic.value,
      blood_pressure_diastolic: bloodPressureDiastolic.value,
      bloodPressureLow: bloodPressureDiastolic.value,
      blood_pressure_low: bloodPressureDiastolic.value,
      lowPressure: bloodPressureDiastolic.value,
      low_pressure: bloodPressureDiastolic.value,
      low: bloodPressureDiastolic.value,
      diastolic: bloodPressureDiastolic.value,
      dbp: bloodPressureDiastolic.value,
      bloodPressureStatus: metrics.bloodPressureStatus,
      blood_pressure_status: metrics.bloodPressureStatus,
      stepCount: metrics.stepCount,
      step_count: metrics.stepCount,
      steps: metrics.stepCount,
      step: metrics.stepCount,
      calorie: metrics.calorie,
      calories: metrics.calorie,
      kcal: metrics.calorie,
      motionCalorie: metrics.calorie,
      motion_calorie: metrics.calorie,
      activityCalorie: metrics.calorie,
      activity_calorie: metrics.calorie,
      activityMinutes: metrics.activityMinutes,
      activity_minutes: metrics.activityMinutes,
      activeMinutes: metrics.activityMinutes,
      active_minutes: metrics.activityMinutes,
      motionTime: metrics.activityMinutes,
      motion_time: metrics.activityMinutes,
      activityLevel: metrics.activityLevel,
      activity_level: metrics.activityLevel,
      motionLevel: metrics.activityLevel,
      motion_level: metrics.activityLevel,
      intensity: metrics.activityLevel,
      intensityLevel: metrics.activityLevel,
      intensity_level: metrics.activityLevel,
      distance: metrics.distance,
      distanceKm: metrics.distance,
      distance_km: metrics.distance,
      mileage: metrics.distance,
      isWorn: metrics.isWorn,
      is_worn: metrics.isWorn,
      worn: metrics.isWorn,
      sleepTotalMinutes: metrics.sleepTotalMinutes,
      sleep_total_minutes: metrics.sleepTotalMinutes,
      sleep: metrics.sleepTotalMinutes,
      sleepDeepMinutes: metrics.sleepDeepMinutes,
      sleep_deep_minutes: metrics.sleepDeepMinutes,
      sleepLightMinutes: metrics.sleepLightMinutes,
      sleep_light_minutes: metrics.sleepLightMinutes,
      sleepRemMinutes: metrics.sleepRemMinutes,
      sleep_rem_minutes: metrics.sleepRemMinutes,
      sleepAwakeMinutes: metrics.sleepAwakeMinutes,
      sleep_awake_minutes: metrics.sleepAwakeMinutes,
      sleepStatus: metrics.sleepStatus,
      sleep_status: metrics.sleepStatus,
      fatigue: metrics.fatigue,
      fatigueLevel: metrics.fatigueLevel,
      fatigue_level: metrics.fatigueLevel,
      anxiety: metrics.anxiety,
      anxietyLevel: metrics.anxietyLevel,
      anxiety_level: metrics.anxietyLevel,
      alarmText: metrics.alarmText,
      alarm_text: metrics.alarmText,
      firmwareVersion: metrics.firmwareVersion || metrics.hardwareVersion,
      firmware_version: metrics.firmwareVersion || metrics.hardwareVersion,
      firmware: metrics.firmwareVersion || metrics.hardwareVersion,
      firmwareVer: metrics.firmwareVersion || metrics.hardwareVersion,
      firmware_ver: metrics.firmwareVersion || metrics.hardwareVersion,
      hardwareVersion: metrics.hardwareVersion || metrics.firmwareVersion,
      hardware_version: metrics.hardwareVersion || metrics.firmwareVersion,
      hardware: metrics.hardwareVersion || metrics.firmwareVersion,
      hardwareVer: metrics.hardwareVersion || metrics.firmwareVersion,
      hardware_ver: metrics.hardwareVersion || metrics.firmwareVersion,
      softwareVersion: metrics.softwareVersion || metrics.uiVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      software_version: metrics.softwareVersion || metrics.uiVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      software: metrics.softwareVersion || metrics.uiVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      softwareVer: metrics.softwareVersion || metrics.uiVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      software_ver: metrics.softwareVersion || metrics.uiVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      uiVersion: metrics.uiVersion || metrics.softwareVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      ui_version: metrics.uiVersion || metrics.softwareVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      ui: metrics.uiVersion || metrics.softwareVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      uiVer: metrics.uiVersion || metrics.softwareVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      ui_ver: metrics.uiVersion || metrics.softwareVersion || metrics.firmwareVersion || metrics.hardwareVersion,
      screenWidth: metrics.screenWidth,
      screen_width: metrics.screenWidth,
      screenHeight: metrics.screenHeight,
      screen_height: metrics.screenHeight,
      deviceTimestamp: metrics.deviceTimestamp,
      device_timestamp: metrics.deviceTimestamp,
      timezone: metrics.timezone,
      collectPeriodSeconds: metrics.collectPeriodSeconds,
      collect_period_seconds: metrics.collectPeriodSeconds,
      collectPeriodMinutes: metrics.collectPeriodMinutes,
      collect_period_minutes: metrics.collectPeriodMinutes,
      monitoringStatus: metrics.monitoringStatus,
      monitoring_status: metrics.monitoringStatus,
      monitoring: metrics.monitoring,
      historyStatus: metrics.historyStatus,
      history_status: metrics.historyStatus,
      historyMessage: metrics.historyMessage,
      history_message: metrics.historyMessage,
      lastMetricUpdateAt: lastMetricUpdateAt.value,
      last_metric_update_at: lastMetricUpdateAt.value,
      rawHealthData: metrics.healthData,
      raw_health_data: metrics.healthData,
      source: metrics
    };
  });

  const clearMetricSnapshot = () => {
    metricSnapshot.value = {};
    metricSnapshotDeviceKey.value = '';
  };

  const clearBusinessRuntimeData = () => {
    receivedData.value = [];
    normalizedData.value = [];
    historyRecords.value = [];
    localData.value = [];
    lastMetricUpdateAt.value = 0;
    clearMetricSnapshot();
  };

  const clearHistoryRuntimeData = () => {
    receivedData.value = receivedData.value.filter((item) => !isHistoryParsedData(item));
    historyRecords.value = [];
    localData.value = [];
  };

  watch(
    [rawLatestMetrics, normalizedData, () => getDeviceSnapshotKey(deviceInfo.value)],
    ([currentMetrics, records, deviceKey]) => {
      if (records.length > 0 && hasAnyBusinessMetricValue(currentMetrics)) {
        lastMetricUpdateAt.value = Date.now();
      }

      if (!deviceKey || records.length === 0) {
        if (records.length === 0) {
          lastMetricUpdateAt.value = 0;
        }
        clearMetricSnapshot();
        return;
      }

      if (metricSnapshotDeviceKey.value && metricSnapshotDeviceKey.value !== deviceKey) {
        metricSnapshot.value = {};
      }

      metricSnapshotDeviceKey.value = deviceKey;
      metricSnapshot.value = mergeRingBusinessMetricSnapshot(currentMetrics, metricSnapshot.value);
    },
    { deep: true, immediate: true }
  );

  const setDevices = (payload: RingDeviceInfo[]) => {
    devices.value = payload.map(normalizeStoreDeviceInfo);
  };

  const setDeviceInfo = (payload: RingDeviceInfo) => {
    const previousKey = getDeviceSnapshotKey(deviceInfo.value);
    const normalizedPayload = normalizeStoreDeviceInfo(payload);
    const nextKey = getDeviceSnapshotKey(normalizedPayload);
    if (previousKey && previousKey !== nextKey && hasAnyRuntimeBusinessData()) {
      clearBusinessRuntimeData();
    }
    deviceInfo.value = normalizedPayload;
    syncRwStableDeviceIdentity(normalizedPayload);
    const ready = hasReadyCommunicationFields(normalizedPayload);
    isConnected.value = ready;
    if (ready) {
      reconnectStatus.value = 'success';
      reconnectResult.value = true;
    } else if (reconnectStatus.value === 'success') {
      reconnectStatus.value = normalizedPayload.deviceId ? 'reconnecting' : 'idle';
      reconnectResult.value = null;
    }
  };

  const setBoundDevice = (payload: RingBoundDevice | null) => {
    boundDevice.value = payload;
  };

  const setReceivedData = (payload: RingParsedData[]) => {
    if (payload.length === 0 && hasAnyRuntimeBusinessData()) {
      clearBusinessRuntimeData();
      return;
    }
    receivedData.value = payload;
  };

  const appendReceivedData = (payload: RingParsedData) => {
    const parsedKey = getParsedDataKey(payload);
    const next = parsedKey
      ? receivedData.value.filter((item) => getParsedDataKey(item) !== parsedKey)
      : [...receivedData.value];
    next.push(payload);
    receivedData.value = next.length > 20 ? next.slice(next.length - 20) : next;
  };

  const setNormalizedData = (payload: any[]) => {
    if (payload.length === 0 && hasAnyRuntimeBusinessData()) {
      clearBusinessRuntimeData();
      return;
    }
    normalizedData.value = payload;
  };

  const appendNormalizedData = (payload: any) => {
    const payloadKey = getNormalizedDataKey(payload);
    let nextPayload = payload;
    if (payloadKey === 'battery' && getNormalizedBatteryMetricValue(payload) == null) {
      const previousBattery = normalizedData.value.find((item) => getNormalizedDataKey(item) === payloadKey);
      if (previousBattery && getNormalizedBatteryMetricValue(previousBattery) != null) {
        nextPayload = {
          ...payload,
          metrics: {
            ...(previousBattery.metrics || {}),
            ...(payload.metrics || {}),
            battery: previousBattery.metrics?.battery ?? previousBattery.metrics?.value ?? previousBattery.metrics?.batteryValue
          }
        };
      }
    }
    const next = payloadKey
      ? normalizedData.value.filter((item) => getNormalizedDataKey(item) !== payloadKey)
      : [...normalizedData.value];
    next.push(nextPayload);
    normalizedData.value = next.length > 50 ? next.slice(next.length - 50) : next;
  };

  const appendHistoryRecords = (records: RingHistoricalRecord[]) => {
    historyRecords.value = mergeHistoryRecords(historyRecords.value, records);
    localData.value = mergeHistoryRecords(localData.value, records);
  };

  const setLocalData = (records: RingHistoricalRecord[]) => {
    localData.value = records;
  };

  const setNormalMac = (mac: string) => {
    normalMac.value = mac;
    uni.setStorageSync(NORMAL_MAC_KEY, mac);
  };

  const setIosMacId = (mac: string) => {
    iosMacId.value = mac;
    uni.setStorageSync(IOS_MAC_KEY, mac);
  };

  const syncRwStableDeviceIdentity = (device: RingDeviceInfo) => {
    if (device.protocol !== 'rw') return;
    const stableMac = device.mac || device.advertis?.macInfo;
    if (!stableMac) return;

    const shouldSync = (storedIdentity: string) =>
      !storedIdentity || !hasMatchingStableDeviceIdentity([storedIdentity], [stableMac]);
    if (shouldSync(normalMac.value)) setNormalMac(stableMac);
    if (shouldSync(iosMacId.value)) setIosMacId(stableMac);
  };

  const markReadyConnection = () => {
    isConnected.value = true;
    reconnectStatus.value = 'success';
    reconnectResult.value = true;
  };

  const setConnected = (connected: boolean) => {
    if (!connected && hasReadyCommunicationFields(deviceInfo.value)) {
      markReadyConnection();
      return;
    }

    isConnected.value = connected;
    if (connected && hasReadyCommunicationFields(deviceInfo.value)) {
      markReadyConnection();
    } else if (!connected && reconnectStatus.value === 'success') {
      reconnectStatus.value = 'idle';
      reconnectResult.value = null;
    }
  };

  const handleParsedData = (parsed: RingParsedData | null | undefined) => {
    if (!parsed?.type) return;
    if (!isParsedDataForCurrentDevice(deviceInfo.value, parsed)) return;

    if (parsed.type === 'local_data') {
      if (parsed.status === 'no_data' || parsed.status === 'empty' || parsed.status === 'filtered') {
        const resetDataType = getHistoryResetDataType(parsed as Record<string, any>);
        localData.value = resetDataType
          ? localData.value.filter((record) => getNormalizedHistoryRecordDataType(record) !== resetDataType)
          : [];
      } else if (Array.isArray(parsed.records)) {
        const records = parsed.records.map((record) => withHistoryRecordContext(record, parsed));
        const newRecords = records.filter(
          (record) => !localData.value.some((existing) => getHistoryRecordKey(existing) === getHistoryRecordKey(record))
        );
        localData.value = [...localData.value, ...newRecords].sort(
          (left, right) => getHistoryRecordSortTime(right) - getHistoryRecordSortTime(left)
        );
      }
    }

    if (parsed.type === 'rw_upload_file') {
      const source = parsed as Record<string, any>;
      const uploadRecords = Array.isArray(source.records) && source.records.length > 0 ? source.records : [source];
      const records = uploadRecords.map((record) => withRwUploadFileRecordContext(record as RingHistoricalRecord, parsed));
      localData.value = mergeHistoryRecords(localData.value, records);
    }

    if (parsed.type === 'rw_file_list') {
      const source = parsed as Record<string, any>;
      const files = Array.isArray(source.selectedFiles) ? source.selectedFiles : Array.isArray(source.files) ? source.files : [];
      if (files.length === 0) {
        const resetDataType = getHistoryResetDataType(source);
        localData.value = resetDataType
          ? localData.value.filter((record) => getNormalizedHistoryRecordDataType(record) !== resetDataType)
          : [];
      } else {
        const records = files.map((file: Record<string, any>) => withRwFileListRecordContext(file, parsed));
        localData.value = mergeHistoryRecords(localData.value, records);
      }
    }

    if (parsed.type === 'device_time' && typeof parsed.timestamp === 'number') {
      deviceTime.value = typeof parsed.deviceTimestamp === 'number' ? parsed.deviceTimestamp : parsed.timestamp;
    }

    const parsedKey = getParsedDataKey(parsed);
    const next = parsedKey
      ? receivedData.value.filter((item) => getParsedDataKey(item) !== parsedKey)
      : [...receivedData.value];
    next.push(parsed);
    receivedData.value = next.length > 20 ? next.slice(next.length - 20) : next;

    const normalized = normalizeRingData(parsed);
    if (normalized) {
      appendNormalizedData(normalized);
    }
  };

  const setLastReadTimestamp = (timestamp: number) => {
    lastReadTimestamp.value = timestamp;
    uni.setStorageSync(LAST_READ_TIMESTAMP_KEY, timestamp);
  };

  const resetLastReadTimestamp = () => {
    lastReadTimestamp.value = 0;
    uni.removeStorageSync(LAST_READ_TIMESTAMP_KEY);
  };

  const setBluetoothReady = (ready: boolean) => {
    isBluetoothReady.value = ready;
  };

  const setScanning = (scanning: boolean) => {
    isScanning.value = scanning;
  };

  const setListenerRegistered = (registered: boolean) => {
    isListenerRegistered.value = registered;
  };

  const setHasRegisteredAdapterListener = (registered: boolean) => {
    hasRegisteredAdapterListener.value = registered;
  };

  const setManualReconnecting = (reconnecting: boolean) => {
    isManualReconnecting.value = reconnecting;
  };

  const setMinePageButtomClick = (clicked: boolean) => {
    isMinePageButtomClick.value = clicked;
  };

  const setUnbinding = (unbinding: boolean) => {
    isUnbinding.value = unbinding;
  };

  const setSending = (sending: boolean) => {
    isSending.value = sending;
  };

  const setReconnectStatus = (status: LegacyReconnectStatus) => {
    const normalizedStatus = normalizeReconnectStatus(status);
    if (hasReadyCommunicationFields(deviceInfo.value)) {
      markReadyConnection();
      return;
    }
    reconnectStatus.value = normalizedStatus;
  };

  const setReconnectResult = (success: boolean | null) => {
    if (hasReadyCommunicationFields(deviceInfo.value) && success !== true) {
      markReadyConnection();
      return;
    }
    reconnectResult.value = success;
  };

  const setUploadingStatus = (status: LegacyUploadingStatus) => {
    uploadingStatus.value = normalizeUploadingStatus(status);
  };

  const clearRuntime = () => {
    deviceInfo.value = {};
    clearBusinessRuntimeData();
    reconnectStatus.value = 'idle';
    reconnectResult.value = null;
    uploadingStatus.value = 'idle';
    isSending.value = false;
    isConnected.value = false;
  };

  const hasAnyRuntimeBusinessData = () =>
    receivedData.value.length > 0 ||
    normalizedData.value.length > 0 ||
    localData.value.length > 0 ||
    lastMetricUpdateAt.value > 0 ||
    Object.keys(metricSnapshot.value).length > 0;

  return {
    devices,
    deviceInfo,
    boundDevice,
    receivedData,
    normalizedData,
    historyRecords,
    localData,
    normalMac,
    iosMacId,
    deviceTime,
    lastReadTimestamp,
    isBluetoothReady,
    isScanning,
    isListenerRegistered,
    hasRegisteredAdapterListener,
    isManualReconnecting,
    isMinePageButtomClick,
    isUnbinding,
    isSending,
    isConnected,
    isReconnecting,
    isUploading,
    latestMetrics,
    healthData,
    lastMetricUpdateAt,
    reconnectStatus,
    reconnectResult,
    uploadingStatus,
    setDevices,
    setDeviceInfo,
    setBoundDevice,
    setReceivedData,
    appendReceivedData,
    setNormalizedData,
    appendNormalizedData,
    appendHistoryRecords,
    setLocalData,
    setNormalMac,
    updateNormalMac: setNormalMac,
    setIosMacId,
    updateIosMacId: setIosMacId,
    setConnected,
    updateIsConnected: setConnected,
    handleParsedData,
    setLastReadTimestamp,
    updateLastReadTimestamp: setLastReadTimestamp,
    resetLastReadTimestamp,
    clearBusinessRuntimeData,
    setBluetoothReady,
    updateIsBluetoothReady: setBluetoothReady,
    setScanning,
    setListenerRegistered,
    updateIsListenerRegistered: setListenerRegistered,
    setHasRegisteredAdapterListener,
    updateHasRegisteredAdapterListener: setHasRegisteredAdapterListener,
    setManualReconnecting,
    updateIsManualReconnecting: setManualReconnecting,
    setMinePageButtomClick,
    updateIsMinePageButtomClick: setMinePageButtomClick,
    setUnbinding,
    updateIsUnbinding: setUnbinding,
    setSending,
    updateIsSending: setSending,
    setReconnectStatus,
    updateReconnectingStatus: setReconnectStatus,
    setReconnectResult,
    updateReconnectResult: setReconnectResult,
    setUploadingStatus,
    updateUploadingStatus: setUploadingStatus,
    updateDeviceInfo: setDeviceInfo,
    updateReceivedData: setReceivedData,
    clearHistoryRuntimeData,
    clearRuntime
  };
});

function hasReadyCommunicationFields(device: RingDeviceInfo) {
  return Boolean(device.deviceId && device.serviceId && device.cmdCharId && device.dataCharId);
}

function normalizeStoreDeviceInfo(device: RingDeviceInfo) {
  const protocol = device.protocol || resolveRingProtocol(device);
  if (protocol !== 'rw') return device;
  const stableMac = device.mac || device.advertis?.macInfo;
  if (!stableMac && device.protocol === protocol) return device;
  return {
    ...device,
    protocol,
    ...(stableMac && !device.mac ? { mac: stableMac } : {})
  };
}

function getDeviceSnapshotKey(device: RingDeviceInfo) {
  if (device.protocol === 'rw') {
    const stableIdentity = device.mac || device.advertis?.macInfo;
    if (stableIdentity) return normalizeMacSnapshotKey(stableIdentity) || String(stableIdentity).trim();

    const legacyStableIdentity = isColonSeparatedBleMac(device.uniMacId)
      ? device.uniMacId
      : isColonSeparatedBleMac(device.deviceId)
        ? device.deviceId
        : '';
    if (legacyStableIdentity) return normalizeMacSnapshotKey(legacyStableIdentity) || String(legacyStableIdentity).trim();

    return String(device.deviceId || device.uniMacId || '').trim();
  }

  return (
    normalizeMacSnapshotKey(device.mac) ||
    normalizeMacSnapshotKey(device.advertis?.macInfo) ||
    normalizeMacSnapshotKey(device.uniMacId) ||
    String(device.uniMacId || device.deviceId || '').trim()
  );
}

function getRawDeviceIdentityIds(source: Record<string, any> = {}) {
  return [source.deviceId, source.uniMacId, source.mac, source.advertis?.macInfo].filter(Boolean);
}

function getStableDeviceIdentityIds(source: Record<string, any> = {}, protocolHint = '') {
  const protocol = source.protocol || protocolHint;
  if (protocol === 'rw') {
    return [
      source.mac,
      source.advertis?.macInfo,
      isColonSeparatedBleMac(source.uniMacId) ? source.uniMacId : '',
      isColonSeparatedBleMac(source.deviceId) ? source.deviceId : ''
    ].filter(Boolean);
  }
  return getRawDeviceIdentityIds(source);
}

function getDeviceIdentityScope(source: Record<string, any> = {}, protocolHint = '') {
  return {
    ids: getStableDeviceIdentityIds(source, protocolHint),
    hadIdentity: getRawDeviceIdentityIds(source).length > 0
  };
}

function hasOnlyRawDeviceIdIdentity(source: Record<string, any> = {}) {
  return Boolean(source.deviceId) && !source.uniMacId && !source.mac && !source.advertis?.macInfo;
}

function hasSameRawDeviceId(left: Record<string, any> = {}, right: Record<string, any> = {}) {
  return Boolean(left.deviceId && right.deviceId && left.deviceId === right.deviceId);
}

function hasMatchingStableDeviceIdentity(leftIds: unknown[], rightIds: unknown[]) {
  const leftRaw = leftIds.map((value) => String(value || '').trim()).filter(Boolean);
  const rightRaw = rightIds.map((value) => String(value || '').trim()).filter(Boolean);
  if (leftRaw.some((left) => rightRaw.includes(left))) return true;

  const leftNormalized = leftRaw.map(normalizeMacSnapshotKey).filter((value) => value.length >= 6);
  const rightNormalized = rightRaw.map(normalizeMacSnapshotKey).filter((value) => value.length >= 6);
  return leftNormalized.some((left) =>
    rightNormalized.some((right) => left.endsWith(right.slice(-6)) || right.endsWith(left.slice(-6)))
  );
}

function isParsedDataForCurrentDevice(currentDevice: RingDeviceInfo, parsed: RingParsedData) {
  const currentScope = getDeviceIdentityScope(currentDevice, parsed.protocol);
  if (!currentScope.hadIdentity) return true;

  const parsedScope = getDeviceIdentityScope(parsed, currentDevice.protocol);
  if (parsed.protocol && currentDevice.protocol && parsed.protocol !== currentDevice.protocol && parsedScope.hadIdentity) {
    return false;
  }
  if (!parsedScope.hadIdentity) return true;

  const isRwScope = parsed.protocol === 'rw' || currentDevice.protocol === 'rw';
  if (isRwScope) {
    if (parsedScope.ids.length === 0 || currentScope.ids.length === 0) {
      return (
        parsedScope.ids.length === 0 &&
        currentScope.ids.length === 0 &&
        hasSameRawDeviceId(currentDevice, parsed) &&
        hasOnlyRawDeviceIdIdentity(parsed)
      );
    }
    return hasMatchingStableDeviceIdentity(currentScope.ids, parsedScope.ids);
  }

  return hasMatchingStableDeviceIdentity(currentScope.ids, parsedScope.ids);
}

function normalizeMacSnapshotKey(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hex = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  const looksLikeMac = raw.includes(':') || raw.includes('-') || /^[a-fA-F0-9]{6,12}$/.test(raw);
  if (!looksLikeMac || hex.length < 6 || hex.length > 12) return '';
  return hex;
}

function withHistoryRecordContext(record: RingHistoricalRecord, parsed: RingParsedData) {
  const source = parsed as Record<string, any>;
  const target = record as Record<string, any>;
  const hasIdentity = target.mac || target.advertis?.macInfo || target.uniMacId || target.deviceId;
  if (target.protocol && hasIdentity) return record;

  return {
    ...target,
    protocol: target.protocol || source.protocol,
    mac: target.mac || source.mac,
    advertis: target.advertis || source.advertis,
    uniMacId: target.uniMacId || source.uniMacId,
    deviceId: target.deviceId || source.deviceId
  } as RingHistoricalRecord;
}

function withRwUploadFileRecordContext(record: RingHistoricalRecord, parsed: RingParsedData) {
  const source = parsed as Record<string, any>;
  const target = withHistoryRecordContext(record, parsed) as Record<string, any>;
  const parsedFileTime = parseHistoryFileTimestamp(source.timestampText);
  const recordTime = getHistoryRecordSortTime(target);

  return {
    ...target,
    protocol: target.protocol || 'rw',
    sourceType: target.sourceType || 'rw_upload_file',
    dataType: target.dataType || source.dataType || getRwFileHistoryDataType(source.fileType, source.fileName),
    rawDataType: target.rawDataType || source.rawDataType || source.fileType || '',
    fileName: target.fileName || source.fileName,
    fileType: target.fileType || source.fileType,
    seq: target.seq ?? source.seq,
    fileSeq: target.fileSeq ?? source.seq,
    status: target.status || source.status,
    unixTime: target.unixTime ?? (recordTime || source.startTimestamp || parsedFileTime || undefined)
  } as RingHistoricalRecord;
}

function withRwFileListRecordContext(file: Record<string, any>, parsed: RingParsedData) {
  const source = parsed as Record<string, any>;
  const parsedFileTime = parseHistoryFileTimestamp(file.timestampText);
  return withHistoryRecordContext(
    {
      ...file,
      protocol: 'rw',
      sourceType: 'rw_file_list',
      status: file.status || 'pending_upload_payload',
      dataType: getRwFileHistoryDataType(file.fileType, file.fileName),
      rawDataType: file.fileType || '',
      unixTime: file.unixTime || parsedFileTime || undefined
    } as RingHistoricalRecord,
    parsed
  );
}

function getHistoryRecordDeviceKey(record: RingHistoricalRecord) {
  const source = record as Record<string, any>;
  const stableIdentity = source.mac || source.advertis?.macInfo;
  if (stableIdentity) return normalizeMacSnapshotKey(stableIdentity) || String(stableIdentity).trim();

  if (source.protocol === 'rw') {
    const legacyStableIdentity = isColonSeparatedBleMac(source.uniMacId)
      ? source.uniMacId
      : isColonSeparatedBleMac(source.deviceId)
        ? source.deviceId
        : '';
    if (legacyStableIdentity) return normalizeMacSnapshotKey(legacyStableIdentity) || String(legacyStableIdentity).trim();
    return String(source.deviceId || source.uniMacId || '').trim();
  }

  const fallbackIdentity = source.uniMacId || source.deviceId || '';
  return normalizeMacSnapshotKey(fallbackIdentity) || String(fallbackIdentity || '').trim();
}

function getHistoryRecordKey(record: RingHistoricalRecord) {
  const source = record as Record<string, any>;
  const protocol = source.protocol || '';
  const deviceKey = getHistoryRecordDeviceKey(record);
  const time = getHistoryRecordSortTime(record) || '';
  const dataType =
    getHistoryRecordField(record, 'dataType') ||
    getHistoryRecordField(record, 'rawDataType') ||
    getHistoryRecordField(record, 'fileType') ||
    getHistoryRecordField(record, 'metricType') ||
    '';
  const fileIdentity =
    getHistoryRecordField(record, 'fileName') ||
    getHistoryRecordField(record, 'seq') ||
    getHistoryRecordField(record, 'fileSeq') ||
    '';
  const metricIdentity = dataType || fileIdentity;
  if (time || metricIdentity || protocol || deviceKey) return `${protocol}:${deviceKey}:${time}:${String(metricIdentity).toLowerCase()}`;
  return JSON.stringify(record);
}

function mergeHistoryRecords(existing: RingHistoricalRecord[], incoming: RingHistoricalRecord[]) {
  const seen = new Set(existing.map(getHistoryRecordKey));
  const next = [...existing];
  incoming.forEach((record) => {
    const key = getHistoryRecordKey(record);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(record);
  });
  return next.sort((left, right) => getHistoryRecordSortTime(right) - getHistoryRecordSortTime(left));
}

function getHistoryResetDataType(source: Record<string, any>) {
  return normalizeHistoryDataType(source.dataType || source.rawDataType || source.fileType);
}

function getNormalizedHistoryRecordDataType(record: RingHistoricalRecord) {
  return normalizeHistoryDataType(
    getHistoryRecordField(record, 'dataType') ||
      getHistoryRecordField(record, 'rawDataType') ||
      getHistoryRecordField(record, 'fileType') ||
      getHistoryRecordField(record, 'metricType')
  );
}

function normalizeHistoryDataType(value: unknown) {
  const normalized = `${value || ''}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (!compact) return '';
  if (compact === 'sleep' || compact === 'sleepdata' || compact === 'sleepdetail' || compact === 'sleepdetails') return 'sleep';
  if (compact === 'step' || compact === 'steps' || compact === 'stepcount' || compact === 'sport' || compact === 'activity' || compact === 'dailyactivity') {
    return 'step';
  }
  if (compact === 'hr' || compact === 'heartrate' || compact === 'heartrateraw') return 'heart_rate';
  if (compact === 'spo2' || compact === 'bloodoxygen' || compact === 'bloodoxygenraw' || compact === 'oxygen') return 'blood_oxygen';
  if (compact === 'bodytemperature' || compact === 'bodytemp' || compact === 'skintemperature' || compact === 'skintemp' || compact === 'temperature') {
    return 'temperature';
  }
  if (compact === 'bp' || compact === 'bloodpressure') return 'blood_pressure';
  if (compact === 'bs' || compact === 'glucose' || compact === 'bloodsugar') return 'blood_sugar';
  return normalized;
}

function getRwFileHistoryDataType(fileType?: unknown, fileName?: unknown) {
  const value = `${fileType || ''}_${fileName || ''}`.toLowerCase();
  if (/sleep/.test(value)) return 'sleep';
  if (/step|sport|activity/.test(value)) return 'step';
  if (/hrv/.test(value)) return 'hrv';
  if (/blood[_-]?pressure|(^|[_\-.])bp($|[_\-.])/.test(value)) return 'blood_pressure';
  if (/blood[_-]?sugar|glucose|\bbs\b/.test(value)) return 'blood_sugar';
  if (/stress|(^|[_\-.])pressure($|[_\-.])|fatigue/.test(value)) return 'stress';
  if (/spo2|oxygen|blood[_-]?oxy|\bbo\b|red|ir/.test(value)) return 'blood_oxygen_raw';
  if (/temperature|temp|body[_-]?temp|skin[_-]?temp/.test(value)) return 'temperature';
  if (/heart|heart[_-]?rate|(^|[_\-.])hr($|[_\-.])/.test(value)) return 'heart_rate_raw';
  return `${fileType || 'history_file'}`;
}

function getHistoryRecordSortTime(record: RingHistoricalRecord) {
  const value = Number(
    getHistoryRecordField(record, 'unixTime') ??
      getHistoryRecordField(record, 'timestamp') ??
      getHistoryRecordField(record, 'time') ??
      parseHistoryRecordTime(getHistoryRecordField(record, 'recordTime')) ??
      0
  );
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function getHistoryRecordField(record: RingHistoricalRecord, field: string) {
  const source = record as Record<string, any>;
  if (Object.prototype.hasOwnProperty.call(source, field)) return source[field];
  const normalizedField = field.toLowerCase();
  const matchedKey = Object.keys(source).find((key) => key.toLowerCase() === normalizedField);
  return matchedKey ? source[matchedKey] : undefined;
}

function parseHistoryRecordTime(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const timestamp = Date.parse(value.trim().replace(/-/g, '/'));
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 1000);
}

function parseHistoryFileTimestamp(value: unknown) {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value.trim())) return 0;
  const text = value.trim();
  const timestamp = Date.parse(
    `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`
  );
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 1000);
}

function isColonSeparatedBleMac(value?: unknown) {
  return /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());
}

function hasAnyBusinessMetricValue(metrics: RingBusinessMetrics) {
  return (
    metrics.battery != null ||
    metrics.heartRate != null ||
    metrics.bloodOxygen != null ||
    metrics.temperature != null ||
    metrics.hrv != null ||
    metrics.stress != null ||
    metrics.bloodSugar != null ||
    metrics.bloodPressure != null ||
    metrics.stepCount != null ||
    metrics.calorie != null ||
    metrics.activityMinutes != null ||
    metrics.activityLevel != null ||
    metrics.distance != null ||
    metrics.sleepTotalMinutes != null ||
    Boolean(metrics.firmwareVersion || metrics.hardwareVersion || metrics.softwareVersion || metrics.uiVersion)
  );
}
