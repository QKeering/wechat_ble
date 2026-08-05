import { bindRingDevice, clearBoundRingDevice, getBoundRingDevice, normalizeRingBoundDevice, unbindRingDevice } from '@/api/ringDevice';
import type { RingBindPayload } from '@/sdk/ring-ble';
import type { DeviceInfo, DeviceModel } from '@/types/api/device';
import { getBoundRingIdentity, hasBoundRingIdentity } from '@/utils/ringBinding';

export interface HttpRequestConfigCompat {
  [key: string]: any;
}

interface GetBindInfoParams {
  refresh?: boolean;
  /**
   * Only for display-only pages when backend /app/device/current is temporarily unavailable.
   * Auto-connect and upload must keep the default false so local stale cache cannot become
   * the authoritative bound device.
   */
  allowLocalFallback?: boolean;
}

const BIND_INFO_REMOTE_CACHE_MS = 5000;
type RemoteBindInfoResult = { ok: true; value: DeviceInfo | null } | { ok: false; value: null };

let remoteBindInfoCache: { value: RemoteBindInfoResult; expiresAt: number; localFingerprint: string } | null = null;
let remoteBindInfoPending: Promise<RemoteBindInfoResult> | null = null;

const clearRemoteBindInfoCache = () => {
  remoteBindInfoCache = null;
  remoteBindInfoPending = null;
};

const hasConfigOverrides = (config: HttpRequestConfigCompat = {}) => Object.keys(config).length > 0;

const getBindInfoFingerprint = (device: DeviceInfo | null | undefined) => {
  const source = device as any;
  return [
    source?.protocol,
    source?.mac,
    source?.deviceId,
    source?.uniMacId,
    source?.advertis?.macInfo,
    source?.cmdCharId,
    source?.dataCharId,
    source?.dataServiceId
  ]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join('|');
};

const normalizeBindInfoResponse = (payload: unknown): DeviceInfo | null => {
  const direct = normalizeRingBoundDevice(payload as any) as DeviceInfo | null;
  if (hasBoundRingIdentity(direct)) return direct;
  const source = payload as Record<string, any> | null | undefined;
  if (!source || typeof source !== 'object') return null;
  for (const key of ['data', 'result', 'device', 'current', 'currentDevice']) {
    const nested = normalizeRingBoundDevice(source[key] as any) as DeviceInfo | null;
    if (hasBoundRingIdentity(nested)) return nested;
  }
  return null;
};

const normalizeBindIdentity = (value: unknown) => String(value || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

const isSameBindIdentity = (left: DeviceInfo | null | undefined, right: DeviceInfo | null | undefined) => {
  const leftIdentity = getBoundRingIdentity(left as any);
  const rightIdentity = getBoundRingIdentity(right as any);
  if (!leftIdentity || !rightIdentity) return false;
  if (leftIdentity === rightIdentity) return true;
  const leftNorm = normalizeBindIdentity(leftIdentity);
  const rightNorm = normalizeBindIdentity(rightIdentity);
  return Boolean(leftNorm && rightNorm && (leftNorm === rightNorm || leftNorm.endsWith(rightNorm.slice(-6)) || rightNorm.endsWith(leftNorm.slice(-6))));
};

const mergeBoundRingDevice = (
  remote: DeviceInfo | null | undefined,
  local?: DeviceInfo | null,
  payload?: RingBindPayload | null
): DeviceInfo | null => {
  const normalizedRemote = normalizeRingBoundDevice(remote as any) as DeviceInfo | null;
  if (!hasBoundRingIdentity(normalizedRemote)) return null;

  const normalizedLocal = normalizeRingBoundDevice(local as any) as DeviceInfo | null;
  const normalizedPayload = normalizeRingBoundDevice(payload as any) as DeviceInfo | null;
  const compatibleLocal = normalizedLocal && isSameBindIdentity(normalizedRemote, normalizedLocal) ? normalizedLocal : null;
  const compatiblePayload = normalizedPayload && isSameBindIdentity(normalizedRemote, normalizedPayload) ? normalizedPayload : null;

  return normalizeRingBoundDevice({
    ...(compatibleLocal || {}),
    ...(compatiblePayload || {}),
    ...(normalizedRemote || {}),
    serviceId: normalizedRemote?.serviceId || compatiblePayload?.serviceId || compatibleLocal?.serviceId,
    cmdCharId: normalizedRemote?.cmdCharId || compatiblePayload?.cmdCharId || compatibleLocal?.cmdCharId,
    dataCharId: normalizedRemote?.dataCharId || compatiblePayload?.dataCharId || compatibleLocal?.dataCharId,
    dataServiceId: normalizedRemote?.dataServiceId || compatiblePayload?.dataServiceId || compatibleLocal?.dataServiceId,
    protocol: normalizedRemote?.protocol || compatiblePayload?.protocol || compatibleLocal?.protocol,
    advertis: normalizedRemote?.advertis || compatiblePayload?.advertis || compatibleLocal?.advertis,
    source: 'remote',
    syncedAt: Date.now()
  } as any) as DeviceInfo | null;
};

const assertBackendSuccess = (payload: unknown) => {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, any>) : null;
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'code')) return;
  const code = Number(source.code);
  if (!Number.isFinite(code) || code === 200 || code === 0) return;
  const reason = source.data?.reasonCode || source.msg || source.message || 'DEVICE_BIND_FAILED';
  throw new Error(String(reason));
};

