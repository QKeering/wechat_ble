<!-- 设备信息 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onUnload } from '@dcloudio/uni-app';
import { getBindInfo, unbind } from '@/common/api/device';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { useRingBusinessData } from '@/composables/useRingBusinessData';
import { useRingStore } from '@/stores';
import { useUserStore } from '@/stores/user';
import { getLegacyBleHistoryExclusiveSnapshot, resolveRingProtocol, type RingDeviceInfo } from '@/sdk/ring-ble';
import { clearFrontendRingBindingState, getBoundRingIdentity, getBoundRingIdentityTail, hasBoundRingIdentity } from '@/utils/ringBinding';
import { formatBleErrorMessage } from '@/utils/bleError';
import { normalizeHealthText } from '@/utils/healthText';
import { appendRingDiagnosticLog, RW_DIAGNOSTIC_BUILD_TAG } from '@/composables/useRwForegroundMeasurement';
import { formatBatteryPercentForDisplay, formatBatteryStatusForDisplay, isBatteryChargingLike } from '@/utils/batteryDisplay';

const userStore = useUserStore();
const ringStore = useRingStore();
const ring = useRingBusinessData();
const controller = useRingBusinessController();
const DEVICE_INFO_SNAPSHOT_WAIT_MS = 12000;
const DEVICE_INFO_EMPTY_TEXT = '-';
const content = '你确定要解除绑定吗？';
const FIND_RING_RED_LIGHT_DURATION_MS = 10000;
const FIND_RING_COMMAND_TIMEOUT_MS = 5000;
const FIND_RING_HINT_DURATION_MS = 3000;

const modalPopup = ref<any>(null);
const boundInfo = ref<Record<string, any> | null>(null);
const busyText = ref('');
const lastActionText = ref('');
const singleReadResults = ref<Record<string, string>>({});
const findRingBusy = ref(false);
const isFindingRing = ref(false);
let findRingStopTimer: ReturnType<typeof setTimeout> | null = null;
let findRingHintTimer: ReturnType<typeof setTimeout> | null = null;
let activeFindRingCommandMode: FindRingCommandMode | null = null;

type FindRingCommandMode = 'rw-health-control' | 'oxygen-measure';

