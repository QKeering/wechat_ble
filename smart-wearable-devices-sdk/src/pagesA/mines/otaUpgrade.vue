<template>
  <view class="ota-container">
    <view class="card">
      <view class="header">
        <text class="title">系统固件更新</text>
        <text class="version">{{ hasUpgradePackage ? `目标版本: ${otaBaseInfo?.versionCode || ''}` : '当前已是最新版本' }}</text>
      </view>

      <view v-if="hasUpgradePackage || otaState.isUpgrading" class="progress-section">
        <progress :percent="otaState.progress" stroke-width="12" activeColor="#007AFF" border-radius="6" />
        <text class="percent">{{ otaState.progress }}%</text>
      </view>

      <view class="status-box">
        <text class="status-text" :class="{ error: otaState.error, success: otaState.success }">
          {{ otaState.statusText }}
        </text>
      </view>

      <button v-if="hasUpgradePackage" type="primary" :loading="otaState.isUpgrading" :disabled="otaState.isUpgrading" @tap="startOtaProcess">
        {{ otaState.isUpgrading ? '升级中...' : '开始安全升级' }}
      </button>
      <view v-else class="no-upgrade">当前已是最新版本</view>

      <view class="footer-hint">
        <text class="hint-item">● 请保持手机蓝牙开启并靠近设备</text>
        <text class="hint-item">● 升级过程中请勿关闭应用或断开电源</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onUnmounted, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';
import RingOTAManager from '@/composables/ring-ota-manager';
import { useRingBLE } from '@/composables/useRingBLE';
import { getOtaInfo, getBindInfo, reportOtaUpdate } from '@/common/api/device';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';
import { formatBleErrorMessage } from '@/utils/bleError';
const userStore = useUserStore();

// --- 配置常量 ---
const SERVICE_UUID = '5833FF01-9B8B-5191-6142-22A4536EF123';
const UUID_CMD = '5833FF02-9B8B-5191-6142-22A4536EF123';
// const FIRMWARE_URL = encodeURI('https://znzh.ydlweb.com/profile/ota/2026/01/15/2.8.8.3Z3G_20260115171902A002.hex16');
const FIRMWARE_URL = encodeURI('https://znzh.ydlweb.com/profile/ota/2026/03/11/BCL603S1L_2.8.8.6Z3G_20260311140417A001.hex16');
const firmwareUrl = ref('');
// 扫描配置
const SCAN_CONFIG = {
  timeout: 15000, // 单次扫描超时 (ms)
  maxRetries: 5, // 最大重试次数
  retryDelay: 2000, // 重试间隔 (ms)
  appNamePrefixes: ['HR', 'R-03', 'QKeeRing', 'PP'] // APP 模式设备名前缀
};

// --- 状态管理 ---
const otaState = ref({
  isUpgrading: false,
  progress: 0,
  statusText: '准备就绪',
  error: false,
  success: false
});
const otaBaseInfo = ref({});
const bindInfo = ref({});
const hasUpgradePackage = computed(() => Boolean(firmwareUrl.value && otaBaseInfo.value?.fileUrl));
let otaScanDeviceFoundHandler = null;

const clearOtaScanDeviceFoundHandler = () => {
  if (!otaScanDeviceFoundHandler) return;
  uni.offBluetoothDeviceFound(otaScanDeviceFoundHandler);
  otaScanDeviceFoundHandler = null;
};

const pickText = (...values) => {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const pickObjectText = (source, keys) => {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const text = pickText(source[key]);
    if (text) return text;
  }
  return '';
};

const findReceivedMetricText = (...types) => {
  const normalizedTypes = types.map((type) => String(type).toLowerCase());
  for (const item of userStore.receivedData || []) {
    const sourceType = String(item?.type || item?.sourceType || '').toLowerCase();
    if (!normalizedTypes.includes(sourceType)) continue;
    const text = pickText(
      item?.value,
      item?.metrics?.value,
      item?.metrics?.firmwareVersion,
      item?.metrics?.hardwareVersion,
      item?.metrics?.softwareVersion,
      item?.metrics?.uiVersion
    );
    if (text) return text;
  }
  return '';
};

