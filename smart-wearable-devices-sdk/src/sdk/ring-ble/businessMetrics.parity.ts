// @ts-nocheck
import {
  buildRingBusinessMetrics,
  createEmptyRingBusinessMetrics,
  isRingHistoryInProgress,
  mergeRingBusinessMetricSnapshot
} from './businessMetrics';
import { normalizeRingData } from './legacy/normalizer';
var metrics = buildRingBusinessMetrics([
  {
    sourceType: "battery",
    metrics: {
      battery: 100,
      batteryStatus: "\u672A\u5145\u7535",
      chargingStatus: 16
    }
  },
  {
    sourceType: "firmware_version",
    metrics: {
      firmwareVersion: "2.2.9",
      hardwareVersion: "2.2.9",
      softwareVersion: "303e0001",
      uiVersion: "303e0001",
      screenWidth: 48,
      screenHeight: 64
    }
  },
  {
    sourceType: "rw_health_monitoring",
    metrics: {
      name: "heart_rate",
      enabled: false,
      interval: 30
    }
  },
  {
    sourceType: "rw_health_monitoring_ack",
    metrics: {
      name: "spo2",
      success: true,
      status: "success"
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "heart_rate",
      data: [72]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_oxygen",
      data: [98]
    }
  },
  {
    sourceType: "rw_health_data_ack",
    metrics: {
      name: "temperature",
      data: [],
      message: "\u5DF2\u8BF7\u6C42\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5"
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "blood_sugar",
      status: "pending",
      message: "\u8BBE\u5907\u672A\u8FD4\u56DE\u771F\u5B9E\u6570\u503C"
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_sugar",
      value: 6,
      data: [6]
    }
  },
  {
    sourceType: "rw_history_pending",
    metrics: {
      status: "pending",
      message: "RW \u5386\u53F2\u540C\u6B65\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5"
    }
  }
]);
if (metrics.battery !== 100 || metrics.batteryStatus !== "\u672A\u5145\u7535" || metrics.firmwareVersion !== "2.2.9" || metrics.monitoring.heart_rate?.interval !== 30 || metrics.monitoring.spo2?.status !== "success" || metrics.monitoring.blood_oxygen?.status !== "success" || metrics.monitoring.blood_oxygen?.originalName !== "spo2" || metrics.collectPeriodSeconds !== 1800 || metrics.collectPeriodMinutes !== 30 || metrics.monitoringStatus !== "\u76D1\u542C\u914D\u7F6E\u5DF2\u4E0B\u53D1" || metrics.heartRate !== 72 || metrics.bloodOxygen !== 98 || metrics.bloodSugar !== 6 || metrics.temperatureStatus !== "\u5DF2\u8BF7\u6C42\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5" || metrics.historyStatus !== "pending") {
  throw new Error(`Unexpected ring business metrics: ${JSON.stringify(metrics)}`);
}
var normalizedBatteryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "battery",
    metrics: {
      battery: "78%",
      batteryStatus: "normal"
    }
  },
  {
    sourceType: "battery",
    metrics: {
      battery: 101,
      batteryStatus: "charging"
    }
  }
]);
if (normalizedBatteryMetrics.battery !== 78 || normalizedBatteryMetrics.batteryStatus !== "charging") {
  throw new Error(
    `Battery metrics should keep L19-compatible numeric percentage and ignore RW status codes as percentages: ${JSON.stringify(normalizedBatteryMetrics)}`
  );
}
var singleFirmwareMetrics = buildRingBusinessMetrics([
  {
    sourceType: "firmware_version",
    metrics: {
      firmwareVersion: "2.3.8.91",
      hardwareVersion: "2.3.8.91",
      protocol: "rw"
    }
  }
]);
if (singleFirmwareMetrics.firmwareVersion !== "2.3.8.91" || singleFirmwareMetrics.hardwareVersion !== "2.3.8.91" || singleFirmwareMetrics.softwareVersion !== "2.3.8.91" || singleFirmwareMetrics.uiVersion !== "2.3.8.91") {
  throw new Error(
    `Single-version RW firmware payload should fill latest firmware/software aliases: ${JSON.stringify(singleFirmwareMetrics)}`
  );
}
var typedRwFileList = normalizeRingData({
  type: "rw_file_list",
  dataType: "blood_pressure",
  files: [{ fileName: "u1_20260101010303_bp.txt", fileType: "bp" }],
  selectedFiles: [{ fileName: "u1_20260101010303_bp.txt", fileType: "bp" }],
  totalFileCount: 4,
  selectedFileCount: 1,
  filteredFileCount: 3
});
var typedLocalData = normalizeRingData({
  type: "local_data",
  protocol: "rw",
  dataType: "blood_pressure",
  status: "success",
  records: [{ dataType: "blood_pressure", value: "121/80" }],
  totalFileCount: 4,
  selectedFileCount: 1,
  filteredFileCount: 3
});
var typedHistoryMetrics = buildRingBusinessMetrics([typedRwFileList, typedLocalData]);
var typedBloodPressure = typedHistoryMetrics.bloodPressure;
if (typedRwFileList?.metrics.dataType !== "blood_pressure" || typedLocalData?.metrics.dataType !== "blood_pressure" || typedHistoryMetrics.historyDataType !== "blood_pressure" || typedBloodPressure?.systolic !== 121 || typedBloodPressure?.diastolic !== 80 || typedHistoryMetrics.historyStatus !== "success") {
  throw new Error(`RW typed history metadata should survive normalization and business metrics: ${JSON.stringify({
    typedRwFileList,
    typedLocalData,
    typedHistoryMetrics
  })}`);
}
var typedRwUploadFile = normalizeRingData({
  type: "rw_upload_file",
  protocol: "rw",
  status: "completed",
  fileName: "u1_20260101010303_bp.txt",
  fileType: "bp",
  records: [{ unixTime: 171e7, systolic: 121, diastolic: 80 }]
});
var typedRwUploadMetrics = buildRingBusinessMetrics([typedRwUploadFile]);
if (typedRwUploadFile?.metrics.dataType !== "blood_pressure" || typedRwUploadMetrics.historyDataType !== "blood_pressure" || typedRwUploadMetrics.historyStatus !== "completed" || typedRwUploadMetrics.bloodPressure?.systolic !== 121 || typedRwUploadMetrics.bloodPressure?.diastolic !== 80) {
  throw new Error(`RW upload-file metadata should normalize to L19-compatible history data type: ${JSON.stringify({
    typedRwUploadFile,
    typedRwUploadMetrics
  })}`);
}
var rwBackendAliasHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_upload_file",
    metrics: {
      protocol: "rw",
      status: "completed",
      records: [
        {
          unixTime: 1710000500,
          heartRateValue: 76,
          oxygenSaturation: 98,
          hrvValue: 44,
          pressureValue: 24,
          temperatureValue: "36.6 C",
          bloodSugarValue: 58,
          bloodPressureValue: { systolicValue: 120, diastolicValue: 79 }
        }
      ]
    }
  }
]);
if (
  rwBackendAliasHistoryMetrics.heartRate !== 76 ||
  rwBackendAliasHistoryMetrics.bloodOxygen !== 98 ||
  rwBackendAliasHistoryMetrics.hrv !== 44 ||
  rwBackendAliasHistoryMetrics.stress !== 24 ||
  rwBackendAliasHistoryMetrics.temperature !== "36.6\u00b0C" ||
  rwBackendAliasHistoryMetrics.bloodSugar !== 5.8 ||
  rwBackendAliasHistoryMetrics.bloodPressure?.systolic !== 120 ||
  rwBackendAliasHistoryMetrics.bloodPressure?.diastolic !== 79
) {
  throw new Error(
    `RW backend-compatible aliases should render in business metrics: ${JSON.stringify(rwBackendAliasHistoryMetrics)}`
  );
}
var statusOnlyMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "heart_rate",
      value: 49,
      data: [49],
      message: "\u8BBE\u5907\u8FD4\u56DE\u5931\u8D25\u5E94\u7B54\uFF0C\u672A\u8FD4\u56DE\u771F\u5B9E\u6570\u636E"
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_oxygen",
      value: 49,
      data: [49],
      message: "\u8BBE\u5907\u8FD4\u56DE\u5931\u8D25\u5E94\u7B54\uFF0C\u672A\u8FD4\u56DE\u771F\u5B9E\u6570\u636E"
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_pressure",
      value: 49,
      data: [49],
      message: "\u8BBE\u5907\u8FD4\u56DE\u5931\u8D25\u5E94\u7B54\uFF0C\u672A\u8FD4\u56DE\u771F\u5B9E\u6570\u636E"
    }
  }
]);
if (statusOnlyMetrics.heartRate !== null || statusOnlyMetrics.bloodOxygen !== null || statusOnlyMetrics.bloodPressure !== null || statusOnlyMetrics.heartRateStatus !== "\u8BBE\u5907\u8FD4\u56DE\u5931\u8D25\u5E94\u7B54\uFF0C\u672A\u8FD4\u56DE\u771F\u5B9E\u6570\u636E" || statusOnlyMetrics.bloodOxygenStatus !== "\u8BBE\u5907\u8FD4\u56DE\u5931\u8D25\u5E94\u7B54\uFF0C\u672A\u8FD4\u56DE\u771F\u5B9E\u6570\u636E" || statusOnlyMetrics.bloodPressureStatus !== "\u8BBE\u5907\u8FD4\u56DE\u5931\u8D25\u5E94\u7B54\uFF0C\u672A\u8FD4\u56DE\u771F\u5B9E\u6570\u636E") {
  throw new Error(`Unexpected RW status-only metrics: ${JSON.stringify(statusOnlyMetrics)}`);
}
var zeroRealtimeMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "heart_rate",
      value: 0,
      data: [0],
      message: "zero heart rate is not a live value"
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_oxygen",
      value: 0,
      data: [0],
      message: "zero blood oxygen is not a live value"
    }
  }
]);
if (zeroRealtimeMetrics.heartRate !== null || zeroRealtimeMetrics.bloodOxygen !== null) {
  throw new Error(`RW zero realtime metrics should not be treated as valid live values: ${JSON.stringify(zeroRealtimeMetrics)}`);
}
var zeroRealtimeKeepsPreviousMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "heart_rate",
      value: 74,
      data: [74]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_oxygen",
      value: 98,
      data: [98]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "heart_rate",
      value: 0,
      data: [0]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_oxygen",
      value: 0,
      data: [0]
    }
  }
]);
if (zeroRealtimeKeepsPreviousMetrics.heartRate !== 74 || zeroRealtimeKeepsPreviousMetrics.bloodOxygen !== 98) {
  throw new Error(`RW zero realtime metrics should preserve previous valid live values: ${JSON.stringify(zeroRealtimeKeepsPreviousMetrics)}`);
}
var rwExpandedRealtimeMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "hrv",
      value: 42,
      data: [42]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "stress",
      value: 31,
      data: [31]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "temperature",
      value: 36.7,
      data: [111, 1]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_pressure",
      value: { systolic: 120, diastolic: 79 },
      data: [120, 79]
    }
  }
]);
if (rwExpandedRealtimeMetrics.hrv !== 42 || rwExpandedRealtimeMetrics.stress !== 31 || rwExpandedRealtimeMetrics.temperature !== "36.7\xB0C" || rwExpandedRealtimeMetrics.bloodPressure?.systolic !== 120 || rwExpandedRealtimeMetrics.bloodPressure?.diastolic !== 79 || !rwExpandedRealtimeMetrics.hrvStatus || !rwExpandedRealtimeMetrics.stressStatus || !rwExpandedRealtimeMetrics.temperatureStatus || rwExpandedRealtimeMetrics.bloodPressureStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E") {
  throw new Error(`Unexpected RW expanded realtime metrics: ${JSON.stringify(rwExpandedRealtimeMetrics)}`);
}
var rwStatusPrefixedRealtimeMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "heart_rate",
      data: [17, 72]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_oxygen",
      data: [17, 98]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "temperature",
      data: [17, 114, 1]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_pressure",
      data: [17, 120, 80]
    }
  }
]);
if (rwStatusPrefixedRealtimeMetrics.heartRate !== 72 || rwStatusPrefixedRealtimeMetrics.bloodOxygen !== 98 || rwStatusPrefixedRealtimeMetrics.temperature !== "37\xB0C" || rwStatusPrefixedRealtimeMetrics.bloodPressure?.systolic !== 120 || rwStatusPrefixedRealtimeMetrics.bloodPressure?.diastolic !== 80) {
  throw new Error(`RW compact status-prefixed realtime data should aggregate with the status byte removed: ${JSON.stringify(rwStatusPrefixedRealtimeMetrics)}`);
}
var activeMeasureSnapshot = buildRingBusinessMetrics([
  {
    sourceType: "active_measure",
    metrics: {
      heartRate: 80,
      hrv: 42,
      stress: 31,
      statusText: "collecting"
    }
  }
]);
if (activeMeasureSnapshot.heartRate !== 80 || activeMeasureSnapshot.hrv !== 42 || activeMeasureSnapshot.stress !== 31 || activeMeasureSnapshot.heartRateStatus !== "collecting" || activeMeasureSnapshot.hrvStatus !== "collecting" || activeMeasureSnapshot.stressStatus !== "collecting") {
  throw new Error(`Active measure should update heart rate, HRV and stress metrics: ${JSON.stringify(activeMeasureSnapshot)}`);
}
var activeMeasureLegacyAliasSnapshot = buildRingBusinessMetrics([
  {
    sourceType: "active_measure",
    metrics: {
      heartRate: 81,
      heartRateVariability: 43,
      stressIndex: 32,
      bodyTemperature: "36.8 C",
      statusText: "returned"
    }
  }
]);
if (activeMeasureLegacyAliasSnapshot.heartRate !== 81 || activeMeasureLegacyAliasSnapshot.hrv !== 43 || activeMeasureLegacyAliasSnapshot.stress !== 32 || !String(activeMeasureLegacyAliasSnapshot.temperature).includes("36.8") || activeMeasureLegacyAliasSnapshot.hrvStatus !== "returned" || activeMeasureLegacyAliasSnapshot.stressStatus !== "returned") {
  throw new Error(`Direct L19 active_measure aliases should aggregate like normalized SDK metrics: ${JSON.stringify(activeMeasureLegacyAliasSnapshot)}`);
}
var activeOxygenLegacyAliasSnapshot = buildRingBusinessMetrics([
  {
    sourceType: "active_OxyGenMeasure",
    metrics: {
      heartRate: 82,
      spo2: 97,
      temperatureValue: 36.9,
      statusText: "returned"
    }
  }
]);
if (activeOxygenLegacyAliasSnapshot.heartRate !== 82 || activeOxygenLegacyAliasSnapshot.bloodOxygen !== 97 || !String(activeOxygenLegacyAliasSnapshot.temperature).includes("36.9") || activeOxygenLegacyAliasSnapshot.heartRateStatus !== "returned" || activeOxygenLegacyAliasSnapshot.bloodOxygenStatus !== "returned") {
  throw new Error(`Direct L19 active_OxyGenMeasure aliases should aggregate like normalized SDK metrics: ${JSON.stringify(activeOxygenLegacyAliasSnapshot)}`);
}
var activeTemperatureSkinAliasSnapshot = buildRingBusinessMetrics([
  {
    sourceType: "active_Temperature",
    metrics: {
      skin_temp: "36.7 C",
      statusText: "returned"
    }
  }
]);
if (!String(activeTemperatureSkinAliasSnapshot.temperature).includes("36.7") || activeTemperatureSkinAliasSnapshot.temperatureStatus !== "returned") {
  throw new Error(`RW skin temperature aliases should aggregate through the L19 temperature metric path: ${JSON.stringify(activeTemperatureSkinAliasSnapshot)}`);
}
var rwBloodPressureBytesMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "blood_pressure",
      data: [118, 76]
    }
  }
]);
if (rwBloodPressureBytesMetrics.bloodPressure?.systolic !== 118 || rwBloodPressureBytesMetrics.bloodPressure?.diastolic !== 76 || rwBloodPressureBytesMetrics.bloodPressureStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E") {
  throw new Error(`RW blood pressure byte pairs should normalize like L19 paired pressure values: ${JSON.stringify(rwBloodPressureBytesMetrics)}`);
}
var normalizedActiveMeasure = normalizeRingData({
  type: "active_measure",
  heartRate: null,
  heartRateVariability: null,
  stressIndex: null,
  heartbeatStatus: 1,
  status: "wearing"
});
var activeMeasureStatusSnapshot = buildRingBusinessMetrics(normalizedActiveMeasure ? [normalizedActiveMeasure] : []);
if (normalizedActiveMeasure?.metrics.statusText !== "wearing" || activeMeasureStatusSnapshot.heartRateStatus !== "wearing" || activeMeasureStatusSnapshot.hrvStatus !== "wearing" || activeMeasureStatusSnapshot.stressStatus !== "wearing") {
  throw new Error(
    `Active measure status text should flow from parsed data through normalizer into business metrics: ${JSON.stringify({
      normalizedActiveMeasure,
      activeMeasureStatusSnapshot
    })}`
  );
}
var pendingKeepsOldMetric = buildRingBusinessMetrics([
  {
    sourceType: "active_OxyGenMeasure",
    metrics: {
      bloodOxygen: 99
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "blood_oxygen",
      status: "pending",
      message: "pending"
    }
  }
]);
if (pendingKeepsOldMetric.bloodOxygen !== 99 || pendingKeepsOldMetric.bloodOxygenStatus !== "pending") {
  throw new Error(`RW pending blood oxygen should keep last valid value: ${JSON.stringify(pendingKeepsOldMetric)}`);
}
var rwInternalPendingStatusMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "heart_rate",
      status: "pending",
      message: "RW parsed data wait timeout."
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "battery",
      status: "pending",
      message: "battery_command command timeout"
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "collect_period",
      status: "pending",
      message: "RW adapter listener cleared."
    }
  }
]);
if (rwInternalPendingStatusMetrics.heartRateStatus !== "\u5DF2\u8BF7\u6C42\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5" || rwInternalPendingStatusMetrics.batteryStatus !== "\u5DF2\u8BF7\u6C42\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5" || rwInternalPendingStatusMetrics.monitoringStatus !== "\u5DF2\u8BF7\u6C42\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5") {
  throw new Error(`RW internal pending messages should not surface in business metrics: ${JSON.stringify(rwInternalPendingStatusMetrics)}`);
}
var oxygenOnlyActiveMeasureMetrics = buildRingBusinessMetrics([
  {
    sourceType: "active_OxyGenMeasure",
    metrics: {
      bloodOxygen: 99,
      status: "normal"
    }
  }
]);
if (oxygenOnlyActiveMeasureMetrics.heartRate !== null || oxygenOnlyActiveMeasureMetrics.heartRateStatus !== "" || oxygenOnlyActiveMeasureMetrics.bloodOxygen !== 99 || oxygenOnlyActiveMeasureMetrics.bloodOxygenStatus !== "normal") {
  throw new Error(`RW blood oxygen alias should not invent a heart-rate value: ${JSON.stringify(oxygenOnlyActiveMeasureMetrics)}`);
}
var zeroActiveMeasureMetrics = buildRingBusinessMetrics([
  {
    sourceType: "active_measure",
    metrics: {
      heartRate: 76,
      statusText: "returned"
    }
  },
  {
    sourceType: "active_OxyGenMeasure",
    metrics: {
      heartRate: 0,
      bloodOxygen: 98,
      status: "normal"
    }
  },
  {
    sourceType: "active_OxyGenMeasure",
    metrics: {
      heartRate: 0,
      bloodOxygen: 0,
      status: "normal"
    }
  }
]);
if (zeroActiveMeasureMetrics.heartRate !== 76 || zeroActiveMeasureMetrics.bloodOxygen !== 98) {
  throw new Error(`Active measure zero values should not overwrite L19-compatible live metrics: ${JSON.stringify(zeroActiveMeasureMetrics)}`);
}
var rwHistoryPendingMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_history_pending",
    metrics: {
      status: "requested",
      message: "RW \u5386\u53F2\u5FEB\u7167\u5DF2\u8BF7\u6C42"
    }
  },
  {
    sourceType: "rw_history_pending",
    metrics: {
      status: "pending",
      message: "history read failed"
    }
  }
]);
if (rwHistoryPendingMetrics.historyStatus !== "pending" || rwHistoryPendingMetrics.historyMessage !== "history read failed") {
  throw new Error(`RW history pending state should flow into business metrics: ${JSON.stringify(rwHistoryPendingMetrics)}`);
}
var rwCorePendingMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "battery",
      status: "pending",
      message: "RW \u7535\u91CF\u7B49\u5F85\u8BBE\u5907\u8FD4\u56DE"
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "firmware",
      status: "pending",
      message: "RW \u56FA\u4EF6\u7248\u672C\u7B49\u5F85\u8BBE\u5907\u8FD4\u56DE"
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "collect_period",
      status: "requested",
      message: "\u76D1\u542C\u914D\u7F6E\u5DF2\u8BF7\u6C42"
    }
  }
]);
if (rwCorePendingMetrics.batteryStatus !== "RW \u7535\u91CF\u7B49\u5F85\u8BBE\u5907\u8FD4\u56DE" || rwCorePendingMetrics.monitoringStatus !== "\u76D1\u542C\u914D\u7F6E\u5DF2\u8BF7\u6C42" || rwCorePendingMetrics.healthData.firmware?.message !== "RW \u56FA\u4EF6\u7248\u672C\u7B49\u5F85\u8BBE\u5907\u8FD4\u56DE") {
  throw new Error(`RW core pending states should be exposed through business metrics: ${JSON.stringify(rwCorePendingMetrics)}`);
}
var requestedKeepsOldMetric = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "heart_rate",
      value: 70,
      data: [70]
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "heart_rate",
      status: "requested",
      message: "\u5DF2\u8BF7\u6C42\u5FC3\u7387\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5"
    }
  }
]);
if (requestedKeepsOldMetric.heartRate !== 70 || requestedKeepsOldMetric.heartRateStatus !== "\u5DF2\u8BF7\u6C42\u5FC3\u7387\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5") {
  throw new Error(`RW requested state should keep stale value until timeout: ${JSON.stringify(requestedKeepsOldMetric)}`);
}
var rwSpo2AliasMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "spo2",
      value: 97,
      data: [97]
    }
  }
]);
if (rwSpo2AliasMetrics.bloodOxygen !== 97 || rwSpo2AliasMetrics.bloodOxygenStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E" || rwSpo2AliasMetrics.healthData.spo2?.value !== 97 || rwSpo2AliasMetrics.healthData.blood_oxygen?.value !== 97 || rwSpo2AliasMetrics.healthData.blood_oxygen?.originalName !== "spo2") {
  throw new Error(`RW spo2 alias should update business blood oxygen: ${JSON.stringify(rwSpo2AliasMetrics)}`);
}
var rwRealtimeNameAliasMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "hr",
      value: 74,
      data: [74]
    }
  },
  {
    sourceType: "rw_health_data",
    metrics: {
      name: "oxygen",
      value: 96,
      data: [96]
    }
  }
]);
if (rwRealtimeNameAliasMetrics.heartRate !== 74 || rwRealtimeNameAliasMetrics.bloodOxygen !== 96 || rwRealtimeNameAliasMetrics.healthData.heart_rate?.originalName !== "hr" || rwRealtimeNameAliasMetrics.healthData.blood_oxygen?.originalName !== "oxygen") {
  throw new Error(`RW realtime short-name aliases should update L19-compatible business metrics: ${JSON.stringify(rwRealtimeNameAliasMetrics)}`);
}
var historySuccessMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [{ unixTime: 171e7 }]
    }
  }
]);
if (historySuccessMetrics.historyStatus !== "success" || historySuccessMetrics.historyMessage !== "\u5DF2\u540C\u6B651\u6761") {
  throw new Error(`Local history sync should update business status: ${JSON.stringify(historySuccessMetrics)}`);
}
var rwHistoryFilteredText = "RW\u5386\u53F2\u6587\u4EF6\u4E0D\u5728\u5F53\u524D\u8BFB\u53D6\u6761\u4EF6\u5185";
var rwHistoryFilteredMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "filtered",
      message: "RW history files are outside the current read range or type filter.",
      records: [],
      totalFileCount: 2,
      selectedFileCount: 0,
      filteredFileCount: 2
    }
  }
]);
if (rwHistoryFilteredMetrics.historyStatus !== "filtered" || rwHistoryFilteredMetrics.historyMessage !== rwHistoryFilteredText) {
  throw new Error(`RW history files filtered by range should surface localized business status: ${JSON.stringify(rwHistoryFilteredMetrics)}`);
}
var rwLegacyHistoryFilteredMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "empty",
      records: [],
      totalFileCount: 2,
      selectedFileCount: 0,
      filteredFileCount: 2
    }
  }
]);
if (rwLegacyHistoryFilteredMetrics.historyStatus !== "filtered" || rwLegacyHistoryFilteredMetrics.historyMessage !== rwHistoryFilteredText) {
  throw new Error(`RW legacy empty filtered history should remain compatible: ${JSON.stringify(rwLegacyHistoryFilteredMetrics)}`);
}
var qkeerV2HistoryBackfillMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        { unixTime: 171e7, heartRate: 62, bloodOxygen: 96, temperature: 36.3 },
        { unixTime: 1710000300, heartrate: 75, spo2: 98, temperature: 36.8 }
      ]
    }
  },
  {
    sourceType: "qkeer_v2_step_list",
    metrics: {
      status: "success",
      records: [
        { unixTime: 171e7, stepCount: 1200 },
        { unixTime: 1710000300, step: 3456, motionCalorie: 128, motionTime: 45, activityLevel: 3, distanceKm: 2.4 }
      ]
    }
  }
]);
if (qkeerV2HistoryBackfillMetrics.heartRate !== 75 || qkeerV2HistoryBackfillMetrics.bloodOxygen !== 98 || qkeerV2HistoryBackfillMetrics.temperature !== "36.8\xB0C" || qkeerV2HistoryBackfillMetrics.stepCount !== 3456 || qkeerV2HistoryBackfillMetrics.calorie !== 128 || qkeerV2HistoryBackfillMetrics.activityMinutes !== 45 || qkeerV2HistoryBackfillMetrics.activityLevel !== 3 || qkeerV2HistoryBackfillMetrics.distance !== 2.4) {
  throw new Error(`QKeer V2 history records should backfill business metrics: ${JSON.stringify(qkeerV2HistoryBackfillMetrics)}`);
}
var invalidTemperatureMetrics = buildRingBusinessMetrics([
  {
    sourceType: "active_Temperature",
    metrics: {
      temperature: "0.59\xB0C"
    }
  }
]);
if (invalidTemperatureMetrics.temperature !== null || invalidTemperatureMetrics.temperatureStatus !== "\u4F53\u6E29\u672A\u8FD4\u56DE\u5B9E\u65F6\u503C") {
  throw new Error(`Invalid temperature should not be displayed: ${JSON.stringify(invalidTemperatureMetrics)}`);
}
var qkeerV2RemainingMetrics = buildRingBusinessMetrics([
  {
    sourceType: "qkeer_v2_last_data",
    metrics: {
      stepCount: 4321,
      isWorn: true,
      fatigue: 320,
      fatigueLevel: "\u8F7B\u5EA6\u75B2\u52B3",
      anxiety: 280,
      anxietyLevel: "\u4E0D\u7126\u8651"
    }
  },
  {
    sourceType: "qkeer_v2_sleep_list",
    metrics: {
      records: [
        { sleepStatus: 1, durationMinutes: 120 },
        { sleepStatus: 2, durationMinutes: 80 },
        { sleepStatus: 4, durationMinutes: 30 },
        { sleepStatus: 3, durationMinutes: 10 }
      ]
    }
  }
]);
if (qkeerV2RemainingMetrics.stepCount !== 4321 || qkeerV2RemainingMetrics.isWorn !== true || qkeerV2RemainingMetrics.fatigueLevel !== "\u8F7B\u5EA6\u75B2\u52B3" || qkeerV2RemainingMetrics.anxietyLevel !== "\u4E0D\u7126\u8651" || qkeerV2RemainingMetrics.sleepTotalMinutes !== 240 || qkeerV2RemainingMetrics.sleepDeepMinutes !== 80 || qkeerV2RemainingMetrics.sleepLightMinutes !== 120 || qkeerV2RemainingMetrics.sleepRemMinutes !== 30 || qkeerV2RemainingMetrics.sleepAwakeMinutes !== 10) {
  throw new Error(`Unexpected QKeer V2 remaining metrics: ${JSON.stringify(qkeerV2RemainingMetrics)}`);
}
var rwPassiveMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "hrv",
      status: "unsupported_realtime",
      message: "\u5F53\u524D\u534F\u8BAE\u672A\u63D0\u4F9B\u4E3B\u52A8\u5B9E\u65F6\u8BFB\u53D6\uFF0C\u5DF2\u8BFB\u53D6\u76D1\u542C\u914D\u7F6E\uFF0C\u7B49\u5F85\u5386\u53F2\u6216\u8BBE\u5907\u5468\u671F\u4E0A\u62A5"
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "stress",
      status: "unsupported_realtime",
      message: "\u5F53\u524D\u534F\u8BAE\u672A\u63D0\u4F9B\u4E3B\u52A8\u5B9E\u65F6\u8BFB\u53D6\uFF0C\u5DF2\u8BFB\u53D6\u76D1\u542C\u914D\u7F6E\uFF0C\u7B49\u5F85\u5386\u53F2\u6216\u8BBE\u5907\u5468\u671F\u4E0A\u62A5"
    }
  },
  {
    sourceType: "rw_health_data_pending",
    metrics: {
      name: "blood_pressure",
      status: "unsupported_realtime",
      message: "\u5F53\u524D\u534F\u8BAE\u672A\u63D0\u4F9B\u4E3B\u52A8\u5B9E\u65F6\u8BFB\u53D6\uFF0C\u5DF2\u8BFB\u53D6\u76D1\u542C\u914D\u7F6E\uFF0C\u7B49\u5F85\u5386\u53F2\u6216\u8BBE\u5907\u5468\u671F\u4E0A\u62A5"
    }
  }
]);
if (rwPassiveMetrics.hrvStatus !== "\u5F53\u524D\u534F\u8BAE\u672A\u63D0\u4F9B\u4E3B\u52A8\u5B9E\u65F6\u8BFB\u53D6\uFF0C\u5DF2\u8BFB\u53D6\u76D1\u542C\u914D\u7F6E\uFF0C\u7B49\u5F85\u5386\u53F2\u6216\u8BBE\u5907\u5468\u671F\u4E0A\u62A5" || rwPassiveMetrics.stressStatus !== "\u5F53\u524D\u534F\u8BAE\u672A\u63D0\u4F9B\u4E3B\u52A8\u5B9E\u65F6\u8BFB\u53D6\uFF0C\u5DF2\u8BFB\u53D6\u76D1\u542C\u914D\u7F6E\uFF0C\u7B49\u5F85\u5386\u53F2\u6216\u8BBE\u5907\u5468\u671F\u4E0A\u62A5" || rwPassiveMetrics.bloodPressureStatus !== "\u5F53\u524D\u534F\u8BAE\u672A\u63D0\u4F9B\u4E3B\u52A8\u5B9E\u65F6\u8BFB\u53D6\uFF0C\u5DF2\u8BFB\u53D6\u76D1\u542C\u914D\u7F6E\uFF0C\u7B49\u5F85\u5386\u53F2\u6216\u8BBE\u5907\u5468\u671F\u4E0A\u62A5") {
  throw new Error(`RW passive metric statuses should be visible: ${JSON.stringify(rwPassiveMetrics)}`);
}
var historyBackfillRemainingMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        {
          unixTime: 171e7,
          heart_rate: 61,
          blood_oxygen: 96,
          temp: 36.2,
          hrv: 42,
          stressIndex: 31,
          glucose: 5.8,
          systolic: 118,
          diastolic: 76,
          steps: 2300,
          is_worn: true,
          fatigue: 120,
          fatigue_level: "normal",
          anxiety: 80,
          anxiety_level: "low"
        },
        {
          unixTime: 1710000300,
          durationMinutes: 90,
          sleepStatus: 1
        },
        {
          unixTime: 1710000600,
          durationMinutes: 60,
          sleepStatus: 2
        },
        {
          unixTime: 1710000900,
          durationMinutes: 20,
          sleepStatus: 4
        }
      ]
    }
  }
]);
if (historyBackfillRemainingMetrics.hrv !== 42 || historyBackfillRemainingMetrics.stress !== 31 || historyBackfillRemainingMetrics.bloodSugar !== 5.8 || historyBackfillRemainingMetrics.bloodPressure?.systolic !== 118 || historyBackfillRemainingMetrics.bloodPressure?.diastolic !== 76 || historyBackfillRemainingMetrics.stepCount !== 2300 || historyBackfillRemainingMetrics.isWorn !== true || historyBackfillRemainingMetrics.sleepTotalMinutes !== 170 || historyBackfillRemainingMetrics.sleepLightMinutes !== 90 || historyBackfillRemainingMetrics.sleepDeepMinutes !== 60 || historyBackfillRemainingMetrics.sleepRemMinutes !== 20 || historyBackfillRemainingMetrics.fatigueLevel !== "normal" || historyBackfillRemainingMetrics.anxietyLevel !== "low") {
  throw new Error(`Local history records should backfill remaining business metrics: ${JSON.stringify(historyBackfillRemainingMetrics)}`);
}
var rwInvalidRemainingVitalHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "qkeer_v2_health_list",
    metrics: {
      dataType: "vital",
      status: "success",
      records: [
        { unixTime: 1710000001, dataType: "hrv", hrv: 0 },
        { unixTime: 1710000002, dataType: "stress", stress: 131 },
        { unixTime: 1710000003, dataType: "blood_pressure", systolic: 30, diastolic: 10 }
      ]
    }
  }
]);
if (rwInvalidRemainingVitalHistoryMetrics.hrv !== null || rwInvalidRemainingVitalHistoryMetrics.stress !== null || rwInvalidRemainingVitalHistoryMetrics.bloodPressure !== null) {
  throw new Error(`RW invalid HRV/stress/blood-pressure history should not backfill business metrics: ${JSON.stringify(rwInvalidRemainingVitalHistoryMetrics)}`);
}
var rwMixedRemainingVitalHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "qkeer_v2_health_list",
    metrics: {
      dataType: "vital",
      status: "success",
      records: [
        { unixTime: 1710000001, dataType: "hrv", hrv: 0 },
        { unixTime: 1710000002, dataType: "stress", stress: 131 },
        { unixTime: 1710000003, dataType: "blood_pressure", systolic: 30, diastolic: 10 },
        { unixTime: 1710000061, dataType: "hrv", hrv: 44 },
        { unixTime: 1710000062, dataType: "stress", stress: 22 },
        { unixTime: 1710000063, dataType: "blood_pressure", systolic: 122, diastolic: 80 }
      ]
    }
  }
]);
if (rwMixedRemainingVitalHistoryMetrics.hrv !== 44 || rwMixedRemainingVitalHistoryMetrics.stress !== 22 || rwMixedRemainingVitalHistoryMetrics.bloodPressure?.systolic !== 122 || rwMixedRemainingVitalHistoryMetrics.bloodPressure?.diastolic !== 80) {
  throw new Error(`RW valid HRV/stress/blood-pressure history should still backfill after invalid samples: ${JSON.stringify(rwMixedRemainingVitalHistoryMetrics)}`);
}
var rwAppSdkBeanAliasMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        {
          unixTime: 171e7,
          hr: 70,
          bloodOxy: 99,
          bodyTemp: 36.5,
          hrv: 45,
          pressure: 24,
          sugar: 5.6,
          sp: 121,
          dp: 78,
          totalSteps: 6789
        },
        {
          unixTime: 1710000300,
          totalSleepTime: 480,
          items: [
            { len: 260, sleepType: 1 },
            { len: 160, sleepType: 2 },
            { len: 60, sleepType: 3 }
          ]
        }
      ]
    }
  }
]);
if (rwAppSdkBeanAliasMetrics.heartRate !== 70 || rwAppSdkBeanAliasMetrics.bloodOxygen !== 99 || rwAppSdkBeanAliasMetrics.temperature !== "36.5\xB0C" || rwAppSdkBeanAliasMetrics.hrv !== 45 || rwAppSdkBeanAliasMetrics.stress !== 24 || rwAppSdkBeanAliasMetrics.bloodSugar !== 5.6 || rwAppSdkBeanAliasMetrics.bloodPressure?.systolic !== 121 || rwAppSdkBeanAliasMetrics.bloodPressure?.diastolic !== 78 || rwAppSdkBeanAliasMetrics.stepCount !== 6789 || rwAppSdkBeanAliasMetrics.sleepTotalMinutes !== 480 || rwAppSdkBeanAliasMetrics.sleepLightMinutes !== 260 || rwAppSdkBeanAliasMetrics.sleepDeepMinutes !== 160 || rwAppSdkBeanAliasMetrics.sleepAwakeMinutes !== 60) {
  throw new Error(`RW app SDK style history beans should backfill business metrics: ${JSON.stringify(rwAppSdkBeanAliasMetrics)}`);
}
var rwCaseInsensitiveHistoryAliasMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        {
          UnixTime: 171e7,
          HR: 76,
          SpO2: 97,
          Temp: 36.4,
          Hrv: 43,
          Pressure: 21,
          Glucose: 5.9,
          BP: "119/78",
          TotalSteps: 4321,
          Calories: 130,
          ActiveMinutes: 36,
          IntensityLevel: 2,
          Mileage: 1.8
        },
        {
          RecordTime: "2026-01-01 01:18:03",
          DataType: "blood_oxygen_raw",
          RawDataType: "SpO2",
          Value: 98
        }
      ]
    }
  }
]);
if (rwCaseInsensitiveHistoryAliasMetrics.heartRate !== 76 || rwCaseInsensitiveHistoryAliasMetrics.bloodOxygen !== 98 || rwCaseInsensitiveHistoryAliasMetrics.temperature !== "36.4\xB0C" || rwCaseInsensitiveHistoryAliasMetrics.hrv !== 43 || rwCaseInsensitiveHistoryAliasMetrics.stress !== 21 || rwCaseInsensitiveHistoryAliasMetrics.bloodSugar !== 5.9 || rwCaseInsensitiveHistoryAliasMetrics.bloodPressure?.systolic !== 119 || rwCaseInsensitiveHistoryAliasMetrics.bloodPressure?.diastolic !== 78 || rwCaseInsensitiveHistoryAliasMetrics.stepCount !== 4321 || rwCaseInsensitiveHistoryAliasMetrics.calorie !== 130 || rwCaseInsensitiveHistoryAliasMetrics.activityMinutes !== 36 || rwCaseInsensitiveHistoryAliasMetrics.activityLevel !== 2 || rwCaseInsensitiveHistoryAliasMetrics.distance !== 1.8) {
  throw new Error(
    `RW mixed-case history aliases should backfill business metrics like lowercase L19-compatible records: ${JSON.stringify(
      rwCaseInsensitiveHistoryAliasMetrics
    )}`
  );
}
var rwTypedValueHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        { unixTime: 171e7, dataType: "heart_rate_raw", rawDataType: "hr", value: 73 },
        { unixTime: 1710000060, dataType: "blood_oxygen_raw", rawDataType: "spo2", value: 98 },
        { unixTime: 1710000120, dataType: "temperature", rawDataType: "temp", value: 36.6 },
        { unixTime: 1710000180, dataType: "hrv", rawDataType: "hrv", value: 44 },
        { unixTime: 1710000240, dataType: "stress", rawDataType: "stress", value: 22 },
        { unixTime: 1710000300, dataType: "blood_sugar", rawDataType: "bs", value: 5.7 },
        { unixTime: 1710000360, dataType: "blood_pressure", rawDataType: "bp", value: "122/80" },
        { unixTime: 1710000420, dataType: "step", rawDataType: "step", value: 3450 }
      ]
    }
  }
]);
if (rwTypedValueHistoryMetrics.heartRate !== 73 || rwTypedValueHistoryMetrics.bloodOxygen !== 98 || !`${rwTypedValueHistoryMetrics.temperature}`.includes("36.6") || rwTypedValueHistoryMetrics.hrv !== 44 || rwTypedValueHistoryMetrics.stress !== 22 || rwTypedValueHistoryMetrics.bloodSugar !== 5.7 || rwTypedValueHistoryMetrics.bloodPressure?.systolic !== 122 || rwTypedValueHistoryMetrics.bloodPressure?.diastolic !== 80 || rwTypedValueHistoryMetrics.stepCount !== 3450) {
  throw new Error(`RW typed value history records should backfill business metrics: ${JSON.stringify(rwTypedValueHistoryMetrics)}`);
}
var rwRecordTimeOnlyHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        { recordTime: "2000-01-01 00:00:00", dataType: "heart_rate_raw", rawDataType: "hr", value: 61 },
        { recordTime: "2099-01-01 00:00:00", dataType: "heart_rate_raw", rawDataType: "hr", value: 82 }
      ]
    }
  }
]);
if (rwRecordTimeOnlyHistoryMetrics.heartRate !== 82) {
  throw new Error(`RW recordTime-only history should choose the latest business metric: ${JSON.stringify(rwRecordTimeOnlyHistoryMetrics)}`);
}
var rwSleepStateHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        { unixTime: 1710000480, dataType: "sleep", rawDataType: "sleep", sleepState: 1, duration: 30 },
        { unixTime: 1710000540, dataType: "sleep", rawDataType: "sleep", sleep_state: 2, durationMinutes: 80 },
        { unixTime: 1710000600, dataType: "sleep", rawDataType: "sleep", sleepStage: 4, sleepMinutes: 25 },
        {
          unixTime: 1710000660,
          dataType: "sleep",
          rawDataType: "sleep",
          items: [
            { sleep_state: 3, duration: 10 },
            { sleepStage: 1, sleep_minutes: 20 }
          ]
        }
      ]
    }
  }
]);
if (rwSleepStateHistoryMetrics.sleepTotalMinutes !== 165 || rwSleepStateHistoryMetrics.sleepLightMinutes !== 50 || rwSleepStateHistoryMetrics.sleepDeepMinutes !== 80 || rwSleepStateHistoryMetrics.sleepRemMinutes !== 25 || rwSleepStateHistoryMetrics.sleepAwakeMinutes !== 10) {
  throw new Error(`RW sleepState history aliases should backfill sleep business metrics: ${JSON.stringify(rwSleepStateHistoryMetrics)}`);
}
var rwLegacySleepBeanMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        {
          unixTime: 1710000720,
          dataType: "sleep",
          rawDataType: "sleep",
          total_sleep_time: 450,
          deep_sleep_time: 130,
          light_sleep_time: 260,
          awake_time: 20,
          rem_sleep_time: 40,
          sleep_data: [
            { state: 1, sleep_duration: 260 },
            { sleep_type: 2, total_sleep_time: 130 },
            { sleep_stage: 4, duration: 40 },
            { sleep_status: 3, minutes: 20 }
          ]
        }
      ]
    }
  }
]);
if (rwLegacySleepBeanMetrics.sleepTotalMinutes !== 450 || rwLegacySleepBeanMetrics.sleepLightMinutes !== 260 || rwLegacySleepBeanMetrics.sleepDeepMinutes !== 130 || rwLegacySleepBeanMetrics.sleepRemMinutes !== 40 || rwLegacySleepBeanMetrics.sleepAwakeMinutes !== 20) {
  throw new Error(`RW legacy sleep bean aliases should backfill sleep business metrics: ${JSON.stringify(rwLegacySleepBeanMetrics)}`);
}
var rwRawHistoryStatusMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [
        { unixTime: 1709999400, dataType: "heart_rate_raw", rawDataType: "hr" },
        { unixTime: 1709999700, dataType: "blood_oxygen_raw", rawDataType: "spo2" },
        { unixTime: 171e7, dataType: "sleep", rawDataType: "sleep" },
        { unixTime: 1710000300, dataType: "hrv", rawDataType: "hrv" },
        { unixTime: 1710000600, dataType: "stress", rawDataType: "stress" },
        { unixTime: 1710000900, dataType: "blood_pressure", rawDataType: "bp" },
        { unixTime: 1710001200, dataType: "blood_sugar", rawDataType: "bs" }
      ]
    }
  }
]);
if (rwRawHistoryStatusMetrics.sleepStatus !== "\u5386\u53F2\u539F\u59CB\u6570\u636E\u5DF2\u540C\u6B65\uFF0C\u5F85\u89E3\u6790" || rwRawHistoryStatusMetrics.hrvStatus !== "\u5386\u53F2\u539F\u59CB\u6570\u636E\u5DF2\u540C\u6B65\uFF0C\u5F85\u89E3\u6790" || rwRawHistoryStatusMetrics.stressStatus !== "\u5386\u53F2\u539F\u59CB\u6570\u636E\u5DF2\u540C\u6B65\uFF0C\u5F85\u89E3\u6790" || rwRawHistoryStatusMetrics.bloodPressureStatus !== "\u5386\u53F2\u539F\u59CB\u6570\u636E\u5DF2\u540C\u6B65\uFF0C\u5F85\u89E3\u6790" || rwRawHistoryStatusMetrics.bloodSugarStatus !== "\u5386\u53F2\u539F\u59CB\u6570\u636E\u5DF2\u540C\u6B65\uFF0C\u5F85\u89E3\u6790") {
  throw new Error(`RW raw history records should surface parse-pending statuses: ${JSON.stringify(rwRawHistoryStatusMetrics)}`);
}
if (!rwRawHistoryStatusMetrics.heartRateStatus || rwRawHistoryStatusMetrics.heartRateStatus !== rwRawHistoryStatusMetrics.sleepStatus || !rwRawHistoryStatusMetrics.bloodOxygenStatus || rwRawHistoryStatusMetrics.bloodOxygenStatus !== rwRawHistoryStatusMetrics.sleepStatus) {
  throw new Error(`RW raw heart rate and blood oxygen history should surface parse-pending statuses: ${JSON.stringify(rwRawHistoryStatusMetrics)}`);
}
var rwBloodPressureOnlyRawHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      records: [{ unixTime: 171e7, dataType: "blood_pressure", rawDataType: "bp" }]
    }
  }
]);
if (rwBloodPressureOnlyRawHistoryMetrics.bloodPressureStatus !== "\u5386\u53F2\u539F\u59CB\u6570\u636E\u5DF2\u540C\u6B65\uFF0C\u5F85\u89E3\u6790" || rwBloodPressureOnlyRawHistoryMetrics.stressStatus === "\u5386\u53F2\u539F\u59CB\u6570\u636E\u5DF2\u540C\u6B65\uFF0C\u5F85\u89E3\u6790") {
  throw new Error(`RW blood pressure raw history should not be treated as stress: ${JSON.stringify(rwBloodPressureOnlyRawHistoryMetrics)}`);
}
var rwHistoryTransferStatusMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_file_list",
    metrics: {
      files: [{ fileName: "001_20260101000000_hr.txt" }, { fileName: "001_20260101000000_spo2.txt" }]
    }
  },
  {
    sourceType: "rw_upload_progress",
    metrics: {
      seq: 1,
      progress: 80
    }
  },
  {
    sourceType: "rw_upload_file",
    metrics: {
      fileName: "001_20260101000000_hr.txt",
      status: "completed",
      records: [{ unixTime: 171e7, dataType: "heart_rate_raw", rawDataType: "hr", value: 76 }]
    }
  }
]);
if (rwHistoryTransferStatusMetrics.historyStatus !== "completed" || rwHistoryTransferStatusMetrics.heartRate !== 76 || !rwHistoryTransferStatusMetrics.historyMessage.includes("001_20260101000000_hr.txt") || !rwHistoryTransferStatusMetrics.historyMessage.includes("1\u6761\u539F\u59CB\u8BB0\u5F55")) {
  throw new Error(`RW history transfer events should surface business history status: ${JSON.stringify(rwHistoryTransferStatusMetrics)}`);
}
var rwSpo2MonitoringMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_health_monitoring",
    metrics: {
      name: "spo2",
      enabled: true,
      interval: 30,
      period: 1800,
      minutes: 30
    }
  }
]);
if (rwSpo2MonitoringMetrics.bloodOxygenStatus !== "\u76D1\u542C\u914D\u7F6E\u5DF2\u8BFB\u53D6" || rwSpo2MonitoringMetrics.monitoring.spo2?.interval !== 30 || rwSpo2MonitoringMetrics.monitoring.blood_oxygen?.originalName !== "spo2") {
  throw new Error(`RW spo2 monitoring reads should surface blood oxygen monitoring status: ${JSON.stringify(rwSpo2MonitoringMetrics)}`);
}
var rwFilteredFileListMetrics = buildRingBusinessMetrics([
  {
    sourceType: "rw_file_list",
    metrics: {
      files: [{ fileName: "001_20260101000000_hr.txt" }],
      totalFileCount: 1,
      selectedFileCount: 0,
      filteredFileCount: 1
    }
  }
]);
if (rwFilteredFileListMetrics.historyStatus !== "filtered" || rwFilteredFileListMetrics.historyMessage !== rwHistoryFilteredText) {
  throw new Error(`RW filtered file-list events should surface business history status: ${JSON.stringify(rwFilteredFileListMetrics)}`);
}
var inProgressHistoryStatuses = ["pending", "requested", "ready", "file_list", "uploading", "last_package"];
var completedHistoryStatuses = ["filtered", "empty", "success", "completed", "uploaded", "timeout"];
if (!inProgressHistoryStatuses.every((status) => isRingHistoryInProgress(status))) {
  throw new Error("RW in-progress history statuses should be treated as pending by business callers.");
}
if (completedHistoryStatuses.some((status) => isRingHistoryInProgress(status))) {
  throw new Error("RW completed or terminal history statuses should not be treated as pending by business callers.");
}
var invalidTemperatureSnapshot = mergeRingBusinessMetricSnapshot(createEmptyTemperatureMetrics(), {
  temperature: "0.59\xB0C"
});
if (invalidTemperatureSnapshot.temperature !== null) {
  throw new Error(`Invalid temperature snapshot should not be preserved: ${JSON.stringify(invalidTemperatureSnapshot)}`);
}
var validTemperatureSnapshot = mergeRingBusinessMetricSnapshot(createEmptyTemperatureMetrics(), {
  temperature: 36.5
});
if (validTemperatureSnapshot.temperature !== "36.5\xB0C") {
  throw new Error(`Valid temperature snapshot should be normalized: ${JSON.stringify(validTemperatureSnapshot)}`);
}
var statusPreservingSnapshot = mergeRingBusinessMetricSnapshot(
  buildRingBusinessMetrics([
    {
      sourceType: "rw_health_data",
      metrics: {
        name: "heart_rate",
        value: 82,
        data: [82]
      }
    }
  ]),
  {
    deviceTimestamp: 171e10,
    timezone: 8,
    heartRateStatus: "previous-heart-rate-status",
    bloodOxygenStatus: "previous-blood-oxygen-status",
    temperatureStatus: "previous-temperature-status",
    hrvStatus: "previous-hrv-status",
    stressStatus: "previous-stress-status",
    bloodSugarStatus: "previous-blood-sugar-status",
    bloodPressureStatus: "previous-blood-pressure-status",
    sleepStatus: "previous-sleep-status",
    historyStatus: "previous-history-status",
    historyMessage: "previous-history-message",
    collectPeriodSeconds: 1800,
    collectPeriodMinutes: 30,
    monitoringStatus: "previous-monitoring-status",
    monitoring: {
      heart_rate: { enabled: true, interval: 30 }
    },
    healthData: {
      firmware: { status: "pending" }
    }
  }
);
if (statusPreservingSnapshot.heartRate !== 82 || statusPreservingSnapshot.heartRateStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E" || statusPreservingSnapshot.bloodOxygenStatus !== "previous-blood-oxygen-status" || statusPreservingSnapshot.temperatureStatus !== "previous-temperature-status" || statusPreservingSnapshot.hrvStatus !== "previous-hrv-status" || statusPreservingSnapshot.stressStatus !== "previous-stress-status" || statusPreservingSnapshot.bloodSugarStatus !== "previous-blood-sugar-status" || statusPreservingSnapshot.bloodPressureStatus !== "previous-blood-pressure-status" || statusPreservingSnapshot.sleepStatus !== "previous-sleep-status" || statusPreservingSnapshot.historyStatus !== "previous-history-status" || statusPreservingSnapshot.historyMessage !== "previous-history-message" || statusPreservingSnapshot.collectPeriodSeconds !== 1800 || statusPreservingSnapshot.collectPeriodMinutes !== 30 || statusPreservingSnapshot.monitoringStatus !== "previous-monitoring-status" || statusPreservingSnapshot.deviceTimestamp !== 171e10 || statusPreservingSnapshot.timezone !== 8 || statusPreservingSnapshot.monitoring.heart_rate?.interval !== 30 || statusPreservingSnapshot.healthData.firmware?.status !== "pending") {
  throw new Error(`Business metric snapshot merge should preserve previous statuses and grouped data: ${JSON.stringify(statusPreservingSnapshot)}`);
}
var rwHistoricalKeyPollutionMetrics = buildRingBusinessMetrics([
  { sourceType: "rw_health_data", metrics: { name: "heart_rate", key: 1283, value: 226, data: [49, 226, 170, 69, 226, 0], records: [{ unixTime: 1168826929, heartRate: 226 }] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_oxygen", key: 1289, value: 98, data: [49, 226, 170, 69, 98, 0], records: [{ unixTime: 1168826929, bloodOxygen: 98 }] } },
  { sourceType: "rw_health_data", metrics: { name: "temperature", key: 1288, value: 36.7, data: [49, 226, 170, 69, 111, 1], records: [{ unixTime: 1168826929, temperature: 36.7 }] } },
  { sourceType: "rw_health_data", metrics: { name: "hrv", key: 1290, value: 42, data: [49, 226, 170, 69, 42, 0], records: [{ unixTime: 1168826929, hrv: 42 }] } },
  { sourceType: "rw_health_data", metrics: { name: "stress", key: 1293, value: 31, data: [49, 226, 170, 69, 31, 0], records: [{ unixTime: 1168826929, stress: 31 }] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_sugar", key: 1296, value: 5.8, data: [49, 226, 170, 69, 58, 0], records: [{ unixTime: 1168826929, bloodSugar: 5.8 }] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_pressure", key: 1284, value: { systolic: 120, diastolic: 79 }, data: [49, 226, 170, 69, 120, 79], records: [{ unixTime: 1168826929, systolic: 120, diastolic: 79 }] } }
]);
if (rwHistoricalKeyPollutionMetrics.heartRate !== null || rwHistoricalKeyPollutionMetrics.bloodOxygen !== null || rwHistoricalKeyPollutionMetrics.temperature !== null || rwHistoricalKeyPollutionMetrics.hrv !== null || rwHistoricalKeyPollutionMetrics.stress !== null || rwHistoricalKeyPollutionMetrics.bloodSugar !== null || rwHistoricalKeyPollutionMetrics.bloodPressure !== null || rwHistoricalKeyPollutionMetrics.heartRateStatus === "\u5DF2\u8FD4\u56DE\u6570\u636E" || rwHistoricalKeyPollutionMetrics.bloodOxygenStatus === "\u5DF2\u8FD4\u56DE\u6570\u636E") {
  throw new Error(`RW historical 0x05xx health packets must not pollute realtime page metrics: ${JSON.stringify(rwHistoricalKeyPollutionMetrics)}`);
}
var rwNoCrcRealtimeKeyMetrics = buildRingBusinessMetrics([
  { sourceType: "rw_health_data", metrics: { name: "heart_rate", key: 1283, flag: 16, value: 75, data: [75] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_oxygen", key: "0x0509", flag: 16, value: 98, data: [98] } },
  { sourceType: "rw_health_data", metrics: { name: "temperature", key: 1288, flag: 16, value: 36.7, data: [111, 1] } },
  { sourceType: "rw_health_data", metrics: { name: "hrv", key: 1290, flag: 16, value: 42, data: [42] } },
  { sourceType: "rw_health_data", metrics: { name: "stress", key: 1293, flag: 16, value: 31, data: [31] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_sugar", key: 1296, flag: 16, value: 5.8, data: [58] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_pressure", key: 1284, flag: 16, value: { systolic: 120, diastolic: 79 }, data: [120, 79] } }
]);
if (rwNoCrcRealtimeKeyMetrics.heartRate !== 75 || rwNoCrcRealtimeKeyMetrics.bloodOxygen !== 98 || rwNoCrcRealtimeKeyMetrics.temperature !== "36.7\xB0C" || rwNoCrcRealtimeKeyMetrics.hrv !== 42 || rwNoCrcRealtimeKeyMetrics.stress !== 31 || rwNoCrcRealtimeKeyMetrics.bloodSugar !== 5.8 || rwNoCrcRealtimeKeyMetrics.bloodPressure?.systolic !== 120 || rwNoCrcRealtimeKeyMetrics.bloodPressure?.diastolic !== 79 || rwNoCrcRealtimeKeyMetrics.heartRateStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E" || rwNoCrcRealtimeKeyMetrics.bloodOxygenStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E") {
  throw new Error(`RW no-CRC 0x05xx health packets should update realtime page metrics: ${JSON.stringify(rwNoCrcRealtimeKeyMetrics)}`);
}
var rwAppRealtimeKeyMetrics = buildRingBusinessMetrics([
  { sourceType: "rw_health_data", metrics: { name: "heart_rate", key: 548, value: 75, data: [75] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_oxygen", key: "0x024e", value: 98, data: [98] } },
  { sourceType: "rw_health_data", metrics: { name: "temperature", key: 560, value: 36.7, data: [111, 1] } },
  { sourceType: "rw_health_data", metrics: { name: "hrv", key: 617, value: 42, data: [42] } },
  { sourceType: "rw_health_data", metrics: { name: "stress", key: 591, value: 31, data: [31] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_sugar", key: 620, value: 5.8, data: [58] } },
  { sourceType: "rw_health_data", metrics: { name: "blood_pressure", key: 561, value: { systolic: 120, diastolic: 79 }, data: [120, 79] } }
]);
if (rwAppRealtimeKeyMetrics.heartRate !== 75 || rwAppRealtimeKeyMetrics.bloodOxygen !== 98 || rwAppRealtimeKeyMetrics.temperature !== "36.7\xB0C" || rwAppRealtimeKeyMetrics.hrv !== 42 || rwAppRealtimeKeyMetrics.stress !== 31 || rwAppRealtimeKeyMetrics.bloodSugar !== 5.8 || rwAppRealtimeKeyMetrics.bloodPressure?.systolic !== 120 || rwAppRealtimeKeyMetrics.bloodPressure?.diastolic !== 79 || rwAppRealtimeKeyMetrics.heartRateStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E" || rwAppRealtimeKeyMetrics.bloodOxygenStatus !== "\u5DF2\u8FD4\u56DE\u6570\u636E") {
  throw new Error(`RW AppRealTime 0x02xx health packets should update realtime page metrics: ${JSON.stringify(rwAppRealtimeKeyMetrics)}`);
}
var rwPendingCoreSnapshot = mergeRingBusinessMetricSnapshot(
  buildRingBusinessMetrics([
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "heart_rate",
        status: "pending",
        message: "pending"
      }
    },
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "blood_oxygen",
        status: "pending",
        message: "pending"
      }
    }
  ]),
  {
    heartRate: 82,
    heartRateStatus: "previous-heart-rate-ok",
    bloodOxygen: 98,
    bloodOxygenStatus: "previous-blood-oxygen-ok"
  }
);
if (rwPendingCoreSnapshot.heartRate !== 82 || rwPendingCoreSnapshot.heartRateStatus !== "previous-heart-rate-ok" || rwPendingCoreSnapshot.bloodOxygen !== 98 || rwPendingCoreSnapshot.bloodOxygenStatus !== "previous-blood-oxygen-ok") {
  throw new Error(`RW pending realtime metrics should not overwrite previous valid heart-rate/blood-oxygen values: ${JSON.stringify(rwPendingCoreSnapshot)}`);
}
var rwPendingExpandedSnapshot = mergeRingBusinessMetricSnapshot(
  buildRingBusinessMetrics([
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "temperature",
        status: "requested",
        message: "\u5DF2\u8BF7\u6C42\u4F53\u6E29\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5"
      }
    },
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "hrv",
        status: "requested",
        message: "\u5DF2\u8BF7\u6C42HRV\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5"
      }
    },
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "stress",
        status: "requested",
        message: "\u5DF2\u8BF7\u6C42\u538B\u529B\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5"
      }
    },
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "blood_sugar",
        status: "requested",
        message: "\u5DF2\u8BF7\u6C42\u8840\u7CD6\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5"
      }
    },
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "blood_pressure",
        status: "requested",
        message: "\u5DF2\u8BF7\u6C42\u8840\u538B\uFF0C\u7B49\u5F85\u8BBE\u5907\u4E0A\u62A5"
      }
    }
  ]),
  {
    temperature: 36.6,
    temperatureStatus: "previous-temperature-ok",
    hrv: 44,
    hrvStatus: "previous-hrv-ok",
    stress: 31,
    stressStatus: "previous-stress-ok",
    bloodSugar: 5.8,
    bloodSugarStatus: "previous-blood-sugar-ok",
    bloodPressure: { systolic: 120, diastolic: 79 },
    bloodPressureStatus: "previous-blood-pressure-ok"
  }
);
if (rwPendingExpandedSnapshot.temperature !== "36.6\xB0C" || rwPendingExpandedSnapshot.temperatureStatus !== "previous-temperature-ok" || rwPendingExpandedSnapshot.hrv !== 44 || rwPendingExpandedSnapshot.hrvStatus !== "previous-hrv-ok" || rwPendingExpandedSnapshot.stress !== 31 || rwPendingExpandedSnapshot.stressStatus !== "previous-stress-ok" || rwPendingExpandedSnapshot.bloodSugar !== 5.8 || rwPendingExpandedSnapshot.bloodSugarStatus !== "previous-blood-sugar-ok" || rwPendingExpandedSnapshot.bloodPressure?.systolic !== 120 || rwPendingExpandedSnapshot.bloodPressureStatus !== "previous-blood-pressure-ok") {
  throw new Error(`RW pending expanded realtime metrics should not overwrite previous valid values: ${JSON.stringify(rwPendingExpandedSnapshot)}`);
}
var rwVersionAliasOnlyMetrics = buildRingBusinessMetrics([
  {
    sourceType: "hardwareVersion",
    metrics: {
      value: "0.2.2",
      protocol: "rw"
    }
  },
  {
    sourceType: "softwareVersion",
    metrics: {
      value: "0A050402",
      protocol: "rw"
    }
  }
]);
if (rwVersionAliasOnlyMetrics.firmwareVersion !== "0.2.2" || rwVersionAliasOnlyMetrics.hardwareVersion !== "0.2.2" || rwVersionAliasOnlyMetrics.softwareVersion !== "0A050402" || rwVersionAliasOnlyMetrics.uiVersion !== "0A050402") {
  throw new Error(`RW L19-compatible version alias events should populate business version fields by value: ${JSON.stringify(rwVersionAliasOnlyMetrics)}`);
}
var rwUnitStringHistoryMetrics = buildRingBusinessMetrics([
  {
    sourceType: "local_data",
    metrics: {
      status: "success",
      totalFileCount: "4 files",
      selectedFileCount: "4 files",
      records: [
        {
          unixTime: 1710001200,
          dataType: "rw_history",
          heartRate: "72 bpm",
          bloodOxygen: "98%",
          hrv: "42 ms",
          stress: "31 level",
          skinTemperature: "36.5 C",
          bloodSugar: "5.6 mmol/L",
          systolic: "120 mmHg",
          diastolic: "79 mmHg",
          stepCount: "6789 steps",
          calorie: "88 kcal",
          activityMinutes: "32 min",
          distance: "1.6 km",
          sleepTotalMinutes: "480 min",
          sleepDeepMinutes: "130 min",
          sleepLightMinutes: "260 min",
          sleepRemMinutes: "40 min",
          sleepAwakeMinutes: "20 min"
        }
      ]
    }
  }
]);
if (rwUnitStringHistoryMetrics.heartRate !== 72 || rwUnitStringHistoryMetrics.bloodOxygen !== 98 || rwUnitStringHistoryMetrics.hrv !== 42 || rwUnitStringHistoryMetrics.stress !== 31 || rwUnitStringHistoryMetrics.temperature !== "36.5\xB0C" || rwUnitStringHistoryMetrics.bloodSugar !== 5.6 || rwUnitStringHistoryMetrics.bloodPressure?.systolic !== 120 || rwUnitStringHistoryMetrics.bloodPressure?.diastolic !== 79 || rwUnitStringHistoryMetrics.stepCount !== 6789 || rwUnitStringHistoryMetrics.calorie !== 88 || rwUnitStringHistoryMetrics.activityMinutes !== 32 || rwUnitStringHistoryMetrics.distance !== 1.6 || rwUnitStringHistoryMetrics.sleepTotalMinutes !== 480 || rwUnitStringHistoryMetrics.sleepDeepMinutes !== 130 || rwUnitStringHistoryMetrics.sleepLightMinutes !== 260 || rwUnitStringHistoryMetrics.sleepRemMinutes !== 40 || rwUnitStringHistoryMetrics.sleepAwakeMinutes !== 20 || rwUnitStringHistoryMetrics.historyStatus !== "success") {
  throw new Error(`RW history values with unit suffixes should backfill L19-compatible business metrics: ${JSON.stringify(rwUnitStringHistoryMetrics)}`);
}
var ringBusinessMetricsParityPassed = true;
function createEmptyTemperatureMetrics() {
  return buildRingBusinessMetrics([
    {
      sourceType: "rw_health_data_pending",
      metrics: {
        name: "temperature",
        status: "pending",
        message: "pending"
      }
    }
  ]);
}
export {
  ringBusinessMetricsParityPassed
};
