const fallbackBuildInfo: QKeerBuildInfo = {
  appVersion: 'unknown',
  versionCode: 'unknown',
  gitCommit: 'unknown',
  gitBranch: 'unknown',
  buildTime: 'unknown',
  buildId: 'unknown'
};

export const QKEER_BUILD_INFO: Readonly<QKeerBuildInfo> = Object.freeze(
  typeof __QKEER_BUILD_INFO__ === 'undefined'
    ? fallbackBuildInfo
    : __QKEER_BUILD_INFO__
);

export const QKEER_BUILD_TAG = QKEER_BUILD_INFO.buildId;
