import type { LegacyRingAdapter, LegacyReadLocalDataOptions } from '../legacy/adapter';
import type { RingParsedData } from '../types';
import { getRwDiagnosticCommandLock } from '@/utils/rwDiagnosticCommandLock';
import { enqueueRwDiagnosticUpload } from '@/utils/rwDiagnosticUpload';
import {
  buildRwDeleteHealthDataCommand,
  buildRwReadDateTimeKeyCommand,
  buildRwQkeerV2HistoryListCommand,
  buildRwQkeerV2LastDataCommand,
  buildRwReadContinueKeyCommand,
  buildRwReadHealthDataCommand,
  buildRwReadKeyCommand,
  buildRwReadLocalDataCommand,
  buildRwRequestUploadCommand,
  buildRwSetDateTimeKeyCommand,
  buildRwSetHealthMonitoringCommand,
  buildRwSetTimeFormatKeyCommand,
  buildRwSetTimeZoneKeyCommand,
  RwKey,
  RwKeyFlag,
  RwQkeerV2HistoryCommand,
  type RwHealthMonitoringConfig
} from './protocol';
import type { RwFileListItem } from './parser';

export interface SyncRwHistoryOptions extends LegacyReadLocalDataOptions {
  timeoutMs?: number;
  fileListRetryDelayMs?: number;
  preflightDelayMs?: number;
  preflightResponseTimeoutMs?: number;
  deleteAfterRead?: boolean;
}

export interface SyncRwHistoryResult {
  parsed: RingParsedData;
  records: Array<Record<string, any>>;
}

const uploadEventTypes = new Set(['rw_upload_request', 'rw_upload_file', 'rw_upload_progress', 'rw_last_package_progress']);
const RW_HISTORY_FILE_LIST_RETRY_DELAY_MS = 3000;
const RW_HISTORY_NATIVE_LIST_FALLBACK_DELAY_MS = 7000;
const RW_HISTORY_LAST_DATA_FALLBACK_DELAY_MS = 7000;
const RW_HISTORY_NATIVE_LIST_COMMAND_INTERVAL_MS = 900;
const RW_HISTORY_FINAL_FILE_LIST_FALLBACK_DELAY_MS = 2500;
const RW_HISTORY_AB_KEY_PRE_NATIVE_RESPONSE_WAIT_MS = 2200;
const RW_HISTORY_AB_KEY_PRE_NATIVE_COMMAND_LIMIT = 1;
const RW_HISTORY_AB_KEY_RESPONSE_WAIT_MS = 2500;
const RW_HISTORY_AB_KEY_DELETE_WAIT_MS = 2200;
const RW_HISTORY_AB_KEY_SDK_LOOP_MAX_READS = 32;
const RW_HISTORY_AB_ACTIVITY_SDK_LOOP_MAX_READS = 8;
const RW_HISTORY_AB_SLEEP_SDK_LOOP_MAX_READS = 32;
const RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS = 180;
const RW_HISTORY_PREFLIGHT_DELAY_MS = 500;
const RW_HISTORY_PREFLIGHT_RESPONSE_TIMEOUT_MS = 2000;
const RW_HISTORY_DEFAULT_MONITORING_INTERVAL_MINUTES = 60;
const RING_DIAGNOSTIC_LOG_STORAGE_KEY = 'qkeer:ring-diagnostic-logs';
const RING_DIAGNOSTIC_LOG_MAX_COUNT = 500;
const RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH = 4000;

const shouldSkipRwHistoryCommandForDiagnosticLock = (
  readDetails: Record<string, unknown>,
  commandLabel: string,
  details: Record<string, unknown> = {}
) => {
  const lock = getRwDiagnosticCommandLock();
  if (!lock) return false;
  appendRwHistoryDiagnosticLog('history-command-skip-diagnostic-lock', {
    ...readDetails,
    ...details,
    commandLabel,
    lock
  });
  return true;
};

type RwAbHealthHistoryCommand = { label: string; key: RwKey };
type RwAbHealthHistoryAttempt = {
  attempt: 'read' | 'read-continue';
  flag: RwKeyFlag.Read | RwKeyFlag.ReadContinue;
  build: (key: RwKey) => Uint8Array;
};
type RwAbHealthHistorySdkAckResult = {
  ack: RingParsedData | null;
  nextPayload: RingParsedData | null;
};

interface RwAbHealthHistoryReadOptions {
  phase?: 'pre-native' | 'final';
  commands?: RwAbHealthHistoryCommand[];
  responseWaitMs?: number;
  deleteAfterRead?: boolean;
}

export const syncRwHistoryFiles = async (
  adapter: LegacyRingAdapter,
  options: SyncRwHistoryOptions = {}
): Promise<SyncRwHistoryResult> => {
  const timeoutMs = options.timeoutMs ?? 30000;
  const readAll = Boolean(options.readAll);
  const sinceTimestamp = getRwHistorySinceTimestamp(options);
  const readDetails = getRwHistoryReadDetails(options, sinceTimestamp, readAll, timeoutMs);
  const unexpectedResponses: RingParsedData[] = [];
  watchForUnexpectedRwHistoryResponse(adapter, timeoutMs, readDetails, unexpectedResponses);
  await runRwHistoryPreflight(adapter, options, readDetails);

  if (isRwLastDataOnlyHistoryRequest(options)) {
    return syncRwNativeLastDataOnly(adapter, options, sinceTimestamp, readAll, timeoutMs, readDetails, unexpectedResponses);
  }

  const pendingInitialHistory = adapter.waitForParsedData(isRwInitialHistoryResponse, timeoutMs);
  pendingInitialHistory.catch(() => undefined);
  appendRwHistoryDiagnosticLog('history-initial-wait-start', {
    ...readDetails,
    primaryCommand: readAll ? '3601' : '3600',
    fallbackCommand: '3610'
  });
  await sendRwLegacyLocalDataRead(adapter, readDetails);

  const initialParsed = await waitForRwHistoryInitialWithFallback(
    adapter,
    pendingInitialHistory,
    options,
    readDetails,
    unexpectedResponses
  );
  if (isRwLegacyLocalDataResponse(initialParsed)) {
    return mapRwLegacyLocalDataResult(initialParsed, options, sinceTimestamp, readAll, readDetails);
  }

  if (isRwNativeHistoryListResponse(initialParsed)) {
    return mapRwNativeHistoryListResult(initialParsed, options, sinceTimestamp, readAll, readDetails);
  }

  if (isRwAbHealthHistoryResponse(initialParsed)) {
    return mapRwAbHealthHistoryResult(initialParsed, options, sinceTimestamp, readAll, readDetails);
  }

  const fileListParsed = initialParsed;
  const allFiles = (Array.isArray(fileListParsed.files) ? fileListParsed.files : []) as RwFileListItem[];
  const files = filterRwHistoryFilesByOptions(allFiles, options, sinceTimestamp);
  const identity = getRwParsedIdentity(fileListParsed);
  const historyMeta = {
    allFiles,
    totalFileCount: allFiles.length,
    selectedFileCount: files.length,
    filteredFileCount: Math.max(0, allFiles.length - files.length),
    readAll,
    sinceTimestamp,
    dataType: options.dataType,
    dataTypes: normalizeRwHistoryDataTypes(options.dataTypes)
  };
  appendRwHistoryDiagnosticLog('file-list-received', {
    ...readDetails,
    totalFileCount: allFiles.length,
    selectedFileCount: files.length,
    filteredFileCount: Math.max(0, allFiles.length - files.length),
    files: summarizeRwHistoryFiles(files)
  });

  if (files.length === 0) {
    const isFilteredEmpty = allFiles.length > 0;
    const parsed: RingParsedData = {
      type: 'local_data',
      protocol: 'rw',
      status: isFilteredEmpty ? 'filtered' : 'empty',
      message: isFilteredEmpty ? 'RW history files are outside the current read range or type filter.' : 'RW history file list is empty.',
      records: [],
      files,
      ...identity,
      ...historyMeta,
      raw: fileListParsed.raw || []
    };
    appendRwHistoryDiagnosticLog('sync-empty', {
      ...historyMeta,
      status: parsed.status,
      message: parsed.message
    });
    return { parsed, records: [] };
  }

  const records: Array<Record<string, any>> = [];
  const uploadEvents: RingParsedData[] = [];

  for (const file of files) {
    appendRwHistoryDiagnosticLog('upload-request-start', summarizeRwHistoryFile(file));
    const fileEvents = await requestRwFileUpload(adapter, file, timeoutMs);
    appendRwHistoryDiagnosticLog('upload-request-result', {
      ...summarizeRwHistoryFile(file),
      eventTypes: fileEvents.map((event) => event.type),
      recordCount: fileEvents.reduce((count, event) => count + (Array.isArray(event.records) ? event.records.length : 0), 0),
      finished: fileEvents.some(isRwUploadFinished)
    });
    uploadEvents.push(...fileEvents);
    records.push(...fileEvents.flatMap((event) => mapRwUploadEventToRecords(event, file, identity)));

    if (!fileEvents.some((event) => event.type === 'rw_upload_file')) {
      records.push(mapRwFileListItemToRecord(file, 'pending_upload_payload', identity));
    }
  }

  const parsed: RingParsedData = {
    type: 'local_data',
    protocol: 'rw',
    status: records.length > 0 ? 'success' : 'empty',
    records,
    files,
    ...identity,
    ...historyMeta,
    uploadEvents,
    totalNum: records.length,
    raw: fileListParsed.raw || []
  };

  appendRwHistoryDiagnosticLog('sync-result', {
    ...historyMeta,
    status: parsed.status,
    recordCount: records.length,
    uploadEventCount: uploadEvents.length
  });

  return { parsed, records };
};

const sendRwLegacyLocalDataRead = async (
  adapter: LegacyRingAdapter,
  readDetails: Record<string, unknown>
) => {
  const readAll = Boolean(readDetails.readAll);
  const sinceTimestamp = Number(readDetails.sinceTimestamp || 0);
  await adapter.sendBytes(
    buildRwReadLocalDataCommand(sinceTimestamp, readAll),
    `history/read-local-data-${readAll ? 'full' : 'incremental'}`
  );
};