const isBusy = computed(() => Boolean(busyText.value) || controller.isRefreshingBusinessData.value || controller.isRestoringDevice.value);
const findRingStatusText = computed(() => {
  if (findRingBusy.value) return '处理中';
  if (isFindingRing.value) return '查找中';
  return '';
});
const connectionText = computed(() => (ring.isConnected.value ? '已连接' : '未连接'));
const deviceName = computed(() => getFirstDeviceInfoValue(ring.currentDeviceName.value, boundInfo.value?.deviceName, boundInfo.value?.name));
const deviceIdentity = computed(() => {
  const currentTail = ring.currentDeviceTail.value;
  if (currentTail && currentTail !== '-') return currentTail;
  return getBoundRingIdentityTail(boundInfo.value);
});
const latestBattery = computed(() => findLatestReceivedData('battery'));
const latestFirmware = computed(() => findLatestReceivedData(['firmware_version', 'hardwareVersion', 'softwareVersion']));
const batteryValue = computed(() =>
  getFirstMetricValue(
    ring.metrics.value.battery,
    ring.healthData.value?.battery,
    ring.healthData.value?.batteryValue,
    userStore.latestMetrics?.battery,
    userStore.healthData?.battery,
    latestBattery.value?.metrics?.battery,
    latestBattery.value?.metrics?.value,
    latestBattery.value?.battery,
    latestBattery.value?.value
  )
);
const batteryStatusRaw = computed(() =>
    getFirstMetricValue(
      ring.metrics.value.batteryStatus,
      ring.metrics.value.chargingStatusText,
      ring.healthData.value?.batteryStatus,
      ring.healthData.value?.chargingStatusText,
      userStore.healthData?.batteryStatus,
      userStore.healthData?.chargingStatusText,
      latestBattery.value?.metrics?.batteryStatus,
      latestBattery.value?.metrics?.chargingStatusText,
      latestBattery.value?.batteryStatus,
      latestBattery.value?.chargingStatusText
  )
);
const batteryText = computed(
  () =>
    normalizeDeviceInfoDisplayText(
      singleReadResults.value.battery || formatBatteryStatusForDisplay(batteryValue.value, batteryStatusRaw.value, DEVICE_INFO_EMPTY_TEXT)
    )
);
const batteryStatusText = computed(() => normalizeDeviceInfoDisplayText(normalizeHealthText(batteryStatusRaw.value, DEVICE_INFO_EMPTY_TEXT)));
const firmwareText = computed(
  () =>
    getFirstDeviceInfoValue(
      singleReadResults.value.firmware,
      ring.metrics.value.firmwareVersion,
      ring.metrics.value.hardwareVersion,
      ring.healthData.value?.firmwareVersion,
      ring.healthData.value?.hardwareVersion,
      userStore.latestMetrics?.firmwareVersion,
      userStore.latestMetrics?.hardwareVersion,
      userStore.healthData?.firmwareVersion,
      userStore.healthData?.hardwareVersion,
      latestFirmware.value?.metrics?.firmwareVersion,
      latestFirmware.value?.metrics?.hardwareVersion,
      latestFirmware.value?.firmwareVersion,
      latestFirmware.value?.hardwareVersion
    )
);
const softwareText = computed(
  () =>
    getFirstDeviceInfoValue(
      singleReadResults.value.software,
      ring.metrics.value.softwareVersion,
      ring.metrics.value.uiVersion,
      ring.healthData.value?.softwareVersion,
      ring.healthData.value?.uiVersion,
      userStore.latestMetrics?.softwareVersion,
      userStore.latestMetrics?.uiVersion,
      userStore.healthData?.softwareVersion,
      userStore.healthData?.uiVersion,
      latestFirmware.value?.metrics?.softwareVersion,
      latestFirmware.value?.metrics?.uiVersion,
      latestFirmware.value?.softwareVersion,
      latestFirmware.value?.uiVersion
    )
);
const ringSizeText = computed(() => getFirstDeviceInfoValue(boundInfo.value?.deviceSize, boundInfo.value?.ringSize));
const deviceVersionText = computed(() => getFirstDeviceInfoValue(boundInfo.value?.deviceVersion, boundInfo.value?.version));
const serialText = computed(() => getFirstDeviceInfoValue(boundInfo.value?.sn, boundInfo.value?.serialNumber));
const deviceMacText = computed(() =>
  getFirstDeviceInfoValue(
    getDeviceMacFromInfo(ring.deviceInfo.value as Record<string, any> | null | undefined),
    getDeviceMacFromInfo(ringStore.deviceInfo as Record<string, any> | null | undefined),
    getDeviceMacFromInfo(userStore.deviceInfo as Record<string, any> | null | undefined),
    getDeviceMacFromInfo(boundInfo.value),
    ring.normalMac.value,
    ring.iosMacId.value,
    userStore.normalMac,
    userStore.iosMacId,
    getBoundRingIdentity(boundInfo.value),
    ring.currentDeviceIdentity.value
  )
);
const deviceNameText = computed(() => deviceName.value || DEVICE_INFO_EMPTY_TEXT);
const macText = computed(() => deviceMacText.value || DEVICE_INFO_EMPTY_TEXT);
const refreshStatusText = computed(() => {
  if (busyText.value) return busyText.value;
  if (controller.refreshFailedText.value) return controller.refreshFailedText.value;
  return ring.businessDataFreshnessText.value;
});
const readStatusText = computed(() => lastActionText.value || controller.refreshFailedText.value || '');

const summarizeDevice = (device: Record<string, any> | null | undefined) => ({
  deviceId: device?.deviceId,
  name: device?.deviceName || device?.name || device?.localName || device?.displayName,
  protocol: device?.protocol,
  uniMacId: device?.uniMacId,
  mac: device?.mac || device?.advertis?.macInfo,
  serviceId: device?.serviceId,
  cmdCharId: device?.cmdCharId,
  dataServiceId: device?.dataServiceId,
  dataCharId: device?.dataCharId,
  notifyEnabled: device?.notifyEnabled
});

