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

export const hasBoundRingIdentity = (device: BoundRingIdentity | null | undefined) =>
  Boolean(
    getBoundRingMacCandidate(device) ||
      isColonSeparatedBleMac(getBoundRingUniMacIdCandidate(device))
  );

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

export const getBoundRingIdentity = (device: BoundRingIdentity | null | undefined) => {
  if (!device) return '';
  const mac = getBoundRingMacCandidate(device);
  if (mac) return mac;

  const uniMacId = getBoundRingUniMacIdCandidate(device);
  if (isColonSeparatedBleMac(uniMacId)) return uniMacId;
  return '';
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
