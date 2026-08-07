<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import {
  getRingBusinessDeviceKey,
  getRingBusinessDeviceName,
  getRingBusinessDeviceTail,
  useRingBusinessController
} from '@/composables/useRingBusinessController';
import { getRingDeviceStableIdentity, isSameRingDevice } from '@/composables/useRingBleSdk';
import { deviceModelList, getBindInfo } from '@/common/api/device';
import { formatBleErrorMessage } from '@/utils/bleError';
import { hasBoundRingIdentity } from '@/utils/ringBinding';
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
const boundInfo = ref<ScanDeviceInfo | null>(null);
const boundInfoLoaded = ref(false);
const autoReconnectStatus = ref<'idle' | 'connecting' | 'success' | 'failed'>('idle');
const autoReconnectMessage = ref('');
const scanTarget = ref('');
const scanTargetName = ref('');
const directScan = ref(false);
const scanTargetAutoConnectDone = ref(false);

const picker = ref<any>(null);
const columns = ref([['全部']]);
const type = ref<string[]>([]);
const selectedTypeLabel = ref('');
const t = (...codes: number[]) => String.fromCharCode(...codes);
const copy = {
  all: t(20840, 37096),
  searchResult: t(25628, 32034, 32467, 26524),
  specifiedModel: t(25351, 23450, 22411, 21495),
  connect: t(36830, 25509),
  cancel: t(21462, 28040),
  unknownDevice: t(26032, 35774, 22791),
  bindNewDevice: t(26159, 21542, 32465, 23450, 26032, 35774, 22791),
  noDeviceTip: `1. ${t(26410, 26816, 27979, 21040, 30446, 26631, 35774, 22791, 65292, 35831, 28857, 20987, 37325, 26032, 25628, 32034, 12290)}`,
  nearTip: `2. ${t(35831, 30830, 35748, 25106, 25351, 24050, 24320, 26426, 24182, 38752, 36817, 25163, 26426, 12290)}`
};

const FALLBACK_DEVICE_MODEL_KEYS = ['L19', 'RW', 'SY03', 'SY15', 'BH3', 'QK'];
const normalizeModelSearchText = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s:_-]+/g, '');
const uniqueModelKeywords = (values: unknown[]) => Array.from(new Set(values.map(normalizeModelSearchText).filter(Boolean)));
const buildModelFilterKeywords = (filter: string) => {
  const normalizedFilter = normalizeModelSearchText(filter);
  const matchedModel = deviceModels.value.find((item) =>
    [item.modelKey, item.modelName, item.deviceVersion].some((value) => normalizeModelSearchText(value) === normalizedFilter)
  );
  const rawKeywords: unknown[] = [
    filter,
    matchedModel?.modelKey,
    matchedModel?.modelName,
    matchedModel?.deviceVersion
  ];
  const compact = uniqueModelKeywords(rawKeywords).join(' ');
  if (compact.includes('l19')) rawKeywords.push('L19', 'QKL19', 'QKeerRingL19', 'OKL19');
  if (compact.includes('rw')) rawKeywords.push('RW');
  if (compact.includes('sy03')) rawKeywords.push('SY03');
  if (compact.includes('sy15')) rawKeywords.push('SY15', 'SY15A', 'SY15-A');
  if (compact.includes('bh3')) rawKeywords.push('BH3');
  if (compact.includes('qk')) rawKeywords.push('QK', 'QKeer', 'QKeeRing');
  return uniqueModelKeywords(rawKeywords);
};
const buildDeviceModelSearchable = (device: ScanDeviceInfo) =>
  uniqueModelKeywords([
    device.displayName,
    device.deviceName,
    device.name,
    device.localName,
    device.productModel,
    device.productId,
    device.modelKey,
    device.protocol,
    device.sn
  ]).join(' ');