const getDevicePageSnapshot = () => ({
  buildTag: RW_DIAGNOSTIC_BUILD_TAG,
  page: 'device',
  connected: ring.isConnected.value,
  ready: controller.isReady.value,
  isBusy: isBusy.value,
  busyText: busyText.value,
  connectionText: connectionText.value,
  deviceName: deviceName.value,
  deviceIdentity: deviceIdentity.value,
  batteryText: batteryText.value,
  batteryStatusText: batteryStatusText.value,
  firmwareText: firmwareText.value,
  softwareText: softwareText.value,
  refreshStatusText: refreshStatusText.value,
  lastActionText: lastActionText.value,
  currentDevice: summarizeDevice(ring.deviceInfo.value as Record<string, any> | null | undefined),
  storeDevice: summarizeDevice(ringStore.deviceInfo as Record<string, any> | null | undefined),
  userDevice: summarizeDevice(userStore.deviceInfo as Record<string, any> | null | undefined),
  boundDevice: summarizeDevice(boundInfo.value)
});

const appendDeviceDiagnosticLog = (event: string, details: Record<string, any> = {}) => {
  appendRingDiagnosticLog('RW DEVICE', event, {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    ...details
  });
};

const loadBoundInfo = async () => {
  if (!userStore.token) return;
  try {
    const info = await getBindInfo();
    boundInfo.value = info || null;
    appendDeviceDiagnosticLog('bound-info-loaded', {
      hasBoundIdentity: hasBoundRingIdentity(info),
      boundDevice: summarizeDevice(info || null)
    });
    if (!hasBoundRingIdentity(info) && !ring.isConnected.value) {
      await clearFrontendRingBindingState(userStore, ringStore);
    }
  } catch (error) {
    appendDeviceDiagnosticLog('bound-info-load-failed', {
      message: formatBleErrorMessage(error, '绑定信息读取失败'),
      snapshot: getDevicePageSnapshot()
    });
  }
};

const ensureDeviceReady = async () => {
  if (controller.isReady.value) return true;
  return controller.restoreLastBusinessDevice({ refreshAfterRestore: false });
};

const refreshDeviceInfo = async () => {
  if (isBusy.value) return;
  const activeHistoryExclusive = getLegacyBleHistoryExclusiveSnapshot();
  if (activeHistoryExclusive.active) {
    lastActionText.value = '同步中，设备信息稍后刷新';
    appendDeviceDiagnosticLog('device-info-refresh-skip-history-exclusive', {
      exclusive: activeHistoryExclusive,
      snapshot: getDevicePageSnapshot()
    });
    return;
  }
  busyText.value = '读取设备信息中';
  lastActionText.value = '';
  const startedAt = Date.now();
  appendDeviceDiagnosticLog('device-info-refresh-start', {
    snapshot: getDevicePageSnapshot()
  });
  try {
    const ready = await ensureDeviceReady();
    appendDeviceDiagnosticLog('device-info-refresh-ready', {
      ready,
      snapshot: getDevicePageSnapshot()
    });
    if (!ready) throw new Error('设备未连接，请重新连接后再试');
    const refreshResult = await controller.refreshDeviceInfoData();
    const skippedByHistoryExclusive = refreshResult.failed.some((item) => item.step === 'history-exclusive');
    if (skippedByHistoryExclusive) {
      lastActionText.value = '同步中，设备信息稍后刷新';
      appendDeviceDiagnosticLog('device-info-refresh-result', {
        skippedByHistoryExclusive,
        lastActionText: lastActionText.value,
        lastRefreshResult: controller.lastRefreshResult.value,
        snapshot: getDevicePageSnapshot()
      });
      return;
    }
    await waitForDeviceInfoSnapshot(startedAt, DEVICE_INFO_SNAPSHOT_WAIT_MS);
    lastActionText.value = batteryValue.value != null || firmwareText.value !== '-' ? '电量/版本已更新' : '暂未获取到设备信息，请稍后刷新';
    appendDeviceDiagnosticLog('device-info-refresh-result', {
      lastActionText: lastActionText.value,
      lastRefreshResult: controller.lastRefreshResult.value,
      snapshot: getDevicePageSnapshot()
    });
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '设备信息读取失败');
    appendDeviceDiagnosticLog('device-info-refresh-failed', {
      message: lastActionText.value,
      snapshot: getDevicePageSnapshot()
    });
    uni.showToast({ title: lastActionText.value, icon: 'none' });
  } finally {
    busyText.value = '';
    await loadBoundInfo();
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDeviceInfoSnapshot = async (since: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasBattery = getBatteryReadingValue(findLatestSharedData(['battery'], since, () => true)) != null || batteryValue.value != null;
    const hasVersion = firmwareText.value !== '-' || softwareText.value !== '-';
    if (hasBattery && hasVersion) return;
    await sleep(200);
  }
};

