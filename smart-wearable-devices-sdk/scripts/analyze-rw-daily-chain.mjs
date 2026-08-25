#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const date = args.find((arg) => arg.startsWith('--date='))?.slice('--date='.length) || '2026-08-21';
const directory = path.resolve(args.find((arg) => arg.startsWith('--dir='))?.slice('--dir='.length) || '.');
const output = args.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
const realMacPattern = /^B0:(?:05|06)(?::[0-9A-F]{2}){4}$/i;
const preferredMacKeys = new Set([
  'canonicalDeviceMac', 'deviceMac', 'device_mac', 'resolved_device_mac',
  'uniMacId', 'mac', 'serialNumber', 'serial_number'
]);

const safeJson = (value) => {
  if (!value || typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try { return JSON.parse(value); } catch {
    // The diagnostic table intentionally caps large JSON columns. Preserve the
    // leading scalar fields so daily chain metrics remain usable when snapshots
    // or samples are truncated mid-object.
    const loose = { __truncated: true };
    const scalarPattern = /"([^"]+)"\s*:\s*(?:"((?:\\.|[^"])*)"|(-?\d+(?:\.\d+)?)|(true|false|null))/g;
    let match;
    while ((match = scalarPattern.exec(value))) {
      const [, key, quoted, numeric, literal] = match;
      if (Object.prototype.hasOwnProperty.call(loose, key)) continue;
      if (quoted !== undefined) loose[key] = quoted.replace(/\\"/g, '"');
      else if (numeric !== undefined) loose[key] = Number(numeric);
      else loose[key] = literal === 'true' ? true : literal === 'false' ? false : null;
    }
    return loose;
  }
};

const normalizeMac = (value) => {
  const text = String(value || '').trim().toUpperCase();
  return realMacPattern.test(text) ? text : '';
};

const findPreferredMac = (value, depth = 0) => {
  if (!value || depth > 6) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findPreferredMac(item, depth + 1);
      if (result) return result;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const [key, item] of Object.entries(value)) {
    if (preferredMacKeys.has(key)) {
      const result = normalizeMac(item);
      if (result) return result;
    }
  }
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object') {
      const result = findPreferredMac(item, depth + 1);
      if (result) return result;
    }
  }
  return '';
};

const percentile = (values, ratio) => {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  return list[Math.min(list.length - 1, Math.max(0, Math.ceil(list.length * ratio) - 1))];
};

const inputFiles = fs.readdirSync(directory)
  .filter((name) => name === '.tmp-all-devices-20260821-latest.json'
    || /^\.tmp-all-devices-20260821-offset-\d+\.json$/.test(name))
  .map((name) => path.join(directory, name));

let rows = [];
for (const file of inputFiles) {
  const payload = safeJson(fs.readFileSync(file, 'utf8'));
  rows.push(...(Array.isArray(payload.rows) ? payload.rows : []));
}
rows = [...new Map(rows.map((row) => [row.id, row])).values()]
  .filter((row) => String(row.created_at || '').startsWith(date))
  .sort((a, b) => a.id - b.id)
  .map((row) => ({ ...row, details: safeJson(row.details_json), payload: safeJson(row.payload_json) }));

const sessionCandidates = new Map();
for (const row of rows) {
  const mac = normalizeMac(row.device_id) || findPreferredMac(row.details) || findPreferredMac(row.payload);
  if (!mac || !row.session_id) continue;
  if (!sessionCandidates.has(row.session_id)) sessionCandidates.set(row.session_id, new Set());
  sessionCandidates.get(row.session_id).add(mac);
}

const resolveMac = (row) => {
  const direct = normalizeMac(row.device_id) || findPreferredMac(row.details) || findPreferredMac(row.payload);
  if (direct) return direct;
  const candidates = row.session_id ? sessionCandidates.get(row.session_id) : null;
  return candidates?.size === 1 ? [...candidates][0] : '';
};

const groups = new Map();
for (const row of rows) {
  const mac = resolveMac(row);
  if (!mac) continue;
  if (!groups.has(mac)) groups.set(mac, []);
  groups.get(mac).push(row);
}

