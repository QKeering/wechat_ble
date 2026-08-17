import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

type IdleCallback = () => void;

type SessionState = {
  activeUntil: number;
  seq: number;
  context: Record<string, unknown>;
  expiryTimer: ReturnType<typeof setTimeout>;
};

type IdleSubscription = {
  getDeviceKey?: () => string;
  callback: IdleCallback;
};

const FALLBACK_DEVICE_KEY = '__legacy_unknown_device__';
let sessionSeq = 0;
const sessions = new Map<string, SessionState>();
const idleCallbacks = new Set<IdleSubscription>();

const normalizeDeviceIdentity = (value: unknown) =>
  `${value || ''}`.trim().toUpperCase().replace(/-/g, ':');

const resolveDeviceKey = (identity?: unknown): string => {
  if (typeof identity === 'string') return normalizeDeviceIdentity(identity) || FALLBACK_DEVICE_KEY;
  if (!identity || typeof identity !== 'object') return FALLBACK_DEVICE_KEY;
  const source = identity as Record<string, unknown>;
  return normalizeDeviceIdentity(
    source.mac || source.uniMacId || source.deviceMac || source.deviceId
  ) || FALLBACK_DEVICE_KEY;
};

const notifyIdle = (deviceKey: string) => {
  for (const subscription of [...idleCallbacks]) {
    const subscribedDeviceKey = subscription.getDeviceKey?.();
    if (!subscribedDeviceKey || subscribedDeviceKey === deviceKey) subscription.callback();
  }
};

const pruneExpiredSession = (deviceKey: string, now = Date.now()) => {
  const state = sessions.get(deviceKey);
  if (!state || state.activeUntil > now) return state;
  clearTimeout(state.expiryTimer);
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
    clearTimeout(state.expiryTimer);
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
      clearTimeout(current.expiryTimer);
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
  const activeUntil = startedAt + timeoutMs + 1000;
  const expiryTimer = setTimeout(() => {
    const current = sessions.get(deviceKey);
    if (current?.seq !== seq) return;
    pruneExpiredSession(deviceKey);
  }, Math.max(0, activeUntil - Date.now()) + 10);
  sessions.set(deviceKey, { activeUntil, seq, context, expiryTimer });
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
