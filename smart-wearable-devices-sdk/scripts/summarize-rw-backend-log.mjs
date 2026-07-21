#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const LATEST_BUILD_TAG = 'rw-visible-build-tag-20260720-358';

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith('-'));
const expectedBuildTag =
  args.find((arg) => arg.startsWith('--expect-build-tag='))?.slice('--expect-build-tag='.length) ||
  LATEST_BUILD_TAG;
const failOnMissingBuildTag = args.includes('--fail-on-missing-build-tag');

const focusCommands = [
  {
    key: 'monitoring/temperature/read',
    label: 'temperature monitoring read',
    hex: 'ab0100035c81027d10',
    required: true
  },
  {
    key: 'monitoring/temperature-detecting/write',
    label: 'temperature detecting write',
    hex: 'ab010009f5ee021b00ff0000173b3c',
    required: true
  },
  {
    key: 'monitoring/temperature-detecting/plain-write',
    label: 'temperature detecting plain write',
    hex: 'ab0100092bfb021b00010000173b3c',
    required: false
  },
  {
    key: 'monitoring/temperature-detecting/sdk-short-write',
    label: 'temperature detecting sdk short interval write',
    hex: 'ab010009e72e021b00ff0000173b05',
    required: false
  },
  {
    key: 'monitoring/temperature-detecting/sdk-no-crc-write',
    label: 'temperature detecting sdk no crc write',
    hex: 'ab010009021b00ff0000173b3c',
    required: false
  },
  {
    key: 'history-key/temperature/read',
    label: 'temperature history read',
    hex: 'ab0100030d16050810',
    required: true
  },
  {
    key: 'history-key/temperature/read-no-crc',
    label: 'temperature history read no crc',
    hex: 'ab010003050810',
    required: false
  },
  {
    key: 'temperature/app-realtime-read',
    label: 'old realtime temperature read',
    hex: 'ab0100030cb4023010',
    required: false
  },
  {
    key: 'temperature/control-enable',
    label: 'temperature realtime control enable',
    hex: 'ab010006359f060900080501',
    required: false
  },
  {
    key: 'temperature/control-disable',
    label: 'temperature realtime control disable',
    hex: 'ab010006f55e060900080500',
    required: false
  }
];

