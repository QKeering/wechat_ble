export interface DeviceSyncSessionClaim {
  key: string;
  sessionId: string;
  userId: string;
  mac: string;
  trigger: string;
  startedAt: number;
}

interface DeviceSyncSessionCompleted {
  completedAt: number;
  trigger: string;
  status: string;
}

interface ClaimDeviceSyncSessionOptions {
  userId?: unknown;
  mac?: unknown;
  trigger?: string;
  force?: boolean;
  cooldownMs?: number;
  staleMs?: number;
}

export interface DeviceSyncGateInput {
  homeSyncing?: boolean;
  businessRefreshRunning?: boolean;
  historySyncRunning?: boolean;
  historyReadRunning?: boolean;
  historyReadPromiseRunning?: boolean;
  stableSnapshotRunning?: boolean;
  stableUploadScheduled?: boolean;
  uploadRunning?: boolean;
  finalRefreshRunning?: boolean;
}

export interface DeviceSyncGateSnapshot {
  backgroundSyncing: boolean;
  dataSyncing: boolean;
  deferBusinessRefresh: boolean;
  reasons: string[];
}

type ClaimDeviceSyncSessionResult =
  | { claimed: true; claim: DeviceSyncSessionClaim }
  | {
      claimed: false;
      key: string;
      reason: 'missing-device' | 'running' | 'cooldown';
      sessionId?: string;
      runningForMs?: number;
      completedElapsedMs?: number;
    };

const DEFAULT_SYNC_SESSION_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_SYNC_SESSION_STALE_MS = 2 * 60 * 1000;

const activeDeviceSyncSessions = new Map<string, DeviceSyncSessionClaim>();
const completedDeviceSyncSessions = new Map<string, DeviceSyncSessionCompleted>();

export const normalizeDeviceSyncMac = (value?: unknown) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  const hex = raw.replace(/[^0-9A-F]/g, '');
  if (hex.length === 12) {
    return hex.match(/.{1,2}/g)?.join(':') || raw;
  }
  return raw;
};

export const getDeviceSyncSessionKey = (userId?: unknown, mac?: unknown) => {
  const normalizedUserId = String(userId || 'anonymous').trim() || 'anonymous';
  const normalizedMac = normalizeDeviceSyncMac(mac);
  return `${normalizedUserId}:${normalizedMac || 'unknown-device'}`;
};

const pruneDeviceSyncSessions = (now = Date.now(), staleMs = DEFAULT_SYNC_SESSION_STALE_MS, cooldownMs = DEFAULT_SYNC_SESSION_COOLDOWN_MS) => {
  activeDeviceSyncSessions.forEach((claim, key) => {
    if (!claim.startedAt || now - claim.startedAt > staleMs) {
      activeDeviceSyncSessions.delete(key);
    }
  });
  completedDeviceSyncSessions.forEach((record, key) => {
    if (!record.completedAt || now - record.completedAt > cooldownMs) {
      completedDeviceSyncSessions.delete(key);
    }
  });
};

export const claimDeviceSyncSession = (options: ClaimDeviceSyncSessionOptions): ClaimDeviceSyncSessionResult => {
  const now = Date.now();
  const staleMs = Math.max(1000, Number(options.staleMs || DEFAULT_SYNC_SESSION_STALE_MS));
  const cooldownMs = Math.max(0, Number(options.cooldownMs || DEFAULT_SYNC_SESSION_COOLDOWN_MS));
  const mac = normalizeDeviceSyncMac(options.mac);
  const key = getDeviceSyncSessionKey(options.userId, mac);
  pruneDeviceSyncSessions(now, staleMs, cooldownMs);

  if (!mac || mac === 'UNKNOWN-DEVICE') {
    return { claimed: false, key, reason: 'missing-device' };
  }

  const running = activeDeviceSyncSessions.get(key);
  // `force` means bypass the completed-session cooldown (for example a manual
  // pull-down), never start a second session while the same device is running.
  // Page-show, reconnect and pull-down must all reuse/skip the active flight.
  if (running) {
    return {
      claimed: false,
      key,
      reason: 'running',
      sessionId: running.sessionId,
      runningForMs: now - running.startedAt
    };
  }

  const completed = completedDeviceSyncSessions.get(key);
  if (!options.force && completed && now - completed.completedAt < cooldownMs) {
    return {
      claimed: false,
      key,
      reason: 'cooldown',
      completedElapsedMs: now - completed.completedAt
    };
  }

  const claim: DeviceSyncSessionClaim = {
    key,
    sessionId: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    userId: String(options.userId || 'anonymous').trim() || 'anonymous',
    mac,
    trigger: options.trigger || 'unknown',
    startedAt: now
  };
  activeDeviceSyncSessions.set(key, claim);
  return { claimed: true, claim };
};

export const finishDeviceSyncSession = (
  claim: DeviceSyncSessionClaim | null | undefined,
  status = 'finished',
  markCompleted = true
) => {
  if (!claim?.key || !claim.sessionId) return false;
  const current = activeDeviceSyncSessions.get(claim.key);
  if (current?.sessionId === claim.sessionId) {
    activeDeviceSyncSessions.delete(claim.key);
  }
  if (markCompleted) {
    completedDeviceSyncSessions.set(claim.key, {
      completedAt: Date.now(),
      trigger: claim.trigger,
      status
    });
  }
  return true;
};

export const isDeviceSyncSessionRunning = (userId?: unknown, mac?: unknown) => {
  const key = getDeviceSyncSessionKey(userId, mac);
  return activeDeviceSyncSessions.has(key);
};

export const isAnyDeviceSyncSessionRunning = (userId?: unknown, mac?: unknown) => {
  pruneDeviceSyncSessions();
  const normalizedUserId = String(userId || 'anonymous').trim() || 'anonymous';
  const normalizedMac = normalizeDeviceSyncMac(mac);
  return [...activeDeviceSyncSessions.values()].some((claim) => {
    if (claim.userId !== normalizedUserId) return false;
    return !normalizedMac || claim.mac === normalizedMac;
  });
};

/**
 * The single source of truth for UI/business gates during a device sync.
 * Keep protocol/session state out of page-specific boolean expressions so a
 * new sync phase cannot accidentally bypass one gate but block another.
 */
export const buildDeviceSyncGateSnapshot = (input: DeviceSyncGateInput): DeviceSyncGateSnapshot => {
  const backgroundReasons: string[] = [];
  if (input.historySyncRunning) backgroundReasons.push('history-sync');
  if (input.historyReadRunning) backgroundReasons.push('history-read');
  if (input.historyReadPromiseRunning) backgroundReasons.push('history-read-promise');
  if (input.stableSnapshotRunning) backgroundReasons.push('stable-snapshot');
  if (input.stableUploadScheduled) backgroundReasons.push('stable-upload-scheduled');
  if (input.uploadRunning) backgroundReasons.push('upload');
  if (input.finalRefreshRunning) backgroundReasons.push('final-refresh');

  const backgroundSyncing = backgroundReasons.length > 0;
  const reasons = [...backgroundReasons];
  if (input.homeSyncing) reasons.push('home-sync');
  if (input.businessRefreshRunning) reasons.push('business-refresh');

  return {
    backgroundSyncing,
    dataSyncing: Boolean(input.homeSyncing || input.businessRefreshRunning || backgroundSyncing),
    deferBusinessRefresh: Boolean(input.businessRefreshRunning || backgroundSyncing),
    reasons
  };
};