const runRwHistoryPreflight = async (
  adapter: LegacyRingAdapter,
  options: SyncRwHistoryOptions,
  readDetails: Record<string, unknown>
) => {
  const preflightDelayMs = getRwHistoryPreflightDelayMs(options, Number(readDetails.timeoutMs || 0));
  const responseTimeoutMs = getRwHistoryPreflightResponseTimeoutMs(options, Number(readDetails.timeoutMs || 0));
  const pendingTimeResponse = responseTimeoutMs > 0
    ? adapter.waitForParsedData(isRwHistoryPreflightResponse, responseTimeoutMs)
    : null;
  pendingTimeResponse?.catch(() => undefined);

  appendRwHistoryDiagnosticLog('history-preflight-start', {
    ...readDetails,
    syncFrameType: 'rw-app-sdk-key',
    syncCommands: [
      'history/preflight-sync-time-zone-key',
      'history/preflight-sync-time-key',
      'history/preflight-sync-time-format-key',
      'history/preflight-read-time-key',
      'history/preflight-default-monitoring'
    ],
    delayMs: preflightDelayMs,
    responseTimeoutMs
  });

  try {
    const now = Date.now();
    await adapter.sendBytes(buildRwSetTimeZoneKeyCommand(), 'history/preflight-sync-time-zone-key');
    if (preflightDelayMs > 0) await sleep(Math.min(preflightDelayMs, 250));
    await adapter.sendBytes(buildRwSetDateTimeKeyCommand(now), 'history/preflight-sync-time-key');
    if (preflightDelayMs > 0) await sleep(Math.min(preflightDelayMs, 250));
    await adapter.sendBytes(buildRwSetTimeFormatKeyCommand(true), 'history/preflight-sync-time-format-key');
    if (preflightDelayMs > 0) await sleep(Math.min(preflightDelayMs, 250));
    await sendRwDefaultMonitoringConfigs(adapter, readDetails, preflightDelayMs);
    if (preflightDelayMs > 0) await sleep(Math.min(preflightDelayMs, 250));
    await adapter.sendBytes(buildRwReadDateTimeKeyCommand(), 'history/preflight-read-time-key');

    let preflightResponse: RingParsedData | null = null;
    if (pendingTimeResponse) {
      try {
        preflightResponse = await pendingTimeResponse;
      } catch (error) {
        appendRwHistoryDiagnosticLog('history-preflight-timeout', {
          ...readDetails,
          syncFrameType: 'rw-app-sdk-key',
          delayMs: preflightDelayMs,
          responseTimeoutMs,
          error: formatRwHistoryError(error)
        });
      }
    } else if (preflightDelayMs > 0) {
      await sleep(preflightDelayMs);
    }

    if (preflightResponse) {
      appendRwHistoryDiagnosticLog('history-preflight-response', {
        ...readDetails,
        response: summarizeRwHistoryPreflightResponse(preflightResponse)
      });
    }

    appendRwHistoryDiagnosticLog('history-preflight-sent', {
      ...readDetails,
      syncFrameType: 'rw-app-sdk-key',
      delayMs: preflightDelayMs,
      responseTimeoutMs,
      responseType: preflightResponse?.type || ''
    });
  } catch (error) {
    appendRwHistoryDiagnosticLog('history-preflight-failed', {
      ...readDetails,
      error: formatRwHistoryError(error)
    });
  }
};

const sendRwDefaultMonitoringConfigs = async (
  adapter: LegacyRingAdapter,
  readDetails: Record<string, unknown>,
  preflightDelayMs: number
) => {
  const config: RwHealthMonitoringConfig = {
    enabled: true,
    startHour: 0,
    startMinute: 0,
    endHour: 23,
    endMinute: 59,
    interval: RW_HISTORY_DEFAULT_MONITORING_INTERVAL_MINUTES
  };
  const commands = [
    { label: 'heart-rate', key: RwKey.HrMonitoring },
    { label: 'blood-oxygen', key: RwKey.Spo2Monitoring },
    { label: 'hrv', key: RwKey.HrvMonitoring },
    { label: 'stress', key: RwKey.StressMonitoring }
  ];

  appendRwHistoryDiagnosticLog('history-preflight-default-monitoring-start', {
    ...readDetails,
    intervalMinutes: config.interval,
    commands: commands.map((item) => item.label)
  });

  for (const command of commands) {
    try {
      await adapter.sendBytes(
        buildRwSetHealthMonitoringCommand(command.key, config),
        `history/preflight-default-monitoring/${command.label}`
      );
      if (preflightDelayMs > 0) await sleep(Math.min(preflightDelayMs, 120));
    } catch (error) {
      appendRwHistoryDiagnosticLog('history-preflight-default-monitoring-failed', {
        ...readDetails,
        key: command.key,
        label: command.label,
        error: formatRwHistoryError(error)
      });
    }
  }
};

const sendRwNativeHistoryListReads = async (
  adapter: LegacyRingAdapter,
  options: SyncRwHistoryOptions,
  readDetails: Record<string, unknown>
) => {
  const startTimestamp = Number(readDetails.sinceTimestamp || 0);
  const endTimestamp = Math.floor(Date.now() / 1000);
  const commands = getRwNativeHistoryListCommands(options);
  appendRwHistoryDiagnosticLog('history-native-list-fallback', {
    ...readDetails,
    startTimestamp,
    endTimestamp,
    commands: commands.map((item) => item.label),
    commandIntervalMs: RW_HISTORY_NATIVE_LIST_COMMAND_INTERVAL_MS
  });

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    await adapter.sendBytes(
      buildRwQkeerV2HistoryListCommand(command.cmd, startTimestamp, endTimestamp),
      `history/native-list/${command.label}`
    );
    if (index < commands.length - 1) {
      await sleep(RW_HISTORY_NATIVE_LIST_COMMAND_INTERVAL_MS);
    }
  }
};

const sendRwNativeLastDataRead = async (
  adapter: LegacyRingAdapter,
  readDetails: Record<string, unknown>
) => {
  appendRwHistoryDiagnosticLog('history-native-last-data-fallback', readDetails);
  await adapter.sendBytes(buildRwQkeerV2LastDataCommand(), 'history/native-last-data');
};

const readRwAbHealthHistoryKeys = async (
  adapter: LegacyRingAdapter,
  options: SyncRwHistoryOptions,
  readDetails: Record<string, unknown>,
  readOptions: RwAbHealthHistoryReadOptions = {}
) => {
  const commands = readOptions.commands ?? getRwAbHealthHistoryCommands(options);
  if (commands.length === 0) return null;

  const responses: RingParsedData[] = [];
  const phase = readOptions.phase || 'final';
  const responseWaitMs = readOptions.responseWaitMs ?? RW_HISTORY_AB_KEY_RESPONSE_WAIT_MS;
  const requestedDeleteAfterRead = readOptions.deleteAfterRead ?? options.deleteAfterRead === true;
  appendRwHistoryDiagnosticLog('history-ab-key-fallback', {
    ...readDetails,
    phase,
    commands: commands.map((item) => item.label),
    responseWaitMs,
    requestedDeleteAfterRead,
    packetAckMode: 'app-sdk-flag-30-after-payload',
    deleteAfterReadIgnored: requestedDeleteAfterRead,
    commandIntervalMs: RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS
  });

  for (const command of commands) {
    if (shouldSkipRwHistoryCommandForDiagnosticLock(readDetails, `history/ab-key/${command.label}`, {
      phase,
      key: command.key,
      label: command.label
    })) break;

    const sdkLoopResponses = await readRwAbHealthHistoryWithSdkDeleteLoop(
      adapter,
      command,
      readDetails,
      phase,
      responseWaitMs
    );
    if (sdkLoopResponses.length > 0) {
      responses.push(...sdkLoopResponses);
      if (RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS > 0) {
        await sleep(RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS);
      }
      continue;
    }
    if (isRwAbSdkAckLoopKey(command.key)) {
      if (RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS > 0) {
        await sleep(RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS);
      }
      continue;
    }

    const attempts = getRwAbHealthHistoryAttempts();

    for (const attempt of attempts) {
      const commandLabel = `history/ab-key/${command.label}/${attempt.attempt}`;
      if (shouldSkipRwHistoryCommandForDiagnosticLock(readDetails, commandLabel, {
        phase,
        attempt: attempt.attempt,
        flag: attempt.flag,
        key: command.key,
        label: command.label
      })) break;

      const pendingResponse = adapter.waitForParsedData(
        (parsed) => isRwAbHealthHistoryResponseForKeyAndAttempt(parsed, command.key, attempt.flag),
        responseWaitMs
      );
      pendingResponse.catch(() => undefined);

      await adapter.sendBytes(attempt.build(command.key), commandLabel);

      try {
        const parsed = await pendingResponse;
        responses.push(parsed);
        const hasPayload = hasRwAbHealthHistoryPayload(parsed);
        appendRwHistoryDiagnosticLog('history-ab-key-response', {
          ...readDetails,
          phase,
          attempt: attempt.attempt,
          flag: attempt.flag,
          key: command.key,
          label: command.label,
          hasPayload,
          response: summarizeRwHistoryInitialResponse(parsed)
        });
        if (hasPayload) break;
        if (attempt.attempt === 'read') {
          appendRwHistoryDiagnosticLog('history-ab-key-empty-stop', {
            ...readDetails,
            phase,
            reason: 'empty',
            key: command.key,
            label: command.label,
            previousAttempt: attempt.attempt,
            previousFlag: attempt.flag,
            nextAttempt: 'none',
            responseFlag: parsed.flag,
            response: summarizeRwHistoryInitialResponse(parsed)
          });
          break;
        }
      } catch (error) {
        appendRwHistoryDiagnosticLog('history-ab-key-timeout', {
          ...readDetails,
          phase,
          attempt: attempt.attempt,
          flag: attempt.flag,
          key: command.key,
          label: command.label,
          error: formatRwHistoryError(error)
        });
        if (attempt.attempt === 'read') {
          appendRwHistoryDiagnosticLog('history-ab-key-timeout-stop', {
            ...readDetails,
            phase,
            reason: 'timeout',
            key: command.key,
            label: command.label,
            previousAttempt: attempt.attempt,
            previousFlag: attempt.flag,
            nextAttempt: 'none',
            error: formatRwHistoryError(error)
          });
          break;
        }
      }

    }

    if (RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS > 0) {
      await sleep(RW_HISTORY_AB_KEY_COMMAND_INTERVAL_MS);
    }
  }

  if (responses.length === 0) return null;

  return {
    type: 'rw_ab_health_history',
    protocol: 'rw',
    packetShape: 'ab_health_key',
    status: responses.some((item) => Array.isArray(item.records) && item.records.length > 0) ||
      responses.some((item) => item.value != null)
      ? 'success'
      : 'empty',
    records: responses.flatMap((item) => mapRwAbHealthParsedToRecords(item, options)),
    sourceResponses: responses.map(summarizeRwHistoryInitialResponse),
    timestamp: Date.now()
  } as RingParsedData;
};

