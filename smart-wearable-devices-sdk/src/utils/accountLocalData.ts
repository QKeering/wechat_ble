/**
 * 账号注销后的本地数据清理。
 *
 * 注销成功后，服务端会清除该账号的数据；本地缓存（戒指身份、历史同步进度、
 * 上传队列、健康/经期缓存、BLE 日志等）也必须一起清掉，避免换账号登录后
 * 复用上一个账号的数据。语言偏好等与账号无关的设置要保留。
 */

// 与账号无关的本地设置，清理时必须保留。
const PRESERVED_STORAGE_KEYS = new Set([
  'qkeer:locale-mode:v1',
  // 调试开关属于设备本地的开发者偏好，不随账号注销重置。
  'qkeer:ring-ble-debug',
  'qkeer:ring-diagnostic-verbose'
]);

// 不以 qkeer 前缀命名的账号数据缓存。
const ACCOUNT_STORAGE_EXACT_KEYS = [
  'token',
  'userInfo',
  'deviceServiceCache',
  // 经期/生育期计算缓存由多个历史页面直接写入。
  'fertility',
  'menstrual',
  'ovulation',
  'safe'
];

// qkeer: 下除保留项外都是戒指/健康/上传相关缓存；qkeer_ 是旧版与经期、体检缓存。
const ACCOUNT_STORAGE_PREFIXES = ['qkeer:', 'qkeer_'];

const shouldRemoveStorageKey = (key: string): boolean => {
  if (!key || PRESERVED_STORAGE_KEYS.has(key)) return false;
  if (ACCOUNT_STORAGE_EXACT_KEYS.includes(key)) return true;
  return ACCOUNT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
};

/**
 * 清除当前设备上与登录账号相关的本地缓存。
 * 单个 key 删除失败不影响其余 key，也不向调用方抛错。
 */
export const clearAccountLocalData = (): void => {
  const removableKeys = new Set<string>();

  try {
    const storageInfo = uni.getStorageInfoSync();
    for (const key of storageInfo?.keys || []) {
      if (shouldRemoveStorageKey(String(key))) {
        removableKeys.add(String(key));
      }
    }
  } catch {
    // 存储信息不可用时，仍按固定 key 兜底清理。
  }

  ACCOUNT_STORAGE_EXACT_KEYS.forEach((key) => removableKeys.add(key));

  removableKeys.forEach((key) => {
    try {
      uni.removeStorageSync(key);
    } catch {
      // 忽略单个 key 的删除失败，避免中断整个注销流程。
    }
  });
};
