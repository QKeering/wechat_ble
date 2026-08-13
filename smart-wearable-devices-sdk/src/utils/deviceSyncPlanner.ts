import type { DeviceHistoryCheckpoint } from './deviceHistoryCheckpoint';

export const DEVICE_SYNC_AUTO_COOLDOWN_MS = 20 * 60 * 1000;
export const DEVICE_SYNC_EMPTY_READ_COOLDOWN_MS = 30 * 60 * 1000;
export const DEVICE_SYNC_HARD_STALE_MS = 12 * 60 * 60 * 1000;
export const DEVICE_SYNC_FIRST_SYNC_LOOKBACK_SECONDS = 48 * 60 * 60;
export const DEVICE_SYNC_INCREMENTAL_OVERLAP_SECONDS = 5 * 60;
export const DEVICE_SYNC_NORMAL_OVERLAP_SECONDS = DEVICE_SYNC_INCREMENTAL_OVERLAP_SECONDS;
export const DEVICE_SYNC_SLEEP_OVERLAP_SECONDS = DEVICE_SYNC_INCREMENTAL_OVERLAP_SECONDS;

type DeviceSyncAction = 'sync' | 'skip';

export type DeviceSyncDecision = {
  action: DeviceSyncAction;
  reason: string;
  readSinceTimestamp: number;
  checkpointTimestamp: number;
  emptyReadTimestamp: number;
  lastSyncSuccessAt: number;
  emptyReadUpdatedAt: number;
  elapsedSinceSuccessMs: number;
  elapsedSinceEmptyReadMs: number;
  autoLike: boolean;
  overlapSeconds: number;
};

export type DecideDeviceSyncOptions = {
  trigger?: string;
  checkpoint?: DeviceHistoryCheckpoint | null;
  nowMs?: number;
  autoLike?: boolean;
  includeSleep?: boolean;
  force?: boolean;
  firstSyncLookbackSeconds?: number;
  normalOverlapSeconds?: number;
  sleepOverlapSeconds?: number;
  autoCooldownMs?: number;
  emptyReadCooldownMs?: number;
  hardStaleMs?: number;
};

const isManualLikeTrigger = (trigger: string) => /manual|pull|debug|repair|button|scan|bind/i.test(trigger);

