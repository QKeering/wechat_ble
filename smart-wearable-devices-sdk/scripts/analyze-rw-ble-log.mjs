#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith('-'));
const LATEST_BUILD_TAG = 'rw-visible-build-tag-20260720-358';
const expectedBuildTag =
  args.find((arg) => arg.startsWith('--build-tag='))?.slice('--build-tag='.length) || LATEST_BUILD_TAG;
const failOnExpectedMetricMismatch = !args.includes('--no-fail');

const RW_KEY_NAMES = {
  0x0503: 'heart_rate',
  0x0504: 'blood_pressure',
  0x0508: 'temperature',
  0x0509: 'blood_oxygen',
  0x050a: 'hrv',
  0x050d: 'stress',
  0x0510: 'blood_sugar',
  0x0224: 'heart_rate',
  0x0230: 'temperature',
  0x0231: 'blood_pressure',
  0x024e: 'blood_oxygen',
  0x024f: 'stress',
  0x0269: 'hrv',
  0x026c: 'blood_sugar'
};

const RW_EXPECTED_REALTIME_KEYS = {
  heart_rate: 0x0503,
  temperature: 0x0508,
  blood_pressure: 0x0504,
  blood_oxygen: 0x0509,
  stress: 0x050d,
  hrv: 0x050a,
  blood_sugar: 0x0510
};

const RW_COMPAT_REALTIME_KEYS = {
  heart_rate: [0x0224],
  temperature: [0x0230],
  blood_pressure: [0x0231],
  blood_oxygen: [0x024e],
  stress: [0x024f],
  hrv: [0x0269],
  blood_sugar: [0x026c]
};

const REALTIME_METRIC_VALUE_KEYS = {
  heart_rate: ['heartRate', 'heart_rate', 'hr'],
  blood_oxygen: ['bloodOxygen', 'blood_oxygen', 'spo2', 'oxygen'],
  temperature: ['temperature', 'bodyTemperature', 'body_temperature', 'bodyTemp', 'skinTemperature', 'skin_temperature'],
  hrv: ['heartRateVariability', 'heart_rate_variability', 'hrv'],
  stress: ['stressIndex', 'stress_index', 'stress', 'pressure'],
  blood_sugar: ['bloodSugar', 'blood_sugar', 'glucose', 'sugar'],
  blood_pressure: ['bloodPressure', 'blood_pressure', 'bp']
};

const BLOOD_PRESSURE_HIGH_KEYS = ['systolic', 'high', 'highPressure', 'bloodPressureHigh', 'blood_pressure_high', 'sbp', 'sp'];
const BLOOD_PRESSURE_LOW_KEYS = ['diastolic', 'low', 'lowPressure', 'bloodPressureLow', 'blood_pressure_low', 'dbp', 'dp'];

const normalizeExpectedMetricName = (value) => {
  const compact = String(value || '').trim().replace(/[-_\s]/g, '').toLowerCase();
  if (!compact) return '';
  if (compact === 'heartrate' || compact === 'hr') return 'heart_rate';
  if (compact === 'bloodoxygen' || compact === 'spo2' || compact === 'oxygen') return 'blood_oxygen';
  if (compact === 'temperature' || compact === 'bodytemperature' || compact === 'temp') return 'temperature';
  if (compact === 'hrv' || compact === 'heartratevariability') return 'hrv';
  if (compact === 'stress' || compact === 'stressindex' || compact === 'pressure') return 'stress';
  if (compact === 'bloodpressure' || compact === 'bp') return 'blood_pressure';
  if (compact === 'bloodsugar' || compact === 'glucose' || compact === 'sugar') return 'blood_sugar';
  return RW_EXPECTED_REALTIME_KEYS[value] ? value : compact;
};

const expectedMetricInputs = args
  .filter((arg) => arg.startsWith('--expect-metric='))
  .flatMap((arg) => arg.slice('--expect-metric='.length).split(','))
  .map((item) => item.trim())
  .filter(Boolean);
const expectedMetricNames = [...new Set(expectedMetricInputs.map(normalizeExpectedMetricName).filter(Boolean))];
const unknownExpectedMetricNames = expectedMetricNames.filter((name) => !RW_EXPECTED_REALTIME_KEYS[name]);

const RW_EXPECTED_HISTORY_ALIASES = {
  sleep: ['sleepData'],
  sleepdata: ['sleepData'],
  activity: ['activity'],
  exercise: ['activity'],
  motion: ['activity'],
  stress: ['stress'],
  pressure: ['stress'],
  vital: ['vital'],
  vitals: ['vital'],
  vitalsigns: ['vital'],
  heartrate: ['heartRate'],
  hr: ['heartRate'],
  bloodoxygen: ['bloodOxygen'],
  spo2: ['bloodOxygen'],
  oxygen: ['bloodOxygen'],
  hrv: ['hrv'],
  temperature: ['skinTemperature'],
  skintemperature: ['skinTemperature'],
  bodytemperature: ['skinTemperature'],
  bloodsugar: ['bloodSugar'],
  glucose: ['bloodSugar'],
  sugar: ['bloodSugar'],
  bloodpressure: ['bloodPressure'],
  bp: ['bloodPressure'],
  summary: ['summary'],
  lastdata: ['summary'],
  lastsnapshot: ['summary']
};

const normalizeExpectedHistoryName = (value) => {
  const compact = String(value || '').trim().replace(/[-_\s]/g, '').toLowerCase();
  if (!compact) return [];
  return RW_EXPECTED_HISTORY_ALIASES[compact] || [];
};

const expectedHistoryInputs = args
  .filter((arg) => arg.startsWith('--expect-history='))
  .flatMap((arg) => arg.slice('--expect-history='.length).split(','))
  .map((item) => item.trim())
  .filter(Boolean);
const expectedHistoryTypes = [
  ...new Set(expectedHistoryInputs.flatMap(normalizeExpectedHistoryName).filter(Boolean))
];
const unknownExpectedHistoryNames = expectedHistoryInputs.filter(
  (name) => normalizeExpectedHistoryName(name).length === 0
);
const RW_L19_GATE_METRICS = ['heart_rate', 'blood_oxygen'];
const RW_L19_GATE_HISTORIES = ['sleepData', 'activity', 'stress', 'vital'];
const RW_L19_ACCEPTANCE_EXPECTED_KEYS = [
  'core-protocol',
  'metric:temperature',
  'metric:hrv',
  'metric:stress',
  'metric:blood_pressure',
  'metric:blood_sugar',
  'history:sleep',
  'history:activity',
  'history:stress',
  'history:vital'
];
const RW_L19_ACCEPTANCE_HISTORY_KEY_MAP = {
  sleep: 'sleepData',
  activity: 'activity',
  stress: 'stress',
  vital: 'vital'
};

const RW_HISTORY_KEYS = {
  heart_rate: 0x0503,
  blood_pressure: 0x0504,
  temperature: 0x0508,
  blood_oxygen: 0x0509,
  hrv: 0x050a,
  stress: 0x050d,
  blood_sugar: 0x0510
};

const RW_ALIAS_TYPES = new Set(['active_measure', 'active_OxyGenMeasure', 'active_Temperature']);
const HISTORY_SYNC_EVENTS = new Set([
  'history-sync-start',
  'history-sync-result',
  'history-sync-failed',
  'history-sync-reuse-inflight',
  'compat-history-queue-enqueue',
  'compat-history-queue-start',
  'compat-history-queue-result',
  'compat-history-queue-failed'
]);
const RW_HISTORY_DETAIL_EVENTS = new Set([
  'history-preflight-start',
  'history-preflight-sent',
  'history-preflight-response',
  'history-preflight-timeout',
  'history-preflight-failed',
  'history-initial-wait-start',
  'history-initial-file-list-fallback',
  'history-fallback-wait-start',
  'history-native-list-fallback',
  'history-native-list-wait-response',
  'history-native-list-wait-timeout',
  'history-native-last-data-fallback',
  'history-last-data-wait-response',
  'history-last-data-wait-timeout',
  'history-final-read-local-data-fallback',
  'history-final-read-local-data-response',
  'history-final-read-local-data-timeout',
  'history-ab-key-fallback',
  'history-ab-key-response',
  'history-ab-key-timeout',
  'history-ab-key-retry-continue',
  'history-ab-key-result',
  'history-ab-key-partial-continue',
  'history-ab-key-empty-use-pre-native',
  'ab-health-history-received',
  'history-last-data-only-start',
  'history-last-data-only-response',
  'history-last-data-only-timeout',
  'history-unexpected-response',
  'file-list-fallback-write-failed',
  'file-list-received',
  'native-list-received',
  'history-initial-timeout',
  'legacy-local-data-received',
  'sync-empty',
  'sync-result',
  'upload-request-start',
  'upload-request-result'
]);
const RW_PAGE_HISTORY_EVENTS = new Set([
  'history-page-sync-start',
  'history-page-sync-result',
  'history-page-sync-failed',
  'history-page-upload-result',
  'history-page-upload-failed',
  'history-page-upload-skip',
  'history-page-sync-skip',
  'history-page-empty-fallback-start',
  'history-page-empty-fallback-result',
  'history-page-empty-fallback-upload-failed',
  'history-page-empty-fallback-failed',
  'history-page-missing-vital-fallback-start',
  'history-page-missing-vital-fallback-result',
  'history-page-missing-vital-fallback-upload-failed',
  'history-page-missing-vital-fallback-failed',
  'history-page-missing-step-sleep-fallback-start',
  'history-page-missing-step-sleep-fallback-result',
  'history-page-missing-step-sleep-fallback-upload-failed',
  'history-page-missing-step-sleep-fallback-failed',
  'history-page-query-result',
  'history-page-query-failed'
]);
const RW_MINE_HISTORY_EVENTS = new Set([
  'diagnostic-history-report',
  'manual-history-sync-start',
  'manual-history-sync-result',
  'manual-history-sync-failed'
]);
const RW_MINE_METRIC_EVENTS = new Set(['manual-metric-start', 'manual-metric-result', 'manual-metric-failed']);
const PAGE_METRIC_SOURCES = new Set(['RW PAGE', 'RW VITAL', 'RW MINE']);
const RW_STORE_CONNECT_EVENTS = new Set([
  'connect-request',
  'connect-reuse-inflight',
  'connect-wait-other-inflight',
  'connect-other-inflight-matched',
  'connect-switch-device',
  'connect-cancelled-before-start',
  'connect-attempt-start',
  'connect-cancelled-after-result',
  'connect-attempt-result',
  'connect-attempt-error',
  'cancel-pending-connection',
  'ensure-ready-start',
  'ensure-ready-cancelled-before-listener',
  'ensure-ready-reuse-recent',
  'ensure-ready-discover-refresh-start',
  'ensure-ready-cancelled-after-discover',
  'ensure-ready-cancelled-after-notify',
  'ensure-ready-notify-restored',
  'ensure-ready-notify-restore-failed',
  'ensure-ready-reconnect-result'
]);
const RW_REALTIME_READ_SUFFIXES = {
  '050310': 'heart_rate/read',
  '050810': 'temperature/read',
  '050410': 'blood_pressure/read',
  '050910': 'blood_oxygen/read',
  '050d10': 'stress/read',
  '050a10': 'hrv/read',
  '051010': 'blood_sugar/read',
  '022410': 'heart_rate/read',
  '023010': 'temperature/read',
  '023110': 'blood_pressure/read',
  '024e10': 'blood_oxygen/read',
  '024f10': 'stress/read',
  '026910': 'hrv/read',
  '026c10': 'blood_sugar/read'
};
const RW_REALTIME_CONTROL_SUFFIXES = {
  '060900030501': 'heart_rate/control-enable',
  '060900030500': 'heart_rate/control-disable',
  '060900080501': 'temperature/control-enable',
  '060900080500': 'temperature/control-disable',
  '060900090501': 'blood_oxygen/control-enable',
  '060900090500': 'blood_oxygen/control-disable',
  '0609000a0501': 'hrv/control-enable',
  '0609000a0500': 'hrv/control-disable',
  '0609000d0501': 'stress/control-enable',
  '0609000d0500': 'stress/control-disable',
  '060900100501': 'blood_sugar/control-enable',
  '060900100500': 'blood_sugar/control-disable',
  '060900040501': 'blood_pressure/control-enable',
  '060900040500': 'blood_pressure/control-disable'
};
const RW_HISTORY_COMMAND_MARKERS = new Set(['3600', '3601', '3610']);
const RW_QKEER_V2_HISTORY_COMMANDS = new Map([
  ['31', 'native_sleep_list'],
  ['41', 'native_health_list'],
  ['70', 'native_last_data'],
  ['71', 'native_step_list']
]);