const readRwAbHealthHistoryWithSdkDeleteLoop = async (
  adapter: LegacyRingAdapter,
  command: RwAbHealthHistoryCommand,
  readDetails: Record<string, unknown>,
  phase: 'pre-native' | 'final',
  responseWaitMs: number
) => {
  if (!isRwAbSdkAckLoopKey(command.key)) return [];

  const responses: RingParsedData[] = [];
  const maxReads = getRwAbSdkAckLoopMaxReads(command.key);
  appendRwHistoryDiagnosticLog('history-ab-key-sdk-loop-start', {
    ...readDetails,
    phase,
    key: command.key,
    label: command.label,
    strategy: 'GET_ACK_GET_UNTIL_EMPTY',
    readFlag: RwKeyFlag.Read,
    ackFlag: RwKeyFlag.Delete,
    maxReads,
    responseWaitMs,
    ackWaitMs: RW_HISTORY_AB_KEY_DELETE_WAIT_MS
  });

  const seenPayloadFingerprints = new Set<string>();
  let queuedReadPayload: RingParsedData | null = null;
  let endedWithEmpty = false;
  let stoppedByDuplicate = false;

  for (let readIndex = 0; readIndex < maxReads; readIndex += 1) {
    try {
      let parsed: RingParsedData;
      if (queuedReadPayload) {
        parsed = queuedReadPayload;
        queuedReadPayload = null;
        appendRwHistoryDiagnosticLog('history-ab-key-sdk-queued-read-response', {
          ...readDetails,
          phase,
          key: command.key,
          label: command.label,
          readIndex: readIndex + 1,
          response: summarizeRwHistoryInitialResponse(parsed)
        });
      } else {
        const commandLabel = `history/ab-key/${command.label}/read`;
        if (shouldSkipRwHistoryCommandForDiagnosticLock(readDetails, commandLabel, {
          phase,
          key: command.key,
          label: command.label,
          readIndex: readIndex + 1
        })) break;

        const pendingRead = adapter.waitForParsedData(
          (pendingParsed) => isRwAbHealthHistoryResponseForKeyAndAttempt(pendingParsed, command.key, RwKeyFlag.Read),
          responseWaitMs
        );
        pendingRead.catch(() => undefined);

        await adapter.sendBytes(buildRwReadHealthDataCommand(command.key), commandLabel);
        parsed = await pendingRead;
      }

      const hasPayload = hasRwAbHealthHistoryPayload(parsed);
      appendRwHistoryDiagnosticLog('history-ab-key-sdk-read-response', {
        ...readDetails,
        phase,
        key: command.key,
        label: command.label,
        readIndex: readIndex + 1,
        hasPayload,
        response: summarizeRwHistoryInitialResponse(parsed)
      });
      if (!hasPayload) {
        responses.push(parsed);
        endedWithEmpty = true;
        break;
      }

      const payloadFingerprint = getRwAbHealthHistoryPayloadFingerprint(parsed);
      if (payloadFingerprint && seenPayloadFingerprints.has(payloadFingerprint)) {
        appendRwHistoryDiagnosticLog('history-ab-key-sdk-duplicate-payload-retry-delete', {
          ...readDetails,
          phase,
          key: command.key,
          label: command.label,
          readIndex: readIndex + 1,
          readCount: responses.length,
          fingerprint: payloadFingerprint,
          response: summarizeRwHistoryInitialResponse(parsed)
        });
        const retryAckResult = await sendRwAbHealthHistorySdkAck(
          adapter,
          command,
          readDetails,
          phase,
          responses.length,
          'payload'
        );
        if (retryAckResult.nextPayload) {
          queuedReadPayload = retryAckResult.nextPayload;
          continue;
        }
        stoppedByDuplicate = true;
        break;
      }
      if (payloadFingerprint) seenPayloadFingerprints.add(payloadFingerprint);

      responses.push(parsed);
      const ackResult = await sendRwAbHealthHistorySdkAck(
        adapter,
        command,
        readDetails,
        phase,
        responses.length,
        'payload'
      );

      if (ackResult.nextPayload) {
        queuedReadPayload = ackResult.nextPayload;
      } else if (!ackResult.ack) {
        appendRwHistoryDiagnosticLog('history-ab-key-sdk-ack-missing-continue', {
          ...readDetails,
          phase,
          key: command.key,
          label: command.label,
          reason: 'ack-timeout-after-payload',
          readCount: responses.length,
          nextAction: 'read-next-block'
        });
      }
    } catch (error) {
      appendRwHistoryDiagnosticLog('history-ab-key-sdk-read-timeout', {
        ...readDetails,
        phase,
        key: command.key,
        label: command.label,
        readIndex: readIndex + 1,
        error: formatRwHistoryError(error)
      });
      break;
    }
  }

  if (!endedWithEmpty && !stoppedByDuplicate && responses.length > 0 && hasRwAbHealthHistoryPayload(responses[responses.length - 1])) {
    appendRwHistoryDiagnosticLog('history-ab-key-sdk-loop-not-ended', {
      ...readDetails,
      phase,
      key: command.key,
      label: command.label,
      readCount: responses.length,
      maxReads
    });
  }

  return responses;
};

const sendRwAbHealthHistorySdkAck = async (
  adapter: LegacyRingAdapter,
  command: RwAbHealthHistoryCommand,
  readDetails: Record<string, unknown>,
  phase: 'pre-native' | 'final',
  readCount: number,
  ackReason: 'payload'
): Promise<RwAbHealthHistorySdkAckResult> => {
  const commandLabel = `history/ab-key/${command.label}/ack`;
  if (shouldSkipRwHistoryCommandForDiagnosticLock(readDetails, commandLabel, {
    phase,
    key: command.key,
    label: command.label,
    readCount,
    ackReason
  })) return { ack: null, nextPayload: null };

  const pendingAck = adapter.waitForParsedData(
    (parsed) =>
      isRwAbHealthHistoryResponseForKeyAndAttempt(parsed, command.key, RwKeyFlag.Delete) ||
      (
        isRwAbHealthHistoryResponseForKeyAndAttempt(parsed, command.key, RwKeyFlag.Read) &&
        hasRwAbHealthHistoryDataBlockPayload(parsed)
      ),
    RW_HISTORY_AB_KEY_DELETE_WAIT_MS
  );
  pendingAck.catch(() => undefined);

  await adapter.sendBytes(buildRwDeleteHealthDataCommand(command.key), commandLabel);

  try {
    const parsed = await pendingAck;
    const responseFlag = getRwAbHealthHistoryResponseFlag(parsed);
    if (responseFlag === RwKeyFlag.Read && hasRwAbHealthHistoryDataBlockPayload(parsed)) {
      appendRwHistoryDiagnosticLog('history-ab-key-sdk-next-payload-during-ack', {
        ...readDetails,
        phase,
        key: command.key,
        label: command.label,
        readCount,
        ackReason,
        response: summarizeRwHistoryInitialResponse(parsed)
      });
      return { ack: null, nextPayload: parsed };
    }

    appendRwHistoryDiagnosticLog('history-ab-key-sdk-ack-response', {
      ...readDetails,
      phase,
      key: command.key,
      label: command.label,
      readCount,
      ackReason,
      response: summarizeRwHistoryInitialResponse(parsed)
    });
    return { ack: parsed, nextPayload: null };
  } catch (error) {
    appendRwHistoryDiagnosticLog('history-ab-key-sdk-ack-timeout', {
      ...readDetails,
      phase,
      key: command.key,
      label: command.label,
      readCount,
      ackReason,
      error: formatRwHistoryError(error)
    });
    return { ack: null, nextPayload: null };
  }
};

const isRwAbSdkAckLoopKey = (key: RwKey) => [
  RwKey.ActivityCurrentDay,
  RwKey.Activity,
  RwKey.Sleep,
  RwKey.RawSleep,
  RwKey.HeartRate,
  RwKey.BloodPressure,
  RwKey.Temperature,
  RwKey.BloodOxygen,
  RwKey.Hrv,
  RwKey.Stress,
  RwKey.BloodSugar
].includes(key);

const getRwAbSdkAckLoopMaxReads = (key: RwKey) => {
  if (key === RwKey.ActivityCurrentDay || key === RwKey.Activity) return RW_HISTORY_AB_ACTIVITY_SDK_LOOP_MAX_READS;
  if (key === RwKey.Sleep || key === RwKey.RawSleep) return RW_HISTORY_AB_SLEEP_SDK_LOOP_MAX_READS;
  return RW_HISTORY_AB_KEY_SDK_LOOP_MAX_READS;
};

const mergeRwAbHealthHistoryParsed = (...values: Array<RingParsedData | null | undefined>) => {
  const parsedValues = values.filter((item): item is RingParsedData => item?.type === 'rw_ab_health_history');
  if (parsedValues.length === 0) return null;
  if (parsedValues.length === 1) return parsedValues[0];

  const records = parsedValues.flatMap((item) => Array.isArray(item.records) ? item.records : []);
  const sourceResponses = parsedValues.flatMap((item) =>
    Array.isArray(item.sourceResponses) ? item.sourceResponses : []
  );
  const dataTypes = Array.from(new Set(parsedValues.flatMap((item) =>
    Array.isArray(item.dataTypes) ? item.dataTypes : []
  ).filter(Boolean)));
  const raw = parsedValues.flatMap((item) => Array.isArray(item.raw) ? item.raw : []);
  const latest = parsedValues[parsedValues.length - 1];

  return {
    ...parsedValues[0],
    ...latest,
    type: 'rw_ab_health_history',
    protocol: 'rw',
    packetShape: 'ab_health_key',
    status: records.length > 0 || parsedValues.some((item) => item.status === 'success') ? 'success' : 'empty',
    records,
    dataTypes: dataTypes.length > 0 ? dataTypes : latest.dataTypes,
    sourceResponses,
    raw,
    totalNum: records.length,
    timestamp: Date.now()
  } as RingParsedData;
};

const mergeRwHistoryFallbackWithAbHealthParsed = (...values: Array<RingParsedData | null | undefined>) => {
  const parsedValues = Array.from(new Set(values.filter((item): item is RingParsedData => Boolean(item))));
  const abValues = parsedValues.filter((item) => item.type === 'rw_ab_health_history');
  if (abValues.length === 0) return null;

  const records = parsedValues.flatMap((item) => Array.isArray(item.records) ? item.records : []);
  if (records.length === 0) return mergeRwAbHealthHistoryParsed(...abValues);

  const sourceResponses = parsedValues.flatMap((item) =>
    Array.isArray(item.sourceResponses) && item.sourceResponses.length > 0
      ? item.sourceResponses
      : [summarizeRwHistoryInitialResponse(item)]
  );
  const dataTypes = Array.from(new Set(parsedValues.flatMap((item) => {
    const declared = Array.isArray(item.dataTypes) ? item.dataTypes : [];
    const direct = normalizeRwHistoryDataType(item.dataType || item.name);
    return [...declared, direct].filter(Boolean);
  })));
  const raw = parsedValues.flatMap((item) => Array.isArray(item.raw) ? item.raw : []);
  const latest = parsedValues[parsedValues.length - 1];

  return {
    ...latest,
    type: 'rw_ab_health_history',
    sourceType: 'mixed_history',
    protocol: 'rw',
    packetShape: 'ab_health_key',
    status: 'success',
    records,
    dataTypes: dataTypes.length > 0 ? dataTypes : latest.dataTypes,
    sourceResponses,
    raw,
    totalNum: records.length,
    timestamp: Date.now()
  } as RingParsedData;
};

const getRwAbHealthHistoryAttempts = (): RwAbHealthHistoryAttempt[] => [
  {
    attempt: 'read',
    flag: RwKeyFlag.Read,
    build: (key) => buildRwAbHealthHistoryReadCommand(key)
  },
  {
    attempt: 'read-continue',
    flag: RwKeyFlag.ReadContinue,
    build: (key) => buildRwReadContinueKeyCommand(key)
  }
];

const buildRwAbHealthHistoryReadCommand = (key: RwKey) => {
  if (key === RwKey.AppRealTimeTemperature) return buildRwReadKeyCommand(key);
  return buildRwReadHealthDataCommand(key);
};

const syncRwNativeLastDataOnly = async (
  adapter: LegacyRingAdapter,
  options: SyncRwHistoryOptions,
  sinceTimestamp: number,
  readAll: boolean,
  timeoutMs: number,
  readDetails: Record<string, unknown>,
  unexpectedResponses: RingParsedData[]
): Promise<SyncRwHistoryResult> => {
  appendRwHistoryDiagnosticLog('history-last-data-only-start', {
    ...readDetails,
    primaryCommand: 'qkeer_v2_last_data'
  });

  const pendingLastData = adapter.waitForParsedData(isRwNativeHistoryListResponse, timeoutMs);
  pendingLastData.catch(() => undefined);

  try {
    await sendRwNativeLastDataRead(adapter, readDetails);
    const parsed = await pendingLastData;
    appendRwHistoryDiagnosticLog('history-last-data-only-response', {
      ...readDetails,
      response: summarizeRwHistoryInitialResponse(parsed)
    });
    if (isRwNativeHistoryListResponse(parsed)) {
      return mapRwNativeHistoryListResult(parsed, options, sinceTimestamp, readAll, readDetails);
    }
    throw new Error(`Unexpected RW LastData response: ${parsed.type || 'unknown'}`);
  } catch (error) {
    const message = formatRwHistoryError(error);
    const timeoutMessage = formatRwHistoryFileListTimeout(
      {
        ...readDetails,
        historyMode: 'last_data_only'
      },
      message
    );
    appendRwHistoryDiagnosticLog('history-last-data-only-timeout', {
      ...readDetails,
      error: message,
      message: timeoutMessage,
      unexpectedResponseCount: unexpectedResponses.length,
      unexpectedResponses: unexpectedResponses.map(summarizeRwHistoryUnexpectedResponse)
    });
    throw new Error(timeoutMessage);
  }
};

