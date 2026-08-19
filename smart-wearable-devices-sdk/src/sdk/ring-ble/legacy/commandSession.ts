import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

type IdleCallback = () => void;

type SessionState = {
  activeUntil: number;
  idleTimeoutMs: number;
  activityCount: number;
  lastActivityAt: number;
  seq: number;
  context: Record<string, unknown>;
  expiryTimer: ReturnType<typeof setTimeout> | null;
};

type IdleSubscription = {
  getDeviceKey?: () => string;
  callback: IdleCallback;
};

const FALLBACK_DEVICE_KEY = '__legacy_unknown_device__';
let sessionSeq = 0;
const sessions = new Map<string, SessionState>();
const idleCallbacks = new Set<IdleSubscription>();
const deviceKeyAliases = new Map<string, string>();

const normalizeDeviceIdentity = (value: unknown) =>
  `${value || ''}`.trim().toUpperCase().replace(/-/g, ':');

const isStableBleMac = (value: unknown) =>
  /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalizeDeviceIdentity(value));

const registerDeviceKeyAliases = (canonicalKey: string, values: unknown[]) => {
  if (!canonicalKey || canonicalKey === FALLBACK_DEVICE_KEY) return;
  for (const value of values) {
    const alias = normalizeDeviceIdentity(value);
    if (alias) deviceKeyAliases.set(alias, canonicalKey);
  }
};

const resolveDeviceKey = (identity?: unknown): string => {
  if (typeof identity === 'string') {
    const normalized = normalizeDeviceIdentity(identity);
    return deviceKeyAliases.get(normalized) || normalized || FALLBACK_DEVICE_KEY;
  }
  if (!identity || typeof identity !== 'object') return FALLBACK_DEVICE_KEY;
  const source = identity as Record<string, unknown>;
  const advertis = source.advertis && typeof source.advertis === 'object'
    ? source.advertis as Record<string, unknown>
    : undefined;
  const stableCandidates = [advertis?.macInfo, source.mac, source.deviceMac, source.uniMacId];
  const stableMac = stableCandidates.find(isStableBleMac);
  const fallbackIdentity = stableCandidates.find(Boolean) || source.deviceId;
  const normalized = normalizeDeviceIdentity(stableMac || fallbackIdentity);
  const canonicalKey = deviceKeyAliases.get(normalized) || normalized || FALLBACK_DEVICE_KEY;
  registerDeviceKeyAliases(canonicalKey, [...stableCandidates, source.deviceId]);
  return canonicalKey;
};

export const resolveLegacyBleCommandSessionDeviceKey = (identity?: unknown) =>
  resolveDeviceKey(identity);

const notifyIdle = (deviceKey: string) => {
  for (const subscription of [...idleCallbacks]) {
    const subscribedDeviceKey = subscription.getDeviceKey?.();
    if (!subscribedDeviceKey || subscribedDeviceKey === deviceKey) subscription.callback();
  }
};

const armSessionExpiry = (deviceKey: string, state: SessionState) => {
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  const seq = state.seq;
  state.expiryTimer = setTimeout(() => {
    const current = sessions.get(deviceKey);
    if (current?.seq !== seq) return;
    pruneExpiredSession(deviceKey);
  }, Math.max(0, state.activeUntil - Date.now()) + 10);
};

const pruneExpiredSession = (deviceKey: string, now = Date.now()) => {
  const state = sessions.get(deviceKey);
  if (!state || state.activeUntil > now) return state;
  if (state.expiryTimer) clearTimeout(state.expiryTimer);
  sessions.delete(deviceKey);
  appendRingDiagnosticLog('L19 BLE', 'legacy-command-session-expired-recovered', {
    deviceKey,
    seq: state.seq,
    sessionId: `legacy-command-${state.seq}`,
    expiredByMs: now - state.activeUntil,
    ...state.context
  });
  notifyIdle(deviceKey);
  return undefined;
};

const createSnapshot = (deviceKey: string, state?: SessionState) => {
  const now = Date.now();
  const remainingMs = state ? Math.max(0, state.activeUntil - now) : 0;
  return {
    active: Boolean(state && remainingMs > 0),
    seq: state?.seq || sessionSeq,
    sessionId: state ? `legacy-command-${state.seq}` : undefined,
    deviceKey,
    exclusiveUntil: state?.activeUntil || 0,
    remainingMs,
    context: state?.context
  };
};

export const getLegacyBleHistoryExclusiveSnapshot = (deviceIdentity?: unknown) => {
  if (deviceIdentity != null) {
    const deviceKey = resolveDeviceKey(deviceIdentity);
    return createSnapshot(deviceKey, pruneExpiredSession(deviceKey));
  }

  const now = Date.now();
  let activeEntry: [string, SessionState] | undefined;
  for (const [deviceKey] of sessions) {
    const state = pruneExpiredSession(deviceKey, now);
    if (!state) continue;
    if (!activeEntry || state.activeUntil > activeEntry[1].activeUntil) activeEntry = [deviceKey, state];
  }
  return activeEntry
    ? createSnapshot(activeEntry[0], activeEntry[1])
    : createSnapshot(FALLBACK_DEVICE_KEY);
};

export const isLegacyBleHistoryExclusiveActive = (deviceIdentity?: unknown) =>
  getLegacyBleHistoryExclusiveSnapshot(deviceIdentity).active;

