const storage = new Map<string, unknown>();

(globalThis as any).uni = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => {
    storage.set(key, value);
  }
};

const { clearFrontendRingBindingState, getBoundRingIdentity, getBoundRingIdentityTail, hasBoundRingIdentity } = await import('./ringBinding');

if (!hasBoundRingIdentity({ advertis: { macInfo: '3E:00:00:00:05:1B' }, protocol: 'rw' })) {
  throw new Error('RW bound device should be recognized by advertis macInfo.');
}

if (
  !hasBoundRingIdentity({ deviceId: 'ios-random-id' }) ||
  !hasBoundRingIdentity({ mac: '3E:00:00:00:05:1B' }) ||
  !hasBoundRingIdentity({ uniMacId: '3E:00:00:00:05:1B' }) ||
  hasBoundRingIdentity({ protocol: 'rw', deviceId: 'ios-random-id', uniMacId: 'ios-random-uni-id' }) ||
  hasBoundRingIdentity(null) ||
  hasBoundRingIdentity({})
) {
  throw new Error('Bound ring identity detection should match every supported stored identity shape.');
}

if (
  getBoundRingIdentity({ protocol: 'rw', advertis: { macInfo: '3E:00:00:00:05:1B' }, uniMacId: 'B09FBA121E1C' }) !==
    '3E:00:00:00:05:1B' ||
  getBoundRingIdentityTail({ protocol: 'rw', advertis: { macInfo: '3E:00:00:00:05:1B' } }) !== '00:05:1B' ||
  getBoundRingIdentity({ protocol: 'rw', deviceId: 'wechat-random-id', uniMacId: 'B09FBA121E1C' }) !== '' ||
  getBoundRingIdentityTail({ protocol: 'rw', deviceId: 'wechat-random-id', uniMacId: 'B09FBA121E1C' }) !== '-' ||
  getBoundRingIdentity({ protocol: 'qkeer-v2', deviceId: 'l19-device-id', uniMacId: 'legacy-id' }) !== 'l19-device-id'
) {
  throw new Error('Bound ring display identity should preserve L19 fallbacks while hiding random RW identifiers.');
}

storage.set('qkeer:bound-ring-device', {
  advertis: { macInfo: '3E:00:00:00:05:1B' },
  protocol: 'rw'
});

const state: Record<string, unknown> = {};
const calls: string[] = [];
const businessState: Record<string, unknown> = {};
const businessCalls: string[] = [];
const store = {
  clearRuntime: () => calls.push('clearRuntime'),
  updateDeviceInfo: (value: unknown) => {
    state.deviceInfo = value;
  },
  updateReceivedData: (value: unknown) => {
    state.receivedData = value;
  },
  updateNormalMac: (value: unknown) => {
    state.normalMac = value;
  },
  updateIosMacId: (value: unknown) => {
    state.iosMacId = value;
  },
  updateIsConnected: (value: unknown) => {
    state.isConnected = value;
  },
  updateReconnectingStatus: (value: unknown) => {
    state.reconnectingStatus = value;
  },
  updateReconnectResult: (value: unknown) => {
    state.reconnectResult = value;
  }
};
const businessStore = {
  setBoundDevice: (value: unknown) => {
    businessState.boundDevice = value;
  },
  clearRuntime: () => businessCalls.push('clearRuntime')
};

await clearFrontendRingBindingState(store, businessStore);

if (storage.get('qkeer:bound-ring-device') !== null) {
  throw new Error('Clearing frontend ring state should also clear the stored bound ring device.');
}

if (
  calls[0] !== 'clearRuntime' ||
  JSON.stringify(state.deviceInfo) !== '{}' ||
  JSON.stringify(state.receivedData) !== '[]' ||
  state.normalMac !== '' ||
  state.iosMacId !== '' ||
  state.isConnected !== false ||
  state.reconnectingStatus !== '0' ||
  state.reconnectResult !== null ||
  businessState.boundDevice !== null ||
  businessCalls[0] !== 'clearRuntime'
) {
  throw new Error(`Frontend ring state should reset all runtime binding fields: ${JSON.stringify({ calls, state, businessCalls, businessState })}`);
}

export {};
