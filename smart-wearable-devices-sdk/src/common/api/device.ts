import { bindRingDevice, clearBoundRingDevice, getBoundRingDevice, normalizeRingBoundDevice, unbindRingDevice } from '@/api';
import type { RingBindPayload } from '@/sdk/ring-ble';
import type { DeviceInfo, DeviceModel } from '@/types/api/device';
import { hasBoundRingIdentity } from '@/utils/ringBinding';

export interface HttpRequestConfigCompat {
  [key: string]: any;
}

interface GetBindInfoParams {
  refresh?: boolean;
}

const BIND_INFO_REMOTE_CACHE_MS = 5000;
let remoteBindInfoCache: { value: DeviceInfo | null; expiresAt: number; localFingerprint: string } | null = null;
let remoteBindInfoPending: Promise<DeviceInfo | null> | null = null;

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

const getRemoteBindInfo = async (
  config: HttpRequestConfigCompat,
  useCache: boolean,
  localFingerprint: string
): Promise<DeviceInfo | null> => {
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

  let request: Promise<DeviceInfo | null> | null = null;
  request = (async () => {
    try {
      const remote = await (uni as any).$uv.http.get('/app/device/current', {
        custom: { toast: false, catch: true },
        ...config
      });
      const value = normalizeBindInfoResponse(remote);
      if (useCache) {
        remoteBindInfoCache = {
          value,
          expiresAt: Date.now() + BIND_INFO_REMOTE_CACHE_MS,
          localFingerprint
        };
      }
      return value;
    } catch (error) {
      // Fall back to local binding cache when the deployed backend is older.
      return null;
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
  const device = await bindRingDevice(params);
  clearRemoteBindInfoCache();
  return device;
};

export const unbind = async (params: { mac: string }, _config: HttpRequestConfigCompat = {}) => {
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
  if (remote) {
    return remote;
  }

  const local = await getBoundRingDevice();
  if (!hasBoundRingIdentity(local)) {
    await clearBoundRingDevice();
    return null;
  }
  return local;
};

export const scan = async (params: { sn: string }, _config: HttpRequestConfigCompat = {}): Promise<DeviceInfo> => {
  return {
    sn: params.sn,
    mac: params.sn,
    deviceId: params.sn,
    deviceName: params.sn,
    name: params.sn
  };
};

export const deviceModelList = async (_params = {}, _config: HttpRequestConfigCompat = {}): Promise<DeviceModel[]> => {
  return [];
};

export const getInfo = async (_params = {}, _config: HttpRequestConfigCompat = {}): Promise<DeviceInfo | null> => {
  return getBoundRingDevice();
};

export interface OtaInfoParams {
  currentVersion: string;
  deviceModel?: string;
}

export interface OtaPackageInfo extends DeviceInfo {
  currentVersion: string;
  deviceModel?: string;
  hasUpdate: boolean;
  version?: string;
  firmwareVersion?: string;
  firmwareUrl?: string;
  url?: string;
  size?: number;
  md5?: string;
  remark?: string;
}

export interface OtaInfoResponse {
  code: number;
  data: OtaPackageInfo | null;
  msg: string;
  message: string;
}

export const getOtaInfo = async (
  params: OtaInfoParams,
  config: HttpRequestConfigCompat = {}
): Promise<OtaPackageInfo | OtaInfoResponse> => {
  const packageInfo: OtaPackageInfo = {
    currentVersion: params.currentVersion,
    deviceModel: params.deviceModel,
    hasUpdate: false
  };

  if (config?.custom?.returnAll) {
    return {
      code: 204,
      data: null,
      msg: 'No OTA update available',
      message: 'No OTA update available'
    };
  }

  return packageInfo;
};
