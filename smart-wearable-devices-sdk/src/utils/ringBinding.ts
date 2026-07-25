import { clearBoundRingDevice } from '@/api/ringDevice';

type BoundRingIdentity = {
  deviceId?: string;
  mac?: string;
  uniMacId?: string;
  protocol?: string;
  advertis?: {
    macInfo?: string;
  };
  [key: string]: any;
};

const normalizeFieldName = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const getField = (source: Record<string, any> | null | undefined, ...keys: string[]) => {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return `${source[key] || ''}`.trim();
    }
  }
  const entries = Object.keys(source).map((key) => [normalizeFieldName(key), source[key]] as const);
  for (const key of keys) {
    const matched = entries.find(([name]) => name === normalizeFieldName(key));
    if (matched) return `${matched[1] || ''}`.trim();
  }
  return '';
};

const getBoundRingMacCandidate = (device: BoundRingIdentity | null | undefined) =>
  getField(device, 'mac', 'macAddress', 'deviceMac', 'bluetoothMac', 'bleMac', 'macAddr', 'mac_addr') ||
  getField(device?.advertis, 'macInfo', 'mac', 'macAddress', 'deviceMac', 'bluetoothMac', 'bleMac', 'macAddr', 'mac_addr');

const getBoundRingUniMacIdCandidate = (device: BoundRingIdentity | null | undefined) =>
  getField(device, 'uniMacId', 'uni_mac_id', 'macId', 'mac_id') || getField(device?.advertis, 'uniMacId', 'uni_mac_id');

const getBoundRingDeviceIdCandidate = (device: BoundRingIdentity | null | undefined) =>
  getField(
    device,
    'deviceId',
    'device_id',
    'bleDeviceId',
    'ble_device_id',
    'bluetoothDeviceId',
    'bluetooth_device_id',
    'platformDeviceId',
    'platform_device_id',
    'wxDeviceId',
    'wx_device_id'
  );

export const hasBoundRingIdentity = (device: BoundRingIdentity | null | undefined) =>
  Boolean(
    device?.protocol === 'rw'
      ? getBoundRingMacCandidate(device) ||
          isColonSeparatedBleMac(getBoundRingUniMacIdCandidate(device)) ||
          isColonSeparatedBleMac(getBoundRingDeviceIdCandidate(device))
      : getBoundRingDeviceIdCandidate(device) || getBoundRingMacCandidate(device) || getBoundRingUniMacIdCandidate(device)
  );

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

export const getBoundRingIdentity = (device: BoundRingIdentity | null | undefined) => {
  if (!device) return '';
  const mac = getBoundRingMacCandidate(device);
  if (mac) return mac;

  if (device.protocol === 'rw') {
    const uniMacId = getBoundRingUniMacIdCandidate(device);
    const deviceId = getBoundRingDeviceIdCandidate(device);
    if (isColonSeparatedBleMac(uniMacId)) return uniMacId;
    if (isColonSeparatedBleMac(deviceId)) return deviceId;
    return '';
  }

  return getBoundRingDeviceIdCandidate(device) || getBoundRingUniMacIdCandidate(device);
};

export const getBoundRingIdentityTail = (device: BoundRingIdentity | null | undefined) => {
  const identity = getBoundRingIdentity(device);
  if (!identity) return '-';
  return identity.length <= 8 ? identity : identity.slice(-8);
};

export const clearFrontendRingBindingState = async (store: Record<string, any>, businessStore?: Record<string, any>) => {
  await clearBoundRingDevice();
  store.clearRuntime?.();
  store.updateDeviceInfo?.({});
  store.updateReceivedData?.([]);
  store.updateNormalMac?.('');
  store.updateIosMacId?.('');
  store.updateIsConnected?.(false);
  store.updateReconnectingStatus?.('0');
  store.updateReconnectResult?.(null);
  businessStore?.setBoundDevice?.(null);
  businessStore?.clearRuntime?.();
};
