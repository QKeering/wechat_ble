<template>
  <view class="ota-container">
    <view class="card">
      <view class="header">
        <text class="title">系统固件更新</text>
        <text class="version">目标版本: {{ otaBaseInfo?.versionCode || '' }}</text>
      </view>

      <view class="progress-section">
        <progress :percent="otaState.progress" stroke-width="12" activeColor="#007AFF" border-radius="6" />
        <text class="percent">{{ otaState.progress }}%</text>
      </view>

      <view class="status-box">
        <text class="status-text" :class="{ error: otaState.error, success: otaState.success }">
          {{ otaState.statusText }}
        </text>
      </view>

      <button type="primary" :loading="otaState.isUpgrading" :disabled="otaState.isUpgrading" @tap="startOtaProcess">
        {{ otaState.isUpgrading ? '升级中...' : '开始安全升级' }}
      </button>

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
import { getOtaInfo, getBindInfo } from '@/common/api/device';
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

const versionInfo = computed(() => {
  const versionData = userStore.receivedData.find((item) => item.type === 'softwareVersion');
  return versionData?.value || '';
});

// --- 工具方法 ---

/** 清理蓝牙监听器 */
const cleanup = () => {
  // uni.offBLECharacteristicValueChange();
  uni.offBLEConnectionStateChange();
  uni.offBluetoothDeviceFound();
  uni.stopBluetoothDevicesDiscovery();
};

/** 下载固件文件 */
const downloadFirmware = (url) => {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'GET',
      responseType: 'text',
      success: (res) => (res.statusCode === 200 ? resolve(res.data) : reject(new Error('固件下载失败'))),
      fail: () => reject(new Error('网络请求异常'))
    });
  });
};

/** 发送蓝牙命令 */
const sendCommand = (deviceId, data) => {
  return new Promise((resolve) => {
    uni.writeBLECharacteristicValue({
      deviceId,
      serviceId: SERVICE_UUID,
      characteristicId: UUID_CMD,
      value: new Uint8Array(data).buffer,
      success: () => resolve(),
      fail: (err) => {
        console.warn('[BLE] 发送命令失败:', err);
        resolve(); // 忽略错误
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

  // 尝试从广播数据末尾提取 6 字节 MAC（反序）
  // 根据日志，MAC 位于广播数据的后 6 字节
  if (bytes.length >= 6) {
    // 取最后 6 字节并反序
    const macBytes = Array.from(bytes.slice(-6)).reverse();
    const mac = macBytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');

    // 验证是否为有效的戒指 MAC (B0:05:F0 开头)
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

      if (isBootMode) {
        // BOOT 模式：匹配 PPLUSOTA 或目标 MAC
        if (nameUpper === 'PPLUSOTA') return true;
      } else {
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
      }

      return false;
    };

    const startScan = () => {
      uni.offBluetoothDeviceFound();
      uni.stopBluetoothDevicesDiscovery();

      uni.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: true,
        powerLevel: 'high',
        success: () => {
          console.log(`[BLE] 扫描 ${mode} 设备...`, targetMac ? `目标: ${targetMac}` : '');

          const scanTimeout = setTimeout(() => {
            if (!found) {
              uni.offBluetoothDeviceFound();
              uni.stopBluetoothDevicesDiscovery();

              if (++retryCount < SCAN_CONFIG.maxRetries) {
                otaState.value.statusText = `搜索重试 (${retryCount}/${SCAN_CONFIG.maxRetries})...`;
                setTimeout(startScan, SCAN_CONFIG.retryDelay);
              } else if (rejectOnFail) {
                reject(new Error('未找到设备，请确保设备处于正确模式'));
              } else {
                resolve(null);
              }
            }
          }, SCAN_CONFIG.timeout);

          uni.onBluetoothDeviceFound((res) => {
            if (found) return;

            for (const device of res.devices) {
              const name = (device.name || device.localName || '').trim();
              if (name) console.log('[BLE] 发现:', name, device.deviceId);

              if (isTargetDevice(device)) {
                found = true;
                clearTimeout(scanTimeout);
                uni.offBluetoothDeviceFound();
                uni.stopBluetoothDevicesDiscovery();

                console.log(`[BLE] ✅ 匹配 ${mode}:`, name, device.deviceId, JSON.stringify(device));
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
          });
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
  }

  otaState.value.statusText = '等待设备重启...';
  await new Promise((r) => setTimeout(r, 5000));
  await disconnectDevice(deviceId);
};

// --- OTA 主流程 ---

const startOtaProcess = async () => {
  if (otaState.value.isUpgrading) return;
  if (otaState.value.success) {
    uni.showToast({
      title: '已是最新版本',
      icon: 'none'
    });
    return;
  }
  if (firmwareUrl.value === '' || firmwareUrl.value == null) {
    uni.showToast({
      title: '无固件url,请在后台上传',
      icon: 'none'
    });
    return;
  }

  const currentDeviceId = userStore.deviceInfo?.deviceId;
  const currentDeviceName = (userStore.deviceInfo?.name || '').toUpperCase().trim();
  const isAlreadyInBootMode = currentDeviceName === 'PPLUSOTA';
  const originalAppMac = isAlreadyInBootMode ? calculateAppMac(currentDeviceId) : currentDeviceId;

  console.log('[OTA] 设备:', currentDeviceName, currentDeviceId, '| 模式:', isAlreadyInBootMode ? 'BOOT' : 'APP');

  // 重置状态
  Object.assign(otaState.value, { isUpgrading: true, error: false, success: false, progress: 0 });

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
      const targetBootMac = calculateBootMac(currentDeviceId);
      console.log('[OTA] 切换到 BOOT 模式, 目标:', targetBootMac);
      await enterBootMode(currentDeviceId);
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
    otaState.value.error = true;
    otaState.value.statusText = `升级失败: ${err.message || '未知错误'}`;
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
    console.log('当前版本信息:', versionInfo.value);
    const res = await getOtaInfo(
      { currentVersion: versionInfo.value, deviceModel: '' },
      {
        custom: {
          returnAll: true
        }
      }
    );
    if (res?.code !== 200 || !res?.data) {
      const msg = res?.msg || '暂无更新';
      console.log('OTA状态:', msg);

      otaState.value = {
        statusText: msg,
        success: true
      };
      return;
    }

    const otaData = res.data;
    otaBaseInfo.value = otaData;

    if (otaData.fileUrl) {
      const apiBase = import.meta.env.VITE_API_BASE;
      firmwareUrl.value = encodeURI(apiBase + otaData.fileUrl);
      cleanup();
    }
  } catch (err) {
    const errMsg = typeof err === 'string' ? err : err?.msg || '获取OTA信息失败';
    uni.showToast({
      title: errMsg,
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