const eventRows = (deviceRows, event) => deviceRows.filter((row) => row.event === event);
const elapsedValues = (deviceRows, events) => deviceRows
  .filter((row) => events.includes(row.event))
  .map((row) => Number(row.details.elapsedMs ?? row.details.elapsed_ms))
  .filter(Number.isFinite);

const devices = [];
for (const [mac, deviceRows] of groups) {
  if (deviceRows.length < 3) continue;
  const eventCount = {};
  const builds = {};
  for (const row of deviceRows) {
    eventCount[row.event] = (eventCount[row.event] || 0) + 1;
    if (row.build_tag && row.build_tag !== 'backend-data-sync') builds[row.build_tag] = (builds[row.build_tag] || 0) + 1;
  }

  const ensureRows = eventRows(deviceRows, 'legacy-home-ensure-ready-result');
  const ensureElapsed = elapsedValues(deviceRows, ['legacy-home-ensure-ready-result']);
  const historyRows = eventRows(deviceRows, 'legacy-home-history-read-result');
  const historyElapsed = elapsedValues(deviceRows, ['legacy-home-history-read-result']);
  const historyRecords = historyRows.map((row) => Number(row.details.recordCount)).filter(Number.isFinite);
  const buildElapsed = elapsedValues(deviceRows, ['legacy-local-data-upload-batch-build-slow']);
  const uploadRows = eventRows(deviceRows, 'data_sync_finish');
  const uploadElapsed = uploadRows.map((row) => Number(row.details.elapsed_ms)).filter(Number.isFinite);
  const uploadSessions = new Map();
  for (const row of uploadRows) {
    const session = row.details.upload_session_id || row.session_id || `row-${row.id}`;
    if (!uploadSessions.has(session)) uploadSessions.set(session, { batches: 0, inputCount: 0, complete: false, failCount: 0, first: row.created_at, last: row.created_at });
    const entry = uploadSessions.get(session);
    entry.batches += 1;
    entry.inputCount += Number(row.details.input_count) || 0;
    entry.complete ||= row.details.coverage_status === 'complete' || row.details.history_completed === true;
    entry.failCount += Number(row.details.fail_count) || 0;
    entry.last = row.created_at;
  }
  const parsedUploadElapsed = deviceRows
    .filter((row) => row.event === 'upload-http-result' && row.details.stage === 'legacy-local-data-submit')
    .map((row) => Number(row.details.elapsedMs)).filter(Number.isFinite);
  const refreshElapsed = elapsedValues(deviceRows, ['business-overview-refresh-result']);
  const completeUploads = uploadRows.filter((row) => row.details.coverage_status === 'complete' || row.details.history_completed === true);
  const summaryRows = deviceRows.filter((row) => row.event === 'upload-summary-finalize-result' || row.event === 'pending-parsed-upload-summary-finalize-result');
  const errorRows = deviceRows.filter((row) => /(?:fail|failed|timeout|error)$/i.test(row.event)
    || /(?:fail|failed|timeout|error)/i.test(String(row.details.error || row.details.message || '')));

  const latestHistory = historyRows.at(-1);
  const latestUploadSession = [...uploadSessions.entries()].sort((a, b) => String(a[1].last).localeCompare(String(b[1].last))).at(-1);
  devices.push({
    mac,
    rowCount: deviceRows.length,
    firstAt: deviceRows[0]?.created_at,
    lastAt: deviceRows.at(-1)?.created_at,
    builds: Object.entries(builds).sort((a, b) => b[1] - a[1]).slice(0, 4),
    pageShowCount: eventCount['page-show'] || 0,
    syncStartCount: eventCount['legacy-home-sync-start'] || 0,
    syncFailCount: eventCount['legacy-home-sync-failed'] || 0,
    connectAttemptCount: eventCount['connect-page-attempt'] || 0,
    connectSuccessCount: eventCount['connect-page-success'] || 0,
    connectFailCount: eventCount['connect-page-fail'] || 0,
    reconnectStartCount: eventCount['legacy-reconnect-app-connect-start'] || 0,
    adapterFailureCount: (eventCount['legacy-bluetooth-init-failed'] || 0)
      + (eventCount['legacy-bluetooth-adapter-open-failed'] || 0)
      + (eventCount['legacy-bluetooth-adapter-state-check-failed'] || 0),
    gattInvalidatedCount: eventCount['legacy-gatt-cache-invalidated'] || 0,
    ensureReady: {
      count: ensureRows.length,
      notReady: ensureRows.filter((row) => row.details.ready === false).length,
      p50Ms: percentile(ensureElapsed, 0.5),
      p95Ms: percentile(ensureElapsed, 0.95),
      maxMs: percentile(ensureElapsed, 1)
    },
    history: {
      starts: eventCount['legacy-home-history-read-start'] || 0,
      results: historyRows.length,
      success: historyRows.filter((row) => row.details.status === 'success' && row.details.parsedComplete !== false).length,
      incomplete: historyRows.filter((row) => row.details.status !== 'success' || row.details.parsedComplete === false).length,
      p50Ms: percentile(historyElapsed, 0.5),
      p95Ms: percentile(historyElapsed, 0.95),
      maxMs: percentile(historyElapsed, 1),
      maxRecords: historyRecords.length ? Math.max(...historyRecords) : 0,
      latest: latestHistory ? {
        at: latestHistory.created_at,
        elapsedMs: Number(latestHistory.details.elapsedMs) || 0,
        records: Number(latestHistory.details.recordCount) || 0,
        status: latestHistory.details.status,
        parsedComplete: latestHistory.details.parsedComplete,
        maxHistoryText: latestHistory.details.maxHistoryText
      } : null,
      emptyFallbacks: eventCount['legacy-home-history-empty-fallback-result'] || 0,
      unparsedNotifyCount: eventCount['legacy-history-wire-notify-unparsed'] || 0
    },
    batchBuild: {
      slowCount: buildElapsed.length,
      p50Ms: percentile(buildElapsed, 0.5),
      p95Ms: percentile(buildElapsed, 0.95),
      maxMs: percentile(buildElapsed, 1)
    },
    upload: {
      sessions: uploadSessions.size,
      completeSessions: [...uploadSessions.values()].filter((session) => session.complete).length,
      batches: uploadRows.length,
      completeBatches: completeUploads.length,
      failedRecords: uploadRows.reduce((sum, row) => sum + (Number(row.details.fail_count) || 0), 0),
      slowRequests: uploadRows.filter((row) => row.details.slow_request === true).length,
      maxBackendMs: percentile(uploadElapsed, 1),
      maxFrontendMs: percentile(parsedUploadElapsed, 1),
      httpFailures: (eventCount['upload-http-failed'] || 0) + (eventCount['upload-http-batch-soft-timeout'] || 0),
      foregroundBudgetExpired: eventCount['upload-http-foreground-budget-expired'] || 0,
      summaryFinalizeResults: summaryRows.length,
      latestSession: latestUploadSession ? { id: latestUploadSession[0], ...latestUploadSession[1] } : null
    },
    refresh: {
      results: eventCount['business-overview-refresh-result'] || 0,
      failures: eventCount['business-overview-request-failed'] || 0,
      deferredWhileSync: eventCount['business-processed-refresh-deferred-sync-active'] || 0,
      forcedAfterIdleTimeout: eventCount['business-processed-refresh-force-after-idle-wait-timeout'] || 0,
      maxMs: percentile(refreshElapsed, 1)
    },
    retryThrottleCount: eventCount['pending-parsed-upload-retry-throttled'] || 0,
    terminalSkipCloseCount: eventCount['legacy-local-data-terminal-skip-close'] || 0,
    errors: errorRows.slice(-8).map((row) => ({
      at: row.created_at,
      event: row.event,
      message: row.details.error || row.details.message || ''
    }))
  });
}

devices.sort((a, b) => b.rowCount - a.rowCount);
const report = {
  date,
  coverage: {
    inputFiles: inputFiles.map((file) => path.basename(file)),
    rowCount: rows.length,
    firstAt: rows[0]?.created_at || null,
    lastAt: rows.at(-1)?.created_at || null,
    assignedDeviceRows: devices.reduce((sum, item) => sum + item.rowCount, 0),
    deviceCount: devices.length
  },
  devices
};

const text = JSON.stringify(report, null, 2);
if (output) fs.writeFileSync(path.resolve(output), text, 'utf8');
else process.stdout.write(text);