const postAppApi = async (url: string, data: Record<string, any>, config: HttpRequestConfigCompat = {}) => {
  const http = (uni as any)?.$uv?.http;
  const requestConfig = {
    ...config,
    custom: {
      toast: false,
      ...(config.custom || {})
    }
  };
  if (typeof http?.post === 'function') {
    return http.post(url, data, requestConfig);
  }
  if (typeof http?.request === 'function') {
    return http.request({
      ...requestConfig,
      url,
      method: 'POST',
      data
    });
  }
  throw new Error('HTTP client not initialized');
};

const getRemoteBindInfo = async (
  config: HttpRequestConfigCompat,
  useCache: boolean,
  localFingerprint: string
): Promise<RemoteBindInfoResult> => {
  const now = Date.now();
  if (
    useCache &&
    remoteBindInfoCache &&
    remoteBindInfoCache.expiresAt > now &&
    remoteBindInfoCache.localFingerprint === localFingerprint
  ) {
    return remoteBindInfoCache.value;
  }
  if (useCache && remoteBindInfoPending) {
    return remoteBindInfoPending;
  }

  let request: Promise<RemoteBindInfoResult> | null = null;
  request = (async () => {
    try {
      const remote = await (uni as any).$uv.http.get('/app/device/current', {
        custom: { toast: false, catch: true },
        ...config
      });
      assertBackendSuccess(remote);
      const value = normalizeBindInfoResponse(remote);
      const result: RemoteBindInfoResult = { ok: true, value };
      if (useCache) {
        remoteBindInfoCache = {
          value: result,
          expiresAt: Date.now() + BIND_INFO_REMOTE_CACHE_MS,
          localFingerprint
        };
      }
      return result;
    } catch (error) {
      // Remote request failure only falls back for display. Remote success with empty binding clears local mirror.
      return { ok: false, value: null };
    } finally {
      if (remoteBindInfoPending === request) {
        remoteBindInfoPending = null;
      }
    }
  })();

  if (useCache) {
    remoteBindInfoPending = request;
  }
  return request;
};

export const bind = async (params: RingBindPayload, _config: HttpRequestConfigCompat = {}) => {
  const localBeforeRemote = await getBoundRingDevice();
  const response = await postAppApi('/app/device/bind', params as any, _config);
  assertBackendSuccess(response);
  const remote = normalizeBindInfoResponse(response);
  const authoritative = mergeBoundRingDevice(remote, localBeforeRemote as DeviceInfo | null, params);
  if (!hasBoundRingIdentity(authoritative)) {
    throw new Error('Backend binding response missing valid device info');
  }
  const device = await bindRingDevice(authoritative as any);
  clearRemoteBindInfoCache();
  return device as DeviceInfo;
};

