import { bindRingDevice, clearBoundRingDevice, getBoundRingDevice, normalizeRingBoundDevice, stripDeviceWrappingQuotes, unbindRingDevice } from '@/api/ringDevice';
import type { RingBindPayload } from '@/sdk/ring-ble';
import type { DeviceInfo, DeviceModel } from '@/types/api/device';
import { getBoundRingIdentity, hasBoundRingIdentity } from '@/utils/ringBinding';
import { markDeviceIdentityCacheConnected, normalizeDeviceIdentityMac, readDeviceIdentityCache } from '@/utils/deviceIdentityCache';

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
  return [source?.protocol, source?.mac, source?.deviceId, source?.uniMacId, source?.advertis?.macInfo, source?.cmdCharId, source?.dataCharId, source?.dataServiceId]
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

const normalizeBindIdentity = (value: unknown) =>
  stripDeviceWrappingQuotes(value)
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();

const isSameBindIdentity = (left: DeviceInfo | null | undefined, right: DeviceInfo | null | undefined) => {
  const leftIdentity = getBoundRingIdentity(left as any);
  const rightIdentity = getBoundRingIdentity(right as any);
  if (!leftIdentity || !rightIdentity) return false;
  if (leftIdentity === rightIdentity) return true;
  const leftNorm = normalizeBindIdentity(leftIdentity);
  const rightNorm = normalizeBindIdentity(rightIdentity);
  return Boolean(leftNorm && rightNorm && (leftNorm === rightNorm || leftNorm.endsWith(rightNorm.slice(-6)) || rightNorm.endsWith(leftNorm.slice(-6))));
};

const normalizeBindMacText = (value: unknown) => {
  const raw = stripDeviceWrappingQuotes(value);
  if (/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/.test(raw)) return raw.toUpperCase();
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return '';
  return hex.match(/.{2}/g)?.join(':') || '';
};

const getDeviceBindMac = (device: unknown) => {
  const normalized = normalizeRingBoundDevice(device as any) as DeviceInfo | null;
  if (!normalized) return '';
  return normalizeBindMacText(normalized.mac) || normalizeBindMacText(normalized.advertis?.macInfo) || normalizeBindMacText(normalized.uniMacId);
};

const getDeviceCommunicationId = (device: DeviceInfo | null | undefined) =>
  stripDeviceWrappingQuotes(
    (device as Record<string, any> | null | undefined)?.deviceId ||
      (device as Record<string, any> | null | undefined)?.platformDeviceId ||
      (device as Record<string, any> | null | undefined)?.wxDeviceId ||
      (device as Record<string, any> | null | undefined)?.bleDeviceId ||
      (device as Record<string, any> | null | undefined)?.bluetoothDeviceId ||
      ''
  ).trim();

const isConflictingMacLikeCommunicationId = (communicationId: unknown, stableMac: string) => {
  const macKey = normalizeDeviceIdentityMac(stableMac);
  const communicationMacKey = normalizeDeviceIdentityMac(communicationId);
  return Boolean(macKey && communicationMacKey && communicationMacKey !== macKey);
};

const isSameMacLikeCommunicationId = (communicationId: unknown, stableMac: string) => {
  const macKey = normalizeDeviceIdentityMac(stableMac);
  const communicationMacKey = normalizeDeviceIdentityMac(communicationId);
  return Boolean(macKey && communicationMacKey && communicationMacKey === macKey);
};