const readInput = () => {
  if (!inputPath) return fs.readFileSync(0, 'utf8');
  const absolutePath = path.resolve(inputPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Backend log file not found: ${absolutePath}`);
  return fs.readFileSync(absolutePath, 'utf8');
};

const unique = (items) => [...new Set(items.filter(Boolean))];

const countLiteral = (text, needle) => {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index >= 0) {
    index = text.indexOf(needle, index);
    if (index >= 0) {
      count += 1;
      index += needle.length;
    }
  }
  return count;
};

const decodeLoose = (value) => {
  let text = String(value || '');
  for (let i = 0; i < 2; i += 1) {
    text = text
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return text;
};

const contextsFor = (source, needle, windowSize = 1000) => {
  const contexts = [];
  if (!needle) return contexts;
  if (Array.isArray(source)) {
    return source.filter((item) => item.includes(needle));
  }
  const text = source;
  let index = text.indexOf(needle);
  while (index >= 0) {
    contexts.push(text.slice(Math.max(0, index - windowSize), Math.min(text.length, index + needle.length + windowSize)));
    index = text.indexOf(needle, index + needle.length);
  }
  return contexts;
};

const detectStatuses = (contexts) => {
  const statuses = new Set();
  for (const context of contexts) {
    const text = decodeLoose(context);
    if (/protocol-probe-command-timeout|history-ab-key-timeout|wait timeout/i.test(text)) statuses.add('timeout');
    if (/protocol-probe-command-error|tx-fail|request:fail|"event"\s*:\s*"[^"]*(failed|error)[^"]*"/i.test(text)) statuses.add('error');
    if (/protocol-probe-command-response|protocol-probe-command-write-ok/i.test(text)) statuses.add('ok');
    for (const match of text.matchAll(/"s"\s*:\s*"(ok|timeout|error|pending)"/g)) statuses.add(match[1]);
    for (const match of text.matchAll(/"status"\s*:\s*"(success|ok|timeout|failed|error|pending)"/g)) {
      const value = match[1] === 'success' ? 'ok' : match[1] === 'failed' ? 'error' : match[1];
      statuses.add(value);
    }
  }
  return [...statuses];
};

const hasEmptyAck = (contexts) => {
  return contexts.some((context) => {
    const text = decodeLoose(context);
    return (
      /"recordCount"\s*:\s*0/.test(text) ||
      /"c"\s*:\s*0/.test(text) ||
      /"count"\s*:\s*0/.test(text) ||
      /"type"\s*:\s*"rw_health_data_ack"/.test(text) ||
      /"t"\s*:\s*"rw_health_data_ack"/.test(text)
    );
  });
};

const getCommandVerdict = (command) => {
  if ((command.keyCount || 0) + (command.hexCount || 0) === 0) return 'NOT_TESTED';
  const statuses = new Set(command.statuses || []);
  if (statuses.has('error')) return statuses.has('ok') ? 'MIXED_ERROR_OK' : 'ERROR';
  if (statuses.has('timeout')) return statuses.has('ok') ? 'MIXED_TIMEOUT_OK' : 'TIMEOUT';
  if (statuses.has('pending')) return statuses.has('ok') ? 'MIXED_PENDING_OK' : 'PENDING';
  if (statuses.has('ok')) return command.emptyAck ? 'EMPTY_ACK' : 'OK';
  return 'SEEN_NO_TERMINAL';
};

const compactContext = (contexts) => {
  const context = decodeLoose(contexts[0] || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!context) return '';
  return context.length > 240 ? `${context.slice(0, 240)}...` : context;
};

const text = readInput();
const decoded = decodeLoose(text);

const parseJsonLoose = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const original = String(value);
  const raw = decodeLoose(original);
  for (const candidate of [original, raw, original.replace(/&quot;/g, '"'), raw.replace(/&quot;/g, '"')]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying the next representation.
    }
  }
  return null;
};

const extractStructuredRows = () => {
  const payload = parseJsonLoose(text);
  return Array.isArray(payload?.rows) ? payload.rows : [];
};

const structuredRows = extractStructuredRows();

const getRowDetails = (row) => {
  const details = parseJsonLoose(row?.details_json);
  if (details && typeof details === 'object') return details;
  const payload = parseJsonLoose(row?.payload_json);
  const payloadDetails = parseJsonLoose(payload?.details);
  return payloadDetails && typeof payloadDetails === 'object' ? payloadDetails : {};
};

const getRowBuildTag = (row, details = getRowDetails(row)) =>
  row?.build_tag || details?.buildTag || details?.snapshot?.buildTag || '';

const getRowLabel = (row, details = getRowDetails(row)) => {
  const label = details?.label || details?.key || details?.step || details?.reason || '';
  return label ? String(label) : '';
};

const summarizeRow = (row) => {
  if (!row) return '-';
  const details = getRowDetails(row);
  const label = getRowLabel(row, details);
  return [
    `id=${row.id ?? '-'}`,
    `time=${row.client_time || row.created_at || '-'}`,
    `source=${row.source || '-'}`,
    `event=${row.event || '-'}`,
    `tag=${getRowBuildTag(row, details) || '-'}`,
    label ? `label=${label}` : ''
  ]
    .filter(Boolean)
    .join(' ');
};

const countRows = (predicate) => structuredRows.filter((row) => predicate(row, getRowDetails(row))).length;
const latestRow = (predicate) => structuredRows.find((row) => predicate(row, getRowDetails(row))) || null;

const eventCount = (source, event) =>
  countRows((row) => (!source || row.source === source) && (!event || row.event === event));

const markerSummary = (label, source, event) => {
  const count = eventCount(source, event);
  return {
    label,
    count,
    latest: latestRow((row) => (!source || row.source === source) && row.event === event)
  };
};

const compactObject = (value) => {
  if (!value || typeof value !== 'object') return '-';
  const entries = Object.entries(value)
    .filter(([, itemValue]) => itemValue !== undefined && itemValue !== null && itemValue !== '')
    .slice(0, 12);
  if (entries.length === 0) return '-';
  return entries.map(([key, itemValue]) => `${key}=${Array.isArray(itemValue) ? itemValue.join(',') : itemValue}`).join(' ');
};

const summarizeHistoryDetails = (details) => {
  const recordCount = details?.recordCount ?? details?.result?.recordCount ?? details?.result?.records?.length;
  const rawMetricCounts = details?.rawMetricCounts || details?.result?.rawMetricCounts;
  const submitMetricCounts = details?.submitMetricCounts || details?.result?.submitMetricCounts;
  const rawRecordSample = details?.rawRecordSample || details?.result?.rawRecordSample || details?.recordSample;
  const submitRecordSample = details?.submitRecordSample || details?.result?.submitRecordSample;
  return {
    status: details?.status || details?.result?.status,
    uploaded: details?.uploaded ?? details?.result?.uploaded,
    recordCount,
    rawMetricCounts: compactObject(rawMetricCounts),
    submitMetricCounts: compactObject(submitMetricCounts),
    rawRecordSample: Array.isArray(rawRecordSample) ? JSON.stringify(rawRecordSample.slice(0, 2)) : rawRecordSample ? JSON.stringify(rawRecordSample) : '-',
    submitRecordSample: Array.isArray(submitRecordSample) ? JSON.stringify(submitRecordSample.slice(0, 2)) : submitRecordSample ? JSON.stringify(submitRecordSample) : '-'
  };
};

const summarizeOverviewDetails = (details) => {
  const summary = details?.summary || details?.result || details?.response || {};
  return {
    key: details?.key,
    date: details?.date,
    error: details?.error,
    rawError: details?.rawError,
    summary: compactObject(summary)
  };
};

const extractSearchUnits = () => {
  const units = [];
  let extractedRows = false;
  const payload = parseJsonLoose(text);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (rows.length > 0) {
    extractedRows = true;
    if (payload.total !== undefined) units.push(JSON.stringify({ total: payload.total }));
  }
  for (const row of rows) {
    units.push(JSON.stringify(row));
    if (row.details_json) units.push(decodeLoose(row.details_json));
    if (row.payload_json) units.push(decodeLoose(row.payload_json));
  }
  if (!extractedRows) {
    units.push(...String(text || '').split(/\r?\n/));
    units.push(...String(decoded || '').split(/\r?\n/));
  }
  return units.map((item) => String(item || '').trim()).filter(Boolean);
};
const searchUnits = extractSearchUnits();
const combined = searchUnits.join('\n');

const rowIds = unique([...combined.matchAll(/"id"\s*:\s*(\d+)\s*,\s*"created_at"/g)].map((match) => Number(match[1])))
  .filter(Number.isFinite)
  .sort((a, b) => b - a);
const fallbackIds = unique([...combined.matchAll(/"id"\s*:\s*(\d+)/g)].map((match) => Number(match[1])))
  .filter(Number.isFinite)
  .sort((a, b) => b - a);
const ids = rowIds.length > 0 ? rowIds : fallbackIds;
const buildTags = unique([...combined.matchAll(/rw-visible-build-tag-\d{8}-\d+/g)].map((match) => match[0])).sort();
const sessions = unique([...combined.matchAll(/"session_id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]));
const total = combined.match(/"total"\s*:\s*(\d+)/)?.[1] || '';
const expectedFound = buildTags.includes(expectedBuildTag);

const keyFlowMarkers = [
  markerSummary('Mine page skipped RW auto refresh', 'RW MINE', 'page-show-skip-rw-auto-refresh'),
  markerSummary('Mine light device-info refresh started', 'RW MINE', 'rw-device-info-background-refresh-start'),
  markerSummary('Mine light device-info refresh finished', 'RW MINE', 'rw-device-info-background-refresh-result'),
  markerSummary('Controller post-connect device-info refresh started', 'RW FLOW', 'post-connect-device-info-refresh-start'),
  markerSummary('Controller post-connect device-info refresh finished', 'RW FLOW', 'post-connect-device-info-refresh-result'),
  markerSummary('Device page shown', 'RW DEVICE', 'page-show'),
  markerSummary('Device page auto refresh', 'RW DEVICE', 'page-show-auto-refresh'),
  markerSummary('Device page info refresh result', 'RW DEVICE', 'device-info-refresh-result'),
  markerSummary('Home overview request success', 'RW HOME', 'business-overview-request-success'),
  markerSummary('Home overview request failed', 'RW HOME', 'business-overview-request-failed'),
  markerSummary('Home post-sync overview result', 'RW HOME', 'business-sync-refresh-overview-result')
];

const latestHistoryResultRow = latestRow((row) =>
  ['history-page-sync-result', 'history-sync-result', 'business-history-sync-result'].includes(row.event || '')
);
const latestHistoryUploadRow = latestRow((row) =>
  ['history-page-upload-result', 'business-history-upload-result'].includes(row.event || '')
);
const latestBalanceSuccessRow = latestRow((row, details) =>
  row.source === 'RW HOME' && row.event === 'business-overview-request-success' && details?.key === 'balanceScore'
);
const latestBalanceFailedRow = latestRow((row, details) =>
  row.source === 'RW HOME' && row.event === 'business-overview-request-failed' && details?.key === 'balanceScore'
);

const oldBuildHasMineSkipRefresh = !expectedFound && eventCount('RW MINE', 'page-show-skip-rw-auto-refresh') > 0;
const getBatteryImmediateVerdict = () => {
  if (!expectedFound) {
    return oldBuildHasMineSkipRefresh
      ? 'WAITING_FOR_339: current logs are old build; old build skipped Mine RW auto refresh, which explains delayed battery.'
      : `WAITING_FOR_339: expected build tag not found: ${expectedBuildTag}`;
  }
  const started = eventCount('RW MINE', 'rw-device-info-background-refresh-start') + eventCount('RW FLOW', 'post-connect-device-info-refresh-start');
  const finished = eventCount('RW MINE', 'rw-device-info-background-refresh-result') + eventCount('RW FLOW', 'post-connect-device-info-refresh-result');
  if (started === 0) return 'FAIL: expected build found, but no light battery/device-info refresh marker was logged.';
  if (finished === 0) return 'PENDING: light battery/device-info refresh started but no result marker found.';
  return 'CHECK_RESULT: light battery/device-info refresh markers found; inspect result hasBattery/battery fields.';
};

const getDevicePageVerdict = () => {
  if (!expectedFound) return `WAITING_FOR_339: expected build tag not found: ${expectedBuildTag}`;
  if (eventCount('RW DEVICE', 'page-show') === 0) return 'NOT_VISITED: no device page log for expected build.';
  return 'VISITED: device page produced RW DEVICE logs; inspect screenshot if layout still differs from original.';
};

const getHomeScoreVerdict = () => {
  if (!expectedFound) return `WAITING_FOR_339: expected build tag not found: ${expectedBuildTag}`;
  if (latestBalanceSuccessRow) return 'REQUEST_OK: balanceScore request succeeded; missing score is likely response empty or render mapping.';
  if (latestBalanceFailedRow) return 'REQUEST_FAILED: balanceScore request failed; inspect rawError.';
  if (eventCount('RW HOME', 'business-overview-request-success') + eventCount('RW HOME', 'business-overview-request-failed') === 0) {
    return 'NO_REQUEST_LOG: home overview request markers absent; homepage may not have been visited or not running expected build.';
  }
  return 'CHECK_KEY: RW HOME overview logs found, but balanceScore key not found.';
};

const commands = focusCommands.map((command) => {
  const keyContexts = contextsFor(searchUnits, command.key);
  const hexContexts = contextsFor(searchUnits, command.hex);
  const contexts = [...keyContexts, ...hexContexts];
  const item = {
    ...command,
    keyCount: countLiteral(combined, command.key),
    hexCount: countLiteral(combined, command.hex),
    statuses: detectStatuses(contexts),
    emptyAck: hasEmptyAck(contexts),
    sample: compactContext(contexts)
  };
  item.verdict = getCommandVerdict(item);
  return item;
});

const requiredTemperatureCommands = commands.filter((command) => command.required);
const failedRequiredTemperatureCommands = requiredTemperatureCommands.filter((command) =>
  ['ERROR', 'TIMEOUT', 'MIXED_ERROR_OK', 'MIXED_TIMEOUT_OK'].includes(command.verdict)
);
const notTestedRequiredTemperatureCommands = requiredTemperatureCommands.filter((command) => command.verdict === 'NOT_TESTED');
const emptyRequiredTemperatureCommands = requiredTemperatureCommands.filter((command) => command.verdict === 'EMPTY_ACK');
const getTemperatureRouteVerdict = () => {
  if (!expectedFound) {
    return {
      status: 'WAITING_FOR_EXPECTED_BUILD',
      detail: `expected build tag not found: ${expectedBuildTag}`
    };
  }
  if (failedRequiredTemperatureCommands.length > 0) {
    return {
      status: 'FAIL',
      detail: failedRequiredTemperatureCommands.map((command) => `${command.key}:${command.verdict}`).join(',')
    };
  }
  if (notTestedRequiredTemperatureCommands.length > 0) {
    return {
      status: 'INCOMPLETE',
      detail: notTestedRequiredTemperatureCommands.map((command) => command.key).join(',')
    };
  }
  if (emptyRequiredTemperatureCommands.length > 0) {
    return {
      status: 'NO_SAMPLES',
      detail: emptyRequiredTemperatureCommands.map((command) => `${command.key}:EMPTY_ACK`).join(',')
    };
  }
  if (requiredTemperatureCommands.every((command) => command.verdict === 'OK')) {
    return {
      status: 'PASS',
      detail: requiredTemperatureCommands.map((command) => `${command.key}:OK`).join(',')
    };
  }
  return {
    status: 'CHECK_MANUALLY',
    detail: requiredTemperatureCommands.map((command) => `${command.key}:${command.verdict}`).join(',')
  };
};
const temperatureRouteVerdict = getTemperatureRouteVerdict();

console.log('RW backend log summary');
console.log(`input: ${inputPath ? path.resolve(inputPath) : 'stdin'}`);
console.log(`bytes: ${Buffer.byteLength(text, 'utf8')}`);
console.log(`total: ${total || '-'}`);
console.log(`latestIds: ${ids.slice(0, 8).join(',') || '-'}`);
console.log(`buildTags: ${buildTags.join(',') || '-'}`);
console.log(`expectedBuildTag: ${expectedBuildTag}`);
console.log(`expectedBuildTagFound: ${expectedFound ? 'yes' : 'no'}`);
console.log(`sessions: ${sessions.slice(0, 5).join(',') || '-'}`);
console.log(`structuredRows: ${structuredRows.length}`);
console.log('');
console.log('current issue verdicts');
console.log(`batteryImmediate: ${getBatteryImmediateVerdict()}`);
console.log(`devicePage: ${getDevicePageVerdict()}`);
console.log(`homeScore: ${getHomeScoreVerdict()}`);
console.log('');
console.log('key flow markers');
for (const marker of keyFlowMarkers) {
  console.log(`- ${marker.label}: count=${marker.count} latest=${summarizeRow(marker.latest)}`);
}
console.log('');
console.log('history/upload summary');
if (latestHistoryResultRow) {
  const details = getRowDetails(latestHistoryResultRow);
  const summary = summarizeHistoryDetails(details);
  console.log(`historyResult: ${summarizeRow(latestHistoryResultRow)}`);
  console.log(`  ${compactObject(summary)}`);
}
if (latestHistoryUploadRow) {
  const details = getRowDetails(latestHistoryUploadRow);
  const summary = summarizeHistoryDetails(details);
  console.log(`historyUpload: ${summarizeRow(latestHistoryUploadRow)}`);
  console.log(`  ${compactObject(summary)}`);
}
if (!latestHistoryResultRow && !latestHistoryUploadRow) console.log('-');
console.log('');
console.log('home balanceScore summary');
if (latestBalanceSuccessRow) {
  const details = getRowDetails(latestBalanceSuccessRow);
  console.log(`success: ${summarizeRow(latestBalanceSuccessRow)}`);
  console.log(`  ${compactObject(summarizeOverviewDetails(details))}`);
} else if (latestBalanceFailedRow) {
  const details = getRowDetails(latestBalanceFailedRow);
  console.log(`failed: ${summarizeRow(latestBalanceFailedRow)}`);
  console.log(`  ${compactObject(summarizeOverviewDetails(details))}`);
} else {
  console.log('-');
}
console.log('');
console.log('focused command matrix');
for (const command of commands) {
  const statusText = command.statuses.length > 0 ? command.statuses.join(',') : '-';
  console.log(
    [
      `- ${command.key}`,
      `required=${command.required ? 'yes' : 'no'}`,
      `keyCount=${command.keyCount}`,
      `hexCount=${command.hexCount}`,
      `status=${statusText}`,
      `verdict=${command.verdict}`,
      `hex=${command.hex}`
    ].join(' | ')
  );
  if (command.sample) console.log(`  sample: ${command.sample}`);
}
console.log('');
console.log('temperature route verdict');
console.log(`status: ${temperatureRouteVerdict.status}`);
console.log(`detail: ${temperatureRouteVerdict.detail || '-'}`);

if (failOnMissingBuildTag && !expectedFound) {
  console.error(`Expected build tag was not found in backend logs: ${expectedBuildTag}`);
  process.exitCode = 1;
}


