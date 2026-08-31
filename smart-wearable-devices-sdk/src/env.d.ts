/// <reference types="vite/client" />

declare module '*.vue' {
  import { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_ERROR_TOAST_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface QKeerBuildInfo {
  appVersion: string;
  versionCode: string;
  gitCommit: string;
  gitBranch: string;
  gitDirty: boolean;
  workspaceDigest: string;
  buildTime: string;
  buildId: string;
}

declare const __QKEER_BUILD_INFO__: QKeerBuildInfo;