const getRwNativeHistoryListCommands = (options: SyncRwHistoryOptions) => {
  const requestedTypes = getRwRequestedHistoryDataTypes(options).filter((type) => type !== 'summary');
  const types = requestedTypes.length > 0 ? requestedTypes : ['vital', 'step', 'sleep'];
  const commands: Array<{ label: string; cmd: RwQkeerV2HistoryCommand }> = [];

  const addCommand = (label: string, cmd: RwQkeerV2HistoryCommand) => {
    if (commands.some((item) => item.cmd === cmd)) return;
    commands.push({ label, cmd });
  };

  for (const type of types) {
    if (type === 'sleep') {
      addCommand('sleep', RwQkeerV2HistoryCommand.SleepList);
    } else if (type === 'step') {
      addCommand('step', RwQkeerV2HistoryCommand.StepList);
    } else {
      addCommand('health', RwQkeerV2HistoryCommand.HealthList);
    }
  }

  return commands;
};

const getRwAbHealthHistoryCommands = (options: SyncRwHistoryOptions) => {
  const requestedTypes = getRwRequestedHistoryDataTypes(options).filter((type) => type !== 'summary');
  const types = requestedTypes.length > 0 ? requestedTypes : ['heart_rate', 'blood_oxygen', 'temperature', 'hrv', 'stress', 'blood_sugar', 'blood_pressure', 'step', 'sleep'];
  const commands: RwAbHealthHistoryCommand[] = [];

  const addCommand = (label: string, key: RwKey) => {
    if (commands.some((item) => item.key === key)) return;
    commands.push({ label, key });
  };

  for (const type of types) {
    if (type === 'vital') {
      addCommand('heart-rate', RwKey.HeartRate);
      addCommand('blood-oxygen', RwKey.BloodOxygen);
      addCommand('temperature-current', RwKey.AppRealTimeTemperature);
      addCommand('temperature-history', RwKey.Temperature);
      addCommand('hrv', RwKey.Hrv);
      addCommand('stress', RwKey.Stress);
      addCommand('blood-sugar', RwKey.BloodSugar);
      addCommand('blood-pressure', RwKey.BloodPressure);
    } else if (type === 'heart_rate') {
      addCommand('heart-rate', RwKey.HeartRate);
    } else if (type === 'blood_oxygen') {
      addCommand('blood-oxygen', RwKey.BloodOxygen);
    } else if (type === 'temperature') {
      addCommand('temperature-current', RwKey.AppRealTimeTemperature);
      addCommand('temperature-history', RwKey.Temperature);
    } else if (type === 'hrv') {
      addCommand('hrv', RwKey.Hrv);
    } else if (type === 'stress') {
      addCommand('stress', RwKey.Stress);
    } else if (type === 'blood_sugar') {
      addCommand('blood-sugar', RwKey.BloodSugar);
    } else if (type === 'blood_pressure') {
      addCommand('blood-pressure', RwKey.BloodPressure);
    } else if (type === 'step') {
      addCommand('activity-current-day', RwKey.ActivityCurrentDay);
      addCommand('activity-history', RwKey.Activity);
    } else if (type === 'sleep') {
      // RW APP 的睡眠历史同步走 0x0505 这条块队列：读到 len>3 后删除当前块，再继续读到空块结束。
      // 0x02FE 在业务同步链路里会超时，保留 parser 兼容但不作为页面同步命令主动读取。
      addCommand('sleep-history', RwKey.Sleep);
    }
  }

  return commands;
};

const getRwPreNativeAbHealthHistoryCommands = (options: SyncRwHistoryOptions) => {
  const commands = getRwAbHealthHistoryCommands(options);
  if (commands.length <= RW_HISTORY_AB_KEY_PRE_NATIVE_COMMAND_LIMIT) return commands;
  const coreOrder = [RwKey.HeartRate, RwKey.BloodOxygen, RwKey.AppRealTimeTemperature, RwKey.Temperature];
  const selected: RwAbHealthHistoryCommand[] = [];

  for (const key of coreOrder) {
    const command = commands.find((item) => item.key === key);
    if (command) selected.push(command);
  }

  for (const command of commands) {
    if (selected.length >= RW_HISTORY_AB_KEY_PRE_NATIVE_COMMAND_LIMIT) break;
    if (!selected.some((item) => item.key === command.key)) selected.push(command);
  }

  return selected;
};

const excludeRwAbHealthHistoryCommands = (
  commands: RwAbHealthHistoryCommand[],
  excludedKeys: Set<RwKey>
) => commands.filter((command) => !excludedKeys.has(command.key));

const mapRwAbHealthParsedToRecords = (parsed: RingParsedData, options: SyncRwHistoryOptions) => {
  const identity = getRwParsedIdentity(parsed);
  const parsedName = normalizeRwHistoryDataType(parsed.name);
  const requestedTypes = getRwRequestedHistoryDataTypes(options);
  const fallbackDataType = parsedName || (requestedTypes.length === 1 ? requestedTypes[0] : 'vital');
  const sourceRecords = Array.isArray(parsed.records) ? parsed.records : [];
  if (sourceRecords.length > 0) {
    return sourceRecords.map((record) =>
      normalizeRwHistoryRecordMetrics({
        ...identity,
        ...record,
        protocol: 'rw',
        dataType: normalizeRwHistoryDataType(record.dataType) || fallbackDataType,
        rawDataType: record.rawDataType || 'ab_health_key'
      })
    );
  }

  if (parsed.value == null || parsed.type !== 'rw_health_data') return [];
  const metric = createRwAbHealthMetricRecord(fallbackDataType, parsed.value);
  if (!metric) return [];
  const unixTime = normalizeRwRecordTimestamp(parsed.recordTime) ||
    normalizeRwRecordTimestamp(parsed.timestamp) ||
    Math.floor(Date.now() / 1000);
  return [
    normalizeRwHistoryRecordMetrics({
      ...identity,
      protocol: 'rw',
      dataType: fallbackDataType,
      rawDataType: 'ab_health_key',
      key: parsed.key,
      unixTime,
      timestamp: unixTime,
      raw: parsed.raw,
      data: parsed.data,
      ...metric
    })
  ];
};

const createRwAbHealthMetricRecord = (dataType: string, value: unknown) => {
  if (dataType === 'step') {
    const stepCount = normalizeRwHistoryStepCountValue(value);
    return stepCount == null || stepCount <= 0 ? null : { stepCount, step: stepCount };
  }
  if (dataType === 'sleep') {
    const sleepState = normalizeRwHistoryFiniteNumber(value);
    return sleepState == null || sleepState < 1 || sleepState > 5 ? null : { sleepState };
  }
  if (dataType === 'heart_rate') {
    const heartRate = normalizeRwHistoryHeartRateValue(value);
    return heartRate == null ? null : { heartRate, heartrate: heartRate };
  }
  if (dataType === 'blood_oxygen') {
    const bloodOxygen = normalizeRwHistoryBloodOxygenValue(value);
    return bloodOxygen == null ? null : { bloodOxygen, spo2: bloodOxygen };
  }
  if (dataType === 'temperature') {
    const temperature = normalizeRwHistoryFiniteNumber(value);
    return temperature == null ? null : { temperature };
  }
  if (dataType === 'hrv') {
    const hrv = normalizeRwHistoryFiniteNumber(value);
    return hrv == null || hrv <= 0 ? null : { hrv, heartRateVariability: hrv };
  }
  if (dataType === 'stress') {
    const stress = normalizeRwHistoryFiniteNumber(value);
    return stress == null || stress < 0 || stress > 100 ? null : { stress, stressIndex: stress };
  }
  if (dataType === 'blood_sugar') {
    const bloodSugar = normalizeRwHistoryBloodSugarValue(value);
    return bloodSugar == null ? null : { bloodSugar };
  }
  if (dataType === 'blood_pressure' && value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const systolic = normalizeRwHistoryFiniteNumber(record.systolic);
    const diastolic = normalizeRwHistoryFiniteNumber(record.diastolic);
    if (
      systolic == null ||
      diastolic == null ||
      systolic < 60 ||
      systolic > 260 ||
      diastolic < 30 ||
      diastolic > 180 ||
      systolic <= diastolic
    ) {
      return null;
    }
    return { systolic, diastolic, bloodPressure: `${systolic ?? '-'}/${diastolic ?? '-'}` };
  }
  return { value };
};

const requestRwFileUpload = async (adapter: LegacyRingAdapter, file: RwFileListItem, timeoutMs: number) => {
  const events: RingParsedData[] = [];
  const startedAt = Date.now();

  let pendingEvent = adapter.waitForParsedData((parsed) => isRwUploadEventForFile(parsed, file), timeoutMs);
  await adapter.sendBytes(buildRwRequestUploadCommand(file.seq), `history/request-upload/${file.seq}`);

  while (Date.now() - startedAt < timeoutMs) {
    const remaining = Math.max(1000, timeoutMs - (Date.now() - startedAt));
    try {
      const event = await pendingEvent;
      events.push(event);
      if (isRwUploadFinished(event)) break;
      if (Date.now() - startedAt < timeoutMs) {
        pendingEvent = adapter.waitForParsedData((parsed) => isRwUploadEventForFile(parsed, file), remaining);
      }
    } catch {
      break;
    }
  }

  return events;
};