const pickBoundCommunicationDeviceId = (stableMac: string, payload?: DeviceInfo | null, local?: DeviceInfo | null, remote?: DeviceInfo | null) => {
  const macKey = normalizeDeviceIdentityMac(stableMac);
  if (!macKey) return getDeviceCommunicationId(payload) || '';

  // Backend binding only provides the stable MAC. Runtime communication id must
  // come from the verified userId + platform + MAC mapping cache.
  const cached = readDeviceIdentityCache({ mac: macKey });
  if (cached?.deviceId && !isConflictingMacLikeCommunicationId(cached.deviceId, macKey)) {
    return cached.deviceId;
  }

  const payloadDeviceId = getDeviceCommunicationId(payload);
  if (isSameMacLikeCommunicationId(payloadDeviceId, macKey)) return payloadDeviceId;

  // Android 上微信 deviceId 通常就是 MAC。只有 deviceId 与后端 MAC 完全一致时才允许直接复用；
  // iOS 或未知来源的旧本地 deviceId 必须通过扫描匹配后重新写入缓存。
  const localDeviceId = getDeviceCommunicationId(local);
  if (isSameMacLikeCommunicationId(localDeviceId, macKey)) return localDeviceId;

  const remoteDeviceId = getDeviceCommunicationId(remote);
  if (isSameMacLikeCommunicationId(remoteDeviceId, macKey)) return remoteDeviceId;

  return '';
};

const mergeBoundRingDevice = (remote: DeviceInfo | null | undefined, local?: DeviceInfo | null, payload?: RingBindPayload | null): DeviceInfo | null => {
  const normalizedRemote = normalizeRingBoundDevice(remote as any) as DeviceInfo | null;
  const normalizedLocal = normalizeRingBoundDevice(local as any) as DeviceInfo | null;
  const normalizedPayload = normalizeRingBoundDevice(payload as any) as DeviceInfo | null;
  const identityBase: DeviceInfo | null =
    (hasBoundRingIdentity(normalizedRemote) && normalizedRemote) ||
    (hasBoundRingIdentity(normalizedPayload) && normalizedPayload) ||
    (hasBoundRingIdentity(normalizedLocal) && normalizedLocal) ||
    null;

  if (!identityBase) return null;

  const compatibleLocal = normalizedLocal && isSameBindIdentity(identityBase, normalizedLocal) ? normalizedLocal : null;
  const compatiblePayload = normalizedPayload && isSameBindIdentity(identityBase, normalizedPayload) ? normalizedPayload : null;
  const stableMac =
    getDeviceBindMac(normalizedRemote) ||
    getDeviceBindMac(compatiblePayload) ||
    getDeviceBindMac(compatibleLocal) ||
    getDeviceBindMac(normalizedPayload) ||
    getDeviceBindMac(normalizedLocal);
  const mergedAdvertis = {
    ...(compatibleLocal?.advertis || {}),
    ...(compatiblePayload?.advertis || {}),
    ...(normalizedRemote?.advertis || {}),
    ...(stableMac ? { macInfo: stableMac } : {})
  };
  const communicationDeviceId = pickBoundCommunicationDeviceId(stableMac, compatiblePayload, compatibleLocal, normalizedRemote);

  return normalizeRingBoundDevice({
    ...(compatibleLocal || {}),
    ...(compatiblePayload || {}),
    ...(normalizedRemote || {}),
    mac: stableMac || normalizedRemote?.mac || compatiblePayload?.mac || compatibleLocal?.mac || identityBase.mac,
    uniMacId: stableMac || normalizedRemote?.uniMacId || compatiblePayload?.uniMacId || compatibleLocal?.uniMacId || identityBase.uniMacId,
    deviceId: communicationDeviceId,
    platformDeviceId: communicationDeviceId,
    wxDeviceId: communicationDeviceId,
    bleDeviceId: communicationDeviceId,
    bluetoothDeviceId: communicationDeviceId,
    modelName: normalizedRemote?.modelName || normalizedRemote?.productName || compatiblePayload?.modelName || compatibleLocal?.modelName,
    productName: normalizedRemote?.productName || normalizedRemote?.modelName || compatiblePayload?.productName || compatibleLocal?.productName,
    bleName: normalizedRemote?.bleName || compatiblePayload?.bleName || compatiblePayload?.localName || compatibleLocal?.bleName || compatibleLocal?.localName,
    deviceName:
      normalizedRemote?.deviceName ||
      normalizedRemote?.name ||
      compatiblePayload?.deviceName ||
      compatiblePayload?.name ||
      compatibleLocal?.deviceName ||
      compatibleLocal?.name ||
      identityBase.deviceName ||
      identityBase.name,
    name:
      normalizedRemote?.name ||
      normalizedRemote?.deviceName ||
      compatiblePayload?.name ||
      compatiblePayload?.deviceName ||
      compatibleLocal?.name ||
      compatibleLocal?.deviceName ||
      identityBase.name ||
      identityBase.deviceName,
    serviceId: normalizedRemote?.serviceId || compatiblePayload?.serviceId || compatibleLocal?.serviceId,
    cmdCharId: normalizedRemote?.cmdCharId || compatiblePayload?.cmdCharId || compatibleLocal?.cmdCharId,
    dataCharId: normalizedRemote?.dataCharId || compatiblePayload?.dataCharId || compatibleLocal?.dataCharId,
    dataServiceId: normalizedRemote?.dataServiceId || compatiblePayload?.dataServiceId || compatibleLocal?.dataServiceId,
    protocol: normalizedRemote?.protocol || compatiblePayload?.protocol || compatibleLocal?.protocol || identityBase.protocol,
    advertis: Object.keys(mergedAdvertis).length > 0 ? mergedAdvertis : undefined,
    source: normalizedRemote ? 'remote' : 'local',
    syncedAt: Date.now()
  } as any) as DeviceInfo | null;
};

