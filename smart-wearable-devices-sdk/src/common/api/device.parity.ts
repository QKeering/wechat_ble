const storage = new Map<string, unknown>();
let remoteCurrentDeviceCalls = 0;
const getRemoteCurrentDeviceCalls = () => remoteCurrentDeviceCalls;

(globalThis as any).uni = {
  getSystemInfoSync: () => ({
    platform: 'android',
    system: 'Android 14',
    uniPlatform: 'mp-weixin'
  }),
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => {
    storage.set(key, value);
  },
  removeStorageSync: (key: string) => {
    storage.delete(key);
  },
  onBLEConnectionStateChange: () => undefined,
  offBLEConnectionStateChange: () => undefined,
  $uv: {
    http: {
      get: async (url: string) => {
        if (url !== '/app/device/current') {
          throw new Error(`Unexpected device API URL: ${url}`);
        }
        remoteCurrentDeviceCalls += 1;
        return storage.get('qkeer:bound-ring-device');
      }
    }
  }
};

const { bind, deviceModelList, getBindInfo, getInfo, getOtaInfo, scan, unbind } = await import('./device');

await bind({
  mac: 'AA:BB:CC:DD:EE:FF',
  deviceId: '3E:00:00:00:05:1B',
  serviceId: 'service-id',
  cmdCharId: 'write-id',
  dataCharId: 'notify-id',
  dataServiceId: 'notify-service-id',
  deviceName: 'ring',
  protocol: 'rw',
  advertis: { macInfo: '00:05:1B' }
});
const boundInfo = await getBindInfo();
if (
  boundInfo?.protocol !== 'rw' ||
  boundInfo.cmdCharId !== 'write-id' ||
  boundInfo.dataCharId !== 'notify-id' ||
  boundInfo.advertis?.macInfo !== '00:05:1B'
) {
  throw new Error(`Legacy device API should preserve full ring SDK binding metadata: ${JSON.stringify(boundInfo)}`);
}
const cachedBoundInfo = await getBindInfo();
if (getRemoteCurrentDeviceCalls() !== 1 || cachedBoundInfo?.deviceId !== boundInfo.deviceId) {
  throw new Error(`Legacy device API should dedupe short-lived /app/device/current reads: ${JSON.stringify({
    remoteCurrentDeviceCalls: getRemoteCurrentDeviceCalls(),
    cachedBoundInfo
  })}`);
}
await unbind({ mac: 'AA:BB:CC:DD:EE:FF' });
storage.set('qkeer:bound-ring-device', {
  protocol: 'rw',
  advertis: {
    macInfo: '3E:00:00:00:05:1B'
  },
  name: 'SY03'
});
const advertisOnlyBoundInfo = await getBindInfo();
if (advertisOnlyBoundInfo?.advertis?.macInfo !== '3E:00:00:00:05:1B') {
  throw new Error(`Legacy device API should keep RW bindings identified only by advertis macInfo: ${JSON.stringify(advertisOnlyBoundInfo)}`);
}
if (getRemoteCurrentDeviceCalls() !== 2) {
  throw new Error(`Legacy device API should invalidate the current-device cache after unbind: ${getRemoteCurrentDeviceCalls()}`);
}

storage.set('qkeer:bound-ring-device', {
  protocol: 'rw',
  deviceId: 'wechat-random-platform-id',
  uniMacId: 'ios-random-uni-id',
  name: 'SY03'
});
const randomOnlyRwBoundInfo = await getBindInfo();
if (randomOnlyRwBoundInfo !== null || storage.get('qkeer:bound-ring-device') !== null) {
  throw new Error(`Legacy device API should clear RW bindings that only contain random platform identities: ${JSON.stringify({
    randomOnlyRwBoundInfo,
    stored: storage.get('qkeer:bound-ring-device')
  })}`);
}

await scan({ sn: 'qr-code-or-sn' });
await deviceModelList();
await getInfo();
await getOtaInfo({ currentVersion: '1.0.0' });
await getOtaInfo({ currentVersion: '1.0.0', deviceModel: 'ring' });

async function assertOtaReturnAllShape() {
  const response = await getOtaInfo({ currentVersion: '1.0.0', deviceModel: 'ring' }, { custom: { returnAll: true } });
  if ('code' in response) {
    void response.code;
    void response.data;
    void response.msg;
  }
}

await assertOtaReturnAllShape();

export const deviceApiParityPassed = true;
