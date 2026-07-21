<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import {
  getRingBusinessDeviceKey,
  getRingBusinessDeviceName,
  getRingBusinessDeviceTail,
  useRingBusinessController
} from '@/composables/useRingBusinessController';
import { getRingDeviceStableIdentity, isSameRingDevice } from '@/composables/useRingBleSdk';
import { deviceModelList } from '@/common/api/device';
import { formatBleErrorMessage } from '@/utils/bleError';
import { appendRingDiagnosticLog, RW_DIAGNOSTIC_BUILD_TAG } from '@/composables/useRwForegroundMeasurement';
import type { DeviceModel } from '@/types/api/device';

const ring = useRingBusinessController();
const { isScanning, stopScan } = ring;
type ScanDeviceInfo = Record<string, any>;
const deviceModels = ref<DeviceModel[]>([]);

const popup = ref<any>(null);
const deviceId = ref('');
const deviceName = ref('');
const iosDeviceIds = ref('');
const selectedDevice = ref<ScanDeviceInfo | null>(null);
const connecting = ref(false);

const picker = ref<any>(null);
const columns = ref([['全部']]);
const type = ref<string[]>([]);
const selectedTypeLabel = ref('');
const apiBase = import.meta.env.VITE_API_BASE || 'https://sh.qkeering.com';
const t = (...codes: number[]) => String.fromCharCode(...codes);
const copy = {
  all: t(20840, 37096),
  searchResult: t(25628, 32034, 32467, 26524),
  specifiedModel: t(25351, 23450, 22411, 21495),
  connect: t(36830, 25509),
  cancel: t(21462, 28040),
  unknownDevice: t(38476, 29983, 35774, 22791),
  bindNewDevice: t(26159, 21542, 32465, 23450, 26032, 35774, 22791),
  noDeviceTip: `1. ${t(26410, 26816, 27979, 21040, 30446, 26631, 35774, 22791, 65292, 35831, 28857, 20987, 37325, 26032, 25628, 32034, 12290)}`,
  nearTip: `2. ${t(35831, 30830, 35748, 25106, 25351, 24050, 24320, 26426, 24182, 38752, 36817, 25163, 26426, 12290)}`
};

const appendConnectPageDiagnosticLog = (event: string, details?: unknown) => {
  const detailPayload =
    details && typeof details === 'object' && !Array.isArray(details)
      ? { buildTag: RW_DIAGNOSTIC_BUILD_TAG, ...(details as Record<string, unknown>) }
      : { buildTag: RW_DIAGNOSTIC_BUILD_TAG, value: details };
  appendRingDiagnosticLog('RW PAGE', event, detailPayload);
};
const summarizeConnectPageDevice = (device: ScanDeviceInfo | null | undefined) => ({
  deviceId: device?.deviceId,
  name: device ? getRingBusinessDeviceName(device) : '',
  protocol: device?.protocol,
  uniMacId: device?.uniMacId,
  mac: device?.mac || device?.advertis?.macInfo,
  serviceId: device?.serviceId,
  cmdCharId: device?.cmdCharId,
  dataServiceId: device?.dataServiceId,
  dataCharId: device?.dataCharId,
  lastSeenAt: device?.lastSeenAt,
  rssi: device?.RSSI ?? device?.rssi
});
const getConnectPageSnapshot = () => ({
  isScanning: isScanning.value,
  isConnected: ring.isConnected.value,
  isReady: ring.isReady.value,
  deviceCount: devices.value.length,
  current: summarizeConnectPageDevice(ring.deviceInfo.value as ScanDeviceInfo),
  selected: summarizeConnectPageDevice(selectedDevice.value),
  scannedTail: devices.value.slice(-6).map((item) => summarizeConnectPageDevice(item as ScanDeviceInfo))
});

const isReadyCurrentDevice = () => ring.isConnected.value && ring.isReady.value && Boolean(ring.deviceInfo.value.deviceId);