const normalizeScanTargetText = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '');
const isMacLikeScanTarget = (value: unknown) => normalizeScanTargetText(value).length === 12;
const isColonSeparatedMac = (value: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/.test(String(value || '').trim());
const hasScanAdvertisEvidence = (device: ScanDeviceInfo) =>
  Boolean(
    device.advertisData ||
      device.advertisHex ||
      device.advertisServiceUUIDs ||
      device.advertisServiceUUIDsList ||
      device.serviceData
  );
const getScanAdvertisMacCandidates = (device: ScanDeviceInfo) => {
  if (!hasScanAdvertisEvidence(device)) return [];
  return [
    device.advertis?.macInfo,
    device.advertis?.mac,
    device.advertis?.macAddress,
    device.advertis?.deviceMac,
    device.mac,
    isColonSeparatedMac(device.uniMacId) ? device.uniMacId : ''
  ]
    .map(normalizeScanTargetText)
    .filter(Boolean);
};
const getScanTargetStableCandidates = (device: ScanDeviceInfo) =>
  [
    ...getScanAdvertisMacCandidates(device),
    getRingDeviceStableIdentity(device as any)
  ]
    .map(normalizeScanTargetText)
    .filter(Boolean);
const getScanTargetExactCandidates = (device: ScanDeviceInfo) =>
  [
    ...getScanTargetStableCandidates(device),
    device.sn
  ]
    .map(normalizeScanTargetText)
    .filter(Boolean);
const isScanTargetDevice = (device: ScanDeviceInfo) => {
  const target = normalizeScanTargetText(scanTarget.value);
  if (!target) return false;
  const candidates = isMacLikeScanTarget(scanTarget.value)
    ? getScanAdvertisMacCandidates(device)
    : getScanTargetExactCandidates(device);
  return candidates.some((candidate) => candidate === target);
};
const findScanTargetDevice = () => devices.value.find((device) => isScanTargetDevice(device as ScanDeviceInfo));

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
const hasBoundDevice = computed(() => boundInfoLoaded.value && hasBoundRingIdentity(boundInfo.value));
const isDirectScanMode = computed(() => boundInfoLoaded.value && directScan.value && Boolean(scanTarget.value));
const showBoundReconnect = computed(() => hasBoundDevice.value && !isDirectScanMode.value);
const showScanArea = computed(() => boundInfoLoaded.value && !hasBoundDevice.value && !isDirectScanMode.value);
const directScanStatusClass = computed(() => {
  if (autoReconnectStatus.value === 'success' || autoReconnectStatus.value === 'failed') return autoReconnectStatus.value;
  return isScanning.value || connecting.value ? 'connecting' : '';
});
const directScanTitle = computed(() => {
  if (autoReconnectStatus.value === 'failed') return '未连接到二维码设备';
  if (connecting.value) return '正在连接二维码设备';
  if (isScanning.value) return '正在查找二维码设备';
  return '搜索已结束，点击重新查找';
});
const directScanDesc = computed(() => {
  if (autoReconnectMessage.value) return autoReconnectMessage.value;
  if (autoReconnectStatus.value === 'failed') return '请靠近戒指后重新查找。';
  if (connecting.value) return '已找到目标设备，正在建立蓝牙连接并绑定。';
  if (isScanning.value) return '正在按二维码设备信息查找附近戒指，请保持戒指靠近手机。';
  return '未找到目标设备时，请靠近戒指后重新查找。';
});
const autoReconnectTitle = computed(() => {
  if (autoReconnectStatus.value === 'success') return '已连接绑定设备';
  if (autoReconnectStatus.value === 'failed') return '绑定设备连接失败';
  return '正在连接绑定设备';
});
const autoReconnectDesc = computed(() => {
  if (autoReconnectMessage.value) return autoReconnectMessage.value;
  if (autoReconnectStatus.value === 'success') return '设备已恢复连接，即将返回。';
  if (autoReconnectStatus.value === 'failed') return '未连接到已绑定设备，请靠近戒指后重试。';
  return '已检测到当前账号有绑定设备，正在自动恢复连接。';
});

const devices = computed(() => {
  const filters = type.value.filter(Boolean);
  const businessDevices = [...ring.businessDevices.value];
  const currentDevice = ring.deviceInfo.value as ScanDeviceInfo;
  if (
    !isDirectScanMode.value &&
    isReadyCurrentDevice() &&
    !businessDevices.some((device) => isSameRingDevice(device as any, currentDevice as any))
  ) {
    businessDevices.unshift(currentDevice as any);
  }
  if (filters.length === 0) return businessDevices;

  const modelKeywords = filters.flatMap((item) => buildModelFilterKeywords(String(item)));
  return businessDevices.filter((device) => {
    const searchable = buildDeviceModelSearchable(device as ScanDeviceInfo);
    return modelKeywords.some((item) => searchable.includes(item));
  });
});

const scanBusinessDevices = (options: { force?: boolean; reason?: string } = {}) => {
  if (hasBoundDevice.value && !isDirectScanMode.value) {
    appendConnectPageDiagnosticLog('connect-page-scan-hidden-bound-device', {
      reason: options.reason || 'bound-device',
      snapshot: getConnectPageSnapshot()
    });
    return Promise.resolve();
  }
  if (!options.force && isReadyCurrentDevice() && !scanTarget.value) {
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
const loadBoundInfo = async () => {
  try {
    const info = await getBindInfo();
    boundInfo.value = (info || null) as ScanDeviceInfo | null;
    appendConnectPageDiagnosticLog('connect-page-bound-info-loaded', {
      hasBoundDevice: hasBoundRingIdentity(info),
      boundDevice: summarizeConnectPageDevice(info as ScanDeviceInfo),
      snapshot: getConnectPageSnapshot()
    });
  } catch (error) {
    boundInfo.value = null;
    appendConnectPageDiagnosticLog('connect-page-bound-info-load-failed', {
      message: formatBleErrorMessage(error, '绑定信息读取失败'),
      snapshot: getConnectPageSnapshot()
    });
  } finally {
    boundInfoLoaded.value = true;
  }
};
const retryBoundReconnect = async () => {
  if (!hasBoundDevice.value || autoReconnectStatus.value === 'connecting') return;
  autoReconnectStatus.value = 'connecting';
  autoReconnectMessage.value = '正在按绑定设备自动重连，请保持戒指靠近手机。';
  appendConnectPageDiagnosticLog('connect-page-bound-reconnect-start', {
    boundDevice: summarizeConnectPageDevice(boundInfo.value),
    snapshot: getConnectPageSnapshot()
  });
  try {
    const restored = await ring.restoreLastBusinessDevice({ refreshAfterRestore: false });
    if (restored && isReadyCurrentDevice()) {
      autoReconnectStatus.value = 'success';
      autoReconnectMessage.value = '绑定设备已恢复连接，即将返回。';
      appendConnectPageDiagnosticLog('connect-page-bound-reconnect-success', getConnectPageSnapshot());
      setTimeout(() => {
        uni.navigateBack();
      }, 800);
      return;
    }
    autoReconnectStatus.value = 'failed';
    autoReconnectMessage.value = '未找到已绑定设备，或连接握手未完成。请靠近戒指后重试。';
    appendConnectPageDiagnosticLog('connect-page-bound-reconnect-failed', {
      restored,
      snapshot: getConnectPageSnapshot()
    });
  } catch (error) {
    autoReconnectStatus.value = 'failed';
    autoReconnectMessage.value = formatBleErrorMessage(error, '绑定设备重连失败，请靠近戒指后重试');
    appendConnectPageDiagnosticLog('connect-page-bound-reconnect-error', {
      message: autoReconnectMessage.value,
      snapshot: getConnectPageSnapshot()
    });
  }
};
const isConnectedBusinessDevice = (device: ScanDeviceInfo) =>
  ring.isConnected.value && ring.isReady.value && ring.isCurrentBusinessDevice(device as any);
const handleSearchAreaClick = () => {
  if (connecting.value) return;
  if (isScanning.value) return;
  scanBusinessDevices({ force: true, reason: 'search-area-retry' });
};
const handleResultRetryClick = () => {
  if (connecting.value || isScanning.value) return;
  scanBusinessDevices({ force: true, reason: 'manual-reload' });
};
const handleDirectScanRetryClick = () => {
  if (connecting.value || isScanning.value) return;
  scanTargetAutoConnectDone.value = false;
  autoReconnectStatus.value = 'connecting';
  autoReconnectMessage.value = '';
  scanBusinessDevices({ force: true, reason: 'direct-scan-retry' });
};
// 是否为 iOS 设备。
const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});

const prepareConnectDevice = (device: ScanDeviceInfo) => {
  selectedDevice.value = device;
  deviceId.value = device.deviceId || '';
  deviceName.value = getRingBusinessDeviceName(device);
  iosDeviceIds.value = getRingDeviceStableIdentity(device as any);
};

const handleConnect = (device: ScanDeviceInfo) => {
  if (isConnectedBusinessDevice(device)) return;
  prepareConnectDevice(device);
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
  if (isDirectScanMode.value && isMacLikeScanTarget(scanTarget.value)) {
    return findScanTargetDevice() || null;
  }

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
      await ring.connectBusinessDevice(targetDevice as any, {
        refreshAfterConnect: false,
        replaceBinding: isDirectScanMode.value
      });
    } else {
      throw new Error('未找到可连接的戒指设备');
    }
    appendConnectPageDiagnosticLog('connect-page-success', getConnectPageSnapshot());
    if (isDirectScanMode.value) {
      autoReconnectStatus.value = 'success';
      autoReconnectMessage.value = '设备已连接并绑定，即将返回。';
    }
    refreshDeviceInfoAfterConnect();
    cancelConnect(true);
    setTimeout(() => {
      uni.navigateBack();
    }, 1000);
  } catch (err) {
    const errorMessage = formatBleErrorMessage(err, '请靠近戒指后重试');
    if (isDirectScanMode.value) {
      autoReconnectStatus.value = 'failed';
      autoReconnectMessage.value = errorMessage;
    }
    appendConnectPageDiagnosticLog('connect-page-fail', {
      message: errorMessage,
      snapshot: getConnectPageSnapshot()
    });
    uni.showToast({
      title: `连接失败：${errorMessage}`,
      icon: 'none'
    });
  } finally {
    connecting.value = false;
  }
};

