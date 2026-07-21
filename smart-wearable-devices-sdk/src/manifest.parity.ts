import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src', 'manifest.json'), 'utf8'));
const weixin = manifest['mp-weixin'] || {};

if (weixin.appid !== 'wx52f427a73d7678cb') {
  throw new Error(`mp-weixin appid should match the existing mini-program appid: ${weixin.appid}`);
}

if (weixin.lazyCodeLoading !== 'requiredComponents') {
  throw new Error(`mp-weixin lazyCodeLoading should be requiredComponents: ${weixin.lazyCodeLoading}`);
}

if (!Array.isArray(weixin.requiredPrivateInfos) || !weixin.requiredPrivateInfos.includes('getLocation')) {
  throw new Error(`mp-weixin requiredPrivateInfos should include getLocation: ${JSON.stringify(weixin.requiredPrivateInfos)}`);
}

const locationDesc = weixin.permission?.['scope.userLocation']?.desc;
if (!locationDesc || typeof locationDesc !== 'string') {
  throw new Error('mp-weixin permission.scope.userLocation.desc is required for BLE scan permission flow.');
}
