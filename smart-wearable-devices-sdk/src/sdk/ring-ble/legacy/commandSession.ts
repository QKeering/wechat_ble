import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

type IdleCallback = () => void;

let activeUntil = 0;
let sessionSeq = 0;
let activeContext: Record<string, unknown> | null = null;
const idleCallbacks = new Set<IdleCallback>();

export const getLegacyBleHistoryExclusiveSnapshot = () => {
  const remainingMs = Math.max(0, activeUntil - Date.now());
  const hasActiveContext = activeContext != null;
  return {
    active: hasActiveContext || remainingMs > 0,
    seq: sessionSeq,
    sessionId: hasActiveContext ? `legacy-command-${sessionSeq}` : undefined,
    exclusiveUntil: activeUntil,
    remainingMs,
    context: activeContext || undefined
  };
};

export const isLegacyBleHistoryExclusiveActive = () => getLegacyBleHistoryExclusiveSnapshot().active;

const createRelease = (seq: number, startedAt: number, context: Record<string, unknown>) => {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (sessionSeq === seq) {
      activeUntil = 0;
      activeContext = null;
    }
    appendRingDiagnosticLog('L19 BLE', 'legacy-command-session-end', {
      seq,
      sessionId: `legacy-command-${seq}`,
      elapsedMs: Date.now() - startedAt,
      activeSeq: sessionSeq,
      exclusiveUntil: activeUntil,
      ...context
    });
    if (!getLegacyBleHistoryExclusiveSnapshot().active) {
      for (const callback of [...idleCallbacks]) callback();
    }
  };
};

export const tryClaimLegacyBleCommandSession = (
  timeoutMs: number,
  context: Record<string, unknown> = {}
) => {
  const snapshot = getLegacyBleHistoryExclusiveSnapshot();
  if (snapshot.active) return null;

  const seq = ++sessionSeq;
  const startedAt = Date.now();
  activeUntil = startedAt + timeoutMs + 1000;
  activeContext = context;
  appendRingDiagnosticLog('L19 BLE', 'legacy-command-session-start', {
    seq,
    sessionId: `legacy-command-${seq}`,
    timeoutMs,
    exclusiveUntil: activeUntil,
    ...context
  });
  return createRelease(seq, startedAt, context);
};

export const claimLegacyBleHistoryExclusive = (
  timeoutMs: number,
  context: Record<string, unknown> = {}
) => {
  const release = tryClaimLegacyBleCommandSession(timeoutMs, { sessionType: 'history', ...context });
  if (release) return release;
  const snapshot = getLegacyBleHistoryExclusiveSnapshot();
  appendRingDiagnosticLog('L19 BLE', 'legacy-history-exclusive-reuse-active', {
    timeoutMs,
    activeSessionId: snapshot.sessionId,
    activeContext: snapshot.context,
    ...context
  });
  return () => undefined;
};

export const onLegacyBleCommandSessionIdle = (callback: IdleCallback) => {
  idleCallbacks.add(callback);
  return () => idleCallbacks.delete(callback);
};
