<script setup lang="ts">
// @ts-nocheck
import { ref, computed } from 'vue';
import type { sleepOverview, sleepSegment } from '@/types/api/homeDetail';

const props = defineProps({
  sleepOverviewObj: {
    type: Object as () => sleepOverview,
    default: () => ({})
  },
  sleepSegmentObj: {
    type: Object as () => sleepSegment,
    default: () => ({})
  }
});

// 睡眠评分因素展开状态
const factorsExpanded = ref(false);

const normalizeSleepScore = (value: unknown): number | null => {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0 || score > 100) return null;
  return Math.round(score);
};

const sleepScoreValue = computed(() => normalizeSleepScore(props.sleepOverviewObj?.sleepScore));

// 睡眠质量文本
const sleepQualityText = computed(() => {
  const quality = sleepScoreValue.value;
  if (!quality) return '--';

  if (quality >= 0 && quality <= 20) return '较差';
  if (quality >= 21 && quality <= 40) return '待改善';
  if (quality >= 41 && quality <= 60) return '一般';
  if (quality >= 61 && quality <= 80) return '良好';
  if (quality >= 81 && quality <= 100) return '优秀';

  return '--';
});

// 从 chartDataSection 中获取各睡眠阶段的时长（分钟）
const getSleepStageMinutes = (stageName: string): number => {
  if (!props.sleepSegmentObj?.chartDataSection || !Array.isArray(props.sleepSegmentObj.chartDataSection)) return 0;
  const stage = props.sleepSegmentObj.chartDataSection.find((item) => item.time === stageName);
  const value = stage?.value ? parseInt(stage.value, 10) : 0;
  return isNaN(value) ? 0 : value;
};

// 睡眠效率计算：(深睡+浅睡+快速眼动)/ (深睡+浅睡+快速眼动+清醒时间）
const sleepEfficiency = computed(() => {
  const deepSleep = getSleepStageMinutes('深睡');
  const lightSleep = getSleepStageMinutes('浅睡');
  const remSleep = getSleepStageMinutes('快速眼动');
  const awakeTime = getSleepStageMinutes('清醒');

  const totalSleep = deepSleep + lightSleep + remSleep;
  const totalTime = totalSleep + awakeTime;

  if (totalTime === 0) return 0;
  return Math.round((totalSleep / totalTime) * 100);
});

// 睡眠时长（分钟）
const sleepDurationMinutes = computed(() => {
  return getSleepStageMinutes('深睡') + getSleepStageMinutes('浅睡') + getSleepStageMinutes('快速眼动');
});

// 格式化睡眠时长为小时分钟
const formattedSleepDuration = computed(() => {
  const hours = Math.floor(sleepDurationMinutes.value / 60);
  const minutes = sleepDurationMinutes.value % 60;
  return { hours, minutes };
});

const deepSleepRatio = computed(() => {
  if (!sleepDurationMinutes.value) return 0;
  return Math.round((getSleepStageMinutes('深睡') / sleepDurationMinutes.value) * 100);
});

const awakeCountText = computed(() => {
  const awakeCount = Number(props.sleepOverviewObj?.awakeCount);
  if (!Number.isFinite(awakeCount) || awakeCount < 0) return '--';
  return Math.round(awakeCount).toString();
});

// 圆环进度条颜色
const progressColor = computed(() => {
  const score = sleepScoreValue.value || 0;
  if (score >= 81) return '#6366f1';
  if (score >= 61) return '#60a5fa';
  if (score >= 41) return '#34d399';
  if (score >= 21) return '#fbbf24';
  if (score <= 0) return '#c7cbd8';
  return '#f87171';
});

// 计算环形进度的 conic-gradient 样式
const progressStyle = computed(() => {
  const score = sleepScoreValue.value || 0;
  const percentage = Math.min(100, Math.max(0, score)); // 限制在 0-100 范围内
  // 使用 conic-gradient 创建环形进度
  // 从顶部（0度）开始，顺时针绘制进度
  const gradient = `conic-gradient(${progressColor.value} ${percentage}%, #eef0ff ${percentage}%, #eef0ff 100%)`;
  return {
    background: gradient,
    opacity: score > 0 ? 1 : 0
  };
});

