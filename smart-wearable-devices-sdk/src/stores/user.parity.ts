import { useUserStore } from './user';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

(globalThis as any).uni = {
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  removeStorageSync: () => undefined
};
(globalThis as any).getApp = () => ({ globalData: {} });

setActivePinia(createPinia());

type UserStoreCompat = ReturnType<typeof useUserStore>;

type LegacyRingUserStoreKeys =
  | 'deviceInfo'
  | 'receivedData'
  | 'healthData'
  | 'latestMetrics'
  | 'localData'
  | 'normalMac'
  | 'iosMacId'
  | 'deviceTime'
  | 'lastReadTimestamp'
  | 'lastMetricUpdateAt'
  | 'isBluetoothReady'
  | 'isListenerRegistered'
  | 'hasRegisteredAdapterListener'
  | 'isManualReconnecting'
  | 'isMinePageButtomClick'
  | 'isUnbinding'
  | 'isSending'
  | 'isConnected'
  | 'isReconnecting'
  | 'isUploading'
  | 'reconnectCount'
  | 'isShowLoginPopup'
  | 'reconnectResult'
  | 'applyLoginResponse'
  | 'updateDeviceInfo'
  | 'updateReceivedData'
  | 'handleParsedData'
  | 'updateNormalMac'
  | 'updateIosMacId'
  | 'updateLastReadTimestamp'
  | 'updateIsBluetoothReady'
  | 'updateIsConnected'
  | 'updateIsListenerRegistered'
  | 'updateHasRegisteredAdapterListener'
  | 'updateIsManualReconnecting'
  | 'updateIsMinePageButtomClick'
  | 'updateIsUnbinding'
  | 'updateIsSending'
  | 'updateReconnectingStatus'
  | 'updateReconnectResult'
  | 'updateUploadingStatus'
  | 'updateReconnectCount'
  | 'updateIsShowLoginPopup'
  | 'setUserInfo';

type MissingLegacyRingUserStoreKeys = Exclude<LegacyRingUserStoreKeys, keyof UserStoreCompat>;

const assertNoMissingLegacyRingUserStoreKeys: MissingLegacyRingUserStoreKeys extends never ? true : never = true;

const userStore = useUserStore();
const userStoreSource = readFileSync(join(process.cwd(), 'src', 'stores', 'user.ts'), 'utf8');

for (const fragment of ['withLoginProfileTimeout', 'user profile refresh timeout', 'await withLoginProfileTimeout(fetchUserInfo())']) {
  if (!userStoreSource.includes(fragment)) {
    throw new Error(`User store login should not block on profile refresh after token is written: ${fragment}`);
  }
}

userStore.updateDeviceInfo({});
userStore.updateReceivedData([]);
userStore.handleParsedData({ type: 'battery', value: 80 } as any);
await nextTick();
if (Number(userStore.latestMetrics.battery) !== 80 || Number(userStore.healthData.battery) !== 80) {
  throw new Error(`User store facade should expose direct parsed battery events: ${JSON.stringify({
    latestMetrics: userStore.latestMetrics,
    healthData: userStore.healthData,
    normalizedData: userStore.normalizedData
  })}`);
}

userStore.normalizedData = [
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'heart_rate',
      value: 72,
      data: [72]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'blood_oxygen',
      value: 98,
      data: [98]
    }
  },
  {
    sourceType: 'active_Temperature',
    metrics: {
      temperature: 36.5
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'hrv',
      value: 52,
      data: [52]
    }
  },
  {
    sourceType: 'rw_health_data',
    metrics: {
      name: 'stress',
      value: 24,
      data: [24]
    }
  },
  {
    sourceType: 'qkeer_v2_step',
    metrics: {
      stepCount: 2048
    }
  }
] as any;
await nextTick();
userStore.updateNormalMac('AA:BB:CC:DD:EE:FF');
userStore.updateIosMacId('ios-device-id');
userStore.updateLastReadTimestamp(1);
userStore.updateIsBluetoothReady(true);
userStore.updateIsConnected(true);
userStore.updateIsListenerRegistered(true);
userStore.updateHasRegisteredAdapterListener(true);
userStore.updateIsManualReconnecting(false);
userStore.updateIsMinePageButtomClick(false);
userStore.updateIsUnbinding(false);
userStore.updateIsSending(false);
userStore.updateReconnectingStatus('1');
userStore.updateReconnectResult(null);
userStore.updateUploadingStatus('2');
userStore.updateReconnectCount(2);
userStore.updateIsShowLoginPopup(false);
userStore.setUserInfo({});
await userStore.applyLoginResponse({
  data: {
    auth: {
      tokenValue: 'nested-token-value'
    }
  }
});

if (userStore.token !== 'nested-token-value' || !userStore.userInfo.id) {
  throw new Error(
    `User store should keep login state from nested token fields even when user profile refresh is unavailable: ${JSON.stringify({
      token: userStore.token,
      userInfo: userStore.userInfo
    })}`
  );
}

if (!userStore.isReconnecting || userStore.uploadingStatus !== 'success' || userStore.reconnectCount !== 2) {
  throw new Error(
    `User store facade should delegate BLE status to ring store: ${JSON.stringify({
      isReconnecting: userStore.isReconnecting,
      uploadingStatus: userStore.uploadingStatus,
      reconnectCount: userStore.reconnectCount
    })}`
  );
}