export const unbind = async (params: { mac: string }, _config: HttpRequestConfigCompat = {}) => {
  const response = await postAppApi('/app/device/unbind', params as any, _config);
  assertBackendSuccess(response);
  const result = await unbindRingDevice(params);
  clearRemoteBindInfoCache();
  return result;
};

export const getBindInfo = async (
  params: GetBindInfoParams = {},
  _config: HttpRequestConfigCompat = {}
): Promise<DeviceInfo | null> => {
  const localBeforeRemote = await getBoundRingDevice();
  const remote = await getRemoteBindInfo(
    _config,
    !params.refresh && !hasConfigOverrides(_config),
    getBindInfoFingerprint(localBeforeRemote as DeviceInfo | null)
  );
  if (remote.ok) {
    if (remote.value) {
      const device = mergeBoundRingDevice(remote.value, localBeforeRemote as DeviceInfo | null);
      if (device) {
        await bindRingDevice(device as any);
        return device;
      }
    }
    await clearBoundRingDevice();
    return null;
  }

  const local = await getBoundRingDevice();
  if (!hasBoundRingIdentity(local)) {
    await clearBoundRingDevice();
    return null;
  }
  if (!params.allowLocalFallback) {
    return null;
  }
  return normalizeRingBoundDevice({
    ...(local as any),
    source: 'local-unverified',
    bindingStatus: 'unverified',
    bindingVerified: false,
    remoteBindingUnavailable: true
  } as any) as DeviceInfo | null;
};

const normalizeMacLikeText = (value: unknown) => {
  const raw = String(value || '').trim();
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return '';
  return hex.match(/.{2}/g)?.join(':') || '';
};

const buildScanFallbackDevice = (sn: string): DeviceInfo | null => {
  const mac = normalizeMacLikeText(sn);
  if (mac) {
    return {
      sn,
      mac,
      deviceId: mac,
      uniMacId: mac,
      deviceName: sn,
      name: sn
    } as DeviceInfo;
  }

  const name = String(sn || '').trim();
  return {
    sn,
    deviceId: name,
    uniMacId: name,
    deviceName: name,
    name
  } as DeviceInfo;
};

export const scan = async (params: { sn: string }, config: HttpRequestConfigCompat = {}): Promise<DeviceInfo> => {
  const sn = String(params.sn || '').trim();
  if (!sn) {
    throw new Error('Empty QR code');
  }

  const requestConfig = {
    ...config,
    params: {
      ...(config.params || {}),
      sn
    },
    custom: {
      toast: false,
      catch: true,
      ...(config.custom || {})
    }
  };

  try {
    const response = await (uni as any).$uv.http.get('/app/device/scanQRCode', requestConfig);
    assertBackendSuccess(response);
    const remote = normalizeBindInfoResponse(response);
    if (remote) {
      return normalizeRingBoundDevice({
        ...remote,
        sn: (remote as any).sn || sn,
        deviceName: (remote as any).deviceName || (remote as any).name || sn,
        name: (remote as any).name || (remote as any).deviceName || sn
      } as any) as DeviceInfo;
    }
  } catch (error) {
    const fallback = buildScanFallbackDevice(sn);
    if (fallback) return fallback;
    throw error;
  }

  const fallback = buildScanFallbackDevice(sn);
  if (fallback) return fallback;
  throw new Error('QR code did not match any device');
};

const normalizeDeviceModelListResponse = (payload: unknown): DeviceModel[] => {
  if (Array.isArray(payload)) return payload as DeviceModel[];
  const source = payload && typeof payload === 'object' ? (payload as Record<string, any>) : null;
  if (!source) return [];
  for (const key of ['data', 'rows', 'list', 'records']) {
    const value = source[key];
    if (Array.isArray(value)) return value as DeviceModel[];
    if (value && typeof value === 'object') {
      const nested = normalizeDeviceModelListResponse(value);
      if (nested.length > 0) return nested;
    }
  }
  return [];
};

