const EMPTY_MESSAGES = new Set(['', 'undefined', 'null', '[object Object]']);

const DEVICE_STATE_CHANGED_RE = /Cannot read properties of (null|undefined)|reading ['"]?[^'"]+['"]?/i;
const BLE_UNAVAILABLE_RE =
  /bluetooth.*(not\s*available|unavailable|disable|off)|adapter.*(not\s*available|unavailable)|openBluetoothAdapter.*not\s*available|startBluetoothDevicesDiscovery.*not\s*available|\b10001\b|蓝牙.*(未打开|不可用|未开启)/i;
const EXPECTED_BLE_RUNTIME_RE =
  /timeout|timed out|wait .*timeout|parsed data wait|not ready|not available|unavailable|already connect|internal error|setBLEMTU.*internal|fail:internal|property not support|fail to write descriptor|Cannot read properties of (null|undefined)|reading ['"]?[^'"]+['"]?|\u8d85\u65f6/i;
const BLE_TIMEOUT_RE = /timeout|timed out|wait .*timeout|\u8d85\u65f6/i;
const BLE_INTERNAL_RE = /internal error|setBLEMTU.*internal|fail:internal/i;
const NETWORK_ERROR_RE = /request:fail|net::|err_connection|network|\u7f51\u7edc\u8bf7\u6c42|\u7f51\u7edc\u8fde\u63a5/i;
const NETWORK_TIMEOUT_RE = /err_connection_timed_out|timeout|time\s*out|\u8d85\u65f6/i;

export const formatBleErrorMessage = (error: unknown, fallback = '\u8bbe\u5907\u6682\u65f6\u65e0\u54cd\u5e94\uff0c\u8bf7\u91cd\u8bd5') => {
  const message = pickErrorMessage(error);
  if (!message) return fallback;

  if (DEVICE_STATE_CHANGED_RE.test(message)) {
    return '\u8bbe\u5907\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u641c\u7d22\u540e\u518d\u8fde\u63a5';
  }

  if (NETWORK_ERROR_RE.test(message)) {
    if (/^\u7f51\u7edc/.test(message)) return message;
    if (NETWORK_TIMEOUT_RE.test(message)) return '\u7f51\u7edc\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
    return '\u7f51\u7edc\u8fde\u63a5\u5f02\u5e38\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';
  }

  if (BLE_UNAVAILABLE_RE.test(message)) {
    return '蓝牙未打开或不可用，请打开手机蓝牙后重试';
  }

  if (BLE_TIMEOUT_RE.test(message)) {
    return '\u8bbe\u5907\u547d\u4ee4\u5df2\u53d1\u51fa\u4f46\u672a\u6536\u5230\u56de\u5305\uff0c\u8bf7\u590d\u5236\u8bca\u65ad\u65e5\u5fd7\u5b9a\u4f4d\u547d\u4ee4';
  }

  if (BLE_INTERNAL_RE.test(message)) {
    return '\u8bbe\u5907\u901a\u4fe1\u53c2\u6570\u534f\u5546\u5931\u8d25\uff0c\u8bf7\u91cd\u8fde\u540e\u91cd\u8bd5';
  }

  return message;
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

const normalizeMessage = (value: unknown): string => {
  if (value == null) return '';
  const message = String(value).trim();
  if (EMPTY_MESSAGES.has(message)) return '';
  return message;
};