const findReceivedSoftwareVersionText = () => {
  for (const item of userStore.receivedData || []) {
    const sourceType = String(item?.type || item?.sourceType || '').toLowerCase();
    const text = pickText(
      item?.softwareVersion,
      item?.software_version,
      item?.uiVersion,
      item?.ui_version,
      item?.metrics?.softwareVersion,
      item?.metrics?.software_version,
      item?.metrics?.uiVersion,
      item?.metrics?.ui_version,
      item?.parsed?.softwareVersion,
      item?.parsed?.software_version,
      item?.parsed?.uiVersion,
      item?.parsed?.ui_version,
      sourceType === 'softwareversion' || sourceType === 'software_version' || sourceType === 'uiversion' || sourceType === 'ui_version'
        ? item?.value ?? item?.metrics?.value ?? item?.parsed?.value
        : undefined
    );
    if (text) return text;
  }
  return '';
};

const softwareVersionInfo = computed(() =>
  pickText(
    findReceivedSoftwareVersionText(),
    pickObjectText(userStore.latestMetrics, ['softwareVersion', 'software_version', 'uiVersion', 'ui_version']),
    pickObjectText(userStore.healthData, ['softwareVersion', 'software_version', 'uiVersion', 'ui_version']),
    pickObjectText(userStore.deviceInfo, ['softwareVersion', 'software_version', 'uiVersion', 'ui_version']),
    pickObjectText(bindInfo.value, ['softwareVersion', 'software_version', 'uiVersion', 'ui_version'])
  )
);

const legacyOtaVersionInfo = computed(() => {
  return pickText(
    findReceivedMetricText('firmware_version', 'firmwareVersion', 'hardwareVersion', 'hardware_version', 'softwareVersion', 'software_version'),
    pickObjectText(userStore.latestMetrics, [
      'firmwareVersion',
      'hardwareVersion',
      'softwareVersion',
      'uiVersion',
      'versionCode',
      'version'
    ]),
    pickObjectText(userStore.healthData, [
      'firmwareVersion',
      'firmware_version',
      'hardwareVersion',
      'hardware_version',
      'softwareVersion',
      'software_version',
      'uiVersion',
      'ui_version',
      'versionCode',
      'version'
    ]),
    pickObjectText(userStore.deviceInfo, [
      'firmwareVersion',
      'firmware_version',
      'hardwareVersion',
      'hardware_version',
      'softwareVersion',
      'software_version',
      'uiVersion',
      'ui_version',
      'versionCode',
      'version'
    ]),
    pickObjectText(bindInfo.value, [
      'firmwareVersion',
      'firmware_version',
      'hardwareVersion',
      'hardware_version',
      'softwareVersion',
      'software_version',
      'uiVersion',
      'ui_version',
      'versionCode',
      'version'
    ])
  );
});

const versionInfo = computed(() => {
  return pickText(softwareVersionInfo.value, legacyOtaVersionInfo.value);
});

const normalizeKnownOtaDeviceModel = (value) => {
  const raw = pickText(value);
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.startsWith('qkeeringd25')) return 'QKeeRingD25';
  if (normalized.startsWith('qkeeringl19') || normalized.startsWith('qkl19')) return 'QKeeRingL19';
  return '';
};

const deviceModel = computed(() => {
  const explicitModel = pickObjectText(userStore.deviceInfo, [
    'deviceModel',
    'modelKey',
    'model',
    'productId',
    'productCode',
    'modelName'
  ]) || pickObjectText(bindInfo.value, [
    'deviceModel',
    'modelKey',
    'model',
    'productId',
    'productCode',
    'modelName'
  ]);
  if (explicitModel) return explicitModel;

  return normalizeKnownOtaDeviceModel(
    pickObjectText(userStore.deviceInfo, ['name', 'deviceName', 'localName']) ||
      pickObjectText(bindInfo.value, ['name', 'deviceName', 'localName'])
  );
});

