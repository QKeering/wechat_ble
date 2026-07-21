import type { RingParsedData } from '../types';

export interface NormalizedRingData {
  sourceType: string;
  collectedAt: number;
  metrics: Record<string, any>;
  raw: RingParsedData;
}

export const normalizeRingData = (parsed: RingParsedData): NormalizedRingData | null => {
  if (!parsed?.type) return null;

  const collectedAt = parsed.timestamp || Date.now();

  switch (parsed.type) {
    case 'battery':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          battery: parsed.battery ?? parsed.value,
          batteryStatus: parsed.batteryStatus ?? parsed.status ?? parsed.chargingStatusText,
          chargingStatus: parsed.chargingStatus,
          chargingStatusText: parsed.chargingStatusText
        },
        raw: parsed
      };
    case 'firmware_version':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          firmwareVersion: parsed.firmwareVersion,
          hardwareVersion: parsed.hardwareVersion,
          softwareVersion: parsed.softwareVersion,
          uiVersion: parsed.uiVersion,
          screenWidth: parsed.screenWidth,
          screenHeight: parsed.screenHeight
        },
        raw: parsed
      };
    case 'hardwareVersion':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          hardwareVersion: parsed.value
        },
        raw: parsed
      };
    case 'softwareVersion':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          softwareVersion: parsed.value
        },
        raw: parsed
      };
    case 'collect_period_read':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          period: parsed.period,
          minutes: parsed.minutes
        },
        raw: parsed
      };
    case 'device_time':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          timestamp: parsed.deviceTimestamp ?? parsed.timestamp,
          receivedAt: parsed.timestamp,
          timezone: parsed.timezone,
          readable: parsed.readable
        },
        raw: parsed
      };
    case 'rw_health_monitoring':
    case 'rw_health_monitoring_ack':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          name: parsed.name,
          enabled: parsed.enabled,
          status: parsed.status,
          success: parsed.success,
          startHour: parsed.startHour,
          startMinute: parsed.startMinute,
          endHour: parsed.endHour,
          endMinute: parsed.endMinute,
          interval: parsed.interval,
          period: typeof parsed.interval === 'number' ? parsed.interval * 60 : parsed.period,
          minutes: parsed.minutes ?? parsed.interval
        },
        raw: parsed
      };
    case 'rw_health_data':
    case 'rw_health_data_ack':
    case 'rw_health_data_control_ack':
    case 'rw_health_data_pending':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          name: parsed.name,
          key: parsed.key,
          flag: parsed.flag,
          value: parsed.value,
          success: parsed.success,
          status: parsed.status,
          statusCode: parsed.statusCode,
          statusText: parsed.statusText,
          message: parsed.message,
          controlKey: parsed.controlKey,
          controlAction: parsed.controlAction,
          data: parsed.data || []
        },
        raw: parsed
      };
    case 'rw_file_list':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          files: parsed.files || [],
          allFiles: parsed.allFiles || parsed.files || [],
          selectedFiles: parsed.selectedFiles || [],
          totalFileCount: parsed.totalFileCount,
          selectedFileCount: parsed.selectedFileCount,
          filteredFileCount: parsed.filteredFileCount,
          readAll: parsed.readAll,
          sinceTimestamp: parsed.sinceTimestamp,
          dataType: parsed.dataType
        },
        raw: parsed
      };
    case 'rw_upload_file':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          seq: parsed.seq,
          status: parsed.status,
          statusCode: parsed.statusCode,
          fileName: parsed.fileName,
          fileType: parsed.fileType,
          dataType: parsed.dataType ?? getRwUploadHistoryDataType(parsed.fileType, parsed.fileName),
          startTimestamp: parsed.startTimestamp,
          endTimestamp: parsed.endTimestamp,
          records: parsed.records || [],
          payloadHex: parsed.payloadHex
        },
        raw: parsed
      };
    case 'rw_upload_request':
    case 'rw_upload_progress':
    case 'rw_last_package_progress':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          seq: parsed.seq,
          status: parsed.status,
          statusCode: parsed.statusCode,
          progress: parsed.progress,
          startTimestamp: parsed.startTimestamp,
          endTimestamp: parsed.endTimestamp
        },
        raw: parsed
      };
    case 'rw_history_pending':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          status: parsed.status,
          message: parsed.message,
          error: parsed.error
        },
        raw: parsed
      };
    case 'active_measure':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          heartRate: parsed.heartRate,
          hrv: parsed.heartRateVariability,
          stress: parsed.stressIndex,
          fatigue: parsed.fatigue,
          fatigueLevel: parsed.fatigueLevel,
          anxiety: parsed.anxiety,
          anxietyLevel: parsed.anxietyLevel,
          alarmText: parsed.alarmText,
          alarmFlags: parsed.alarmFlags,
          temperature: parsed.temperature,
          status: parsed.heartbeatStatus,
          statusText: parsed.status
        },
        raw: parsed
      };
    case 'active_OxyGenMeasure':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          heartRate: parsed.heartRate,
          bloodOxygen: parsed.bloodOxygen,
          fatigue: parsed.fatigue,
          fatigueLevel: parsed.fatigueLevel,
          anxiety: parsed.anxiety,
          anxietyLevel: parsed.anxietyLevel,
          alarmText: parsed.alarmText,
          alarmFlags: parsed.alarmFlags,
          temperature: parsed.temperature,
          status: parsed.bloodOxygenStatus,
          statusText: parsed.status
        },
        raw: parsed
      };
    case 'active_Temperature':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          temperature: parsed.temperature,
          temperatureValue: parsed.temperatureValue,
          status: parsed.temperatureStatus,
          statusText: parsed.status
        },
        raw: parsed
      };
    case 'local_data':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          protocol: parsed.protocol,
          sourceType: parsed.sourceType,
          records: parsed.records || [],
          totalNum: parsed.totalNum,
          status: parsed.status,
          message: parsed.message,
          files: parsed.files || [],
          allFiles: parsed.allFiles || [],
          totalFileCount: parsed.totalFileCount,
          selectedFileCount: parsed.selectedFileCount,
          filteredFileCount: parsed.filteredFileCount,
          readAll: parsed.readAll,
          sinceTimestamp: parsed.sinceTimestamp,
          dataType: parsed.dataType
        },
        raw: parsed
      };
    case 'qkeer_v2_health':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          unixTime: parsed.unixTime,
          heartRate: parsed.heartRate,
          bloodOxygen: parsed.bloodOxygen ?? parsed.spo2,
          temperature: parsed.temperature
        },
        raw: parsed
      };
    case 'qkeer_v2_health_list':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          protocol: parsed.protocol,
          dataType: parsed.dataType || 'vital',
          records: parsed.records || [],
          totalNum: parsed.totalNum,
          status: parsed.status
        },
        raw: parsed
      };
    case 'qkeer_v2_step':
    case 'qkeer_v2_last_data':
    case 'qkeer_v2_heartbeat':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          battery: parsed.battery ?? parsed.batteryLevel,
          batteryLevel: parsed.batteryLevel ?? parsed.battery,
          chargingStatus: parsed.chargingStatus,
          chargingStatusText: parsed.chargingStatusText,
          heartRate: parsed.heartRate ?? parsed.heartrate,
          bloodOxygen: parsed.bloodOxygen ?? parsed.spo2,
          temperature: parsed.temperature,
          hrv: parsed.hrv ?? parsed.heartRateVariability,
          stress: parsed.stress ?? parsed.stressIndex ?? parsed.pressure,
          bloodSugar: parsed.bloodSugar ?? parsed.glucose,
          bloodPressure: parsed.bloodPressure,
          systolic: parsed.systolic,
          diastolic: parsed.diastolic,
          step: parsed.step ?? parsed.stepCount,
          stepCount: parsed.stepCount ?? parsed.step,
          isWorn: parsed.isWorn,
          sleepTotalMinutes: parsed.sleepTotalMinutes,
          sleepDeepMinutes: parsed.sleepDeepMinutes,
          sleepLightMinutes: parsed.sleepLightMinutes,
          sleepRemMinutes: parsed.sleepRemMinutes,
          sleepAwakeMinutes: parsed.sleepAwakeMinutes,
          fatigue: parsed.fatigue,
          fatigueLevel: parsed.fatigueLevel,
          anxiety: parsed.anxiety,
          anxietyLevel: parsed.anxietyLevel,
          records: parsed.records || []
        },
        raw: parsed
      };
    case 'qkeer_v2_sleep':
    case 'qkeer_v2_last_data_sleep':
    case 'qkeer_v2_sleep_list':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          protocol: parsed.protocol,
          dataType: parsed.dataType || 'sleep',
          status: parsed.status,
          totalNum: parsed.totalNum,
          sleepType: parsed.sleepType,
          sleepStatus: parsed.sleepStatus,
          sleepStatusText: parsed.sleepStatusText,
          durationMinutes: parsed.durationMinutes,
          sleepTotalMinutes: parsed.sleepTotalMinutes,
          sleepDeepMinutes: parsed.sleepDeepMinutes,
          sleepLightMinutes: parsed.sleepLightMinutes,
          sleepRemMinutes: parsed.sleepRemMinutes,
          sleepAwakeMinutes: parsed.sleepAwakeMinutes,
          records: parsed.records || []
        },
        raw: parsed
      };
    case 'qkeer_v2_step_list':
    case 'qkeer_v2_ecg':
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: {
          protocol: parsed.protocol,
          dataType: parsed.dataType || (parsed.type === 'qkeer_v2_ecg' ? 'ecg' : 'step'),
          records: parsed.records || [],
          totalNum: parsed.totalNum,
          status: parsed.status
        },
        raw: parsed
      };
    default:
      return {
        sourceType: parsed.type,
        collectedAt,
        metrics: { ...parsed },
        raw: parsed
      };
  }
};

const getRwUploadHistoryDataType = (fileType?: string, fileName?: string) => {
  const value = `${fileType || ''}_${fileName || ''}`.toLowerCase();
  if (/sleep/.test(value)) return 'sleep';
  if (/step|sport|activity/.test(value)) return 'step';
  if (/hrv/.test(value)) return 'hrv';
  if (/blood[_-]?pressure|(^|[_\-.])bp($|[_\-.])/.test(value)) return 'blood_pressure';
  if (/blood[_-]?sugar|glucose|\bbs\b/.test(value)) return 'blood_sugar';
  if (/stress|(^|[_\-.])pressure($|[_\-.])|fatigue/.test(value)) return 'stress';
  if (/spo2|oxygen|blood[_-]?oxy|\bbo\b|red|ir/.test(value)) return 'blood_oxygen_raw';
  if (/temperature|temp|body[_-]?temp/.test(value)) return 'temperature';
  if (/heart|heart[_-]?rate|(^|[_\-.])hr($|[_\-.])/.test(value)) return 'heart_rate_raw';
  return fileType || 'history_file';
};
