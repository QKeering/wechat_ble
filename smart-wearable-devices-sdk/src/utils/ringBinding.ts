import { clearBoundRingDevice } from '@/api/ringDevice';

type BoundRingIdentity = {
  deviceId?: string;
  mac?: string;
  uniMacId?: string;
  protocol?: string;
  advertis?: {
    macInfo?: string;
  };
};

export const hasBoundRingIdentity = (device: BoundRingIdentity | null | undefined) =>
  Boolean(
    device?.protocol === 'rw'
      ? device.mac || device.advertis?.macInfo || isColonSeparatedBleMac(device.uniMacId) || isColonSeparatedBleMac(device.deviceId)
      : device?.deviceId || device?.mac || device?.uniMacId || device?.advertis?.macInfo
  );

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

export const getBoundRingIdentity = (device: BoundRingIdentity | null | undefined) => {
  if (!device) return '';
  if (device.mac) return device.mac;
  if (device.advertis?.macInfo) return device.advertis.macInfo;

  if (device.protocol === 'rw') {
    if (isColonSeparatedBleMac(device.uniMacId)) return device.uniMacId;
    if (isColonSeparatedBleMac(device.deviceId)) return device.deviceId;
    return '';
  }

  return `${device.deviceId || device.uniMacId || ''}`.trim();
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