const tryAutoConnectScanTarget = async () => {
  if (!scanTarget.value || scanTargetAutoConnectDone.value || connecting.value) return;
  const targetDevice = findScanTargetDevice();
  if (!targetDevice) return;
  scanTargetAutoConnectDone.value = true;
  appendConnectPageDiagnosticLog('connect-page-scan-target-matched', {
    scanTarget: scanTarget.value,
    target: summarizeConnectPageDevice(targetDevice as ScanDeviceInfo),
    snapshot: getConnectPageSnapshot()
  });
  autoReconnectStatus.value = 'connecting';
  autoReconnectMessage.value = '已找到目标设备，正在建立蓝牙连接并绑定。';
  prepareConnectDevice(targetDevice as ScanDeviceInfo);
  await nextTick();
  void confirmConnect();
};

watch(
  () => [devices.value.length, isScanning.value, connecting.value, boundInfoLoaded.value, scanTarget.value],
  () => {
    void tryAutoConnectScanTarget();
  }
);

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
    const remoteModels = await deviceModelList();
    deviceModels.value = remoteModels;
    const remoteKeys = remoteModels.map((item) => item.modelKey || item.modelName).filter(Boolean);
    const mergedKeys = Array.from(new Set([...remoteKeys, ...FALLBACK_DEVICE_MODEL_KEYS]));
    columns.value = [[copy.all, ...mergedKeys]];
  } catch {
    deviceModels.value = [];
    columns.value = [[copy.all, ...FALLBACK_DEVICE_MODEL_KEYS]];
  }
};

