import { getRwForegroundMetricValue } from './useRwForegroundMeasurement';

const validSpo2 = getRwForegroundMetricValue('blood_oxygen', {
  type: 'rw_health_data',
  name: 'blood_oxygen',
  value: 99
});

const validNestedSpo2 = getRwForegroundMetricValue('blood_oxygen', {
  type: 'rw_health_data',
  name: 'blood_oxygen',
  metrics: {
    spo2: '98%'
  }
});

const invalidDirectSpo2 = getRwForegroundMetricValue('blood_oxygen', {
  type: 'rw_health_data',
  name: 'blood_oxygen',
  value: 46
});

const invalidTextSpo2 = getRwForegroundMetricValue('blood_oxygen', {
  type: 'active_OxyGenMeasure',
  bloodOxygen: '46%'
});

const invalidRawSpo2 = getRwForegroundMetricValue('blood_oxygen', {
  type: 'rw_health_data',
  name: 'blood_oxygen',
  raw: {
    value: 46
  }
});

const validHeartRate = getRwForegroundMetricValue('heart_rate', {
  type: 'rw_health_data',
  name: 'heart_rate',
  value: 72
});

const validHeartRateFromStatusPrefixedData = getRwForegroundMetricValue('heart_rate', {
  type: 'rw_health_data',
  name: 'heart_rate',
  data: [0x31, 0, 0, 0, 73]
});

const invalidStatusHeartRate = getRwForegroundMetricValue('heart_rate', {
  type: 'rw_health_data_control_ack',
  name: 'heart_rate',
  value: 0x31
});

const invalidHighHeartRate = getRwForegroundMetricValue('heart_rate', {
  type: 'rw_health_data',
  name: 'heart_rate',
  value: 241
});

const validBloodSugar = getRwForegroundMetricValue('blood_sugar', {
  type: 'rw_health_data',
  name: 'blood_sugar',
  value: 58
});

const validBloodSugarFromStatusPrefixedData = getRwForegroundMetricValue('blood_sugar', {
  type: 'rw_health_data',
  name: 'blood_sugar',
  data: [0x11, 58]
});

const invalidStatusBloodSugar = getRwForegroundMetricValue('blood_sugar', {
  type: 'rw_health_data_control_ack',
  name: 'blood_sugar',
  value: 0x11
});

const validTemperatureText = getRwForegroundMetricValue('temperature', {
  type: 'rw_health_data',
  name: 'temperature',
  temperature: '36.7°C'
});

const validTemperatureFromBytes = getRwForegroundMetricValue('temperature', {
  type: 'rw_health_data',
  name: 'temperature',
  data: [0x72, 0x01]
});

const invalidTemperatureRawByte = getRwForegroundMetricValue('temperature', {
  type: 'rw_health_data',
  name: 'temperature',
  value: 0.59
});

const validSpo2FromStatusPrefixedData = getRwForegroundMetricValue('blood_oxygen', {
  type: 'rw_health_data',
  name: 'blood_oxygen',
  data: [0x11, 98]
});

const invalidSpo2FromStatusPrefixedData = getRwForegroundMetricValue('blood_oxygen', {
  type: 'rw_health_data',
  name: 'blood_oxygen',
  data: [0x11, 46]
});

if (
  validSpo2 !== 99 ||
  validNestedSpo2 !== 98 ||
  invalidDirectSpo2 !== null ||
  invalidTextSpo2 !== null ||
  invalidRawSpo2 !== null ||
  validHeartRate !== 72 ||
  validHeartRateFromStatusPrefixedData !== 73 ||
  invalidStatusHeartRate !== null ||
  invalidHighHeartRate !== null ||
  validBloodSugar !== 5.8 ||
  validBloodSugarFromStatusPrefixedData !== 5.8 ||
  invalidStatusBloodSugar !== null ||
  validTemperatureText !== 36.7 ||
  validTemperatureFromBytes !== 37 ||
  invalidTemperatureRawByte !== null ||
  validSpo2FromStatusPrefixedData !== 98 ||
  invalidSpo2FromStatusPrefixedData !== null
) {
  throw new Error(`RW foreground metric values should be range-checked before page success handling: ${JSON.stringify({
    validSpo2,
    validNestedSpo2,
    invalidDirectSpo2,
    invalidTextSpo2,
    invalidRawSpo2,
    validHeartRate,
    validHeartRateFromStatusPrefixedData,
    invalidStatusHeartRate,
    invalidHighHeartRate,
    validBloodSugar,
    validBloodSugarFromStatusPrefixedData,
    invalidStatusBloodSugar,
    validTemperatureText,
    validTemperatureFromBytes,
    invalidTemperatureRawByte,
    validSpo2FromStatusPrefixedData,
    invalidSpo2FromStatusPrefixedData
  })}`);
}
