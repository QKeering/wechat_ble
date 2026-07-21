<template>
  <view class="score-progress-bar-container" :class="`style-version-${styleVersion}`">
    <!-- 进度条和图标 -->
    <view class="progress-bar-container">
      <view class="progress-bar">
        <!-- 进度条背景 -->
        <view class="progress-bar-bg"></view>

        <!-- 进度条填充 -->
        <!-- <view class="progress-bar-fill"></view> -->
      </view>
      <!-- 顶部位置图标 -->
      <view v-if="showCurrentIcon" class="current-icon" :style="{ left: currentPositionStyle }">
        <uv-image :src="currentIconSrc" width="28rpx" height="28rpx"></uv-image>
      </view>
      <!-- 底部位置图标 -->
      <view v-if="showAvgIcon" class="avg-icon" :style="{ left: avgPositionStyle }">
        <uv-image :src="avgIconSrc" width="16rpx" height="16rpx"></uv-image>
      </view>
    </view>
    <!-- 评分等级标签 -->
    <view class="level-tag-container">
      <view class="level-tag left-level">
        <text class="mb-20">待改善</text>
      </view>
      <view class="level-tag middle-level">
        <text class="mb-20">良好</text>
      </view>
      <view class="level-tag right-level">
        <text class="mb-20">优秀</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';

// 组件属性定义
const props = defineProps({
  // 当前分数 (0-100)
  currentScore: {
    type: Number,
    default: 75,
    validator: (val) => val >= 0 && val <= 100
  },

  // 前四周平均分数 (0-100)
  avgScore: {
    type: Number,
    default: 60,
    validator: (val) => val >= 0 && val <= 100
  },

  // 是否显示底部位置图标
  showAvgIcon: {
    type: Boolean,
    default: true
  },

  // 是否显示顶部位置图标
  showCurrentIcon: {
    type: Boolean,
    default: true
  },

  // 平均位置图标路径
  avgIconSrc: {
    type: String,
    default: '/static/images/icon11.png' // 默认图标路径，需根据实际项目调整
  },

  // 当前位置图标路径
  currentIconSrc: {
    type: String,
    default: '/static/images/icon12.png' // 默认图标路径，需根据实际项目调整
  },
  // 样式版本控制 (1-3)
  styleVersion: {
    type: Number,
    default: 1, // 默认使用款式1
    validator: (val) => val >= 1 && val <= 3
  }
});

// 计算前四周平均图标的位置样式（使用百分比）
const avgPositionStyle = computed(() => {
  // 限制百分比在0-100之间
  const percentage = Math.max(0, Math.min(100, props.avgScore));
  return `${percentage}%`;
});

// 计算当前位置图标的位置样式（使用百分比）
const currentPositionStyle = computed(() => {
  // 限制百分比在0-100之间
  const percentage = Math.max(0, Math.min(100, props.currentScore));
  return `${percentage}%`;
});
</script>

<style lang="scss" scoped>
.score-progress-bar-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 20rpx 0;
}

/* 评分等级标签样式 */
.level-tag-container {
  display: flex;
  width: 100%;
  margin-bottom: 20rpx;
}

.level-tag {
  flex: 1; /* 每个标签占1/3宽度 */
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6rpx 0;
  font-size: 24rpx;
  color: #01010180;
  background-color: #fff;
}

/* 进度条容器 */
.progress-bar-container {
  position: relative;
  width: 100%;
  display: flex;
  justify-content: center;
  margin-top: 30rpx;
}

/* 进度条样式 */
.progress-bar {
  position: relative;
  width: 100%;
  height: 8rpx;
  border-radius: 4rpx;
  background-color: #f2f2f2;
  overflow: hidden;
}

.progress-icon image {
  width: 100%;
  height: 100%;
}

/* 自定义样式类，可以通过父组件覆盖 */
.avg-icon {
  position: absolute;
  top: 20rpx;
  left: 0;
  transform: translate(-50%, -50%); /* 使用translate实现水平和垂直居中 */
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.current-icon {
  position: absolute;
  top: -20rpx;
  left: 0;
  transform: translate(-50%, -50%); /* 使用translate实现水平和垂直居中 */
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

/* -------------------------- */
/* 款式1（默认款式） */
/* -------------------------- */
.style-version-1 {
  .left-level {
    background: linear-gradient(180deg, #f5f8ff 0%, #4c76f100 100%);
  }
  .middle-level {
    background: linear-gradient(180deg, #e2e9fd 0%, #4c76f100 100%);
  }
  .right-level {
    background: linear-gradient(180deg, #dae1fd 0%, #4c76f100 100%);
  }

  .progress-bar-bg {
    width: 100%;
    height: 100%;
    background: linear-gradient(to right, #dbe4fd 0%, #dbe4fd 33.33%, #a3b8f5 33.33%, #a3b8f5 66.66%, #7091f4 66.66%, #7091f4 100%);
  }
}

/* -------------------------- */
/* 款式2（暖色调款式） */
/* -------------------------- */
.style-version-2 {
  .left-level {
    background: linear-gradient(180deg, #f8f8ff 0%, #ff4c4c00 100%);
  }
  .middle-level {
    background: linear-gradient(180deg, #e8e7fd 0%, #ff950000 100%);
  }
  .right-level {
    background: linear-gradient(180deg, #e2e0fc 0%, #34c75900 100%);
  }

  .progress-bar-bg {
    width: 100%;
    height: 100%;
    background: linear-gradient(to right, #dfddfb 0%, #dfddfb 33.33%, #9f9af4 33.33%, #9f9af4 66.66%, #6d66ea 66.66%, #6d66ea 100%);
  }
}

/* -------------------------- */
/* 款式3（冷色调款式） */
/* -------------------------- */
.style-version-3 {
  .left-level {
    background: linear-gradient(180deg, #fefbf5 0%, #1e90ff00 100%);
  }
  .middle-level {
    background: linear-gradient(180deg, #fff7e2 0%, #00bcd400 100%);
  }
  .right-level {
    background: linear-gradient(180deg, #fff5d8 0%, #4caf5000 100%);
  }

  .progress-bar-bg {
    width: 100%;
    height: 100%;
    background: linear-gradient(to right, #fff4d5 0%, #fff4d5 33.33%, #ffe397 33.33%, #ffe397 66.66%, #ffd258 66.66%, #ffd258 100%);
  }
}
</style>
