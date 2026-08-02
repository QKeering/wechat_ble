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

export const formatBleErrorMessage = (error: unknown, fallback = '设备暂时无响应，请重试') => {
  const message = pickErrorMessage(error);
  if (!message) return fallback;

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