onLoad(async (query = {}) => {
  const queryRecord = query as Record<string, any>;
  const target = queryRecord.scanTarget || queryRecord.sn || '';
  scanTarget.value = target ? decodeURIComponent(String(target)) : '';
  scanTargetName.value = queryRecord.scanName ? decodeURIComponent(String(queryRecord.scanName)) : '';
  directScan.value = queryRecord.directScan === '1' || queryRecord.directScan === 'true';
  if (directScan.value && scanTarget.value) {
    autoReconnectStatus.value = 'connecting';
    autoReconnectMessage.value = '';
  }
  await loadBoundInfo();
  if (isDirectScanMode.value) {
    scanBusinessDevices({ force: true, reason: 'page-load-direct-scan-target' });
  } else if (hasBoundDevice.value) {
    void retryBoundReconnect();
  } else {
    scanBusinessDevices({ reason: scanTarget.value ? 'page-load-scan-target' : 'page-load-no-bound-device' });
  }
  loadDeviceModelsSafely();
});
onUnload(() => {
  stopScan();
});
</script>

<template>
  <view class="p-30 bg-white min-h-screen">
    <view v-if="showBoundReconnect" class="bound-reconnect-card r-50 p-40">
      <view class="bound-status-icon" :class="autoReconnectStatus"></view>
      <view class="bound-title fs-40 mt-30">{{ autoReconnectTitle }}</view>
      <view class="bound-desc fs-30 mt-20">{{ autoReconnectDesc }}</view>
      <view class="bound-device mt-30">
        <view class="bound-device-name">{{ getRingBusinessDeviceName(boundInfo || {}) || copy.unknownDevice }}</view>
        <view class="bound-device-id mt-10">{{ getRingBusinessDeviceTail(boundInfo || {}) || '-' }}</view>
      </view>
      <view v-if="autoReconnectStatus === 'failed'" class="bound-actions flex jc-center mt-40">
        <uv-button
          text="重试连接"
          shape="circle"
          color="#2E70FC"
          :customTextStyle="{ 'font-size': '34rpx' }"
          :customStyle="{ padding: '42rpx 0', width: '220rpx' }"
          @click="retryBoundReconnect"
        ></uv-button>
      </view>
    </view>
    <view v-else-if="isDirectScanMode" class="bound-reconnect-card r-50 p-40">
      <view class="bound-status-icon" :class="directScanStatusClass"></view>
      <view class="bound-title fs-40 mt-30">{{ directScanTitle }}</view>
      <view class="bound-desc fs-30 mt-20">{{ directScanDesc }}</view>
      <view class="bound-device mt-30">
        <view class="bound-device-name">{{ scanTargetName || copy.unknownDevice }}</view>
        <view class="bound-device-id mt-10">{{ scanTarget }}</view>
      </view>
      <view v-if="!isScanning && !connecting" class="bound-actions flex jc-center mt-40">
        <uv-button
          text="重新查找"
          shape="circle"
          color="#2E70FC"
          :customTextStyle="{ 'font-size': '34rpx' }"
          :customStyle="{ padding: '42rpx 0', width: '220rpx' }"
          @click="handleDirectScanRetryClick"
        ></uv-button>
      </view>
    </view>
    <!-- 搜索中状态 -->
    <view
      v-if="showScanArea"
      class="search-loading flex fd-c ai-center mb-50"
      :class="{ 'search-loading-clickable': !isScanning }"
      @click="handleSearchAreaClick"
    >
      <uv-image src="/static/images/mine/logo3.png" width="260rpx" height="260rpx" mode="aspectFit" observe-lazy-load></uv-image>
      <view class="loading-title fs-36">{{ isScanning ? '正在搜索戒指…' : '搜索已结束，点击重新搜索' }}</view>
      <view class="loading-desc t-979797 mt-10">
        {{ isScanning ? '正在查找附近可用戒指，请保持戒指靠近手机。' : '未找到目标设备时，请靠近戒指后点这里重新搜索。' }}
      </view>
      <view v-if="!isScanning" class="retry-search-button mt-24" @click.stop="handleSearchAreaClick">重新搜索</view>
    </view>

    <!-- 搜索结果区域 -->
    <view v-if="showScanArea" class="search-results">
      <!-- 结果信息区 -->
      <view class="results-info flex jc-between ai-center">
        <!-- 结果头部 -->
        <!-- <view class="results flex ai-center" @click="startScan"> -->
        <view class="results flex ai-center" :class="{ disabled: isScanning || connecting }" @click="handleResultRetryClick">
          <view class="results-title fs-36 mr-20">{{ copy.searchResult }}</view>
          <uv-image src="/static/images/mine/reload.png" width="36rpx" height="36rpx" observe-lazy-load></uv-image>
        </view>

        <!-- 筛选/跳转项 -->
        <view @click="openPicker" class="filter flex ai-center pt-20 pb-20 pl-40 pr-40 r-50">
          <view class="filter-label fs-36 mr-20">{{ type.length > 0 ? (type.length > 1 ? copy.all : type[0]) : copy.specifiedModel }}</view>
          <uv-icon name="arrow-right" color="#010101" size="10"></uv-icon>
        </view>
      </view>

      <!-- 设备列表 -->
      <view class="device-list mt-50">
        <view v-for="dev in devices" :key="dev.deviceId" class="device-item flex jc-between ai-center mb-50 bg-white pt-20 pb-20 pl-40 pr-40 r-50">
          <view class="device-info">
            <view class="device-name">{{ getRingBusinessDeviceName(dev) || copy.unknownDevice }}</view>
            <view class="device-model t-979797">{{ isIOS ? dev?.uniMacId : dev?.deviceId }}</view>
          </view>
          <uv-button
            :text="copy.connect"
            shape="circle"
            color="#2E70FC"
            :customTextStyle="{ 'font-size': '32rpx' }"
            :customStyle="{
              padding: '43rpx 0',
              width: '174rpx'
            }"
            :disabled="connecting"
            @click="handleConnect(dev)"
          ></uv-button>
        </view>
      </view>

      <!-- 帮助提示 -->
      <view class="help-tips mt-40 fs-32 t-979797" v-if="devices.length == 0">
        <view class="tip-item mb-30">{{ copy.noDeviceTip }}</view>
        <view class="tip-item mb-30">{{ copy.nearTip }}</view>
      </view>
    </view>

    <uv-popup v-if="showScanArea" ref="popup" round="50rpx">
      <view class="pt-50 pl-40 pr-40 pb-40">
        <!-- 图标与标题 -->
        <view class="popup-header flex fd-c ai-center mb-70">
          <uv-image src="/static/images/mine/logo3.png" width="132rpx" height="132rpx" mode="aspectFit" observe-lazy-load></uv-image>
          <view class="popup-title mt-30 fs-44">{{ copy.unknownDevice }}</view>
        </view>

        <!-- 确认文案 -->
        <view class="popup-desc fs-36 ta-c" style="color: #222222">{{ copy.bindNewDevice }}</view>
        <view class="popup-actions flex jc-center mt-50">
          <uv-button
            :text="copy.cancel"
            shape="circle"
            color="#F1F3F6"
            :customTextStyle="{ 'font-size': '36rpx', color: '#2E70FC' }"
            :customStyle="{
              padding: '52rpx 0',
              width: '210rpx'
            }"
            :disabled="connecting"
            @click="cancelConnect"
          ></uv-button>
          <view style="width: 30rpx"></view>
          <uv-button
            :text="connecting ? '连接中...' : copy.connect"
            shape="circle"
            color="#2E70FC"
            :customTextStyle="{ 'font-size': '36rpx' }"
            :customStyle="{
              padding: '52rpx 0',
              width: '210rpx'
            }"
            :loading="connecting"
            :disabled="connecting"
            @click="confirmConnect"
          ></uv-button>
        </view>
      </view>
    </uv-popup>

    <uv-picker v-if="showScanArea" ref="picker" :columns="columns" @confirm="confirmType" confirmColor="#2e70fc"></uv-picker>
  </view>