export const deviceModelList = async (
  params: Record<string, any> = {},
  config: HttpRequestConfigCompat = {}
): Promise<DeviceModel[]> => {
  const response = await (uni as any).$uv.http.get('/app/device/model/list', {
    ...config,
    params,
    custom: {
      toast: false,
      catch: true,
      ...(config.custom || {})
    }
  });
  return normalizeDeviceModelListResponse(response).filter((item) => item?.modelKey || item?.modelName);
};

export const getInfo = async (_params = {}, _config: HttpRequestConfigCompat = {}): Promise<DeviceInfo | null> => {
  return getBindInfo({}, _config);
};

export interface OtaInfoParams {
  currentVersion: string;
  deviceModel?: string;
}

export interface OtaPackageInfo extends DeviceInfo {
  currentVersion: string;
  deviceModel?: string;
  hasUpdate: boolean;
  versionCode?: string;
  version?: string;
  firmwareVersion?: string;
  fileUrl?: string;
  fileSize?: number;
  firmwareUrl?: string;
  url?: string;
  size?: number;
  md5?: string;
  remark?: string;
  description?: string;
  forceUpdate?: number | string | boolean;
}

export interface OtaInfoResponse {
  code: number;
  data: OtaPackageInfo | null;
  msg: string;
  message: string;
}

const pickOtaString = (...values: unknown[]) => {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const normalizeOtaPackageInfo = (payload: unknown, params: OtaInfoParams): OtaPackageInfo | null => {
  if (!payload || typeof payload !== 'object') return null;

  const source = payload as Record<string, any>;
  const fileUrl = pickOtaString(source.fileUrl, source.file_url, source.firmwareUrl, source.firmware_url, source.url);
  const versionCode = pickOtaString(
    source.versionCode,
    source.version_code,
    source.version,
    source.firmwareVersion,
    source.firmware_version
  );

  return {
    ...source,
    currentVersion: params.currentVersion,
    deviceModel: pickOtaString(source.deviceModel, source.device_model, params.deviceModel),
    versionCode,
    version: pickOtaString(source.version, versionCode),
    firmwareVersion: pickOtaString(source.firmwareVersion, source.firmware_version, versionCode),
    fileUrl,
    firmwareUrl: pickOtaString(source.firmwareUrl, source.firmware_url, fileUrl),
    url: pickOtaString(source.url, fileUrl),
    hasUpdate: Boolean(fileUrl)
  };
};

export const getOtaInfo = async (
  params: OtaInfoParams,
  config: HttpRequestConfigCompat = {}
): Promise<OtaPackageInfo | OtaInfoResponse> => {
  const fallbackPackageInfo: OtaPackageInfo = {
    currentVersion: params.currentVersion,
    deviceModel: params.deviceModel,
    hasUpdate: false
  };

  const query: Record<string, string> = {
    currentVersion: params.currentVersion || ''
  };
  if (params.deviceModel) {
    query.deviceModel = params.deviceModel;
  }

  const response = await (uni as any).$uv.http.get('/app/ota/package/check', {
    params: query,
    ...config
  });

  const returnAll = Boolean(config?.custom?.returnAll);
  const responseObject = response && typeof response === 'object' ? (response as Record<string, any>) : null;
  const looksLikeWrappedResponse =
    responseObject &&
    (Object.prototype.hasOwnProperty.call(responseObject, 'code') ||
      Object.prototype.hasOwnProperty.call(responseObject, 'data') ||
      Object.prototype.hasOwnProperty.call(responseObject, 'msg'));

  const code = looksLikeWrappedResponse ? Number(responseObject?.code ?? 200) : 200;
  const msg = pickOtaString(responseObject?.msg, responseObject?.message, 'already latest');
  const rawData = looksLikeWrappedResponse ? responseObject?.data : response;
  const packageInfo = normalizeOtaPackageInfo(rawData, params);

  if (returnAll) {
    return {
      code,
      data: packageInfo,
      msg,
      message: msg
    };
  }

  return packageInfo || fallbackPackageInfo;
};
