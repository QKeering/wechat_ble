<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  // 当前值（本周值）
  currentValue: {
    type: Number,
    default: 0
  },
  // 平均值
  avgValue: {
    type: Number,
    default: 0
  },
  // 左侧最大范围
  maxLeftRange: {
    type: Number,
    default: 20
  },
  // 右侧最大范围
  maxRightRange: {
    type: Number,
    default: 20
  },
  // 左侧进度条颜色
  leftColor: {
    type: String,
    default: '#2e70fc'
  },
  // 右侧进度条颜色
  rightColor: {
    type: String,
    default: '#2e70fc'
  },
  // 标记点颜色
  markerColor: {
    type: String,
    default: '#333'
  }
});

// 计算右侧宽度占比：(当前值 / 最大范围) * 50%（因为右侧最多占50%）
const rightWidth = computed(() => (props.currentValue / props.maxRightRange) * 50);
// 计算左侧宽度占比：(平均值 / 最大范围) * 50%
const leftWidth = computed(() => (props.avgValue / props.maxLeftRange) * 50);
</script>

<template>
  <view class="progress-container">
    <!-- 进度条背景（整体） -->
    <view class="progress-bg">
      <!-- 左侧区域 -->
      <view class="progress-left" :style="{ width: leftWidth + '%', backgroundColor: leftColor }"></view>
      <!-- 右侧区域 -->
      <view class="progress-right" :style="{ width: rightWidth + '%', backgroundColor: rightColor }"></view>
      <!-- 中间0点标记线 -->
      <view class="zero-line"></view>
    </view>

    <!-- （右侧进度） -->
    <view class="markerRight current" :style="{ left: 50 + rightWidth / 2 + '%' }">
      <text class="triangle down" :style="{ borderTopColor: markerColor }"></text>
    </view>
    <!-- （左侧进度） -->
    <view class="markerLeft avg" :style="{ left: 50 - leftWidth / 2 + '%' }">
      <text class="triangle up" :style="{ borderBottomColor: markerColor }"></text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.progress-container {
  position: relative;
  width: 100%;
  height: 8rpx;
  margin-bottom: 20rpx;
}

.progress-bg {
  width: 100%;
  height: 100%;
  background: #e5e9f2;
  border-radius: 4rpx;
  position: relative;
  overflow: hidden;
}

/* 左侧区域（平均） */
.progress-left {
  position: absolute;
  right: 50%; /* 从中间向左延伸 */
  top: 0;
  height: 100%;
  border-radius: 5rpx;
}

/* 右侧区域（本周） */
.progress-right {
  position: absolute;
  left: 50%; /* 从中间向右延伸 */
  top: 0;
  height: 100%;
  border-radius: 5rpx;
}

/* 中间0点分隔线 */
.zero-line {
  position: absolute;
  left: 50%;
  top: 0;
  width: 1px;
  height: 100%;
  background: #2e70fc;
}

/* 标记点 */
.markerRight {
  position: absolute;
  top: -10rpx;
  transform: translate(-50%, -50%);
}

.markerLeft {
  position: absolute;
  top: 18rpx;
  transform: translate(-50%, -50%);
}

/* 向下三角形（本周） */
.triangle.down {
  display: block;
  width: 0;
  height: 0;
  border-left: 8rpx solid transparent;
  border-right: 8rpx solid transparent;
  border-top: 12rpx solid #333;
}

/* 向上三角形（平均） */
.triangle.up {
  display: block;
  width: 0;
  height: 0;
  border-left: 8rpx solid transparent;
  border-right: 8rpx solid transparent;
  border-bottom: 12rpx solid #333;
}
</style>