const devices = computed(() => {
  const filters = type.value.filter(Boolean);
  const businessDevices = [...ring.businessDevices.value];
  const currentDevice = ring.deviceInfo.value as ScanDeviceInfo;
  if (isReadyCurrentDevice() && !businessDevices.some((device) => isSameRingDevice(device as any, currentDevice as any))) {
    businessDevices.unshift(currentDevice as any);
  }
  if (filters.length === 0) return businessDevices;

  return businessDevices.filter((device) => {
    const deviceRecord = device as ScanDeviceInfo;
    const searchable = [
      deviceRecord.displayName,
      deviceRecord.deviceName,
      deviceRecord.name,
      deviceRecord.localName,
      deviceRecord.productModel,
      deviceRecord.productId,
      deviceRecord.modelKey
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return filters.some((item) => searchable.includes(String(item).toLowerCase()));
  });
});

const scanBusinessDevices = (options: { force?: boolean; reason?: string } = {}) => {
  if (!options.force && isReadyCurrentDevice()) {
    appendConnectPageDiagnosticLog('connect-page-scan-skipped-ready', {
      reason: options.reason || 'ready-device',
      snapshot: getConnectPageSnapshot()
    });
    return Promise.resolve();
  }
  appendConnectPageDiagnosticLog('connect-page-scan', {
    reason: options.reason || 'manual',
    force: options.force === true,
    snapshot: getConnectPageSnapshot()
  });
  return ring.scanForBusinessDevices();
};
const isConnectedBusinessDevice = (device: ScanDeviceInfo) =>
  ring.isConnected.value && ring.isReady.value && ring.isCurrentBusinessDevice(device as any);
// 是否为 iOS 设备。
const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});

const handleConnect = (device: ScanDeviceInfo) => {
  if (isConnectedBusinessDevice(device)) return;
  selectedDevice.value = device;
  deviceId.value = device.deviceId || '';
  deviceName.value = getRingBusinessDeviceName(device);
  iosDeviceIds.value = getRingDeviceStableIdentity(device as any);
  popup.value?.open?.();
};
const cancelConnect = (force = false) => {
  if (connecting.value && !force) return;
  popup.value?.close?.();
};
const refreshDeviceInfoAfterConnect = () => {
  appendConnectPageDiagnosticLog('connect-page-device-info-refresh-start', getConnectPageSnapshot());
  void ring
    .refreshDeviceInfoData()
    .then((result) => {
      appendConnectPageDiagnosticLog('connect-page-device-info-refresh-result', {
        result,
        snapshot: getConnectPageSnapshot()
      });
    })
    .catch((error) => {
      appendConnectPageDiagnosticLog('connect-page-device-info-refresh-failed', {
        message: formatBleErrorMessage(error, '设备信息后台读取失败'),
        snapshot: getConnectPageSnapshot()
      });
    });
};
const findLatestSelectableDevice = () => {
  const selected = selectedDevice.value;
  const identityHint = {
    deviceId: deviceId.value,
    uniMacId: iosDeviceIds.value,
    mac: iosDeviceIds.value,
    advertis: {
      macInfo: iosDeviceIds.value
    }
  };

  if (selected) {
    return devices.value.find((item) => isSameRingDevice(item as any, selected as any)) || selected;
  }

  return devices.value.find((item) => isSameRingDevice(item as any, identityHint as any));
};
const confirmConnect = async () => {
  if (connecting.value) return;
  connecting.value = true;
  try {
    const targetDevice = findLatestSelectableDevice();
    appendConnectPageDiagnosticLog('connect-page-attempt', {
      target: summarizeConnectPageDevice(targetDevice as ScanDeviceInfo),
      snapshot: getConnectPageSnapshot()
    });
    if (targetDevice) {
      await ring.connectBusinessDevice(targetDevice as any, { refreshAfterConnect: false });
    } else {
      throw new Error('未找到可连接的戒指设备');
    }
    appendConnectPageDiagnosticLog('connect-page-success', getConnectPageSnapshot());
    refreshDeviceInfoAfterConnect();
    cancelConnect(true);
    setTimeout(() => {
      uni.navigateBack();
    }, 1000);
  } catch (err) {
    appendConnectPageDiagnosticLog('connect-page-fail', {
      message: formatBleErrorMessage(err, '请靠近戒指后重试'),
      snapshot: getConnectPageSnapshot()
    });
    uni.showToast({
      title: `连接失败：${formatBleErrorMessage(err, '请靠近戒指后重试')}`,
      icon: 'none'
    });
  } finally {
    connecting.value = false;
  }
};

const openPicker = () => {
  picker.value.open();
};
const confirmType = (e: any) => {
  if (e.value[0] == copy.all) {
    type.value = [];
    selectedTypeLabel.value = copy.all;
  } else {
    type.value = e.value;
    selectedTypeLabel.value = e.value[0] || copy.specifiedModel;
  }
  scanBusinessDevices({ force: true, reason: 'filter-change' });
};

const loadDeviceModelsSafely = async () => {
  try {
    deviceModels.value = await deviceModelList();
    columns.value = [[copy.all, ...deviceModels.value.map((item) => item.modelKey)]];
  } catch {
    deviceModels.value = [];
    columns.value = [[copy.all]];
  }
};

onLoad(() => {
  scanBusinessDevices({ reason: 'page-load' });
  loadDeviceModelsSafely();
});
onUnload(() => {
  stopScan();
});
</script>

