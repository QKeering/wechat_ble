import onSyncStepInfo from './vendor/receiver/on_syncStepInfo.js';
import onSyncStepListInfo from './vendor/receiver/on_syncStepListInfo.js';
import onSyncSleepInfo from './vendor/receiver/on_syncSleepInfo.js';
import onSyncSleepListInfo from './vendor/receiver/on_syncSleepListInfo.js';
import bleManager from './vendor/common/ble_manager.js';
import { createQkeerV2RingAdapter } from './adapter';

const createStepBuffer = (timestamp: number, step: number) => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, timestamp, true);
  view.setUint32(4, step, true);
  return buffer;
};

const createSleepBuffer = (timestamp: number, durationMinutes: number) => {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint8(0, 0);
  view.setUint32(1, timestamp, true);
  view.setUint8(5, 2);
  view.setUint16(6, durationMinutes, true);
  return buffer;
};

const timestamp = 1710000000;
const step = 300;
const durationMinutes = 480;

const runWithoutVendorLogs = <T>(task: () => T) => {
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    return task();
  } finally {
    console.log = originalLog;
  }
};

const single = runWithoutVendorLogs(() => onSyncStepInfo(createStepBuffer(timestamp, step), 1, 0));
if (single?.timestamp !== timestamp || single?.step !== step) {
  throw new Error(`QKeer V2 single step parser should use little-endian fields: ${JSON.stringify(single)}`);
}

const list = runWithoutVendorLogs(() => onSyncStepListInfo(createStepBuffer(timestamp, step), 1, 0));
if (!Array.isArray(list) || list[0]?.timestamp !== timestamp || list[0]?.step !== step) {
  throw new Error(`QKeer V2 step list parser should use little-endian fields: ${JSON.stringify(list)}`);
}

const sleep = runWithoutVendorLogs(() => onSyncSleepInfo(createSleepBuffer(timestamp, durationMinutes), 1, 0));
if (sleep?.timestamp !== timestamp || sleep?.timeLen !== durationMinutes || sleep?.status !== 2) {
  throw new Error(`QKeer V2 single sleep parser should use little-endian fields: ${JSON.stringify(sleep)}`);
}

const sleepList = runWithoutVendorLogs(() => onSyncSleepListInfo(createSleepBuffer(timestamp, durationMinutes), 1, 0));
if (!Array.isArray(sleepList) || sleepList[0]?.timestamp !== timestamp || sleepList[0]?.timeLen !== durationMinutes) {
  throw new Error(`QKeer V2 sleep list parser should use little-endian duration: ${JSON.stringify(sleepList)}`);
}

const closedDeviceIds: string[] = [];
(globalThis as any).uni = {
  onBluetoothDeviceFound: () => undefined,
  offBluetoothDeviceFound: () => undefined,
  onBLEConnectionStateChange: () => undefined,
  offBLEConnectionStateChange: () => undefined,
  closeBLEConnection: ({
    deviceId,
    success
  }: {
    deviceId: string;
    success: (result: unknown) => void;
    fail: (error: unknown) => void;
  }) => {
    closedDeviceIds.push(deviceId);
    bleManager.connectedDeviceId = '';
    success({});
  }
};

const expectRejectedWithMessage = async (promise: Promise<unknown>, expected: string) => {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`;
    if (message === expected) return;
    throw new Error(`Expected QKeer V2 waiter rejection "${expected}", got "${message}"`);
  }

  throw new Error(`Expected QKeer V2 waiter rejection "${expected}"`);
};

const qkeerAdapter = createQkeerV2RingAdapter({
  devices: { value: [] as any[] },
  isScanning: { value: false }
} as any);

bleManager.connectedDeviceId = 'qkeer-v2-device';
const disconnectWait = qkeerAdapter.waitForParsedData(() => false, 1000);
await qkeerAdapter.disconnect();
await expectRejectedWithMessage(disconnectWait, 'QKeer V2 data listener was cleared.');

if (closedDeviceIds[0] !== 'qkeer-v2-device') {
  throw new Error(`QKeer V2 disconnect should still close the active BLE device: ${JSON.stringify(closedDeviceIds)}`);
}

const listenerWait = qkeerAdapter.waitForParsedData(() => false, 1000);
qkeerAdapter.clearDataListener();
await expectRejectedWithMessage(listenerWait, 'QKeer V2 data listener was cleared.');

export {};
