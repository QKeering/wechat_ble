<template>
  <view class="flex ai-center jc-between">
    <!-- 戒指图标 -->
    <view>
      <view class="">
        <uv-image src="/static/images/iconFirst.png" width="64rpx" height="64rpx"></uv-image>
      </view>
    </view>
    <!-- 中间部分 -->
    <view class="flex ai-center jc-center flex-1">
      <!-- 线条左 -->
      <view style="width: 100%" class="flex ai-center">
        <view class="ml-10 mr-10 line"></view>
        <!-- loading效果 -->
        <view class="flex fd-c ai-center">
          <view v-if="showLoading === '0'">
            <uv-icon name="close-circle-fill" color="#d31818" size="18"></uv-icon>
          </view>
          <view v-else-if="showLoading === '1'">
            <uv-loading-icon mode="circle" color="#5080fb" size="18"></uv-loading-icon>
          </view>
          <view v-else-if="showLoading === '2'">
            <uv-icon name="checkmark-circle-fill" color="#5080fb" size="18"></uv-icon>
          </view>
          <!-- <view class="text-center" style="font-size: 24rpx; white-space: nowrap">重连{{ userStore.reconnectCount }}</view> -->
        </view>
        <view class="ml-10 mr-10 line"></view>
      </view>
      <!-- 手机图标 -->
      <view class="">
        <uv-image src="/static/images/iconSecound.png" width="64rpx" height="64rpx"></uv-image>
      </view>
      <!-- 线条右 -->
      <view style="width: 100%" class="flex ai-center">
        <view class="ml-10 mr-10 line"></view>
        <!-- loading效果 -->
        <view>
          <view v-if="showLoadingT === '0'">
            <uv-icon name="close-circle-fill" color="#d31818" size="18"></uv-icon>
          </view>
          <view v-else-if="showLoadingT === '1'">
            <uv-loading-icon mode="circle" color="#5080fb" size="18"></uv-loading-icon>
          </view>
          <view v-else-if="showLoadingT === '2'">
            <uv-icon name="checkmark-circle-fill" color="#5080fb" size="18"></uv-icon>
          </view>
          <!-- <view v-if="useUserStore.reconnectCount > 0">第{{ useUserStore.reconnectCount }}次重连</view> -->
          <!-- <view>第{{ useUserStore.reconnectCount }}次重连</view> -->
        </view>
        <view class="ml-10 mr-10 line"></view>
      </view>
    </view>
    <!-- 上传图标 -->
    <view class="">
      <uv-image src="/static/images/iconThird.png" width="64rpx" height="64rpx"></uv-image>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useUserStore } from '@/stores/user';
const userStore = useUserStore();
// 接收 props
const props = defineProps({
  // 当前步骤索引
  modelValue: {
    type: Number,
    default: 0
  }
});

const showLoading = ref('0');
const showLoadingT = ref('0');
// 监听 modelValue 变化
watch(
  () => props.modelValue,
  (newValue) => {
    // 根据新值更新 showLoading
    showLoading.value = newValue === 0;
    showLoadingT.value = newValue === 1;
  }
);
// 监听 isReconnecting 变化
watch(
  () => userStore.isReconnecting,
  (newValue) => {
    // 根据新值更新 showLoading
    showLoading.value = newValue;
  }
);
// 监听 isUploading 变化
watch(
  () => userStore.isUploading,
  (newValue) => {
    // 根据新值更新 showLoading
    showLoadingT.value = newValue;
  }
);
</script>

<style lang="scss" scoped>
.line {
  height: 5rpx;
  width: 100%;
  background-color: #6c89cf;
}
</style>
