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
  // service/characteristic UUIDs are persisted by the backend so the next
  // connection can reuse discovery metadata. They are not proof that the
  // current mini-program process owns a live GATT/Notify session. All current
  // adapters set notifyEnabled only after Notify is enabled successfully.
  return Boolean(
    value.deviceId &&
      value.serviceId &&
      value.cmdCharId &&
      value.dataCharId &&
      value.notifyEnabled === true
  );
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
