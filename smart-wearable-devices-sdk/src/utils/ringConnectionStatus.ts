type LegacyReconnectStatus = '0' | '1' | '2' | 'idle' | 'reconnecting' | 'success' | string | null | undefined;

interface RingConnectionStatusInput {
  ready?: boolean;
  deviceInfo?: unknown;
  devices?: unknown[];
  connected?: boolean | null;
  reconnectStatus?: LegacyReconnectStatus;
  isReconnecting?: boolean | null;
}

export const hasRingCommunicationReady = (device: unknown) => {
  const value = (device || {}) as Record<string, unknown>;
  return Boolean(value.deviceId && value.serviceId && value.cmdCharId && value.dataCharId);
};

export const hasAnyRingCommunicationReady = (...devices: unknown[]) =>
  devices.some((device) => hasRingCommunicationReady(device));

const normalizeReconnectStatus = (status: LegacyReconnectStatus) => {
  if (status === '0') return 'idle';
  if (status === '1') return 'reconnecting';
  if (status === '2') return 'success';
  return status || 'idle';
};

const hasInputReadyDevice = (input: RingConnectionStatusInput) => {
  if (input.ready === true) return true;
  if (hasRingCommunicationReady(input.deviceInfo)) return true;
  return Array.isArray(input.devices) && hasAnyRingCommunicationReady(...input.devices);
};

export const isRingConnectionActive = (input: RingConnectionStatusInput) =>
  hasInputReadyDevice(input) || input.connected === true || normalizeReconnectStatus(input.reconnectStatus) === 'success';

export const isRingConnectionConnecting = (input: RingConnectionStatusInput) =>
  !isRingConnectionActive(input) &&
  (input.isReconnecting === true || normalizeReconnectStatus(input.reconnectStatus) === 'reconnecting');
