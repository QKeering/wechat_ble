export interface RwDiagnosticCommandLock {
  owner: string;
  reason: string;
  mode?: string;
  createdAt: number;
  expiresAt: number;
}

interface SetRwDiagnosticCommandLockOptions {
  owner: string;
  reason: string;
  mode?: string;
  ttlMs?: number;
}

const RW_DIAGNOSTIC_COMMAND_LOCK_STORAGE_KEY = 'qkeer:rw-diagnostic-command-lock:v1';
const DEFAULT_RW_DIAGNOSTIC_COMMAND_LOCK_TTL_MS = 10 * 60 * 1000;

let activeRwDiagnosticCommandLock: RwDiagnosticCommandLock | null = null;

const getUniRuntime = () => {
  if (typeof uni !== 'undefined') return uni;
  return (globalThis as any).uni;
};

const parseRwDiagnosticCommandLock = (value: unknown): RwDiagnosticCommandLock | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const owner = `${item.owner || ''}`.trim();
  const reason = `${item.reason || ''}`.trim();
  const createdAt = Number(item.createdAt);
  const expiresAt = Number(item.expiresAt);
  if (!owner || !reason || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return null;
  return {
    owner,
    reason,
    mode: item.mode ? `${item.mode}` : undefined,
    createdAt,
    expiresAt
  };
};

export const getRwDiagnosticCommandLock = () => {
  const uniRuntime = getUniRuntime();

  if (activeRwDiagnosticCommandLock) {
    if (activeRwDiagnosticCommandLock.expiresAt > Date.now()) return activeRwDiagnosticCommandLock;
    activeRwDiagnosticCommandLock = null;
  }

  if (!uniRuntime?.getStorageSync) return null;

  try {
    const lock = parseRwDiagnosticCommandLock(uniRuntime.getStorageSync(RW_DIAGNOSTIC_COMMAND_LOCK_STORAGE_KEY));
    if (!lock) return null;
    if (lock.expiresAt <= Date.now()) {
      uniRuntime.removeStorageSync?.(RW_DIAGNOSTIC_COMMAND_LOCK_STORAGE_KEY);
      return null;
    }
    activeRwDiagnosticCommandLock = lock;
    return lock;
  } catch {
    return null;
  }
};

export const setRwDiagnosticCommandLock = (options: SetRwDiagnosticCommandLockOptions) => {
  const uniRuntime = getUniRuntime();
  const createdAt = Date.now();
  const ttlMs = Number(options.ttlMs);
  const lock: RwDiagnosticCommandLock = {
    owner: options.owner,
    reason: options.reason,
    mode: options.mode,
    createdAt,
    expiresAt: createdAt + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_RW_DIAGNOSTIC_COMMAND_LOCK_TTL_MS)
  };

  activeRwDiagnosticCommandLock = lock;
  if (!uniRuntime?.setStorageSync) return lock;

  try {
    uniRuntime.setStorageSync(RW_DIAGNOSTIC_COMMAND_LOCK_STORAGE_KEY, lock);
    return lock;
  } catch {
    return lock;
  }
};

export const clearRwDiagnosticCommandLock = (owner?: string) => {
  const uniRuntime = getUniRuntime();

  try {
    if (owner) {
      const lock = getRwDiagnosticCommandLock();
      if (lock && lock.owner !== owner) return false;
    }
    activeRwDiagnosticCommandLock = null;
    uniRuntime?.removeStorageSync?.(RW_DIAGNOSTIC_COMMAND_LOCK_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
