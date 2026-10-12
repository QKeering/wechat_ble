#!/usr/bin/env node
/**
 * 用**真的** legacy adapter 验两件真机上出过事的行为：
 *
 * 1. 业务扫描的过滤范围。`includeUnknown: true` 只应放宽到「协议已识别成 rw / qkeer-v2
 *    的跨协议候选」，而不是「附近所有蓝牙设备」。后者会让 `state.devices` 涨到 252 台
 *    （真机日志里 `EDIFIER BLE` / `LAPTOP-BQ7R2O3M` / 随机 base64 名字都在列表里），
 *    每一包广播都要在 252 行的表上合并一遍，逻辑层被占住 10 秒 —— 期间点击连接 / 取消 /
 *    导航栏返回全部排队。
 *
 * 2. 设备广播的合并节流。`allowDuplicatesKey: true` 时平台把每一包广播都回调一次
 *    （实测约 400 条/秒），必须攒起来合并，否则逻辑层排不完。
 *
 * 这两条都属于「改了不知道对不对」的那类：过滤条件放宽一点就漏戒指，收紧一点就断
 * 跨协议；节流写错就会丢最后一批设备。所以用真 adapter 跑一遍，而不是读代码判断。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const outdir = join(process.cwd(), 'node_modules', '.cache', 'legacy-scan-verify');
const outfile = join(outdir, 'adapter.mjs');

await esbuild.build({
  entryPoints: [join(process.cwd(), 'src', 'sdk', 'ring-ble', 'legacy', 'adapter.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': join(process.cwd(), 'src') },
  logLevel: 'error'
});

// ---- uni 桩：只提供 adapter 扫描路径真的会碰的那几个 API --------------------
let deviceFoundCallback = null;
globalThis.uni = {
  getSystemInfoSync: () => ({ platform: 'android' }),
  onBluetoothDeviceFound: (callback) => {
    deviceFoundCallback = callback;
  },
  offBluetoothDeviceFound: () => {
    deviceFoundCallback = null;
  },
  startBluetoothDevicesDiscovery: ({ success }) => setTimeout(() => success?.({}), 0),
  stopBluetoothDevicesDiscovery: ({ success }) => setTimeout(() => success?.({}), 0),
  getBluetoothDevices: ({ success }) => success?.({ devices: [] }),
  getStorageSync: () => undefined,
  setStorage: () => undefined,
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined,
  onBluetoothAdapterStateChange: () => undefined
};

const { createLegacyRingAdapter } = await import(pathToFileURL(outfile).href);

const state = { devices: { value: [] }, isScanning: { value: false } };
const adapter = createLegacyRingAdapter(state);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const names = () => state.devices.value.map((device) => device.name).sort();

// 真机日志里真实出现过的杂项设备。
const junkDevices = [
  { deviceId: 'j1', name: 'EDIFIER BLE', localName: 'EDIFIER BLE', advertisData: new Uint8Array([1, 2, 3]), RSSI: -70 },
  { deviceId: 'j2', name: 'LAPTOP-BQ7R2O3M', localName: 'LAPTOP-BQ7R2O3M', advertisData: new Uint8Array([4, 5, 6]), RSSI: -60 },
  { deviceId: 'j3', name: 'NGNZg4+trA2cZlE6bhWbXBtN8', localName: 'NGNZg4+trA2cZlE6bhWbXBtN8', advertisData: new Uint8Array([7, 8, 9]), RSSI: -80 }
];
const legacyRing = { deviceId: 'r1', name: 'HR18', localName: 'HR18', advertisData: new Uint8Array([10, 11, 12]), RSSI: -55 };
const rwRing = { deviceId: 'r2', name: 'SY03', localName: 'SY03', advertisData: new Uint8Array([13, 14, 15]), RSSI: -50 };
const v2Ring = { deviceId: 'r3', name: 'MUSLEEP_RING01', localName: 'MUSLEEP_RING01', advertisData: new Uint8Array([16, 17, 18]), RSSI: -52 };

const failures = [];
const check = (label, passed, detail) => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!passed) failures.push(label);
};

// ---- 1. 业务扫描只收戒指，杂项设备全部挡掉 ----------------------------------
await adapter.startScan({ includeUnknown: true, allowDuplicatesKey: true, preserveDevices: false, timeoutMs: 30000 });
check('扫描已启动', state.isScanning.value === true);

deviceFoundCallback({ devices: junkDevices });
deviceFoundCallback({ devices: [legacyRing, rwRing, v2Ring] });
check('合并前不写列表（先攒在缓冲里）', state.devices.value.length === 0, `listed=${state.devices.value.length}`);

await sleep(400); // > SCAN_EVENT_MERGE_INTERVAL_MS
const businessNames = names();
check(
  '杂项设备被挡掉',
  businessNames.every((name) => !['EDIFIER BLE', 'LAPTOP-BQ7R2O3M', 'NGNZg4+trA2cZlE6bhWbXBtN8'].includes(name)),
  JSON.stringify(businessNames)
);
check('legacy 戒指保留（HR 前缀）', businessNames.includes('HR18'), JSON.stringify(businessNames));
check('rw 戒指保留（跨协议）', businessNames.includes('SY03'), JSON.stringify(businessNames));
check('qkeer-v2 戒指保留（跨协议）', businessNames.includes('MUSLEEP_RING01'), JSON.stringify(businessNames));

// ---- 2. 400 条/秒的广播只触发一次合并 --------------------------------------
const startedAt = process.hrtime.bigint();
for (let index = 0; index < 400; index += 1) {
  deviceFoundCallback({ devices: [legacyRing, { ...rwRing, RSSI: -50 - (index % 20) }] });
}
const enqueueMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
check('400 条广播的入队开销 < 20ms', enqueueMs < 20, `${enqueueMs.toFixed(2)}ms`);
check('入队期间不做整表合并', state.devices.value.length === businessNames.length, `listed=${state.devices.value.length}`);

await sleep(400);
check('节流窗口过后列表仍然正确', state.devices.value.length === 3, `listed=${state.devices.value.length}`);

// ---- 3. stopScan 前先合并窗口内的广播，不丢设备 ----------------------------
deviceFoundCallback({
  devices: [{ deviceId: 'r4', name: 'QKeeRingL19', localName: 'QKeeRingL19', advertisData: new Uint8Array([19]), RSSI: -40 }]
});
await adapter.stopScan();
check('stopScan 已停', state.isScanning.value === false);
check('stopScan 前合并了窗口内的新设备', names().includes('QKeeRingL19'), JSON.stringify(names()));

// ---- 4. 停扫描后不再收广播 -------------------------------------------------
const afterStopCount = state.devices.value.length;
check('停扫描后已摘掉 onBluetoothDeviceFound 监听', deviceFoundCallback === null);
await sleep(400);
check('停扫描后列表不再变化', state.devices.value.length === afterStopCount, `listed=${state.devices.value.length}`);

// ---- 5. includeUnknown=false 的旧语义不变 ----------------------------------
await adapter.startScan({ includeUnknown: false, allowDuplicatesKey: true, preserveDevices: false, timeoutMs: 30000 });
deviceFoundCallback({ devices: [junkDevices[0], legacyRing, rwRing] });
await sleep(400);
// 改动前的条件是 `!includeUnknown && protocol === 'legacy' && 名字不匹配前缀` 才过滤，
// 所以协议已识别成 rw 的 SY03 在两种 includeUnknown 下都收 —— 这里必须保持原样，
// 收紧的只有「协议认不出 + 名字也认不出」这一类。
check(
  'includeUnknown=false 行为不变（杂项挡掉、戒指保留）',
  JSON.stringify(names()) === JSON.stringify(['HR18', 'SY03']),
  JSON.stringify(names())
);
await adapter.stopScan();

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILED: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
