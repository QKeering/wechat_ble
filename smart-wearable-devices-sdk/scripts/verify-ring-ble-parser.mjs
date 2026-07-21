import { readdirSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const outdir = join(process.cwd(), 'node_modules', '.cache', 'ring-ble-verify');
const debug = process.env.RING_BLE_VERIFY_DEBUG === '1';
const stepTimeoutMs = Number(process.env.RING_BLE_VERIFY_STEP_TIMEOUT_MS || 300000);
const entries = [
  ['parser', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'legacy', 'parser.parity.ts')],
  ['protocol', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'legacy', 'protocol.parity.ts')],
  ['adapter', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'legacy', 'adapter.parity.ts')],
  ['workflows', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'legacy', 'workflows.parity.ts')],
  ['protocol-registry', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'protocolRegistry.parity.ts')],
  ['store-bridge', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'storeBridge.parity.ts')],
  ['business-metrics', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'businessMetrics.parity.ts')],
  ['manifest', join(process.cwd(), 'src', 'manifest.parity.ts')],
  ['source-encoding', join(process.cwd(), 'src', 'sourceEncoding.parity.ts')],
  ['app-lifecycle', join(process.cwd(), 'src', 'app.lifecycle.parity.ts')],
  ['ring-api', join(process.cwd(), 'src', 'api', 'ringDevice.parity.ts')],
  ['legacy-device-api', join(process.cwd(), 'src', 'common', 'api', 'device.parity.ts')],
  ['family-api', join(process.cwd(), 'src', 'common', 'api', 'family.parity.ts')],
  ['use-ring-ble-store-sdk', join(process.cwd(), 'src', 'composables', 'useRingBleStoreSdk.parity.ts')],
  ['use-ring-ble', join(process.cwd(), 'src', 'composables', 'useRingBLE.parity.ts')],
  ['rw-foreground-measurement', join(process.cwd(), 'src', 'composables', 'useRwForegroundMeasurement.parity.ts')],
  ['ring-metric-readings', join(process.cwd(), 'src', 'composables', 'useRingMetricReadings.parity.ts')],
  ['ring-history-upload', join(process.cwd(), 'src', 'composables', 'useRingHistoryUpload.parity.ts')],
  ['business-controller', join(process.cwd(), 'src', 'composables', 'useRingBusinessController.parity.ts')],
  ['business-data', join(process.cwd(), 'src', 'composables', 'useRingBusinessData.parity.ts')],
  ['business-history-pages', join(process.cwd(), 'src', 'pages', 'businessHistoryPageSync.parity.ts')],
  ['legacy-routes', join(process.cwd(), 'src', 'pages', 'legacyRoutes.parity.ts')],
  ['ble-error', join(process.cwd(), 'src', 'utils', 'bleError.parity.ts')],
  ['health-text', join(process.cwd(), 'src', 'utils', 'healthText.parity.ts')],
  ['request-layer', join(process.cwd(), 'src', 'utils', 'request.parity.ts')],
  ['ring-binding', join(process.cwd(), 'src', 'utils', 'ringBinding.parity.ts')],
  ['ring-connection-status', join(process.cwd(), 'src', 'utils', 'ringConnectionStatus.parity.ts')],
  ['ring-store', join(process.cwd(), 'src', 'stores', 'ring.parity.ts')],
  ['user-store', join(process.cwd(), 'src', 'stores', 'user.parity.ts')],
  ['rw-protocol', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'rw', 'protocol.parity.ts')],
  ['rw-parser', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'rw', 'parser.parity.ts')],
  ['rw-adapter', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'rw', 'adapter.parity.ts')],
  ['rw-history', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'rw', 'history.parity.ts')],
  ['qkeer-v2-adapter', join(process.cwd(), 'src', 'sdk', 'ring-ble', 'qkeer-v2', 'adapter.parity.ts')],
  ['ota-manager', join(process.cwd(), 'src', 'sdk', 'ring-ota', 'manager.parity.ts')]
];

const findParityFiles = (dir) => {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      found.push(...findParityFiles(fullPath));
    } else if (entry.endsWith('.parity.ts')) {
      found.push(fullPath);
    }
  }
  return found;
};

const registeredParityFiles = new Set(entries.map(([, entryPoint]) => entryPoint));
const sourceParityFiles = findParityFiles(join(process.cwd(), 'src'));
const missingParityFiles = sourceParityFiles.filter((file) => !registeredParityFiles.has(file));

if (missingParityFiles.length > 0) {
  throw new Error(`Ring BLE verifier is missing parity entries: ${missingParityFiles.join(', ')}`);
}

await mkdir(outdir, { recursive: true });