const waitForRwHistoryInitialWithFallback = async (
  adapter: LegacyRingAdapter,
  pendingInitialHistory: Promise<RingParsedData>,
  options: SyncRwHistoryOptions,
  readDetails: Record<string, unknown>,
  unexpectedResponses: RingParsedData[]
) => {
  const retryDelayMs = getRwHistoryFileListRetryDelay(options);

  try {
    if (retryDelayMs <= 0) return await pendingInitialHistory;

    const firstResult = await Promise.race([
      pendingInitialHistory.then(
        (parsed) => ({ parsed }),
        () => ({ parsed: null as RingParsedData | null })
      ),
      sleep(retryDelayMs).then(() => ({ parsed: null as RingParsedData | null }))
    ]);

    if (firstResult.parsed) return firstResult.parsed;

    appendRwHistoryDiagnosticLog('history-initial-file-list-fallback', {
      ...readDetails,
      retryDelayMs
    });

    const pendingFallback = pendingInitialHistory;
    pendingFallback.catch(() => undefined);
    appendRwHistoryDiagnosticLog('history-fallback-wait-start', {
      ...readDetails,
      waitFor: 'rw_file_list|legacy_local_data|ab_health_key|native_history_list',
      timeoutMs: Number(readDetails.timeoutMs || 30000)
    });

    const allAbCommands = getRwAbHealthHistoryCommands(options);
    const preNativeAbCommands = getRwPreNativeAbHealthHistoryCommands(options);
    const preNativeAbCommandKeys = new Set(preNativeAbCommands.map((command) => command.key));
    let finalAbCommands = excludeRwAbHealthHistoryCommands(allAbCommands, preNativeAbCommandKeys);
    let preNativeAbFallbackParsed: RingParsedData | null = null;
    let fallbackParsed: RingParsedData | null = null;
    let shouldSkipLegacyFallback = false;
    const preNativeAbHealthParsed = await readRwAbHealthHistoryKeys(adapter, options, readDetails, {
      phase: 'pre-native',
      commands: preNativeAbCommands,
      responseWaitMs: RW_HISTORY_AB_KEY_PRE_NATIVE_RESPONSE_WAIT_MS
    });
    if (preNativeAbHealthParsed) {
      appendRwHistoryDiagnosticLog('history-ab-key-result', {
        ...readDetails,
        phase: 'pre-native',
        response: summarizeRwHistoryInitialResponse(preNativeAbHealthParsed)
      });
      if (hasRwAbHealthHistoryPayload(preNativeAbHealthParsed)) {
        preNativeAbFallbackParsed = preNativeAbHealthParsed;
        fallbackParsed = preNativeAbHealthParsed;
        if (finalAbCommands.length === 0) {
          return preNativeAbHealthParsed;
        }
        appendRwHistoryDiagnosticLog('history-ab-key-partial-continue', {
          ...readDetails,
          phase: 'pre-native',
          response: summarizeRwHistoryInitialResponse(preNativeAbHealthParsed),
          remainingCommands: finalAbCommands.map((item) => item.label)
        });
      } else {
        appendRwHistoryDiagnosticLog('history-ab-key-empty-skip-legacy', {
          ...readDetails,
          phase: 'pre-native',
          response: summarizeRwHistoryInitialResponse(preNativeAbHealthParsed),
          remainingCommands: finalAbCommands.map((item) => item.label)
        });
      }
      shouldSkipLegacyFallback = true;
    } else if (preNativeAbCommands.length > 0) {
      finalAbCommands = allAbCommands;
    }

    if (shouldSkipLegacyFallback) {
      appendRwHistoryDiagnosticLog('history-ab-key-skip-legacy-fallback', {
        ...readDetails,
        phase: 'pre-native',
        reason: preNativeAbHealthParsed && hasRwAbHealthHistoryPayload(preNativeAbHealthParsed) ? 'ab-payload' : 'ab-empty',
        remainingCommands: finalAbCommands.map((item) => item.label)
      });
    } else {
      await sendRwNativeHistoryListReads(adapter, options, readDetails);

      const nativeListWaitMs = getRwHistoryFallbackResponseWaitMs(
        readDetails,
        RW_HISTORY_NATIVE_LIST_FALLBACK_DELAY_MS
      );
      const nativeResult = await Promise.race([
        pendingFallback.then(
          (parsed) => ({ parsed }),
          () => ({ parsed: null as RingParsedData | null })
        ),
        sleep(nativeListWaitMs).then(() => ({ parsed: null as RingParsedData | null }))
      ]);

      if (nativeResult.parsed) {
        appendRwHistoryDiagnosticLog('history-native-list-wait-response', {
          ...readDetails,
          waitMs: nativeListWaitMs,
          response: summarizeRwHistoryInitialResponse(nativeResult.parsed)
        });
        if (isRwInitialHistoryResponse(nativeResult.parsed)) {
          if (!preNativeAbFallbackParsed && !shouldContinueRwFinalAbAfterFallback(nativeResult.parsed, finalAbCommands)) {
            return nativeResult.parsed;
          }
          const missingCommands = getMissingRwFinalAbCommandsForFallback(nativeResult.parsed, finalAbCommands);
          finalAbCommands = missingCommands;
          if (!preNativeAbFallbackParsed) {
            appendRwHistoryDiagnosticLog('history-native-list-partial-continue-final-ab', {
              ...readDetails,
              waitMs: nativeListWaitMs,
              remainingCommands: missingCommands.map((item) => item.label),
              response: summarizeRwHistoryInitialResponse(nativeResult.parsed)
            });
          }
          fallbackParsed = nativeResult.parsed;
        } else {
          fallbackParsed = nativeResult.parsed;
        }
      }

      if (!fallbackParsed) {
        appendRwHistoryDiagnosticLog('history-native-list-wait-timeout', {
          ...readDetails,
          waitMs: nativeListWaitMs,
          unexpectedResponseCount: unexpectedResponses.length
        });

        await sendRwNativeLastDataRead(adapter, readDetails);

        const lastDataWaitMs = getRwHistoryFallbackResponseWaitMs(
          readDetails,
          RW_HISTORY_LAST_DATA_FALLBACK_DELAY_MS
        );
        const lastDataResult = await Promise.race([
          pendingFallback.then(
            (parsed) => ({ parsed }),
            () => ({ parsed: null as RingParsedData | null })
          ),
          sleep(lastDataWaitMs).then(() => ({ parsed: null as RingParsedData | null }))
        ]);

        if (lastDataResult.parsed) {
          appendRwHistoryDiagnosticLog('history-last-data-wait-response', {
            ...readDetails,
            waitMs: lastDataWaitMs,
            response: summarizeRwHistoryInitialResponse(lastDataResult.parsed)
          });
          if (isRwInitialHistoryResponse(lastDataResult.parsed)) {
            if (!shouldContinueRwFinalAbAfterFallback(lastDataResult.parsed, finalAbCommands)) {
              return lastDataResult.parsed;
            }
            const missingCommands = getMissingRwFinalAbCommandsForFallback(lastDataResult.parsed, finalAbCommands);
            finalAbCommands = missingCommands;
            appendRwHistoryDiagnosticLog('history-last-data-partial-continue-final-ab', {
              ...readDetails,
              waitMs: lastDataWaitMs,
              remainingCommands: missingCommands.map((item) => item.label),
              response: summarizeRwHistoryInitialResponse(lastDataResult.parsed)
            });
          }
          fallbackParsed = lastDataResult.parsed;
        } else {
          appendRwHistoryDiagnosticLog('history-last-data-wait-timeout', {
            ...readDetails,
            waitMs: lastDataWaitMs,
            unexpectedResponseCount: unexpectedResponses.length
          });
        }
      }

      if (!fallbackParsed) {
        try {
          appendRwHistoryDiagnosticLog('history-final-read-local-data-fallback', {
            ...readDetails,
            command: 'adapter.readLocalData',
            unexpectedResponseCount: unexpectedResponses.length
          });
          await adapter.readLocalData({
            sinceTimestamp: Number(readDetails.sinceTimestamp || 0),
            readAll: Boolean(readDetails.readAll),
            dataType: typeof readDetails.dataType === 'string' ? readDetails.dataType : options.dataType,
            dataTypes: Array.isArray(readDetails.dataTypes) ? readDetails.dataTypes as string[] : options.dataTypes
          });

          const finalReadWaitMs = getRwHistoryFallbackResponseWaitMs(
            readDetails,
            RW_HISTORY_FINAL_FILE_LIST_FALLBACK_DELAY_MS
          );
          const finalReadResult = await Promise.race([
            pendingFallback.then(
              (parsed) => ({ parsed }),
              () => ({ parsed: null as RingParsedData | null })
            ),
            sleep(finalReadWaitMs).then(() => ({ parsed: null as RingParsedData | null }))
          ]);

          if (finalReadResult.parsed) {
            appendRwHistoryDiagnosticLog('history-final-read-local-data-response', {
              ...readDetails,
              waitMs: finalReadWaitMs,
              response: summarizeRwHistoryInitialResponse(finalReadResult.parsed)
            });
            if (!shouldContinueRwFinalAbAfterFallback(finalReadResult.parsed, finalAbCommands)) {
              return finalReadResult.parsed;
            }
            const missingCommands = getMissingRwFinalAbCommandsForFallback(finalReadResult.parsed, finalAbCommands);
            finalAbCommands = missingCommands;
            appendRwHistoryDiagnosticLog('history-final-read-local-data-partial-continue-final-ab', {
              ...readDetails,
              waitMs: finalReadWaitMs,
              remainingCommands: missingCommands.map((item) => item.label),
              response: summarizeRwHistoryInitialResponse(finalReadResult.parsed)
            });
            fallbackParsed = finalReadResult.parsed;
          }

          if (!finalReadResult.parsed) {
            appendRwHistoryDiagnosticLog('history-final-read-local-data-timeout', {
              ...readDetails,
              waitMs: finalReadWaitMs,
              unexpectedResponseCount: unexpectedResponses.length
            });
          }
        } catch (error) {
          appendRwHistoryDiagnosticLog('file-list-fallback-write-failed', {
            ...readDetails,
            retryDelayMs,
            error: formatRwHistoryError(error)
          });
        }
      }
    }

    const abHealthParsed = await readRwAbHealthHistoryKeys(adapter, options, readDetails, {
      phase: 'final',
      commands: finalAbCommands
    });
    if (abHealthParsed) {
      appendRwHistoryDiagnosticLog('history-ab-key-result', {
        ...readDetails,
        phase: 'final',
        response: summarizeRwHistoryInitialResponse(abHealthParsed)
      });
      if (hasRwAbHealthHistoryPayload(abHealthParsed)) {
        return mergeRwHistoryFallbackWithAbHealthParsed(fallbackParsed, preNativeAbFallbackParsed, abHealthParsed) ||
          mergeRwAbHealthHistoryParsed(preNativeAbFallbackParsed, abHealthParsed) ||
          abHealthParsed;
      }
      if (!fallbackParsed) {
        return abHealthParsed;
      }
      appendRwHistoryDiagnosticLog('history-ab-key-empty-use-fallback', {
        ...readDetails,
        phase: 'final',
        fallback: summarizeRwHistoryInitialResponse(fallbackParsed),
        response: summarizeRwHistoryInitialResponse(abHealthParsed)
      });
    }

    if (fallbackParsed) {
      if (preNativeAbFallbackParsed && !hasRwHistoryParsedPayload(fallbackParsed)) {
        appendRwHistoryDiagnosticLog('history-ab-key-empty-use-pre-native', {
          ...readDetails,
          phase: 'final',
          fallback: summarizeRwHistoryInitialResponse(fallbackParsed),
          preNative: summarizeRwHistoryInitialResponse(preNativeAbFallbackParsed)
        });
        return preNativeAbFallbackParsed;
      }
      return fallbackParsed;
    }
    if (shouldSkipLegacyFallback && preNativeAbHealthParsed) {
      return preNativeAbHealthParsed;
    }
    return await pendingFallback;
  } catch (error) {
    const message = formatRwHistoryError(error);
    const timeoutMessage = formatRwHistoryFileListTimeout(readDetails, message);
    appendRwHistoryDiagnosticLog('history-initial-timeout', {
      ...readDetails,
      error: message,
      message: timeoutMessage,
      unexpectedResponseCount: unexpectedResponses.length,
      unexpectedResponses: unexpectedResponses.map(summarizeRwHistoryUnexpectedResponse)
    });
    throw new Error(timeoutMessage);
  }
};

const watchForUnexpectedRwHistoryResponse = (
  adapter: LegacyRingAdapter,
  timeoutMs: number,
  readDetails: Record<string, unknown>,
  unexpectedResponses: RingParsedData[]
) => {
  const pendingUnexpectedResponse = adapter.waitForParsedData(isRwUnexpectedHistoryResponse, timeoutMs);
  pendingUnexpectedResponse.then(
    (parsed) => {
      unexpectedResponses.push(parsed);
      appendRwHistoryDiagnosticLog('history-unexpected-response', {
        ...readDetails,
        response: summarizeRwHistoryUnexpectedResponse(parsed)
      });
    },
    () => undefined
  );
};

const isRwHistoryPreflightResponse = (parsed: RingParsedData) => {
  return parsed.protocol === 'rw' && parsed.type === 'device_time';
};

const isRwInitialHistoryResponse = (parsed: RingParsedData) => {
  return parsed.type === 'rw_file_list' || isRwLegacyLocalDataResponse(parsed) || isRwNativeHistoryListResponse(parsed);
};

const isRwLegacyLocalDataResponse = (parsed: RingParsedData) => {
  return parsed.type === 'local_data' && parsed.protocol === 'rw' && parsed.packetShape === 'legacy_compat';
};

const isRwNativeHistoryListResponse = (parsed: RingParsedData) => {
  if (parsed.protocol !== 'rw' || parsed.packetShape !== 'qkeer_v2_compat') return false;
  return (
    parsed.type === 'local_data' ||
    parsed.type === 'qkeer_v2_health_list' ||
    parsed.type === 'qkeer_v2_last_data' ||
    parsed.type === 'qkeer_v2_sleep_list' ||
    parsed.type === 'qkeer_v2_step_list'
  );
};

