/**
 * 全局错误弹窗开关
 *
 * 用途：控制系统范围内"错误"类提示（如接口失败、网络异常）是否展示 toast。
 * - 构建时通过环境变量 VITE_ERROR_TOAST_ENABLED 配置初始值（'false' 关闭，其他为开启）
 * - 运行时可通过 setErrorToastEnabled 动态切换
 *
 * 注意：仅用于错误类提示。成功/信息类提示（如"已复制"、"验证码已发送"）
 * 不应使用此封装，而直接调用 uni.$uv.toast。
 */

let errorToastEnabled = import.meta.env.VITE_ERROR_TOAST_ENABLED !== 'false';

/**
 * 错误弹窗是否启用
 */
export const isErrorToastEnabled = (): boolean => errorToastEnabled;

/**
 * 运行时切换错误弹窗开关
 */
export const setErrorToastEnabled = (enabled: boolean): void => {
  errorToastEnabled = !!enabled;
};

/**
 * 显示错误提示 toast
 * - 全局开关关闭时为 no-op
 * - 入参为空时回退为"网络错误"
 */
export const showErrorToast = (message: unknown): void => {
  if (!errorToastEnabled) return;
  const fallback = '网络错误';
  let text = fallback;
  if (typeof message === 'string' && message.trim()) {
    text = message;
  } else if (message && typeof message === 'object' && 'msg' in (message as any)) {
    const msg = (message as any).msg;
    if (typeof msg === 'string' && msg.trim()) text = msg;
  }
  uni.$uv.toast(text);
};