export const releaseLegacyBleCommandSessions = (deviceIdentity?: unknown, reason = 'forced-release') => {
  const targetKeys = deviceIdentity == null ? [...sessions.keys()] : [resolveDeviceKey(deviceIdentity)];
  let releasedCount = 0;
  for (const deviceKey of targetKeys) {
    const state = sessions.get(deviceKey);
    if (!state) continue;
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    sessions.delete(deviceKey);
    releasedCount += 1;
    appendRingDiagnosticLog('L19 BLE', 'legacy-command-session-forced-release', {
      deviceKey,
      seq: state.seq,
      sessionId: `legacy-command-${state.seq}`,
      reason,
      remainingMs: Math.max(0, state.activeUntil - Date.now()),
      ...state.context
    });
    notifyIdle(deviceKey);
  }
  return releasedCount;
};

const createRelease = (
  deviceKey: string,
  seq: number,
  startedAt: number,
  context: Record<string, unknown>
) => {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = sessions.get(deviceKey);
    if (current?.seq === seq) {
      if (current.expiryTimer) clearTimeout(current.expiryTimer);
      sessions.delete(deviceKey);
    }
    appendRingDiagnosticLog('L19 BLE', 'legacy-command-session-end', {
      seq,
      sessionId: `legacy-command-${seq}`,
      deviceKey,
      elapsedMs: Date.now() - startedAt,
      activeSeq: sessions.get(deviceKey)?.seq || 0,
      exclusiveUntil: sessions.get(deviceKey)?.activeUntil || 0,
      ...context
    });
    if (!getLegacyBleHistoryExclusiveSnapshot(deviceKey).active) notifyIdle(deviceKey);
  };
};

export const tryClaimLegacyBleCommandSession = (
  timeoutMs: number,
  context: Record<string, unknown> = {}
) => {
  const deviceKey = resolveDeviceKey(context);
  const snapshot = getLegacyBleHistoryExclusiveSnapshot(deviceKey);
  if (snapshot.active) return null;

  const seq = ++sessionSeq;
  const startedAt = Date.now();
  const idleTimeoutMs = context.sessionType === 'history'
    ? Math.max(7000, Math.min(timeoutMs + 1000, 12000))
    : timeoutMs + 1000;
  const activeUntil = startedAt + timeoutMs + 1000;
  const state: SessionState = {
    activeUntil,
    idleTimeoutMs,
    activityCount: 0,
    lastActivityAt: startedAt,
    seq,
    context,
    expiryTimer: null
  };
  sessions.set(deviceKey, state);
  armSessionExpiry(deviceKey, state);
  appendRingDiagnosticLog('L19 BLE', 'legacy-command-session-start', {
    seq,
    sessionId: `legacy-command-${seq}`,
    deviceKey,
    timeoutMs,
    exclusiveUntil: activeUntil,
    ...context
  });
  return createRelease(deviceKey, seq, startedAt, context);
};

/**
 * Keep a history command lease alive while the ring is still producing frames.
 * The original timeout remains the first-frame budget; after the first frame,
 * only a genuine quiet period expires the lease.
 */
export const renewLegacyBleCommandSessionActivity = (
  deviceIdentity?: unknown,
  detail: Record<string, unknown> = {}
) => {
  const deviceKey = resolveDeviceKey(deviceIdentity);
  const state = pruneExpiredSession(deviceKey);
  if (!state || state.context.sessionType !== 'history') return false;

  const now = Date.now();
  state.lastActivityAt = now;
  state.activityCount += 1;
  state.activeUntil = now + state.idleTimeoutMs;
  armSessionExpiry(deviceKey, state);

  if (state.activityCount === 1 || state.activityCount % 50 === 0) {
    appendRingDiagnosticLog('L19 BLE', 'legacy-command-session-activity-renewed', {
      deviceKey,
      seq: state.seq,
      sessionId: `legacy-command-${state.seq}`,
      activityCount: state.activityCount,
      idleTimeoutMs: state.idleTimeoutMs,
      exclusiveUntil: state.activeUntil,
      ...detail,
      ...state.context
    });
  }
  return true;
};

export const claimLegacyBleHistoryExclusive = (
  timeoutMs: number,
  context: Record<string, unknown> = {}
) => {
  const claimContext = { sessionType: 'history', ...context };
  const release = tryClaimLegacyBleCommandSession(timeoutMs, claimContext);
  if (release) return release;
  const snapshot = getLegacyBleHistoryExclusiveSnapshot(claimContext);
  appendRingDiagnosticLog('L19 BLE', 'legacy-history-exclusive-reuse-active', {
    timeoutMs,
    activeSessionId: snapshot.sessionId,
    activeContext: snapshot.context,
    deviceKey: snapshot.deviceKey,
    ...context
  });
  return () => undefined;
};

export const onLegacyBleCommandSessionIdle = (
  callback: IdleCallback,
  deviceIdentity?: unknown | (() => unknown)
) => {
  const subscription: IdleSubscription = {
    callback,
    getDeviceKey: deviceIdentity == null
      ? undefined
      : () => resolveDeviceKey(
          typeof deviceIdentity === 'function' ? deviceIdentity() : deviceIdentity
        )
  };
  idleCallbacks.add(subscription);
  return () => idleCallbacks.delete(subscription);
};

export const waitForLegacyBleCommandSessionIdle = (
  deviceIdentity?: unknown,
  timeoutMs = 30000
) => {
  const snapshot = getLegacyBleHistoryExclusiveSnapshot(deviceIdentity);
  if (!snapshot.active) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (idle: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cancel();
      resolve(idle);
    };
    const cancel = onLegacyBleCommandSessionIdle(() => settle(true), deviceIdentity);
    timer = setTimeout(() => settle(false), Math.max(0, timeoutMs));

    // Close the release/register race without waiting for the timeout.
    if (!getLegacyBleHistoryExclusiveSnapshot(deviceIdentity).active) settle(true);
  });
};
