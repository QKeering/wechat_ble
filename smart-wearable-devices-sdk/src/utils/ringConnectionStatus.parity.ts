import {
  hasAnyRingCommunicationReady,
  hasRingCommunicationReady,
  isRingConnectionActive,
  isRingConnectionConnecting
} from './ringConnectionStatus';

const readyDevice = {
  deviceId: 'platform-device-id',
  serviceId: 'service-id',
  cmdCharId: 'cmd-char-id',
  dataCharId: 'data-char-id',
  notifyEnabled: true
};

const persistedDiscoveryOnlyDevice = {
  deviceId: 'platform-device-id',
  serviceId: 'cached-service-id',
  cmdCharId: 'cached-cmd-char-id',
  dataCharId: 'cached-data-char-id'
};

if (
  !hasRingCommunicationReady(readyDevice) ||
  hasRingCommunicationReady({ deviceId: 'platform-device-id' }) ||
  hasRingCommunicationReady(persistedDiscoveryOnlyDevice)
) {
  throw new Error('Ring connection status helper should require a live Notify session before reporting ready.');
}

if (!hasAnyRingCommunicationReady({ deviceId: 'missing-fields' }, readyDevice)) {
  throw new Error('Ring connection status helper should accept any ready device snapshot from SDK/store/page state.');
}

if (
  !isRingConnectionActive({ ready: true }) ||
  !isRingConnectionActive({ connected: true }) ||
  !isRingConnectionActive({ reconnectStatus: 'success' }) ||
  !isRingConnectionActive({ reconnectStatus: '2' })
) {
  throw new Error('Ring connection status helper should normalize ready, connected, and reconnect success states.');
}

if (
  !isRingConnectionConnecting({ reconnectStatus: 'reconnecting' }) ||
  !isRingConnectionConnecting({ reconnectStatus: '1' }) ||
  !isRingConnectionConnecting({ isReconnecting: true }) ||
  isRingConnectionConnecting({ ready: true, reconnectStatus: '1' }) ||
  isRingConnectionConnecting({ connected: true, reconnectStatus: '1' })
) {
  throw new Error('Ring connection status helper should normalize reconnecting states without overriding active connections.');
}

export const ringConnectionStatusParityPassed = true;
