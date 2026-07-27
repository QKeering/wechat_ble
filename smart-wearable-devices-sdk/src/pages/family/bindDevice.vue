<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { bindFamilyDevice, bindFamilyRelationDevice, type FamilyDeviceBindPayload } from '@/common/api/family';
import { getBoundRingDevice } from '@/api';
import { getBoundRingIdentity } from '@/utils/ringBinding';
import { getRingBusinessDeviceName, useRingBusinessController } from '@/composables/useRingBusinessController';
import { getRingDeviceStableIdentity } from '@/composables/useRingBleSdk';

const memberId = ref(0);
const relationId = ref(0);
const memberName = ref('');
const mac = ref('');
const deviceName = ref('');
const localDevice = ref<any>(null);
const boundLocalDevice = ref<Record<string, any> | null>(null);
const submitting = ref(false);
const ring = useRingBusinessController();
const scanDevices = computed(() => (ring.businessDevices.value as Record<string, any>[]).filter((device) => !isBoundLocalDevice(device)));
const scanning = computed(() => ring.isScanning.value);
const scanDeviceName = (device: Record<string, any>) => getRingBusinessDeviceName(device as any) || '戒指设备';
const scanDeviceIdentity = (device: Record<string, any>) =>
  getRingDeviceStableIdentity(device as any) || device.uniMacId || device.deviceId || '-';