const buildFirmwareDownloadUrl = (url) => {
  const rawUrl = pickText(url);
  if (!rawUrl) return '';
  if (/^https?:\/\//i.test(rawUrl)) {
    const rewritten = rawUrl.replace(
      /^(https?:\/\/sh\.qkeering\.com)(\/(?:admin\/files|profile\/ota)\/)/i,
      '$1/api$2'
    );
    return encodeURI(rewritten);
  }

  const apiBase = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
  let path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
  const isProdGateway = /^https:\/\/sh\.qkeering\.com$/i.test(apiBase);
  if (isProdGateway && (path.startsWith('/admin/files/') || path.startsWith('/profile/ota/'))) {
    path = `/api${path}`;
  }

  return encodeURI(`${apiBase}${path}`);
};

// --- 工具方法 ---

/** 清理蓝牙监听器 */
const cleanup = () => {
  // uni.offBLECharacteristicValueChange();
  clearOtaScanDeviceFoundHandler();
  uni.stopBluetoothDevicesDiscovery();
};

/** 下载固件文件 */
const downloadFirmware = (url) => {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'GET',
      responseType: 'text',
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`固件下载失败: HTTP ${res.statusCode}`));
          return;
        }
        const content = typeof res.data === 'string' ? res.data.replace(/^\uFEFF/, '') : '';
        const firstLine = content.split(/\r?\n/, 1)[0]?.trim() || '';
        if (!firstLine.startsWith(':')) {
          appendRingDiagnosticLog('RING OTA', 'ota-firmware-download-invalid-content', {
            url,
            statusCode: res.statusCode,
            contentType: res.header?.['content-type'] || res.header?.['Content-Type'] || '',
            contentLength: content.length,
            contentPrefix: content.slice(0, 32)
          });
          reject(new Error('固件文件内容无效，请检查后台上传路径'));
          return;
        }
        appendRingDiagnosticLog('RING OTA', 'ota-firmware-download-ready', {
          url,
          statusCode: res.statusCode,
          contentLength: content.length,
          firstRecordType: firstLine.slice(7, 9)
        });
        resolve(content);
      },
      fail: () => reject(new Error('网络请求异常'))
    });
  });
};

/** 发送蓝牙命令 */
const sendCommand = (deviceId, data) => {
  return new Promise((resolve, reject) => {
    uni.writeBLECharacteristicValue({
      deviceId,
      serviceId: SERVICE_UUID,
      characteristicId: UUID_CMD,
      value: new Uint8Array(data).buffer,
      success: () => resolve(),
      fail: (err) => {
        console.warn('[BLE] 发送命令失败:', err);
        reject(new Error(`进入升级模式命令发送失败: ${err.errMsg || err.errCode || 'unknown'}`));
      }
    });
  });
};

/**
 * 从广播数据中提取真实 MAC 地址 (iOS 兼容)
 * 广播数据格式示例:
 * - BOOT: 0405150601f005b00000 → 后6字节反序 = B0:05:F0:01:06:15
 * - APP:  11ff140601f005b0     → 后6字节反序 = B0:05:F0:01:06:14
 */
const extractMacFromAdv = (advertisData) => {
  if (!advertisData || !advertisData.byteLength) return null;

  const bytes = new Uint8Array(advertisData);

  // APP 广播的 MAC 位于末尾 6 字节；BOOT 广播会在其后追加 00 00。
  // 逐窗匹配，避免把 BOOT 广播 0405850500F005B00000 错解为
  // 00:00:B0:05:F0:00，正确结果应为 B0:05:F0:00:05:85。
  for (let offset = 0; offset <= bytes.length - 6; offset += 1) {
    const macBytes = Array.from(bytes.slice(offset, offset + 6)).reverse();
    const mac = macBytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
    if (mac.startsWith('B0:05:F0')) {
      return mac;
    }
  }

  return null;
};

