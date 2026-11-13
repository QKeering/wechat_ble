import { ref } from 'vue';

// Android keeps the BLE link alive in the background. On foreground return the
// retained device snapshot may be stale (the OS or the ring may have dropped
// the physical link), so the app probes it before letting pages start history
// syncs or BLE commands. While the probe is running this flag keeps pages from
// treating the stale snapshot as a live connection.
// 体检最坏耗时 = init/监听注册 + 3.5s 探测 + 8s 原地补齐；安全上限必须覆盖它，
// 否则页面会在 App 仍在修复链路时提前放行。
const FOREGROUND_LINK_VERIFICATION_MAX_MS = 20000;

const foregroundLinkVerificationPending = ref(false);
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let verificationOwner = 0;

const clearSafetyTimer = () => {
  if (!safetyTimer) return;
  clearTimeout(safetyTimer);
  safetyTimer = null;
};

export const isForegroundLinkVerificationPending = () => foregroundLinkVerificationPending.value;

export const beginForegroundLinkVerification = () => {
  verificationOwner += 1;
  const owner = verificationOwner;
  foregroundLinkVerificationPending.value = true;
  clearSafetyTimer();
  safetyTimer = setTimeout(() => {
    safetyTimer = null;
    // 只有当前拥有者才能让安全定时器清位，避免旧一轮体检清掉新一轮。
    if (verificationOwner !== owner) return;
    foregroundLinkVerificationPending.value = false;
  }, FOREGROUND_LINK_VERIFICATION_MAX_MS);
  (safetyTimer as any).unref?.();
  return owner;
};

// 传 owner 时只允许当前拥有者解除；不传则强制解除（onHide 用）。
export const endForegroundLinkVerification = (owner?: number) => {
  if (owner != null && owner !== verificationOwner) return;
  clearSafetyTimer();
  foregroundLinkVerificationPending.value = false;
};
