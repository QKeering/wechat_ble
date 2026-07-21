import App from './App.vue';
import { createSSRApp } from 'vue';
import * as Pinia from 'pinia';
import uvUI from '@/uni_modules/uv-ui-tools';
import { Request } from '@/utils/request/index.js';
import share from './common/share.js';

export function createApp() {
  const app = createSSRApp(App);
  app.use(Pinia.createPinia());
  app.use(uvUI);
  app.mixin(share);
  Request();

  return {
    app,
    Pinia
  };
}