/** 断开蓝牙连接 */
const disconnectDevice = (deviceId) => {
  return new Promise((resolve) => {
    if (!deviceId) return resolve();
    uni.closeBLEConnection({
      deviceId,
      complete: () => resolve()
    });
  });
};

/** 连接蓝牙设备 */
const connectDevice = (deviceId) => {
  return new Promise((resolve, reject) => {
    uni.createBLEConnection({
      deviceId,
      timeout: 10000,
      success: () => {
        setTimeout(async () => {
          try {
            await new Promise((res, rej) => {
              uni.getBLEDeviceServices({ deviceId, success: res, fail: rej });
            });
            resolve();
          } catch (e) {
            reject(new Error('获取服务失败'));
          }
        }, 1500);
      },
      fail: (err) => {
        // 已连接也视为成功
        if (err.errCode === 10006 || err.errMsg?.includes('already')) {
          resolve();
        } else {
          reject(new Error(`连接失败: ${err.errMsg || err.errCode}`));
        }
      }
    });
  });
};

/**
 * 计算 MAC 地址偏移
 * @param {string} mac - 原始 MAC 地址
 * @param {number} offset - 偏移量 (+1 或 -1)
 */
const calculateMacOffset = (mac, offset) => {
  const cleanMac = mac.replace(/:/g, '');
  const prefix = cleanMac.slice(0, 10);
  const suffix = cleanMac.slice(10, 12);
  let val = (parseInt(suffix, 16) + offset + 256) % 256;
  const newSuffix = val.toString(16).toUpperCase().padStart(2, '0');
  return (prefix + newSuffix).match(/.{1,2}/g).join(':');
};

/** BOOT MAC = APP MAC + 1 */
const calculateBootMac = (appMac) => calculateMacOffset(appMac, 1);

/** APP MAC = BOOT MAC - 1 */
const calculateAppMac = (bootMac) => calculateMacOffset(bootMac, -1);

/**
 * 通用蓝牙设备扫描连接函数
 * @param {Object} options - 扫描选项
 * @param {string} options.targetMac - 目标 MAC 地址
 * @param {string} options.mode - 'BOOT' | 'APP'
 * @param {boolean} options.rejectOnFail - 失败时是否 reject
 */
