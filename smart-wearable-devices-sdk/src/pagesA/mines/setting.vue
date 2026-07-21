<!-- 功能设置 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getBindInfo } from '@/common/api/device';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { useRingBusinessData } from '@/composables/useRingBusinessData';
import { formatBleErrorMessage } from '@/utils/bleError';
import { hasBoundRingIdentity } from '@/utils/ringBinding';

const controller = useRingBusinessController();
const ring = useRingBusinessData();
const boundInfo = ref<Record<string, any> | null>(null);
const busyText = ref('');
const lastActionText = ref('');

const isBusy = computed(() => Boolean(busyText.value) || controller.isRestoringDevice.value || controller.isRefreshingBusinessData.value);
const connectionText = computed(() => (ring.isConnected.value ? '已连接' : hasBoundRingIdentity(boundInfo.value) ? '待恢复' : '未绑定'));
const monitorText = computed(() => {
  const seconds = ring.metrics.value.collectPeriodSeconds;
  if (seconds) return `每 ${Math.round(seconds / 60)} 分钟`;
  return ring.metrics.value.monitoringStatus || '未配置';
});
const statusText = computed(() => busyText.value || lastActionText.value || ring.businessDataFreshnessText.value);

const loadBoundInfo = async () => {
  try {
    const info = await getBindInfo();
    boundInfo.value = info || null;
  } catch {
    boundInfo.value = null;
  }
};

const ensureDeviceReady = async () => {
  if (controller.isReady.value) return true;
  return controller.restoreLastBusinessDevice({ refreshAfterRestore: false });
};

const enableMonitoring = async () => {
  if (isBusy.value) return;
  busyText.value = '配置健康监听中';
  lastActionText.value = '';
  try {
    const ready = await ensureDeviceReady();
    if (!ready) throw new Error('设备未连接，请重新连接后再试');
    await controller.enableHealthMonitoring(1800);
    lastActionText.value = '健康监听已配置';
    uni.showToast({ title: '已配置', icon: 'success' });
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '健康监听配置失败');
    uni.showToast({ title: lastActionText.value, icon: 'none' });
  } finally {
    busyText.value = '';
    await loadBoundInfo();
  }
};

const goHistorySync = async () => {
  if (!controller.isReady.value && hasBoundRingIdentity(boundInfo.value)) {
    busyText.value = '恢复设备连接中';
    try {
      await controller.restoreLastBusinessDevice({ refreshAfterRestore: false });
    } catch {
      // The history page owns the final retry and user-facing failure state.
    } finally {
      busyText.value = '';
    }
  }
  uni.navigateTo({ url: '/pagesA/healths/deviceData' });
};

onShow(async () => {
  await loadBoundInfo();
});
</script>

<template>
  <view class="p-30" :style="{ paddingBottom: paddingBottomVal + 'rpx' }">
    <view>
      <view class="mb-50 fs-36 pl-40 pr-40 mb-50">设置目标</view>
      <view>
        <!-- 睡眠时长 -->
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('sleep')">
          <view class="" style="width: 50%">
            <text>睡眠时长</text>
            <text class="t-979797 fs-24">（小时）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ sleepTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <!-- 步数目标 -->
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('step')">
          <view class="" style="width: 50%">
            <text>步数目标</text>
            <text class="t-979797 fs-24">（步数）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ stepTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <!-- 卡路里目标 -->
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('calorie')">
          <view class="" style="width: 60%">
            <text>卡路里目标</text>
            <text class="t-979797 fs-24">（千卡）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ calorieTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <!-- 活动时长目标 -->
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('activity')">
          <view style="width: 80%">
            <text>活动时长目标</text>
            <text class="t-979797 fs-24">（分钟）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ activityDurationTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <!-- 设备采集周期 -->
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('collect')">
          <view class="" style="width: 80%">
            <text>设备采集周期</text>
            <text class="t-979797 fs-24">（分钟）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ collectPeriodTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>
      </view>
    </view>
    <view>
      <view class="mb-50 fs-36 pl-40 pr-40">通用设置</view>
      <view @click="openConfirmBind">
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30">
          <view class="fs-36">恢复出厂设置</view>
          <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
        </view>
      </view>
      <view @click="jumpOtaUpgrade">
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30">
          <view class="fs-36">OTA升级</view>
          <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
        </view>
      </view>
    </view>

    <!-- Picker选择器 -->
    <uv-picker
      ref="pickerRef"
      :defaultIndex="[pickerValue[0]]"
      :title="pickerTitle"
      :columns="pickerColumns"
      v-model="pickerValue"
      @confirm="onPickerConfirm"
      confirmColor="#2e70fc"
    ></uv-picker>

    <uv-modal ref="modalPopup" :showCancelButton="true" align="center" :content="content" @confirm="confirmBind"></uv-modal>
    <view class="purchase-section p-30 demo">
      <view v-if="statusText" class="save-status fs-28 t-979797">{{ statusText }}</view>
      <uv-button
        @click="handleOk"
        :text="isSaving ? '保存中' : '保存'"
        :loading="isSaving"
        :disabled="isSaving"
        shape="circle"
        color="#2e70fc"
      ></uv-button>
      <uv-safe-bottom></uv-safe-bottom>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.purchase-section {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  background: #f1f3f6;
  box-sizing: border-box;
}

.save-status {
  margin-bottom: 16rpx;
  line-height: 40rpx;
  text-align: center;
}
</style>
