<script setup>
import { ref, onMounted } from 'vue';
import { useRingBLE } from '@/composables/useRingBLE';
const { devices, connectedDeviceId, receivedData, isScanning, initBluetooth, startScan, stopScan, connectDevice, discoverServicesAndChars, disconnect, sendBatteryCommand } =
  useRingBLE();

onMounted(() => {
  initBluetooth();
});

const handleConnect = async (deviceId) => {
  try {
    await connectDevice(deviceId);
    await discoverServicesAndChars(deviceId);
    uni.showToast({
      title: '连接成功',
      icon: 'success'
    });
  } catch (err) {
    uni.showToast({
      title: '连接失败: ' + err.message,
      icon: 'none'
    });
    disconnect();
  }
};
</script>

<template>
  <view class="container">
    <button v-if="!connectedDeviceId" @click="initBluetooth">初始化蓝牙</button>

    <button v-if="!isScanning && !connectedDeviceId" @click="startScan">开始扫描</button>
    <button v-if="isScanning" @click="stopScan">停止扫描</button>

    <view v-if="devices.length && !connectedDeviceId">
      <text>发现 {{ devices.length }} 个指环设备：</text>
      <view v-for="dev in devices" :key="dev.deviceId" class="device-item">
        <text>{{ dev.name || '新设备' }}</text>
        <button size="mini" @click="handleConnect(dev.deviceId)">连接</button>
      </view>
    </view>

    <view v-if="connectedDeviceId">
      <text>✅ 已连接: {{ connectedDeviceId }}</text>
      <button @click="disconnect">断开连接</button>

      <view class="data-list">
        <view v-for="(item, i) in receivedData" :key="i">
          <text>{{ item.type }}: {{ item.value }}</text>
        </view>
      </view>
    </view>
    <button @click="sendBatteryCommand">获取电池信息</button>
    <text v-if="receivedData.length > 0">电池: {{ receivedData[receivedData.length - 1].value }}%</text>
  </view>
</template>

<style>
.container {
  padding: 20rpx;
}

.device-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10rpx 0;
  border-bottom: 1rpx solid #eee;
}

.data-list {
  margin-top: 20rpx;
  padding: 20rpx;
  background: #f5f5f5;
}
</style>