const scanAndConnect = ({ targetMac = null, mode = 'BOOT', rejectOnFail = true }) => {
  return new Promise((resolve, reject) => {
    const isBootMode = mode === 'BOOT';
    otaState.value.statusText = isBootMode ? '正在搜索升级设备...' : '正在搜索设备...';

    let found = false;
    let retryCount = 0;

    /** 判断是否为目标设备 */
    const isTargetDevice = (device) => {
      const name = (device.name || device.localName || '').trim();
      const nameUpper = name.toUpperCase();

      if (!isBootMode) {
        // APP 模式：排除 PPLUSOTA，匹配名称前缀
        if (nameUpper === 'PPLUSOTA') return false;
        for (const prefix of SCAN_CONFIG.appNamePrefixes) {
          if (name.startsWith(prefix)) return true;
        }
      }

      // iOS 兼容：从广播数据中提取真实 MAC 地址
      if (targetMac) {
        const advMac = extractMacFromAdv(device.advertisData);
        if (advMac) {
          const targetClean = targetMac.toUpperCase().replace(/:/g, '');
          const advClean = advMac.toUpperCase().replace(/:/g, '');
          if (advClean === targetClean) {
            console.log('[BLE] iOS MAC 匹配:', advMac);
            return true;
          }
        }

        // Android 兼容：直接匹配 deviceId
        const deviceId = (device.deviceId || '').toUpperCase().replace(/:/g, '');
        if (deviceId === targetMac.toUpperCase().replace(/:/g, '')) {
          return true;
        }

        // 指定了真实 BOOT MAC 时必须精确命中，不能被周围其他
        // PPlusOTA 设备抢占。
        return false;
      }

      return isBootMode && nameUpper === 'PPLUSOTA';
    };

    const startScan = () => {
      clearOtaScanDeviceFoundHandler();
      uni.stopBluetoothDevicesDiscovery();

      uni.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: true,
        powerLevel: 'high',
        success: () => {
          console.log(`[BLE] 扫描 ${mode} 设备...`, targetMac ? `目标: ${targetMac}` : '');

          const scanTimeout = setTimeout(() => {
            if (!found) {
              clearOtaScanDeviceFoundHandler();
              uni.stopBluetoothDevicesDiscovery();

              if (++retryCount < SCAN_CONFIG.maxRetries) {
                otaState.value.statusText = `搜索重试 (${retryCount}/${SCAN_CONFIG.maxRetries})...`;
                setTimeout(startScan, SCAN_CONFIG.retryDelay);
              } else if (rejectOnFail) {
                appendRingDiagnosticLog('RING OTA', 'ota-scan-target-not-found', {
                  mode,
                  targetMac,
                  retries: retryCount,
                  timeoutMs: SCAN_CONFIG.timeout
                });
                reject(new Error('未找到设备，请确保设备处于正确模式'));
              } else {
                resolve(null);
              }
            }
          }, SCAN_CONFIG.timeout);

          otaScanDeviceFoundHandler = (res) => {
            if (found) return;

            for (const device of res.devices) {
              const name = (device.name || device.localName || '').trim();
              if (name) console.log('[BLE] 发现:', name, device.deviceId);

              if (isTargetDevice(device)) {
                found = true;
                clearTimeout(scanTimeout);
                clearOtaScanDeviceFoundHandler();
                uni.stopBluetoothDevicesDiscovery();

                console.log(`[BLE] ✅ 匹配 ${mode}:`, name, device.deviceId, JSON.stringify(device));
                appendRingDiagnosticLog('RING OTA', 'ota-scan-target-matched', {
                  mode,
                  targetMac,
                  platformDeviceId: device.deviceId,
                  name,
                  advertisMac: extractMacFromAdv(device.advertisData)
                });
                const adv = device.advertisData;
                console.log('[BOOT] adv byteLength =', adv ? adv.byteLength : null);
                if (adv && adv.byteLength) {
                  const u8 = new Uint8Array(adv);
                  console.log(
                    '[BOOT] adv hex =',
                    Array.from(u8)
                      .map((b) => b.toString(16).padStart(2, '0'))
                      .join('')
                  );
                }
                otaState.value.statusText = '正在连接设备...';

                connectDevice(device.deviceId)
                  .then(() => resolve(isBootMode ? device.deviceId : { deviceId: device.deviceId, name }))
                  .catch((e) => (rejectOnFail ? reject(e) : resolve(null)));
                return;
              }
            }
          };
          uni.onBluetoothDeviceFound(otaScanDeviceFoundHandler);
        },
        fail: (err) => {
          console.error('[BLE] 扫描失败:', err);
          rejectOnFail ? reject(new Error('蓝牙扫描失败')) : resolve(null);
        }
      });
    };

    startScan();
  });
};

/** 进入 BOOT 模式 */
const enterBootMode = async (deviceId) => {
  otaState.value.statusText = '正在进入升级模式...';

  try {
    await connectDevice(deviceId);
    await new Promise((r) => setTimeout(r, 500));
    await sendCommand(deviceId, [0x01, 0x02]);
    console.log('[OTA] 已发送 BOOT 命令');
  } catch (e) {
    console.warn('[OTA] BOOT 命令异常:', e);
    appendRingDiagnosticLog('RING OTA', 'ota-enter-boot-failed', {
      platformDeviceId: deviceId,
      error: e?.message || String(e)
    });
    throw e;
  }

  otaState.value.statusText = '等待设备重启...';
  // 尽快开始扫描，避免错过部分固件较短的 BOOT 广播窗口。
  await new Promise((r) => setTimeout(r, 1500));
  await disconnectDevice(deviceId);
};

