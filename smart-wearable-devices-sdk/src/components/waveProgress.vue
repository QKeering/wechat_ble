<template>
  <view class="wave-progress">
    <view class="progress-bar" :style="{ height: height + 'px' }">
      <view
        class="progress-bg"
        :style="{
          height: height + 'px',
          borderRadius: height / 2 + 'px'
        }"
      ></view>

      <view
        class="progress-fill"
        :style="{
          width: percentage + '%',
          height: height + 'px',
          borderRadius: height / 2 + 'px',
          background: fillColor
        }"
      >
        <!-- 修改波浪层，只显示在填充部分 -->
        <view
          class="wave-layer"
          :style="{
            animationDuration: waveSpeed + 's',
            background: waveColor
          }"
        ></view>

        <view
          class="wave-layer wave-layer-2"
          :style="{
            animationDuration: waveSpeed * 1.5 + 's',
            background: waveColor2 || waveColor
          }"
        ></view>
      </view>
    </view>

    <!-- 可选：显示百分比文本 -->
    <view v-if="showText" class="progress-text">{{ percentage }}%</view>
  </view>
</template>

<script setup lang="ts">
interface Props {
  percentage: number; // 进度百分比 0-100
  height?: number; // 进度条高度
  fillColor?: string; // 填充颜色
  waveColor?: string; // 波浪颜色
  waveColor2?: string; // 第二层波浪颜色
  waveSpeed?: number; // 波浪速度
  showText?: boolean; // 是否显示文本
}

withDefaults(defineProps<Props>(), {
  percentage: 0,
  height: 4,
  fillColor: 'linear-gradient(90deg, #4C76F1, #6B8EFF)',
  waveColor: 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.1))',
  waveSpeed: 2,
  showText: false
});
</script>

<style scoped>
.wave-progress {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.progress-bar {
  position: relative;
  flex: 1;
  border-radius: 4rpx;
  overflow: hidden;
}

.progress-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  background: #f0f0f0;
  border-radius: 4rpx;
}

.progress-fill {
  position: relative;
  transition: width 0.3s ease;
  overflow: hidden;
  border-radius: 4rpx;
  z-index: 1;
}

.wave-layer {
  position: absolute;
  top: -1px;
  left: 0;
  width: 200%; /* 调整为200%，让波浪更流畅 */
  height: calc(100% + 4rpx);
  animation: waveAnimation linear infinite;
  border-radius: 4rpx;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.4) 25%, rgba(255, 255, 255, 0.6) 50%, rgba(255, 255, 255, 0.4) 75%, transparent 100%) !important;
  z-index: 2;
}

.wave-layer-2 {
  animation-delay: -1s; /* 调整延迟，让两层波浪错开 */
  opacity: 0.4;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.3) 25%, rgba(255, 255, 255, 0.5) 50%, rgba(255, 255, 255, 0.3) 75%, transparent 100%) !important;
}

/* 关键修改：无缝循环动画 */
@keyframes waveAnimation {
  0% {
    transform: translateX(-100%); /* 从左侧开始 */
  }
  100% {
    transform: translateX(100%); /* 移动到右侧，超出容器 */
  }
}
</style>