const isRwAbHealthHistoryResponse = (parsed: RingParsedData) => {
  if (parsed.protocol !== 'rw' && parsed.protocol != null) return false;
  if (parsed.type === 'rw_ab_health_history') return true;
  if (!['rw_health_data', 'rw_health_data_ack'].includes(parsed.type)) return false;
  return isRwAbHealthHistoryKey(Number(parsed.key));
};

const isRwAbHealthHistoryResponseForKey = (parsed: RingParsedData, key: RwKey) => {
  return isRwAbHealthHistoryResponse(parsed) && Number(parsed.key) === key;
};

const isRwAbHealthHistoryResponseForKeyAndAttempt = (parsed: RingParsedData, key: RwKey, flag: RwKeyFlag) => {
  if (!isRwAbHealthHistoryResponseForKey(parsed, key)) return false;
  const parsedFlag = getRwAbHealthHistoryResponseFlag(parsed);
  return parsedFlag === flag;
};

const getRwAbHealthHistoryResponseFlag = (parsed: RingParsedData) => {
  const directFlag = Number(parsed.flag);
  if (Number.isFinite(directFlag)) return directFlag & 0xff;

  const rawBytes = getRwHistoryRawBytes(parsed.raw);
  if (rawBytes.length >= 9 && (rawBytes[0] === 0xab || rawBytes[0] === 0xc6)) return rawBytes[8] & 0xff;

  const rawHex = typeof (parsed as any).rawHex === 'string' ? (parsed as any).rawHex.replace(/\s+/g, '') : '';
  if (/^[0-9a-f]+$/i.test(rawHex) && rawHex.length >= 18) {
    const parsedRawFlag = Number.parseInt(rawHex.slice(16, 18), 16);
    if (Number.isFinite(parsedRawFlag)) return parsedRawFlag & 0xff;
  }

  return null;
};

const getRwHistoryRawBytes = (raw: unknown) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => value & 0xff);
};

const isRwAbHealthHistoryKey = (key: number) => {
  return [
    RwKey.Activity,
    RwKey.HeartRate,
    RwKey.BloodPressure,
    RwKey.RawSleep,
    RwKey.Sleep,
    RwKey.Temperature,
    RwKey.AppRealTimeTemperature,
    RwKey.BloodOxygen,
    RwKey.Hrv,
    RwKey.Stress,
    RwKey.BloodSugar,
    RwKey.ActivityCurrentDay
  ].includes(key);
};

const hasRwAbHealthHistoryPayload = (parsed: RingParsedData) => {
  if (Array.isArray(parsed.records) && parsed.records.length > 0) return true;
  if (parsed.value != null && parsed.value !== '') return true;
  const data = Array.isArray((parsed as { data?: unknown }).data)
    ? ((parsed as { data?: unknown[] }).data || [])
    : [];
  return data.length > 1;
};

const hasRwAbHealthHistoryDataBlockPayload = (parsed: RingParsedData) => {
  if (Array.isArray(parsed.records) && parsed.records.length > 0) return true;
  const data = getRwHistoryRawBytes((parsed as { data?: unknown }).data);
  if (data.length > 1) return true;
  const raw = getRwHistoryRawBytes(parsed.raw);
  return raw.length > 9;
};

const getRwAbHealthHistoryPayloadFingerprint = (parsed: RingParsedData) => {
  const data = getRwHistoryRawBytes((parsed as { data?: unknown }).data);
  const bytes = data.length > 1 ? data : getRwHistoryRawBytes(parsed.raw);
  if (bytes.length === 0) return '';
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return [
    Number(parsed.key),
    getRwAbHealthHistoryResponseFlag(parsed) ?? '',
    bytes.length,
    hex
  ].join(':');
};

const hasRwHistoryParsedPayload = (parsed: RingParsedData | null | undefined) => {
  if (!parsed) return false;
  if (Array.isArray(parsed.records) && parsed.records.length > 0) return true;
  if (Number(parsed.totalNum) > 0) return true;
  return parsed.value != null && parsed.value !== '';
};

const shouldContinueRwFinalAbAfterFallback = (
  parsed: RingParsedData,
  finalAbCommands: RwAbHealthHistoryCommand[]
) => {
  if (finalAbCommands.length === 0) return false;
  if (!hasRwHistoryParsedPayload(parsed)) return true;
  return getMissingRwFinalAbCommandsForFallback(parsed, finalAbCommands).length > 0;
};

const getMissingRwFinalAbCommandsForFallback = (
  parsed: RingParsedData,
  finalAbCommands: RwAbHealthHistoryCommand[]
) => finalAbCommands.filter((command) => !hasRwHistoryParsedMetricForCommand(parsed, command));

const hasRwHistoryParsedMetricForCommand = (parsed: RingParsedData, command: RwAbHealthHistoryCommand) => {
  if (Number(parsed.key) === command.key && (parsed.value != null || (Array.isArray(parsed.records) && parsed.records.length > 0))) {
    return true;
  }

  const records = Array.isArray(parsed.records) ? parsed.records : [];
  if (records.length === 0) return false;
  return records.some((record) => hasRwHistoryRecordMetricForCommand(record, command));
};

const hasRwHistoryRecordMetricForCommand = (record: Record<string, any>, command: RwAbHealthHistoryCommand) => {
  const dataTypeText = `${record.dataType || ''}_${record.rawDataType || ''}_${record.type || ''}`.toLowerCase();
  const hasAlias = (aliases: string[]) => getRwHistoryRecordValue(record, aliases) != null;

  if (command.key === RwKey.Activity || command.key === RwKey.ActivityCurrentDay) {
    return /step|sport|activity/.test(dataTypeText) || hasAlias(['stepCount', 'step_count', 'steps', 'step', 'totalSteps']);
  }
  if (command.key === RwKey.Sleep || command.key === RwKey.RawSleep) {
    return /sleep/.test(dataTypeText) || hasAlias([
      'sleepState',
      'sleep_state',
      'sleepStatus',
      'sleep_status',
      'sleepType',
      'sleep_type',
      'sleepDuration',
      'sleep_duration',
      'durationMinutes',
      'duration_minutes',
      'sleepTotalMinutes',
      'sleep_total_minutes',
      'totalSleepMinutes',
      'total_sleep_minutes',
      'sleepMinutes',
      'sleep_minutes'
    ]);
  }
  if (command.key === RwKey.HeartRate) {
    return hasAlias(['heartRate', 'heart_rate', 'heartrate', 'hr', 'bpm']);
  }
  if (command.key === RwKey.BloodOxygen) {
    return hasAlias(['bloodOxygen', 'blood_oxygen', 'bloodOxy', 'bloodOxygenSaturation', 'spo2', 'oxygen', 'bo']);
  }
  if (command.key === RwKey.Temperature || command.key === RwKey.AppRealTimeTemperature) {
    return hasAlias(['temperature', 'temp', 'bodyTemperature', 'body_temperature', 'bodyTemp', 'body_temp', 'skinTemperature', 'skin_temperature', 'skinTemp', 'skin_temp']);
  }
  if (command.key === RwKey.Hrv) {
    return hasAlias(['hrv', 'hrvValue', 'hrv_value', 'heartRateVariability', 'heart_rate_variability', 'rmssd']);
  }
  if (command.key === RwKey.Stress) {
    return hasAlias(['stress', 'stressValue', 'stress_value', 'stressIndex', 'stress_index', 'pressure', 'fatigue']);
  }
  if (command.key === RwKey.BloodSugar) {
    return hasAlias(['bloodSugar', 'blood_sugar', 'bloodSugarValue', 'blood_sugar_value', 'glucose', 'sugar']);
  }
  if (command.key === RwKey.BloodPressure) {
    return hasAlias(['bloodPressure', 'blood_pressure', 'bp', 'systolic', 'diastolic', 'sbp', 'dbp']);
  }
  return false;
};

const isRwUnexpectedHistoryResponse = (parsed: RingParsedData) => {
  if (parsed.type === 'rw_raw_unparsed') return true;
  if (parsed.protocol !== 'rw') return false;
  if (parsed.type === 'rw_unknown' && Number(parsed.cmd) === 0x36) return true;
  if (parsed.type === 'rw_file_system') return true;
  return false;
};

const summarizeRwHistoryUnexpectedResponse = (parsed: RingParsedData) => ({
  type: parsed.type,
  cmd: parsed.cmd,
  subcmd: parsed.subcmd,
  frameId: parsed.frameId,
  serviceId: parsed.serviceId,
  characteristicId: parsed.characteristicId,
  rawLength: Array.isArray(parsed.raw) ? parsed.raw.length : undefined,
  rawHex: formatRwHistoryRawHex(parsed.raw)
});

const summarizeRwHistoryPreflightResponse = (parsed: RingParsedData) => ({
  type: parsed.type,
  subcmd: parsed.subcmd,
  frameId: parsed.frameId,
  deviceTimestamp: parsed.deviceTimestamp,
  timezone: parsed.timezone,
  readable: parsed.readable,
  rawLength: Array.isArray(parsed.raw) ? parsed.raw.length : undefined,
  rawHex: formatRwHistoryRawHex(parsed.raw)
});

const summarizeRwHistoryInitialResponse = (parsed: RingParsedData) => ({
  type: parsed.type,
  sourceType: parsed.sourceType,
  packetShape: parsed.packetShape,
  status: parsed.status,
  dataType: parsed.dataType,
  dataTypes: parsed.dataTypes,
  key: parsed.key,
  flag: parsed.flag,
  name: parsed.name,
  value: parsed.value,
  recordCount: Array.isArray(parsed.records) ? parsed.records.length : undefined,
  totalNum: parsed.totalNum,
  fileCount: Array.isArray(parsed.files) ? parsed.files.length : undefined,
  cmd: parsed.cmd,
  subcmd: parsed.subcmd,
  frameId: parsed.frameId,
  qkeerCommand: parsed.qkeerCommand,
  rawLength: Array.isArray(parsed.raw) ? parsed.raw.length : undefined,
  rawHex: formatRwHistoryRawHex(parsed.raw)
});

const mapRwLegacyLocalDataResult = (
  parsed: RingParsedData,
  options: SyncRwHistoryOptions,
  sinceTimestamp: number,
  readAll: boolean,
  readDetails: Record<string, unknown>
): SyncRwHistoryResult => {
  const identity = getRwParsedIdentity(parsed);
  const sourceRecords = Array.isArray(parsed.records) ? parsed.records : [];
  const dataTypes = getRwRequestedHistoryDataTypes(options);
  const records = sourceRecords.map((record) =>
    normalizeRwHistoryRecordMetrics({
      ...identity,
      ...record,
      protocol: 'rw',
      dataType: getRwLegacyLocalDataRecordType(record, options)
    })
  );
  const status = parsed.status || (records.length > 0 ? 'success' : 'empty');
  const result: RingParsedData = {
    ...parsed,
    type: 'local_data',
    protocol: 'rw',
    status,
    records,
    ...identity,
    readAll,
    sinceTimestamp,
    dataType: options.dataType,
    dataTypes,
    totalNum: parsed.totalNum ?? records.length,
    raw: parsed.raw || []
  };
  appendRwHistoryDiagnosticLog('legacy-local-data-received', {
    ...readDetails,
    status,
    recordCount: records.length,
    totalNum: result.totalNum
  });
  return { parsed: result, records };
};