// --- OTA 主流程 ---

const startOtaProcess = async () => {
  if (otaState.value.isUpgrading) return;
  if (otaState.value.success) {
    uni.showToast({
      title: hasUpgradePackage.value ? '升级已完成' : '已是最新版本',
      icon: 'none'
    });
    return;
  }
  if (firmwareUrl.value === '' || firmwareUrl.value == null) {
    uni.showToast({
      title: '未配置固件下载地址，请先在后台上传',
      icon: 'none'
    });
    return;
  }

  const currentDevice = userStore.deviceInfo || {};
  const currentDeviceId = currentDevice.deviceId;
  const currentDeviceName = (currentDevice.name || '').toUpperCase().trim();
  const isAlreadyInBootMode = currentDeviceName === 'PPLUSOTA';
  // 微信 BLE API 使用平台 deviceId；BOOT 扫描匹配必须使用戒指真实 MAC。
  // 鸿蒙/iOS 的 platform deviceId 可能是随机地址，绝不能用于 MAC +1。
  const canonicalDeviceMac = pickText(
    currentDevice.uniMacId,
    currentDevice.mac,
    currentDevice.canonicalDeviceMac,
    bindInfo.value?.uniMacId,
    bindInfo.value?.mac,
    bindInfo.value?.canonicalDeviceMac,
    currentDeviceId
  );
  const boundCanonicalMac = pickText(
    bindInfo.value?.uniMacId,
    bindInfo.value?.mac,
    bindInfo.value?.canonicalDeviceMac
  );
  const originalAppMac = isAlreadyInBootMode
    ? boundCanonicalMac || calculateAppMac(canonicalDeviceMac)
    : canonicalDeviceMac;

  console.log('[OTA] 设备:', currentDeviceName, currentDeviceId, '| 模式:', isAlreadyInBootMode ? 'BOOT' : 'APP');

  // 重置状态
  Object.assign(otaState.value, { isUpgrading: true, error: false, success: false, progress: 0 });
  appendRingDiagnosticLog('RING OTA', 'ota-process-start', {
    platformDeviceId: currentDeviceId,
    canonicalDeviceMac,
    currentDeviceName,
    targetVersion: otaBaseInfo.value?.versionCode || '',
    firmwareUrl: firmwareUrl.value
  });

  try {
    // 1. 下载固件
    otaState.value.statusText = '正在下载固件...';
    const hexContent = await downloadFirmware(firmwareUrl.value);
    console.log('[OTA] 固件大小:', hexContent.length);
    otaState.value.progress = 5;

    // 2. 连接 BOOT 设备
    let bootDeviceId;

    if (isAlreadyInBootMode && currentDeviceId) {
      console.log('[OTA] 已在 BOOT 模式');
      bootDeviceId = currentDeviceId;
      otaState.value.progress = 15;
    } else if (currentDeviceId) {
      const targetBootMac = calculateBootMac(originalAppMac);
      console.log('[OTA] 切换到 BOOT 模式, 目标:', targetBootMac);
      try {
        await enterBootMode(currentDeviceId);
      } catch (bootCommandError) {
        // A previous failed attempt may already have left the ring in
        // PPlusOTA mode. Fall through to an exact BOOT-MAC scan so the user
        // can resume without first restoring APP mode.
        appendRingDiagnosticLog('RING OTA', 'ota-enter-boot-command-fallback-scan', {
          platformDeviceId: currentDeviceId,
          targetBootMac,
          error: bootCommandError?.message || String(bootCommandError)
        });
      }
      otaState.value.progress = 10;
      bootDeviceId = await scanAndConnect({ targetMac: targetBootMac, mode: 'BOOT' });
    } else {
      bootDeviceId = await scanAndConnect({ mode: 'BOOT' });
    }

    console.log('[OTA] 已连接 BOOT:', bootDeviceId);
    otaState.value.progress = 15;

    // 3. 执行 OTA 升级
    const otaManager = new RingOTAManager();
    await otaManager.start(bootDeviceId, hexContent, (percent, step) => {
      otaState.value.progress = percent;
      otaState.value.statusText = step;
    });

    // 4. 升级成功
    console.log('[OTA] ✅ 升级成功');
    const targetVersion = pickText(otaBaseInfo.value?.versionCode, otaBaseInfo.value?.version);
    const packageId = otaBaseInfo.value?.id;
    if (targetVersion) {
      const versionPatch = { softwareVersion: targetVersion, uiVersion: targetVersion };
      userStore.updateDeviceInfo({ ...userStore.deviceInfo, ...versionPatch });
      bindInfo.value = { ...bindInfo.value, ...versionPatch };
    }
    if (packageId && originalAppMac) {
      try {
        await reportOtaUpdate({
          packageId,
          mac: originalAppMac,
          versionKind: 'software'
        });
        appendRingDiagnosticLog('RING OTA', 'ota-version-cache-updated', {
          packageId,
          mac: originalAppMac,
          targetVersion,
          versionKind: 'software'
        });
      } catch (error) {
        // OTA has already completed successfully. A cache update failure must
        // not turn a successful device upgrade into a user-visible failure.
        appendRingDiagnosticLog('RING OTA', 'ota-version-cache-update-failed', {
          packageId,
          mac: originalAppMac,
          targetVersion,
          error: error?.message || String(error)
        });
      }
    }
    await disconnectDevice(bootDeviceId);

    const appMac = originalAppMac || calculateAppMac(bootDeviceId);
    console.log('[OTA] 目标 APP MAC:', appMac);

    // 5. 等待设备重启并重连
    otaState.value.statusText = '等待设备重启...';
    await new Promise((r) => setTimeout(r, 8000));

    otaState.value.statusText = '正在重新连接设备...';
    let reconnected = false;

    try {
      const deviceInfo = await scanAndConnect({ targetMac: appMac, mode: 'APP', rejectOnFail: false });
      if (deviceInfo?.deviceId) {
        console.log('[OTA] ✅ 已重连:', deviceInfo.name, deviceInfo.deviceId);

        userStore.updateDeviceInfo({ ...userStore.deviceInfo, deviceId: deviceInfo.deviceId, name: deviceInfo.name });
        // userStore.updateIsConnected(true);

        try {
          const { discoverServicesAndChars } = useRingBLE();
          await discoverServicesAndChars(deviceInfo.deviceId);
          userStore.updateIsConnected(true);
          reconnected = true;
        } catch (err) {
          console.warn('[OTA] discover 服务/特征失败:', err);
          userStore.updateDeviceInfo({ ...userStore.deviceInfo, deviceId: deviceInfo.deviceId }); // 可回滚 name 或清理
          userStore.updateIsConnected(false);
        }
      }
    } catch (e) {
      console.warn('[OTA] 重连失败:', e);
    }

    if (!reconnected) {
      userStore.updateDeviceInfo({ ...userStore.deviceInfo, deviceId: appMac });
      userStore.updateIsConnected(false);
    }

    // 6. 完成
    otaState.value.progress = 100;
    otaState.value.success = true;
    otaState.value.statusText = reconnected ? '✅ 升级完成，设备已连接！' : '✅ 固件升级成功！';

    uni.showModal({
      title: '升级成功',
      content: reconnected ? '固件已更新，设备已重新连接' : '固件已更新，请手动重新连接设备',
      showCancel: false,
      confirmText: '返回',
      success: () =>
        uni.switchTab({
          url: '/pages/mine/mine'
        })
    });
  } catch (err) {
    console.error('[OTA] 失败:', err);
    appendRingDiagnosticLog('RING OTA', 'ota-process-failed', {
      platformDeviceId: currentDeviceId,
      canonicalDeviceMac,
      progress: otaState.value.progress,
      statusText: otaState.value.statusText,
      error: err?.message || String(err)
    });
    otaState.value.error = true;
    otaState.value.statusText = `升级失败：${formatBleErrorMessage(err, '请稍后重试')}`;
  } finally {
    otaState.value.isUpgrading = false;
    cleanup();
  }
};

