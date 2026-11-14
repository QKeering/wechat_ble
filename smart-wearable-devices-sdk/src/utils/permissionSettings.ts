/**
 * 打开当前应用的权限设置入口：App 端跳到系统设置页，小程序走授权设置页。
 * 仅在用户拒绝过相机/相册等权限后调用。
 */
export const openPermissionSettings = (): void => {
  // #ifdef APP-PLUS
  try {
    plus.runtime.openURL('app-settings:');
    return;
  } catch {
    // 系统设置打不开时保持静默，调用方已经给过提示
  }
  // #endif

  // #ifndef APP-PLUS
  uni.openSetting();
  // #endif
};