<template>
  <view class="p-30 bg-white min-h-screen">
    <!-- 搜索中状态 -->
    <view class="search-loading flex fd-c ai-center mb-50">
      <uv-image :src="isScanning ? `${apiBase}/image/load.webp` : `${apiBase}/image/loads.png`" width="390rpx" height="390rpx" customStyle="opacity: 0.5;"></uv-image>
      <view class="loading-title fs-36">{{ isScanning ? '正在搜索设备…' : '搜索已完成' }}</view>
      <view class="loading-desc t-979797 mt-10">{{ isScanning ? '正在查找附近的可用设备（约10秒）' : '点击下方搜索结果可重新搜索' }}</view>
    </view>

    <!-- 搜索结果区域 -->
    <view class="search-results">
      <!-- 结果信息区 -->
      <view class="results-info flex jc-between ai-center">
        <!-- 结果头部 -->
        <!-- <view class="results flex ai-center" @click="startScan"> -->
        <view class="results flex ai-center" @click="restartScan()">
          <view class="results-title fs-36 mr-20">搜索结果</view>
          <uv-image src="/static/images/mine/reload.png" width="36rpx" height="36rpx"></uv-image>
        </view>

        <!-- 筛选/跳转项 -->
        <view @click="openPicker" class="filter flex ai-center pt-20 pb-20 pl-40 pr-40 r-50">
          <view class="filter-label fs-36 mr-20">{{ type.length > 0 ? (type.length > 1 ? '全部' : type[0]) : '指定型号' }}</view>
          <uv-icon name="arrow-right" color="#010101" size="10"></uv-icon>
        </view>
      </view>

      <!-- 设备列表 -->
      <view class="device-list mt-50">
        <view v-for="dev in devices" :key="dev.deviceId" class="device-item flex jc-between ai-center mb-50 bg-white pt-20 pb-20 pl-40 pr-40 r-50">
          <view class="device-info">
            <view class="device-name">{{ dev.name }}</view>
            <view class="device-model t-979797">{{ isIOS ? dev?.uniMacId : dev?.deviceId }}</view>
          </view>
          <uv-button
            text="连接"
            shape="circle"
            color="#2E70FC"
            :customTextStyle="{ 'font-size': '32rpx' }"
            :customStyle="{
              padding: '43rpx 0',
              width: '174rpx'
            }"
            @click="handleConnect(dev.deviceId, dev.name, dev?.uniMacId)"
          ></uv-button>
        </view>
      </view>

      <!-- 帮助提示 -->
      <view class="help-tips mt-40 fs-32 t-979797" v-if="devices.length == 0">
        <view class="tip-item mb-30">1. 未检测到目标设备，请点击“重新搜索”以刷新设备列表。</view>
        <view class="tip-item mb-30">2. 设备当前未开机，请将其置于充电仓中充电，待设备启动后方可完成绑定操作。</view>
      </view>
    </view>

    <uv-popup ref="popup" round="50rpx">
      <view class="pt-50 pl-40 pr-40 pb-40">
        <!-- 图标与标题 -->
        <view class="popup-header flex fd-c ai-center mb-70">
          <uv-image src="/static/images/mine/warning.png" width="132rpx" height="132rpx"></uv-image>
          <view class="popup-title mt-30 fs-44">新设备</view>
        </view>

        <!-- 确认文案 -->
        <view class="popup-desc fs-36 ta-c" style="color: #222222">是否绑定新设备</view>
        <view class="popup-actions flex jc-center mt-50">
          <uv-button
            text="取消"
            shape="circle"
            color="#F1F3F6"
            :customTextStyle="{ 'font-size': '36rpx', color: '#2E70FC' }"
            :customStyle="{
              padding: '52rpx 0',
              width: '210rpx'
            }"
            @click="cancelConnect"
          ></uv-button>
          <view style="width: 30rpx"></view>
          <uv-button
            text="连接"
            shape="circle"
            color="#2E70FC"
            :customTextStyle="{ 'font-size': '36rpx' }"
            :customStyle="{
              padding: '52rpx 0',
              width: '210rpx'
            }"
            @click="confirmConnect"
          ></uv-button>
        </view>
      </view>
    </uv-popup>

    <uv-picker ref="picker" :columns="columns" @confirm="confirmType" confirmColor="#2e70fc"></uv-picker>
  </view>
</template>

<style lang="scss" scoped>
.filter {
  background-color: #f1f3f6;
}
.device-item {
  box-shadow: 0 8rpx 20rpx 0 #2e70fc33;
  &:last-child {
    margin-bottom: 0;
  }
}
.tip-item {
  &:last-child {
    margin-bottom: 0;
  }
}
</style>
