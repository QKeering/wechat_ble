/**
 * 接口根地址解析（全局唯一来源）。
 *
 * 默认取构建时的 `VITE_API_BASE`；App 端额外支持 `VITE_API_BASE_APP` 覆盖。
 *
 * 为什么 App 端需要单独的覆盖项：
 * 运行到（自定义）基座走 development 模式，会加载 `.env.development`。
 * 该文件里的本机地址（127.0.0.1）在真机上指向手机自身，请求必然失败，
 * 表现为"点到接口但拿不到结果"（例如收不到短信验证码）。
 * 正式打包走 `.env.production`，所以不受影响。
 */

const stripTrailingSlashes = (value: unknown): string => String(value ?? '').replace(/\/+$/, '');

/**
 * 获取当前平台应使用的接口根地址（已去掉结尾斜杠，可为空字符串）。
 */
export const getApiBase = (): string => {
  // #ifdef APP-PLUS
  const appOverride = import.meta.env.VITE_API_BASE_APP;
  if (appOverride) {
    return stripTrailingSlashes(appOverride);
  }
  // #endif

  return stripTrailingSlashes(import.meta.env.VITE_API_BASE);
};
