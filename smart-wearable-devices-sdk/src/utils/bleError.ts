const EMPTY_MESSAGES = new Set(['', 'undefined', 'null', '[object Object]']);

const DEVICE_STATE_CHANGED_RE = /Cannot read properties of (null|undefined)|reading ['"]?[^'"]+['"]?/i;
const BLE_UNAVAILABLE_RE =
  /bluetooth.*(not\s*available|unavailable|disable|off)|adapter.*(not\s*available|unavailable)|openBluetoothAdapter.*not\s*available|startBluetoothDevicesDiscovery.*not\s*available|\b10001\b|蓝牙.*(未打开|不可用|未开启)/i;
const EXPECTED_BLE_RUNTIME_RE =
  /timeout|timed out|wait .*timeout|parsed data wait|not ready|not available|unavailable|already connect|internal error|setBLEMTU.*internal|fail:internal|property not support|fail to write descriptor|Cannot read properties of (null|undefined)|reading ['"]?[^'"]+['"]?|超时/i;
const BLE_ALREADY_CONNECTED_RE = /already connect|already connected/i;
const BLE_TIMEOUT_RE = /timeout|timed out|wait .*timeout|超时/i;
const BLE_INTERNAL_RE = /internal error|setBLEMTU.*internal|fail:internal/i;
const NETWORK_ERROR_RE = /request:fail|net::|err_connection|network|网络请求|网络连接/i;
const NETWORK_TIMEOUT_RE = /err_connection_timed_out|timeout|time\s*out|超时/i;
const BLUETOOTH_PRIVACY_RE =
  /api\s+scope\s+is\s+not\s+declared\s+in\s+the\s+privacy\s+agreement|scope\.bluetooth.*privacy|privacy.*scope\.bluetooth/i;
const PERMISSION_DENIED_RE = /permission\s+denied|auth\s+deny|access\s+denied|not\s+authorized|unauthorized/i;
const DEVICE_NOT_FOUND_RE = /device.*not\s+found|no\s+device|not\s+found.*device/i;
const CONNECTION_FAILED_RE = /connect(?:ion)?.*(?:fail|failed|closed|disconnect)|disconnected/i;
const SERVICE_NOT_READY_RE = /service.*not\s+found|characteristic.*not\s+found|no\s+service|no\s+characteristic/i;
const INVALID_PARAMETER_RE = /invalid\s+(?:param|parameter|argument)|parameter\s+error/i;
const USER_FACING_ALLOWED_ENGLISH_RE =
  /\b(?:AI|BLE|MAC|HRV|OTA|SDK|ID|URL|JSON|iOS|QKeer|L19|RW|SN|bpm|cm|kg|MB)\b/gi;

export const BLUETOOTH_PRIVACY_ERROR_HINT = '请先同意小程序隐私保护指引后使用蓝牙';

export const formatBleErrorMessage = (error: unknown, fallback = '设备暂时无响应，请重试') => {
  const message = pickErrorMessage(error);
  const localizedFallback = localizeFallback(fallback);
  if (!message) return localizedFallback;

  const errorCode = getBleErrorCode(error);
  if (errorCode === '112' || BLUETOOTH_PRIVACY_RE.test(message)) {
    return BLUETOOTH_PRIVACY_ERROR_HINT;
  }

  if (DEVICE_STATE_CHANGED_RE.test(message)) {
    return '设备状态已变化，请重新搜索后再连接';
  }

  if (NETWORK_ERROR_RE.test(message)) {
    if (/^网络/.test(message)) return message;
    if (NETWORK_TIMEOUT_RE.test(message)) return '网络请求超时，请稍后重试';
    return '网络连接异常，请稍后重试';
  }

  if (BLE_ALREADY_CONNECTED_RE.test(message)) {
    return '设备已连接，请勿重复连接';
  }

  if (BLE_UNAVAILABLE_RE.test(message)) {
    return '蓝牙未打开或不可用，请打开手机蓝牙后重试';
  }

  if (BLE_TIMEOUT_RE.test(message)) {
    return '设备命令已发出但未收到回包，请靠近戒指后重试';
  }

  if (BLE_INTERNAL_RE.test(message)) {
    return '设备通信参数协商失败，请重连后重试';
  }

  if (PERMISSION_DENIED_RE.test(message)) {
    return '操作权限未开启，请在系统设置中允许后重试';
  }

  if (DEVICE_NOT_FOUND_RE.test(message)) {
    return '未找到设备，请重新搜索后重试';
  }

  if (SERVICE_NOT_READY_RE.test(message)) {
    return '设备服务未就绪，请重新连接后重试';
  }

  if (CONNECTION_FAILED_RE.test(message)) {
    return '设备连接失败，请靠近戒指后重试';
  }

  if (INVALID_PARAMETER_RE.test(message)) {
    return '提交的信息无效，请检查后重试';
  }

  return hasUntranslatedEnglish(message) ? localizedFallback : message;
};

export const isExpectedBleRuntimeError = (error: unknown) => {
  const message = pickErrorMessage(error);
  return Boolean(message && EXPECTED_BLE_RUNTIME_RE.test(message));
};

export const getBleRuntimeLogMessage = (error: unknown, fallback?: string) => {
  return formatBleErrorMessage(error, fallback);
};

const pickErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return normalizeMessage(error);
  if (error instanceof Error) return normalizeMessage(error.message);
  if (!error || typeof error !== 'object') return '';

  const record = error as Record<string, any>;
  const candidates = [
    record.message,
    record.msg,
    record.rawMsg,
    record.rawError,
    record.errMsg,
    record.errorMessage,
    record.data?.message,
    record.data?.msg,
    record.response?.data?.message,
    record.response?.data?.msg
  ];

  for (const candidate of candidates) {
    const message = normalizeMessage(candidate);
    if (message) return message;
  }

  try {
    return normalizeMessage(JSON.stringify(record));
  } catch {
    return '';
  }
};

const getBleErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, any>;
  return String(record.errno ?? record.errCode ?? record.code ?? record.rawError?.errno ?? record.rawError?.errCode ?? '').trim();
};

const normalizeMessage = (value: unknown): string => {
  if (value == null) return '';
  const message = String(value).trim();
  if (EMPTY_MESSAGES.has(message)) return '';
  return message;
};

const hasUntranslatedEnglish = (message: string) => {
  const withoutAllowedTerms = message.replace(USER_FACING_ALLOWED_ENGLISH_RE, '');
  return /[A-Za-z]{2,}/.test(withoutAllowedTerms);
};

const localizeFallback = (fallback: string) => {
  const normalized = normalizeMessage(fallback);
  if (!normalized || hasUntranslatedEnglish(normalized)) {
    return '操作未完成，请稍后重试';
  }
  return normalized;
};