// 切换睡眠评分因素展开状态
const toggleFactors = () => {
  factorsExpanded.value = !factorsExpanded.value;
};
</script>

<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view class="score-title fs-36">
      睡眠评分
      <slot></slot>
    </view>

    <!-- 圆环评分区域 -->
    <view class="ring-section">
      <view class="ring-container">
        <!-- 圆环进度（使用 conic-gradient） -->
        <view class="ring-circle ring-progress" :style="progressStyle"></view>
        <!-- 圆环中心遮罩（创建环形效果） -->
        <view class="ring-circle ring-mask"></view>
        <!-- 圆环中心内容 -->
        <view class="ring-content">
          <view class="score-number" :style="{ color: progressColor }">
            {{ sleepScoreValue || '--' }}
          </view>
          <view class="score-label" :style="{ color: progressColor }">
            {{ sleepQualityText }}
          </view>
        </view>
      </view>
    </view>

    <!-- 睡眠评分因素 -->
    <view class="factor-row" @click="toggleFactors">
      <text class="factor-text">睡眠评分因素</text>
      <text class="factor-arrow" :class="{ 'factor-arrow-expanded': factorsExpanded }">›</text>
    </view>

    <!-- 评分因素详情（展开时显示） -->
    <view v-if="factorsExpanded" class="factors-detail">
      <view class="factor-item">
        <text class="factor-item-label">深睡比例</text>
        <text class="factor-item-value">{{ deepSleepRatio }}%</text>
      </view>
      <view class="factor-item">
        <text class="factor-item-label">清醒次数</text>
        <text class="factor-item-value">{{ awakeCountText }}次</text>
      </view>
      <!-- <view class="factor-item">
        <text class="factor-item-label">睡眠规律性</text>
        <text class="factor-item-value">良好</text>
      </view> -->
    </view>

    <!-- 数据网格 -->
    <view class="stats-grid">
      <view class="stat-box">
        <view class="stat-label">睡眠时长</view>
        <view class="stat-value">
          <text>{{ formattedSleepDuration.hours || '00' }}</text>
          <text class="stat-unit">小时</text>
          <text>{{ formattedSleepDuration.minutes.toString().padStart(2, '0') || '00' }}</text>
          <text class="stat-unit">分钟</text>
        </view>
      </view>
      <view class="stat-box">
        <view class="stat-label">睡眠效率</view>
        <view class="stat-value">
          <text>{{ sleepEfficiency }}</text>
          <text class="stat-unit">%</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ring-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 8px;
}

.ring-container {
  position: relative;
  width: 140px;
  height: 140px;
}

.ring-circle {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-sizing: border-box;
}

.ring-bg {
  display: none; /* 不再需要单独的背景 */
}

.ring-progress {
  border: none;
  border-radius: 50%;
  transition: opacity 0.3s ease;
}

.ring-mask {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background-color: #ffffff; /* 与页面背景色相同 */
}

.ring-content {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.score-number {
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -2px;
}

.score-label {
  font-size: 18px;
  margin-top: 8px;
  font-weight: 500;
}

.factor-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  border-radius: 12px;
}

.factor-text {
  font-size: 16px;
  color: #1f2937;
  font-weight: 500;
}

.factor-arrow {
  color: #9ca3af;
  font-size: 14px;
  transition: transform 0.2s;
}

.factor-arrow-expanded {
  transform: rotate(90deg);
  color: #6366f1;
}

.factors-detail {
  margin-bottom: 24px;
  padding: 16px;
  background-color: #f9fafb;
  border-radius: 12px;
}

.factor-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;

  &:not(:last-child) {
    border-bottom: 1px solid #e5e7eb;
  }
}

.factor-item-label {
  font-size: 14px;
  color: #6b7280;
}

.factor-item-value {
  font-size: 14px;
  color: #111827;
  font-weight: 500;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.stat-box {
  text-align: center;
  padding: 16px 12px;
}

.stat-label {
  font-size: 14px;
  color: #374151;
  font-weight: 500;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #111827;
  line-height: 1.2;
}

.stat-unit {
  font-size: 14px;
  color: #6b7280;
  font-weight: 400;
  margin-left: 2px;
}
</style>