if (
  userStore.healthData.heartRate !== 72 ||
  userStore.healthData.heart_rate !== 72 ||
  userStore.healthData.bloodOxygen !== 98 ||
  userStore.healthData.bloodOxygenSaturation !== 98 ||
  userStore.healthData.oxygen !== 98 ||
  !`${userStore.healthData.temp}`.includes('36.5') ||
  !`${userStore.healthData.bodyTemperature}`.includes('36.5') ||
  !`${userStore.healthData.skinTemperature}`.includes('36.5') ||
  userStore.healthData.heartRateVariability !== 52 ||
  userStore.healthData.stressIndex !== 24 ||
  userStore.healthData.step !== 2048 ||
  userStore.healthData.step_count !== 2048 ||
  !userStore.lastMetricUpdateAt ||
  userStore.healthData.lastMetricUpdateAt !== userStore.lastMetricUpdateAt
) {
  throw new Error(`User store facade should expose unified legacy healthData aliases: ${JSON.stringify(userStore.healthData)}`);
}

userStore.normalizedData = [
  {
    sourceType: 'hardwareVersion',
    metrics: {
      value: '0.2.2',
      protocol: 'rw'
    }
  },
  {
    sourceType: 'softwareVersion',
    metrics: {
      value: '0A050402',
      protocol: 'rw'
    }
  }
] as any;
await nextTick();

if (
  String(userStore.latestMetrics.firmwareVersion) !== '0.2.2' ||
  String(userStore.latestMetrics.hardwareVersion) !== '0.2.2' ||
  String(userStore.latestMetrics.softwareVersion) !== '0A050402' ||
  String(userStore.latestMetrics.uiVersion) !== '0A050402' ||
  String(userStore.healthData.firmwareVersion) !== '0.2.2' ||
  String(userStore.healthData.hardware_version) !== '0.2.2' ||
  String(userStore.healthData.softwareVersion) !== '0A050402' ||
  String(userStore.healthData.ui_version) !== '0A050402'
) {
  throw new Error(`User store facade should expose RW L19-compatible version alias events to legacy pages: ${JSON.stringify({
    latestMetrics: userStore.latestMetrics,
    healthData: userStore.healthData
  })}`);
}

userStore.updateReceivedData([]);
userStore.handleParsedData({
  type: 'battery',
  protocol: 'rw',
  value: 83,
  status: 'normal'
} as any);
userStore.handleParsedData({
  type: 'hardwareVersion',
  protocol: 'rw',
  value: '0.4.4'
} as any);
userStore.handleParsedData({
  type: 'softwareVersion',
  protocol: 'rw',
  value: '0C070604'
} as any);
await nextTick();

if (
  Number(userStore.latestMetrics.battery) !== 83 ||
  String(userStore.latestMetrics.firmwareVersion) !== '0.4.4' ||
  String(userStore.latestMetrics.hardwareVersion) !== '0.4.4' ||
  String(userStore.latestMetrics.softwareVersion) !== '0C070604' ||
  String(userStore.latestMetrics.uiVersion) !== '0C070604' ||
  Number(userStore.healthData.battery) !== 83 ||
  Number(userStore.healthData.batteryLevel) !== 83 ||
  Number(userStore.healthData.battery_percent) !== 83 ||
  Number(userStore.healthData.electricity) !== 83 ||
  Number(userStore.healthData.power) !== 83 ||
  String(userStore.healthData.firmware_version) !== '0.4.4' ||
  String(userStore.healthData.firmware) !== '0.4.4' ||
  String(userStore.healthData.firmware_ver) !== '0.4.4' ||
  String(userStore.healthData.hardwareVersion) !== '0.4.4' ||
  String(userStore.healthData.hardware) !== '0.4.4' ||
  String(userStore.healthData.hardware_ver) !== '0.4.4' ||
  String(userStore.healthData.software_version) !== '0C070604' ||
  String(userStore.healthData.software) !== '0C070604' ||
  String(userStore.healthData.software_ver) !== '0C070604' ||
  String(userStore.healthData.uiVersion) !== '0C070604'
) {
  throw new Error(`User store facade should normalize direct RW parsed battery/version events for legacy pages: ${JSON.stringify({
    latestMetrics: userStore.latestMetrics,
    healthData: userStore.healthData,
    normalizedData: userStore.normalizedData
  })}`);
}

userStore.localData = [{ unixTime: 1710000000, heartRate: 72 }] as any;
userStore.updateDeviceInfo({});
userStore.updateReceivedData([]);
await nextTick();

if (
  userStore.receivedData.length !== 0 ||
  userStore.normalizedData.length !== 0 ||
  userStore.localData.length !== 0 ||
  userStore.healthData.heartRate != null ||
  userStore.healthData.bloodOxygen != null ||
  userStore.latestMetrics.heartRate != null ||
  userStore.latestMetrics.bloodOxygen != null ||
  userStore.lastMetricUpdateAt !== 0
) {
  throw new Error(
    `Legacy clear calls should clear unified runtime metrics so L19/RW values do not leak after disconnect or switching: ${JSON.stringify({
      receivedData: userStore.receivedData,
      normalizedData: userStore.normalizedData,
      localData: userStore.localData,
      healthData: userStore.healthData,
      latestMetrics: userStore.latestMetrics,
      lastMetricUpdateAt: userStore.lastMetricUpdateAt
    })}`
  );
}

export { assertNoMissingLegacyRingUserStoreKeys };