const readInput = () => {
  if (inputPath) {
    const absolutePath = path.resolve(inputPath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Log file not found: ${absolutePath}`);
    }
    return fs.readFileSync(absolutePath, 'utf8');
  }
  return fs.readFileSync(0, 'utf8');
};

const parseJsonDetails = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const parseLine = (line, lineNumber) => {
  const match = line.match(/^\[(.*?)\]\s+\[(.*?)\]\s+([^\s]+)(?:\s+(.*))?$/);
  if (!match) {
    return {
      lineNumber,
      raw: line,
      time: '',
      source: '',
      event: '',
      detailsText: '',
      details: null
    };
  }
  return {
    lineNumber,
    raw: line,
    time: match[1],
    source: match[2],
    event: match[3],
    detailsText: match[4] || '',
    details: parseJsonDetails(match[4] || '')
  };
};

const parseEntryTimeMs = (time) => {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const [, hour, minute, second, ms = '0'] = match;
  return (Number(hour) * 3600 + Number(minute) * 60 + Number(second)) * 1000 + Number(ms.padEnd(3, '0'));
};

const increment = (map, key) => {
  const text = key || '(empty)';
  map.set(text, (map.get(text) || 0) + 1);
};

const toKeyHex = (key) => (Number.isFinite(key) ? `0x${key.toString(16).padStart(4, '0')}` : '');

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

const getFirstMetricFieldValue = (sources, keys) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
};

const formatMetricBloodPressureValue = (value) => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const values = typeof value[0] === 'number' && (value[0] === 0x11 || value[0] === 0x31) ? value.slice(1) : value;
    return values[0] !== undefined || values[1] !== undefined ? `${values[0] ?? '-'}/${values[1] ?? '-'}` : undefined;
  }
  if (typeof value === 'string') {
    const matched = value.match(/(\d{2,3})\D+(\d{2,3})/);
    return matched ? `${matched[1]}/${matched[2]}` : value;
  }
  if (typeof value === 'object') {
    const systolic = getFirstMetricFieldValue([value], BLOOD_PRESSURE_HIGH_KEYS);
    const diastolic = getFirstMetricFieldValue([value], BLOOD_PRESSURE_LOW_KEYS);
    if (systolic !== undefined || diastolic !== undefined) return `${systolic ?? '-'}/${diastolic ?? '-'}`;
  }
  return value;
};

const getRealtimeMetricValueFromSources = (sources, name = '') => {
  const genericValue = getFirstMetricFieldValue(sources, ['value']);
  if (genericValue !== undefined) return name === 'blood_pressure' ? formatMetricBloodPressureValue(genericValue) : genericValue;

  const keys = REALTIME_METRIC_VALUE_KEYS[name] || Object.values(REALTIME_METRIC_VALUE_KEYS).flat();
  const value = getFirstMetricFieldValue(sources, keys);
  if (value !== undefined) return name === 'blood_pressure' ? formatMetricBloodPressureValue(value) : value;

  if (name === 'blood_pressure') {
    const systolic = getFirstMetricFieldValue(sources, BLOOD_PRESSURE_HIGH_KEYS);
    const diastolic = getFirstMetricFieldValue(sources, BLOOD_PRESSURE_LOW_KEYS);
    if (systolic !== undefined || diastolic !== undefined) return `${systolic ?? '-'}/${diastolic ?? '-'}`;
  }

  return undefined;
};

const toCount = (...values) => {
  const value = firstDefined(...values);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toTextList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
};

const getMetricNameFromLabel = (label) => {
  const name = String(label || '').split('/')[0];
  return RW_EXPECTED_REALTIME_KEYS[name] ? name : '';
};

const classifyRwCommand = (details = {}) => {
  const label = String(details?.label || '');
  const labelLower = label.toLowerCase();
  const hex = String(details?.hex || '').toLowerCase();

  if (labelLower.includes('native-last-data') || labelLower.includes('last-data')) {
    return { kind: 'history', name: 'native_last_data', label: label || 'history/native-last-data' };
  }

  if (labelLower.includes('history') || labelLower.includes('file-list') || labelLower.includes('localdata')) {
    return { kind: 'history', name: 'history_snapshot', label: label || 'history/label' };
  }

  const metricName = getMetricNameFromLabel(label);
  if (metricName) {
    if (label.includes('control-enable')) return { kind: 'realtime-control', name: metricName, label: `${metricName}/control-enable` };
    if (label.includes('control-disable')) return { kind: 'realtime-control', name: metricName, label: `${metricName}/control-disable` };
    return { kind: 'realtime-read', name: metricName, label };
  }

  for (const [suffix, commandLabel] of Object.entries(RW_REALTIME_CONTROL_SUFFIXES)) {
    if (hex.includes(suffix)) {
      return { kind: 'realtime-control', name: commandLabel.split('/')[0], label: commandLabel };
    }
  }

  for (const [suffix, commandLabel] of Object.entries(RW_REALTIME_READ_SUFFIXES)) {
    if (hex.endsWith(suffix) || hex.includes(suffix)) {
      return { kind: 'realtime-read', name: commandLabel.split('/')[0], label: commandLabel };
    }
  }

  const commandWord = hex.slice(4, 8);
  if (RW_HISTORY_COMMAND_MARKERS.has(commandWord)) {
    return { kind: 'history', name: 'history_snapshot', label: `history/${commandWord}` };
  }

  const qkeerV2Command = hex.length >= 24 && hex.slice(0, 2) !== 'ab' ? hex.slice(22, 24) : '';
  if (RW_QKEER_V2_HISTORY_COMMANDS.has(qkeerV2Command)) {
    const name = RW_QKEER_V2_HISTORY_COMMANDS.get(qkeerV2Command);
    return { kind: 'history', name, label: `history/qkeer-v2/${qkeerV2Command}` };
  }

  return null;
};

const pushMetric = (metrics, item, sourceLine) => {
  if (!item || typeof item !== 'object') return;
  const key = Number(item.key);
  const keyHex = toKeyHex(key);
  const name = String(item.name || RW_KEY_NAMES[key] || '').trim();
  const normalizedName = normalizeExpectedMetricName(name);
  const value = getRealtimeMetricValueFromSources([item, item.metrics, item.data, item.raw], normalizedName) ?? null;
  const type = String(item.type || '').trim();
  if (!type && !name && value == null) return;
  metrics.push({
    line: sourceLine,
    type,
    name,
    key,
    keyHex,
    value
  });
};

const summarizeHistoryDetails = (details) => {
  if (!details || typeof details !== 'object') return {};
  const parsed = details.parsed && typeof details.parsed === 'object' ? details.parsed : {};
  const response = details.response && typeof details.response === 'object' ? details.response : {};
  const summary = details.summary && typeof details.summary === 'object' ? details.summary : {};
  const compactLatest = details.latest && typeof details.latest === 'object' ? details.latest : {};
  const compactUpload = details.upload && typeof details.upload === 'object' ? details.upload : {};
  const compactQuery = details.query && typeof details.query === 'object' ? details.query : {};
  return {
    status: firstDefined(details.status, summary.status, parsed.status, compactLatest.status),
    message: firstDefined(details.message, summary.message, parsed.message, details.error, compactLatest.error),
    sourceType: firstDefined(details.sourceType, summary.sourceType, parsed.sourceType, parsed.type, response.sourceType, response.type, compactLatest.sourceType),
    responseType: firstDefined(details.responseType, summary.responseType, response.type),
    packetShape: firstDefined(details.packetShape, summary.packetShape, parsed.packetShape, response.packetShape, compactLatest.packet),
    readAll: details.readAll,
    lastReadTimestamp: firstDefined(details.lastReadTimestamp, summary.lastReadTimestamp),
    uploaded: firstDefined(details.uploaded, details.submitted, summary.uploaded, summary.submitted, compactUpload.uploaded),
    deleted: firstDefined(details.deleted, summary.deleted),
    recordCount: toCount(details.recordCount, details.count, summary.recordCount, summary.count, parsed.recordCount, response.recordCount, parsed.totalNum, response.totalNum, compactLatest.records, compactUpload.records),
    rawRecordCount: toCount(details.rawRecordCount, details.rawCount, summary.rawRecordCount, summary.rawCount, compactUpload.rawRecords),
    submitRecordCount: toCount(details.submitRecordCount, summary.submitRecordCount, details.count, summary.count, compactUpload.submitRecords),
    maxTimestamp: toCount(details.maxTimestamp, summary.maxTimestamp),
    totalFileCount: toCount(details.totalFileCount, summary.totalFileCount, parsed.totalFileCount, response.totalFileCount, response.fileCount),
    selectedFileCount: toCount(details.selectedFileCount, summary.selectedFileCount, parsed.selectedFileCount, response.selectedFileCount),
    filteredFileCount: toCount(details.filteredFileCount, summary.filteredFileCount, parsed.filteredFileCount),
    elapsedMs: toCount(details.elapsedMs, summary.elapsedMs, compactLatest.elapsedMs, compactUpload.elapsedMs, compactQuery.elapsedMs),
    phase: firstDefined(details.phase, summary.phase, compactLatest.phase),
    timeoutMs: details.timeoutMs,
    waitMs: details.waitMs,
    delayMs: details.delayMs,
    responseTimeoutMs: details.responseTimeoutMs,
    responseWaitMs: firstDefined(details.responseWaitMs, compactLatest.responseWaitMs),
    attempt: firstDefined(details.attempt, details.nextAttempt, compactLatest.attempt),
    flag: toCount(details.flag, response.flag, compactLatest.flag),
    previousFlag: toCount(details.previousFlag),
    responseFlag: toCount(details.responseFlag),
    retryDelayMs: details.retryDelayMs,
    commandIntervalMs: details.commandIntervalMs,
    queueDepth: toCount(details.queueDepth, compactLatest.queueDepth),
    queuedBehind: toCount(details.queuedBehind, compactLatest.queuedBehind),
    command: details.command,
    commands: toTextList(firstDefined(details.commands, compactLatest.commands)),
    key: firstDefined(details.key, compactLatest.key),
    label: firstDefined(details.label, compactLatest.label),
    page: firstDefined(details.page, compactLatest.page, compactQuery.page),
    endpoint: firstDefined(details.endpoint, compactQuery.endpoint),
    waitFor: details.waitFor,
    cachedResponseType: details.cachedResponseType,
    unexpectedResponseCount: toCount(details.unexpectedResponseCount, compactLatest.unexpectedResponseCount),
    uploadEventCount: toCount(details.uploadEventCount),
    finished: details.finished,
    eventTypes: toTextList(details.eventTypes),
    itemCount: toCount(details.itemCount, response.itemCount, response.count, response.total, compactQuery.items),
    dataType: firstDefined(details.dataType, summary.dataType, parsed.dataType, response.dataType),
    dataTypes: toTextList(firstDefined(details.dataTypes, summary.dataTypes, parsed.dataTypes, response.dataTypes, compactLatest.types, details.dataType, summary.dataType, parsed.dataType, response.dataType)),
    missingMetrics: toTextList(firstDefined(details.missingMetrics, compactLatest.missingMetrics)),
    primaryRawMetricCounts: firstDefined(details.primaryRawMetricCounts, compactLatest.primaryRawMetricCounts),
    qkeerCommand: firstDefined(details.qkeerCommand, summary.qkeerCommand, parsed.qkeerCommand, response.qkeerCommand),
    deviceId: details.deviceId,
    stableIdentity: details.stableIdentity,
    diagnosticReportCount: toCount(details.n),
    diagnosticReportCounts: details.counts && typeof details.counts === 'object' ? details.counts : undefined
  };
};

const summarizeDiagnosticDevice = (device) => {
  if (!device || typeof device !== 'object' || Object.keys(device).length === 0) {
    return {
      ready: undefined
    };
  }

  return {
    deviceId: device.deviceId,
    name: device.name || device.deviceName || device.localName || device.displayName,
    protocol: device.protocol,
    mac: device.mac || device.advertis?.macInfo,
    uniMacId: device.uniMacId,
    serviceId: device.serviceId,
    cmdCharId: device.cmdCharId,
    dataCharId: device.dataCharId,
    ready: Boolean(device.ready || (device.deviceId && device.serviceId && device.cmdCharId && device.dataCharId))
  };
};

const normalizeDiagnosticSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const flatCurrentDevice = {
    deviceId: snapshot.deviceId,
    name: snapshot.name || snapshot.deviceName,
    protocol: snapshot.protocol,
    mac: snapshot.mac,
    uniMacId: snapshot.uniMacId,
    serviceId: snapshot.serviceId,
    cmdCharId: snapshot.cmdCharId,
    dataCharId: snapshot.dataCharId,
    ready: snapshot.ready
  };
  const currentDevice = summarizeDiagnosticDevice(snapshot.currentDevice || snapshot.deviceInfo || snapshot.current || flatCurrentDevice);
  const storeDevice = summarizeDiagnosticDevice(snapshot.storeDevice || {});
  const userDevice = summarizeDiagnosticDevice(snapshot.userDevice || {});
  const boundDevice = summarizeDiagnosticDevice(snapshot.boundDevice || snapshot.boundInfo || {});
  const pageConnected = typeof snapshot.pageConnected === 'boolean'
    ? snapshot.pageConnected
    : typeof snapshot.isConnected === 'boolean'
      ? snapshot.isConnected
      : snapshot.connected;
  const controllerReady = typeof snapshot.controllerReady === 'boolean'
    ? snapshot.controllerReady
    : typeof snapshot.isReady === 'boolean'
      ? snapshot.isReady
      : snapshot.ready;
  const connectionValues = [pageConnected, snapshot.storeConnected, snapshot.userConnected].filter(
    (value) => typeof value === 'boolean'
  );
  const readyValues = [currentDevice.ready || controllerReady, storeDevice.ready, userDevice.ready].filter(
    (value) => typeof value === 'boolean'
  );
  const hasConnectionEvidence = connectionValues.length > 0 || typeof snapshot.connected === 'boolean';
  const hasReadyEvidence = readyValues.length > 0 || typeof controllerReady === 'boolean';
  const anyReady = readyValues.some(Boolean);
  const anyConnected = connectionValues.some(Boolean) || Boolean(snapshot.connected);
  const connectedMismatch = connectionValues.length > 1 && !connectionValues.every((value) => value === connectionValues[0]);
  const readyMismatch = readyValues.length > 1 && !readyValues.every((value) => value === readyValues[0]);
  const staleStatus =
    anyReady &&
    [snapshot.storeReconnectStatus, snapshot.userReconnectStatus].some((status) => status === 'reconnecting' || status === 'failed');

  let status = 'unknown';
  if (!hasConnectionEvidence && !hasReadyEvidence) status = 'unknown';
  else if (!anyReady && !anyConnected) status = 'ble-not-ready';
  else if (connectedMismatch || readyMismatch || (anyReady && !anyConnected) || staleStatus) status = 'state-sync-suspect';
  else if (anyReady && anyConnected) status = 'ready';

  return {
    status,
    controllerReady,
    connected: snapshot.connected,
    pageConnected,
    storeConnected: snapshot.storeConnected,
    userConnected: snapshot.userConnected,
    storeReconnectStatus: snapshot.storeReconnectStatus,
    userReconnectStatus: snapshot.userReconnectStatus,
    storeReconnectResult: snapshot.storeReconnectResult,
    userReconnectResult: snapshot.userReconnectResult,
    currentDevice,
    storeDevice,
    userDevice,
    boundDevice,
    anyReady,
    anyConnected,
    connectedMismatch,
    readyMismatch,
    staleStatus
  };
};

const getDiagnosticSnapshot = (entry) => {
  const details = entry.details;
  if (!details || typeof details !== 'object') return null;
  if (details.snapshot && typeof details.snapshot === 'object') {
    return {
      buildTag: details.buildTag || details.snapshot.buildTag,
      snapshot: normalizeDiagnosticSnapshot(details.snapshot)
    };
  }
  if (entry.source === 'RW PAGE' && entry.event === 'device-info-snapshot') {
    return {
      buildTag: details.buildTag,
      snapshot: normalizeDiagnosticSnapshot(details)
    };
  }
  return null;
};

const buildMetricKeyChecks = (metrics, requestedMetrics) => {
  const relevantMetrics = metrics.filter(
    (item) => item.name && Number.isFinite(item.key) && (item.type === 'rw_health_data' || RW_ALIAS_TYPES.has(item.type))
  );
  const requestedNames = new Set([...requestedMetrics.keys()]);
  const names = new Set([...Object.keys(RW_EXPECTED_REALTIME_KEYS), ...relevantMetrics.map((item) => item.name)]);
  const rows = [];
  const mismatches = [];

  for (const name of [...names].sort()) {
    const expectedKey = RW_EXPECTED_REALTIME_KEYS[name];
    if (!expectedKey) continue;
    const acceptedKeys = [expectedKey, ...(RW_COMPAT_REALTIME_KEYS[name] || [])];
    const items = relevantMetrics.filter((item) => item.name === name);
    const hits = items.filter((item) => acceptedKeys.includes(item.key));
    const primaryHits = items.filter((item) => item.key === expectedKey);
    const compatibleHits = items.filter((item) => item.key !== expectedKey && acceptedKeys.includes(item.key));
    const bad = items.filter((item) => !acceptedKeys.includes(item.key));
    const wasRequested = requestedNames.has(name);
    if (!wasRequested && items.length === 0) continue;

    rows.push({
      name,
      requested: wasRequested,
      expectedKey,
      expectedKeyHex: toKeyHex(expectedKey),
      acceptedKeyHexes: acceptedKeys.map(toKeyHex),
      hitCount: hits.length,
      primaryHitCount: primaryHits.length,
      compatibleHitCount: compatibleHits.length,
      badCount: bad.length,
      hitSamples: hits.slice(-5),
      compatibleSamples: compatibleHits.slice(-5),
      badSamples: bad.slice(-8)
    });

    for (const item of bad) {
      mismatches.push({
        ...item,
        expectedKey,
        expectedKeyHex: toKeyHex(expectedKey),
        isHistoryKey: item.key === RW_HISTORY_KEYS[name]
      });
    }
  }

  return { rows, mismatches };
};

const formatMap = (map, limit = 12) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `  ${String(count).padStart(4)}  ${key}`)
    .join('\n') || '  none';

const printSection = (title, body = '') => {
  console.log(`\n## ${title}`);
  if (body) console.log(body);
};

const analyze = (text) => {
  const entries = text
    .split(/\r?\n/)
    .map((line, index) => parseLine(line, index + 1))
    .filter((entry) => entry.raw.trim().length > 0);

  const sourceCounts = new Map();
  const eventCounts = new Map();
  const txLabelCounts = new Map();
  const pageEventCounts = new Map();
  const oldLinkLines = [];
  const buildTagLines = [];
  const rawStaleBuildTagLines = [];
  const waitTimeouts = [];
  const waitCacheHits = [];
  const pendingWaiters = [];
  const metrics = [];
  const pendingMetrics = new Map();
  const requestedMetrics = new Map();
  const pageEvents = [];
  const deviceEvents = [];
  const pageReadFailures = [];
  const historyEvents = [];
  const rwCommandEvents = [];
  const rwRealtimeCommandCounts = new Map();
  const rwHistoryCommandEvents = [];
  const disconnectEvents = [];
  const ignoredDisconnectEvents = [];
  const restoreEvents = [];
  const reconnectEvents = [];
  const scanEvents = [];
  const connectEvents = [];
  const diagnosticSnapshots = [];
  const protocolProbeEvents = [];
  const acceptanceEvents = [];
  const diagnosticCopyIncompleteEvents = [];

  for (const entry of entries) {
    increment(sourceCounts, entry.source);
    increment(eventCounts, `${entry.source} ${entry.event}`.trim());

    const details = entry.details;
    const raw = entry.raw;
    if (raw.includes(expectedBuildTag) || details?.buildTag === expectedBuildTag) buildTagLines.push(entry);
    const buildTagMatches = raw.match(/rw-visible-build-tag-\d{8}-\d+/g) || [];
    if (buildTagMatches.some((tag) => tag !== expectedBuildTag) || (details?.buildTag && details.buildTag !== expectedBuildTag)) {
      rawStaleBuildTagLines.push(entry);
    }
    if (raw.includes('l19-primary') || raw.includes('direct-read')) oldLinkLines.push(entry);

    const diagnosticSnapshot = getDiagnosticSnapshot(entry);
    if (diagnosticSnapshot?.snapshot) {
      diagnosticSnapshots.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        buildTag: diagnosticSnapshot.buildTag,
        snapshot: diagnosticSnapshot.snapshot
      });
    }

    if (
      entry.source === 'RW BLE' &&
      entry.event === 'connection-state' &&
      details &&
      (details.connected === false || details.connected === 'false')
    ) {
      disconnectEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        timeMs: parseEntryTimeMs(entry.time),
        details: details || entry.detailsText
      });
    }
    if (entry.source === 'RW BLE' && entry.event === 'connection-state-ignored' && details) {
      ignoredDisconnectEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        timeMs: parseEntryTimeMs(entry.time),
        details: details || entry.detailsText
      });
    }

    if (entry.source === 'RW FLOW' && entry.event.startsWith('restore-')) {
      restoreEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }

    if (entry.source === 'RW STORE' && entry.event.startsWith('reconnect-')) {
      reconnectEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }

    if (entry.source === 'RW DEVICE') {
      deviceEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }

    if (entry.source === 'RW BLE' && (entry.event === 'scan-start' || entry.event === 'scan-found')) {
      scanEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }

    if (
      (entry.source === 'RW BLE' &&
        [
          'connect-start',
          'connect-created',
          'connect-fail',
          'connect-retry-cleanup',
          'connect-adapter-reset-start',
          'connect-adapter-reset-done',
          'connect-discover-fail',
          'discovery-ready',
          'notify-primary-enabled'
        ].includes(entry.event)) ||
      (entry.source === 'RW PAGE' && entry.event.startsWith('connect-page-')) ||
      (entry.source === 'RW FLOW' && entry.event.startsWith('connect-')) ||
      (entry.source === 'RW STORE' && RW_STORE_CONNECT_EVENTS.has(entry.event))
    ) {
      connectEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }

    if (details?.label) {
      const label = String(details.label);
      increment(txLabelCounts, label);
      const metricName = getMetricNameFromLabel(label);
      if (metricName) increment(requestedMetrics, metricName);
    }
    if (entry.source === 'RW BLE' && entry.event.startsWith('tx') && details) {
      const command = classifyRwCommand(details);
      if (command) {
        const commandEvent = {
          line: entry.lineNumber,
          time: entry.time,
          timeMs: parseEntryTimeMs(entry.time),
          event: entry.event,
          ...command,
          hex: details.hex,
          rawLabel: details.label
        };
        rwCommandEvents.push(commandEvent);
        if (command.kind === 'history') rwHistoryCommandEvents.push(commandEvent);
        if (command.kind === 'realtime-read' || command.kind === 'realtime-control') {
          increment(rwRealtimeCommandCounts, command.label);
        }
      }
    }
    if (entry.event === 'wait-timeout' && details) {
      waitTimeouts.push({ line: entry.lineNumber, timeoutMs: details.timeoutMs, pendingWaiters: details.pendingWaiters });
      if (Number.isFinite(Number(details.pendingWaiters))) pendingWaiters.push(Number(details.pendingWaiters));
    }
    if (entry.event === 'wait-cache-hit' && details) {
      waitCacheHits.push({ line: entry.lineNumber, timeoutMs: details.timeoutMs, parsed: details.parsed });
      if (details.parsed?.type) pushMetric(metrics, details.parsed, entry.lineNumber);
    }

    if (PAGE_METRIC_SOURCES.has(entry.source)) {
      increment(pageEventCounts, entry.event);
      if (
        entry.event.startsWith('single-metric-') ||
        entry.event.startsWith('single-read-') ||
        RW_MINE_METRIC_EVENTS.has(entry.event) ||
        entry.event === 'diagnostic-build'
      ) {
        pageEvents.push({
          line: entry.lineNumber,
          time: entry.time,
          source: entry.source,
          event: entry.event,
          details: details || entry.detailsText
        });
      }
      if (entry.source === 'RW PAGE' && entry.event === 'single-read-failed') {
        pageReadFailures.push({
          line: entry.lineNumber,
          time: entry.time,
          details: details || entry.detailsText
        });
      }
    }

    if (entry.source === 'RW MINE' && (entry.event.startsWith('protocol-probe-') || entry.event === 'diagnostic-probe-report')) {
      protocolProbeEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }
    if (entry.source === 'RW MINE' && (entry.event.startsWith('rw-l19-acceptance-') || entry.event === 'diagnostic-acceptance-report')) {
      acceptanceEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }
    if (entry.source === 'RW MINE' && entry.event === 'diagnostic-copy-incomplete') {
      diagnosticCopyIncompleteEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        event: entry.event,
        details: details || entry.detailsText
      });
    }

    if (
      (entry.source === 'RW FLOW' && HISTORY_SYNC_EVENTS.has(entry.event)) ||
      (entry.source === 'RW HISTORY' && RW_HISTORY_DETAIL_EVENTS.has(entry.event)) ||
      (entry.source === 'RW PAGE' && RW_PAGE_HISTORY_EVENTS.has(entry.event)) ||
      (entry.source === 'RW MINE' && RW_MINE_HISTORY_EVENTS.has(entry.event))
    ) {
      historyEvents.push({
        line: entry.lineNumber,
        time: entry.time,
        source: entry.source,
        event: entry.event,
        summary: summarizeHistoryDetails(details),
        rawDetails: details || entry.detailsText
      });
    }

    if (entry.event === 'rx-parsed' && Array.isArray(details?.parsed)) {
      for (const item of details.parsed) pushMetric(metrics, item, entry.lineNumber);
    }

    const parsed = details?.parsed;
    if (parsed?.type) {
      pushMetric(metrics, parsed, entry.lineNumber);
      if (parsed.type === 'rw_health_data_pending' && parsed.name) increment(pendingMetrics, parsed.name);
    }

    const latest = details?.latestNormalized;
    if (latest?.sourceType === 'rw_health_data_pending' && latest.metrics?.name) increment(pendingMetrics, latest.metrics.name);
    if (latest?.sourceType === 'rw_health_data') pushMetric(metrics, latest.metrics, entry.lineNumber);
  }

  const realtimeMetrics = metrics.filter((item) => item.type === 'rw_health_data');
  const latestExpectedBuildLine = buildTagLines.length > 0 ? Math.max(...buildTagLines.map((entry) => entry.lineNumber)) : 0;
  const staleBuildTagLines =
    latestExpectedBuildLine > 0
      ? rawStaleBuildTagLines.filter((entry) => entry.lineNumber > latestExpectedBuildLine)
      : rawStaleBuildTagLines;
  const batteryMetrics = metrics.filter((item) => item.type === 'battery');
  const controlAckMetrics = metrics.filter((item) => item.type === 'rw_health_data_control_ack');
  const metricSummary = new Map();
  for (const item of realtimeMetrics) {
    const key = `${item.name || '(unknown)'} ${item.keyHex || ''}`.trim();
    const values = metricSummary.get(key) || [];
    values.push({ value: item.value, line: item.line });
    metricSummary.set(key, values);
  }
  const metricKeyChecks = buildMetricKeyChecks(metrics, requestedMetrics);
  const realtimeAckOnly = buildRealtimeAckOnlyRows(controlAckMetrics, metricKeyChecks, requestedMetrics);
  const pageMetricFlows = buildPageMetricFlows(pageEvents);
  const batteryPageFailedAfterRx =
    batteryMetrics.length > 0 &&
    pageReadFailures.some((item) => {
      const details = item.details;
      return details && typeof details === 'object' && details.target === 'battery';
    });

  return {
    entries,
    sourceCounts,
    eventCounts,
    txLabelCounts,
    pageEventCounts,
    oldLinkLines,
    buildTagLines,
    staleBuildTagLines,
    historicalStaleBuildTagLines: rawStaleBuildTagLines,
    latestExpectedBuildLine,
    waitTimeouts,
    waitCacheHits,
    pendingWaiters,
    pendingMetrics,
    requestedMetrics,
    pageEvents,
    deviceEvents,
    pageMetricFlows,
    pageReadFailures,
    historyEvents,
    metricSummary,
    metricKeyChecks
    ,
    batteryMetrics,
    realtimeAckOnly,
    batteryPageFailedAfterRx,
    rwCommandEvents,
    rwRealtimeCommandCounts,
    rwHistoryCommandEvents,
    disconnectEvents,
    ignoredDisconnectEvents,
    restoreEvents,
    reconnectEvents,
    scanEvents,
    connectEvents,
    protocolProbeEvents,
    acceptanceEvents,
    diagnosticCopyIncompleteEvents,
    diagnosticSnapshots
  };
};

const buildRealtimeAckOnlyRows = (controlAcks, metricKeyChecks, requestedMetrics) => {
  const rows = [];
  const keyRowsByName = new Map(metricKeyChecks.rows.map((row) => [row.name, row]));
  for (const name of requestedMetrics.keys()) {
    const keyRow = keyRowsByName.get(name);
    if (keyRow?.hitCount > 0) continue;
    const namedAcks = controlAcks.filter((item) => item.name === name);
    const unknownAcks = controlAcks.filter((item) => !item.name || item.name === 'unknown');
    const samples = (namedAcks.length > 0 ? namedAcks : unknownAcks).slice(-5);
    if (samples.length === 0) continue;
    rows.push({
      name,
      expectedKey: RW_EXPECTED_REALTIME_KEYS[name],
      expectedKeyHex: toKeyHex(RW_EXPECTED_REALTIME_KEYS[name]),
      samples
    });
  }
  return rows;
};