</template>

<style lang="scss" scoped>
.bound-reconnect-card {
  margin-top: 80rpx;
  text-align: center;
  background: #f7f9ff;
  box-shadow: 0 12rpx 30rpx rgba(46, 112, 252, 0.12);
}

.bound-status-icon {
  width: 96rpx;
  height: 96rpx;
  margin: 0 auto;
  border-radius: 50%;
  background: #dbe7ff;
  border: 10rpx solid #2e70fc;
  box-sizing: border-box;
}

.bound-status-icon.connecting,
.bound-status-icon.idle {
  border-color: #2e70fc #dbe7ff #dbe7ff #2e70fc;
  animation: bound-reconnect-spin 1s linear infinite;
}

.bound-status-icon.success {
  background: #eaf7ef;
  border-color: #35c56a;
}

.bound-status-icon.failed {
  background: #fff1f1;
  border-color: #ff5959;
}

.search-loading-clickable {
  cursor: pointer;
}

.search-loading-clickable .loading-title {
  color: #2e70fc;
}

.retry-search-button {
  min-width: 200rpx;
  padding: 18rpx 34rpx;
  border-radius: 999rpx;
  background: #e8f0ff;
  color: #2e70fc;
  font-size: 30rpx;
  font-weight: 700;
  text-align: center;
}

.results.disabled {
  opacity: 0.55;
}

.bound-title {
  color: #111827;
  font-weight: 600;
}

.bound-desc,
.bound-device-id {
  color: #7b8494;
  line-height: 1.6;
}

.bound-device {
  padding: 24rpx;
  border-radius: 28rpx;
  background: #ffffff;
}

.bound-device-name {
  color: #111827;
  font-size: 34rpx;
  font-weight: 600;
}

@keyframes bound-reconnect-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

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
