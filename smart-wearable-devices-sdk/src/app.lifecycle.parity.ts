import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appVue = readFileSync(join(process.cwd(), 'src', 'App.vue'), 'utf8');

const requiredSnippets = [
  "import { useRingBLE } from '@/composables/useRingBLE'",
  "import { useRingBusinessController } from '@/composables/useRingBusinessController'",
  "import { useUserStore } from '@/stores/user'",
  'const { initBluetooth, registerGlobalListeners } = useRingBLE()',
  'const { resumeBusinessAutoRefresh, restoreLastBusinessDevice } = useRingBusinessController()',
  'Promise.resolve(initBluetooth())',
  'resumeBusinessAutoRefresh()',
  'return restoreLastBusinessDevice({ refreshAfterRestore: false })',
  'await registerGlobalListeners()',
  'const { pauseBusinessAutoRefresh } = useRingBusinessController()',
  'pauseBusinessAutoRefresh()',
  'userStore.updateIsBluetoothReady(false)'
];

for (const snippet of requiredSnippets) {
  if (!appVue.includes(snippet)) {
    throw new Error(`App lifecycle should keep BLE compatibility behavior: ${snippet}`);
  }
}

const assertBefore = (first: string, second: string, message: string) => {
  const firstIndex = appVue.indexOf(first);
  const secondIndex = appVue.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    throw new Error(message);
  }
};

assertBefore(
  'Promise.resolve(initBluetooth())',
  'await registerGlobalListeners()',
  'App foreground restore should initialize Bluetooth before registering global BLE listeners.'
);
assertBefore(
  'await registerGlobalListeners()',
  'resumeBusinessAutoRefresh()',
  'App foreground restore should register BLE listeners before resuming RW/SY03 business refresh.'
);
assertBefore(
  'resumeBusinessAutoRefresh()',
  'return restoreLastBusinessDevice({ refreshAfterRestore: false })',
  'App foreground restore should resume business refresh before restoring the last RW/SY03 device.'
);
assertBefore(
  'pauseBusinessAutoRefresh()',
  'userStore.updateIsBluetoothReady(false)',
  'App background handling should pause RW/SY03 business refresh before clearing Bluetooth readiness.'
);

for (const snippet of ['console.log', 'console.warn', '[next]']) {
  if (appVue.includes(snippet)) {
    throw new Error(`App lifecycle should not ship development logging: ${snippet}`);
  }
}