// --- 生命周期 ---
onLoad(async () => {
  // const res1 = userStore.deviceInfo;
  if (!userStore.token) {
    return;
  }
  try {
    bindInfo.value = (await getBindInfo()) || {};
    const currentVersion = versionInfo.value;
    const currentDeviceModel = deviceModel.value;
    console.log('当前版本信息:', currentVersion, '设备型号:', currentDeviceModel || '-');

    if (!currentVersion) {
      firmwareUrl.value = '';
      otaBaseInfo.value = {};
      Object.assign(otaState.value, {
        isUpgrading: false,
        progress: 0,
        statusText: '未获取到当前固件版本',
        error: false,
        success: true
      });
      return;
    }

    const res = await getOtaInfo(
      { currentVersion, deviceModel: currentDeviceModel },
      {
        custom: {
          returnAll: true
        }
      }
    );
    if (res?.code !== 200 || !res?.data) {
      const msg = res?.msg || '暂无更新';
      console.log('OTA状态:', msg);

      firmwareUrl.value = '';
      otaBaseInfo.value = {};
      Object.assign(otaState.value, {
        isUpgrading: false,
        progress: 0,
        statusText: formatBleErrorMessage(msg, '暂无更新'),
        error: false,
        success: true
      });
      return;
    }

    const otaData = res.data;
    otaBaseInfo.value = otaData;

    if (otaData.fileUrl) {
      firmwareUrl.value = buildFirmwareDownloadUrl(otaData.fileUrl);
      cleanup();
    } else {
      firmwareUrl.value = '';
      Object.assign(otaState.value, {
        isUpgrading: false,
        progress: 0,
        statusText: '暂无可升级固件',
        error: false,
        success: true
      });
    }
  } catch (err) {
    uni.showToast({
      title: formatBleErrorMessage(err, '获取升级信息失败，请稍后重试'),
      icon: 'none',
      duration: 3000
    });
  }
});
onUnmounted(() => cleanup());
</script>

