import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

// App 切后台时不能立刻断开戒指：OTA、全面测量、历史同步等用户已发起的操作
// 需要跑完。这些操作通过 token 声明"我还在用 BLE"，App.vue 在全部 token
// 释放后再执行延迟断开。
const activeTasks = new Map<symbol, string>();
let deferredDisconnect: (() => void) | null = null;
let deferredDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

// 防御性上限：任何一个操作忘记释放 token（或被平台冻结后不再返回），
// 都不能让戒指在后台被永久占住。超时后强制断开，后续 release 变成 no-op。
const BACKGROUND_DISCONNECT_MAX_DEFER_MS = 5 * 60 * 1000;

const snapshotReasons = () => Array.from(activeTasks.values());

/**
 * OTA 会接管整条 BLE 链路（甚至换成 BOOT 设备）。持有该 token 期间，
 * 自动重连必须彻底让路，不能因为"有关键任务"就放行。
 */
export const RING_BACKGROUND_TASK_OTA = 'ota-upgrade';

const clearDeferredDisconnectTimer = () => {
  if (!deferredDisconnectTimer) return;
  clearTimeout(deferredDisconnectTimer);
  deferredDisconnectTimer = null;
};

const runDeferredDisconnect = (trigger: 'tokens-released' | 'max-defer') => {
  const disconnect = deferredDisconnect;
  if (!disconnect) return;
  deferredDisconnect = null;
  clearDeferredDisconnectTimer();
  appendRingDiagnosticLog('APP', 'background-disconnect-deferred-run', {
    trigger,
    activeTasks: snapshotReasons()
  });
  disconnect();
};

const armMaxDeferTimer = () => {
  clearDeferredDisconnectTimer();
  deferredDisconnectTimer = setTimeout(() => {
    deferredDisconnectTimer = null;
    if (!deferredDisconnect) return;
    appendRingDiagnosticLog('APP', 'background-disconnect-max-defer', {
      deferredMs: BACKGROUND_DISCONNECT_MAX_DEFER_MS,
      activeTasks: snapshotReasons()
    });
    runDeferredDisconnect('max-defer');
  }, BACKGROUND_DISCONNECT_MAX_DEFER_MS);
  (deferredDisconnectTimer as any).unref?.();
};

export const beginRingBackgroundCriticalTask = (reason: string): (() => void) => {
  const token = Symbol(reason);
  activeTasks.set(token, reason);
  appendRingDiagnosticLog('APP', 'background-critical-task-start', {
    reason,
    activeTasks: snapshotReasons()
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeTasks.delete(token);
    appendRingDiagnosticLog('APP', 'background-critical-task-end', {
      reason,
      activeTasks: snapshotReasons()
    });
    if (activeTasks.size > 0 || !deferredDisconnect) return;
    runDeferredDisconnect('tokens-released');
  };
};

export const runOrDeferRingBackgroundDisconnect = (disconnect: () => void) => {
  if (activeTasks.size === 0) {
    appendRingDiagnosticLog('APP', 'background-disconnect-immediate', {
      activeTasks: snapshotReasons()
    });
    disconnect();
    return;
  }
  deferredDisconnect = disconnect;
  armMaxDeferTimer();
  appendRingDiagnosticLog('APP', 'background-disconnect-deferred', {
    activeTasks: snapshotReasons(),
    maxDeferMs: BACKGROUND_DISCONNECT_MAX_DEFER_MS
  });
};

export const cancelDeferredRingBackgroundDisconnect = () => {
  if (!deferredDisconnect && !deferredDisconnectTimer) return;
  deferredDisconnect = null;
  clearDeferredDisconnectTimer();
  appendRingDiagnosticLog('APP', 'background-disconnect-cancelled', {
    activeTasks: snapshotReasons()
  });
};

export const getRingBackgroundCriticalTasks = () => snapshotReasons();