const getSafeTimestamp = (value: unknown) => {
  const numeric = Math.floor(Number(value || 0));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

export const computeDeviceSyncReadSinceTimestamp = (
  checkpointTimestamp: unknown,
  nowSeconds: number,
  options: {
    includeSleep?: boolean;
    firstSyncLookbackSeconds?: number;
    normalOverlapSeconds?: number;
    sleepOverlapSeconds?: number;
  } = {}
) => {
  const checkpoint = getSafeTimestamp(checkpointTimestamp);
  const firstSyncLookbackSeconds = Math.max(
    0,
    Math.floor(Number(options.firstSyncLookbackSeconds || DEVICE_SYNC_FIRST_SYNC_LOOKBACK_SECONDS))
  );
  const normalOverlapSeconds = Math.max(
    0,
    Math.floor(Number(options.normalOverlapSeconds || DEVICE_SYNC_NORMAL_OVERLAP_SECONDS))
  );
  const sleepOverlapSeconds = Math.max(
    normalOverlapSeconds,
    Math.floor(Number(options.sleepOverlapSeconds || DEVICE_SYNC_SLEEP_OVERLAP_SECONDS))
  );
  const overlapSeconds = options.includeSleep === false ? normalOverlapSeconds : sleepOverlapSeconds;
  if (checkpoint > 0) return Math.max(0, checkpoint - overlapSeconds);
  return Math.max(0, nowSeconds - firstSyncLookbackSeconds);
};

export const decideDeviceSync = (options: DecideDeviceSyncOptions = {}): DeviceSyncDecision => {
  const nowMs = Math.floor(Number(options.nowMs || Date.now()));
  const nowSeconds = Math.floor(nowMs / 1000);
  const trigger = String(options.trigger || '');
  const autoLike =
    options.autoLike === true ||
    (options.autoLike !== false && !options.force && !isManualLikeTrigger(trigger));
  const checkpointTimestamp = getSafeTimestamp(options.checkpoint?.timestamp);
  const emptyReadTimestamp = getSafeTimestamp(options.checkpoint?.emptyReadTimestamp);
  const lastSyncSuccessAt = Math.floor(Number(options.checkpoint?.updatedAt || 0));
  const emptyReadUpdatedAt = Math.floor(Number(options.checkpoint?.emptyReadUpdatedAt || 0));
  const autoCooldownMs = Math.max(0, Math.floor(Number(options.autoCooldownMs || DEVICE_SYNC_AUTO_COOLDOWN_MS)));
  const emptyReadCooldownMs = Math.max(
    0,
    Math.floor(Number(options.emptyReadCooldownMs || DEVICE_SYNC_EMPTY_READ_COOLDOWN_MS))
  );
  const hardStaleMs = Math.max(0, Math.floor(Number(options.hardStaleMs || DEVICE_SYNC_HARD_STALE_MS)));
  const elapsedSinceSuccessMs = lastSyncSuccessAt > 0 ? nowMs - lastSyncSuccessAt : Number.POSITIVE_INFINITY;
  const elapsedSinceEmptyReadMs = emptyReadUpdatedAt > 0 ? nowMs - emptyReadUpdatedAt : Number.POSITIVE_INFINITY;
  const overlapSeconds =
    options.includeSleep === false
      ? Math.max(0, Math.floor(Number(options.normalOverlapSeconds || DEVICE_SYNC_NORMAL_OVERLAP_SECONDS)))
      : Math.max(
          Math.floor(Number(options.normalOverlapSeconds || DEVICE_SYNC_NORMAL_OVERLAP_SECONDS)),
          Math.floor(Number(options.sleepOverlapSeconds || DEVICE_SYNC_SLEEP_OVERLAP_SECONDS))
        );
  const readSinceTimestamp = computeDeviceSyncReadSinceTimestamp(checkpointTimestamp, nowSeconds, options);
  const isHardStale = !Number.isFinite(elapsedSinceSuccessMs) || elapsedSinceSuccessMs >= hardStaleMs;

  if (autoLike && lastSyncSuccessAt > 0 && elapsedSinceSuccessMs >= 0 && elapsedSinceSuccessMs < autoCooldownMs) {
    return {
      action: 'skip',
      reason: 'recent-success',
      readSinceTimestamp,
      checkpointTimestamp,
      emptyReadTimestamp,
      lastSyncSuccessAt,
      emptyReadUpdatedAt,
      elapsedSinceSuccessMs,
      elapsedSinceEmptyReadMs,
      autoLike,
      overlapSeconds
    };
  }

  if (
    autoLike &&
    !isHardStale &&
    emptyReadTimestamp > 0 &&
    emptyReadUpdatedAt > 0 &&
    elapsedSinceEmptyReadMs >= 0 &&
    elapsedSinceEmptyReadMs < emptyReadCooldownMs &&
    emptyReadTimestamp >= checkpointTimestamp
  ) {
    return {
      action: 'skip',
      reason: 'recent-empty-read',
      readSinceTimestamp,
      checkpointTimestamp,
      emptyReadTimestamp,
      lastSyncSuccessAt,
      emptyReadUpdatedAt,
      elapsedSinceSuccessMs,
      elapsedSinceEmptyReadMs,
      autoLike,
      overlapSeconds
    };
  }

  return {
    action: 'sync',
    reason: checkpointTimestamp > 0 ? 'checkpoint-incremental' : 'first-sync-lookback',
    readSinceTimestamp,
    checkpointTimestamp,
    emptyReadTimestamp,
    lastSyncSuccessAt,
    emptyReadUpdatedAt,
    elapsedSinceSuccessMs,
    elapsedSinceEmptyReadMs,
    autoLike,
    overlapSeconds
  };
};