<style scoped>
.ota-container {
  padding: 40rpx;
  background-color: #f2f2f7;
  min-height: 100vh;
}

.card {
  background: #ffffff;
  border-radius: 32rpx;
  padding: 60rpx 40rpx;
  box-shadow: 0 8rpx 30rpx rgba(0, 0, 0, 0.05);
}

.header {
  text-align: center;
  margin-bottom: 60rpx;
}

.title {
  font-size: 36rpx;
  font-weight: bold;
  color: #1c1c1e;
}

.version {
  font-size: 24rpx;
  color: #8e8e93;
  margin-top: 10rpx;
  display: block;
}

.progress-section {
  margin: 60rpx 0;
  position: relative;
}

.percent {
  position: absolute;
  right: 0;
  top: -46rpx;
  font-size: 32rpx;
  font-weight: bold;
  color: #007aff;
}

.status-box {
  min-height: 100rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20rpx;
}

.status-text {
  font-size: 28rpx;
  color: #3a3a3c;
  text-align: center;
  line-height: 1.5;
}

.error {
  color: #ff3b30;
  font-weight: bold;
}

.success {
  color: #34c759;
  font-weight: bold;
}

button {
  margin-top: 40rpx;
  height: 94rpx;
  line-height: 94rpx;
  border-radius: 47rpx;
  background: #007aff;
  font-weight: bold;
  color: white;
}

.no-upgrade {
  margin-top: 40rpx;
  height: 88rpx;
  border-radius: 44rpx;
  background: #f2f4f8;
  color: #8e8e93;
  font-size: 28rpx;
  line-height: 88rpx;
  text-align: center;
}

.footer-hint {
  margin-top: 50rpx;
}

.hint-item {
  font-size: 22rpx;
  color: #aeaeb2;
  display: block;
  line-height: 1.6;
}
</style>