const normalizeIdentity = (value?: unknown) =>
  String(value || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase();

const getIdentityCandidates = (device?: Record<string, any> | null) => {
  if (!device) return [];
  return [
    getBoundRingIdentity(device),
    getRingDeviceStableIdentity(device as any),
    device?.mac,
    device?.deviceMac,
    device?.advertis?.macInfo,
    device?.uniMacId,
    device?.deviceId
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
};

const hasSameDeviceIdentity = (left?: Record<string, any> | null, right?: Record<string, any> | null) => {
  const leftRaw = getIdentityCandidates(left);
  const rightRaw = getIdentityCandidates(right);
  if (!leftRaw.length || !rightRaw.length) return false;
  if (leftRaw.some((leftId) => rightRaw.includes(leftId))) return true;

  const leftIds = leftRaw.map(normalizeIdentity).filter((value) => value.length >= 6);
  const rightIds = rightRaw.map(normalizeIdentity).filter((value) => value.length >= 6);
  return leftIds.some((leftId) =>
    rightIds.some((rightId) => leftId === rightId || leftId.endsWith(rightId.slice(-6)) || rightId.endsWith(leftId.slice(-6)))
  );
};

const isBoundLocalDevice = (device: Record<string, any>) => {
  const currentBoundDevice = (ring.ringStore?.boundDevice || null) as Record<string, any> | null;
  return hasSameDeviceIdentity(device, boundLocalDevice.value) || hasSameDeviceIdentity(device, currentBoundDevice);
};

const buildPayload = (forceBind = false): FamilyDeviceBindPayload => ({
  memberId: memberId.value || undefined,
  mac: mac.value.trim(),
  deviceId: localDevice.value?.deviceId,
  uniMacId: localDevice.value?.uniMacId,
  protocol: localDevice.value?.protocol,
  advertis: localDevice.value?.advertis,
  deviceName: deviceName.value.trim() || `${memberName.value || '家人'}的设备`,
  forceBind
});

const finishBind = () => {
  uni.showToast({ title: '绑定成功', icon: 'success' });
  setTimeout(() => {
    const relationQuery = relationId.value ? `&relationId=${relationId.value}` : '';
    uni.redirectTo({ url: `/pages/family/memberDetail?memberId=${memberId.value}${relationQuery}` });
  }, 600);
};

const submitBind = async (forceBind = false) => {
  const payload = buildPayload(forceBind);
  if (relationId.value) {
    const result = await bindFamilyRelationDevice(relationId.value, payload);
    memberId.value = Number(result?.id || memberId.value || 0);
    return result;
  }
  return bindFamilyDevice(payload);
};

const confirmForceBind = (message: string) => {
  uni.showModal({
    title: '设备已被绑定',
    content: `${message}。确认后，该设备之后同步的数据会写入 ${memberName.value || '这位家人'} 的健康档案。`,
    confirmText: '确认重绑',
    confirmColor: '#DC2626',
    success: async (res) => {
      if (!res.confirm) return;
      submitting.value = true;
      try {
        await submitBind(true);
        finishBind();
      } finally {
        submitting.value = false;
      }
    }
  });
};

const loadBoundLocalDevice = async () => {
  boundLocalDevice.value = await getBoundRingDevice();
};

const searchDevices = async () => {
  await loadBoundLocalDevice();
  if (scanning.value) {
    await ring.stopScan();
    return;
  }
  try {
    await ring.scanForBusinessDevices();
  } catch (error: any) {
    uni.showToast({ title: String(error?.message || '搜索设备失败，请检查蓝牙'), icon: 'none' });
  }
};

const selectScanDevice = async (device: Record<string, any>) => {
  localDevice.value = device;
  mac.value =
    getRingDeviceStableIdentity(device as any) ||
    device.mac ||
    device.advertis?.macInfo ||
    device.uniMacId ||
    device.deviceId ||
    '';
  deviceName.value = getRingBusinessDeviceName(device as any) || `${memberName.value || '家人'}的设备`;
  await ring.stopScan();
};

const scanCode = async () => {
  try {
    const result = await uni.scanCode({});
    localDevice.value = null;
    mac.value = result.result || '';
    if (!deviceName.value) deviceName.value = `${memberName.value || '家人'}的设备`;
  } catch {
    uni.showToast({ title: '扫码取消或失败', icon: 'none' });
  }
};

const submit = async () => {
  if (!memberId.value && !relationId.value) {
    uni.showToast({ title: '家人信息缺失', icon: 'none' });
    return;
  }
  if (!mac.value.trim()) {
    uni.showToast({ title: '请输入或扫码获取设备 MAC', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await submitBind();
    finishBind();
  } catch (error: any) {
    const message = String(error?.msg || error?.message || error?.data?.msg || '');
    if (message.includes('已绑定其他健康档案')) {
      confirmForceBind(message || '该设备已绑定其他健康档案');
    } else {
      uni.showToast({ title: message || '绑定失败，请稍后重试', icon: 'none' });
    }
  } finally {
    submitting.value = false;
  }
};

onLoad((query: any) => {
  memberId.value = Number(query?.memberId || 0);
  relationId.value = Number(query?.relationId || 0);
  memberName.value = decodeURIComponent(query?.name || '');
  void loadBoundLocalDevice();
  deviceName.value = memberName.value ? `${memberName.value}的设备` : '';
});

onUnload(() => {
  void ring.stopScan();
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="绑定父母设备" bgColor="#f1f3f6"></uv-navbar>

    <view class="intro">
      <view class="intro-title">给{{ memberName || '家人' }}绑定设备</view>
      <view class="intro-desc">绑定后，设备同步的数据会归属到这位家人的健康档案，家人端可查看健康状态。</view>
    </view>

    <view class="form-card">
      <view class="label">设备 MAC / SN</view>
      <input v-model="mac" class="input" placeholder="请输入设备 MAC，或扫码获取" />

      <view class="row-actions">
        <uv-button text="扫码" color="#E8F0FF" :customTextStyle="{ color: '#2E70FC', fontSize: '28rpx' }" :customStyle="{ width: '100%', height: '80rpx' }" @click="scanCode" />
      </view>

      <uv-button
        :text="scanning ? '停止搜索' : '搜索附近设备'"
        color="#E8F0FF"
        :customStyle="{ width: '100%', height: '80rpx', marginTop: '18rpx' }"
        :customTextStyle="{ color: '#2E70FC', fontSize: '28rpx' }"
        @click="searchDevices"
      />

      <view v-if="scanDevices.length" class="scan-list">
        <view
          v-for="device in scanDevices"
          :key="device.deviceId || device.uniMacId || device.mac"
          class="scan-device"
          :class="{ selected: localDevice?.deviceId === device.deviceId }"
          @click="selectScanDevice(device)"
        >
          <view class="scan-main">
            <view class="scan-name">{{ scanDeviceName(device) }}</view>
            <view class="scan-id">{{ scanDeviceIdentity(device) }}</view>
          </view>
          <view class="scan-rssi">{{ device.RSSI ?? device.rssi ?? '' }}</view>
        </view>
      </view>

      <view class="label">设备名称</view>
      <input v-model="deviceName" class="input" placeholder="例如：爸爸的戒指" />
    </view>

    <view class="notice">
      <view class="notice-title">数据归属说明</view>
      <view class="notice-text">如果子女手机给父母设备同步数据，后端会根据设备绑定关系自动写入父母档案，不会混入子女自己的健康数据。</view>
    </view>

    <view class="bottom-action">
      <uv-button :loading="submitting" text="确认绑定" color="#2E70FC" :customStyle="{ height: '96rpx' }" :customTextStyle="{ fontSize: '34rpx' }" @click="submit" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f1f3f6;
  padding: 0 30rpx 140rpx;
  box-sizing: border-box;
}
.intro,
.form-card,
.notice {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 34rpx;
  margin-top: 28rpx;
}
.intro-title {
  font-size: 40rpx;
  font-weight: 800;
  color: #111827;
}
.intro-desc,
.notice-text {
  margin-top: 14rpx;
  color: #6b7280;
  font-size: 28rpx;
  line-height: 1.7;
}
.label {
  margin: 28rpx 0 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: #111827;
  &:first-child {
    margin-top: 0;
  }
}
.input {
  height: 88rpx;
  background: #f8fafc;
  border-radius: 18rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: #111827;
}
.row-actions {
  display: flex;
  margin-top: 18rpx;
}
.scan-list {
  margin-top: 18rpx;
  border-radius: 18rpx;
  overflow: hidden;
  background: #f8fafc;
}
.scan-device {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 24rpx;
  border-bottom: 1rpx solid #e5eaf2;
}
.scan-device:last-child {
  border-bottom: 0;
}
.scan-device.selected {
  background: #e8f0ff;
}
.scan-main {
  min-width: 0;
  flex: 1;
}
.scan-name {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}
.scan-id,
.scan-rssi {
  margin-top: 6rpx;
  color: #8b93a1;
  font-size: 24rpx;
}
.scan-rssi {
  flex-shrink: 0;
  margin: 0 0 0 18rpx;
}
.notice-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #111827;
}
.bottom-action {
  position: fixed;
  left: 30rpx;
  right: 30rpx;
  bottom: 40rpx;
}
</style>