const parseLooseLogField = (text, field) => {
  const matched = String(text || '').match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`));
  return matched ? matched[1] : undefined;
};

const parseLooseLogNumber = (text, field) => {
  const matched = String(text || '').match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!matched) return undefined;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : undefined;
};

const parseLooseLogBoolean = (text, field) => {
  const matched = String(text || '').match(new RegExp(`"${field}"\\s*:\\s*(true|false)`));
  return matched ? matched[1] === 'true' : undefined;
};

const parseLooseObjectDetails = (details) => {
  if (typeof details !== 'string') return {};
  const parsed = parseJsonDetails(details);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;

  const fields = [
    'key',
    'label',
    'metric',
    'target',
    'name',
    'family',
    'expected',
    'hex',
    'rawMessage',
    'message',
    'buildTag',
    'sourceType',
    'responseType',
    'packetShape',
    'dataType'
  ];
  const result = {};
  for (const field of fields) {
    const value = parseLooseLogField(details, field);
    if (value !== undefined) result[field] = value;
  }
  for (const field of ['index', 'total', 'elapsedMs', 'timeoutMs', 'waitMs', 'recordCount', 'okCount', 'failedCount', 'commandCount']) {
    const value = parseLooseLogNumber(details, field);
    if (value !== undefined) result[field] = value;
  }
  for (const field of ['wrote', 'uploaded', 'deleted', 'readAll']) {
    const value = parseLooseLogBoolean(details, field);
    if (value !== undefined) result[field] = value;
  }
  return result;
};

const getObjectDetails = (details) => {
  if (details && typeof details === 'object' && !Array.isArray(details)) return details;
  return parseLooseObjectDetails(details);
};

const normalizePageMetricName = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const token = text.split('/')[0];
  if (RW_EXPECTED_REALTIME_KEYS[token]) return token;
  if (token === '\u5fc3\u7387') return 'heart_rate';
  if (token === '\u8840\u6c27') return 'blood_oxygen';
  if (token === '\u4f53\u6e29') return 'temperature';
  if (token === '\u538b\u529b') return 'stress';
  if (token === '\u8840\u538b') return 'blood_pressure';
  if (token === '\u8840\u7cd6') return 'blood_sugar';
  const normalized = normalizeExpectedMetricName(token);
  return RW_EXPECTED_REALTIME_KEYS[normalized] ? normalized : token;
};

const getPageMetricName = (event) => {
  const details = getObjectDetails(event.details);
  const candidates = [
    details.target,
    details.name,
    details.metric,
    details.type,
    details.label,
    details.parsed?.target,
    details.parsed?.name,
    details.parsed?.metric,
    details.parsed?.data?.name
  ];
  for (const candidate of candidates) {
    const name = normalizePageMetricName(candidate);
    if (name) return name;
  }
  const expectedKey = Number(firstDefined(details.expectedKey, details.expectedResultKey, details.parsed?.expectedKey));
  const keyMatch = Object.entries(RW_EXPECTED_REALTIME_KEYS).find(([, key]) => key === expectedKey);
  return keyMatch?.[0] || '(unknown)';
};

const formatPageBloodPressureValue = (value) => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const values = typeof value[0] === 'number' && (value[0] === 0x11 || value[0] === 0x31) ? value.slice(1) : value;
    if (values[0] !== undefined || values[1] !== undefined) return `${values[0] ?? '-'}/${values[1] ?? '-'}`;
    return undefined;
  }
  if (typeof value === 'string') {
    const matched = value.match(/(\d{2,3})\D+(\d{2,3})/);
    return matched ? `${matched[1]}/${matched[2]}` : value;
  }
  if (typeof value === 'object') {
    const systolic = getFirstMetricFieldValue([value], BLOOD_PRESSURE_HIGH_KEYS);
    const diastolic = getFirstMetricFieldValue([value], BLOOD_PRESSURE_LOW_KEYS);
    if (systolic !== undefined || diastolic !== undefined) return `${systolic ?? '-'}/${diastolic ?? '-'}`;
  }
  return value;
};

const getPageMetricValue = (details, name = '') => {
  const sources = [details, details.metrics, details.parsed, details.parsed?.metrics, details.parsed?.data, details.data];
  const genericValue = getFirstMetricFieldValue(sources, ['value']);
  if (genericValue !== undefined) return name === 'blood_pressure' ? formatPageBloodPressureValue(genericValue) : genericValue;

  const keys = REALTIME_METRIC_VALUE_KEYS[name] || Object.values(REALTIME_METRIC_VALUE_KEYS).flat();
  const value = getFirstMetricFieldValue(sources, keys);
  if (value !== undefined) return name === 'blood_pressure' ? formatPageBloodPressureValue(value) : value;

  if (name === 'blood_pressure') {
    const systolic = getFirstMetricFieldValue(sources, BLOOD_PRESSURE_HIGH_KEYS);
    const diastolic = getFirstMetricFieldValue(sources, BLOOD_PRESSURE_LOW_KEYS);
    if (systolic !== undefined || diastolic !== undefined) return `${systolic ?? '-'}/${diastolic ?? '-'}`;
  }

  return undefined;
};

const getPageMetricExpectedKey = (details) => {
  const key = Number(firstDefined(details.expectedKey, details.expectedResultKey, details.parsed?.expectedKey));
  return Number.isFinite(key) ? toKeyHex(key) : '';
};

const toOptionalCount = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const buildPageMetricFlows = (events) => {
  const flows = new Map();
  const ensure = (event) => {
    const name = getPageMetricName(event);
    const source = event.source || 'RW PAGE';
    const flowKey = `${source}:${name}`;
    if (!flows.has(flowKey)) {
      flows.set(flowKey, {
        name,
        source,
        firstLine: event.line,
        lastLine: event.line,
        lastTime: event.time,
        starts: 0,
        controlEnabled: 0,
        pollReads: 0,
        waitHits: 0,
        directHits: 0,
        diagnosticLogHits: 0,
        directStoreWrites: 0,
        directStoreFailures: 0,
        waitTimeouts: 0,
        failed: 0,
        disconnected: 0,
        skipDisable: 0,
        ackSeen: 0,
        expectedKeys: new Set(),
        latestValue: null,
        latestError: '',
        latestStoreCounts: null,
        skipReasons: new Set(),
        steps: []
      });
    }
    const flow = flows.get(flowKey);
    flow.lastLine = event.line;
    flow.lastTime = event.time;
    flow.steps.push(`L${event.line}:${event.event}`);
    return flow;
  };

  for (const event of events) {
    const isSingleMetricEvent = event.event.startsWith('single-metric-');
    const isManualMetricEvent = RW_MINE_METRIC_EVENTS.has(event.event);
    if (!isSingleMetricEvent && !isManualMetricEvent) continue;
    const details = getObjectDetails(event.details);
    const flow = ensure(event);
    const expectedKey = getPageMetricExpectedKey(details);
    if (expectedKey) flow.expectedKeys.add(expectedKey);

    if (event.event === 'single-metric-start') flow.starts += 1;
    else if (event.event === 'single-metric-control-enabled') flow.controlEnabled += 1;
    else if (event.event === 'single-metric-poll-read') flow.pollReads += 1;
    else if (event.event === 'single-metric-wait-hit') flow.waitHits += 1;
    else if (event.event === 'single-metric-direct-hit') flow.directHits += 1;
    else if (event.event === 'single-metric-diagnostic-log-hit') flow.diagnosticLogHits += 1;
    else if (event.event === 'single-metric-direct-store-write') flow.directStoreWrites += 1;
    else if (event.event === 'single-metric-direct-store-failed') flow.directStoreFailures += 1;
    else if (event.event === 'single-metric-wait-timeout') flow.waitTimeouts += 1;
    else if (event.event === 'single-metric-failed') flow.failed += 1;
    else if (event.event === 'single-metric-disconnected') flow.disconnected += 1;
    else if (event.event === 'single-metric-skip-disable') flow.skipDisable += 1;
    else if (event.event === 'manual-metric-start') flow.starts += 1;
    else if (event.event === 'manual-metric-result') flow.diagnosticLogHits += 1;
    else if (event.event === 'manual-metric-failed') flow.failed += 1;

    if (details.ack || details.latestAck || details.controlAckPreview) flow.ackSeen += 1;
    const value = getPageMetricValue(details, flow.name);
    if (value !== undefined && value !== null) flow.latestValue = value;
    const errorMessage = firstDefined(details.errorMessage, details.message, details.error?.message);
    if (errorMessage) flow.latestError = String(errorMessage);
    const storeCounts = {
      received: toOptionalCount(details.receivedCount),
      normalized: toOptionalCount(details.normalizedCount),
      ringReceived: toOptionalCount(details.ringReceivedCount),
      ringNormalized: toOptionalCount(details.ringNormalizedCount)
    };
    if (Object.values(storeCounts).some((value) => value !== null)) {
      flow.latestStoreCounts = storeCounts;
    }
    if (details.reason) flow.skipReasons.add(String(details.reason));
  }

  return [...flows.values()].sort((a, b) => a.firstLine - b.firstLine);
};

const getMaxCommandBurst = (events, windowMs = 30000) => {
  const sorted = events
    .filter((event) => Number.isFinite(event.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs || a.line - b.line);
  let left = 0;
  let max = 0;
  let maxWindow = [];
  for (let right = 0; right < sorted.length; right += 1) {
    while (sorted[right].timeMs - sorted[left].timeMs > windowMs) left += 1;
    const count = right - left + 1;
    if (count > max) {
      max = count;
      maxWindow = sorted.slice(left, right + 1);
    }
  }
  return { max, window: maxWindow };
};

const formatMetricSummary = (metricSummary) => {
  if (metricSummary.size === 0) return '  none';
  return [...metricSummary.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, values]) => {
      const renderedValues = values
        .slice(-8)
        .map((item) => `${item.value}@L${item.line}`)
        .join(', ');
      return `  ${name}: ${renderedValues}`;
    })
    .join('\n');
};

const formatMetricKeyChecks = (metricKeyChecks) => {
  if (metricKeyChecks.rows.length === 0) return '  none';
  return metricKeyChecks.rows
    .map((row) => {
      const hitSamples = row.hitSamples.map((item) => `${item.value}@L${item.line}`).join(', ') || '-';
      const badSamples =
        row.badSamples
          .map((item) => `${item.keyHex}${item.key === RW_HISTORY_KEYS[row.name] ? '/history' : ''}:${item.value}@L${item.line}`)
          .join(', ') || '-';
      const status = row.badCount > 0 ? 'MISMATCH' : row.hitCount > 0 ? 'OK' : 'MISSING';
      return `  ${row.name}: ${status} expected=${row.expectedKeyHex} requested=${row.requested ? 'yes' : 'no'} hits=${row.hitCount} bad=${row.badCount} hitSamples=${hitSamples} badSamples=${badSamples}`;
    })
    .join('\n');
};

const formatMetricMismatches = (mismatches) => {
  if (mismatches.length === 0) return '  none';
  return mismatches
    .slice(-30)
    .map(
      (item) =>
        `  L${item.line} ${item.name} got=${item.keyHex}${item.isHistoryKey ? ' (history-key)' : ''} expected=${item.expectedKeyHex} value=${item.value} type=${item.type}`
    )
    .join('\n');
};

const formatRealtimeAckOnly = (rows) => {
  if (rows.length === 0) return '  none';
  return rows
    .map((row) => {
      const samples = row.samples
        .map((item) => `${item.name || '(unknown)'} ${item.keyHex || ''}@L${item.line}`)
        .join(', ');
      return `  ${row.name}: ACK_ONLY expectedResultKey=${row.expectedKeyHex} ackSamples=${samples}`;
    })
    .join('\n');
};

const formatPageEvents = (events) => {
  if (events.length === 0) return '  none';
  return events
    .slice(-30)
    .map((event) => {
      const details =
        typeof event.details === 'string'
          ? event.details
          : JSON.stringify({
              target: event.details?.target,
              metric: event.details?.metric,
              label: event.details?.label,
              buildTag: event.details?.buildTag,
              expectedKey: event.details?.expectedKey,
              value: event.details?.value,
              elapsedMs: event.details?.elapsedMs,
              parsed: event.details?.parsed
            });
      return `  L${event.line} ${event.time} [${event.source || 'RW PAGE'}] ${event.event} ${details}`;
    })
    .join('\n');
};

const getPageMetricFlowStatus = (flow) => {
  if (flow.waitHits > 0 || flow.directHits > 0 || flow.diagnosticLogHits > 0) return 'hit';
  if (flow.waitTimeouts > 0) return 'timeout';
  if (flow.failed > 0) return 'failed';
  if (flow.disconnected > 0) return 'disconnected';
  if (flow.controlEnabled > 0 || flow.pollReads > 0) return 'waiting-result';
  if (flow.starts > 0) return 'started';
  return 'unknown';
};

const getExpectedMetricChecks = (result, metricNames, { hasBuildTag, hasStaleBuildTag }) => {
  const rowsByName = new Map(result.metricKeyChecks.rows.map((row) => [row.name, row]));
  const ackOnlyByName = new Map(result.realtimeAckOnly.map((row) => [row.name, row]));
  return metricNames.map((name) => {
    const row = rowsByName.get(name) || {
      name,
      requested: false,
      expectedKey: RW_EXPECTED_REALTIME_KEYS[name],
      expectedKeyHex: toKeyHex(RW_EXPECTED_REALTIME_KEYS[name]),
      hitCount: 0,
      badCount: 0,
      hitSamples: [],
      badSamples: []
    };
    const flows = result.pageMetricFlows.filter((flow) => flow.name === name);
    const hitFlow = [...flows].reverse().find((flow) => getPageMetricFlowStatus(flow) === 'hit');
    const latestFlow = flows[flows.length - 1] || null;
    const flow = hitFlow || latestFlow;
    const flowStatus = flow ? getPageMetricFlowStatus(flow) : 'missing';
    const value = firstDefined(flow?.latestValue, row.hitSamples?.[row.hitSamples.length - 1]?.value);
    const ackOnly = ackOnlyByName.get(name) || null;

    const problems = [];
    if (!hasBuildTag) problems.push('missing-build-tag');
    if (hasStaleBuildTag) problems.push('stale-build-tag');
    if (!flow || flowStatus !== 'hit') problems.push(`page-${flowStatus}`);
    if (row.hitCount <= 0) problems.push('missing-realtime-key-hit');
    if (row.badCount > 0) problems.push('historical-or-wrong-key-mixed');
    if (value === undefined || value === null || value === '') problems.push('missing-value');
    if (ackOnly) problems.push('control-ack-without-result');

    return {
      name,
      ok: problems.length === 0,
      status: problems.length === 0 ? 'PASS' : 'FAIL',
      expectedKeyHex: row.expectedKeyHex,
      flowStatus,
      value,
      hitCount: row.hitCount,
      badCount: row.badCount,
      line: flow?.lastLine || row.hitSamples?.[row.hitSamples.length - 1]?.line || row.badSamples?.[row.badSamples.length - 1]?.line || '',
      source: flow?.source || '',
      problems,
      hitSamples: row.hitSamples,
      badSamples: row.badSamples,
      ackOnly
    };
  });
};

const formatExpectedMetricChecks = (checks) => {
  if (checks.length === 0) return '  none';
  return checks
    .map((check) => {
      const hitSamples = check.hitSamples.map((item) => `${item.value}@L${item.line}`).join(',') || '-';
      const badSamples = check.badSamples.map((item) => `${item.keyHex}:${item.value}@L${item.line}`).join(',') || '-';
      const problems = check.problems.length > 0 ? check.problems.join(',') : '-';
      const value = check.value !== undefined && check.value !== null ? check.value : '-';
      const line = check.line ? ` line=L${check.line}` : '';
      return `  ${check.name}: ${check.status} expected=${check.expectedKeyHex} page=${check.flowStatus} value=${value} hits=${check.hitCount} bad=${check.badCount}${line} problems=${problems} hitSamples=${hitSamples} badSamples=${badSamples}`;
    })
    .join('\n');
};

const formatPageMetricFlows = (flows) => {
  if (flows.length === 0) return '  none';
  return flows
    .map((flow) => {
      const status = getPageMetricFlowStatus(flow);
      const expectedKeys = [...flow.expectedKeys].join(',') || toKeyHex(RW_EXPECTED_REALTIME_KEYS[flow.name]) || '-';
      const value = flow.latestValue !== null && flow.latestValue !== undefined ? flow.latestValue : '-';
      const skipReasons = [...flow.skipReasons].join(',') || '-';
      const recentSteps = flow.steps.slice(-8).join(' -> ');
      const error = flow.latestError ? ` error=${JSON.stringify(flow.latestError)}` : '';
      const counts = flow.latestStoreCounts || {};
      const storeLine =
        counts.received !== undefined ||
        counts.normalized !== undefined ||
        counts.ringReceived !== undefined ||
        counts.ringNormalized !== undefined
          ? `    store=user(received=${counts.received ?? '-'},normalized=${counts.normalized ?? '-'}) ring(received=${counts.ringReceived ?? '-'},normalized=${counts.ringNormalized ?? '-'})`
          : '    store=user(received=-,normalized=-) ring(received=-,normalized=-)';
      return [
        `  ${flow.source || 'RW PAGE'}/${flow.name}: status=${status} expected=${expectedKeys} value=${value}`,
        `    starts=${flow.starts} control=${flow.controlEnabled} polls=${flow.pollReads} waitHit=${flow.waitHits} directHit=${flow.directHits} diagnosticHit=${flow.diagnosticLogHits} directStore=${flow.directStoreWrites}/${flow.directStoreFailures} timeout=${flow.waitTimeouts} failed=${flow.failed} disconnected=${flow.disconnected} ack=${flow.ackSeen} skipDisable=${flow.skipDisable} skipReasons=${skipReasons}${error}`,
        storeLine,
        `    latest=L${flow.lastLine} ${flow.lastTime} steps=${recentSteps}`
      ].join('\n');
    })
    .join('\n');
};

const formatCompactObject = (value, limit = 220) => {
  try {
    const text = JSON.stringify(value);
    if (!text) return '-';
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  } catch {
    return String(value);
  }
};

const formatHistoryEvent = (event) => {
  const summary = event.summary || {};
  const parts = [`L${event.line}`, event.time, event.source || '', event.event];
  if (summary.status) parts.push(`status=${summary.status}`);
  if (summary.message) parts.push(`message=${JSON.stringify(String(summary.message))}`);
  if (summary.elapsedMs !== null && summary.elapsedMs !== undefined) parts.push(`elapsedMs=${summary.elapsedMs}`);
  if (summary.phase) parts.push(`phase=${summary.phase}`);
  if (summary.readAll !== undefined) parts.push(`readAll=${summary.readAll}`);
  if (summary.lastReadTimestamp !== undefined) parts.push(`lastReadTimestamp=${summary.lastReadTimestamp}`);
  if (summary.timeoutMs !== undefined) parts.push(`timeoutMs=${summary.timeoutMs}`);
  if (summary.waitMs !== undefined) parts.push(`waitMs=${summary.waitMs}`);
  if (summary.delayMs !== undefined) parts.push(`delayMs=${summary.delayMs}`);
  if (summary.responseTimeoutMs !== undefined) parts.push(`responseTimeoutMs=${summary.responseTimeoutMs}`);
  if (summary.responseWaitMs !== undefined) parts.push(`responseWaitMs=${summary.responseWaitMs}`);
  if (summary.attempt) parts.push(`attempt=${summary.attempt}`);
  if (summary.flag !== null && summary.flag !== undefined) parts.push(`flag=${summary.flag}`);
  if (summary.previousFlag !== null && summary.previousFlag !== undefined) parts.push(`previousFlag=${summary.previousFlag}`);
  if (summary.responseFlag !== null && summary.responseFlag !== undefined) parts.push(`responseFlag=${summary.responseFlag}`);
  if (summary.retryDelayMs !== undefined) parts.push(`retryDelayMs=${summary.retryDelayMs}`);
  if (summary.commandIntervalMs !== undefined) parts.push(`commandIntervalMs=${summary.commandIntervalMs}`);
  if (summary.queueDepth !== null && summary.queueDepth !== undefined) parts.push(`queueDepth=${summary.queueDepth}`);
  if (summary.queuedBehind !== null && summary.queuedBehind !== undefined) parts.push(`queuedBehind=${summary.queuedBehind}`);
  if (summary.command) parts.push(`command=${summary.command}`);
  if (summary.commands?.length) parts.push(`commands=${summary.commands.join(',')}`);
  if (summary.key !== undefined) parts.push(`key=${summary.key}`);
  if (summary.label) parts.push(`label=${summary.label}`);
  if (summary.page) parts.push(`page=${summary.page}`);
  if (summary.endpoint) parts.push(`endpoint=${summary.endpoint}`);
  if (summary.waitFor) parts.push(`waitFor=${summary.waitFor}`);
  if (summary.cachedResponseType) parts.push(`cachedResponseType=${summary.cachedResponseType}`);
  if (summary.unexpectedResponseCount !== null && summary.unexpectedResponseCount !== undefined) parts.push(`unexpected=${summary.unexpectedResponseCount}`);
  if (summary.diagnosticReportCount !== null && summary.diagnosticReportCount !== undefined) parts.push(`reportEvents=${summary.diagnosticReportCount}`);
  if (summary.rawRecordCount !== null && summary.rawRecordCount !== undefined) parts.push(`rawRecords=${summary.rawRecordCount}`);
  if (summary.submitRecordCount !== null && summary.submitRecordCount !== undefined) parts.push(`submitRecords=${summary.submitRecordCount}`);
  if (summary.recordCount !== null && summary.recordCount !== undefined) parts.push(`records=${summary.recordCount}`);
  if (summary.itemCount !== null && summary.itemCount !== undefined) parts.push(`items=${summary.itemCount}`);
  if (summary.maxTimestamp !== null && summary.maxTimestamp !== undefined) parts.push(`maxTimestamp=${summary.maxTimestamp}`);
  if (summary.totalFileCount !== null && summary.totalFileCount !== undefined) parts.push(`totalFiles=${summary.totalFileCount}`);
  if (summary.selectedFileCount !== null && summary.selectedFileCount !== undefined) parts.push(`selectedFiles=${summary.selectedFileCount}`);
  if (summary.filteredFileCount !== null && summary.filteredFileCount !== undefined) parts.push(`filteredFiles=${summary.filteredFileCount}`);
  if (summary.uploadEventCount !== null && summary.uploadEventCount !== undefined) parts.push(`uploadEvents=${summary.uploadEventCount}`);
  if (summary.finished !== undefined) parts.push(`finished=${summary.finished}`);
  if (summary.eventTypes?.length) parts.push(`events=${summary.eventTypes.join(',')}`);
  if (summary.sourceType) parts.push(`sourceType=${summary.sourceType}`);
  if (summary.responseType) parts.push(`responseType=${summary.responseType}`);
  if (summary.packetShape) parts.push(`packetShape=${summary.packetShape}`);
  if (summary.dataType) parts.push(`dataType=${summary.dataType}`);
  if (summary.dataTypes?.length) parts.push(`dataTypes=${summary.dataTypes.join(',')}`);
  if (summary.rawMetrics) parts.push(`rawMetrics=${formatCompactObject(summary.rawMetrics)}`);
  if (summary.uploadRawMetrics) parts.push(`uploadRawMetrics=${formatCompactObject(summary.uploadRawMetrics)}`);
  if (summary.submitMetrics) parts.push(`submitMetrics=${formatCompactObject(summary.submitMetrics)}`);
  if (summary.rawSample) parts.push(`rawSample=${formatCompactObject(summary.rawSample)}`);
  if (summary.submitSample) parts.push(`submitSample=${formatCompactObject(summary.submitSample)}`);
  if (summary.queryEndpoint) parts.push(`queryEndpoint=${summary.queryEndpoint}`);
  if (summary.queryItems !== null && summary.queryItems !== undefined) parts.push(`queryItems=${summary.queryItems}`);
  if (summary.queryHints) parts.push(`queryHints=${formatCompactObject(summary.queryHints)}`);
  if (summary.queryPayloadKeys?.length) parts.push(`queryPayloadKeys=${summary.queryPayloadKeys.join(',')}`);
  if (summary.qkeerCommand !== undefined) parts.push(`qkeerCommand=${summary.qkeerCommand}`);
  if (summary.uploaded !== undefined) parts.push(`uploaded=${summary.uploaded}`);
  if (summary.deleted !== undefined) parts.push(`deleted=${summary.deleted}`);
  if (summary.diagnosticReportCounts) {
    const counts = Object.entries(summary.diagnosticReportCounts)
      .filter(([, value]) => Number(value) > 0)
      .map(([key, value]) => `${key}:${value}`)
      .slice(0, 12)
      .join(',');
    if (counts) parts.push(`counts=${counts}`);
  }
  return `  ${parts.filter(Boolean).join(' ')}`;
};

const getHistorySyncSummary = (events) => {
  const starts = events.filter((event) => event.event === 'history-sync-start');
  const results = events.filter((event) => event.event === 'history-sync-result');
  const failures = events.filter((event) => event.event === 'history-sync-failed');
  const manualSyncStarts = events.filter((event) => event.event === 'manual-history-sync-start');
  const manualSyncResults = events.filter((event) => event.event === 'manual-history-sync-result');
  const manualSyncFailures = events.filter((event) => event.event === 'manual-history-sync-failed');
  const queueEnqueues = events.filter((event) => event.event === 'compat-history-queue-enqueue');
  const queueStarts = events.filter((event) => event.event === 'compat-history-queue-start');
  const queueResults = events.filter((event) => event.event === 'compat-history-queue-result');
  const queueFailures = events.filter((event) => event.event === 'compat-history-queue-failed');
  const historyInitialWaits = events.filter((event) => event.event === 'history-initial-wait-start');
  const fileListFallbacks = events.filter((event) => event.event === 'history-initial-file-list-fallback');
  const fallbackWaitStarts = events.filter((event) => event.event === 'history-fallback-wait-start');
  const nativeListFallbacks = events.filter((event) => event.event === 'history-native-list-fallback');
  const nativeListWaitResponses = events.filter((event) => event.event === 'history-native-list-wait-response');
  const nativeListWaitTimeouts = events.filter((event) => event.event === 'history-native-list-wait-timeout');
  const lastDataWaitResponses = events.filter((event) => event.event === 'history-last-data-wait-response');
  const lastDataWaitTimeouts = events.filter((event) => event.event === 'history-last-data-wait-timeout');
  const finalReadLocalDataFallbacks = events.filter((event) => event.event === 'history-final-read-local-data-fallback');
  const finalReadLocalDataResponses = events.filter((event) => event.event === 'history-final-read-local-data-response');
  const finalReadLocalDataTimeouts = events.filter((event) => event.event === 'history-final-read-local-data-timeout');
  const abKeyFallbacks = events.filter((event) => event.event === 'history-ab-key-fallback');
  const abKeyResponses = events.filter((event) => event.event === 'history-ab-key-response');
  const abKeyTimeouts = events.filter((event) => event.event === 'history-ab-key-timeout');
  const abKeyRetryContinues = events.filter((event) => event.event === 'history-ab-key-retry-continue');
  const abKeyResults = events.filter((event) => event.event === 'history-ab-key-result');
  const abHealthReceived = events.filter((event) => event.event === 'ab-health-history-received');
  const lastDataOnlyStarts = events.filter((event) => event.event === 'history-last-data-only-start');
  const lastDataOnlyResponses = events.filter((event) => event.event === 'history-last-data-only-response');
  const lastDataOnlyTimeouts = events.filter((event) => event.event === 'history-last-data-only-timeout');
  const fileListReceived = events.filter((event) => event.event === 'file-list-received');
  const nativeListReceived = events.filter((event) => event.event === 'native-list-received');
  const historyInitialTimeouts = events.filter((event) => event.event === 'history-initial-timeout');
  const unexpectedResponses = events.filter((event) => event.event === 'history-unexpected-response');
  const legacyLocalDataReceived = events.filter((event) => event.event === 'legacy-local-data-received');
  const uploadStarts = events.filter((event) => event.event === 'upload-request-start');
  const uploadResults = events.filter((event) => event.event === 'upload-request-result');
  const pageSyncStarts = events.filter((event) => event.event === 'history-page-sync-start');
  const pageSyncResults = events.filter((event) => event.event === 'history-page-sync-result');
  const pageSyncFailures = events.filter((event) => event.event === 'history-page-sync-failed');
  const pageUploadResults = events.filter((event) => event.event === 'history-page-upload-result');
  const pageUploadFailures = events.filter((event) => event.event === 'history-page-upload-failed');
  const pageQueryResults = events.filter((event) => event.event === 'history-page-query-result');
  const pageQueryFailures = events.filter((event) => event.event === 'history-page-query-failed');
  const compactReports = events.filter((event) => event.event === 'diagnostic-history-report');
  const latest = events[events.length - 1] || null;
  const latestResult = results[results.length - 1] || null;
  const latestFailure = failures[failures.length - 1] || null;
  const latestManualSyncResult = manualSyncResults[manualSyncResults.length - 1] || null;
  const latestManualSyncFailure = manualSyncFailures[manualSyncFailures.length - 1] || null;
  const latestCompactReport = compactReports[compactReports.length - 1] || null;
  const queueDepthValues = [...queueEnqueues, ...queueStarts, ...queueResults, ...queueFailures]
    .map((event) => toCount(event.summary?.queueDepth))
    .filter((value) => value !== null);
  const queuedBehindValues = [...queueEnqueues, ...queueStarts, ...queueResults, ...queueFailures]
    .map((event) => toCount(event.summary?.queuedBehind))
    .filter((value) => value !== null);
  const maxQueueDepth = queueDepthValues.length > 0 ? Math.max(...queueDepthValues) : 0;
  const maxQueuedBehind = queuedBehindValues.length > 0 ? Math.max(...queuedBehindValues) : 0;

  let status = 'not found';
  if (latest?.event === 'compat-history-queue-failed') status = 'queue-failed';
  else if (latest?.event === 'compat-history-queue-enqueue') status = 'queued';
  else if (latest?.event === 'compat-history-queue-start') status = 'queue-running';
  else if (latest?.event === 'manual-history-sync-failed') status = 'manual-sync-failed';
  else if (latest?.event === 'history-sync-failed') status = 'failed';
  else if (latest?.event === 'history-last-data-only-timeout') status = 'last-data-only-timeout';
  else if (latest?.event === 'history-page-query-failed') status = 'page-query-failed';
  else if (latest?.event === 'history-page-query-result') status = `page-query-result items=${latest.summary.itemCount ?? '-'}`;
  else if (latest?.event === 'diagnostic-history-report') status = `diagnostic-report records=${latest.summary.recordCount ?? '-'} uploaded=${latest.summary.uploaded ?? '-'}`;
  else if (latest?.event === 'history-ab-key-result') status = 'ab-key-result';
  else if (latest?.event === 'history-ab-key-timeout') status = 'ab-key-timeout';
  else if (latest?.event === 'history-final-read-local-data-timeout') status = 'final-local-data-timeout';
  else if (latest?.event === 'history-initial-timeout') status = 'history-initial-timeout';
  else if (latestResult) status = `result records=${latestResult.summary.recordCount ?? '-'}`;
  else if (latestManualSyncResult) status = `manual-result records=${latestManualSyncResult.summary.recordCount ?? '-'}`;
  else if (abKeyResults.length > 0) status = 'ab-key-result';
  else if (abKeyResponses.length > 0) status = 'ab-key-response';
  else if (finalReadLocalDataResponses.length > 0) status = 'final-local-data-response';
  else if (legacyLocalDataReceived.length > 0) status = 'legacy-local-data-received';
  else if (nativeListReceived.length > 0) status = 'native-list-received';
  else if (lastDataOnlyStarts.length > 0) status = 'waiting-last-data-response';
  else if (fileListReceived.length > 0 && uploadResults.length === 0) status = 'file-list-received-no-upload-result';
  else if (historyInitialWaits.length > 0 && fileListReceived.length === 0 && nativeListReceived.length === 0) status = 'waiting-history-response';
  else if (starts.length > 0) status = 'start-only';

  return {
    starts,
    results,
    failures,
    manualSyncStarts,
    manualSyncResults,
    manualSyncFailures,
    queueEnqueues,
    queueStarts,
    queueResults,
    queueFailures,
    maxQueueDepth,
    maxQueuedBehind,
    historyInitialWaits,
    fileListFallbacks,
    fallbackWaitStarts,
    nativeListFallbacks,
    nativeListWaitResponses,
    nativeListWaitTimeouts,
    lastDataWaitResponses,
    lastDataWaitTimeouts,
    finalReadLocalDataFallbacks,
    finalReadLocalDataResponses,
    finalReadLocalDataTimeouts,
    abKeyFallbacks,
    abKeyResponses,
    abKeyTimeouts,
    abKeyRetryContinues,
    abKeyResults,
    abHealthReceived,
    lastDataOnlyStarts,
    lastDataOnlyResponses,
    lastDataOnlyTimeouts,
    fileListReceived,
    nativeListReceived,
    historyInitialTimeouts,
    unexpectedResponses,
    legacyLocalDataReceived,
    uploadStarts,
    uploadResults,
    pageSyncStarts,
    pageSyncResults,
    pageSyncFailures,
    pageUploadResults,
    pageUploadFailures,
    pageQueryResults,
    pageQueryFailures,
    compactReports,
    latest,
    latestResult,
    latestFailure,
    latestManualSyncResult,
    latestManualSyncFailure,
    latestCompactReport,
    status
  };
};

const formatHistorySync = (events) => {
  if (events.length === 0) return '  none';
  const summary = getHistorySyncSummary(events);
  const lines = [
    `  status: ${summary.status}`,
    `  starts=${summary.starts.length} results=${summary.results.length} failures=${summary.failures.length}`,
    `  manual starts=${summary.manualSyncStarts.length} results=${summary.manualSyncResults.length} failures=${summary.manualSyncFailures.length}`,
    `  page sync starts=${summary.pageSyncStarts.length} results=${summary.pageSyncResults.length} failures=${summary.pageSyncFailures.length} uploads=${summary.pageUploadResults.length} uploadFailures=${summary.pageUploadFailures.length}`,
    `  compact reports=${summary.compactReports.length}`,
    `  queue enqueues=${summary.queueEnqueues.length} starts=${summary.queueStarts.length} results=${summary.queueResults.length} failures=${summary.queueFailures.length} maxQueueDepth=${summary.maxQueueDepth} maxQueuedBehind=${summary.maxQueuedBehind}`,
    `  history initial waits=${summary.historyInitialWaits.length} fallbackWaits=${summary.fallbackWaitStarts.length} localData=${summary.legacyLocalDataReceived.length} nativeListFallbacks=${summary.nativeListFallbacks.length} nativeListResponses=${summary.nativeListWaitResponses.length} nativeListTimeouts=${summary.nativeListWaitTimeouts.length} nativeListReceived=${summary.nativeListReceived.length} lastDataResponses=${summary.lastDataWaitResponses.length} lastDataTimeouts=${summary.lastDataWaitTimeouts.length} finalFallbacks=${summary.finalReadLocalDataFallbacks.length} finalResponses=${summary.finalReadLocalDataResponses.length} finalTimeouts=${summary.finalReadLocalDataTimeouts.length} abKeyFallbacks=${summary.abKeyFallbacks.length} abKeyResponses=${summary.abKeyResponses.length} abKeyTimeouts=${summary.abKeyTimeouts.length} abKeyRetryContinues=${summary.abKeyRetryContinues.length} abKeyResults=${summary.abKeyResults.length} abHealthReceived=${summary.abHealthReceived.length} fileListFallbacks=${summary.fileListFallbacks.length} fileListReceived=${summary.fileListReceived.length} unexpected=${summary.unexpectedResponses.length} timeouts=${summary.historyInitialTimeouts.length}`,
    `  uploads starts=${summary.uploadStarts.length} results=${summary.uploadResults.length}`,
    `  page queries results=${summary.pageQueryResults.length} failures=${summary.pageQueryFailures.length}`
  ];
  if (summary.latestResult) lines.push(`  latest-result: ${formatHistoryEvent(summary.latestResult).trim()}`);
  if (summary.latestFailure) lines.push(`  latest-failure: ${formatHistoryEvent(summary.latestFailure).trim()}`);
  if (summary.latestManualSyncResult) lines.push(`  latest-manual-result: ${formatHistoryEvent(summary.latestManualSyncResult).trim()}`);
  if (summary.latestManualSyncFailure) lines.push(`  latest-manual-failure: ${formatHistoryEvent(summary.latestManualSyncFailure).trim()}`);
  if (summary.latestCompactReport) lines.push(`  latest-compact-report: ${formatHistoryEvent(summary.latestCompactReport).trim()}`);
  lines.push('  recent-events:');
  lines.push(...events.slice(-20).map(formatHistoryEvent));
  return lines.join('\n');
};

const getLatestHistorySummaryValue = (events, field) => {
  for (const event of [...events].reverse()) {
    const value = event.summary?.[field];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const getLatestHistoryEvent = (events, name) => [...events].reverse().find((event) => event.event === name) || null;

const formatHistoryWaitWindows = (events) => {
  if (events.length === 0) return '  none';
  const summary = getHistorySyncSummary(events);
  const preflightStarts = events.filter((event) => event.event === 'history-preflight-start');
  const preflightResponses = events.filter((event) => event.event === 'history-preflight-response');
  const preflightTimeouts = events.filter((event) => event.event === 'history-preflight-timeout');
  const latestNativeListFallback = getLatestHistoryEvent(events, 'history-native-list-fallback');
  const latestNativeListWait =
    getLatestHistoryEvent(events, 'history-native-list-wait-response') ||
    getLatestHistoryEvent(events, 'history-native-list-wait-timeout');
  const latestLastDataWait =
    getLatestHistoryEvent(events, 'history-last-data-wait-response') ||
    getLatestHistoryEvent(events, 'history-last-data-wait-timeout');
  const latestFinalFallback = getLatestHistoryEvent(events, 'history-final-read-local-data-fallback');
  const latestFinalRead =
    getLatestHistoryEvent(events, 'history-final-read-local-data-response') ||
    getLatestHistoryEvent(events, 'history-final-read-local-data-timeout') ||
    latestFinalFallback;
  const latestAbKey =
    getLatestHistoryEvent(events, 'history-ab-key-result') ||
    getLatestHistoryEvent(events, 'history-ab-key-response') ||
    getLatestHistoryEvent(events, 'history-ab-key-timeout') ||
    getLatestHistoryEvent(events, 'history-ab-key-retry-continue') ||
    getLatestHistoryEvent(events, 'history-ab-key-fallback');
  const latestLastDataOnly =
    getLatestHistoryEvent(events, 'history-last-data-only-response') ||
    getLatestHistoryEvent(events, 'history-last-data-only-timeout') ||
    getLatestHistoryEvent(events, 'history-last-data-only-start');
  const preflightDelayMs = getLatestHistorySummaryValue(preflightStarts, 'delayMs') ?? '-';
  const preflightResponseTimeoutMs = getLatestHistorySummaryValue(preflightStarts, 'responseTimeoutMs') ?? '-';
  const nativeCommands = latestNativeListFallback?.summary?.commands?.join(',') || '-';
  const nativeIntervalMs = latestNativeListFallback?.summary?.commandIntervalMs ?? '-';
  const nativeWaitMs = latestNativeListWait?.summary?.waitMs ?? '-';
  const nativeWaitStatus = latestNativeListWait?.event?.endsWith('response') ? 'response' : latestNativeListWait?.event?.endsWith('timeout') ? 'timeout' : '-';
  const lastDataWaitMs = latestLastDataWait?.summary?.waitMs ?? '-';
  const lastDataWaitStatus = latestLastDataWait?.event?.endsWith('response') ? 'response' : latestLastDataWait?.event?.endsWith('timeout') ? 'timeout' : '-';
  const finalCached = latestFinalFallback?.summary?.cachedResponseType || '-';
  const finalReadWaitMs = latestFinalRead?.summary?.waitMs ?? '-';
  const finalReadStatus =
    latestFinalRead?.event === 'history-final-read-local-data-response'
      ? 'response'
      : latestFinalRead?.event === 'history-final-read-local-data-timeout'
        ? 'timeout'
        : latestFinalRead?.event === 'history-final-read-local-data-fallback'
          ? 'fallback'
          : '-';
  const abKeyStatus =
    latestAbKey?.event === 'history-ab-key-result'
      ? 'result'
      : latestAbKey?.event === 'history-ab-key-response'
        ? 'response'
        : latestAbKey?.event === 'history-ab-key-timeout'
          ? 'timeout'
          : latestAbKey?.event === 'history-ab-key-retry-continue'
            ? 'retry-continue'
            : latestAbKey?.event === 'history-ab-key-fallback'
              ? 'fallback'
              : '-';
  const lastDataOnlyStatus =
    latestLastDataOnly?.event === 'history-last-data-only-response'
      ? 'response'
      : latestLastDataOnly?.event === 'history-last-data-only-timeout'
        ? 'timeout'
        : latestLastDataOnly?.event === 'history-last-data-only-start'
          ? 'start'
          : '-';

  return [
    `  preflight: start=${preflightStarts.length} response=${preflightResponses.length} timeout=${preflightTimeouts.length} delayMs=${preflightDelayMs} responseTimeoutMs=${preflightResponseTimeoutMs}`,
    `  native-list: fallback=${summary.nativeListFallbacks.length} response=${summary.nativeListWaitResponses.length} timeout=${summary.nativeListWaitTimeouts.length} latestWaitMs=${nativeWaitMs} latest=${nativeWaitStatus} commands=${nativeCommands} intervalMs=${nativeIntervalMs}`,
    `  last-data: fallback=${events.filter((event) => event.event === 'history-native-last-data-fallback').length} response=${summary.lastDataWaitResponses.length} timeout=${summary.lastDataWaitTimeouts.length} latestWaitMs=${lastDataWaitMs} latest=${lastDataWaitStatus}`,
    `  final-local-data: fallback=${summary.finalReadLocalDataFallbacks.length} response=${summary.finalReadLocalDataResponses.length} timeout=${summary.finalReadLocalDataTimeouts.length} latestWaitMs=${finalReadWaitMs} latest=${finalReadStatus} cachedResponseType=${finalCached}`,
    `  ab-health-key: fallback=${summary.abKeyFallbacks.length} response=${summary.abKeyResponses.length} timeout=${summary.abKeyTimeouts.length} retryContinue=${summary.abKeyRetryContinues.length} result=${summary.abKeyResults.length} received=${summary.abHealthReceived.length} latest=${abKeyStatus}`,
    `  last-data-only: start=${summary.lastDataOnlyStarts.length} response=${summary.lastDataOnlyResponses.length} timeout=${summary.lastDataOnlyTimeouts.length} latest=${lastDataOnlyStatus}`,
    `  unexpected-history-responses: ${summary.unexpectedResponses.length}`
  ].join('\n');
};

const normalizeHistoryTypeKey = (value) =>
  String(value || '')
    .trim()
    .replace(/[-_\s]/g, '')
    .toLowerCase();

const getHistoryTypesFromSourceType = (value) => {
  const key = normalizeHistoryTypeKey(value);
  if (key === 'qkeerv2healthlist') return ['vital'];
  if (key === 'qkeerv2lastdata') return ['sleep', 'vital', 'activity', 'step'];
  if (key === 'qkeerv2steplist') return ['step', 'activity'];
  if (key === 'qkeerv2sleeplist') return ['sleep'];
  return [];
};

const RW_VITAL_HISTORY_TYPE_KEYS = new Set([
  'vital',
  'heartrate',
  'bloodoxygen',
  'hrv',
  'skintemperature',
  'temperature',
  'bloodsugar',
  'bloodpressure'
]);
const RW_SLEEP_HISTORY_TYPE_KEYS = new Set(['sleep', 'sleepdata']);

const historyEventHasDataType = (event, expectedType) => {
  const expectedKey = normalizeHistoryTypeKey(expectedType);
  const dataTypes = [
    ...(event.summary?.dataTypes || []),
    ...getHistoryTypesFromSourceType(event.summary?.sourceType)
  ];
  return dataTypes.some((type) => {
    const actualKey = normalizeHistoryTypeKey(type);
    if (actualKey === expectedKey) return true;
    if (RW_SLEEP_HISTORY_TYPE_KEYS.has(expectedKey) && RW_SLEEP_HISTORY_TYPE_KEYS.has(actualKey)) return true;
    if (expectedKey === 'vital' && RW_VITAL_HISTORY_TYPE_KEYS.has(actualKey)) return true;
    if (actualKey === 'vital' && RW_VITAL_HISTORY_TYPE_KEYS.has(expectedKey)) return true;
    if (expectedKey === 'activity' && actualKey === 'step') return true;
    if (expectedKey === 'step' && actualKey === 'activity') return true;
    return false;
  });
};

const getHistoryTypeEvents = (events, expectedType) => events.filter((event) => historyEventHasDataType(event, expectedType));

const getExpectedHistoryChecks = (result, historyTypes, { hasBuildTag, hasStaleBuildTag }) =>
  historyTypes.map((type) => {
    const events = getHistoryTypeEvents(result.historyEvents, type);
    const starts = events.filter((event) => event.event === 'history-sync-start');
    const pageSyncStarts = events.filter((event) => event.event === 'history-page-sync-start');
    const manualSyncStarts = events.filter((event) => event.event === 'manual-history-sync-start');
    const results = events.filter((event) => event.event === 'history-sync-result');
    const failures = events.filter((event) => event.event === 'history-sync-failed');
    const manualSyncResults = events.filter((event) => event.event === 'manual-history-sync-result');
    const manualSyncFailures = events.filter((event) => event.event === 'manual-history-sync-failed');
    const legacyLocalDataReceived = events.filter((event) => event.event === 'legacy-local-data-received');
    const nativeListReceived = events.filter((event) => event.event === 'native-list-received');
    const lastDataOnlyStarts = events.filter((event) => event.event === 'history-last-data-only-start');
    const lastDataOnlyTimeouts = events.filter((event) => event.event === 'history-last-data-only-timeout');
    const fileListReceived = events.filter((event) => event.event === 'file-list-received');
    const historyInitialTimeouts = events.filter((event) => event.event === 'history-initial-timeout');
    const uploadStarts = events.filter((event) => event.event === 'upload-request-start');
    const pageSyncResults = events.filter((event) => event.event === 'history-page-sync-result');
    const pageUploadResults = events.filter((event) => event.event === 'history-page-upload-result');
    const pageUploadFailures = events.filter((event) => event.event === 'history-page-upload-failed');
    const compactReports = events.filter((event) => event.event === 'diagnostic-history-report');
    const latestResult = results[results.length - 1] || null;
    const latestPageSyncResult = pageSyncResults[pageSyncResults.length - 1] || null;
    const latestPageUploadResult = pageUploadResults[pageUploadResults.length - 1] || null;
    const latestCompactReport = compactReports[compactReports.length - 1] || null;
    const latestManualSyncResult = manualSyncResults[manualSyncResults.length - 1] || null;
    const latestManualSyncFailure = manualSyncFailures[manualSyncFailures.length - 1] || null;
    const latestFailure = failures[failures.length - 1] || null;
    const latest = events[events.length - 1] || null;
    const recordCount = firstDefined(
      latestPageUploadResult?.summary?.recordCount,
      latestPageSyncResult?.summary?.recordCount,
      latestManualSyncResult?.summary?.recordCount,
      latestResult?.summary?.recordCount,
      latestCompactReport?.summary?.recordCount
    );
    const selectedFileCount = latestResult?.summary?.selectedFileCount;
    const totalFileCount = latestResult?.summary?.totalFileCount;
    const uploaded = firstDefined(latestPageUploadResult?.summary?.uploaded, latestManualSyncResult?.summary?.uploaded, latestResult?.summary?.uploaded, latestCompactReport?.summary?.uploaded);
    const rawRecordCount = firstDefined(
      latestPageUploadResult?.summary?.rawRecordCount,
      latestPageSyncResult?.summary?.recordCount,
      latestManualSyncResult?.summary?.rawRecordCount,
      latestManualSyncResult?.summary?.recordCount,
      latestResult?.summary?.recordCount,
      latestCompactReport?.summary?.rawRecordCount,
      latestCompactReport?.summary?.recordCount
    );
    const submitRecordCount = firstDefined(
      latestPageUploadResult?.summary?.submitRecordCount,
      latestPageUploadResult?.summary?.recordCount,
      latestManualSyncResult?.summary?.submitRecordCount,
      latestCompactReport?.summary?.submitRecordCount
    );
    const hasAuthoritativeHistoryResult =
      (recordCount || 0) > 0 &&
      uploaded !== false &&
      Boolean(latestPageUploadResult || latestPageSyncResult || latestManualSyncResult || latestResult || latestCompactReport);

    const problems = [];
    if (!hasBuildTag) problems.push('missing-build-tag');
    if (hasStaleBuildTag) problems.push('stale-build-tag');
    if (result.rwHistoryCommandEvents.length === 0 && !hasAuthoritativeHistoryResult) problems.push('missing-rw-history-command');
    if (events.length === 0) problems.push('missing-data-type');
    const hasAnyStart = starts.length > 0 || pageSyncStarts.length > 0 || manualSyncStarts.length > 0 || compactReports.length > 0;
    if (!hasAnyStart) problems.push('missing-start');
    if (failures.length > 0 || manualSyncFailures.length > 0) problems.push('history-failed');
    if (pageUploadFailures.length > 0) problems.push('page-upload-failed');
    if (historyInitialTimeouts.length > 0) problems.push('history-initial-timeout');
    if (lastDataOnlyTimeouts.length > 0) problems.push('last-data-only-timeout');
    if (
      starts.length > 0 &&
      legacyLocalDataReceived.length === 0 &&
      nativeListReceived.length === 0 &&
      fileListReceived.length === 0 &&
      lastDataOnlyTimeouts.length === 0
    ) problems.push('missing-history-response');
    if (fileListReceived.length > 0 && uploadStarts.length === 0 && results.length === 0) problems.push('missing-upload-request');
    if (results.length === 0 && pageSyncResults.length === 0 && pageUploadResults.length === 0 && manualSyncResults.length === 0 && compactReports.length === 0) problems.push('missing-result');
    if (latest?.event === 'history-sync-start') problems.push('start-only');
    if (latestResult && (recordCount == null || recordCount <= 0)) problems.push('missing-records');
    if (latestResult && selectedFileCount === 0 && (totalFileCount || 0) > 0) problems.push('files-filtered-out');
    if (latestResult && uploaded === false) problems.push('not-uploaded');
    if (latestPageUploadResult && uploaded === false) problems.push('not-uploaded');
    if (latestPageUploadResult && (submitRecordCount == null || submitRecordCount <= 0)) problems.push('missing-submit-records');
    if ((rawRecordCount || 0) > 0 && latestPageUploadResult && (submitRecordCount || 0) <= 0) problems.push('records-not-submittable');

    return {
      type,
      ok: problems.length === 0,
      status: problems.length === 0 ? 'PASS' : 'FAIL',
      starts: starts.length,
      pageSyncStarts: pageSyncStarts.length,
      manualSyncStarts: manualSyncStarts.length,
      results: results.length,
      pageSyncResults: pageSyncResults.length,
      pageUploadResults: pageUploadResults.length,
      compactReports: compactReports.length,
      manualSyncResults: manualSyncResults.length,
      pageUploadFailures: pageUploadFailures.length,
      manualSyncFailures: manualSyncFailures.length,
      failures: failures.length,
      legacyLocalDataReceived: legacyLocalDataReceived.length,
      nativeListReceived: nativeListReceived.length,
      lastDataOnlyStarts: lastDataOnlyStarts.length,
      lastDataOnlyTimeouts: lastDataOnlyTimeouts.length,
      fileListReceived: fileListReceived.length,
      historyInitialTimeouts: historyInitialTimeouts.length,
      uploadStarts: uploadStarts.length,
      recordCount,
      rawRecordCount,
      submitRecordCount,
      selectedFileCount,
      totalFileCount,
      uploaded,
      latestLine:
        latestPageUploadResult?.line ||
        latestPageSyncResult?.line ||
        latestManualSyncResult?.line ||
        latestManualSyncFailure?.line ||
        latestResult?.line ||
        latestFailure?.line ||
        latestCompactReport?.line ||
        latest?.line ||
        '',
      problems
    };
  });

const formatExpectedHistoryChecks = (checks) => {
  if (checks.length === 0) return '  none';
  return checks
    .map((check) => {
      const line = check.latestLine ? ` line=L${check.latestLine}` : '';
      const records = check.recordCount == null ? '-' : check.recordCount;
      const rawRecords = check.rawRecordCount == null ? '-' : check.rawRecordCount;
      const submitRecords = check.submitRecordCount == null ? '-' : check.submitRecordCount;
      const selected = check.selectedFileCount == null ? '-' : check.selectedFileCount;
      const total = check.totalFileCount == null ? '-' : check.totalFileCount;
      const uploaded = check.uploaded === undefined ? '-' : check.uploaded;
      const problems = check.problems.length > 0 ? check.problems.join(',') : '-';
      return `  ${check.type}: ${check.status} starts=${check.starts} pageStarts=${check.pageSyncStarts} manualStarts=${check.manualSyncStarts} results=${check.results} pageSync=${check.pageSyncResults} pageUpload=${check.pageUploadResults} compact=${check.compactReports} manualSync=${check.manualSyncResults} failures=${check.failures} pageUploadFailures=${check.pageUploadFailures} manualFailures=${check.manualSyncFailures} localData=${check.legacyLocalDataReceived} nativeList=${check.nativeListReceived} fileList=${check.fileListReceived} timeouts=${check.historyInitialTimeouts} uploads=${check.uploadStarts} rawRecords=${rawRecords} submitRecords=${submitRecords} records=${records} selectedFiles=${selected} totalFiles=${total} uploaded=${uploaded}${line} problems=${problems}`;
    })
    .join('\n');
};

const formatCommandEvents = (events, limit = 40) => {
  if (events.length === 0) return '  none';
  return events
    .slice(-limit)
    .map((event) => `  L${event.line} ${event.time} ${event.event} ${event.kind} ${event.label} ${event.hex || event.rawLabel || ''}`.trimEnd())
    .join('\n');
};

const formatDisconnectEvents = (events, limit = 40) => {
  if (events.length === 0) return '  none';
  return events
    .slice(-limit)
    .map((event) => `  L${event.line} ${event.time} connected:false ${JSON.stringify(event.details || {})}`)
    .join('\n');
};

const formatDiagnosticEvents = (events, limit = 40) => {
  if (events.length === 0) return '  none';
  return events
    .slice(-limit)
    .map((event) => `  L${event.line} ${event.time} ${event.event} ${JSON.stringify(event.details || {})}`)
    .join('\n');
};

const getProtocolProbeKey = (event) => {
  const details = getObjectDetails(event.details);
  return String(details.key || details.label || event.event || '').trim() || '(unknown)';
};

const getProtocolProbeFamily = (eventOrKey) => {
  const details = typeof eventOrKey === 'string' ? {} : getObjectDetails(eventOrKey?.details);
  const key = typeof eventOrKey === 'string' ? eventOrKey : getProtocolProbeKey(eventOrKey);
  const explicit = String(details.family || '').trim();
  if (explicit) return explicit;
  if (key === 'battery/read' || key === 'firmware/read') return 'ab-core';
  if (key === 'time/read' || key === 'collect-period/read') return 'legacy-config';
  if (key.startsWith('monitoring/')) return 'ab-monitoring';
  if (key.startsWith('history-key/')) return 'ab-history-key';
  if (key.includes('/realtime-') || key.includes('/control-')) return 'ab-realtime';
  if (key === 'history/local-incremental' || key === 'history/file-list') return 'legacy-history';
  if (key.startsWith('history/qkeer-v2-')) return 'qkeer-v2-history';
  return key.split('/')[0] || 'unknown';
};

const getProtocolProbeDefaultRequired = (key) => {
  const family = getProtocolProbeFamily(key);
  return !['legacy-config', 'legacy-history', 'ab-monitoring', 'ab-history-key', 'qkeer-v2-history'].includes(family);
};

const getProtocolProbeSummary = (events) => {
  const commandMap = new Map();
  const starts = events.filter((event) => event.event === 'protocol-probe-command-start');
  const polls = events.filter((event) => event.event === 'protocol-probe-command-poll');
  const responses = events.filter((event) => event.event === 'protocol-probe-command-response' || event.event === 'protocol-probe-command-write-ok');
  const timeouts = events.filter((event) => event.event === 'protocol-probe-command-timeout');
  const errors = events.filter((event) => event.event === 'protocol-probe-command-error');
  const summaries = events.filter((event) => event.event === 'protocol-probe-summary');
  const failures = events.filter((event) => event.event === 'protocol-probe-failed');
  const plans = events.filter((event) => event.event === 'protocol-probe-plan');
  const reports = events.filter((event) => event.event === 'diagnostic-probe-report');
  const startEvents = events.filter((event) => event.event === 'protocol-probe-start');
  const started = events.some((event) => event.event === 'protocol-probe-start');

  const ensure = (event) => {
    const key = getProtocolProbeKey(event);
    if (!commandMap.has(key)) {
      commandMap.set(key, {
        key,
        family: getProtocolProbeFamily(event),
        required: getProtocolProbeDefaultRequired(key),
        label: '',
        expected: '',
        hex: '',
        index: null,
        startLine: '',
        resultLine: '',
        resultTime: '',
        elapsedMs: null,
        timeoutMs: null,
        status: 'missing',
        parsedType: '',
        parsedValue: '',
        firmwareValue: '',
        hardwareValue: '',
        softwareValue: '',
        uiValue: '',
        attempt: null,
        attemptCount: null,
        pollCount: 0,
        lastPollLine: '',
        lastPollTime: '',
        rawMessage: ''
      });
    }
    const row = commandMap.get(key);
    const details = getObjectDetails(event.details);
    row.family = row.family || details.family || getProtocolProbeFamily(key);
    const defaultRequired = getProtocolProbeDefaultRequired(key);
    if (defaultRequired === false) row.required = false;
    else if (typeof details.required === 'boolean') row.required = details.required;
    row.index = firstDefined(row.index, details.index);
    row.label = row.label || details.label || '';
    row.expected = row.expected || details.expected || '';
    row.hex = row.hex || details.hex || '';
    row.timeoutMs = firstDefined(row.timeoutMs, details.timeoutMs);
    return row;
  };

  const ensurePlanItem = (item) => {
    const details = getObjectDetails(item);
    const key = String(details.key || '');
    if (!key) return;
    if (!commandMap.has(key)) {
      commandMap.set(key, {
        key,
        family: details.family || getProtocolProbeFamily(key),
        required: typeof details.required === 'boolean' ? details.required : getProtocolProbeDefaultRequired(key),
        label: details.label || '',
        expected: details.expected || '',
        hex: '',
        index: Number.isFinite(Number(details.index)) ? Number(details.index) : null,
        startLine: '',
        resultLine: '',
        resultTime: '',
        elapsedMs: null,
        timeoutMs: firstDefined(details.timeoutMs, null),
        status: 'planned',
        parsedType: '',
        parsedValue: '',
        firmwareValue: '',
        hardwareValue: '',
        softwareValue: '',
        uiValue: '',
        attempt: null,
        attemptCount: null,
        pollCount: 0,
        lastPollLine: '',
        lastPollTime: '',
        rawMessage: ''
      });
      return;
    }
    const row = commandMap.get(key);
    row.family = row.family || details.family || getProtocolProbeFamily(key);
    row.required = typeof details.required === 'boolean' ? details.required : row.required;
    row.label = row.label || details.label || '';
    row.expected = row.expected || details.expected || '';
    row.index = firstDefined(row.index, details.index);
    row.timeoutMs = firstDefined(row.timeoutMs, details.timeoutMs);
  };

  const latestPlan = plans[plans.length - 1] || null;
  const planDetails = getObjectDetails(latestPlan?.details);
  const latestStart = startEvents[startEvents.length - 1] || null;
  const startDetails = getObjectDetails(latestStart?.details);
  for (const item of Array.isArray(planDetails.required) ? planDetails.required : []) ensurePlanItem(item);
  for (const item of Array.isArray(planDetails.optional) ? planDetails.optional : []) ensurePlanItem(item);

  const ensureReportItem = (item, reportEvent) => {
    const details = getObjectDetails(item);
    const key = String(details.key || details.k || '').trim();
    if (!key) return;
    if (!commandMap.has(key)) {
      commandMap.set(key, {
        key,
        family: details.family || details.f || getProtocolProbeFamily(key),
        required: typeof details.required === 'boolean' ? details.required : details.r === 1 ? true : details.r === 0 ? false : getProtocolProbeDefaultRequired(key),
        label: details.label || '',
        expected: details.expected || details.x || '',
        hex: details.hex || details.h || '',
        index: Number.isFinite(Number(details.index ?? details.i)) ? Number(details.index ?? details.i) : null,
        startLine: reportEvent.line,
        resultLine: '',
        resultTime: '',
        elapsedMs: null,
        timeoutMs: firstDefined(details.timeoutMs, details.to, null),
        status: 'started',
        parsedType: '',
        parsedValue: '',
        firmwareValue: '',
        hardwareValue: '',
        softwareValue: '',
        uiValue: '',
        attempt: null,
        attemptCount: null,
        pollCount: 0,
        lastPollLine: '',
        lastPollTime: '',
        rawMessage: ''
      });
    }
    const row = commandMap.get(key);
    const parsed = getObjectDetails(details.parsed || details.p);
    const reportStatus = String(details.status || details.s || '').trim();
    row.family = row.family || details.family || details.f || getProtocolProbeFamily(key);
    if (typeof details.required === 'boolean') row.required = details.required;
    else if (details.r === 1) row.required = true;
    else if (details.r === 0) row.required = false;
    row.label = row.label || details.label || '';
    row.expected = row.expected || details.expected || details.x || '';
    row.hex = row.hex || details.hex || details.h || '';
    row.index = firstDefined(row.index, details.index, details.i);
    row.startLine = row.startLine || reportEvent.line;
    row.timeoutMs = firstDefined(row.timeoutMs, details.timeoutMs, details.to);
    row.elapsedMs = firstDefined(details.elapsedMs, details.ms, row.elapsedMs);
    row.attempt = firstDefined(details.attempt, details.a, row.attempt);
    row.attemptCount = firstDefined(details.attemptCount, details.ac, row.attemptCount);
    row.pollCount = Math.max(Number(row.pollCount || 0), Number(row.attempt || 0));
    row.rawMessage = details.rawMessage || details.message || details.m || row.rawMessage;
    if (details.writeOnly === true || details.wo === 1) row.writeOnly = true;
    if (reportStatus === 'ok' || reportStatus === 'response') {
      row.status = 'response';
      row.resultLine = row.resultLine || reportEvent.line;
      row.resultTime = row.resultTime || reportEvent.time;
    } else if (reportStatus === 'timeout') {
      row.status = 'timeout';
      row.resultLine = row.resultLine || reportEvent.line;
      row.resultTime = row.resultTime || reportEvent.time;
    } else if (reportStatus === 'error') {
      row.status = 'error';
      row.resultLine = row.resultLine || reportEvent.line;
      row.resultTime = row.resultTime || reportEvent.time;
    } else if (reportStatus === 'pending' && row.status === 'missing') {
      row.status = 'started';
    }
    row.parsedType = row.parsedType || parsed.type || parsed.t || '';
    row.firmwareValue = row.firmwareValue || parsed.firmwareVersion || parsed.fw || '';
    row.hardwareValue = row.hardwareValue || parsed.hardwareVersion || parsed.hw || '';
    row.softwareValue = row.softwareValue || parsed.softwareVersion || parsed.sw || '';
    row.uiValue = row.uiValue || parsed.uiVersion || parsed.ui || '';
    row.parsedValue = row.parsedValue || firstDefined(
      parsed.value,
      parsed.v,
      parsed.battery,
      parsed.bat,
      parsed.heartRate,
      parsed.hr,
      parsed.bloodOxygen,
      parsed.spo2,
      parsed.firmwareVersion,
      parsed.fw,
      parsed.hardwareVersion,
      parsed.hw,
      parsed.softwareVersion,
      parsed.sw,
      parsed.uiVersion,
      parsed.ui,
      parsed.recordCount,
      parsed.c,
      ''
    );
  };

  for (const report of reports) {
    const reportDetails = getObjectDetails(report.details);
    for (const item of Array.isArray(reportDetails.commands) ? reportDetails.commands : []) ensureReportItem(item, report);
  }

  const latestSummary = summaries[summaries.length - 1] || null;
  const summaryDetails = getObjectDetails(latestSummary?.details);
  if (latestSummary) {
    for (const item of Array.isArray(summaryDetails.requiredCommands) ? summaryDetails.requiredCommands : []) ensureReportItem(item, latestSummary);
    for (const item of Array.isArray(summaryDetails.failedCommands) ? summaryDetails.failedCommands : []) ensureReportItem(item, latestSummary);
  }

  for (const event of starts) {
    const row = ensure(event);
    row.startLine = event.line;
    row.status = row.status === 'missing' ? 'started' : row.status;
  }

  for (const event of polls) {
    const row = ensure(event);
    const details = getObjectDetails(event.details);
    row.status = row.status === 'missing' ? 'started' : row.status;
    row.lastPollLine = event.line;
    row.lastPollTime = event.time;
    row.elapsedMs = firstDefined(details.elapsedMs, row.elapsedMs);
    row.timeoutMs = firstDefined(row.timeoutMs, details.timeoutMs);
    row.attempt = firstDefined(details.attempt, row.attempt);
    row.attemptCount = firstDefined(details.attemptCount, row.attemptCount);
    row.pollCount = Math.max(Number(row.pollCount || 0), Number(details.attempt || 0), 1);
  }

  for (const event of responses) {
    const row = ensure(event);
    const details = getObjectDetails(event.details);
    const parsed = getObjectDetails(details.parsed);
    row.status = 'response';
    row.resultLine = event.line;
    row.resultTime = event.time;
    row.elapsedMs = firstDefined(details.elapsedMs, row.elapsedMs);
    if (event.event === 'protocol-probe-command-write-ok') row.writeOnly = true;
    row.parsedType = parsed.type || '';
    row.firmwareValue = parsed.firmwareVersion || '';
    row.hardwareValue = parsed.hardwareVersion || '';
    row.softwareValue = parsed.softwareVersion || '';
    row.uiValue = parsed.uiVersion || '';
    row.parsedValue = firstDefined(
      parsed.value,
      parsed.battery,
      parsed.heartRate,
      parsed.bloodOxygen,
      parsed.firmwareVersion,
      parsed.hardwareVersion,
      parsed.softwareVersion,
      parsed.uiVersion,
      parsed.recordCount,
      ''
    );
  }

  for (const event of timeouts) {
    const row = ensure(event);
    const details = getObjectDetails(event.details);
    row.status = 'timeout';
    row.resultLine = event.line;
    row.resultTime = event.time;
    row.elapsedMs = firstDefined(details.elapsedMs, row.elapsedMs);
    row.timeoutMs = firstDefined(details.timeoutMs, row.timeoutMs);
    row.rawMessage = details.rawMessage || details.message || row.rawMessage;
  }

  for (const event of errors) {
    const row = ensure(event);
    const details = getObjectDetails(event.details);
    row.status = 'error';
    row.resultLine = event.line;
    row.resultTime = event.time;
    row.elapsedMs = firstDefined(details.elapsedMs, row.elapsedMs);
    row.rawMessage = details.rawMessage || details.message || row.rawMessage;
  }

  const rows = [...commandMap.values()].sort(
    (a, b) => Number(a.startLine || a.index || 0) - Number(b.startLine || b.index || 0)
  );
  const incompleteRows = rows.filter((row) => row.status === 'started' || row.status === 'missing' || row.status === 'planned');
  const failedRows = rows.filter((row) => row.status === 'timeout' || row.status === 'error' || row.status === 'started');
  const requiredRows = rows.filter((row) => row.required !== false);
  const optionalRows = rows.filter((row) => row.required === false);
  const requiredFailedRows = failedRows.filter((row) => row.required !== false);
  const optionalFailedRows = failedRows.filter((row) => row.required === false);
  const familyRows = [...rows.reduce((map, row) => {
    const family = row.family || getProtocolProbeFamily(row.key);
    if (!map.has(family)) {
      map.set(family, { family, total: 0, response: 0, timeout: 0, error: 0, started: 0, planned: 0, missing: 0, failed: 0, required: 0, optional: 0 });
    }
    const item = map.get(family);
    item.total += 1;
    if (row.required === false) item.optional += 1;
    else item.required += 1;
    item[row.status] = (item[row.status] || 0) + 1;
    if (row.status === 'timeout' || row.status === 'error' || row.status === 'started' || row.status === 'missing') item.failed += 1;
    return map;
  }, new Map()).values()].sort((a, b) => a.family.localeCompare(b.family));
  const latestFailure = failures[failures.length - 1] || null;
  const latestReport = reports[reports.length - 1] || null;
  const reportDetails = getObjectDetails(latestReport?.details);
  const truncatedReports = reports.filter((report) => {
    const details = getObjectDetails(report.details);
    return details.truncated === true || details.truncated === 'true' || details.reason === 'protocol-probe-start-missing';
  });
  const isTruncated = truncatedReports.length > 0;
  const truncatedReason = firstDefined(
    ...truncatedReports.map((report) => getObjectDetails(report.details).reason).filter(Boolean),
    isTruncated ? 'protocol-probe-start-missing' : ''
  );
  const mode = firstDefined(summaryDetails.mode, planDetails.mode, startDetails.mode, reportDetails.mode, '');
  const okCount = firstDefined(summaryDetails.okCount, rows.filter((row) => row.status === 'response').length);
  const failedCount = firstDefined(summaryDetails.failedCount, failedRows.length);
  const commandCount = firstDefined(summaryDetails.commandCount, rows.length);
  const requiredOkCount = requiredRows.filter((row) => row.status === 'response').length;
  const requiredFailedCount = requiredFailedRows.length;
  const requiredCommandCount = requiredRows.length;
  const optionalOkCount = optionalRows.filter((row) => row.status === 'response').length;
  const optionalFailedCount = optionalFailedRows.length;
  const optionalCommandCount = optionalRows.length;

  let status = 'not found';
  if (latestFailure) status = 'failed';
  else if (!latestSummary && incompleteRows.length > 0) status = 'running-or-incomplete';
  else if (events.length > 0 && requiredFailedRows.length > 0) status = 'failed';
  else if (events.length > 0 && optionalFailedRows.length > 0) status = 'optional-failed';
  else if (!latestSummary && isTruncated) status = 'running-or-incomplete';
  else if (events.length > 0 && (latestSummary || (reports.length > 0 && rows.length > 0))) status = 'passed';
  else if (started) status = 'running-or-incomplete';

  return {
    status,
    mode,
    started,
    starts: starts.length,
    polls: polls.length,
    responses: responses.length,
    timeouts: timeouts.length,
    errors: errors.length,
    summaries: summaries.length,
    failures: failures.length,
    reports: reports.length,
    truncated: isTruncated,
    truncatedReason,
    truncatedReports: truncatedReports.length,
    okCount,
    failedCount,
    commandCount,
    requiredOkCount,
    requiredFailedCount,
    requiredCommandCount,
    optionalOkCount,
    optionalFailedCount,
    optionalCommandCount,
    rows,
    incompleteRows,
    failedRows,
    requiredFailedRows,
    optionalFailedRows,
    familyRows,
    latestPlan,
    latestStart,
    latestReport,
    latestSummary,
    latestFailure
  };
};

const formatRwL19Acceptance = (events) => {
  if (events.length === 0) return '  none';
  const summaries = events.filter((event) => event.event === 'rw-l19-acceptance-summary' || event.event === 'diagnostic-acceptance-report');
  const latestSummary = summaries[summaries.length - 1] || null;
  const summary = getObjectDetails(latestSummary?.details);
  const lines = [
    `  events=${events.length} summaries=${summaries.length}`
  ];
  if (latestSummary) {
    lines.push(`  latest-summary: L${latestSummary.line} ok=${summary.okCount ?? '-'} failed=${summary.failedCount ?? '-'} steps=${summary.stepCount ?? '-'} elapsedMs=${summary.elapsedMs ?? '-'}`);
    const failed = Array.isArray(summary.failed) ? summary.failed : [];
    if (failed.length > 0) {
      lines.push(`  failed: ${failed.map((item) => `${item.key || '-'}:${item.label || '-'}`).join(', ')}`);
    }
  }
  lines.push('  recent:');
  for (const event of events.slice(-20)) {
    const details = getObjectDetails(event.details);
    const result = getObjectDetails(details.result);
    const parts = [
      `L${event.line}`,
      event.time,
      event.event,
      details.key ? `key=${details.key}` : '',
      details.label ? `label=${details.label}` : '',
      details.ok !== undefined ? `ok=${details.ok}` : '',
      result.ok !== undefined ? `resultOk=${result.ok}` : '',
      result.recordCount !== undefined ? `records=${result.recordCount}` : '',
      result.value !== undefined ? `value=${result.value}` : '',
      details.elapsedMs !== undefined ? `elapsedMs=${details.elapsedMs}` : ''
    ].filter(Boolean).join(' ');
    lines.push(`    ${parts}`);
  }
  return lines.join('\n');
};
const formatProtocolProbeSummary = (events) => {
  const summary = getProtocolProbeSummary(events);
  if (events.length === 0) return '  none';
  const failedList =
    summary.requiredFailedRows.length > 0
      ? summary.requiredFailedRows.map((row) => `${row.key}(${row.status})`).join(', ')
      : '-';
  const optionalFailedList =
    summary.optionalFailedRows.length > 0
      ? summary.optionalFailedRows.map((row) => `${row.key}(${row.status})`).join(', ')
      : '-';
  const lines = [
    `  status: ${summary.status}`,
    `  mode: ${summary.mode || '-'}`,
    `  totals: starts=${summary.starts} polls=${summary.polls} responses=${summary.responses} timeouts=${summary.timeouts} errors=${summary.errors} summaries=${summary.summaries} reports=${summary.reports} truncated=${summary.truncated ? 'yes' : 'no'} failed=${summary.failures}`,
    summary.truncated ? `  truncated-reason: ${summary.truncatedReason || '-'}` : '',
    `  result: ok=${summary.okCount ?? '-'} failed=${summary.failedCount ?? '-'} total=${summary.commandCount ?? '-'}`,
    `  required: ok=${summary.requiredOkCount ?? '-'} failed=${summary.requiredFailedCount ?? '-'} total=${summary.requiredCommandCount ?? '-'}`,
    `  optional: ok=${summary.optionalOkCount ?? '-'} no-response=${summary.optionalFailedCount ?? '-'} total=${summary.optionalCommandCount ?? '-'}`,
    `  failed-required-commands: ${failedList}`,
    `  optional-no-response: ${optionalFailedList}`,
    '  families:',
    ...summary.familyRows.map((row) => `    ${row.family}: ok=${row.response} failed=${row.failed} planned=${row.planned || 0} required=${row.required} optional=${row.optional} total=${row.total} timeouts=${row.timeout} errors=${row.error}`),
    '  commands:'
  ].filter(Boolean);

  for (const row of summary.rows) {
    const elapsed = row.elapsedMs == null ? '-' : row.elapsedMs;
    const timeout = row.timeoutMs == null ? '-' : row.timeoutMs;
    const parsed = row.parsedType ? ` parsed=${row.parsedType}${row.parsedValue !== '' ? `:${row.parsedValue}` : ''}` : '';
    const versions = [
      row.firmwareValue ? `fw=${row.firmwareValue}` : '',
      row.hardwareValue ? `hw=${row.hardwareValue}` : '',
      row.softwareValue ? `sw=${row.softwareValue}` : '',
      row.uiValue ? `ui=${row.uiValue}` : ''
    ].filter(Boolean).join(',');
    const attempt = row.attempt ? ` attempt=${row.attempt}${row.attemptCount ? `/${row.attemptCount}` : ''}` : '';
    const pollText = row.pollCount ? ` polls=${row.pollCount}${row.lastPollLine ? ` lastPoll=L${row.lastPollLine}` : ''}` : '';
    const message = row.rawMessage ? ` message=${JSON.stringify(String(row.rawMessage))}` : '';
    const writeOnly = row.writeOnly ? ' writeOnly=1' : '';
    const resultLine = row.resultLine ? ` result=L${row.resultLine}` : '';
    const required = row.required === false ? 'optional' : 'required';
    lines.push(
      `    ${row.key}: ${row.status.toUpperCase()} ${required} start=L${row.startLine || '-'}${resultLine} elapsedMs=${elapsed} timeoutMs=${timeout} expected=${JSON.stringify(row.expected || '')} hex=${row.hex || '-'}${parsed}${versions ? ` versions=${versions}` : ''}${attempt}${pollText}${writeOnly}${message}`
    );
  }

  if (summary.latestFailure) {
    const details = getObjectDetails(summary.latestFailure.details);
    lines.push(`  latest-failure: L${summary.latestFailure.line} ${details.message || details.rawMessage || 'protocol probe failed'}`);
  }

  return lines.join('\n');
};

const getConnectionSnapshotSummary = (snapshots) => {
  const latest = snapshots[snapshots.length - 1] || null;
  const latestKnown = [...snapshots].reverse().find((item) => item.snapshot.status !== 'unknown') || latest;
  const counts = snapshots.reduce(
    (acc, item) => {
      acc[item.snapshot.status] = (acc[item.snapshot.status] || 0) + 1;
      return acc;
    },
    {}
  );
  const hasStateSyncSuspect = snapshots.some((item) => item.snapshot.status === 'state-sync-suspect');
  const hasBleNotReady = snapshots.some((item) => item.snapshot.status === 'ble-not-ready');
  const hasReady = snapshots.some((item) => item.snapshot.status === 'ready');

  return {
    latest,
    counts,
    hasStateSyncSuspect,
    hasBleNotReady,
    hasReady,
    verdict: latestKnown ? latestKnown.snapshot.status : 'not found'
  };
};

const formatConnectionSnapshot = (event) => {
  const snapshot = event.snapshot;
  const compact = {
    buildTag: event.buildTag,
    status: snapshot.status,
    controllerReady: snapshot.controllerReady,
    connected: snapshot.connected,
    pageConnected: snapshot.pageConnected,
    storeConnected: snapshot.storeConnected,
    userConnected: snapshot.userConnected,
    storeReconnectStatus: snapshot.storeReconnectStatus,
    userReconnectStatus: snapshot.userReconnectStatus,
    currentReady: snapshot.currentDevice.ready,
    storeReady: snapshot.storeDevice.ready,
    userReady: snapshot.userDevice.ready,
    currentDeviceId: snapshot.currentDevice.deviceId,
    storeDeviceId: snapshot.storeDevice.deviceId,
    userDeviceId: snapshot.userDevice.deviceId
  };
  return `  L${event.line} ${event.time} ${event.event} ${JSON.stringify(compact)}`;
};

const formatConnectionSnapshots = (snapshots) => {
  if (snapshots.length === 0) return '  none';
  const summary = getConnectionSnapshotSummary(snapshots);
  const lines = [
    `  latest-status: ${summary.verdict}`,
    `  counts: ${JSON.stringify(summary.counts)}`,
    '  recent-snapshots:'
  ];
  lines.push(...snapshots.slice(-20).map(formatConnectionSnapshot));
  return lines.join('\n');
};

const hasDiagnosticEvent = (events, eventName) => events.some((event) => event.event === eventName);

const findLatestDiagnosticEvent = (events, eventNames) => {
  const names = new Set(Array.isArray(eventNames) ? eventNames : [eventNames]);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (names.has(events[index].event)) return events[index];
  }
  return null;
};

const summarizeConnectStage = ({ connectEvents = [], reconnectEvents = [], scanEvents = [], restoreEvents = [], snapshots = [] }) => {
  const latestConnectFailure = findLatestDiagnosticEvent(connectEvents, [
    'connect-page-fail',
    'connect-attempt-error',
    'connect-fail',
    'connect-discover-fail',
    'connect-timeout',
    'connect-not-ready'
  ]);
  const latestReconnectFailure = [...reconnectEvents]
    .reverse()
    .find((event) => event.event === 'reconnect-connect-result' && (event.details?.success === false || event.details?.success === 'false'));
  const latestRestoreTimeout = findLatestDiagnosticEvent(restoreEvents, 'restore-timeout');

  if (hasDiagnosticEvent(connectEvents, 'connect-ready') || hasDiagnosticEvent(connectEvents, 'notify-primary-enabled')) {
    const snapshotSummary = getConnectionSnapshotSummary(snapshots);
    return {
      stage: snapshotSummary.hasStateSyncSuspect ? 'ready-state-sync-suspect' : 'ble-ready',
      evidence: findLatestDiagnosticEvent(connectEvents, ['connect-ready', 'notify-primary-enabled']),
      next: snapshotSummary.hasStateSyncSuspect
        ? 'BLE reached ready, but page/store/user state disagree. Compare connection snapshot fields before changing protocol commands.'
        : 'BLE reached notify-ready. If data is missing, debug command/result parsing rather than connection.'
    };
  }

  if (latestRestoreTimeout) {
    return {
      stage: 'restore-timeout',
      evidence: latestRestoreTimeout,
      next: 'Auto restore timed out before ready. Inspect reconnect scan candidate and connect/discovery events.'
    };
  }

  if (latestConnectFailure || latestReconnectFailure) {
    const failure = latestConnectFailure || latestReconnectFailure;
    const eventName = failure.event;
    const stage =
      eventName === 'connect-fail'
        ? 'create-connection-failed'
        : eventName === 'connect-discover-fail'
          ? 'discovery-or-notify-failed'
          : eventName === 'connect-not-ready'
            ? 'connected-but-not-ready'
            : eventName === 'connect-timeout'
              ? 'connect-flow-timeout'
              : eventName === 'connect-page-fail'
                ? 'page-connect-failed'
                : 'connect-attempt-failed';
    return {
      stage,
      evidence: failure,
      next: 'Inspect Connect Events around the latest failure for createBLEConnection, service discovery, or notify details.'
    };
  }

  if (hasDiagnosticEvent(connectEvents, 'discovery-ready')) {
    return {
      stage: 'discovery-ready-waiting-notify',
      evidence: findLatestDiagnosticEvent(connectEvents, 'discovery-ready'),
      next: 'Services/chars were discovered, but primary notify-ready was not logged. Focus on notifyBLECharacteristicValueChange.'
    };
  }

  if (hasDiagnosticEvent(connectEvents, 'connect-created')) {
    return {
      stage: 'ble-link-created-waiting-discovery',
      evidence: findLatestDiagnosticEvent(connectEvents, 'connect-created'),
      next: 'createBLEConnection succeeded, but discovery-ready was not logged. Focus on getBLEDeviceServices/getBLEDeviceCharacteristics.'
    };
  }

  if (hasDiagnosticEvent(connectEvents, 'connect-start') || hasDiagnosticEvent(connectEvents, 'connect-attempt-start')) {
    return {
      stage: 'connect-started-waiting-link',
      evidence: findLatestDiagnosticEvent(connectEvents, ['connect-start', 'connect-attempt-start']),
      next: 'Connect was started, but BLE link creation did not finish. Check createBLEConnection timeout/failure and device proximity.'
    };
  }

  if (hasDiagnosticEvent(connectEvents, 'connect-page-attempt')) {
    return {
      stage: 'page-attempt-not-enter-flow',
      evidence: findLatestDiagnosticEvent(connectEvents, 'connect-page-attempt'),
      next: 'The connect page attempted connection, but business/BLE flow did not start. Inspect connect page target and ring.connectBusinessDevice call.'
    };
  }

  if (hasDiagnosticEvent(connectEvents, 'connect-page-scan-skipped-ready')) {
    return {
      stage: 'ready-scan-skipped',
      evidence: findLatestDiagnosticEvent(connectEvents, 'connect-page-scan-skipped-ready'),
      next: 'Connect page skipped auto scan because the current device was already ready. This is expected; use manual refresh only when switching devices.'
    };
  }

  if (reconnectEvents.length > 0) {
    return {
      stage: 'reconnect-without-connect-attempt',
      evidence: reconnectEvents[reconnectEvents.length - 1],
      next: 'Reconnect ran but did not reach a connect attempt. Inspect target identity matching and reconnect-scan-candidate.'
    };
  }

  if (scanEvents.length > 0) {
    return {
      stage: 'scan-only-no-connect',
      evidence: scanEvents[scanEvents.length - 1],
      next: 'Scanner produced events but no connect attempt was logged. Press connect again and copy logs after the failure toast.'
    };
  }

  return {
    stage: 'no-connect-evidence',
    evidence: null,
    next: 'No scan/connect/restore evidence found. Retest with current build and copy diagnostics from the Mine page.'
  };
};

const formatConnectStageSummary = (summary) => {
  const evidence = summary.evidence
    ? `  evidence: ${formatHistoryEvent({
        line: summary.evidence.line,
        time: summary.evidence.time,
        event: summary.evidence.event,
        summary: summary.evidence.details || summary.evidence.rawDetails
      }).trim()}`
    : '  evidence: none';
  return [`  stage: ${summary.stage}`, evidence, `  next: ${summary.next}`].join('\n');
};

const getHistoryNextActions = (events) => {
  const summary = getHistorySyncSummary(events);
  const latestResult = summary.latestResult?.summary;
  const latestFailure = summary.latestFailure?.summary;
  const actions = [];

  if (events.length === 0) return actions;
  if (summary.queueFailures.length > 0) {
    actions.push('RW history queue task failed before or during syncHistory; inspect compat-history-queue-failed and the following history event.');
  }
  if (summary.manualSyncFailures.length > 0) {
    actions.push('Mine manual history sync failed. Inspect manual-history-sync-failed, queue events, and the following RW HISTORY fallback events.');
  }
  if (summary.queueEnqueues.length > summary.queueStarts.length) {
    actions.push('RW history reads are queued but not all started yet. Copy logs after queued tasks start or finish.');
  }
  if (summary.maxQueuedBehind > 0) {
    actions.push('Multiple RW history reads were queued. Serialization is active; if the device still times out, retest with one business page/history action at a time.');
  }
  if (summary.latest?.event === 'history-sync-start') {
    actions.push('History sync only reached start; confirm the copied log is complete, then inspect ble.syncHistory timeout or page-switch interruption.');
  }
  if (summary.historyInitialTimeouts.length > 0) {
    actions.push('\u5386\u53f2\u540c\u6b65\u5df2\u5c1d\u8bd5\u672c\u5730\u6570\u636e: history initial wait timed out after local/native/file-list attempts; check 0x36/0x00/0x01, 0x31/0x41/0x71, and 0x36/0x10 paths.');
  }
  if (summary.nativeListWaitTimeouts.length > 0 && summary.lastDataWaitTimeouts.length > 0 && summary.unexpectedResponses.length === 0) {
    actions.push('Native list and last-data fallbacks both waited with zero unexpected history responses. Treat this as device/no-response for those command families before changing parser mapping.');
  }
  if (summary.nativeListWaitResponses.length > 0 || summary.lastDataWaitResponses.length > 0 || summary.lastDataOnlyResponses.length > 0) {
    actions.push('A fallback history response was captured. Inspect responseType/packetShape/records to decide whether mapping or upload flow is the next fix.');
  }
  if (summary.unexpectedResponses.length > 0 && summary.fileListReceived.length === 0 && summary.nativeListReceived.length === 0 && summary.legacyLocalDataReceived.length === 0) {
    actions.push('Unexpected history response was received. Inspect history-unexpected-response rawHex; parser or subcommand matching likely needs expansion.');
  }
  if (summary.nativeListFallbacks.length > 0 && summary.nativeListReceived.length === 0 && summary.fileListFallbacks.length === 0) {
    actions.push('Native history-list fallback was sent but no native list arrived yet; copy a complete log through history-sync-result or history-sync-failed.');
  }
  if (summary.fileListFallbacks.length > 0 && summary.fileListReceived.length === 0 && summary.nativeListReceived.length === 0 && summary.legacyLocalDataReceived.length === 0) {
    actions.push('File-list fallback also had no response. Retest with one Mine-page history sync button and avoid concurrent realtime reads.');
  }
  if (summary.nativeListReceived.length > 0 && summary.uploadStarts.length === 0 && !summary.latestResult) {
    actions.push('Native RW history list was received but did not become a sync result; inspect native-list records to business history/store mapping.');
  }
  if (summary.fileListReceived.length > 0 && summary.uploadStarts.length === 0 && !summary.latestResult) {
    actions.push('History file list was received but upload did not start; check dataTypes, sinceTimestamp, and selectedFileCount filters.');
  }
  if (summary.latest?.event === 'history-sync-failed') {
    actions.push(`History sync failed: ${latestFailure?.message || 'no message'}; inspect RW file read, parser, or upload path.`);
  }
  if (latestResult) {
    if ((latestResult.recordCount || 0) === 0 && (latestResult.selectedFileCount || 0) > 0) {
      actions.push('Device history files were selected but no records were generated; inspect RW file upload response and history parser.');
    }
    if ((latestResult.selectedFileCount || 0) === 0 && (latestResult.totalFileCount || 0) > 0) {
      actions.push('Device returned history files but they were filtered out; check readAll, lastReadTimestamp, and dataTypes.');
    }
    if ((latestResult.recordCount || 0) > 0 && latestResult.uploaded === false) {
      actions.push('History records were generated but not uploaded; inspect uploadRingHistoryRecords or backend /app/data/sync response.');
    }
  }
  if (summary.pageUploadResults.some((event) => event.summary?.uploaded === true || event.summary?.submitRecordCount > 0)) {
    const emptyQueries = summary.pageQueryResults.filter((event) => (event.summary?.itemCount ?? 0) <= 0);
    if (emptyQueries.length > 0) {
      const labels = emptyQueries
        .slice(-4)
        .map((event) => `${event.summary?.page || 'page'}/${event.summary?.endpoint || 'query'}@L${event.line}`)
        .join(', ');
      actions.push(`History upload succeeded but backend detail query returned no items: ${labels}. Inspect backend aggregation/date offset/page field consumption before changing BLE commands.`);
    }
  }
  if (summary.latestManualSyncResult?.summary) {
    const manualResult = summary.latestManualSyncResult.summary;
    if ((manualResult.recordCount || 0) <= 0) {
      actions.push('Mine manual history sync completed with zero records. Check selected date/time range, device history availability, and dataTypes mapping.');
    }
    if (manualResult.uploaded === false) {
      actions.push('Mine manual history sync produced data but upload was false; inspect upload bridge and backend /app/data/sync response.');
    }
  }
  return actions;
};

const hasExpectedRealtimeHit = (metricKeyChecks) =>
  metricKeyChecks.rows.some((row) => row.requested && row.hitCount > 0);

const getPageMetricFlowLabel = (flow) => `${flow.source || 'RW PAGE'}/${flow.name}`;

const formatNextActions = ({
  hasBuildTag,
  hasStaleBuildTag,
  hasOldLinks,
  hasMetricKeyMismatch,
  hasWaitHit,
  hasWaitTimeout,
  hasPageMetricFailure,
  hasRealtimeHit,
  realtimeAckOnly = [],
  batteryMetricCount = 0,
  batteryPageFailedAfterRx = false,
  maxPendingWaiters,
  realtimeCommandCount = 0,
  maxRealtimeCommandsIn30s = 0,
  historyCommandCount = 0,
  historyEvents = [],
  disconnectDuringMeasurement = false,
  ignoredDisconnectCount = 0,
  ignoredDisconnectReasons = [],
  pageMetricFlows = [],
  restoreTimeoutFound = false,
  reconnectCandidateMissing = false,
  reconnectCandidateFound = false,
  connectFailureFound = false,
  connectEventCount = 0,
  reconnectEventCount = 0,
  deviceEvents = [],
  scanFoundCount = 0,
  bleDisconnectCount = 0,
  connectionSnapshotSummary = null,
  connectStageSummary = null,
  protocolProbeSummary = null,
  diagnosticCopyIncompleteEvents = []
}) => {
  const actions = [];
  actions.push(...getHistoryNextActions(historyEvents));

  if (diagnosticCopyIncompleteEvents.length > 0) {
    const latest = diagnosticCopyIncompleteEvents[diagnosticCopyIncompleteEvents.length - 1];
    const details = getObjectDetails(latest.details);
    const counts =
      details.startedCount != null || details.finishedCount != null
        ? ` started=${details.startedCount ?? '-'} finished=${details.finishedCount ?? '-'}`
        : '';
    actions.push(`Mine copied diagnostics before protocol self-test finished.${counts}. Retest after the self-test summary appears.`);
  }

  if (protocolProbeSummary?.truncated) {
    actions.push(`Protocol probe report is truncated (${protocolProbeSummary.truncatedReason || 'protocol-probe-start-missing'}). Use listed tail commands for clues, but retest after the full self-test summary appears before judging RW=L19.`);
  }

  if (protocolProbeSummary?.status === 'failed') {
    const failedKeys = protocolProbeSummary.requiredFailedRows.map((row) => `${row.key}:${row.status}`).join(', ');
    actions.push(`Protocol probe found required command no-response/error: ${failedKeys}. Prioritize these command families before changing page/store display code.`);
  } else if (protocolProbeSummary?.status === 'optional-failed') {
    const failedKeys = protocolProbeSummary.optionalFailedRows.map((row) => `${row.key}:${row.status}`).join(', ');
    actions.push(`Only optional/compat protocol commands did not return: ${failedKeys}. Do not treat this alone as a BLE connection failure.`);
  } else if (protocolProbeSummary?.status === 'passed') {
    actions.push('Protocol probe passed all tested commands. If business pages still miss data, inspect parser normalization, store merge, and page field consumption.');
  } else if (protocolProbeSummary?.status === 'running-or-incomplete') {
    actions.push('Protocol probe started but no summary was copied. Copy logs after the protocol self-test finishes.');
  }

  const realtimeProbeTimeouts = (protocolProbeSummary?.requiredFailedRows || []).filter((row) => row.family === 'ab-realtime' && row.status === 'timeout');
  const exhaustedRealtimeProbeTimeouts = realtimeProbeTimeouts.filter((row) => Number(row.pollCount || row.attempt || 0) >= Number(row.attemptCount || 4));
  if (exhaustedRealtimeProbeTimeouts.length > 0) {
    actions.push(`Required realtime protocol read exhausted warm-up polling without a result: ${exhaustedRealtimeProbeTimeouts.map((row) => `${row.key} attempt=${row.attempt || '-'}${row.attemptCount ? `/${row.attemptCount}` : ''}`).join(', ')}. This points to command/device no-result after enable/read; compare Mine manual metric and raw rx before changing page display code.`);
  } else if (realtimeProbeTimeouts.length > 0) {
    actions.push(`Required realtime protocol read timed out before full polling evidence was copied: ${realtimeProbeTimeouts.map((row) => row.key).join(', ')}. Retest and copy after the core self-test summary appears.`);
  }

  if (hasStaleBuildTag) actions.push(`Log contains stale build tags. Retest with ${expectedBuildTag}.`);
  if (connectionSnapshotSummary?.latest) {
    if (connectionSnapshotSummary.hasStateSyncSuspect) actions.push('Connection snapshot has state-sync-suspect. Compare page/store/user connection and ready fields before changing protocol parsing.');
    else if (connectionSnapshotSummary.verdict === 'ble-not-ready') actions.push('Connection snapshot is ble-not-ready. Debug scan -> candidate -> createBLEConnection -> service discovery.');
    else if (connectionSnapshotSummary.verdict === 'ready') actions.push('Connection snapshot is ready. If UI still says connecting, inspect page UI conditions or stale local state.');
  } else {
    actions.push('No connection diagnostic snapshot found. Copy diagnostics from the Mine page on the current build.');
  }
  if (bleDisconnectCount > 0 && connectEventCount === 0 && reconnectEventCount === 0) actions.push('Only BLE disconnect/adapter noise appears, with no connect events. The tested package may be stale or log copied after an auto-restore loop.');
  if (connectStageSummary?.stage) actions.push(`Connect stage: ${connectStageSummary.stage}. ${connectStageSummary.next}`);
  if (!hasBuildTag) actions.push(`Missing diagnostic-build for ${expectedBuildTag}; do not judge the current code from this log yet.`);
  if (hasOldLinks) actions.push(hasBuildTag ? 'Current build still emitted stale l19-primary/direct-read diagnostics; check old foreground entry points.' : 'Log still has stale l19-primary/direct-read diagnostics; re-import dist/build/mp-weixin before testing.');
  if (hasMetricKeyMismatch) actions.push('Realtime metric includes a key outside the v150 no-CRC primary keys and legacy-compatible AppRealTime keys. Check parser key mapping before changing UI display code.');
  if (hasRealtimeHit && hasPageMetricFailure && !hasWaitHit) actions.push('BLE parsed realtime values but page flow failed. Check direct-hit/wait-hit/diagnostic-log-hit/wait-cache-hit events.');
  if (batteryPageFailedAfterRx) actions.push(`BLE parsed ${batteryMetricCount} battery values but page single-read failed. Check page waiter, timestamp, and store merge.`);
  if (restoreTimeoutFound) actions.push('RW restore timed out before communication became ready; inspect Restore/Reconnect phase evidence.');
  if (reconnectCandidateMissing) actions.push(scanFoundCount > 0 ? 'Scan found devices but reconnect did not select a candidate; inspect scannedTail/target identity.' : 'Reconnect scan found no usable device; verify the ring is awake and advertising nearby.');
  if (reconnectCandidateFound && connectFailureFound) actions.push('Reconnect selected a candidate but connection/service/notify failed; inspect Connect Events.');
  const deviceFailures = deviceEvents.filter((event) => event.event.endsWith('-failed'));
  if (deviceFailures.length > 0) {
    const latestFailure = deviceFailures[deviceFailures.length - 1];
    const message = latestFailure.details?.message || latestFailure.details?.error || '';
    actions.push(`Device page failure at ${latestFailure.event}${message ? `: ${message}` : ''}. Inspect Device Page Events plus RW FLOW device-info-refresh events.`);
  }
  if (disconnectDuringMeasurement) actions.push('BLE disconnected during measurement. Reduce realtime frequency and stop waiters on disconnect before judging HR/SpO2 packets.');
  if (ignoredDisconnectCount > 0) actions.push(`RW ignored ${ignoredDisconnectCount} stale/disallowed disconnect event(s) (${ignoredDisconnectReasons.join(', ') || 'unknown'}).`);
  if (realtimeAckOnly.length > 0) actions.push(`Realtime measurement only saw control ACK, no result packet: ${realtimeAckOnly.map((item) => item.name).join(', ')}.`);

  const pageMetricTimeouts = pageMetricFlows.filter((flow) => flow.waitTimeouts > 0);
  const pageMetricHits = pageMetricFlows.filter((flow) => getPageMetricFlowStatus(flow) === 'hit');
  const pageMetricWaiting = pageMetricFlows.filter((flow) => flow.controlEnabled > 0 && flow.waitHits === 0 && flow.directHits === 0 && flow.diagnosticLogHits === 0 && flow.waitTimeouts === 0 && flow.failed === 0 && flow.disconnected === 0);
  const pageMetricAckNoResult = pageMetricFlows.filter((flow) => flow.ackSeen > 0 && flow.waitHits === 0 && flow.directHits === 0 && flow.diagnosticLogHits === 0 && (flow.waitTimeouts > 0 || flow.failed > 0));

  if (pageMetricHits.length > 0) actions.push(`Page foreground hit: ${pageMetricHits.map((flow) => `${getPageMetricFlowLabel(flow)}=${flow.latestValue ?? '-'}`).join(', ')}. If UI does not show it, inspect store -> page field consumption.`);
  if (pageMetricAckNoResult.length > 0) actions.push(`Page metric got control ACK but no result: ${pageMetricAckNoResult.map(getPageMetricFlowLabel).join(', ')}.`);
  if (pageMetricWaiting.length > 0) actions.push(`Page metric is still waiting: ${pageMetricWaiting.map(getPageMetricFlowLabel).join(', ')}.`);
  if (hasWaitTimeout) actions.push(pageMetricTimeouts.length > 0 ? `Page waiter timed out: ${pageMetricTimeouts.map(getPageMetricFlowLabel).join(', ')}. Check expected/value/steps key, timestamp, sourceType.` : 'Page waiter timed out. Inspect Page Events expectedKey/parsed snapshots.');
  if (maxPendingWaiters >= 10) actions.push('pendingWaiters is high; avoid automatic full realtime reads and keep single-metric verification.');
  if (maxRealtimeCommandsIn30s >= 6) actions.push(`RW realtime command burst was ${maxRealtimeCommandsIn30s} within 30s; inspect onShow/refreshBusinessData silent realtime reads.`);
  else if (realtimeCommandCount > 0 && !hasWaitHit && !hasPageMetricFailure) actions.push('RW realtime commands exist but no page single-metric events; inspect silent refresh entry points.');
  if (historyCommandCount > 0 && historyEvents.length === 0) actions.push('RW history commands exist but no RW FLOW history-sync event; inspect history snapshot/page refresh entry points.');
  if (actions.length === 0) actions.push('No clear stale route or key mismatch found; continue with store -> UI field consumption.');

  return actions.map((action, index) => `  ${index + 1}. ${action}`).join('\n');
};

const findProtocolProbeRow = (summary, key) => summary?.rows?.find((row) => row.key === key) || null;

const formatGateCheck = (label, status, evidence, next = '') =>
  `  ${label}: ${status}${evidence ? ` evidence=${evidence}` : ''}${next ? ` next=${next}` : ''}`;

const hasDeviceInfoValue = (value) => {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  return !new Set([
    '-',
    '--',
    '\u672a\u8bfb\u53d6',
    '\u672a\u8fd4\u56de',
    '\u8bfb\u53d6\u5931\u8d25',
    '\u8bfb\u53d6\u8bbe\u5907\u4fe1\u606f\u5931\u8d25',
    '\u5f85\u8bfb\u53d6',
    '\u7b49\u5f85\u8fd4\u56de',
    '\u8bbe\u5907\u672a\u8fd4\u56de',
    '\u8bbe\u5907\u672a\u8fd4\u56de\u771f\u5b9e\u6570\u636e'
  ]).has(text);
};

const getDevicePageInfoEvidence = (deviceEvents = []) => {
  const batteryEvents = deviceEvents.filter((event) => event.event === 'battery-read-result' || event.event === 'device-info-refresh-result');
  const versionEvents = deviceEvents.filter((event) => event.event === 'version-read-result' || event.event === 'device-info-refresh-result');
  const latestBattery = [...batteryEvents].reverse().find((event) => {
    const details = getObjectDetails(event.details);
    const snapshot = getObjectDetails(details.snapshot);
    return hasDeviceInfoValue(details.value) || hasDeviceInfoValue(snapshot.batteryText);
  });
  const latestFirmware = [...versionEvents].reverse().find((event) => {
    const details = getObjectDetails(event.details);
    const snapshot = getObjectDetails(details.snapshot);
    return (
      hasDeviceInfoValue(details.firmware) ||
      hasDeviceInfoValue(details.firmwareVersion) ||
      hasDeviceInfoValue(snapshot.firmwareText)
    );
  });
  const latestSoftware = [...versionEvents].reverse().find((event) => {
    const details = getObjectDetails(event.details);
    const snapshot = getObjectDetails(details.snapshot);
    return (
      hasDeviceInfoValue(details.software) ||
      hasDeviceInfoValue(details.softwareVersion) ||
      hasDeviceInfoValue(details.uiVersion) ||
      hasDeviceInfoValue(snapshot.softwareText)
    );
  });

  return {
    batteryOk: Boolean(latestBattery),
    firmwareOk: Boolean(latestFirmware),
    softwareOk: Boolean(latestSoftware),
    batteryLine: latestBattery?.line || '',
    firmwareLine: latestFirmware?.line || '',
    softwareLine: latestSoftware?.line || ''
  };
};

const isRwL19AcceptanceOkValue = (value) => value === true || value === 'true';

const normalizeRwL19AcceptanceHistoryType = (value) => {
  const key = String(value || '').replace(/^history:/, '').trim();
  return RW_L19_ACCEPTANCE_HISTORY_KEY_MAP[key] || normalizeExpectedHistoryName(key)[0] || key;
};

const getRwL19AcceptanceEvidence = (events = []) => {
  const stepResults = new Map();
  const summaries = events.filter((event) => event.event === 'rw-l19-acceptance-summary' || event.event === 'diagnostic-acceptance-report');
  const starts = events.filter((event) => event.event === 'rw-l19-acceptance-start');
  const latestSummary = summaries[summaries.length - 1] || null;
  const latestStart = starts[starts.length - 1] || null;
  const summary = getObjectDetails(latestSummary?.details);
  const failedItems = Array.isArray(summary.failed) ? summary.failed : [];
  const summaryResults = Array.isArray(summary.results) ? summary.results : [];
  const failedKeys = new Set(failedItems.map((item) => String(item?.key || '').trim()).filter(Boolean));
  const summaryStepCount = toCount(summary.stepCount);
  const summaryOkCount = toCount(summary.okCount);
  const summaryFailedCount = toCount(summary.failedCount);
  const expectedStepCount = RW_L19_ACCEPTANCE_EXPECTED_KEYS.length;
  const summaryAllPassed = Boolean(
    latestSummary &&
      summaryStepCount >= expectedStepCount &&
      summaryOkCount >= expectedStepCount &&
      summaryFailedCount === 0
  );

  for (const event of events) {
    if (event.event !== 'rw-l19-acceptance-step-result' && event.event !== 'rw-l19-acceptance-step-failed') continue;
    const details = getObjectDetails(event.details);
    const key = String(details.key || '').trim();
    if (!key) continue;
    const result = getObjectDetails(details.result);
    stepResults.set(key, {
      key,
      line: event.line,
      time: event.time,
      ok: isRwL19AcceptanceOkValue(details.ok) || isRwL19AcceptanceOkValue(result.ok),
      details,
      result,
      source: 'step'
    });
  }

  for (const item of summaryResults) {
    const details = getObjectDetails(item);
    const key = String(details.key || '').trim();
    if (!key || stepResults.has(key)) continue;
    stepResults.set(key, {
      key,
      line: latestSummary?.line || '',
      time: latestSummary?.time || '',
      ok: isRwL19AcceptanceOkValue(details.ok),
      details,
      result: details,
      source: 'summary-results'
    });
  }

  if (summaryAllPassed) {
    for (const key of RW_L19_ACCEPTANCE_EXPECTED_KEYS) {
      if (stepResults.has(key)) continue;
      stepResults.set(key, {
        key,
        line: latestSummary.line,
        time: latestSummary.time,
        ok: true,
        details: summary,
        result: {},
        source: 'summary'
      });
    }
  } else if (failedKeys.size > 0) {
    for (const failed of failedItems) {
      const key = String(failed?.key || '').trim();
      if (!key || stepResults.has(key)) continue;
      stepResults.set(key, {
        key,
        line: latestSummary?.line || '',
        time: latestSummary?.time || '',
        ok: false,
        details: failed,
        result: getObjectDetails(failed?.result),
        source: 'summary'
      });
    }
  }

  const metrics = new Map();
  const histories = new Map();
  for (const step of stepResults.values()) {
    if (step.key.startsWith('metric:')) {
      const name = normalizeExpectedMetricName(step.key.slice('metric:'.length));
      if (!name) continue;
      const value = firstDefined(step.result?.value, step.details?.value);
      metrics.set(name, {
        name,
        ok: step.ok,
        value,
        line: step.line,
        source: step.source,
        key: step.key
      });
    } else if (step.key.startsWith('history:')) {
      const historyKey = step.key.slice('history:'.length);
      const type = normalizeRwL19AcceptanceHistoryType(historyKey);
      const summaryDetails = getObjectDetails(step.result?.summary);
      const recordCount = firstDefined(step.result?.recordCount, summaryDetails.recordCount, step.details?.recordCount);
      const rawRecordCount = firstDefined(summaryDetails.rawRecordCount, summaryDetails.recordCount, recordCount);
      const submitRecordCount = firstDefined(summaryDetails.submitRecordCount, summaryDetails.recordCount);
      const uploaded = firstDefined(summaryDetails.uploaded, step.result?.uploaded, step.details?.uploaded);
      histories.set(type, {
        type,
        ok: step.ok,
        recordCount,
        rawRecordCount,
        submitRecordCount,
        uploaded,
        line: step.line,
        source: step.source,
        key: step.key
      });
    }
  }

  const coreStep = stepResults.get('core-protocol') || null;
  const coreResult = {
    ...getObjectDetails(coreStep?.details),
    ...getObjectDetails(coreStep?.result)
  };
  const coreProtocol = coreStep
    ? {
        ok: coreStep.ok,
        line: coreStep.line,
        source: coreStep.source,
        requiredOkCount: coreResult.requiredOkCount,
        requiredCommandCount: coreResult.requiredCommandCount,
        requiredFailedCount: coreResult.requiredFailedCount
      }
    : null;

  return {
    events,
    starts,
    summaries,
    latestStart,
    latestSummary,
    summary,
    summaryAllPassed,
    stepResults,
    metrics,
    histories,
    coreProtocol
  };
};

const mergeRwL19AcceptanceMetricChecks = (checks, acceptanceEvidence) =>
  checks.map((check) => {
    const metric = acceptanceEvidence.metrics.get(check.name);
    if (!metric) return check;
    const merged = {
      ...check,
      flowStatus: check.flowStatus === 'hit' ? check.flowStatus : 'acceptance',
      value: firstDefined(check.value, metric.value),
      line: check.line || metric.line,
      source: check.source || 'RW MINE',
      acceptance: true
    };
    if (!metric.ok) {
      return {
        ...merged,
        ok: false,
        status: 'FAIL',
        problems: [...new Set([...(check.problems || []), 'acceptance-failed'])]
      };
    }
    return {
      ...merged,
      ok: true,
      status: 'PASS',
      hitCount: Math.max(check.hitCount || 0, 1),
      problems: []
    };
  });

const mergeRwL19AcceptanceHistoryChecks = (checks, acceptanceEvidence) =>
  checks.map((check) => {
    const accepted = acceptanceEvidence.histories.get(check.type) || acceptanceEvidence.histories.get(normalizeRwL19AcceptanceHistoryType(check.type));
    if (!accepted) return check;
    const recordCount = firstDefined(check.recordCount, accepted.recordCount);
    const rawRecordCount = firstDefined(check.rawRecordCount, accepted.rawRecordCount, recordCount);
    const submitRecordCount = firstDefined(check.submitRecordCount, accepted.submitRecordCount);
    const uploaded = firstDefined(check.uploaded, accepted.uploaded);
    const merged = {
      ...check,
      recordCount,
      rawRecordCount,
      submitRecordCount,
      uploaded,
      latestLine: check.latestLine || accepted.line,
      acceptance: true
    };
    if (!accepted.ok) {
      return {
        ...merged,
        ok: false,
        status: 'FAIL',
        problems: [...new Set([...(check.problems || []), 'acceptance-failed'])]
      };
    }
    return {
      ...merged,
      ok: true,
      status: 'PASS',
      manualSyncResults: Math.max(check.manualSyncResults || 0, 1),
      problems: []
    };
  });
const getRwL19GateStatus = ({ hasBuildTag, hasStaleBuildTag, protocolProbeSummary, goalMetricChecks, goalHistoryChecks }) => {
  if (!hasBuildTag || hasStaleBuildTag) return 'NOT_PROVEN';
  if (protocolProbeSummary?.status === 'failed') return 'FAIL';
  if (goalMetricChecks.some((check) => !check.ok) || goalHistoryChecks.some((check) => !check.ok)) return 'NOT_PROVEN';
  return 'PASS';
};

const formatRwL19Gate = ({
  hasBuildTag,
  hasStaleBuildTag,
  connectionSnapshotSummary,
  connectStageSummary,
  protocolProbeSummary,
  goalMetricChecks,
  goalHistoryChecks,
  batteryMetricCount,
  deviceEvents,
  diagnosticCopyIncompleteCount,
  acceptanceEvidence = getRwL19AcceptanceEvidence([])
}) => {
  const batteryRow = findProtocolProbeRow(protocolProbeSummary, 'battery/read');
  const firmwareRow = findProtocolProbeRow(protocolProbeSummary, 'firmware/read');
  const devicePageEvidence = getDevicePageInfoEvidence(deviceEvents);
  const requiredFailed = protocolProbeSummary?.requiredFailedRows || [];
  const requiredCount = protocolProbeSummary?.requiredCommandCount || 0;
  const requiredOk = protocolProbeSummary?.requiredOkCount || 0;
  const acceptanceCore = acceptanceEvidence.coreProtocol || null;
  const acceptanceCoreOk = acceptanceCore?.ok === true;
  const connectionReady = connectionSnapshotSummary?.verdict === 'ready' || connectStageSummary?.stage === 'ble-ready';
  const batteryOk = batteryMetricCount > 0 || batteryRow?.status === 'response' || devicePageEvidence.batteryOk || acceptanceCoreOk;
  const protocolFirmwareOk =
    firmwareRow?.status === 'response' &&
    (
      hasDeviceInfoValue(firmwareRow.firmwareValue) ||
      hasDeviceInfoValue(firmwareRow.hardwareValue) ||
      (firmwareRow.parsedType === 'hardwareVersion' && hasDeviceInfoValue(firmwareRow.parsedValue))
    );
  const protocolSoftwareOk =
    firmwareRow?.status === 'response' &&
    (
      hasDeviceInfoValue(firmwareRow.softwareValue) ||
      hasDeviceInfoValue(firmwareRow.uiValue) ||
      (firmwareRow.parsedType === 'softwareVersion' && hasDeviceInfoValue(firmwareRow.parsedValue))
    );
  const firmwareOk = protocolFirmwareOk || devicePageEvidence.firmwareOk || acceptanceCoreOk;
  const softwareOk = protocolSoftwareOk || devicePageEvidence.softwareOk || acceptanceCoreOk;
  const protocolOk =
    acceptanceCoreOk ||
    (
      !protocolProbeSummary?.truncated &&
      requiredCount > 0 &&
      requiredFailed.length === 0 &&
      ['passed', 'optional-failed'].includes(protocolProbeSummary?.status)
    );
  const realtimeOk = goalMetricChecks.length > 0 && goalMetricChecks.every((check) => check.ok);
  const historyOk = goalHistoryChecks.length > 0 && goalHistoryChecks.every((check) => check.ok);
  const overall = [
    !hasBuildTag || hasStaleBuildTag ? 'NOT_PROVEN' : null,
    !connectionReady ? 'NOT_PROVEN' : null,
    !batteryOk || !firmwareOk || !softwareOk ? 'NOT_PROVEN' : null,
    !protocolOk ? (protocolProbeSummary?.status === 'failed' ? 'FAIL' : 'NOT_PROVEN') : null,
    !realtimeOk ? 'NOT_PROVEN' : null,
    !historyOk ? 'NOT_PROVEN' : null
  ].find(Boolean) || getRwL19GateStatus({ hasBuildTag, hasStaleBuildTag, protocolProbeSummary, goalMetricChecks, goalHistoryChecks });
  const failedRequired = requiredFailed.map((row) => `${row.key}:${row.status}`).join(',') || '-';
  const realtimeEvidence = goalMetricChecks
    .map((check) => `${check.name}=${check.status}${check.value !== undefined && check.value !== null ? `(${check.value})` : ''}`)
    .join(',');
  const historyEvidence = goalHistoryChecks
    .map((check) => `${check.type}=${check.status}${check.recordCount != null ? `(${check.recordCount})` : ''}`)
    .join(',');
  const deviceInfoEvidence = [
    `battery=${batteryOk ? 'ok' : 'missing'}${devicePageEvidence.batteryLine ? `@L${devicePageEvidence.batteryLine}` : ''}`,
    `firmware=${firmwareOk ? 'ok' : 'missing'}${devicePageEvidence.firmwareLine ? `@L${devicePageEvidence.firmwareLine}` : ''}`,
    `software=${softwareOk ? 'ok' : 'missing'}${devicePageEvidence.softwareLine ? `@L${devicePageEvidence.softwareLine}` : ''}`
  ].join(' ') + (acceptanceCoreOk ? ` acceptanceCore@L${acceptanceCore.line || '-'}` : '');

  return [
    `  overall: ${overall}`,
    formatGateCheck(
      'build',
      hasBuildTag && !hasStaleBuildTag ? 'PASS' : 'NOT_PROVEN',
      hasBuildTag ? expectedBuildTag : 'missing',
      hasStaleBuildTag ? `retest with ${expectedBuildTag}` : ''
    ),
    formatGateCheck(
      'connection',
      connectionReady ? 'PASS' : 'NOT_PROVEN',
      `${connectionSnapshotSummary?.verdict || 'no-snapshot'}/${connectStageSummary?.stage || 'no-stage'}`,
      connectionReady ? '' : 'copy Mine diagnostics after SY03 is connected and ready'
    ),
    formatGateCheck(
      'device-info',
      batteryOk && firmwareOk && softwareOk ? 'PASS' : 'NOT_PROVEN',
      deviceInfoEvidence,
      batteryOk && firmwareOk && softwareOk ? '' : 'run core protocol self-test or device info read'
    ),
    formatGateCheck(
      'core-protocol',
      protocolOk ? 'PASS' : protocolProbeSummary?.status === 'failed' ? 'FAIL' : 'NOT_PROVEN',
      acceptanceCoreOk
        ? `acceptanceCore@L${acceptanceCore.line || '-'} required=${acceptanceCore.requiredOkCount ?? '-'}/${acceptanceCore.requiredCommandCount ?? '-'} failed=${acceptanceCore.requiredFailedCount ?? 0}`
        : `required=${requiredOk}/${requiredCount} failed=${failedRequired}${protocolProbeSummary?.truncated ? ' truncated=true' : ''}`,
      protocolProbeSummary?.truncated || diagnosticCopyIncompleteCount > 0 ? 'copy after full self-test summary appears' : ''
    ),
    formatGateCheck(
      'realtime-heart-spo2',
      realtimeOk ? 'PASS' : 'NOT_PROVEN',
      realtimeEvidence || 'no-checks',
      realtimeOk ? '' : 'measure heart_rate and blood_oxygen from the page'
    ),
    formatGateCheck(
      'business-history-upload',
      historyOk ? 'PASS' : 'NOT_PROVEN',
      historyEvidence || 'no-checks',
      historyOk ? '' : 'open sleep/activity/stress/vital pages and copy Mine logs'
    )
  ].join('\n');
};
const main = () => {
  if (unknownExpectedMetricNames.length > 0) {
    throw new Error(`Unknown --expect-metric value(s): ${unknownExpectedMetricNames.join(', ')}`);
  }
  if (unknownExpectedHistoryNames.length > 0) {
    throw new Error(`Unknown --expect-history value(s): ${unknownExpectedHistoryNames.join(', ')}`);
  }

  const text = readInput();
  const result = analyze(text);
  const maxPendingWaiters = result.pendingWaiters.length ? Math.max(...result.pendingWaiters) : 0;
  const hasOldLinks = result.oldLinkLines.length > 0;
  const hasBuildTag = result.buildTagLines.length > 0;
  const hasStaleBuildTag = result.staleBuildTagLines.length > 0;
  const hasHistoricalStaleBuildTag = result.historicalStaleBuildTagLines.length > 0;
  const hasPageWaitHit = (result.pageEventCounts.get('single-metric-wait-hit') || 0) > 0;
  const hasDirectHit = (result.pageEventCounts.get('single-metric-direct-hit') || 0) > 0;
  const hasDiagnosticLogHit =
    (result.pageEventCounts.get('single-metric-diagnostic-log-hit') || 0) > 0 ||
    (result.pageEventCounts.get('manual-metric-result') || 0) > 0;
  const hasWaitCacheHit = result.waitCacheHits.length > 0;
  const hasWaitHit = hasPageWaitHit || hasDirectHit || hasDiagnosticLogHit;
  const hasWaitTimeout = (result.pageEventCounts.get('single-metric-wait-timeout') || 0) > 0;
  const hasPageMetricFailure =
    (result.pageEventCounts.get('single-metric-failed') || 0) > 0 ||
    (result.pageEventCounts.get('manual-metric-failed') || 0) > 0;
  const pageMetricFlowStatuses = result.pageMetricFlows.map((flow) => `${getPageMetricFlowLabel(flow)}:${getPageMetricFlowStatus(flow)}`);
  const hasMetricKeyMismatch = result.metricKeyChecks.mismatches.length > 0;
  const hasRealtimeHit = hasExpectedRealtimeHit(result.metricKeyChecks);
  const historySyncSummary = getHistorySyncSummary(result.historyEvents);
  const realtimeCommandEvents = result.rwCommandEvents.filter((event) => event.kind === 'realtime-read' || event.kind === 'realtime-control');
  const realtimeCommandBurst = getMaxCommandBurst(realtimeCommandEvents, 30000);
  const hasBleDisconnects = result.disconnectEvents.length > 0;
  const ignoredDisconnectReasons = [
    ...new Set(result.ignoredDisconnectEvents.map((event) => event.details?.reason).filter(Boolean))
  ];
  const restoreTimeoutFound = result.restoreEvents.some((event) => event.event === 'restore-timeout');
  const reconnectCandidateEvents = result.reconnectEvents.filter((event) => event.event === 'reconnect-scan-candidate');
  const latestReconnectCandidateEvent = reconnectCandidateEvents[reconnectCandidateEvents.length - 1] || null;
  const latestReconnectCandidateMissing = Boolean(
    latestReconnectCandidateEvent &&
      (latestReconnectCandidateEvent.details?.found === false || latestReconnectCandidateEvent.details?.found === 'false')
  );
  const reconnectCandidateFound = reconnectCandidateEvents.some((event) => event.details?.found === true || event.details?.found === 'true');
  const scanFoundCount = result.scanEvents.filter((event) => event.event === 'scan-found').length;
  const connectionSnapshotSummary = getConnectionSnapshotSummary(result.diagnosticSnapshots);
  const connectStageSummary = summarizeConnectStage({
    connectEvents: result.connectEvents,
    reconnectEvents: result.reconnectEvents,
    scanEvents: result.scanEvents,
    restoreEvents: result.restoreEvents,
    snapshots: result.diagnosticSnapshots
  });
  const hasReadyConnectionEvidence =
    connectionSnapshotSummary.verdict === 'ready' ||
    connectStageSummary.stage === 'ble-ready' ||
    result.connectEvents.some((event) => event.event === 'notify-primary-enabled');
  const reconnectCandidateMissing =
    latestReconnectCandidateMissing && !reconnectCandidateFound && !hasReadyConnectionEvidence;
  const connectFailureFound =
    result.connectEvents.some((event) =>
      ['connect-fail', 'connect-discover-fail', 'connect-attempt-error', 'connect-timeout', 'connect-not-ready'].includes(event.event)
    ) ||
    result.reconnectEvents.some((event) => event.event === 'reconnect-connect-result' && (event.details?.success === false || event.details?.success === 'false'));
  const disconnectDuringMeasurement =
    hasBleDisconnects &&
    (hasWaitTimeout || hasPageMetricFailure || (result.pageEventCounts.get('single-metric-disconnected') || 0) > 0);
  const acceptanceEvidence = getRwL19AcceptanceEvidence(result.acceptanceEvents);
  const expectedMetricChecks = mergeRwL19AcceptanceMetricChecks(
    getExpectedMetricChecks(result, expectedMetricNames, { hasBuildTag, hasStaleBuildTag }),
    acceptanceEvidence
  );
  const expectedMetricFailures = expectedMetricChecks.filter((check) => !check.ok);
  const expectedHistoryChecks = mergeRwL19AcceptanceHistoryChecks(
    getExpectedHistoryChecks(result, expectedHistoryTypes, { hasBuildTag, hasStaleBuildTag }),
    acceptanceEvidence
  );
  const expectedHistoryFailures = expectedHistoryChecks.filter((check) => !check.ok);
  const goalMetricChecks = mergeRwL19AcceptanceMetricChecks(
    getExpectedMetricChecks(result, RW_L19_GATE_METRICS, { hasBuildTag, hasStaleBuildTag }),
    acceptanceEvidence
  );
  const goalHistoryChecks = mergeRwL19AcceptanceHistoryChecks(
    getExpectedHistoryChecks(result, RW_L19_GATE_HISTORIES, { hasBuildTag, hasStaleBuildTag }),
    acceptanceEvidence
  );
  const protocolProbeSummary = getProtocolProbeSummary(result.protocolProbeEvents);
  const diagnosticCopyIncompleteCount = result.diagnosticCopyIncompleteEvents.length;

  console.log('RW BLE log analysis');
  console.log(`input: ${inputPath ? path.resolve(inputPath) : 'stdin'}`);
  console.log(`lines: ${result.entries.length}`);
  console.log(`expectedBuildTag: ${expectedBuildTag}`);
  if (expectedMetricNames.length > 0) console.log(`expectMetric: ${expectedMetricNames.join(',')}`);
  if (expectedHistoryTypes.length > 0) console.log(`expectHistory: ${expectedHistoryTypes.join(',')}`);

  printSection(
    'Verdict',
    [
      `  expected-metric-checks: ${
        expectedMetricNames.length === 0
          ? 'not requested'
          : expectedMetricFailures.length === 0
            ? 'PASS'
            : `FAIL (${expectedMetricFailures.map((check) => check.name).join(',')})`
      }`,
      `  expected-history-checks: ${
        expectedHistoryTypes.length === 0
          ? 'not requested'
          : expectedHistoryFailures.length === 0
            ? 'PASS'
            : `FAIL (${expectedHistoryFailures.map((check) => check.type).join(',')})`
      }`,
      `  latest-build-marker: ${hasBuildTag ? 'FOUND' : 'MISSING'}`,
      `  stale-build-marker: ${hasStaleBuildTag ? `FOUND (${result.staleBuildTagLines.length})` : 'not found'}`,
      `  historical-stale-build-marker: ${hasHistoricalStaleBuildTag ? `FOUND (${result.historicalStaleBuildTagLines.length})` : 'not found'}`,
      `  old-routes: ${hasOldLinks ? `FOUND (${result.oldLinkLines.length})` : 'not found'}`,
      `  realtime-key-mismatch: ${hasMetricKeyMismatch ? `FOUND (${result.metricKeyChecks.mismatches.length})` : 'not found'}`,
      `  expected-realtime-hit: ${hasRealtimeHit ? 'FOUND' : 'not found'}`,
      `  realtime-ack-only: ${result.realtimeAckOnly.length > 0 ? `FOUND (${result.realtimeAckOnly.map((item) => item.name).join(',')})` : 'not found'}`,
      `  battery-rx: ${result.batteryMetrics.length > 0 ? `FOUND (${result.batteryMetrics.length})` : 'not found'}`,
      `  page-battery-failed-after-rx: ${result.batteryPageFailedAfterRx ? 'FOUND' : 'not found'}`,
      `  page-wait-hit: ${hasPageWaitHit ? 'FOUND' : 'not found'}`,
      `  page-direct-hit: ${hasDirectHit ? 'FOUND' : 'not found'}`,
      `  page-diagnostic-log-hit: ${hasDiagnosticLogHit ? 'FOUND' : 'not found'}`,
      `  ble-wait-cache-hit: ${hasWaitCacheHit ? `FOUND (${result.waitCacheHits.length})` : 'not found'}`,
      `  page-wait-timeout: ${hasWaitTimeout ? 'FOUND' : 'not found'}`,
      `  page-metric-failed: ${hasPageMetricFailure ? 'FOUND' : 'not found'}`,
      `  page-foreground-measurements: ${pageMetricFlowStatuses.length > 0 ? pageMetricFlowStatuses.join(',') : 'not found'}`,
      `  ble-disconnects: ${hasBleDisconnects ? `FOUND (${result.disconnectEvents.length})` : 'not found'}`,
      `  ignored-ble-disconnects: ${result.ignoredDisconnectEvents.length > 0 ? `FOUND (${result.ignoredDisconnectEvents.length})` : 'not found'}`,
      `  disconnect-during-measurement: ${disconnectDuringMeasurement ? 'FOUND' : 'not found'}`,
      `  restore-timeout: ${restoreTimeoutFound ? 'FOUND' : 'not found'}`,
      `  reconnect-candidate: ${reconnectCandidateFound ? 'FOUND' : reconnectCandidateMissing ? 'MISSING' : 'not found'}`,
      `  scan-found-events: ${scanFoundCount}`,
      `  reconnect-events: ${result.reconnectEvents.length}`,
      `  connect-events: ${result.connectEvents.length}`,
      `  connect-stage: ${connectStageSummary.stage}`,
      `  connect-failure: ${connectFailureFound ? 'FOUND' : 'not found'}`,
      `  connection-snapshot: ${connectionSnapshotSummary.verdict}`,
      `  diagnostic-snapshots: ${result.diagnosticSnapshots.length}`,
      `  diagnostic-copy-incomplete: ${diagnosticCopyIncompleteCount > 0 ? `FOUND (${diagnosticCopyIncompleteCount})` : 'not found'}`,
      `  protocol-probe: ${protocolProbeSummary.status}${
        result.protocolProbeEvents.length > 0
          ? ` required=${protocolProbeSummary.requiredOkCount ?? '-'}/${protocolProbeSummary.requiredCommandCount ?? '-'} requiredFailed=${protocolProbeSummary.requiredFailedCount ?? '-'} optionalNoResponse=${protocolProbeSummary.optionalFailedCount ?? '-'} total=${protocolProbeSummary.commandCount ?? '-'}`
          : ''
      }`,
      `  history-sync: ${historySyncSummary.status}`,
      `  rw-realtime-command-count: ${realtimeCommandEvents.length}`,
      `  max-rw-realtime-commands-30s: ${realtimeCommandBurst.max}`,
      `  rw-history-command-count: ${result.rwHistoryCommandEvents.length}`,
      `  max-pending-waiters: ${maxPendingWaiters}`
    ].join('\n')
  );
  printSection(
    'RW/L19 Gate',
    formatRwL19Gate({
      hasBuildTag,
      hasStaleBuildTag,
      connectionSnapshotSummary,
      connectStageSummary,
      protocolProbeSummary,
      goalMetricChecks,
      goalHistoryChecks,
      batteryMetricCount: result.batteryMetrics.length,
      deviceEvents: result.deviceEvents,
      diagnosticCopyIncompleteCount,
      acceptanceEvidence
    })
  );
  printSection(
    'Next Actions',
    formatNextActions({
      hasBuildTag,
      hasStaleBuildTag,
      hasOldLinks,
      hasMetricKeyMismatch,
      hasWaitHit,
      hasWaitTimeout,
      hasPageMetricFailure,
      hasRealtimeHit,
      realtimeAckOnly: result.realtimeAckOnly,
      batteryMetricCount: result.batteryMetrics.length,
      batteryPageFailedAfterRx: result.batteryPageFailedAfterRx,
      maxPendingWaiters,
      realtimeCommandCount: realtimeCommandEvents.length,
      maxRealtimeCommandsIn30s: realtimeCommandBurst.max,
      historyCommandCount: result.rwHistoryCommandEvents.length,
      historyEvents: result.historyEvents,
      disconnectDuringMeasurement,
      ignoredDisconnectCount: result.ignoredDisconnectEvents.length,
      ignoredDisconnectReasons,
      pageMetricFlows: result.pageMetricFlows,
      restoreTimeoutFound,
      reconnectCandidateMissing,
      reconnectCandidateFound,
      connectFailureFound,
      connectEventCount: result.connectEvents.length,
      reconnectEventCount: result.reconnectEvents.length,
      deviceEvents: result.deviceEvents,
      scanFoundCount,
      bleDisconnectCount: result.disconnectEvents.length,
      connectionSnapshotSummary,
      connectStageSummary,
      protocolProbeSummary,
      diagnosticCopyIncompleteEvents: result.diagnosticCopyIncompleteEvents
    })
  );

  printSection('RW/L19 Acceptance', formatRwL19Acceptance(result.acceptanceEvents));
  printSection('Expected Metric Checks', formatExpectedMetricChecks(expectedMetricChecks));
  printSection('Expected History Checks', formatExpectedHistoryChecks(expectedHistoryChecks));
  printSection('Sources', formatMap(result.sourceCounts));
  printSection('Top Events', formatMap(result.eventCounts, 20));
  printSection('Tx Labels', formatMap(result.txLabelCounts, 30));
  printSection('RW Realtime Commands', formatMap(result.rwRealtimeCommandCounts, 30));
  printSection('RW Realtime Command Burst', formatCommandEvents(realtimeCommandBurst.window));
  printSection('BLE Disconnects', formatDisconnectEvents(result.disconnectEvents));
  printSection('Ignored BLE Disconnects', formatDisconnectEvents(result.ignoredDisconnectEvents));
  printSection('Restore Events', formatDiagnosticEvents(result.restoreEvents));
  printSection('Reconnect Events', formatDiagnosticEvents(result.reconnectEvents));
  printSection('Scan Events', formatDiagnosticEvents(result.scanEvents));
  printSection('Connect Events', formatDiagnosticEvents(result.connectEvents));
  printSection('Device Page Events', formatDiagnosticEvents(result.deviceEvents));
  printSection('Connect Stage', formatConnectStageSummary(connectStageSummary));
  printSection('Connection Snapshots', formatConnectionSnapshots(result.diagnosticSnapshots));
  printSection('Incomplete Diagnostic Copies', formatDiagnosticEvents(result.diagnosticCopyIncompleteEvents));
  printSection('RW History Commands', formatCommandEvents(result.rwHistoryCommandEvents));
  printSection('Requested Metrics', formatMap(result.requestedMetrics, 20));
  printSection('Realtime Metrics', formatMetricSummary(result.metricSummary));
  printSection('Realtime Key Check', formatMetricKeyChecks(result.metricKeyChecks));
  printSection('Realtime Control ACK Only', formatRealtimeAckOnly(result.realtimeAckOnly));
  printSection('Realtime Key Mismatches', formatMetricMismatches(result.metricKeyChecks.mismatches));
  printSection('Pending Metrics', formatMap(result.pendingMetrics, 20));
  printSection('Page Foreground Measurements', formatPageMetricFlows(result.pageMetricFlows));
  printSection('Page Events', formatPageEvents(result.pageEvents));
  printSection('Protocol Probe', formatProtocolProbeSummary(result.protocolProbeEvents));
  printSection('History Wait Windows', formatHistoryWaitWindows(result.historyEvents));
  printSection('History Sync', formatHistorySync(result.historyEvents));

  if (result.staleBuildTagLines.length > 0) {
    printSection(
      'Current Stale Build Tag Lines',
      result.staleBuildTagLines
        .slice(0, 20)
        .map((entry) => `  L${entry.lineNumber} ${entry.raw}`)
        .join('\n')
    );
  }

  if (result.historicalStaleBuildTagLines.length > 0) {
    printSection(
      'Historical Stale Build Tag Lines',
      result.historicalStaleBuildTagLines
        .slice(-20)
        .map((entry) => `  L${entry.lineNumber} ${entry.raw}`)
        .join('\n')
    );
  }

  if (result.oldLinkLines.length > 0) {
    printSection(
      'Old Route Lines',
      result.oldLinkLines
        .slice(0, 20)
        .map((entry) => `  L${entry.lineNumber} ${entry.raw}`)
        .join('\n')
    );
  }

  if (result.waitTimeouts.length > 0) {
    printSection(
      'Wait Timeouts',
      result.waitTimeouts
        .slice(-20)
        .map((item) => `  L${item.line} timeoutMs=${item.timeoutMs} pendingWaiters=${item.pendingWaiters}`)
        .join('\n')
    );
  }

  if (failOnExpectedMetricMismatch && (expectedMetricFailures.length > 0 || expectedHistoryFailures.length > 0)) {
    process.exitCode = 2;
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}