const waitForDirectParsedData = (
  predicate: (parsed: Record<string, any>) => boolean,
  timeoutMs: number
): Promise<Record<string, any>> | null => {
  const waitForParsedData = (controller as unknown as {
    waitForParsedData?: (predicate: (parsed: Record<string, any>) => boolean, timeoutMs?: number) => Promise<Record<string, any>>;
  }).waitForParsedData;
  if (typeof waitForParsedData !== 'function') return null;
  const task = waitForParsedData(predicate, timeoutMs);
  task.catch(() => undefined);
  return task;
};

const waitForFirstSuccessful = async <T,>(tasks: Array<Promise<T> | null | undefined>, fallbackMessage: string) => {
  const pending = tasks.filter(Boolean) as Promise<T>[];
  if (pending.length === 0) throw new Error(fallbackMessage);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let rejectedCount = 0;
    let lastError: unknown = null;

    pending.forEach((task) => {
      task
        .then((value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        })
        .catch((error) => {
          rejectedCount += 1;
          lastError = error;
          if (settled || rejectedCount < pending.length) return;
          settled = true;
          reject(lastError instanceof Error ? lastError : new Error(fallbackMessage));
        });
    });
  });
};

const readBatteryOnly = async () => {
  if (isBusy.value) return;
  busyText.value = '读取电量中';
  lastActionText.value = '';
  const startedAt = Date.now();
  appendDeviceDiagnosticLog('battery-read-start', {
    snapshot: getDevicePageSnapshot()
  });
  try {
    const ready = await ensureDeviceReady();
    if (!ready) throw new Error('设备未连接，请重新连接后再试');
    const directWaiter = waitForDirectParsedData((parsed) => parsed.type === 'battery' && getBatteryReadingValue(parsed) != null, 9000);
    const sharedWaiter = waitForSharedBattery(startedAt, 9000);
    sharedWaiter.catch(() => undefined);
    await controller.sendBatteryCommand();
    const parsed = await waitForFirstSuccessful<Record<string, any>>([directWaiter, sharedWaiter], '电量读取超时，请靠近戒指后重试');
    const value = getBatteryReadingValue(parsed);
    const status = getBatteryReadingStatus(parsed);
    const displayValue = formatBatteryStatusForDisplay(value, status, '-');
    if (value == null && displayValue === '-') throw new Error('设备返回的电量格式无效');
    singleReadResults.value = { ...singleReadResults.value, battery: displayValue };
    lastActionText.value = `电量读取成功：${displayValue}`;
    appendDeviceDiagnosticLog('battery-read-result', {
      value,
      parsed,
      snapshot: getDevicePageSnapshot()
    });
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '电量读取失败');
    appendDeviceDiagnosticLog('battery-read-failed', {
      message: lastActionText.value,
      snapshot: getDevicePageSnapshot()
    });
  } finally {
    busyText.value = '';
  }
};

const readVersionOnly = async () => {
  if (isBusy.value) return;
  busyText.value = '读取版本中';
  lastActionText.value = '';
  appendDeviceDiagnosticLog('version-read-start', {
    snapshot: getDevicePageSnapshot()
  });
  try {
    const ready = await ensureDeviceReady();
    if (!ready) throw new Error('设备未连接，请重新连接后再试');
    const versionCommands = [controller.sendFirmwareVersion(), controller.sendSoftwareVersion()];
    await Promise.allSettled(versionCommands);
    await waitForVersionSnapshot(8000);
    lastActionText.value = `版本读取成功：${firmwareText.value || '-'} / ${softwareText.value || '-'}`;
    appendDeviceDiagnosticLog('version-read-result', {
      firmware: firmwareText.value,
      software: softwareText.value,
      snapshot: getDevicePageSnapshot()
    });
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '版本读取失败');
    appendDeviceDiagnosticLog('version-read-failed', {
      message: lastActionText.value,
      snapshot: getDevicePageSnapshot()
    });
  } finally {
    busyText.value = '';
  }
};

const waitForVersionSnapshot = async (timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (firmwareText.value !== '-' || softwareText.value !== '-') return;
    await sleep(200);
  }
  throw new Error('版本读取超时，请靠近戒指后重试');
};

