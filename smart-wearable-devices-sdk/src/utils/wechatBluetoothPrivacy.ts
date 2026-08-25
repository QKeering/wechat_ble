export const BLUETOOTH_PRIVACY_REQUIRED_HINT = '请先同意小程序隐私保护指引后使用蓝牙';

type PrivacyApi = {
  getPrivacySetting?: (options: {
    success?: (result: { needAuthorization?: boolean }) => void;
    fail?: (error: unknown) => void;
  }) => void;
  requirePrivacyAuthorize?: (options: {
    success?: (result: unknown) => void;
    fail?: (error: unknown) => void;
  }) => void;
};

type BluetoothPrivacyErrorRecord = Error & {
  errCode?: number | string;
  errno?: number | string;
  retryable?: boolean;
  bluetoothPrivacy?: boolean;
  rawError?: unknown;
};

let bluetoothPrivacyScopeBlockedError: BluetoothPrivacyErrorRecord | null = null;
let bluetoothPrivacyAuthorizationPromise: Promise<void> | null = null;

const getPrivacyApi = (): PrivacyApi | null => {
  const wxApi = (globalThis as typeof globalThis & { wx?: PrivacyApi }).wx;
  return wxApi || null;
};

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  return String(record.errno ?? record.errCode ?? record.code ?? '').trim();
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  return String(record.errMsg || record.message || record.msg || '').trim();
};

export const isBluetoothPrivacyScopeDeclarationError = (error: unknown) => {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return (
    code === '112' ||
    /api\s+scope\s+is\s+not\s+declared\s+in\s+the\s+privacy\s+agreement/i.test(message) ||
    /scope\.bluetooth.*privacy|privacy.*scope\.bluetooth/i.test(message)
  );
};

export const isBluetoothPrivacyError = (error: unknown) => {
  if (isBluetoothPrivacyScopeDeclarationError(error)) return true;
  if (!error || typeof error !== 'object') return false;
  return Boolean((error as Record<string, unknown>).bluetoothPrivacy);
};

export const createBluetoothPrivacyError = (
  rawError?: unknown,
  reason: 'authorization-required' | 'scope-not-declared' = 'authorization-required'
) => {
  if (isBluetoothPrivacyError(rawError) && rawError instanceof Error) {
    return rawError as BluetoothPrivacyErrorRecord;
  }
  const error = new Error(BLUETOOTH_PRIVACY_REQUIRED_HINT) as BluetoothPrivacyErrorRecord;
  error.name = 'BluetoothPrivacyAuthorizationError';
  error.bluetoothPrivacy = true;
  error.retryable = false;
  error.rawError = rawError;
  if (reason === 'scope-not-declared') {
    error.errCode = 112;
    error.errno = 112;
  }
  return error;
};

export const normalizeBluetoothPrivacyError = (error: unknown) => {
  if (!isBluetoothPrivacyScopeDeclarationError(error)) return error;
  const normalized = createBluetoothPrivacyError(error, 'scope-not-declared');
  bluetoothPrivacyScopeBlockedError = normalized;
  return normalized;
};

export const isWechatBluetoothPrivacyScopeBlocked = () => Boolean(bluetoothPrivacyScopeBlockedError);

export const ensureWechatBluetoothPrivacyAuthorization = () => {
  if (bluetoothPrivacyScopeBlockedError) {
    return Promise.reject(bluetoothPrivacyScopeBlockedError);
  }
  if (bluetoothPrivacyAuthorizationPromise) return bluetoothPrivacyAuthorizationPromise;

  const privacyApi = getPrivacyApi();
  if (!privacyApi?.getPrivacySetting || !privacyApi.requirePrivacyAuthorize) {
    return Promise.resolve();
  }

  const operation = new Promise<void>((resolve, reject) => {
    privacyApi.getPrivacySetting?.({
      success: (setting) => {
        if (!setting?.needAuthorization) {
          resolve();
          return;
        }
        privacyApi.requirePrivacyAuthorize?.({
          success: () => resolve(),
          fail: (error) => {
            const privacyError = createBluetoothPrivacyError(error, 'authorization-required');
            // A rejected privacy prompt must not be followed by automatic BLE
            // retries. A fresh mini-program session may ask again after the
            // user is ready to authorize.
            bluetoothPrivacyScopeBlockedError = privacyError;
            reject(privacyError);
          }
        });
      },
      // Older clients or a transient privacy-setting query failure should not
      // hide the real BLE error. Let openBluetoothAdapter perform the final
      // platform check, where errno 112 is normalized and permanently fused.
      fail: () => resolve()
    });
  });

  const sharedOperation = operation.finally(() => {
    if (bluetoothPrivacyAuthorizationPromise === sharedOperation) {
      bluetoothPrivacyAuthorizationPromise = null;
    }
  });
  bluetoothPrivacyAuthorizationPromise = sharedOperation;
  return bluetoothPrivacyAuthorizationPromise;
};
