#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXPECTED_BUILD_TAG = 'rw-visible-build-tag-20260720-358';
const ANY_BUILD_TAG_RE = /rw-visible-build-tag-\d{8}-\d+/g;
const root = process.cwd();
const skipDist = process.argv.includes('--skip-dist');
const failures = [];

const read = (file) => {
  const full = join(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing`);
    return '';
  }
  return readFileSync(full, 'utf8');
};

const assertIncludes = (file, terms, reason) => {
  const source = read(file);
  for (const term of terms) {
    if (!source.includes(term)) failures.push(`${file}: missing ${JSON.stringify(term)}${reason ? ` (${reason})` : ''}`);
  }
};

const assertNotIncludes = (file, terms, reason) => {
  const source = read(file);
  for (const term of terms) {
    if (source.includes(term)) failures.push(`${file}: unexpected ${JSON.stringify(term)}${reason ? ` (${reason})` : ''}`);
  }
};

const assertNoReplacementCharacters = (dir) => {
  for (const file of walk(dir)) {
    if (!/\.(vue|ts|js)$/.test(file) || file.endsWith('.parity.ts')) continue;
    const source = read(file);
    if (source.includes('\uFFFD')) failures.push(`${file}: contains invalid UTF-8 replacement character`);
  }
};

const assertNoVisibleMojibake = (files) => {
  const mojibakePatterns = [
    /[\uE000-\uF8FF\uFFFD]/u,
    /(?:\u9366|\u93c8|\u7481|\u9422|\u7e51|\u934a|\u95bc|\ue1c8|\u9359|\u70d8|\u5abe|\u93b8|\u4ff1|\u95ab|\u7f01|\u6d93)/u,
    /[\u95bb\u95c1\u6fe0\u7dd7]/u
  ];
  for (const file of files) {
    const source = read(file);
    if (mojibakePatterns.some((pattern) => pattern.test(source))) {
      failures.push(`${file}: contains likely visible mojibake text`);
    }
  }
};

const walk = (dir, result = []) => {
  const full = join(root, dir);
  if (!existsSync(full)) return result;
  for (const name of readdirSync(full)) {
    const file = join(full, name);
    const rel = relative(root, file).replace(/\\/g, '/');
    if (rel.includes('/node_modules/') || rel.includes('/dist/') || rel.includes('/.npm-cache/')) continue;
    const stat = statSync(file);
    if (stat.isDirectory()) walk(rel, result);
    else result.push(rel);
  }
  return result;
};

const getPagesJsonRoutes = () => {
  try {
    const pagesJson = JSON.parse(read('src/pages.json'));
    const routes = [];
    for (const page of pagesJson.pages || []) {
      if (page?.path) routes.push(`${page.path}`.replace(/^\/+/, ''));
    }
    for (const subPackage of pagesJson.subPackages || []) {
      const rootPath = `${subPackage.root || ''}`.replace(/^\/+|\/+$/g, '');
      for (const page of subPackage.pages || []) {
        if (rootPath && page?.path) routes.push(`${rootPath}/${page.path}`.replace(/^\/+/, ''));
      }
    }
    return [...new Set(routes)];
  } catch (error) {
    failures.push(`src/pages.json: invalid JSON (${error?.message || error})`);
    return [];
  }
};

const assertRegisteredSourceRoutesExist = (routes) => {
  for (const route of routes) {
    if (!existsSync(join(root, 'src', `${route}.vue`))) {
      failures.push(`src/pages.json: registered route is missing source page src/${route}.vue`);
    }
  }
};

const assertBuiltRoutesExist = (routes) => {
  for (const route of routes) {
    for (const extension of ['js', 'json', 'wxml']) {
      if (!existsSync(join(root, 'dist', 'build', 'mp-weixin', `${route}.${extension}`))) {
        failures.push(`dist/build/mp-weixin: registered route is missing built artifact ${route}.${extension}`);
      }
    }
  }
};

const sourceFiles = walk('src');
const auditFiles = [...sourceFiles, ...walk('scripts')];
const pagesJsonRoutes = getPagesJsonRoutes();
assertRegisteredSourceRoutesExist(pagesJsonRoutes);

for (const rel of auditFiles) {
  if (!/\.(ts|vue|js|mjs|md|json)$/.test(rel)) continue;
  const tags = read(rel).match(ANY_BUILD_TAG_RE) || [];
  const stale = [...new Set(tags.filter((tag) => tag !== EXPECTED_BUILD_TAG))];
  if (stale.length > 0) failures.push(`${rel}: stale build tag(s): ${stale.join(', ')}`);
}

for (const rel of sourceFiles) {
  if (!/\.(ts|vue|js)$/.test(rel)) continue;
  const source = read(rel);
  if (!source.includes('qkeer:ring-diagnostic-logs')) continue;
  if (/DIAGNOSTIC_LOG_MAX_COUNT\s*=\s*220/.test(source)) {
    failures.push(`${rel}: shared RW diagnostic log writers must keep the 500-entry buffer`);
  }
}

assertIncludes('package.json', [
  '"verify:rw-backend-health": "node scripts/verify-rw-backend-health.mjs"',
  'npm run verify:ring-ble && npm run verify:rw-backend-health && npm run type-check',
  '"verify:rw-l19:release": "npm run verify:ring-ble:release"'
], 'release checks must expose and run backend Chinese health-text verification');

assertNoReplacementCharacters('src');
assertNoVisibleMojibake([
  'src/common/detailInfo.ts',
  'src/pages/health/health.vue',
  'src/pages/awareness/awareness.vue',
  'src/pages/mine/mine.vue',
  'src/pagesA/mines/device.vue',
  'src/homeDetail/sleepPage/sleepPage.vue',
  'src/homeDetail/exercise/exercise.vue',
  'src/homeDetail/relaxStatus/relaxStatus.vue',
  'src/homeDetail/vitalSigns/vitalSigns.vue',
  'src/sdk/ring-ble/rw/parser.ts',
  'src/composables/useRingHistoryUpload.ts',
  'src/composables/useRingBusinessHistoryPageSync.ts'
]);

assertNotIncludes('src/pages/mine/mine.vue', [
  '&gt;'
], 'mine menu arrows must render as icons/text from the component tree, not leaked HTML entities');

assertNotIncludes('src/pagesA/mines/device.vue', [
  '重新连接设备',
  '\u5237\u65b0\u72b6\u6001',
  '{{ lastActionText }}'
], 'device info page must stay on the original business layout instead of exposing diagnostic refresh states');

assertIncludes('src/pagesA/mines/device.vue', [
  '设置设备',
  '戒指查找',
  '解除绑定',
  '设备信息',
  '戒指大小',
  '设备版本',
  '固件版本',
  '\u5e8f\u5217\u53f7',
  '设备名称',
  'Mac地址'
], 'device info page must keep the original Chinese business labels');

assertNotIncludes('src/pagesA/mines/device.vue', [
  '<view>软件版本</view>',
  '<view>电量</view>',
  '<view>\u7535\u91cf\u72b6\u6001</view>'
], 'device info page must not expose extra RW diagnostic rows in the restored business layout');
assertIncludes('src/pagesA/mines/device.vue', [
  'DEVICE_INFO_SNAPSHOT_WAIT_MS = 12000',
  'waitForDeviceInfoSnapshot(startedAt, DEVICE_INFO_SNAPSHOT_WAIT_MS)'
], 'device info page must wait for late RW battery/version packets after the command returns');

assertIncludes('src/pagesA/mines/connectDevice.vue', [
  "appendRingDiagnosticLog('RW PAGE'",
  'connect-page-device-info-refresh-start',
  'refreshDeviceInfoData()'
], 'connect page must upload diagnostics and trigger a background RW battery/version refresh after pairing');

assertIncludes('src/pages/awareness/awareness.vue', [
  "appendRingDiagnosticLog('RW HOME'",
  'business-overview-request-success',
  'business-sync-refresh-overview-result',
  'getBalanceScore({ date }, getAwarenessSilentRequestConfig())'
], 'awareness page must upload RW homepage business API diagnostics and request balance score after sync');

assertNotIncludes('src/pages/awareness/awareness.vue', [
  "const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';"
], 'awareness diagnostics must use the shared uploader instead of local-only storage');

assertIncludes('src/pages/mine/mine.vue', [
  'const getMineBatterySourceValue',
  'for (let index = source.length - 1; index >= 0; index -= 1)',
  "if (type !== 'battery' && type !== 'firmware_version') continue;",
  'isValidMineBatteryValue(getMineBatterySourceValue(item))'
], 'mine page must display the latest valid RW battery packet instead of the first cached packet');

assertIncludes('scripts/verify-rw-backend-health.mjs', [
  'admin_fastapi',
  'scripts/check_health_text_response.py',
  'scripts/verify_rw_health_sync.py',
  'compileall',
  'backend_alias_contract_values',
  'health_raw_sleep_state_value',
  'rw_sleep_status_raw_values',
  'non_sleep_status_values',
  'nap_list',
  'rw_numeric_nap_response',
  'bloodPressureValue',
  'temperatureValue',
  'BackgroundTasks',
  'recalculate_sync_summaries',
  'calculate_summary=False',
  'summaryScheduled',
  'data_sync_summary',
  'algorithm_report\\(db',
  'Backend RW health text verification passed.'
], 'backend health-text verifier must cover English fallback, RW sync parity, fast upload return, display fallback, and Python compilation');

assertIncludes('src/features/ring/RingUnifiedHealthEntry.vue', [
  "normalizeHealthText(metrics.value.fatigue, '-')",
  "normalizeHealthText(metrics.value.anxiety, '-')"
], 'ring unified health entry must normalize fallback health text before display');

assertIncludes('scripts/verify-ring-ble-parser.mjs', [
  'ab010003020310',
  'ab010003020410',
  'ab010003050310',
  'ab010003050910'
], 'RW parser and analyzer smoke tests must preserve SY03 no-CRC core command evidence for battery, version, heart-rate, and SpO2');

assertIncludes('src/sdk/ring-ble/rw/protocol.ts', [
  'LastData = 0x70',
  'buildRwQkeerV2LastDataCommand'
], 'RW must expose QKeer V2 LastData command');

assertIncludes('src/sdk/ring-ble/rw/parser.ts', [
  'qkeer_v2_last_data',
  'parseRwQkeerV2LastDataRecord',
  'return currentDayRecords;',
  "'\u65f6\u95f4', '\u65e5\u671f', '\u8bb0\u5f55\u65f6\u95f4'",
  "'\u6b65\u6570'",
  "'\u8840\u6c27', '\u8840\u6c27\u9971\u548c\u5ea6'",
  "'\u6e29\u5ea6'",
  "'\u5fc3\u7387\u53d8\u5f02\u6027'",
  "'\u538b\u529b', '\u538b\u529b\u503c'",
  'normalizeRwBloodOxygenValue(data[4])',
  'normalizeRwBloodOxygenValue(data[1])',
  'parseRwQkeerV2NullableByte(payload[7], 70, 100)',
  'RwKey.BloodPressure',
  'RwKey.Temperature',
  'RwKey.AppRealTimeTemperature',
  'RwKey.BloodSugar',
  'mapQkeerV2SleepStatusToL19SleepState',
  'normalizeRwBloodPressureValue',
  'normalizeRwBloodSugarValue',
  'ab_activity_current_day_relative_hour',
  'current_day_key_relative_hour'
], 'RW parser must fix SpO2, parse LastData summary, map RW sleep stages to L19, and keep AB health history keys aligned with L19 metrics');

assertNotIncludes('src/sdk/ring-ble/rw/parser.ts', [
  "rawDataType: 'ab_activity_current_day_summary'",
  'getFirstValidRwStepCount'
], 'RW parser must not treat ambiguous ActivityCurrentDay leading bytes as today step totals');

assertIncludes('src/sdk/ring-ble/rw/history.ts', [
  'history/native-last-data',
  'history-native-last-data-fallback',
  'qkeer_v2_last_data',
  'eventStartTimestamp',
  'eventEndTimestamp',
  'startTimestamp: recordStartTimestamp',
  'endTimestamp: recordEndTimestamp'
], 'RW history must fallback to LastData and preserve upload event time boundaries');

assertIncludes('src/composables/useRingHistoryUpload.ts', [
  'if (unixTime) return formatUnixTime(unixTime);',
  'UNSAFE_STEP_SOURCE_TYPES',
  "'ab_activity_current_day_summary'",
  "'last_data'",
  "'qkeer_v2_last_data'",
  'isUnsafeHistoryStepSource',
  'getHistoryStepCountValue',
  'normalizeRwSleepStatusToL19State',
  'getSleepStateValue',
  'L19_SLEEP_STATE_TEXT',
  'startTime: sleepStartTime',
  'endTime: sleepEndTime',
  'dateRef: sleepDateRef',
  'normalizeDateRefValue'
], 'RW history upload must submit sleep start/end/dateRef fields and L19-compatible sleep states for backend sleep storage');

assertIncludes('src/composables/useRingHistoryUpload.parity.ts', [
  'unsafeSummaryStepSubmitRecords',
  'ab_activity_current_day_summary',
  'qkeer_v2_last_data',
  'RW summary/LastData step values should not be uploaded as historical step counts'
], 'RW upload parity must protect real-device false step values from summary/LastData sources');

assertIncludes('src/sdk/ring-ble/rw/history.ts', [
  'buildRwReadContinueKeyCommand',
  'getRwDiagnosticCommandLock',
  'shouldSkipRwHistoryCommandForDiagnosticLock',
  'history-command-skip-diagnostic-lock',
  'commandLabel',
  'RawSleep',
  'raw-sleep-history',
  'getRwAbHealthHistoryAttempts',
  "attempt: 'read-continue'",
  'history-ab-key-empty-stop',
  'history-ab-key-timeout-stop',
  'history-ab-key-empty-skip-legacy',
  'history-ab-key-skip-legacy-fallback',
  "nextAttempt: 'none'",
  'mergeRwAbHealthHistoryParsed',
  'hasRwHistoryParsedPayload',
  'history-ab-key-partial-continue',
  'history-ab-key-empty-use-pre-native',
  'RW_HISTORY_AB_KEY_PRE_NATIVE_RESPONSE_WAIT_MS = 2200',
  'RW_HISTORY_AB_KEY_PRE_NATIVE_COMMAND_LIMIT = 1',
  'isRwAbHealthHistoryResponseForKeyAndAttempt',
  'getRwAbHealthHistoryResponseFlag',
  'getRwHistoryRawBytes',
  'return parsedFlag === flag',
  'previousFlag: attempt.flag',
  'responseFlag: parsed.flag',
  'hasRwAbHealthHistoryPayload(parsed)',
  'flag: parsed.flag',
  'temperature-current',
  'temperature-history',
  'RwKey.AppRealTimeTemperature'
], 'RW AB history key sync must stop automatic ReadContinue after empty or timed-out Read responses, expose attempt/flag diagnostics, and probe SDK current temperature before historical temperature');

assertIncludes('src/sdk/ring-ble/rw/history.parity.ts', [
  'missingFlagAbHistoryParsed',
  'missingFlagAbMatched',
  'abPreNativeTemperatureParsed',
  'history/ab-key/temperature-current/read',
  'history/ab-key/temperature-history/read',
  'RW history should probe SDK current-temperature key before historical temperature key',
  'RW history should stop automatic AB read-continue when the first AB read returns an empty ack',
  'RW history should stop after an empty pre-native AB ack without automatic read-continue or legacy fallback',
  'abMergeResult.records.length !== 3',
  'RW history must merge pre-native AB payloads with later AB key payloads',
  'abPreNativeEmptyNativeResult.records[0].heartRate !== 72',
  'RW history must keep pre-native AB payload and skip legacy fallback when final AB keys are empty',
  'AB history payload without an identifiable flag must not match a pending attempt.',
  'RW history must ignore AB key payloads that do not expose a response flag',
  'missingFlagAbResult.records[0].heartRate === 88'
], 'RW history parity must prove that current-temperature fallback is ordered before historical temperature and that unflagged AB payloads are ignored instead of being consumed as valid history');

assertIncludes('src/sdk/ring-ble/businessMetrics.ts', [
  'getBloodOxygenCandidate',
  'normalizeBloodOxygenMetric',
  'normalizeHeartRateMetric',
  'normalizeHrvMetric',
  'normalizeStressMetric',
  'normalizeBloodPressureParts',
  'numeric >= 25 && numeric <= 240',
  'numeric >= 0 && numeric <= 100',
  'normalizeBloodPressurePart(parts.systolic, 50, 260)',
  'normalizeBloodPressurePart(parts.diastolic, 30, 180)',
  'HEART_RATE_METRIC_ALIASES',
  'HRV_METRIC_ALIASES',
  'BLOOD_OXYGEN_METRIC_ALIASES',
  'STRESS_METRIC_ALIASES',
  'TEMPERATURE_METRIC_ALIASES',
  'BLOOD_SUGAR_METRIC_ALIASES',
  'heartRateVariabilityValue',
  'pressureValue',
  'temperatureValue',
  'skinTemp',
  'bloodPressureValue',
  "if (kind === 'heart_rate')",
  "if (kind === 'hrv')",
  "if (kind === 'stress')",
  'normalizeHeartRateMetric(value) ?? normalizeHeartRateMetric(getFirstValidByte(data))',
  'normalizeHrvMetric(value) ?? normalizeHrvMetric(getFirstValidByte(data))',
  'normalizeStressMetric(value) ?? normalizeStressMetric(getFirstValidByte(data))',
  'metrics.heartRate = heartRate ?? metrics.heartRate;',
  "item.sourceType === 'qkeer_v2_last_data'",
  'const softwareValue = itemMetrics.softwareVersion ?? itemMetrics.uiVersion ?? firmwareValue ?? hardwareValue;',
  'metrics.softwareVersion = softwareValue ?? metrics.softwareVersion;'
], 'business metrics must consume RW LastData, reject invalid SpO2/heart-rate/HRV/stress/blood-pressure values, and reuse combined version responses');

assertIncludes('src/sdk/ring-ble/businessMetrics.parity.ts', [
  'rwInvalidRemainingVitalHistoryMetrics',
  'RW invalid HRV/stress/blood-pressure history should not backfill business metrics',
  'rwMixedRemainingVitalHistoryMetrics',
  'RW valid HRV/stress/blood-pressure history should still backfill after invalid samples',
  'rwBackendAliasHistoryMetrics',
  'RW backend-compatible aliases should render in business metrics'
], 'business metrics parity must protect RW remaining vital invalid-value filtering and backend-compatible field aliases');

assertIncludes('src/pages/mine/mine.vue', [
  EXPECTED_BUILD_TAG,
  'RW MINE',
  'RING_DIAGNOSTIC_LOG_MAX_COUNT = 500',
  'readMineDiagnosticLogs(RING_DIAGNOSTIC_LOG_MAX_COUNT)',
  'MINE_PROTOCOL_PROBE_COPY_EVENTS',
  'MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK = MINE_SHOW_SLEEP_PROTOCOL_PROBE',
  "MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_OWNER = 'mine-sleep-probe-isolation'",
  'setMineSleepProbeIsolationLock',
  'clearMineSleepProbeIsolationLock',
  'sleep-probe-isolation-lock-set',
  'sleep-probe-isolation-lock-clear',
  'mineHistorySyncItems',
  'mineMetricTestItems',
  "const mineHistorySummaryItem: MineHistorySyncItem = { key: 'summary'",
  "dataType: 'lastData'",
  "{ key: 'sleep', label:",
  "dataTypes: ['sleepData']",
  "{ key: 'activity', label:",
  "dataTypes: ['activity']",
  "{ key: 'stress', label:",
  "dataTypes: ['stress']",
  "{ key: 'vital', label:",
  "'heartRate', 'bloodOxygen', 'hrv', 'temperature', 'skinTemperature', 'bloodSugar', 'bloodPressure'",
  "{ name: 'temperature'",
  "{ name: 'hrv'",
  "{ name: 'stress'",
  "{ name: 'blood_pressure'",
  "{ name: 'blood_sugar'",
  "'metric:temperature'",
  'type MineProtocolProbeMode =',
  "| 'temperatureMonitoring'",
  "| 'temperatureDetecting'",
  "| 'temperatureHistory'",
  'mineTemperatureProtocolProbeKeys',
  'mineTemperatureProtocolProbeRequiredKeys',
  'mineTemperatureProtocolProbeOrder',
  'mineSingleProtocolProbeKeyByMode',
  'getMineTemperatureProtocolProbeSortOrder',
  'temperatureProtocolProbeButtonText',
  'temperatureMonitoringProtocolProbeButtonText',
  'temperatureDetectingProtocolProbeButtonText',
  'temperatureHistoryProtocolProbeButtonText',
  "handleMineProtocolProbe('temperature')",
  "handleMineProtocolProbe('temperatureMonitoring')",
  "handleMineProtocolProbe('temperatureDetecting')",
  "handleMineProtocolProbe('temperatureHistory')",
  "activeProtocolProbeMode",
  "createMineProtocolProbeCommands = (mode: MineProtocolProbeMode = 'full')",
  'singleProtocolProbeKey',
  "mode === 'full' || command.required !== false",
  'const mineProtocolProbeRequiredOrder = [',
  'mineUnverifiedRealtimeProbeMetrics',
  'mineProtocolProbeCoreRequiredKeys',
  "'history-key/activity-current-day/read'",
  "'history-key/activity/read'",
  "'history-key/sleep/read'",
  "'history-key/raw-sleep/read'",
  "rawSleepHistory: 'history-key/raw-sleep/read'",
  "handleMineProtocolProbe('rawSleepHistory')",
  'isMineMonitoringKeyParsed',
  "predicate: isMineMonitoringKeyParsed('temperature', RwKey.TemperatureMonitoring)",
  "'monitoring/temperature-detecting/write'",
  "predicate: isMineMonitoringKeyParsed('temperature', RwKey.TemperatureDetecting)",
  'hasMineVersionValue',
  'isMineFirmwareSoftwareParsed',
  'firmwareVersion: item.firmwareVersion',
  'hardwareVersion: item.hardwareVersion',
  'softwareVersion: item.softwareVersion',
  'uiVersion: item.uiVersion',
  'flag: item.flag',
  'fw: item.parsed.firmwareVersion',
  'sw: item.parsed.softwareVersion',
  'predicate: isMineFirmwareSoftwareParsed',
  'build: () => buildRwReadBatteryCommand()',
  'build: () => buildRwReadFirmwareVersionCommand()',
  'build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.HeartRate, true)',
  'build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.HeartRate)',
  'build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.HeartRate, false)',
  'build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.BloodOxygen, true)',
  'build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.BloodOxygen)',
  'build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.BloodOxygen, false)',
  'build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.Temperature, true)',
  'build: () => buildRwReadKeyCommand(RwKey.AppRealTimeTemperature)',
  "build: () => hexToBytes('c60100030cb4023010')",
  "build: () => hexToBytes('c6010003023010')",
  'build: () => buildRwReadKeyCommandWithoutChecksum(RwKey.Temperature)',
  'build: () => buildRwControlHealthDataCommand(RwHealthDataControlKey.Temperature, false)',
  'build: () => buildRwControlHealthDataCommand(metric.controlKey, true)',
  'build: () => buildRwReadKeyCommand(metric.realtimeKey)',
  'build: () => buildRwReadHealthDataCommand(metric.readableKey)',
  'build: () => buildRwControlHealthDataCommand(metric.controlKey, false)',
  'buildRwReadKeyCommandWithoutChecksum',
  'isMineRealtimeHealthDataParsed',
  'const isMineAppRealtimeHealthKey = (key: number | null) =>',
  'const key = getMineParsedKey(parsed)',
  'const flag = getMineParsedFlag(parsed)',
  'key === expectedKey',
  '(isMineRwReadFlag(flag) || isMineAppRealtimeHealthKey(key))',
  "predicate: isMineRealtimeHealthDataParsed('heart_rate', RwKey.HeartRate)",
  "predicate: isMineRealtimeHealthDataParsed('blood_oxygen', RwKey.BloodOxygen)",
  "predicate: isMineRealtimeHealthDataParsed('temperature', RwKey.AppRealTimeTemperature)",
  "predicate: isMineHealthDataKeyParsed('temperature', RwKey.Temperature)",
  'predicate: isMineRealtimeHealthDataParsed(metric.name, metric.realtimeKey)',
  "handleMineProtocolProbe = async (mode: MineProtocolProbeMode = 'core', options: MineRwDiagnosticActionOptions = {})",
  "handleMineProtocolProbe('core')",
  "handleMineProtocolProbe('full')",
  'handleMineRwL19Acceptance',
  'rw-l19-acceptance-start',
  'rw-l19-acceptance-step-result',
  'rw-l19-acceptance-summary',
  'formatMineRwL19AcceptanceCompactReport',
  'diagnostic-acceptance-report',
  'MINE_RW_L19_ACCEPTANCE_EXPECTED_KEYS',
  'rwAcceptanceButtonText',
  'compactMineRwL19AcceptanceResult',
  'results: compactResults',
  'failed: compactResults.filter',
  'fullProtocolProbeButtonText',
  'mode: probeStartDetails.mode',
  'requiredCommandCount',
  'optionalFailedCount',
  'formatMineHistoryCompactReport',
  'diagnostic-history-report',
  'elapsedMs: toMineDiagnosticCount',
  'uploadTimeoutMs: toMineDiagnosticCount',
  'submitResponse: compactMineHistorySubmitResponse',
  'rawError: trimMineDiagnosticText',
  'queuedBehind: toMineDiagnosticCount',
  'unexpectedResponseCount: toMineDiagnosticCount',
  'attempt: details.attempt || details.nextAttempt',
  'flag: toMineDiagnosticCount',
  'history-page-upload-result',
  'history-ab-key-timeout',
  'history-ab-key-retry-continue',
  'getMineProtocolProbeCopyState',
  'requiredCommands: compactResults.filter',
  'failedCommands: compactResults.filter',
  'MINE_PROTOCOL_PROBE_COMMAND_EVENTS',
  'protocol-probe-command-write-ok',
  'protocol-probe-command-poll',
  'wo: item?.writeOnly === true ? 1 : undefined',
  'wo: record.wo ?? (record.writeOnly === true ? 1 : undefined)',
  'getMineProtocolProbeScopedLogs',
  'protocol-probe-start-missing',
  'truncated: probeScope.truncated',
  'RW_FOREGROUND_METRIC_READ_AT_MS',
  'RW_FOREGROUND_METRIC_RESULT_TIMEOUT_MS',
  'pollAtMs: RW_FOREGROUND_METRIC_READ_AT_MS',
  'pollResponseGraceMs',
  'a: item?.attempt',
  'ac: item?.attemptCount',
  'diagnostic-copy-incomplete',
  'MINE_DIAGNOSTIC_RAW_COPY_EVENTS',
  'getMineDiagnosticRawCopyLogs',
  'formatMineDiagnosticCopyRawLogs',
  'getMineProtocolProbeDefaultRequired',
  'buildRwReadContinueKeyCommand',
  'history-key/activity-current-day/read',
  'history-key/activity/read',
  'history-key/sleep/read',
  'isMineHealthDataKeyParsed',
  'stepCount: item.stepCount ?? item.step',
  'durationMinutes: item.durationMinutes',
  'step: item.parsed.stepCount',
  'dur: item.parsed.durationMinutes',
  'RwKey.ActivityCurrentDay',
  'RwKey.Activity',
  'RwKey.Sleep',
  'history-key/activity-current-day/read-continue',
  'history-key/activity/read-continue',
  'history-key/sleep/read-continue',
  'history-key/heart-rate/read-continue',
  'history-key/blood-oxygen/read-continue',
  'history-key/temperature/read-continue',
  'history-key/hrv/read-continue',
  'history-key/stress/read-continue',
  'history-key/blood-sugar/read-continue',
  'history-key/blood-pressure/read-continue',
  "'qkeer-v2-history'",
  "'ab-history-key'"
], 'mine page must keep RW diagnostic panel, manual history/metric checks, required-vs-optional protocol classification, AB history read-continue probes, and incomplete-copy warnings');

assertIncludes('src/composables/useRingBLE.ts', [
  'interface CompatReadLocalDataOptions',
  'readOptions: CompatReadLocalDataOptions = {}',
  'silentUploadStatus?: boolean',
  'const timeoutMs = Number(readOptions.timeoutMs)',
  'timeoutMs: historyOptions.timeoutMs',
  'silentUploadStatus: readOptions.silentUploadStatus === true'
], 'useRingBLE must allow RW business pages to pass a bounded history timeout/silent status and expose it in queue diagnostics');

assertIncludes('src/composables/useRingBusinessHistoryPageSync.ts', [
  'timeoutMs?: number',
  'RW_BUSINESS_HISTORY_PAGE_TIMEOUT_MS',
  'SLEEP_HISTORY_LOOKBACK_DAYS',
  'primarySubmitMetricCounts',
  'countHistoryPageSubmitMetrics',
  'getFocusedStepSleepFallbackDataTypes',
  "return ['activity']",
  "return ['sleepData']",
  'hasStepOrSleepHistoryDataType(dataTypes)',
  'getHistoryPageStartDate(options.date, dataTypes, readAll)',
  'historyStartDate',
  'silentUploadStatus: true',
  'fallbackFocus: fallbackDataTypes[0]',
  'elapsedMs: Date.now() - startedAt',
  "'latestHrvValue'",
  "'dailyAvgHrvValue'",
  "'stressValue'",
  "'avgStressValue'",
  "'temperatureAvg'"
], 'business pages must bound RW history waits and log elapsed history-sync time plus HRV/stress/temperature value hints');

assertIncludes('scripts/analyze-rw-ble-log.mjs', [
  'incompleteRows',
  "!latestSummary && incompleteRows.length > 0",
  'diagnosticCopyIncompleteEvents',
  'diagnostic-copy-incomplete:',
  'Mine copied diagnostics before protocol self-test finished.',
  'Protocol probe started but no summary was copied.',
  'RW/L19 Gate',
  'formatRwL19Gate',
  'RW_L19_GATE_METRICS',
  'RW_L19_GATE_HISTORIES',
  'getDevicePageInfoEvidence',
  'flatCurrentDevice',
  'snapshot.ready',
  'battery-read-result',
  'version-read-result',
  'rawRecordCount',
  'submitRecordCount',
  'records-not-submittable',
  'compat-history-queue-enqueue',
  'compat-history-queue-start',
  'compat-history-queue-result',
  'compat-history-queue-failed',
  'maxQueuedBehind',
  'RW_MINE_HISTORY_EVENTS',
  'manual-history-sync-start',
  'manual-history-sync-result',
  'manual-history-sync-failed',
  'diagnostic-history-report',
  'diagnosticReportCounts',
  'history-ab-key-retry-continue',
  'abKeyRetryContinues',
  'attempt: firstDefined',
  'flag: toCount',
  'previousFlag: toCount',
  'responseFlag: toCount',
  'previousFlag=${summary.previousFlag}',
  'responseFlag=${summary.responseFlag}',
  'retryContinue=',
  'manualSyncResults',
  'summaryDetails.requiredCommands',
  'summaryDetails.failedCommands',
  "event.event === 'protocol-probe-command-poll'",
  'polls: polls.length',
  'attempt=${row.attempt}',
  'pollText',
  'exhaustedRealtimeProbeTimeouts',
  'Required realtime protocol read exhausted warm-up polling without a result',
  'command/device no-result after enable/read',
  'RW_MINE_METRIC_EVENTS',
  'manual-metric-start',
  'manual-metric-result',
  'manual-metric-failed',
  'acceptanceEvents',
  'formatRwL19Acceptance',
  'RW_L19_ACCEPTANCE_EXPECTED_KEYS',
  'getRwL19AcceptanceEvidence',
  'mergeRwL19AcceptanceMetricChecks',
  'mergeRwL19AcceptanceHistoryChecks',
  'summaryResults',
  "'summary-results'",
  'acceptanceCore@L',
  'rw-l19-acceptance-summary',
  'diagnostic-acceptance-report',
  'RW/L19 Acceptance',
  '`  mode: ${summary.mode || \'-\'}`',
  'firmwareValue',
  'softwareValue',
  'softwareOk',
  'software=${softwareOk ?',
  'versions=${versions}',
  'run core protocol self-test or device info read',
  'truncatedReports',
  'protocolProbeSummary?.truncated',
  'Protocol probe report is truncated',
  'rawStaleBuildTagLines',
  'latestExpectedBuildLine',
  'entry.lineNumber > latestExpectedBuildLine',
  'historical-stale-build-marker',
  'Historical Stale Build Tag Lines',
  'Current Stale Build Tag Lines',
  'truncated-reason:',
  'history-page-missing-step-sleep-fallback-start',
  'history-page-missing-step-sleep-fallback-result',
  'history-page-empty-fallback-start'
], 'offline RW log analysis must expose goal-level gate status, raw-vs-submittable history evidence, and must not treat partial protocol self-test logs as a complete command result');

assertIncludes('src/composables/useRingBusinessController.ts', [
  'const RW_HISTORY_DEVICE_TIME_SYNC_DEDUP_MS = 10 * 60 * 1000;',
  "const syncRwDeviceTimeAfterReady = async (phase: 'ready' | 'history'",
  "const syncRwDeviceTimeBeforeHistory = (details: Record<string, unknown>) =>",
  'await syncRwDeviceTimeBeforeHistory(requestedHistoryDetails);',
  "await syncRwDeviceTimeAfterReady('ready'",
  'await ble.updateDeviceTime(now, timezone);',
  '${phase}-device-time-sync-start',
  '${phase}-device-time-sync-result',
  '${phase}-device-time-sync-failed',
  '${phase}-device-time-sync-skip'
], 'RW Mine/manual history sync must calibrate device time before reading history so uploaded record times do not drift into the future');

assertIncludes('src/pages.json', [
  '"root": "pagesA/mines"',
  '"path": "device"',
  '"root": "homeDetail"',
  '"path": "sleepPage/sleepPage"',
  '"path": "exercise/exercise"',
  '"path": "relaxStatus/relaxStatus"',
  '"path": "vitalSigns/vitalSigns"',
  '"path": "sleepPageEdit/sleepPageEdit"',
  '"path": "exerciseEdit/exerciseEdit"',
  '"path": "relaxEdit/relaxEdit"',
  '"path": "vitalSignsEdit/vitalSignsEdit"',
  '"path": "vitalSignsHeartDetail/vitalSignsDetail"',
  '"path": "vitalSignsHeartDetail/oxyGenDetail"',
  '"path": "vitalSignsHeartDetail/temperatureDetail"',
  '"path": "vitalSignsHeartDetail/heartRateVariabilityDetail"'
], 'RW/L19 business detail, edit, and vital-sign sub-detail pages must remain routable');

assertIncludes('src/homeDetail/vitalSignsHeartDetail/vitalSignsDetail.vue', [
  'getHeartRateDetail',
  'homeHeartChart'
], 'heart-rate detail page must exist for vital-sign card navigation');

assertIncludes('src/homeDetail/vitalSignsHeartDetail/oxyGenDetail.vue', [
  'getBloodOxygenDetail',
  'homeHeartChart'
], 'blood-oxygen detail page must exist for vital-sign card navigation');

assertIncludes('src/homeDetail/vitalSignsHeartDetail/temperatureDetail.vue', [
  'getBodyTemperatureDetail',
  'homeHeartChart'
], 'temperature detail page must exist for vital-sign card navigation');

assertIncludes('src/homeDetail/vitalSignsHeartDetail/heartRateVariabilityDetail.vue', [
  'getHrvDetail',
  'homeHeartChart'
], 'HRV detail page must exist for vital-sign card navigation');

assertIncludes('src/pagesA/mines/device.vue', [
  'const versionCommands = [controller.sendFirmwareVersion(), controller.sendSoftwareVersion()];'
], 'manual device-version read must request both firmware and software versions');

assertIncludes('src/pages/awareness/awareness.vue', [
  'RW_DIAGNOSTIC_BUILD_TAG',
  'RW HOME',
  'useRingBusinessHistoryPageSync',
  'RW_HOME_HISTORY_DATA_TYPES',
  "'lastData'",
  "'sleepData'",
  "'activity'",
  "'stress'",
  "'heartRate'",
  "'bloodOxygen'",
  "'hrv'",
  "'temperature'",
  "'skinTemperature'",
  "'bloodSugar'",
  "'bloodPressure'",
  'allowRwDeviceSync: true',
  'business-sync-background-start',
  'business-sync-background-result',
  'business-sync-background-failed',
  'pull-down-refresh-error',
  'isAwarenessNetworkTimeoutError',
  'rawError: getAwarenessRawError(error)',
  'syncRwHomeDeviceTimeBeforeHistory',
  'updateDeviceTime(now, timezone)',
  'device-time-sync-start',
  'device-time-sync-result',
  'device-time-sync-failed',
  'device-time-sync-skip',
  'local-data-upload-skip-rw-bridge',
  'rw-home-bridge-owns-upload',
  'restore-rw-home-sync-started',
  'bluetooth-ready-rw-home-sync-started',
  'reconnect-result-rw-home-sync-started',
  'getAwarenessSilentRequestConfig',
  'requestAwarenessOverview',
  'requestAwarenessAuxiliary',
  'business-aux-request-failed',
  'getAwarenessRawError',
  'business-overview-request-failed',
  'rawError',
  "custom: { toast: false, catch: true }"
], 'awareness page must expose current build tag and own RW homepage history upload diagnostics');

assertIncludes('src/utils/request/index.js', [
  'normalizeNetworkErrorMessage',
  'err_connection_timed_out',
  'request:fail',
  'custom.toast !== false',
  'rawMsg'
], 'request layer must localize network errors and allow background RW page calls to suppress noisy toasts');

assertIncludes('src/composables/useRingBusinessHistoryPageSync.ts', [
  'resolveRingProtocol',
  'ringStore.boundDevice',
  'history-page-sync-skip',
  'HISTORY_PAGE_PENDING_UPLOAD_STORAGE_KEY',
  'readHistoryPagePendingUpload',
  'writeHistoryPagePendingUpload',
  'mergeHistoryPageSubmitRecords',
  'submitData',
  'buildRingHistorySubmitRecords',
  'HISTORY_PAGE_UPLOAD_ENDPOINT',
  'HISTORY_PAGE_UPLOAD_TIMEOUT_MS',
  'export interface HistoryPageSilentRequestConfig',
  'query: (requestConfig: HistoryPageSilentRequestConfig) => Promise<T>;',
  'getHistoryPageSilentRequestConfig',
  'timeout: HISTORY_PAGE_UPLOAD_TIMEOUT_MS',
  'custom: { toast: false, catch: true }',
  'const response = await options.query(getHistoryPageSilentRequestConfig());',
  'return null;',
  'uploadTimeoutMs: HISTORY_PAGE_UPLOAD_TIMEOUT_MS',
  'history-page-upload-start',
  'history-page-upload-result',
  'history-page-upload-failed',
  'pendingUploadSaved',
  'currentSubmitRecordCount',
  'history-page-empty-fallback-start',
  'history-page-empty-fallback-result',
  'history-page-empty-fallback-upload-failed',
  'history-page-empty-fallback-failed',
  'getMissingStepSleepHistoryMetrics',
  'primaryRawMetricCounts',
  'primarySubmitMetricCounts',
  'countHistoryPageSubmitMetrics',
  'getFocusedStepSleepFallbackDataTypes',
  "return ['activity']",
  "return ['sleepData']",
  'missingMetrics: missingStepSleepMetrics',
  'missing-primary-step-sleep',
  'history-page-missing-step-sleep-fallback',
  'fallbackFocus: fallbackDataTypes[0]',
  'HISTORY_PAGE_MISSING_VITAL_FALLBACK_EVENTS',
  'getMissingVitalHistoryMetrics',
  'missing-primary-vital',
  'history-page-missing-vital-fallback-start',
  'history-page-missing-vital-fallback-result',
  'history-page-missing-vital-fallback-upload-failed',
  'history-page-missing-vital-fallback-failed',
  'history-page-query-result',
  'history-page-query-failed',
  'history-page-missing-step-sleep-fallback-start',
  'history-page-missing-step-sleep-fallback-result',
  'queryHistoryPage',
  'previousLastReadTimestamp',
  'userStore.updateLastReadTimestamp(maxTimestamp)',
  'lastReadTimestamp: userStore.lastReadTimestamp',
  'rawError: getHistoryPageRawError',
  'inputCount: summarySource.inputCount',
  'syncElapsedMs: summarySource.syncElapsedMs',
  'healthWriteMs: summarySource.healthWriteMs',
  'summaryMs: summarySource.summaryMs',
  'summarySkipped: summarySource.summarySkipped',
  'summaryScheduled: summarySource.summaryScheduled',
  'rawRecordCount: records.length',
  'submitRecordCount: submitPreviewRecords.length',
  'submitMetricCounts: primarySubmitMetricCounts',
  'submitMetricCounts: countHistoryPageSubmitMetrics',
  'bloodSugarValue',
  'bloodPressureValue',
  'systolicValue',
  'diastolicValue',
  "bump('bloodSugar')",
  "bump('bloodPressure')",
  'rawRecordSample',
  'submitRecordSample',
  'endpoint: HISTORY_PAGE_UPLOAD_ENDPOINT',
  'submitData({ deviceMac, dataList: submitPreviewRecords }',
  'summarizeHistoryPageQueryResponse'
], 'RW business detail pages must detect bound RW devices, submit history to backend, and log skipped syncs with raw-vs-submittable evidence');

assertIncludes('src/composables/useRingHistoryUpload.ts', [
  "'qkeer_v2_last_data'",
  "item.type === 'qkeer_v2_last_data'",
  'STATUS_ONLY_BYTES',
  'normalizeHeartRateNumber',
  'numeric < 25 || numeric > 240',
  'normalizeHrvNumber',
  'numeric == null || numeric <= 0 || numeric > 300',
  'normalizeStressNumber',
  'numeric == null || numeric < 0 || numeric > 100',
  'normalizeStepCountNumber',
  'numeric == null || numeric <= 0 || numeric > 300000',
  'normalizeTemperatureNumber',
  'normalizeBloodPressureParts',
  'normalizeBloodPressurePart(parts.systolic, 50, 260)',
  'normalizeBloodPressurePart(parts.diastolic, 30, 180)',
  'resolveSleepDateRef',
  'endDate > startDate',
  'getRingHistoryRecordSyncUnixTime',
  'getSleepEndUnixTime',
  'return endTime || startTime',
  'HEART_RATE_ALIASES',
  'HRV_ALIASES',
  'BLOOD_OXYGEN_ALIASES',
  'STRESS_ALIASES',
  'TEMPERATURE_ALIASES',
  'BLOOD_SUGAR_ALIASES',
  'heartRateVariabilityValue',
  'pressureValue',
  'temperatureValue',
  'skinTemp',
  'bloodPressureValue',
  "'motion_intensity'",
  'rawCount: rawRecords.length',
  'sampleSubmittedRecords'
], 'RW LastData direct responses must be treated as completed, submittable L19-compatible history payloads while filtering invalid vital values and preserving activity intensity');

assertIncludes('src/composables/useRingHistoryUpload.parity.ts', [
  'rwInvalidVitalSubmitRecords',
  'RW invalid HRV/stress/blood-sugar/temperature/blood-pressure values should not be submitted',
  'rwMixedVitalSubmitRecords',
  'RW valid submit vital records should survive after invalid samples are filtered',
  'rwBackendAliasSubmitRecords',
  'RW backend-compatible aliases should submit without field loss',
  'sleepStatus: 2',
  'sleepState !== 4',
  'overnightSleepSubmitRecords',
  'Overnight sleep should fall back to wake-date dateRef while preserving explicit dateRef',
  'overnightSleepFilteredByWakeTime',
  'Overnight sleep should be retained by wake-time sync filters without changing record start time'
], 'RW upload parity must reject implausible values, preserve backend-compatible aliases, and keep overnight sleep on the wake date before backend submit');

assertIncludes('src/composables/useRingMetricReadings.ts', [
  'normalizeHeartRateMetricValue',
  'numeric >= 25 && numeric <= 240 && !RW_STATUS_ONLY_BYTES.has(numeric)',
  'normalizeHrvMetricValue',
  'normalizeStressMetricValue',
  "if (kind === 'heart_rate')",
  "if (kind === 'stress')"
], 'RW realtime metric helpers must reject status bytes and implausible heart-rate/stress/HRV values before pages display them');

assertIncludes('src/composables/useRingMetricReadings.parity.ts', [
  'rwInvalidDirectMetricStore',
  'rwInvalidDirectOnlyMetricStore',
  'RW direct realtime values should ignore invalid newer values and keep the latest valid reading',
  'RW direct realtime values should reject status bytes and out-of-range values when no valid reading exists.'
], 'RW metric parity must protect direct realtime invalid-value filtering');

assertIncludes('src/composables/useRwForegroundMeasurement.ts', [
  'RW_FOREGROUND_STATUS_ONLY_BYTES',
  'normalizeRwForegroundHeartRateValue',
  'normalizeRwForegroundBloodOxygenValue',
  'normalizeRwForegroundBloodSugarValue',
  'normalizeRwForegroundTemperatureValue',
  'getRwForegroundScalarDataValue',
  'getRwForegroundTemperatureDataValue',
  '\\u8bbe\\u5907\\u8fde\\u63a5\\u5df2\\u65ad\\u5f00\\uff0c\\u8bf7\\u91cd\\u65b0\\u8fde\\u63a5\\u540e\\u518d\\u6d4b\\u91cf'
], 'RW foreground single-measurement pages must reject status bytes and implausible values before reporting success');

assertIncludes('src/composables/useRwForegroundMeasurement.parity.ts', [
  'validHeartRateFromStatusPrefixedData',
  'invalidStatusHeartRate',
  'validBloodSugarFromStatusPrefixedData',
  'invalidStatusBloodSugar',
  'validTemperatureFromBytes',
  'invalidTemperatureRawByte',
  'validSpo2FromStatusPrefixedData',
  'RW foreground metric values should be range-checked before page success handling'
], 'RW foreground parity must protect single-measurement invalid-value filtering');

assertIncludes('src/composables/useRingBLE.ts', [
  'let rwCompatHistoryQueue: Promise<unknown> = Promise.resolve()',
  'let rwCompatHistoryQueueDepth = 0',
  'runRwCompatHistoryExclusive',
  "appendRwCompatHistoryDiagnosticLog('compat-history-queue-enqueue'",
  "appendRwCompatHistoryDiagnosticLog('compat-history-queue-start'",
  "appendRwCompatHistoryDiagnosticLog('compat-history-queue-result'",
  "appendRwCompatHistoryDiagnosticLog('compat-history-queue-failed'",
  'const queueDepth = queuedBehind + 1',
  'queueDepth',
  'queuedBehind',
  "if (resolveRingProtocol(sdk.deviceInfo.value) !== 'rw') return task()",
  'return runRwCompatHistoryExclusive(task, {'
], 'RW history reads must be serialized and diagnosable so business pages do not flood the RW BLE command channel');

for (const page of [
  'src/homeDetail/sleepPage/sleepPage.vue',
  'src/homeDetail/exercise/exercise.vue',
  'src/homeDetail/relaxStatus/relaxStatus.vue',
  'src/homeDetail/vitalSigns/vitalSigns.vue'
]) {
  assertIncludes(page, ['useRingBusinessHistoryPageSync', 'queryHistoryPage', 'requestConfig'], 'RW business detail pages must query backend through the history-page bridge with silent request config');
  assertNotIncludes(page, ['syncBusinessHistoryPage(', 'allowRwDeviceSync'], 'RW business detail pages must not trigger device history sync; sync is owned by the home/Mine entry points');
}

for (const page of [
  'src/homeDetail/vitalSignsHeartDetail/vitalSignsDetail.vue',
  'src/homeDetail/vitalSignsHeartDetail/oxyGenDetail.vue',
  'src/homeDetail/vitalSignsHeartDetail/temperatureDetail.vue',
  'src/homeDetail/vitalSignsHeartDetail/heartRateVariabilityDetail.vue'
]) {
  assertIncludes(page, [
    'HistoryPageSilentRequestConfig',
    'getVitalDetailSilentRequestConfig',
    'custom: { toast: false, catch: true }',
    '}, getVitalDetailSilentRequestConfig());'
  ], 'vital-sign sub-detail pages must suppress backend timeout toasts and keep the page display path non-blocking');
}

for (const page of [
  'src/homeDetail/sleepPage/sleepPage.vue',
  'src/homeDetail/exercise/exercise.vue',
  'src/homeDetail/relaxStatus/relaxStatus.vue'
]) {
  assertIncludes(page, [
    'const rawDayIndex = options?.selectedDayIndex;',
    'await handleDateClick(selectedDayIndex.value);',
    'await handleDateClick(2);'
  ], 'RW business detail pages must load and query today when opened without route params');
}

assertIncludes('src/homeDetail/sleepPage/sleepPage.vue', [
  'useRingBusinessHistoryPageSync',
  'queryHistoryPage',
  'const isoDate = formatLocalDate(currentDate);'
], 'sleep page must route backend queries through the RW page bridge while using the selected date');

assertNotIncludes('src/homeDetail/sleepPage/sleepPage.vue', [
  'const isoDate = formatLocalDate(new Date());'
], 'sleep page detail APIs must query the selected backend date, not always today');

assertIncludes('src/homeDetail/exercise/exercise.vue', [
  'useRingBusinessHistoryPageSync',
  'queryHistoryPage'
], 'activity page must query backend directly through the RW page bridge');

assertIncludes('src/homeDetail/relaxStatus/relaxStatus.vue', [
  'useRingBusinessHistoryPageSync',
  'queryHistoryPage'
], 'stress page must query backend directly through the RW page bridge');

assertIncludes('src/homeDetail/vitalSigns/vitalSigns.vue', [
  'useRingBusinessHistoryPageSync',
  'queryHistoryPage',
  'const currentDate = dateList.value[index]?.date || today.value;',
  'const isoDate = formatLocalDate(currentDate);',
  "'bloodPressureValue'",
  "'systolicValue'",
  "'diastolicValue'",
  'bloodOxygen',
  'bloodPressure',
  'bloodSugar'
], 'vital signs page must query the selected backend date and display RW vital histories with backend-compatible aliases');

assertIncludes('docs/RW_HANDOFF_V306_ADDENDUM_2026-07-18.md', [
  'admin_fastapi',
  'BLE_KEY_ACTIVITY',
  'BLE_KEY_SLEEP',
  'BLE_KEY_ACTIVITY_CURRENT_DAY',
  'BLE_KEY_TEMPERATURE_DETECTING',
  'BLE_KEY_APP_REAL_TIME_TEMPERATURE_DATA',
  'BLE_KEY_TEMPERATURE_MONITORING',
  '0x051a',
  '0x021b',
  '0x0230',
  '0x027d',
  '0x0508',
  '0x0609',
  'ab0100030cb4023010',
  'ab010003023010',
  'c60100030cb4023010',
  'c601000319d4050230',
  '0x0502',
  'temperature-current',
  'temperature-history',
  'temperature/app-realtime-read',
  'temperature/c6-realtime-read',
  'history-key/temperature/read',
  '\u4f53\u6e29\u5355\u6d4b',
  'stepCount',
  'sleepState',
  'durationMinutes',
  'historyStartDate',
  'records=0',
  'health_raw.step_count',
  'health_raw.sleep_state',
  'summaryScheduled',
  'data_sync_summary',
  'local summary/raw data',
], 'handoff baseline must describe RW step/sleep/temperature state');

assertIncludes('src/pages/mine/mine.vue', [
  'MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false',
  'MINE_SHOW_STEP_PROTOCOL_PROBES = false',
  'MINE_SHOW_SLEEP_PROTOCOL_PROBE = false',
  'v-if="MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES"',
  'v-if="MINE_SHOW_STEP_PROTOCOL_PROBES"',
  "handleMineProtocolProbe('sleepHistory')",
  "sleepHistory: 'history-key/sleep/read'"
], 'mine page must hide one-command protocol probes while retaining source commands for targeted re-test');

assertIncludes('src/sdk/ring-ble/rw/parser.ts', [
  'const keyFrame = parseRwKeyFrame(bytes);',
  'const qkeerV2Frame = parseRwQkeerV2CompatFrame(bytes);'
], 'RW parser must parse AB/C6 key frames before QKeer V2 compat frames');

assertIncludes('src/sdk/ring-ble/rw/parser.parity.ts', [
  'realDeviceRelativeCurrentDayStepSleepCmdCollision',
  '0x051A packets even when payload bytes resemble QKeer V2 commands',
  'value !== 62'
], 'RW parser parity must cover 0x051A packets that resemble QKeer V2 sleep commands');

assertIncludes('src/composables/useRingHistoryUpload.ts', [
  'isSafeCurrentDayRelativeStepSource',
  'ab_activity_current_day_relative_hour',
  'current_day_key_relative_hour',
  'isCurrentLocalDayUnixTime'
], 'RW upload must only submit tagged current-day relative step records');

assertIncludes('src/composables/useRingHistoryUpload.parity.ts', [
  'safeCurrentDayRelativeStepSubmitRecords',
  'timestampSource: \'current_day_key_relative_hour\'',
  'stepCount: 118',
  'stepCount: 9262'
], 'RW upload parity must cover safe tagged relative steps while blocking untagged candidates');

assertIncludes('docs/RW_HANDOFF_V330_ADDENDUM_2026-07-19.md', [
  EXPECTED_BUILD_TAG,
  '0x051a',
  '0x0505',
  '0x02fe',
  'RawSleep',
  'rawSleepHistory',
  '\u539f\u59cb\u7761\u772002FE',
  'sleepHistory',
  'history-command-skip-diagnostic-lock',
  'ab0100039d12050510',
  'ab1100039d12050510',
  'sdk-delete',
  'ab_activity_current_day_relative_hour',
  'current_day_key_relative_hour',
  'MINE_SHOW_STEP_PROTOCOL_PROBES',
  'MINE_SHOW_SLEEP_PROTOCOL_PROBE',
  'MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES',
  'MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK',
  'sleep-probe-isolation-lock-set',
  'sleep-probe-isolation-lock-clear',
  'history-key/sleep/read',
  'admin_fastapi',
  'health_raw.sleep_state'
], 'handoff addendum must describe sleep-focused v330 raw-sleep state');

assertIncludes('docs/RW_HANDOFF_V269_ADDENDUM_2026-07-18.md', [
  '/app/device/current',
  'getBindInfo',
  '5 \u79d2',
  '\u672c\u5730\u7f13\u5b58\u515c\u5e95',
  'RW \u6570\u636e\u540c\u6b65'
], 'handoff document must describe current RW state');

if (!skipDist) {
  const distMine = 'dist/build/mp-weixin/pages/mine/mine.js';
  const distApp = 'dist/build/mp-weixin/app.json';
  assertIncludes(distMine, [EXPECTED_BUILD_TAG], 'built mine bundle must contain latest tag');
  if (!existsSync(join(root, distApp))) failures.push(`${distApp}: missing`);
  assertBuiltRoutesExist(pagesJsonRoutes);
}

if (failures.length > 0) {
  console.error('RW/L19 parity audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`RW/L19 parity audit passed (${EXPECTED_BUILD_TAG}${skipDist ? ', source only' : ''}).`);