const goConnect = () => {
  uni.navigateTo({ url: '/pagesA/mines/connectDevice' });
};

const clearFindRingStopTimer = () => {
  if (findRingStopTimer) {
    clearTimeout(findRingStopTimer);
    findRingStopTimer = null;
  }
};

const clearFindRingHintTimer = () => {
  if (findRingHintTimer) {
    clearTimeout(findRingHintTimer);
    findRingHintTimer = null;
  }
};

const setFindRingHint = (message: string, durationMs = FIND_RING_HINT_DURATION_MS) => {
  clearFindRingHintTimer();
  lastActionText.value = message;
  if (!message || durationMs <= 0) return;
  findRingHintTimer = setTimeout(() => {
    if (lastActionText.value === message) {
      lastActionText.value = '';
    }
    findRingHintTimer = null;
  }, durationMs);
};

const resolveCurrentFindRingDevice = (): RingDeviceInfo => {
  const source =
    (ring.deviceInfo.value as RingDeviceInfo | null | undefined) ||
    (ringStore.deviceInfo as RingDeviceInfo | null | undefined) ||
    (userStore.deviceInfo as RingDeviceInfo | null | undefined) ||
    (boundInfo.value as RingDeviceInfo | null | undefined) ||
    {};
  return source as RingDeviceInfo;
};

const resolveCurrentFindRingProtocol = () => {
  const device = resolveCurrentFindRingDevice();
  return resolveRingProtocol(device);
};

const resolveCurrentFindRingName = () => {
  const device = resolveCurrentFindRingDevice() as Record<string, any>;
  return `${deviceName.value || device.deviceName || device.name || device.localName || device.displayName || ''}`.trim();
};

const resolveFindRingCommandMode = (): FindRingCommandMode => {
  const protocol = resolveCurrentFindRingProtocol();
  const name = resolveCurrentFindRingName().toUpperCase();
  if (protocol === 'rw' && !name.startsWith('QK') && !name.includes('L19')) return 'rw-health-control';
  return 'oxygen-measure';
};

const withFindRingCommandTimeout = <T,>(task: Promise<T>, timeoutMs = FIND_RING_COMMAND_TIMEOUT_MS) =>
  Promise.race([
    task,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('查找戒指指令超时')), timeoutMs);
    })
  ]);

const sendFindRingRedLightCommand = async (enabled: boolean) => {
  const ready = await ensureDeviceReady();
  if (!ready) throw new Error('设备未连接，请重新连接后再查找戒指');
  const protocol = resolveCurrentFindRingProtocol();
  const deviceName = resolveCurrentFindRingName();
  const commandMode = enabled ? resolveFindRingCommandMode() : activeFindRingCommandMode || resolveFindRingCommandMode();
  appendDeviceDiagnosticLog('find-ring-command-send-start', {
    enabled,
    protocol,
    commandMode,
    deviceName,
    snapshot: getDevicePageSnapshot()
  });
  if (commandMode === 'oxygen-measure') {
    if (!enabled) {
      appendDeviceDiagnosticLog('find-ring-command-stop-skip', {
        reason: 'oxygen-measure has no explicit stop command',
        protocol,
        deviceName
      });
      return commandMode;
    }
    await withFindRingCommandTimeout(controller.sendOxyGenCommand(), FIND_RING_COMMAND_TIMEOUT_MS);
  } else {
    await withFindRingCommandTimeout(controller.controlRwHealthData('blood_oxygen', enabled), FIND_RING_COMMAND_TIMEOUT_MS);
  }
  appendDeviceDiagnosticLog('find-ring-command-send-result', {
    enabled,
    protocol,
    commandMode,
    deviceName,
    snapshot: getDevicePageSnapshot()
  });
  return commandMode;
};

