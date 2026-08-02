import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSource = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');
const compact = (value: string) => value.replace(/\s+/g, ' ');

const expectSource = (label: string, source: string, expected: string) => {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing ${expected}`);
  }
};

const expectNotSource = (label: string, source: string, unexpected: string) => {
  if (source.includes(unexpected)) {
    throw new Error(`${label} must not contain ${unexpected}`);
  }
};

const expectSourceCompact = (label: string, source: string, expected: string) => {
  if (!compact(source).includes(compact(expected))) {
    throw new Error(`${label} is missing ${expected}`);
  }
};

const bridge = readSource('src/composables/useRingBusinessHistoryPageSync.ts');

expectSource('business history bridge', bridge, 'allowRwDeviceSync?: boolean');
expectSource('business history bridge', bridge, 'timeoutMs?: number');
expectSource('business history bridge', bridge, 'RW_BUSINESS_HISTORY_PAGE_TIMEOUT_MS');
expectSource('business history bridge', bridge, 'HISTORY_PAGE_UPLOAD_TIMEOUT_MS');
expectSource('business history bridge', bridge, 'export interface HistoryPageSilentRequestConfig');
expectSource('business history bridge', bridge, 'query: (requestConfig: HistoryPageSilentRequestConfig) => Promise<T>;');
expectSource('business history bridge', bridge, 'custom: { toast: false, catch: true }');
expectSource('business history bridge', bridge, 'const response = await options.query(getHistoryPageSilentRequestConfig());');
expectSource('business history bridge', bridge, 'return null;');
expectSource('business history bridge', bridge, "reason: 'rw-manual-only'");
expectSource('business history bridge', bridge, "appendRingDiagnosticLog('RW PAGE', 'history-page-sync-start'");
expectSource('business history bridge', bridge, "appendRingDiagnosticLog('RW PAGE', 'history-page-query-result'");
expectSource('business history bridge', bridge, "appendRingDiagnosticLog('RW PAGE', 'history-page-query-failed'");
expectSource('business history bridge', bridge, 'history-page-empty-fallback-start');
expectSource('business history bridge', bridge, 'history-page-empty-fallback-result');
expectSource('business history bridge', bridge, 'history-page-empty-fallback-upload-failed');
expectSource('business history bridge', bridge, 'history-page-empty-fallback-failed');
expectSource('business history bridge', bridge, 'getMissingStepSleepHistoryMetrics');
expectSource('business history bridge', bridge, 'primaryRawMetricCounts');
expectSource('business history bridge', bridge, 'missingMetrics: missingStepSleepMetrics');
expectSource('business history bridge', bridge, 'missing-primary-step-sleep');
expectSource('business history bridge', bridge, 'history-page-missing-step-sleep-fallback');
expectSource('business history bridge', bridge, 'HISTORY_PAGE_MISSING_VITAL_FALLBACK_EVENTS');
expectSource('business history bridge', bridge, 'getMissingVitalHistoryMetrics');
expectSource('business history bridge', bridge, 'history-page-missing-vital-fallback-start');
expectSource('business history bridge', bridge, 'history-page-missing-vital-fallback-result');
expectSource('business history bridge', bridge, 'history-page-missing-vital-fallback-upload-failed');
expectSource('business history bridge', bridge, 'history-page-missing-vital-fallback-failed');
expectSource('business history bridge', bridge, 'missing-primary-vital');
expectSource('business history bridge', bridge, 'queryHistoryPage');
expectSource('business history bridge', bridge, 'SLEEP_HISTORY_LOOKBACK_DAYS');
expectSource('business history bridge', bridge, 'primarySubmitMetricCounts');
expectSource('business history bridge', bridge, 'countHistoryPageSubmitMetrics');
expectSource('business history bridge', bridge, 'getFocusedStepSleepFallbackDataTypes');
expectSource('business history bridge', bridge, "return ['activity']");
expectSource('business history bridge', bridge, "return ['sleepData']");
expectSource('business history bridge', bridge, 'hasStepOrSleepHistoryDataType(dataTypes)');
expectSource('business history bridge', bridge, 'getHistoryPageStartDate(options.date, dataTypes, readAll)');
expectSource('business history bridge', bridge, 'historyStartDate');
expectSourceCompact('business history bridge', bridge, 'ringBle.readLocalData(readAll, historyStartDate, dataTypes, { timeoutMs, silentUploadStatus: true })');
expectSourceCompact('business history bridge', bridge, 'ringBle.readLocalData(true, historyStartDate, fallbackDataTypes, { timeoutMs: fallbackTimeoutMs, silentUploadStatus: true })');
expectSource('business history bridge', bridge, 'fallbackFocus: fallbackDataTypes[0]');
expectSource('business history bridge', bridge, 'elapsedMs: Date.now() - startedAt');
expectSource('business history bridge', bridge, 'HISTORY_PAGE_PENDING_UPLOAD_STORAGE_KEY');
expectSource('business history bridge', bridge, 'readHistoryPagePendingUpload');
expectSource('business history bridge', bridge, 'writeHistoryPagePendingUpload');
expectSource('business history bridge', bridge, 'mergeHistoryPageSubmitRecords');
expectSource('business history bridge', bridge, 'pendingUploadSaved');
expectSource('business history bridge', bridge, 'currentSubmitRecordCount');
expectSource('business history bridge', bridge, 'submitData({ deviceMac, dataList: submitPreviewRecords }');
expectSource('business history bridge', bridge, 'timeout: HISTORY_PAGE_UPLOAD_TIMEOUT_MS');
expectSource('business history bridge', bridge, 'uploadTimeoutMs: HISTORY_PAGE_UPLOAD_TIMEOUT_MS');
expectSource('business history bridge', bridge, 'rawError: getHistoryPageRawError');
expectSource('business history bridge', bridge, 'inputCount: summarySource.inputCount');
expectSource('business history bridge', bridge, 'syncElapsedMs: summarySource.syncElapsedMs');
expectSource('business history bridge', bridge, 'summaryMs: summarySource.summaryMs');
expectSource('business history bridge', bridge, 'previousLastReadTimestamp');
expectSource('business history bridge', bridge, 'userStore.updateLastReadTimestamp(maxTimestamp)');
expectSource('business history bridge', bridge, 'lastReadTimestamp: userStore.lastReadTimestamp');
expectSource('business history bridge', bridge, 'uploaded: true');
expectSource('business history bridge', bridge, 'recordCount: submitPreviewRecords.length');
expectSource('business history bridge', bridge, "'latestHrvValue'");
expectSource('business history bridge', bridge, "'dailyAvgHrvValue'");
expectSource('business history bridge', bridge, "'stressValue'");
expectSource('business history bridge', bridge, "'avgStressValue'");
expectSource('business history bridge', bridge, "'temperatureAvg'");
expectSource('business history bridge', bridge, 'ringBle.deviceInfo.value');
expectSource('business history bridge', bridge, 'ringStore.deviceInfo');
expectSource('business history bridge', bridge, 'ringStore.boundDevice');
expectSource('business history bridge', bridge, '设备恢复失败');
expectSource('business history bridge', bridge, '历史数据提交失败');
expectSource('business history bridge', bridge, '历史数据同步失败');
expectSource('business history bridge', bridge, '详情接口请求失败');

const rwHistory = readSource('src/sdk/ring-ble/rw/history.ts');
expectSource('RW history type aliases', rwHistory, "compact === 'vitalsigns'");
expectSource('RW history type aliases', rwHistory, "return 'vital'");

const legacyAdapter = readSource('src/sdk/ring-ble/legacy/adapter.ts');
for (const historyAlias of ['lastData', 'lastSnapshot', 'vitalSigns', 'dailyHealth']) {
  expectSource('RW history type aliases', legacyAdapter, historyAlias);
}

const businessPages = [
  {
    label: 'sleep page',
    path: 'src/homeDetail/sleepPage/sleepPage.vue',
    page: "page: 'sleepPage'"
  },
  {
    label: 'activity page',
    path: 'src/homeDetail/exercise/exercise.vue',
    page: "page: 'exercise'"
  },
  {
    label: 'stress page',
    path: 'src/homeDetail/relaxStatus/relaxStatus.vue',
    page: "page: 'relaxStatus'"
  },
  {
    label: 'vital signs page',
    path: 'src/homeDetail/vitalSigns/vitalSigns.vue',
    page: "page: 'vitalSigns'"
  }
];

for (const page of businessPages) {
  const source = readSource(page.path);
  expectSource(page.label, source, 'useRingBusinessHistoryPageSync');
  expectSourceCompact(page.label, source, page.page);
  expectSource(page.label, source, 'queryHistoryPage');
  expectSource(page.label, source, 'requestConfig');
  expectNotSource(page.label, source, 'syncBusinessHistoryPage(');
  expectNotSource(page.label, source, 'allowRwDeviceSync');
}

for (const page of [
  ['heart-rate detail page', 'src/homeDetail/vitalSignsHeartDetail/vitalSignsDetail.vue'],
  ['blood-oxygen detail page', 'src/homeDetail/vitalSignsHeartDetail/oxyGenDetail.vue'],
  ['temperature detail page', 'src/homeDetail/vitalSignsHeartDetail/temperatureDetail.vue'],
  ['HRV detail page', 'src/homeDetail/vitalSignsHeartDetail/heartRateVariabilityDetail.vue']
] as const) {
  const source = readSource(page[1]);
  expectSource(page[0], source, 'HistoryPageSilentRequestConfig');
  expectSource(page[0], source, 'getVitalDetailSilentRequestConfig');
  expectSource(page[0], source, 'custom: { toast: false, catch: true }');
  expectSource(page[0], source, '}, getVitalDetailSilentRequestConfig());');
}

expectSource('sleep page', readSource('src/homeDetail/sleepPage/sleepPage.vue'), 'await getSleepDetailInfo(currentDate);');
expectSource('sleep page', readSource('src/homeDetail/sleepPage/sleepPage.vue'), 'await getTemperatureDetail(currentDate);');
expectSource('activity page', readSource('src/homeDetail/exercise/exercise.vue'), 'await getMotionOverviewData(currentDate);');
expectSource('stress page', readSource('src/homeDetail/relaxStatus/relaxStatus.vue'), 'await getStressDetail(currentDate);');

const vitalSignsPage = readSource('src/homeDetail/vitalSigns/vitalSigns.vue');
expectSource('vital signs page', vitalSignsPage, 'await syncVitalSignsHistorySafely();');
expectSource('vital signs page', vitalSignsPage, 'await getRatDetail(currentDate);');
expectSource('vital signs page', vitalSignsPage, 'await getExtendedVitalSignData().catch(() => undefined);');

const awarenessPage = readSource('src/pages/awareness/awareness.vue');
expectSource('awareness page RW home sync', awarenessPage, 'useRingBusinessHistoryPageSync');
expectSource('awareness page RW home sync', awarenessPage, 'RW_HOME_HISTORY_DATA_TYPES');
for (const dataType of ['lastData', 'sleepData', 'activity', 'heartRate', 'bloodOxygen', 'hrv', 'temperature', 'skinTemperature', 'bloodSugar', 'bloodPressure']) {
  expectSource('awareness page RW home sync', awarenessPage, `'${dataType}'`);
}
expectSourceCompact('awareness page RW home sync', awarenessPage, 'allowRwDeviceSync: true');
expectSource('awareness page RW home sync', awarenessPage, 'business-sync-background-start');
expectSource('awareness page RW home sync', awarenessPage, 'business-sync-background-result');
expectSource('awareness page RW home sync', awarenessPage, 'business-sync-background-failed');
expectSource('awareness page RW home sync', awarenessPage, 'pull-down-refresh-error');
expectSource('awareness page RW home sync', awarenessPage, 'isAwarenessNetworkTimeoutError');
expectSource('awareness page RW home sync', awarenessPage, 'rawError: getAwarenessRawError(error)');
expectSource('awareness page RW home sync', awarenessPage, 'syncRwHomeDeviceTimeBeforeHistory');
expectSource('awareness page RW home sync', awarenessPage, 'updateDeviceTime(now, timezone)');
expectSource('awareness page RW home sync', awarenessPage, 'device-time-sync-start');
expectSource('awareness page RW home sync', awarenessPage, 'device-time-sync-result');
expectSource('awareness page RW home sync', awarenessPage, 'device-time-sync-failed');
expectSource('awareness page RW home sync', awarenessPage, 'device-time-sync-skip');
expectSource('awareness page RW home sync', awarenessPage, 'local-data-upload-skip-rw-bridge');
expectSource('awareness page RW home sync', awarenessPage, 'rw-home-bridge-owns-upload');
expectSource('awareness page RW home sync', awarenessPage, 'restore-rw-home-sync-started');
expectSource('awareness page RW home sync', awarenessPage, 'bluetooth-ready-rw-home-sync-started');
expectSource('awareness page RW home sync', awarenessPage, 'reconnect-result-rw-home-sync-started');
expectSource('awareness page RW home sync', awarenessPage, "void syncRwHomeHistoryAndRefreshOverview(getSelectedDetailDate(), 'page-show')");
expectSource('awareness page RW home sync', awarenessPage, "await syncRwHomeHistoryAndRefreshOverview(formatLocalDate(new Date()), 'pull-down-refresh', { force: true })");

const devicePage = readSource('src/pagesA/mines/device.vue');

expectSource('device page diagnostics', devicePage, "appendRingDiagnosticLog('RW DEVICE'");
for (const event of [
  'page-show',
  'bound-info-loaded',
  'device-info-refresh-start',
  'device-info-refresh-result',
  'device-info-refresh-failed',
  'battery-read-start',
  'battery-read-result',
  'battery-read-failed',
  'version-read-start',
  'version-read-result',
  'version-read-failed'
]) {
  expectSource('device page diagnostics', devicePage, event);
}