const mapRwNativeHistoryListResult = (
  parsed: RingParsedData,
  options: SyncRwHistoryOptions,
  sinceTimestamp: number,
  readAll: boolean,
  readDetails: Record<string, unknown>
): SyncRwHistoryResult => {
  const identity = getRwParsedIdentity(parsed);
  const sourceRecords = Array.isArray(parsed.records) ? parsed.records : [];
  const dataTypes = getRwRequestedHistoryDataTypes(options);
  const records = sourceRecords.map((record) => {
    const mapped = {
      ...identity,
      ...record,
      protocol: 'rw',
      dataType: getRwNativeHistoryRecordType(record, parsed, options),
      rawDataType: record.rawDataType || record.dataType || parsed.dataType
    };
    if (mapped.heartRate == null && mapped.heartrate != null) mapped.heartRate = mapped.heartrate;
    if (mapped.bloodOxygen == null && mapped.spo2 != null) mapped.bloodOxygen = mapped.spo2;
    return normalizeRwHistoryRecordMetrics(mapped);
  });
  const status = parsed.status || (records.length > 0 ? 'success' : 'empty');
  const result: RingParsedData = {
    ...parsed,
    type: 'local_data',
    sourceType: parsed.type,
    protocol: 'rw',
    packetShape: 'qkeer_v2_compat',
    status,
    records,
    ...identity,
    readAll,
    sinceTimestamp,
    dataType: options.dataType || parsed.dataType,
    dataTypes,
    totalNum: parsed.totalNum ?? records.length,
    raw: parsed.raw || []
  };
  appendRwHistoryDiagnosticLog('native-list-received', {
    ...readDetails,
    sourceType: parsed.type,
    dataType: parsed.dataType,
    status,
    recordCount: records.length,
    totalNum: result.totalNum
  });
  return { parsed: result, records };
};

const mapRwAbHealthHistoryResult = (
  parsed: RingParsedData,
  options: SyncRwHistoryOptions,
  sinceTimestamp: number,
  readAll: boolean,
  readDetails: Record<string, unknown>
): SyncRwHistoryResult => {
  const identity = getRwParsedIdentity(parsed);
  const dataTypes = getRwRequestedHistoryDataTypes(options);
  const sourceRecords = Array.isArray(parsed.records) ? parsed.records : [];
  const records = sourceRecords.map((record) =>
    normalizeRwHistoryRecordMetrics({
      ...identity,
      ...record,
      protocol: 'rw',
      dataType: normalizeRwHistoryDataType(record.dataType) || normalizeRwHistoryDataType(parsed.name) || 'vital',
      rawDataType: record.rawDataType || 'ab_health_key'
    })
  );
  const status = parsed.status || (records.length > 0 ? 'success' : 'empty');
  const result: RingParsedData = {
    ...parsed,
    type: 'local_data',
    sourceType: parsed.type,
    protocol: 'rw',
    packetShape: 'ab_health_key',
    status,
    records,
    ...identity,
    readAll,
    sinceTimestamp,
    dataType: options.dataType || parsed.dataType,
    dataTypes,
    totalNum: parsed.totalNum ?? records.length,
    raw: parsed.raw || []
  };
  appendRwHistoryDiagnosticLog('ab-health-history-received', {
    ...readDetails,
    status,
    recordCount: records.length,
    totalNum: result.totalNum,
    sourceResponseCount: Array.isArray(parsed.sourceResponses) ? parsed.sourceResponses.length : undefined
  });
  return { parsed: result, records };
};

const getRwHistoryFileListRetryDelay = (options: SyncRwHistoryOptions) => {
  const timeoutMs = options.timeoutMs ?? 30000;
  const configuredDelayMs = options.fileListRetryDelayMs ?? RW_HISTORY_FILE_LIST_RETRY_DELAY_MS;
  return Math.min(configuredDelayMs, Math.max(0, timeoutMs - 500));
};

const getRwHistoryFallbackResponseWaitMs = (
  readDetails: Record<string, unknown>,
  preferredWaitMs: number
) => {
  const timeoutMs = Number(readDetails.timeoutMs || 30000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return preferredWaitMs;
  if (timeoutMs <= 3000) return Math.min(preferredWaitMs, Math.max(120, Math.floor(timeoutMs * 0.08)));
  if (timeoutMs <= 5000) return Math.min(preferredWaitMs, Math.max(250, Math.floor(timeoutMs * 0.12)));

  const stagedWaitMs = Math.floor(Math.max(0, timeoutMs - 1500) * 0.3);
  return Math.min(preferredWaitMs, Math.max(2000, stagedWaitMs));
};

const getRwHistoryPreflightDelayMs = (options: SyncRwHistoryOptions, timeoutMs: number) => {
  const configuredDelayMs = Number(options.preflightDelayMs);
  if (Number.isFinite(configuredDelayMs) && configuredDelayMs >= 0) return configuredDelayMs;
  return timeoutMs > 5000 ? RW_HISTORY_PREFLIGHT_DELAY_MS : 0;
};

const getRwHistoryPreflightResponseTimeoutMs = (options: SyncRwHistoryOptions, timeoutMs: number) => {
  const configuredTimeoutMs = Number(options.preflightResponseTimeoutMs);
  if (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs >= 0) return configuredTimeoutMs;
  return timeoutMs > 5000 ? RW_HISTORY_PREFLIGHT_RESPONSE_TIMEOUT_MS : 0;
};

const getRwHistoryReadDetails = (
  options: SyncRwHistoryOptions,
  sinceTimestamp: number,
  readAll: boolean,
  timeoutMs: number
) => ({
  timeoutMs,
  readAll,
  sinceTimestamp,
  dataType: options.dataType,
  dataTypes: getRwRequestedHistoryDataTypes(options)
});

const formatRwHistoryFileListTimeout = (details: Record<string, unknown>, cause: string) => {
  const dataTypes = Array.isArray(details.dataTypes) && details.dataTypes.length > 0
    ? (details.dataTypes as string[]).join(',')
    : '-';
  return [
    `RW history response timeout after ${details.timeoutMs}ms`,
    `readAll=${details.readAll}`,
    `sinceTimestamp=${details.sinceTimestamp}`,
    `dataType=${details.dataType || '-'}`,
    `dataTypes=${dataTypes}`,
    details.historyMode ? `mode=${details.historyMode}` : '',
    cause ? `cause=${cause}` : ''
  ].filter(Boolean).join('; ');
};

const summarizeRwHistoryFiles = (files: RwFileListItem[]) => files.slice(0, 8).map(summarizeRwHistoryFile);

const summarizeRwHistoryFile = (file: RwFileListItem) => ({
  seq: file.seq,
  fileType: file.fileType,
  fileName: file.fileName,
  fileSize: file.fileSize,
  timestampText: file.timestampText,
  dataType: getRwHistoryDataType(file.fileType, file.fileName)
});

const isNodeRuntime = () => Boolean((globalThis as any).process?.versions?.node);

const appendRwHistoryDiagnosticLog = (event: string, details?: unknown) => {
  if (isNodeRuntime()) return;
  const uniRuntime = (globalThis as any).uni;
  if (!uniRuntime?.getStorageSync || !uniRuntime?.setStorageSync) return;

  try {
    const raw = uniRuntime.getStorageSync(RING_DIAGNOSTIC_LOG_STORAGE_KEY);
    const logs = Array.isArray(raw) ? raw : [];
    const entry = {
      id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      time: formatRwHistoryDiagnosticTime(),
      source: 'RW HISTORY',
      event,
      details: normalizeRwHistoryDiagnosticDetails(details)
    };
    logs.push(entry);
    uniRuntime.setStorageSync(RING_DIAGNOSTIC_LOG_STORAGE_KEY, logs.slice(-RING_DIAGNOSTIC_LOG_MAX_COUNT));
    enqueueRwDiagnosticUpload(entry);
  } catch {
    // History diagnostics must never affect BLE behavior.
  }
};

const formatRwHistoryDiagnosticTime = (date = new Date()) =>
  `${padRwHistoryDiagnosticNumber(date.getHours(), 2)}:${padRwHistoryDiagnosticNumber(date.getMinutes(), 2)}:${padRwHistoryDiagnosticNumber(date.getSeconds(), 2)}.${padRwHistoryDiagnosticNumber(date.getMilliseconds(), 3)}`;

const padRwHistoryDiagnosticNumber = (value: number, length: number) => `${value}`.padStart(length, '0');

const normalizeRwHistoryDiagnosticDetails = (details: unknown) => {
  if (details == null) return '';
  let text = '';
  if (typeof details === 'string') {
    text = details;
  } else {
    try {
      text = JSON.stringify(details);
    } catch {
      text = String(details);
    }
  }
  return text.length > RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH
    ? `${text.slice(0, RING_DIAGNOSTIC_LOG_MAX_DETAILS_LENGTH)}...<truncated>`
    : text;
};

const formatRwHistoryRawHex = (raw: unknown) => {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => (value & 0xff).toString(16).padStart(2, '0'))
    .join('');
};

const formatRwHistoryError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return `${error}`;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRwUploadEventForFile = (parsed: RingParsedData, file: RwFileListItem) => {
  if (!uploadEventTypes.has(parsed.type)) return false;
  if (parsed.seq == null) return true;
  return Number(parsed.seq) === Number(file.seq);
};

const isRwUploadFinished = (event: RingParsedData) => {
  if (event.type === 'rw_last_package_progress') return true;
  if (event.type === 'rw_upload_progress' && Number(event.progress) >= 100) return true;
  if (event.type === 'rw_upload_file' && event.status === 'completed') return true;
  return false;
};

const mapRwUploadEventToRecords = (event: RingParsedData, file: RwFileListItem, fallbackIdentity: Record<string, any> = {}) => {
  const identity = getRwParsedIdentity(event, fallbackIdentity);
  const sourceRecords = Array.isArray(event.records) ? event.records : [];
  if (sourceRecords.length > 0) {
    const fileTimestamp = parseRwFileTimestamp(file.timestampText);
    const eventStartTimestamp = normalizeRwRecordTimestamp(event.startTimestamp);
    const eventEndTimestamp = normalizeRwRecordTimestamp(event.endTimestamp);
    return sourceRecords.map((record) => {
      const recordStartTimestamp = normalizeRwRecordTimestamp(record.startTimestamp) || eventStartTimestamp || fileTimestamp || undefined;
      const recordEndTimestamp = normalizeRwRecordTimestamp(record.endTimestamp) || eventEndTimestamp || undefined;
      return normalizeRwHistoryRecordMetrics({
        ...identity,
        ...record,
        protocol: 'rw',
        dataType: getRwHistoryDataType(file.fileType, file.fileName),
        rawDataType: file.fileType || '',
        fileName: file.fileName,
        seq: file.seq,
        startTimestamp: recordStartTimestamp,
        endTimestamp: recordEndTimestamp,
        unixTime: getRwUploadRecordTimestamp(record) || recordStartTimestamp || fileTimestamp
      });
    });
  }

  if (event.type !== 'rw_upload_file') return [];
  return [mapRwFileListItemToRecord(file, event.status || 'uploaded', identity)];
};

const mapRwFileListItemToRecord = (file: RwFileListItem, status: string, identity: Record<string, any> = {}) => ({
  ...identity,
  protocol: 'rw',
  dataType: getRwHistoryDataType(file.fileType, file.fileName),
  rawDataType: file.fileType || '',
  status,
  seq: file.seq,
  fileName: file.fileName,
  fileSize: file.fileSize,
  userId: file.userId,
  timestampText: file.timestampText,
  unixTime: parseRwFileTimestamp(file.timestampText)
});

