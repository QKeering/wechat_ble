import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const mpWeixinDist = join(process.cwd(), 'dist', 'build', 'mp-weixin');

if (existsSync(mpWeixinDist)) {
  try {
    rmSync(mpWeixinDist, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    console.warn(`Warning: could not remove locked mp-weixin dist, build will overwrite and artifact verification will catch stale files: ${mpWeixinDist}`);
  }
}