const stopFindRingRedLight = async (options: { silent?: boolean; reason?: string } = {}) => {
  clearFindRingStopTimer();
  if (!isFindingRing.value && !findRingBusy.value) return;
  isFindingRing.value = false;
  findRingBusy.value = true;
  appendDeviceDiagnosticLog('find-ring-red-light-stop-start', {
    reason: options.reason || 'manual',
    snapshot: getDevicePageSnapshot()
  });
  try {
    await sendFindRingRedLightCommand(false);
    if (!options.silent) {
      setFindRingHint('戒指查找已结束');
      uni.showToast({ title: '查找已结束', icon: 'none' });
    }
    appendDeviceDiagnosticLog('find-ring-red-light-stop-result', {
      reason: options.reason || 'manual',
      snapshot: getDevicePageSnapshot()
    });
  } catch (error) {
    const message = formatBleErrorMessage(error, '关闭戒指红灯失败');
    if (!options.silent) {
      lastActionText.value = message;
      uni.showToast({ title: message, icon: 'none' });
    }
    appendDeviceDiagnosticLog('find-ring-red-light-stop-failed', {
      reason: options.reason || 'manual',
      message,
      snapshot: getDevicePageSnapshot()
    });
  } finally {
    isFindingRing.value = false;
    findRingBusy.value = false;
    activeFindRingCommandMode = null;
    if (options.silent) {
      setFindRingHint('');
    }
  }
};

const startFindRingRedLight = async () => {
  clearFindRingStopTimer();
  clearFindRingHintTimer();
  findRingBusy.value = true;
  lastActionText.value = '';
  appendDeviceDiagnosticLog('find-ring-red-light-start', {
    durationMs: FIND_RING_RED_LIGHT_DURATION_MS,
    snapshot: getDevicePageSnapshot()
  });
  try {
    activeFindRingCommandMode = await sendFindRingRedLightCommand(true);
    isFindingRing.value = true;
    setFindRingHint('查找指令已发送，请观察戒指红灯，10秒后自动结束');
    uni.showToast({ title: '查找指令已发送', icon: 'none' });
    findRingStopTimer = setTimeout(() => {
      void stopFindRingRedLight({ silent: true, reason: 'auto-timeout' });
    }, FIND_RING_RED_LIGHT_DURATION_MS);
    appendDeviceDiagnosticLog('find-ring-red-light-result', {
      durationMs: FIND_RING_RED_LIGHT_DURATION_MS,
      snapshot: getDevicePageSnapshot()
    });
  } catch (error) {
    isFindingRing.value = false;
    activeFindRingCommandMode = null;
    const message = formatBleErrorMessage(error, '查找戒指失败，请靠近戒指后重试');
    setFindRingHint(message, 5000);
    uni.showToast({ title: message, icon: 'none' });
    appendDeviceDiagnosticLog('find-ring-red-light-failed', {
      message,
      snapshot: getDevicePageSnapshot()
    });
  } finally {
    findRingBusy.value = false;
  }
};

const jumpSearch = async () => {
  if (findRingBusy.value) return;
  if (isFindingRing.value) {
    await stopFindRingRedLight({ reason: 'manual-toggle' });
    return;
  }
  if (isBusy.value) {
    uni.showToast({ title: '设备正在处理，请稍后再试', icon: 'none' });
    return;
  }
  await startFindRingRedLight();
};

const copyDeviceId = () => {
  const value = deviceMacText.value;
  if (!value || value === DEVICE_INFO_EMPTY_TEXT) {
    uni.showToast({ title: '暂无设备ID', icon: 'none' });
    return;
  }
  uni.setClipboardData({
    data: String(value),
    success: () => uni.showToast({ title: '已复制', icon: 'success' })
  });
};

const isIOS = () => uni.getSystemInfoSync().platform === 'ios';

const openConfirmBind = () => {
  modalPopup.value?.open?.();
};

const confirmBind = async () => {
  busyText.value = '解绑中';
  try {
    userStore.updateIsUnbinding(true);
    await controller.disconnect().catch(() => undefined);
    const mac = isIOS() ? userStore.normalMac || boundInfo.value?.mac || '' : userStore.deviceInfo?.deviceId || boundInfo.value?.mac || '';
    if (mac) {
      await unbind({ mac }).catch(() => undefined);
    }
    await clearFrontendRingBindingState(userStore, ringStore);
    boundInfo.value = null;
    singleReadResults.value = {};
    lastActionText.value = '已解绑';
    uni.showToast({ title: '已解绑', icon: 'success' });
  } finally {
    busyText.value = '';
    setTimeout(() => {
      userStore.updateIsUnbinding(false);
    }, 3000);
  }
};