const runRwLogAnalyzerSmokeTest = () => {
  const metrics = [
    { name: 'heart_rate', key: 0x0503, parsed: { heartRate: 46 }, value: 46 },
    { name: 'blood_oxygen', key: 0x0509, parsed: { metrics: { spo2: 98 } }, value: 98 },
    { name: 'temperature', key: 0x0508, parsed: { data: { bodyTemperature: 36.5 } }, value: 36.5 },
    { name: 'hrv', key: 0x050a, parsed: { metrics: { hrv: 52 } }, value: 52 },
    { name: 'stress', key: 0x050d, parsed: { data: { stressIndex: 23 } }, value: 23 },
    { name: 'blood_pressure', key: 0x0504, parsed: { data: { systolic: 120, diastolic: 80 } }, value: '120/80' },
    { name: 'blood_sugar', key: 0x0510, parsed: { metrics: { glucose: 5.6 } }, value: 5.6 }
  ];
  const lines = ['[12:00:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}'];
  let lineIndex = 1;
  for (const metric of metrics) {
    const timePrefix = `12:00:${String(lineIndex).padStart(2, '0')}`;
    const parsed = { type: 'rw_health_data', name: metric.name, key: metric.key, ...metric.parsed };
    const pageParsed = { ...parsed };
    lines.push(`[${timePrefix}.000] [RW MINE] single-metric-start {"target":"${metric.name}","expectedKey":${metric.key}}`);
    lines.push(`[${timePrefix}.100] [RW BLE] rx-parsed {"parsed":[${JSON.stringify(parsed)}]}`);
    lines.push(`[${timePrefix}.200] [RW BLE] wait-cache-hit {"timeoutMs":45000,"parsed":${JSON.stringify(parsed)}}`);
    lines.push(
      `[${timePrefix}.300] [RW MINE] single-metric-direct-store-write {"target":"${metric.name}","expectedKey":${metric.key},"receivedCount":0,"normalizedCount":0,"ringReceivedCount":${lineIndex},"ringNormalizedCount":${lineIndex},"parsed":${JSON.stringify(pageParsed)}}`
    );
    lines.push(
      `[${timePrefix}.400] [RW MINE] single-metric-direct-hit {"target":"${metric.name}","expectedKey":${metric.key},"receivedCount":0,"normalizedCount":0,"ringReceivedCount":${lineIndex},"ringNormalizedCount":${lineIndex},"parsed":${JSON.stringify(pageParsed)}}`
    );
    lines.push(
      `[${timePrefix}.500] [RW MINE] single-metric-diagnostic-log-hit {"target":"${metric.name}","expectedKey":${metric.key},"receivedCount":0,"normalizedCount":0,"ringReceivedCount":${lineIndex},"ringNormalizedCount":${lineIndex},"parsed":${JSON.stringify(pageParsed)}}`
    );
    lineIndex += 1;
  }
  const log = lines.join('\n');
  const result = spawnSync(process.execPath, ['scripts/analyze-rw-ble-log.mjs', `--expect-metric=${metrics.map((metric) => metric.name).join(',')}`], {
    cwd: process.cwd(),
    input: log,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`RW log analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-metric-checks: PASS',
    'page-direct-hit: FOUND',
    'page-diagnostic-log-hit: FOUND',
    'diagnosticHit=1',
    'ble-wait-cache-hit: FOUND',
    ...metrics.map((metric) => `${metric.name}: PASS`),
    'store=user(received=0,normalized=0) ring(received=1,normalized=1)'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW log analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistorySmokeTest = () => {
  const log = [
    '[12:01:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:01:00.100] [RW FLOW] history-sync-start {"dataTypes":["sleepData"],"readAll":false}',
    '[12:01:01.000] [RW HISTORY] history-initial-timeout {"dataTypes":["sleepData"],"timeoutMs":20000}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=sleep', '--no-fail'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW history analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: FAIL (sleepData)',
    'history-initial-timeout',
    'history initial wait timed out after local/native/file-list attempts',
    '0x31/0x41/0x71'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistoryQueueSmokeTest = () => {
  const log = [
    '[12:06:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:06:00.050] [RW FLOW] compat-history-queue-enqueue {"dataTypes":["sleep"],"queuedBehind":1,"queueDepth":2}',
    '[12:06:00.060] [RW FLOW] compat-history-queue-start {"dataTypes":["sleep"],"queuedBehind":1,"queueDepth":2}',
    '[12:06:00.100] [RW FLOW] history-sync-start {"dataTypes":["sleep"],"readAll":false}',
    '[12:06:00.120] [RW BLE] tx {"hex":"000101000000000000000931005d566a269c576a23","label":"history/qkeer-v2-sleep-list"}',
    '[12:06:00.180] [RW HISTORY] native-list-received {"sourceType":"qkeer_v2_sleep_list","dataType":"sleep","status":"success","recordCount":1,"totalNum":1}',
    '[12:06:00.200] [RW FLOW] compat-history-queue-result {"dataTypes":["sleep"],"queuedBehind":1,"queueDepth":2}',
    '[12:06:00.300] [RW FLOW] history-sync-result {"dataTypes":["sleep"],"status":"success","recordCount":1,"uploaded":true}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=sleep'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW history queue analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: PASS',
    'sleepData: PASS',
    'queue enqueues=1 starts=1 results=1 failures=0 maxQueueDepth=2 maxQueuedBehind=1',
    'compat-history-queue-enqueue',
    'queueDepth=2',
    'queuedBehind=1',
    'Multiple RW history reads were queued.'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history queue analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerMineManualHistorySmokeTest = () => {
  const log = [
    '[12:06:30.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:06:30.050] [RW MINE] manual-history-sync-start {"historyKey":"sleep","historyLabel":"\\u7761\\u7720","dataTypes":["sleepData"]}',
    '[12:06:30.300] [RW MINE] manual-history-sync-result {"historyKey":"sleep","historyLabel":"\\u7761\\u7720","dataTypes":["sleepData"],"summary":{"status":"success","recordCount":2,"uploaded":true}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=sleep'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW Mine manual history analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: PASS',
    'sleepData: PASS',
    'manual starts=1 results=1 failures=0',
    'manualStarts=1',
    'manualSync=1',
    'records=2',
    'uploaded=true',
    'manual-history-sync-result'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW Mine manual history analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerMineManualMetricSmokeTest = () => {
  const log = [
    '[12:06:40.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:06:40.050] [RW MINE] manual-metric-start {"metric":"heart_rate","label":"heart rate","expectedKey":1283}',
    '[12:06:40.300] [RW MINE] manual-metric-result {"metric":"heart_rate","label":"heart rate","expectedKey":1283,"value":72,"displayText":"72 bpm","parsed":{"type":"rw_health_data","name":"heart_rate","key":1283,"heartRate":72,"rawHex":"ab110003050348"}}',
    '[12:06:41.050] [RW MINE] manual-metric-start {"metric":"blood_oxygen","label":"blood oxygen","expectedKey":1289}',
    '[12:06:41.300] [RW MINE] manual-metric-result {"metric":"blood_oxygen","label":"blood oxygen","expectedKey":1289,"value":98,"displayText":"98%","parsed":{"type":"rw_health_data","name":"blood_oxygen","key":1289,"bloodOxygen":98,"rawHex":"ab110003050962"}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-metric=heart_rate,blood_oxygen'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    throw new Error(`RW Mine manual metric analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-metric-checks: PASS',
    'page-diagnostic-log-hit: FOUND',
    'heart_rate: PASS',
    'blood_oxygen: PASS',
    'manual-metric-result',
    'diagnosticHit=1',
    '98@L5'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW Mine manual metric analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerNativeVitalHistorySmokeTest = () => {
  const log = [
    '[12:02:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:02:00.050] [RW FLOW] history-sync-start {"dataTypes":["vital"],"readAll":false}',
    '[12:02:00.100] [RW BLE] tx {"hex":"000000000000000000000041","label":"history/qkeer-v2/41"}',
    '[12:02:00.200] [RW HISTORY] history-native-list-fallback {"dataTypes":["vital"],"commands":["health"]}',
    '[12:02:00.300] [RW HISTORY] native-list-received {"sourceType":"qkeer_v2_health_list","dataType":"vital","status":"success","recordCount":1,"totalNum":1}',
    '[12:02:00.400] [RW FLOW] history-sync-result {"dataTypes":["vital"],"status":"success","recordCount":1,"uploaded":true}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=vital'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW native vital history analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: PASS',
    'vital: PASS',
    'nativeList=1',
    'records=1',
    'uploaded=true',
    'sourceType=qkeer_v2_health_list',
    'dataType=vital'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW native vital history analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistoryPageUploadSmokeTest = () => {
  const log = [
    '[12:02:30.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:02:30.050] [RW PAGE] history-page-sync-start {"dataTypes":["vital"],"date":"2026-01-01"}',
    '[12:02:30.100] [RW BLE] tx {"hex":"ab010003050310","label":"history/ab-key/heart-rate"}',
    '[12:02:30.300] [RW PAGE] history-page-sync-result {"dataTypes":["vital"],"status":"success","recordCount":1,"uploaded":true}',
    '[12:02:30.500] [RW PAGE] history-page-upload-result {"dataTypes":["vital"],"submitted":true,"count":1,"rawRecordCount":1,"submitRecordCount":1,"maxTimestamp":1767229261}',
    '[12:02:30.800] [RW PAGE] history-page-query-result {"page":"vitalSigns","date":"2026-01-01","endpoint":"heart-rate-detail","response":{"hasResponse":true,"itemCount":1,"payloadKeys":["list"],"valueHints":{"heartRate":72}}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=vital'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW history page upload analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: PASS',
    'vital: PASS',
    'pageStarts=1',
    'pageSync=1',
    'pageUpload=1',
    'page queries results=1 failures=0',
    'endpoint=heart-rate-detail',
    'items=1',
    'rawRecords=1',
    'submitRecords=1',
    'records=1',
    'uploaded=true',
    'maxTimestamp=1767229261'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history page upload analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistoryPageNormalizeEmptySmokeTest = () => {
  const log = [
    '[12:02:45.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:02:45.050] [RW PAGE] history-page-sync-start {"dataTypes":["vital"],"date":"2026-01-01"}',
    '[12:02:45.300] [RW PAGE] history-page-sync-result {"dataTypes":["vital"],"status":"success","recordCount":1}',
    '[12:02:45.500] [RW PAGE] history-page-upload-result {"dataTypes":["vital"],"submitted":false,"count":0,"rawRecordCount":1,"submitRecordCount":0,"maxTimestamp":0}',
    '[12:02:45.800] [RW PAGE] history-page-query-result {"page":"vitalSigns","date":"2026-01-01","endpoint":"blood-oxygen-detail","response":{"hasResponse":true,"itemCount":0,"payloadKeys":["list"],"valueHints":{}}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=vital', '--no-fail'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW history page normalize-empty analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: FAIL (vital)',
    'vital: FAIL',
    'rawRecords=1',
    'submitRecords=0',
    'page queries results=1 failures=0',
    'endpoint=blood-oxygen-detail',
    'items=0',
    'uploaded=false',
    'missing-submit-records',
    'records-not-submittable'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history page normalize-empty analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistoryPageUploadThenEmptyQuerySmokeTest = () => {
  const log = [
    '[12:02:50.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:02:50.050] [RW PAGE] history-page-sync-start {"dataTypes":["vital"],"date":"2026-01-01"}',
    '[12:02:50.300] [RW PAGE] history-page-sync-result {"dataTypes":["vital"],"status":"success","recordCount":1}',
    '[12:02:50.500] [RW PAGE] history-page-upload-result {"dataTypes":["vital"],"submitted":true,"count":1,"rawRecordCount":1,"submitRecordCount":1,"maxTimestamp":1767229261}',
    '[12:02:50.800] [RW PAGE] history-page-query-result {"page":"vitalSigns","date":"2026-01-01","endpoint":"blood-oxygen-detail","response":{"hasResponse":true,"itemCount":0,"payloadKeys":["list"],"valueHints":{}}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=vital'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    throw new Error(`RW history page upload + empty query analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: PASS',
    'page queries results=1 failures=0',
    'endpoint=blood-oxygen-detail',
    'items=0',
    'History upload succeeded but backend detail query returned no items',
    'backend aggregation/date offset/page field consumption'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history page upload + empty query analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistoryPageQueryFailedSmokeTest = () => {
  const log = [
    '[12:02:55.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:02:55.050] [RW PAGE] history-page-sync-start {"dataTypes":["vital"],"date":"2026-01-01"}',
    '[12:02:55.300] [RW PAGE] history-page-sync-result {"dataTypes":["vital"],"status":"success","recordCount":1}',
    '[12:02:55.500] [RW PAGE] history-page-upload-result {"dataTypes":["vital"],"submitted":true,"count":1,"rawRecordCount":1,"submitRecordCount":1,"maxTimestamp":1767229261}',
    '[12:02:55.800] [RW PAGE] history-page-query-failed {"page":"vitalSigns","date":"2026-01-01","endpoint":"blood-oxygen-detail","error":"500 Internal Server Error"}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=vital'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    throw new Error(`RW history page query failed analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: PASS',
    'page queries results=0 failures=1',
    'status: page-query-failed',
    'endpoint=blood-oxygen-detail',
    'history-page-query-failed'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history page query failed analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerLastDataHistorySmokeTest = () => {
  const log = [
    '[12:03:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:03:00.050] [RW FLOW] history-sync-start {"dataTypes":["sleepData"],"readAll":false}',
    '[12:03:00.100] [RW BLE] tx {"hex":"000000000000000000000070","label":"history/native-last-data"}',
    '[12:03:00.200] [RW BLE] tx {"hex":"000000000000000000000070"}',
    '[12:03:00.250] [RW HISTORY] history-native-last-data-fallback {"dataTypes":["sleepData"],"commands":["lastData"]}',
    '[12:03:00.300] [RW HISTORY] native-list-received {"sourceType":"qkeer_v2_last_data","dataType":"sleep","status":"success","recordCount":1,"totalNum":1}',
    '[12:03:00.400] [RW FLOW] history-sync-result {"dataTypes":["sleepData"],"status":"success","recordCount":1,"uploaded":true}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=sleep'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW LastData history analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-history-checks: PASS',
    'sleepData: PASS',
    'history/native-last-data',
    'history/qkeer-v2/70',
    'history-native-last-data-fallback',
    'sourceType=qkeer_v2_last_data',
    'records=1',
    'uploaded=true'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW LastData history analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerDevicePageSmokeTest = () => {
  const log = [
    '[12:04:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:04:00.100] [RW DEVICE] page-show {"snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","page":"device","connected":true,"ready":true,"batteryText":"-","firmwareText":"-"}}',
    '[12:04:00.200] [RW DEVICE] battery-read-start {"snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","page":"device","connected":true,"ready":true}}',
    '[12:04:09.300] [RW DEVICE] battery-read-failed {"message":"battery read timed out","snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","page":"device","connected":true,"ready":true}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW device page analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'Device Page Events',
    'RW DEVICE battery-read-failed',
    'Device page failure at battery-read-failed: battery read timed out',
    'Sources',
    'RW DEVICE'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW device page analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerDeviceInfoGateSmokeTest = () => {
  const log = [
    '[12:04:30.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347","snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","connected":true,"ready":true,"storeConnected":true,"userConnected":true,"reconnectStatus":"success","deviceId":"3E:00:00:00:05:1B","name":"SY03","protocol":"rw","serviceId":"0000A00A-0000-1000-8000-00805F9B34FB","cmdCharId":"0000B002-0000-1000-8000-00805F9B34FB","dataCharId":"0000B003-0000-1000-8000-00805F9B34FB","notifyEnabled":true}}',
    '[12:04:31.000] [RW DEVICE] battery-read-result {"buildTag":"rw-visible-build-tag-20260719-347","value":78,"snapshot":{"batteryText":"78%","firmwareText":"-","softwareText":"-"}}',
    '[12:04:32.000] [RW DEVICE] version-read-result {"buildTag":"rw-visible-build-tag-20260719-347","firmware":"1.2.3","software":"2.3.4","snapshot":{"batteryText":"78%","firmwareText":"1.2.3","softwareText":"2.3.4"}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW device-info gate analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'RW/L19 Gate',
    'connection: PASS',
    'device-info: PASS evidence=battery=ok@L2 firmware=ok@L3 software=ok@L3'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW device-info gate analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistoryWaitWindowSmokeTest = () => {
  const log = [
    '[12:05:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:05:00.050] [RW FLOW] history-sync-start {"dataTypes":["sleepData"],"readAll":false}',
    '[12:05:00.100] [RW HISTORY] history-preflight-start {"dataTypes":["sleepData"],"delayMs":500,"responseTimeoutMs":2000}',
    '[12:05:02.150] [RW HISTORY] history-preflight-timeout {"dataTypes":["sleepData"],"delayMs":500,"responseTimeoutMs":2000}',
    '[12:05:02.200] [RW HISTORY] history-initial-wait-start {"dataTypes":["sleepData"],"timeoutMs":30000}',
    '[12:05:05.200] [RW HISTORY] history-initial-file-list-fallback {"dataTypes":["sleepData"],"retryDelayMs":3000}',
    '[12:05:05.220] [RW HISTORY] history-fallback-wait-start {"dataTypes":["sleepData"],"timeoutMs":30000,"waitFor":"rw_file_list|legacy_local_data|native_history_list"}',
    '[12:05:05.300] [RW HISTORY] history-native-list-fallback {"dataTypes":["sleepData"],"commands":["sleep"],"commandIntervalMs":900}',
    '[12:05:12.300] [RW HISTORY] history-native-list-wait-timeout {"dataTypes":["sleepData"],"waitMs":7000,"unexpectedResponseCount":0}',
    '[12:05:12.350] [RW HISTORY] history-native-last-data-fallback {"dataTypes":["sleepData"]}',
    '[12:05:19.350] [RW HISTORY] history-last-data-wait-timeout {"dataTypes":["sleepData"],"waitMs":7000,"unexpectedResponseCount":0}',
    '[12:05:29.500] [RW HISTORY] history-initial-timeout {"dataTypes":["sleepData"],"timeoutMs":30000,"message":"RW history response timeout after 30000ms"}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=sleep', '--no-fail'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW history wait-window analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'History Wait Windows',
    'preflight: start=1 response=0 timeout=1 delayMs=500 responseTimeoutMs=2000',
    'native-list: fallback=1 response=0 timeout=1 latestWaitMs=7000 latest=timeout commands=sleep intervalMs=900',
    'last-data: fallback=1 response=0 timeout=1 latestWaitMs=7000 latest=timeout',
    'unexpected-history-responses: 0',
    'sleepData: FAIL'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history wait-window analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerHistoryCompactReportSmokeTest = () => {
  const log = [
    '[12:05:40.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:05:40.010] [RW MINE] diagnostic-history-report {"tag":"rw-visible-build-tag-20260719-347","n":12,"counts":{"history-page-sync-start":1,"history-ab-key-fallback":1,"history-ab-key-response":2,"history-ab-key-timeout":1,"history-page-upload-result":1},"latest":{"src":"PAGE","e":"history-page-upload-result","page":"vital","types":["vital"],"records":2,"rawRecords":2,"submitRecords":1,"uploaded":true,"elapsedMs":6400,"phase":"final","queueDepth":1,"queuedBehind":0,"unexpectedResponseCount":1},"upload":{"src":"PAGE","e":"history-page-upload-result","page":"vital","types":["vital"],"records":2,"rawRecords":2,"submitRecords":1,"uploaded":true,"elapsedMs":6400},"recent":[{"src":"HISTORY","e":"history-ab-key-response","types":["vital"],"records":2,"phase":"pre-native","responseWaitMs":1200},{"src":"PAGE","e":"history-page-upload-result","page":"vital","types":["vital"],"records":2,"rawRecords":2,"submitRecords":1,"uploaded":true,"elapsedMs":6400,"queueDepth":1,"queuedBehind":0,"unexpectedResponseCount":1}]}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-history=vital'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW history compact report analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'diagnostic-report records=2 uploaded=true',
    'compact reports=1',
    'latest-compact-report:',
    'reportEvents=12',
    'elapsedMs=6400',
    'phase=final',
    'rawRecords=2',
    'submitRecords=1',
    'queueDepth=1',
    'queuedBehind=0',
    'unexpected=1',
    'vital: PASS',
    'compact=1'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW history compact report analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerAbHistoryReadContinueSmokeTest = () => {
  const log = [
    '[12:05:50.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:05:50.010] [RW HISTORY] history-ab-key-fallback {"phase":"pre-native","commands":["temperature"],"responseWaitMs":1200}',
    '[12:05:51.220] [RW HISTORY] history-ab-key-timeout {"phase":"pre-native","attempt":"read","flag":16,"key":1288,"label":"temperature","error":"RW parsed data wait timeout after 1200ms."}',
    '[12:05:51.230] [RW HISTORY] history-ab-key-retry-continue {"phase":"pre-native","reason":"timeout","key":1288,"label":"temperature","previousAttempt":"read","nextAttempt":"read-continue"}',
    '[12:05:51.900] [RW HISTORY] history-ab-key-response {"phase":"pre-native","attempt":"read-continue","flag":17,"key":1288,"label":"temperature","hasPayload":true,"response":{"type":"rw_health_data","key":1288,"flag":17,"name":"temperature","recordCount":1,"rawHex":"ab1100090508016a576a269810"}}',
    '[12:05:51.920] [RW HISTORY] history-ab-key-result {"phase":"pre-native","response":{"type":"rw_ab_health_history","status":"success","recordCount":1,"sourceResponses":[{"type":"rw_health_data","key":1288,"flag":17,"recordCount":1}]}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW AB history read-continue analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'history-ab-key-retry-continue',
    'abKeyRetryContinues=1',
    'retryContinue=1',
    'attempt=read-continue',
    'flag=17',
    'records=1',
    'business-history-upload: NOT_PROVEN'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW AB history read-continue analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};
const runRwLogAnalyzerProtocolProbeSmokeTest = () => {
  const log = [
    '[12:06:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:06:00.050] [RW MINE] protocol-probe-start {"buildTag":"rw-visible-build-tag-20260719-347","commandCount":2,"requiredCommandCount":1,"optionalCommandCount":1}',
    '[12:06:00.100] [RW MINE] protocol-probe-command-start {"index":1,"total":2,"key":"time/read","label":"read time","family":"legacy-config","required":false,"expected":"device_time or rw_time_ack","hex":"00011001","timeoutMs":8000}',
    '[12:06:00.200] [RW BLE] tx {"hex":"00011001","label":"protocol-probe/time/read"}',
    '[12:06:00.500] [RW MINE] protocol-probe-command-response {"index":1,"total":2,"key":"time/read","label":"read time","family":"legacy-config","required":false,"expected":"device_time or rw_time_ack","hex":"00011001","elapsedMs":400,"parsed":{"type":"device_time","deviceTimestamp":1720000000000,"rawHex":"0001100100"}}',
    '[12:06:01.000] [RW MINE] protocol-probe-command-start {"index":2,"total":2,"key":"battery/read","label":"read battery","family":"ab-core","required":true,"expected":"battery","hex":"ab010003020310","timeoutMs":8000}',
    '[12:06:01.100] [RW BLE] tx {"hex":"ab010003020310","label":"protocol-probe/battery/read"}',
    '[12:06:09.100] [RW MINE] protocol-probe-command-timeout {"index":2,"total":2,"key":"battery/read","label":"read battery","family":"ab-core","required":true,"expected":"battery","hex":"ab010003020310","elapsedMs":8100,"timeoutMs":8000,"wrote":true,"rawMessage":"RW parsed data wait timeout after 8000ms."}',
    '[12:06:09.200] [RW MINE] protocol-probe-summary {"buildTag":"rw-visible-build-tag-20260719-347","okCount":1,"failedCount":1,"requiredOkCount":0,"requiredFailedCount":1,"requiredCommandCount":1,"optionalOkCount":1,"optionalFailedCount":0,"optionalCommandCount":1,"failed":[{"key":"battery/read","label":"read battery","family":"ab-core","required":true,"timeout":true}]}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW protocol probe analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'protocol-probe: failed required=0/1 requiredFailed=1 optionalNoResponse=0 total=2',
    'Protocol Probe',
    'families:',
    'ab-core: ok=0 failed=1 planned=0 required=1 optional=0 total=1',
    'legacy-config: ok=1 failed=0 planned=0 required=0 optional=1 total=1',
    'failed-required-commands: battery/read(timeout)',
    'optional-no-response: -',
    'time/read: RESPONSE optional',
    'battery/read: TIMEOUT required',
    'Protocol probe found required command no-response/error: battery/read:timeout',
    'RW/L19 Gate',
    'core-protocol: FAIL evidence=required=0/1 failed=battery/read:timeout'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW protocol probe analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerProtocolProbePlanSmokeTest = () => {
  const log = [
    '[12:07:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:07:00.050] [RW MINE] protocol-probe-start {"buildTag":"rw-visible-build-tag-20260719-347","commandCount":3,"requiredCommandCount":1,"optionalCommandCount":2}',
    '[12:07:00.080] [RW MINE] protocol-probe-plan {"buildTag":"rw-visible-build-tag-20260719-347","commandCount":3,"requiredCommandCount":1,"optionalCommandCount":2,"required":[{"index":1,"key":"battery/read","label":"read battery","family":"ab-core","required":true,"expected":"battery","timeoutMs":8000}],"optional":[{"index":2,"key":"history-key/heart-rate/read","label":"read heart-rate history","family":"ab-history-key","required":false,"expected":"rw_health_data:heart_rate","timeoutMs":8000},{"index":3,"key":"history/qkeer-v2-health-list","label":"read health history","family":"qkeer-v2-history","required":false,"expected":"qkeer_v2_health_list","timeoutMs":12000}],"families":{"ab-core":{"total":1,"required":1,"optional":0},"ab-history-key":{"total":1,"required":0,"optional":1},"qkeer-v2-history":{"total":1,"required":0,"optional":1}}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW protocol probe plan analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'protocol-probe: running-or-incomplete required=0/1 requiredFailed=0 optionalNoResponse=0 total=3',
    'Protocol probe started but no summary was copied. Copy logs after the protocol self-test finishes.',
    'ab-core: ok=0 failed=0 planned=1 required=1 optional=0 total=1',
    'ab-history-key: ok=0 failed=0 planned=1 required=0 optional=1 total=1',
    'qkeer-v2-history: ok=0 failed=0 planned=1 required=0 optional=1 total=1',
    'battery/read: PLANNED required',
    'history-key/heart-rate/read: PLANNED optional',
    'history/qkeer-v2-health-list: PLANNED optional'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW protocol probe plan analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerProtocolProbeSummaryCommandsSmokeTest = () => {
  const log = [
    '[12:07:30.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:07:30.050] [RW MINE] protocol-probe-summary {"buildTag":"rw-visible-build-tag-20260719-347","mode":"core","commandCount":4,"okCount":2,"failedCount":2,"requiredOkCount":2,"requiredFailedCount":1,"requiredCommandCount":3,"optionalOkCount":0,"optionalFailedCount":1,"optionalCommandCount":1,"requiredCommands":[{"i":1,"t":4,"k":"battery/read","f":"ab-core","r":1,"x":"battery","h":"ab010003020310","s":"ok","ms":320,"to":8000,"p":{"t":"battery","bat":78,"raw":"ab11000302034e"}},{"i":2,"t":4,"k":"firmware/read","f":"ab-core","r":1,"x":"firmware_version","h":"ab010003020410","s":"ok","ms":410,"to":8000,"p":{"t":"firmware_version","fw":"1.0.0","sw":"2.0.0","raw":"ab110003020400"}},{"i":3,"t":4,"k":"heart-rate/realtime-read","f":"ab-realtime","r":1,"x":"rw_health_data:heart_rate","h":"ab010003050310","s":"timeout","ms":45000,"a":4,"ac":4,"to":45000,"w":1,"m":"RW parsed data wait timeout after 45000ms."}],"failedCommands":[{"i":3,"t":4,"k":"heart-rate/realtime-read","f":"ab-realtime","r":1,"x":"rw_health_data:heart_rate","h":"ab010003050310","s":"timeout","ms":45000,"a":4,"ac":4,"to":45000,"w":1,"m":"RW parsed data wait timeout after 45000ms."},{"i":4,"t":4,"k":"history/qkeer-v2-health-list","f":"qkeer-v2-history","r":0,"x":"qkeer_v2_health_list","h":"000101000000000000000941005d566a269c576a13","s":"timeout","ms":12000,"to":12000,"w":1,"m":"RW parsed data wait timeout after 12000ms."}]}',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW protocol probe summary-commands analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'protocol-probe: failed required=2/3 requiredFailed=1 optionalNoResponse=1 total=4',
    'ab-core: ok=2 failed=0 planned=0 required=2 optional=0 total=2',
    'ab-realtime: ok=0 failed=1 planned=0 required=1 optional=0 total=1',
    'qkeer-v2-history: ok=0 failed=1 planned=0 required=0 optional=1 total=1',
    'battery/read: RESPONSE required',
    'firmware/read: RESPONSE required',
    'heart-rate/realtime-read: TIMEOUT required',
    'attempt=4/4 polls=4',
    'history/qkeer-v2-health-list: TIMEOUT optional',
    'failed-required-commands: heart-rate/realtime-read(timeout)',
    'Protocol probe found required command no-response/error: heart-rate/realtime-read:timeout'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW protocol probe summary-commands analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};const runRwLogAnalyzerProtocolProbeCompactReportSmokeTest = () => {
  const log = [
    '[12:08:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:08:00.010] [RW MINE] diagnostic-probe-report {"tag":"rw-visible-build-tag-20260719-347","n":3,"ok":1,"timeout":1,"error":0,"pending":1,"commands":[{"i":1,"t":3,"k":"battery/read","f":"ab-core","r":1,"x":"battery","h":"ab010003020310","s":"ok","ms":320,"to":8000,"p":{"t":"battery","bat":78,"raw":"ab11000302034e"}},{"i":2,"t":3,"k":"heart-rate/realtime-read","f":"ab-realtime","r":1,"x":"rw_health_data:heart_rate","h":"ab010003050310","s":"timeout","ms":45000,"a":4,"ac":4,"to":45000,"w":1,"m":"RW parsed data wait timeout after 45000ms."},{"i":3,"t":3,"k":"history/qkeer-v2-health-list","f":"qkeer-v2-history","r":0,"x":"qkeer_v2_health_list","h":"000101000000000000000941005d566a269c576a13","s":"pending","to":12000}]}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW protocol probe compact report analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'protocol-probe: running-or-incomplete required=1/2 requiredFailed=1 optionalNoResponse=1 total=3',
    'ab-core: ok=1 failed=0 planned=0 required=1 optional=0 total=1',
    'ab-realtime: ok=0 failed=1 planned=0 required=1 optional=0 total=1',
    'qkeer-v2-history: ok=0 failed=1 planned=0 required=0 optional=1 total=1',
    'battery/read: RESPONSE required',
    'heart-rate/realtime-read: TIMEOUT required',
    'attempt=4/4 polls=4',
    'Required realtime protocol read exhausted warm-up polling without a result: heart-rate/realtime-read attempt=4/4',
    'failed-required-commands: heart-rate/realtime-read(timeout)',
    'history/qkeer-v2-health-list: STARTED optional'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW protocol probe compact report analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerProtocolProbeTruncatedCompactReportSmokeTest = () => {
  const log = [
    '[12:08:30.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:08:30.010] [RW MINE] diagnostic-probe-report {"tag":"rw-visible-build-tag-20260719-347","truncated":true,"reason":"protocol-probe-start-missing","n":2,"ok":2,"timeout":0,"error":0,"pending":0,"commands":[{"i":21,"t":30,"k":"history-key/hrv/read","f":"ab-history-key","r":0,"x":"rw_health_data:hrv","h":"ab0100036d17050a10","s":"ok","ms":2140,"to":8000,"p":{"t":"rw_health_data_ack","n":"hrv","c":0,"raw":"ab1100036d17050a10"}},{"i":22,"t":30,"k":"history-key/stress/read","f":"ab-history-key","r":0,"x":"rw_health_data:stress","h":"ab0100035d15050d10","s":"ok","ms":596,"to":8000,"p":{"t":"rw_health_data_ack","n":"stress","c":0,"raw":"ab1100035d15050d10"}}]}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW protocol probe truncated compact report analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'protocol-probe: running-or-incomplete required=0/0 requiredFailed=0 optionalNoResponse=0 total=2',
    'truncated=yes',
    'truncated-reason: protocol-probe-start-missing',
    'Protocol probe report is truncated (protocol-probe-start-missing). Use listed tail commands for clues',
    'core-protocol: NOT_PROVEN evidence=required=0/0 failed=- truncated=true next=copy after full self-test summary appears',
    'history-key/hrv/read: RESPONSE optional',
    'history-key/stress/read: RESPONSE optional'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW protocol probe truncated compact report analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};
const runRwLogAnalyzerProtocolProbeCompactReportPassedSmokeTest = () => {
  const log = [
    '[12:09:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:09:00.010] [RW MINE] diagnostic-probe-report {"tag":"rw-visible-build-tag-20260719-347","part":1,"parts":2,"n":5,"ok":5,"timeout":0,"error":0,"pending":0,"commands":[{"i":1,"t":5,"k":"battery/read","f":"ab-core","r":1,"x":"battery","h":"ab010003020310","s":"ok","ms":320,"to":8000,"p":{"t":"battery","bat":78,"raw":"ab11000302034e"}},{"i":2,"t":5,"k":"firmware/read","f":"ab-core","r":1,"x":"firmware_version","h":"ab010003020410","s":"ok","ms":410,"to":8000,"p":{"t":"firmware_version","v":"1.0.0","fw":"1.0.0","sw":"2.0.0","raw":"ab110003020400"}}]}',
    '[12:09:00.020] [RW MINE] diagnostic-probe-report {"tag":"rw-visible-build-tag-20260719-347","part":2,"parts":2,"n":5,"ok":5,"timeout":0,"error":0,"pending":0,"commands":[{"i":3,"t":5,"k":"heart-rate/realtime-read","f":"ab-realtime","r":1,"x":"rw_health_data:heart_rate","h":"ab010003050310","s":"ok","ms":980,"to":12000,"p":{"t":"rw_health_data","n":"heart_rate","hr":72,"raw":"ab110003050348"}},{"i":4,"t":5,"k":"blood-oxygen/realtime-read","f":"ab-realtime","r":1,"x":"rw_health_data:blood_oxygen","h":"ab010003050910","s":"ok","ms":1100,"to":12000,"p":{"t":"rw_health_data","n":"blood_oxygen","spo2":98,"raw":"ab110003050962"}},{"i":5,"t":5,"k":"history/qkeer-v2-health-list","f":"qkeer-v2-history","r":0,"x":"qkeer_v2_health_list","h":"000101000000000000000941005d566a269c576a13","s":"ok","ms":1900,"to":12000,"p":{"t":"qkeer_v2_health_list","c":2,"raw":"000101"}}]}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW protocol probe compact report passed analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'protocol-probe: passed required=4/4 requiredFailed=0 optionalNoResponse=0 total=5',
    'ab-core: ok=2 failed=0 planned=0 required=2 optional=0 total=2',
    'ab-realtime: ok=2 failed=0 planned=0 required=2 optional=0 total=2',
    'qkeer-v2-history: ok=1 failed=0 planned=0 required=0 optional=1 total=1',
    'failed-required-commands: -',
    'optional-no-response: -',
    'battery/read: RESPONSE required',
    'history/qkeer-v2-health-list: RESPONSE optional',
    'RW/L19 Gate',
    'device-info: PASS evidence=battery=ok firmware=ok software=ok',
    'firmware/read: RESPONSE required',
    'blood-oxygen/realtime-read: RESPONSE required',
    'versions=fw=1.0.0,sw=2.0.0',
    'core-protocol: PASS evidence=required=4/4 failed=-'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW protocol probe compact report passed analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwLogAnalyzerReconnectRecoverySmokeTest = () => {
  const log = [
    '[12:05:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347","snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","page":"mine","connected":true,"ready":true,"storeConnected":true,"userConnected":true,"currentDevice":{"deviceId":"3E:00:00:00:05:1B","protocol":"rw","notifyEnabled":true}}}',
    '[12:05:00.100] [RW STORE] reconnect-scan-candidate {"found":false,"scannedDeviceCount":0,"scannedTail":[]}',
    '[12:05:04.000] [RW BLE] scan-found {"count":1,"devices":[{"deviceId":"3E:00:00:00:05:1B","name":"SY03","protocol":"rw"}]}',
    '[12:05:04.100] [RW STORE] reconnect-scan-candidate {"found":true,"candidate":{"deviceId":"3E:00:00:00:05:1B","name":"SY03","protocol":"rw"},"scannedDeviceCount":1}',
    '[12:05:05.000] [RW BLE] notify-primary-enabled {"deviceId":"3E:00:00:00:05:1B","serviceId":"0000A00A-0000-1000-8000-00805F9B34FB","characteristicId":"0000B003-0000-1000-8000-00805F9B34FB"}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW reconnect recovery analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'reconnect-candidate: FOUND',
    'connect-stage: ble-ready'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW reconnect recovery analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }

  const staleAction = 'Scan found devices but reconnect did not select a candidate';
  if (result.stdout.includes(staleAction)) {
    throw new Error(`RW reconnect recovery analyzer smoke test emitted stale action ${JSON.stringify(staleAction)}:\n${result.stdout}`);
  }
};

const runRwLogAnalyzerProtocolProbeWriteOkSmokeTest = () => {
  const log = [
    '[12:09:30.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:09:30.010] [RW MINE] protocol-probe-start {"buildTag":"rw-visible-build-tag-20260719-347","mode":"core","commandCount":3,"requiredCommandCount":3}',
    '[12:09:30.020] [RW MINE] protocol-probe-command-start {"index":1,"total":3,"key":"heart-rate/control-enable","label":"heart-rate enable","family":"ab-realtime","required":true,"expected":"rw_health_data_control_ack:heart_rate enable","hex":"ab010006f7ee060900030501","timeoutMs":8000,"writeOnlyOk":true}',
    '[12:09:30.030] [RW MINE] protocol-probe-command-write-ok {"index":1,"total":3,"key":"heart-rate/control-enable","label":"heart-rate enable","family":"ab-realtime","required":true,"expected":"rw_health_data_control_ack:heart_rate enable","hex":"ab010006f7ee060900030501","elapsedMs":25,"timeoutMs":8000}',
    '[12:09:30.040] [RW MINE] protocol-probe-command-start {"index":2,"total":3,"key":"heart-rate/realtime-read","label":"heart-rate realtime","family":"ab-realtime","required":true,"expected":"rw_health_data:heart_rate key=0x0503 via app-sdk-ab-crc-read","hex":"ab0100033d11050310","timeoutMs":45000}',
    '[12:09:31.000] [RW MINE] protocol-probe-command-response {"index":2,"total":3,"key":"heart-rate/realtime-read","label":"heart-rate realtime","family":"ab-realtime","required":true,"expected":"rw_health_data:heart_rate key=0x0503 via app-sdk-ab-crc-read","hex":"ab0100033d11050310","elapsedMs":960,"timeoutMs":45000,"parsed":{"type":"rw_health_data","name":"heart_rate","heartRate":72,"rawHex":"ab1100033d11050310"}}',
    '[12:09:31.010] [RW MINE] protocol-probe-command-start {"index":3,"total":3,"key":"heart-rate/control-disable","label":"heart-rate disable","family":"ab-realtime","required":true,"expected":"rw_health_data_control_ack:heart_rate disable","hex":"ab010006372f060900030500","timeoutMs":8000,"writeOnlyOk":true}',
    '[12:09:31.020] [RW MINE] protocol-probe-command-write-ok {"index":3,"total":3,"key":"heart-rate/control-disable","label":"heart-rate disable","family":"ab-realtime","required":true,"expected":"rw_health_data_control_ack:heart_rate disable","hex":"ab010006372f060900030500","elapsedMs":22,"timeoutMs":8000}',
    '[12:09:31.030] [RW MINE] protocol-probe-summary {"buildTag":"rw-visible-build-tag-20260719-347","mode":"core","commandCount":3,"okCount":3,"failedCount":0,"requiredOkCount":3,"requiredFailedCount":0,"requiredCommandCount":3,"optionalOkCount":0,"optionalFailedCount":0,"optionalCommandCount":0}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW protocol probe write-ok analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'protocol-probe: passed required=3/3 requiredFailed=0 optionalNoResponse=0 total=3',
    'heart-rate/control-enable: RESPONSE required',
    'heart-rate/control-disable: RESPONSE required',
    'writeOnly=1',
    'heart-rate/realtime-read: RESPONSE required',
    'hex=ab0100033d11050310',
    'core-protocol: PASS evidence=required=3/3 failed=-'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW protocol probe write-ok analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};const runRwLogAnalyzerRwL19AcceptanceSmokeTest = () => {
  const log = [
    '[12:10:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:10:00.050] [RW MINE] rw-l19-acceptance-start {"buildTag":"rw-visible-build-tag-20260719-347","stepCount":3}',
    '[12:10:01.000] [RW MINE] rw-l19-acceptance-step-result {"key":"core-protocol","label":"core protocol","ok":true,"result":{"ok":true,"requiredOkCount":3,"requiredFailedCount":0}}',
    '[12:10:02.000] [RW MINE] rw-l19-acceptance-step-result {"key":"metric-heart-rate","label":"heart rate","ok":true,"result":{"ok":true,"value":72}}',
    '[12:10:03.000] [RW MINE] rw-l19-acceptance-step-result {"key":"history-sleep","label":"sleep history","ok":false,"result":{"ok":false,"recordCount":0}}',
    '[12:10:03.100] [RW MINE] rw-l19-acceptance-summary {"okCount":2,"failedCount":1,"stepCount":3,"elapsedMs":3050,"failed":[{"key":"history-sleep","label":"sleep history"}]}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW/L19 acceptance analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'RW/L19 Acceptance',
    'latest-summary:',
    'ok=2 failed=1 steps=3',
    'failed: history-sleep:sleep history',
    'rw-l19-acceptance-step-result key=metric-heart-rate',
    'resultOk=true value=72'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW/L19 acceptance analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};
const runRwLogAnalyzerRwL19AcceptanceGateSmokeTest = () => {
  const log = [
    '[12:11:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347","snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","connected":true,"ready":true,"storeConnected":true,"userConnected":true,"deviceId":"3E:00:00:00:05:1B","protocol":"rw","notifyEnabled":true}}',
    '[12:11:08.000] [RW MINE] rw-l19-acceptance-summary {"buildTag":"rw-visible-build-tag-20260719-347","okCount":12,"failedCount":0,"stepCount":12,"elapsedMs":8000,"results":[{"key":"core-protocol","ok":true,"requiredOkCount":8,"requiredCommandCount":8,"requiredFailedCount":0},{"key":"metric:heart_rate","ok":true,"value":72},{"key":"metric:blood_oxygen","ok":true,"value":98},{"key":"metric:temperature","ok":true,"value":36.5},{"key":"metric:hrv","ok":true,"value":42},{"key":"metric:stress","ok":true,"value":31},{"key":"metric:blood_pressure","ok":true,"value":"118/76"},{"key":"metric:blood_sugar","ok":true,"value":5.6},{"key":"history:sleep","ok":true,"recordCount":2,"uploaded":true},{"key":"history:activity","ok":true,"recordCount":3,"uploaded":true},{"key":"history:stress","ok":true,"recordCount":1,"uploaded":true},{"key":"history:vital","ok":true,"recordCount":4,"uploaded":true}],"failed":[],"snapshot":{"connected":true,"ready":true,"storeConnected":true,"userConnected":true,"deviceId":"3E:00:00:00:05:1B","protocol":"rw"}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-metric=heart_rate,blood_oxygen', '--expect-history=sleep,activity,stress,vital'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW/L19 acceptance gate analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-metric-checks: PASS',
    'expected-history-checks: PASS',
    'overall: PASS',
    'device-info: PASS evidence=battery=ok firmware=ok software=ok acceptanceCore@L2',
    'core-protocol: PASS evidence=acceptanceCore@L2',
    'realtime-heart-spo2: PASS evidence=heart_rate=PASS(72),blood_oxygen=PASS(98)',
    'business-history-upload: PASS evidence=sleepData=PASS(2),activity=PASS(3),stress=PASS(1),vital=PASS(4)'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW/L19 acceptance gate analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};
const runRwLogAnalyzerRwL19AcceptanceSummaryResultsSmokeTest = () => {
  const log = [
    '[12:12:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347","snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","connected":true,"ready":true,"storeConnected":true,"userConnected":true,"deviceId":"3E:00:00:00:05:1B","protocol":"rw","notifyEnabled":true}}',
    '[12:12:08.000] [RW MINE] rw-l19-acceptance-summary {"buildTag":"rw-visible-build-tag-20260719-347","okCount":11,"failedCount":1,"stepCount":12,"elapsedMs":8000,"results":[{"key":"core-protocol","ok":true,"requiredOkCount":6,"requiredCommandCount":6,"requiredFailedCount":0},{"key":"metric:heart_rate","ok":true,"value":72},{"key":"metric:blood_oxygen","ok":true,"value":98},{"key":"metric:temperature","ok":true,"value":36.5},{"key":"metric:hrv","ok":true,"value":42},{"key":"metric:stress","ok":true,"value":31},{"key":"metric:blood_pressure","ok":true,"value":"118/76"},{"key":"metric:blood_sugar","ok":true,"value":5.6},{"key":"history:sleep","ok":true,"recordCount":2,"uploaded":true},{"key":"history:activity","ok":true,"recordCount":3,"uploaded":true},{"key":"history:stress","ok":false,"recordCount":0,"uploaded":false,"message":"no records"},{"key":"history:vital","ok":true,"recordCount":4,"uploaded":true}],"failed":[{"key":"history:stress","ok":false,"recordCount":0,"uploaded":false,"message":"no records"}],"snapshot":{"connected":true,"ready":true,"storeConnected":true,"userConnected":true,"deviceId":"3E:00:00:00:05:1B","protocol":"rw"}}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-metric=heart_rate,blood_oxygen', '--expect-history=sleep,activity,stress,vital', '--no-fail'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW/L19 acceptance summary-results analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-metric-checks: PASS',
    'expected-history-checks: FAIL (stress)',
    'overall: NOT_PROVEN',
    'realtime-heart-spo2: PASS evidence=heart_rate=PASS(72),blood_oxygen=PASS(98)',
    'business-history-upload: NOT_PROVEN evidence=sleepData=PASS(2),activity=PASS(3),stress=FAIL(0),vital=PASS(4)',
    'stress: FAIL',
    'line=L2 problems=missing-rw-history-command,missing-data-type,missing-start,missing-result'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW/L19 acceptance summary-results analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};
const runRwLogAnalyzerRwL19DiagnosticAcceptanceReportSmokeTest = () => {
  const log = [
    '[12:13:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347","snapshot":{"buildTag":"rw-visible-build-tag-20260719-347","connected":true,"ready":true,"storeConnected":true,"userConnected":true,"deviceId":"3E:00:00:00:05:1B","protocol":"rw","notifyEnabled":true}}',
    '[12:13:08.000] [RW MINE] diagnostic-acceptance-report {"buildTag":"rw-visible-build-tag-20260719-347","status":"pass","okCount":12,"failedCount":0,"stepCount":12,"missing":[],"failed":[],"results":[{"key":"core-protocol","ok":true,"requiredOkCount":8,"requiredCommandCount":8,"requiredFailedCount":0},{"key":"metric:heart_rate","ok":true,"value":72},{"key":"metric:blood_oxygen","ok":true,"value":98},{"key":"metric:temperature","ok":true,"value":36.5},{"key":"metric:hrv","ok":true,"value":42},{"key":"metric:stress","ok":true,"value":31},{"key":"metric:blood_pressure","ok":true,"value":"118/76"},{"key":"metric:blood_sugar","ok":true,"value":5.6},{"key":"history:sleep","ok":true,"recordCount":2,"uploaded":true},{"key":"history:activity","ok":true,"recordCount":3,"uploaded":true},{"key":"history:stress","ok":true,"recordCount":1,"uploaded":true},{"key":"history:vital","ok":true,"recordCount":4,"uploaded":true}]}'
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['scripts/analyze-rw-ble-log.mjs', '--expect-metric=heart_rate,blood_oxygen', '--expect-history=sleep,activity,stress,vital'],
    {
      cwd: process.cwd(),
      input: log,
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`RW/L19 diagnostic acceptance-report analyzer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expected-metric-checks: PASS',
    'expected-history-checks: PASS',
    'overall: PASS',
    'device-info: PASS evidence=battery=ok firmware=ok software=ok acceptanceCore@L2',
    'core-protocol: PASS evidence=acceptanceCore@L2',
    'realtime-heart-spo2: PASS evidence=heart_rate=PASS(72),blood_oxygen=PASS(98)',
    'business-history-upload: PASS evidence=sleepData=PASS(2),activity=PASS(3),stress=PASS(1),vital=PASS(4)',
    'RW/L19 Acceptance',
    'latest-summary: L2 ok=12 failed=0 steps=12',
    'diagnostic-acceptance-report'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW/L19 diagnostic acceptance-report analyzer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const runRwBackendLogSummarizerSmokeTest = () => {
  const log = [
    '[12:14:00.000] [RW MINE] diagnostic-copy {"buildTag":"rw-visible-build-tag-20260719-347"}',
    '[12:14:00.100] [RW MINE] protocol-probe-command-response {"key":"monitoring/temperature/read","hex":"ab0100035c81027d10","parsed":{"type":"rw_health_monitoring","key":637,"name":"temperature"}}',
    '[12:14:00.200] [RW MINE] protocol-probe-command-response {"key":"monitoring/temperature-detecting/write","hex":"ab010009f5ee021b00ff0000173b3c","parsed":{"type":"rw_health_monitoring_ack","key":539,"name":"temperature","status":"success"}}',
    '[12:14:00.300] [RW MINE] protocol-probe-command-response {"key":"history-key/temperature/read","hex":"ab0100030d16050810","parsed":{"type":"rw_health_data_ack","key":1288,"name":"temperature","recordCount":0}}'
  ].join('\n');
  const result = spawnSync(process.execPath, ['scripts/summarize-rw-backend-log.mjs'], {
    cwd: process.cwd(),
    input: log,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`RW backend log summarizer smoke test failed:\n${result.stdout}\n${result.stderr}`);
  }

  for (const term of [
    'expectedBuildTagFound: yes',
    'monitoring/temperature/read | required=yes',
    'verdict=OK | hex=ab0100035c81027d10',
    'monitoring/temperature-detecting/write | required=yes',
    'verdict=OK | hex=ab010009f5ee021b00ff0000173b3c',
    'history-key/temperature/read | required=yes',
    'verdict=EMPTY_ACK | hex=ab0100030d16050810',
    'temperature route verdict',
    'status: NO_SAMPLES',
    'detail: history-key/temperature/read:EMPTY_ACK'
  ]) {
    if (!result.stdout.includes(term)) {
      throw new Error(`RW backend log summarizer smoke test is missing ${JSON.stringify(term)}:\n${result.stdout}`);
    }
  }
};

const withStepTimeout = async (name, action) => {
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Ring BLE verifier step timed out: ${name}`)), stepTimeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

for (const [name, entryPoint] of entries) {
  const outfile = join(outdir, `${name}-parity.mjs`);
  if (debug) {
    console.log(`verifying ${name}`);
  }
  await withStepTimeout(name, async () => {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'silent'
    });

    await import(pathToFileURL(outfile).href);
  });
}

await rm(outdir, { recursive: true, force: true });
runRwLogAnalyzerSmokeTest();
runRwLogAnalyzerHistorySmokeTest();
runRwLogAnalyzerHistoryQueueSmokeTest();
runRwLogAnalyzerMineManualHistorySmokeTest();
runRwLogAnalyzerMineManualMetricSmokeTest();
runRwLogAnalyzerNativeVitalHistorySmokeTest();
runRwLogAnalyzerHistoryPageUploadSmokeTest();
runRwLogAnalyzerHistoryPageNormalizeEmptySmokeTest();
runRwLogAnalyzerHistoryPageUploadThenEmptyQuerySmokeTest();
runRwLogAnalyzerHistoryPageQueryFailedSmokeTest();
runRwLogAnalyzerLastDataHistorySmokeTest();
runRwLogAnalyzerDevicePageSmokeTest();
runRwLogAnalyzerDeviceInfoGateSmokeTest();
runRwLogAnalyzerHistoryWaitWindowSmokeTest();
runRwLogAnalyzerHistoryCompactReportSmokeTest();
runRwLogAnalyzerAbHistoryReadContinueSmokeTest();
runRwLogAnalyzerProtocolProbeSmokeTest();
runRwLogAnalyzerProtocolProbePlanSmokeTest();
runRwLogAnalyzerProtocolProbeSummaryCommandsSmokeTest();
runRwLogAnalyzerProtocolProbeCompactReportSmokeTest();
runRwLogAnalyzerProtocolProbeTruncatedCompactReportSmokeTest();
runRwLogAnalyzerProtocolProbeCompactReportPassedSmokeTest();
runRwLogAnalyzerProtocolProbeWriteOkSmokeTest();
runRwLogAnalyzerRwL19AcceptanceSmokeTest();
runRwLogAnalyzerRwL19AcceptanceGateSmokeTest();
runRwLogAnalyzerRwL19AcceptanceSummaryResultsSmokeTest();
runRwLogAnalyzerRwL19DiagnosticAcceptanceReportSmokeTest();
runRwLogAnalyzerReconnectRecoverySmokeTest();
runRwBackendLogSummarizerSmokeTest();

console.log('Ring BLE parity passed.');









