<template>
  <!-- 外层容器：控制整体圆角 -->
  <view class="progress-wrapper" :style="customContainerStyle">
    <!-- 内层容器：承载进度条和滑块 -->
    <view class="progress-container">
      <view
        v-if="showNoActive"
        class="progress-bg"
        :style="{
          borderRadius: `${borderRadiusValue}rpx`,
          background: gradient
        }"
      ></view>
      <view
        v-if="showActive"
        class="progress-fill"
        :style="{
          borderRadius: `${borderRadiusValue}rpx`
        }"
      ></view>
      <!-- background: gradient -->
      <view
        v-if="showPercenTage"
        class="uv-percentage-slot"
        :style="{
          left: `${safePercentage}%`
        }"
      >
        <view class="uv-dot"></view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  percentage: {
    type: Number,
    default: 80,
    validator: (val) => val >= 0 && val <= 100
  },
  gradient: {
    type: String,
    default: ''
  },
  customContainerStyle: {
    type: Object,
    default: () => ({
      width: '100%',
      height: '12rpx'
    })
  },
  showPercenTage: {
    type: Boolean,
    default: true
  },
  showNoActive: {
    type: Boolean,
    default: true
  },
  showActive: {
    type: Boolean,
    default: false
  },
  borderRadiusValue: {
    type: Number,
    default: 999
  }
});

const safePercentage = computed(() => {
  return Math.min(Math.max(props.percentage, 0), 100);
});
</script>

<style lang="scss" scoped>
.progress-wrapper {
  position: relative;
  overflow: visible;
}

.progress-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.progress-bg {
  width: 100%;
  height: 100%;
  border-radius: 999rpx;
}

.progress-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 999rpx;
}

.uv-percentage-slot {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  transition: left 0.3s ease;
  box-sizing: border-box;
  height: 30rpx;
  width: 30rpx;
  padding: 4rpx;
  border: 1rpx solid #979797;
  background-color: #fff;
  border-radius: 50%;
  z-index: 10;
}

.uv-dot {
  background-color: #2e70fc;
  height: 100%;
  width: 100%;
  border-radius: 50%;
}
</style>