const formatMetricValue = (value: unknown, suffix = '') => {
  if (value == null || value === '') return '-';
  const text = String(value).trim();
  if (suffix === '%') {
    if (isBatteryChargedLike(value)) return formatBatteryPercentForDisplay(100);
    return formatBatteryPercentForDisplay(value, '-');
  }
  if (!suffix || text.endsWith(suffix)) return text;
  return `${text}${suffix}`;
};

const getFirstMetricValue = (...values: any[]) => values.find((value) => value != null && value !== '');
const EMPTY_DEVICE_INFO_VALUE_TEXTS = new Set(['-', '--', '未连接', '未连接戒指']);
const SEPARATED_BLE_MAC_TEXT = /^[0-9a-fA-F]{2}([:-][0-9a-fA-F]{2}){2,5}$/;

const normalizeDeviceInfoDisplayText = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text && !EMPTY_DEVICE_INFO_VALUE_TEXTS.has(text) ? text : DEVICE_INFO_EMPTY_TEXT;
};

const getFirstDeviceInfoValue = (...values: any[]) => {
  const value = values.find((item) => normalizeDeviceInfoDisplayText(item) !== DEVICE_INFO_EMPTY_TEXT);
  return normalizeDeviceInfoDisplayText(value);
};

const getSeparatedBleMacValue = (value: unknown) => {
  const text = normalizeDeviceInfoDisplayText(value);
  return SEPARATED_BLE_MAC_TEXT.test(text) ? text : '';
};

const getDeviceMacFromInfo = (device: Record<string, any> | null | undefined) =>
  getFirstDeviceInfoValue(
    device?.mac,
    device?.deviceMac,
    device?.macAddress,
    device?.bleMac,
    device?.bluetoothMac,
    device?.advertis?.macInfo,
    device?.advertis?.mac,
    device?.advertis?.macAddress,
    device?.raw?.mac,
    device?.raw?.deviceMac,
    device?.raw?.macAddress,
    device?.raw?.advertis?.macInfo,
    getSeparatedBleMacValue(device?.uniMacId),
    getSeparatedBleMacValue(device?.deviceId)
  );

const isBatteryChargedLike = (value: unknown) => {
  if (value == null || value === '') return false;
  const rawText = String(value).trim().toLowerCase();
  const normalizedText = normalizeHealthText(value, '').toLowerCase();
  const combined = `${rawText} ${normalizedText}`;
  return (
    /charged|charge[_\s-]?full|\bfull\b/.test(combined) ||
    rawText.includes('\u5145\u7535\u5b8c\u6210') ||
    rawText.includes('\u5df2\u5145\u6ee1')
  );
};

const getLatestDataTypeKeys = (item: Record<string, any>) =>
  [item?.type, item?.sourceType, item?.dataType].filter((value): value is string => typeof value === 'string' && value.length > 0);

const findLatestReceivedData = (type: string | string[]) => {
  const types = Array.isArray(type) ? type : [type];
  const sources = [ring.normalizedData.value, ring.receivedData.value, userStore.receivedData || []];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index] as Record<string, any>;
      if (getLatestDataTypeKeys(item).some((typeKey) => types.includes(typeKey))) return item;
    }
  }
  return null;
};

const getRealtimeDataTimestamp = (item: Record<string, any>) => {
  const value = getFirstMetricValue(
    item.collectedAt,
    item.receivedAt,
    item.parsedAt,
    item.timestamp,
    item.raw?.receivedAt,
    item.raw?.parsedAt,
    item.raw?.timestamp
  );
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getBatteryReadingValue = (item: Record<string, any> | null) => {
  if (!item) return null;
  const rawValue = getFirstMetricValue(
    item.metrics?.battery,
    item.metrics?.batteryValue,
    item.metrics?.value,
    item.battery,
    item.batteryValue,
    item.value,
    item.raw?.battery,
    item.raw?.batteryValue,
    item.raw?.value
  );
  if (isBatteryChargedLike(rawValue)) return 100;
  const value = Number(String(rawValue ?? '').replace('%', '').trim());
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
};

const getBatteryReadingStatus = (item: Record<string, any> | null) =>
  getFirstMetricValue(
    item?.metrics?.chargingStatusText,
    item?.metrics?.batteryStatus,
    item?.chargingStatusText,
    item?.chargeStatusText,
    item?.batteryStatus,
    item?.status,
    item?.raw?.chargingStatusText,
    item?.raw?.batteryStatus,
    item?.raw?.status
  );

const findLatestSharedData = (
  types: string[],
  since: number,
  predicate: (item: Record<string, any>) => boolean
) => {
  const sources = [ring.normalizedData.value, ring.receivedData.value, userStore.receivedData || []];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index] as Record<string, any>;
      if (!getLatestDataTypeKeys(item).some((typeKey) => types.includes(typeKey))) continue;
      if (getRealtimeDataTimestamp(item) < since) continue;
      if (predicate(item)) return item;
    }
  }
  return null;
};

