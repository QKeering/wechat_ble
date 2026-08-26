import { QKEER_BUILD_INFO } from '@/utils/buildInfo';

export const getMiniProgramVersionText = () => {
  try {
    const runtimeVersion = String((uni as any).getAccountInfoSync?.()?.miniProgram?.version || '').trim();
    if (runtimeVersion) return `小程序版本 v${runtimeVersion}`;
  } catch {
    // Development builds may not expose a WeChat release version.
  }

  const appVersion = String(QKEER_BUILD_INFO.appVersion || '').trim();
  return `小程序版本 v${appVersion && appVersion !== 'unknown' ? appVersion : '0.1.0'}`;
};
