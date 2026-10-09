import { QKEER_BUILD_INFO } from '@/utils/buildInfo';

const FALLBACK_VERSION = '0.1.0';

const resolveBuildVersion = () => {
  const appVersion = String(QKEER_BUILD_INFO.appVersion || '').trim();
  return appVersion && appVersion !== 'unknown' ? appVersion : FALLBACK_VERSION;
};

export const getMiniProgramVersionText = () => {
  // App 端显示 App 版本（manifest.json 的 versionName），不显示小程序版本
  // #ifdef APP-PLUS
  try {
    const runtimeVersion = String(plus.runtime.version || '').trim();
    if (runtimeVersion) return `App版本 v${runtimeVersion}`;
  } catch {
    // plus.runtime 不可用时回退到构建信息
  }
  return `App版本 v${resolveBuildVersion()}`;
  // #endif

  // #ifndef APP-PLUS
  try {
    const runtimeVersion = String((uni as any).getAccountInfoSync?.()?.miniProgram?.version || '').trim();
    if (runtimeVersion) return `小程序版本 v${runtimeVersion}`;
  } catch {
    // Development builds may not expose a WeChat release version.
  }
  return `小程序版本 v${resolveBuildVersion()}`;
  // #endif
};
