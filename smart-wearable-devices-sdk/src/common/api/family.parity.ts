const posts: Array<{ url: string; params: Record<string, any>; config: Record<string, any> }> = [];

(globalThis as any).uni = {
  $uv: {
    http: {
      post: async (url: string, params: Record<string, any>, config: Record<string, any> = {}) => {
        posts.push({ url, params, config });
        return { id: 1, name: 'member', relation: 'other', deviceMac: params.mac };
      },
      get: async () => []
    }
  }
};

const { bindFamilyDevice } = await import('./family');

await bindFamilyDevice(
  {
    memberId: 1,
    mac: '',
    deviceId: 'rw-random-platform-id',
    protocol: 'rw',
    advertis: {
      macInfo: '3E:00:00:00:05:1B'
    },
    deviceName: 'SY03'
  },
  { custom: { auth: true } }
);

const rwAdvertisPost = posts.at(-1);
if (
  rwAdvertisPost?.url !== '/app/family/device/bind' ||
  rwAdvertisPost.params.mac !== '3E:00:00:00:05:1B' ||
  rwAdvertisPost.params.deviceId !== 'rw-random-platform-id' ||
  rwAdvertisPost.config.custom?.auth !== true
) {
  throw new Error(`Family RW binding should submit advertis macInfo as stable mac without losing platform deviceId: ${JSON.stringify(rwAdvertisPost)}`);
}

await bindFamilyDevice({
  memberId: 1,
  mac: '',
  deviceId: 'rw-random-platform-id',
  uniMacId: '3E:00:00:00:05:2A',
  protocol: 'rw'
});

const rwUniMacPost = posts.at(-1);
if (rwUniMacPost?.params.mac !== '3E:00:00:00:05:2A') {
  throw new Error(`Family RW binding should fall back to colon-separated uniMacId as stable mac: ${JSON.stringify(rwUniMacPost)}`);
}

await bindFamilyDevice({
  memberId: 1,
  mac: '',
  deviceId: 'legacy-platform-id',
  uniMacId: 'AA:BB:CC:DD:EE:FF',
  protocol: 'qkeer-v2'
});

const legacyPost = posts.at(-1);
if (legacyPost?.params.mac !== '') {
  throw new Error(`Family legacy/L19 binding payload should not be rewritten by RW stable-mac fallback: ${JSON.stringify(legacyPost)}`);
}

export {};