const assertBackendSuccess = (payload: unknown) => {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, any>) : null;
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'code')) return;
  const code = Number(source.code);
  if (!Number.isFinite(code) || code === 200 || code === 0) return;
  // msg 是后端面向用户的文案（如"该设备已被其他用户绑定"），reasonCode 供客户端
  // 做精确分支提示。两者都要保留：只抛 reasonCode 会让 UI 最终只剩一句兜底提示。
  const reasonCode = String(source.data?.reasonCode || '').trim();
  const message = String(source.msg || source.message || reasonCode || 'DEVICE_BIND_FAILED');
  throw Object.assign(new Error(message), { reasonCode: reasonCode || message });
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

const putAppApi = async (url: string, data: Record<string, any> = {}, config: HttpRequestConfigCompat = {}) => {
  const http = (uni as any)?.$uv?.http;
  const requestConfig = {
    ...config,
    custom: {
      toast: false,
      ...(config.custom || {})
    }
  };
  if (typeof http?.put === 'function') {
    return http.put(url, data, requestConfig);
  }
  if (typeof http?.request === 'function') {
    return http.request({
      ...requestConfig,
      url,
      method: 'PUT',
      data
    });
  }
  throw new Error('HTTP client not initialized');
};

const getRemoteBindInfo = async (config: HttpRequestConfigCompat, useCache: boolean, localFingerprint: string): Promise<RemoteBindInfoResult> => {
  const now = Date.now();
  if (useCache && remoteBindInfoCache && remoteBindInfoCache.expiresAt > now && remoteBindInfoCache.localFingerprint === localFingerprint) {
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
  const normalizedParams = (normalizeRingBoundDevice(params as any) || params) as RingBindPayload;
  const response = await postAppApi('/app/device/bind', normalizedParams as any, _config);
  assertBackendSuccess(response);
  const remote = normalizeBindInfoResponse(response);
  const authoritative = mergeBoundRingDevice(remote, localBeforeRemote as DeviceInfo | null, normalizedParams);
  if (!hasBoundRingIdentity(authoritative)) {
    throw new Error('Backend binding response missing valid device info');
  }
  const bindMac = getDeviceBindMac(authoritative) || getDeviceBindMac(normalizedParams);
  const bindDeviceId = getDeviceCommunicationId(normalizeRingBoundDevice(normalizedParams as any) as DeviceInfo | null);
  if (bindMac && bindDeviceId) {
    markDeviceIdentityCacheConnected({
      mac: bindMac,
      deviceId: bindDeviceId,
      name: authoritative?.bleName || (normalizedParams as any).bleName || (normalizedParams as any).localName || (params as any).name || (params as any).deviceName,
      source: 'first-bind'
    });
  }
  const device = await bindRingDevice(authoritative as any);
  clearRemoteBindInfoCache();
  return device as DeviceInfo;
};

export const unbind = async (params: { mac: string }, _config: HttpRequestConfigCompat = {}) => {
  const normalizedParams = { ...params, mac: stripDeviceWrappingQuotes(params.mac) };
  const response = await postAppApi('/app/device/unbind', normalizedParams as any, _config);
  assertBackendSuccess(response);
  const result = await unbindRingDevice(normalizedParams);
  clearRemoteBindInfoCache();
  return result;
};

export const reportDeviceBatteryLog = async (
  params: {
    userId?: string | number;
    mac?: string;
    deviceMac?: string;
    realBattery: number;
    displayBattery?: number;
    recordTime?: string;
    source?: string;
  },
  config: HttpRequestConfigCompat = {}
) => postAppApi('/app/device/batteryLog', params as any, config);

export const reportDeviceVersions = async (
  params: {
    mac?: string;
    deviceMac?: string;
    firmwareVersion?: string;
    softwareVersion?: string;
  },
  config: HttpRequestConfigCompat = {}
) => postAppApi('/app/device/version/report', params as any, config);

export const reportOtaUpdate = async (
  params: {
    packageId: string | number;
    mac: string;
    versionKind?: 'firmware' | 'software';
  },
  config: HttpRequestConfigCompat = {}
) => {
  const query = [
    `packageId=${encodeURIComponent(String(params.packageId))}`,
    `mac=${encodeURIComponent(params.mac)}`,
    params.versionKind ? `versionKind=${encodeURIComponent(params.versionKind)}` : ''
  ]
    .filter(Boolean)
    .join('&');
  return putAppApi(`/app/ota/package/updateCallback?${query}`, {}, config);
};

export const getBindInfo = async (params: GetBindInfoParams = {}, _config: HttpRequestConfigCompat = {}): Promise<DeviceInfo | null> => {
  const localBeforeRemote = await getBoundRingDevice();
  const remote = await getRemoteBindInfo(_config, !params.refresh && !hasConfigOverrides(_config), getBindInfoFingerprint(localBeforeRemote as DeviceInfo | null));
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

export interface DeviceBindingStatus {
  boundByOther: boolean;
  boundToCurrentUser: boolean;
}

/**
 * 连接前只读探测设备归属，避免把"已被其他账号绑定"的戒指先连上蓝牙、再被后端拒绝。
 * 只返回布尔状态，不包含归属人信息；网络失败由调用方决定是否继续正常连接流程。
 */
export const getDeviceBindingStatus = async (mac: string, config: HttpRequestConfigCompat = {}): Promise<DeviceBindingStatus> => {
  const response = await (uni as any).$uv.http.get('/app/device/bindStatus', {
    params: { mac },
    timeout: 4000,
    custom: { toast: false, catch: true },
    ...config
  });
  assertBackendSuccess(response);
  const data = ((response as any)?.data || {}) as Record<string, unknown>;
  return {
    boundByOther: data.boundByOther === true,
    boundToCurrentUser: data.boundToCurrentUser === true
  };
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
      uniMacId: mac,
      deviceName: sn,
      name: sn
    } as DeviceInfo;
  }

  const name = String(sn || '').trim();
  return {
    sn,
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

export const deviceModelList = async (params: Record<string, any> = {}, config: HttpRequestConfigCompat = {}): Promise<DeviceModel[]> => {
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
  const versionCode = pickOtaString(source.versionCode, source.version_code, source.version, source.firmwareVersion, source.firmware_version);

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

export const getOtaInfo = async (params: OtaInfoParams, config: HttpRequestConfigCompat = {}): Promise<OtaPackageInfo | OtaInfoResponse> => {
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