const normalizeRwHistoryRecordMetrics = (record: Record<string, any>) => {
  const normalized = { ...record };
  const bloodOxygen = normalizeRwHistoryBloodOxygenValue(
    getRwHistoryRecordValue(normalized, ['bloodOxygen', 'blood_oxygen', 'bloodOxy', 'bloodOxygenSaturation', 'spo2', 'oxygen', 'bo'])
  );
  const dataTypeText = `${normalized.dataType || ''}_${normalized.rawDataType || ''}_${normalized.fileType || ''}_${normalized.fileName || ''}`.toLowerCase();
  const hasBloodOxygenAlias =
    bloodOxygen != null ||
    /blood[_-]?oxygen|blood[_-]?oxy|spo2|oxygen|(^|[_\-.])bo($|[_\-.])/.test(dataTypeText) ||
    getRwHistoryRecordValue(normalized, ['bloodOxygen', 'blood_oxygen', 'bloodOxy', 'bloodOxygenSaturation', 'spo2', 'oxygen', 'bo']) != null;

  if (!hasBloodOxygenAlias) return normalized;

  if (bloodOxygen == null) {
    delete normalized.bloodOxygen;
    delete normalized.blood_oxygen;
    delete normalized.bloodOxy;
    delete normalized.bloodOxygenSaturation;
    delete normalized.spo2;
    delete normalized.oxygen;
    delete normalized.bo;
    return normalized;
  }

  normalized.bloodOxygen = bloodOxygen;
  normalized.spo2 = bloodOxygen;
  return normalized;
};

const normalizeRwHistoryBloodOxygenValue = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric) || numeric < 70 || numeric > 100) return null;
  return numeric;
};

const normalizeRwHistoryHeartRateValue = (value: unknown) => {
  const numeric = normalizeRwHistoryFiniteNumber(value);
  if (numeric == null || numeric < 25 || numeric > 240) return null;
  return numeric;
};

const normalizeRwHistoryStepCountValue = (value: unknown) => {
  const numeric = normalizeRwHistoryFiniteNumber(value);
  if (numeric == null || numeric < 0 || numeric > 300000) return null;
  return Math.floor(numeric);
};

const normalizeRwHistoryFiniteNumber = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeRwHistoryBloodSugarValue = (value: unknown) => {
  const numeric = normalizeRwHistoryFiniteNumber(value);
  if (numeric == null || numeric <= 0) return null;
  const normalized = numeric > 30 && numeric <= 300 ? Number((numeric / 10).toFixed(1)) : numeric;
  return normalized > 0 && normalized <= 30 ? normalized : null;
};

const getRwHistoryRecordValue = (record: Record<string, any>, aliases: string[]) => {
  for (const alias of aliases) {
    if (record[alias] != null && record[alias] !== '') return record[alias];
  }
  const lowerCaseEntries = Object.entries(record).reduce<Record<string, any>>((result, [key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(result, normalizedKey)) result[normalizedKey] = value;
    return result;
  }, {});
  for (const alias of aliases) {
    const value = lowerCaseEntries[alias.toLowerCase()];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

const getRwParsedIdentity = (parsed: RingParsedData | Record<string, any>, fallback: Record<string, any> = {}) => {
  const advertis = parsed.advertis || fallback.advertis;
  const stableIdentity = parsed.mac || advertis?.macInfo || fallback.mac || fallback.advertis?.macInfo;
  return {
    deviceId: parsed.deviceId || fallback.deviceId,
    uniMacId: stableIdentity || parsed.uniMacId || fallback.uniMacId,
    mac: stableIdentity,
    advertis,
    deviceName: parsed.deviceName || fallback.deviceName
  };
};

const getRwUploadRecordTimestamp = (record: Record<string, any>) => {
  return (
    normalizeRwRecordTimestamp(record.timestamp) ||
    normalizeRwRecordTimestamp(record.unixTime) ||
    normalizeRwRecordTimestamp(record.startTimestamp) ||
    normalizeRwRecordTimestamp(record.recordTimestamp) ||
    normalizeRwRecordTimestamp(record.recordTime) ||
    normalizeRwRecordTimestamp(record.time)
  );
};

export const getRwHistoryDataType = (fileType?: string, fileName?: string) => {
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
  return fileType || 'history_file';
};

export const parseRwFileTimestamp = (value?: string) => {
  if (!value || !/^\d{14}$/.test(value)) return 0;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  return Math.floor(new Date(year, month, day, hour, minute, second).getTime() / 1000);
};

const filterRwHistoryFilesByOptions = (files: RwFileListItem[], options: SyncRwHistoryOptions, sinceTimestamp: number) => {
  const dataTypes = normalizeRwHistoryDataTypes(options.dataTypes);
  return files.filter((file) => {
    if (dataTypes.length > 0 && !dataTypes.some((dataType) => isRwHistoryFileDataType(file, dataType))) return false;
    if (options.dataType && !isRwHistoryFileDataType(file, options.dataType)) return false;
    if (options.readAll || !sinceTimestamp) return true;
    const fileTimestamp = parseRwFileTimestamp(file.timestampText);
    return !fileTimestamp || fileTimestamp >= sinceTimestamp;
  });
};

const isRwHistoryFileDataType = (file: RwFileListItem, dataType: string) => {
  const normalizedTarget = normalizeRwHistoryDataType(dataType);
  if (!normalizedTarget) return true;
  const normalizedFileType = normalizeRwHistoryDataType(getRwHistoryDataType(file.fileType, file.fileName));
  return normalizedFileType === normalizedTarget;
};

const normalizeRwHistoryDataType = (value?: string) => {
  const normalized = `${value || ''}`.trim().replace(/-/g, '_').toLowerCase();
  const compact = normalized.replace(/[_\s]/g, '');
  if (!normalized) return '';
  if (compact === 'summary' || compact === 'lastdata' || compact === 'lastsnapshot' || compact === 'snapshot') return 'summary';
  if (compact === 'vital' || compact === 'vitals' || compact === 'vitalsigns' || compact === 'vitalsign' || compact === 'dailyhealth') {
    return 'vital';
  }
  if (compact === 'sleep' || compact === 'sleepdata' || compact === 'sleepdetail' || compact === 'sleepdetails') return 'sleep';
  if (compact === 'step' || compact === 'steps' || compact === 'stepcount' || compact === 'sport' || compact === 'activity' || compact === 'dailyactivity') {
    return 'step';
  }
  if (compact === 'spo2' || compact === 'bloodoxygen' || compact === 'bloodoxygenraw' || compact === 'oxygen') return 'blood_oxygen';
  if (compact === 'hr' || compact === 'heartrate' || compact === 'heartrateraw') return 'heart_rate';
  if (compact === 'bp' || compact === 'bloodpressure') return 'blood_pressure';
  if (compact === 'bs' || compact === 'glucose' || compact === 'bloodsugar') return 'blood_sugar';
  if (compact === 'bodytemperature' || compact === 'bodytemp' || compact === 'skintemperature' || compact === 'skintemp') {
    return 'temperature';
  }
  return normalized;
};

const normalizeRwHistoryDataTypes = (values?: string[]) => {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => normalizeRwHistoryDataType(value)).filter(Boolean)));
};

const getRwRequestedHistoryDataTypes = (options: SyncRwHistoryOptions) =>
  normalizeRwHistoryDataTypes([
    ...(options.dataType ? [options.dataType] : []),
    ...(Array.isArray(options.dataTypes) ? options.dataTypes : [])
  ]);

const isRwLastDataOnlyHistoryRequest = (options: SyncRwHistoryOptions) => {
  const requestedTypes = getRwRequestedHistoryDataTypes(options);
  return requestedTypes.length === 1 && requestedTypes[0] === 'summary';
};

const getRwLegacyLocalDataRecordType = (record: Record<string, any>, options: SyncRwHistoryOptions) => {
  const existing = normalizeRwHistoryDataType(record.dataType || record.rawDataType);
  if (existing) return existing;

  const dataType = normalizeRwHistoryDataType(options.dataType);
  if (dataType) return dataType;

  const dataTypes = normalizeRwHistoryDataTypes(options.dataTypes);
  if (dataTypes.length === 1) return dataTypes[0];

  return 'daily_health';
};

const getRwNativeHistoryRecordType = (
  record: Record<string, any>,
  parsed: RingParsedData,
  options: SyncRwHistoryOptions
) => {
  if (parsed.type === 'qkeer_v2_last_data') {
    return getRwLastDataHistoryRecordType(record, options);
  }

  const existing = normalizeRwHistoryDataType(record.dataType || record.rawDataType);
  if (existing) return existing;

  const parsedType = normalizeRwHistoryDataType(parsed.dataType);
  if (parsedType) return parsedType;

  if (parsed.type === 'qkeer_v2_sleep_list') return 'sleep';
  if (parsed.type === 'qkeer_v2_health_list') return 'vital';
  if (parsed.type === 'qkeer_v2_step_list') return 'step';

  const dataType = normalizeRwHistoryDataType(options.dataType);
  if (dataType) return dataType;

  const dataTypes = normalizeRwHistoryDataTypes(options.dataTypes);
  if (dataTypes.length === 1) return dataTypes[0];

  return 'vital';
};

const getRwLastDataHistoryRecordType = (record: Record<string, any>, options: SyncRwHistoryOptions) => {
  const requestedTypes = normalizeRwHistoryDataTypes([
    ...(options.dataType ? [options.dataType] : []),
    ...(Array.isArray(options.dataTypes) ? options.dataTypes : [])
  ]);

  if (requestedTypes.length === 1 && isRwLastDataRecordCompatibleWithType(record, requestedTypes[0])) {
    return requestedTypes[0];
  }

  const existing = normalizeRwHistoryDataType(record.dataType || record.rawDataType);
  if (existing && existing !== 'summary' && existing !== 'last_data') return existing;

  return 'summary';
};

const isRwLastDataRecordCompatibleWithType = (record: Record<string, any>, dataType: string): boolean => {
  if (dataType === 'sleep') {
    return hasRwHistoryRecordValue(record, [
      'sleepTotalMinutes',
      'totalSleepMinutes',
      'sleepDuration',
      'sleepDurationMinutes',
      'sleepMinutes',
      'sleepTime',
      'totalSleepTime'
    ]);
  }
  if (dataType === 'step') return hasRwHistoryRecordValue(record, ['stepCount', 'steps', 'step', 'totalSteps']);
  if (dataType === 'heart_rate') return hasRwHistoryRecordValue(record, ['heartRate', 'heartrate', 'heart_rate', 'hr', 'bpm']);
  if (dataType === 'blood_oxygen') {
    return hasRwHistoryRecordValue(record, ['bloodOxygen', 'blood_oxygen', 'bloodOxy', 'bloodOxygenSaturation', 'spo2', 'oxygen', 'bo']);
  }
  if (dataType === 'temperature') {
    return hasRwHistoryRecordValue(record, ['temperature', 'bodyTemperature', 'skinTemperature', 'bodyTemp', 'skinTemp', 'temp']);
  }
  if (dataType === 'hrv') return hasRwHistoryRecordValue(record, ['hrv', 'hrvValue']);
  if (dataType === 'stress') return hasRwHistoryRecordValue(record, ['stress', 'fatigue', 'pressure']);
  if (dataType === 'vital') {
    return (
      isRwLastDataRecordCompatibleWithType(record, 'heart_rate') ||
      isRwLastDataRecordCompatibleWithType(record, 'blood_oxygen') ||
      isRwLastDataRecordCompatibleWithType(record, 'temperature') ||
      isRwLastDataRecordCompatibleWithType(record, 'hrv') ||
      isRwLastDataRecordCompatibleWithType(record, 'stress') ||
      isRwLastDataRecordCompatibleWithType(record, 'blood_sugar') ||
      isRwLastDataRecordCompatibleWithType(record, 'blood_pressure')
    );
  }
  return false;
};

const hasRwHistoryRecordValue = (record: Record<string, any>, aliases: string[]) => {
  const value = getRwHistoryRecordValue(record, aliases);
  return value != null && value !== '';
};

const getRwHistorySinceTimestamp = (options: SyncRwHistoryOptions) => {
  if (options.readAll) return 0;
  return normalizeRwRecordTimestamp(options.sinceTimestamp) || getTodayZeroTimestamp();
};

const getTodayZeroTimestamp = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
};

const normalizeRwRecordTimestamp = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
};