const waitForSharedBattery = async (since: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const parsed = findLatestSharedData(
      ['battery'],
      since,
      (item) => getBatteryReadingValue(item) != null || isBatteryChargingLike(getBatteryReadingValue(item), getBatteryReadingStatus(item))
    );
    if (parsed) return parsed;
    await sleep(200);
  }
  throw new Error('电量读取超时，请靠近戒指后重试');
};

onShow(async () => {
  appendDeviceDiagnosticLog('page-show', {
    snapshot: getDevicePageSnapshot()
  });
  await loadBoundInfo();
  if (ring.isConnected.value && (batteryValue.value == null || firmwareText.value === '-')) {
    void refreshDeviceInfo();
    return;
  }
  appendDeviceDiagnosticLog('page-show-ready', {
    snapshot: getDevicePageSnapshot()
  });
});

onUnload(() => {
  if (isFindingRing.value) {
    void stopFindRingRedLight({ silent: true, reason: 'page-unload' });
    return;
  }
  clearFindRingStopTimer();
  clearFindRingHintTimer();
  activeFindRingCommandMode = null;
});
</script>

<template>
  <view class="p-30">
    <view class="mb-50">
      <view class="mb-50 fs-36 pl-40 pr-40">设置设备</view>
      <view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30" :class="{ 'find-ring-active': isFindingRing }" @tap="jumpSearch">
          <view class="fs-36">戒指查找</view>
          <view class="flex ai-center">
            <view v-if="findRingStatusText" class="find-ring-status mr-20">{{ findRingStatusText }}</view>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center" @click="openConfirmBind">
          <view class="fs-36">解除绑定</view>
          <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
        </view>
      </view>
    </view>

    <uv-modal ref="modalPopup" :showCancelButton="true" align="center" :content="content" @confirm.stop="confirmBind"></uv-modal>

    <view>
      <view class="mb-50 fs-36 pl-40 pr-40">设备信息</view>
      <view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>连接状态</view>
          <view>{{ connectionText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>电量</view>
          <view>{{ batteryText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>电量状态</view>
          <view>{{ batteryStatusText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>戒指大小</view>
          <view>{{ ringSizeText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>设备版本</view>
          <view>{{ deviceVersionText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>固件版本</view>
          <view>{{ firmwareText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>软件版本</view>
          <view>{{ softwareText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>序列号</view>
          <view>{{ serialText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>设备名称</view>
          <view>{{ deviceNameText }}</view>
        </view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
          <view>Mac地址</view>
          <view class="flex ai-center">
            <view>{{ macText }}</view>
            <view class="copy-button" @click.stop="copyDeviceId">复制</view>
          </view>
        </view>
        <view class="device-action">
          <uv-button
            :text="isBusy ? '读取中' : '刷新设备信息'"
            :loading="isBusy"
            :disabled="isBusy"
            shape="circle"
            color="#2E70FC"
            :customTextStyle="{ 'font-size': '32rpx' }"
            :customStyle="{ padding: '40rpx 0' }"
          ></uv-button>
          <!-- TODO: 后续恢复设备读取时，再接回 refreshDeviceReadings。 -->
          <view v-if="readStatusText" class="device-status mt-20 fs-28 t-979797">{{ readStatusText }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.device-action {
  padding: 0 40rpx 40rpx;
}

.device-status {
  line-height: 40rpx;
  text-align: center;
}

.find-ring-active {
  box-shadow: 0 8rpx 20rpx rgba(46, 112, 252, 0.12);
}

.find-ring-status {
  color: #2e70fc;
  font-size: 28rpx;
}

.copy-button {
  margin-left: 16rpx;
  padding: 4rpx 14rpx;
  border: 1rpx solid #2e70fc;
  border-radius: 999rpx;
  color: #2e70fc;
  font-size: 24rpx;
  line-height: 36rpx;
}
</style>
