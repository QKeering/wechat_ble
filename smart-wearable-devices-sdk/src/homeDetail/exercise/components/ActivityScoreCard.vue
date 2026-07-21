<script setup lang="ts">
import { ref, computed, watch } from 'vue';
const echarts = require('../../../static/echarts.min.js');
import { pressureOption } from '@/homeDetail/exercise/echartOptions';
import type { motionOverview, motionSummary } from '@/types/api/homeDetail';
import { MOTION_CALORIE_DISPLAY_UNIT, formatMotionCalorieKcal, normalizeMotionCalorieKcal } from '@/utils/motionCalorie';

const props = defineProps({
  motionOverviewObj: {
    type: Object as () => motionOverview,
    default: () => ({})
  },
  motionSummaryObj: {
    type: Object as () => motionSummary,
    default: () => ({})
  }
});
watch(
  () => props.motionOverviewObj,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      await initPie();
    }
  },
  { deep: true }
);
const pieRef = ref<any>(null);
const toPositiveNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};
const stepNumber = computed(() => toPositiveNumber(props.motionOverviewObj?.step, props.motionSummaryObj?.todayStep));
const targetStep = computed(() => toPositiveNumber(props.motionOverviewObj?.targetStep) || 6000);
const targetCalorie = computed(() => toPositiveNumber(props.motionOverviewObj?.targetCalorie) || 500);
const targetMotionTime = computed(() => toPositiveNumber(props.motionOverviewObj?.targetMotionTime) || 30);
const motionTimeNumber = computed(() => toPositiveNumber(props.motionOverviewObj?.motionTime, props.motionSummaryObj?.motionTime));
const calorieSourceUnit = computed(() => props.motionOverviewObj?.calorieUnit || props.motionSummaryObj?.calorieUnit || MOTION_CALORIE_DISPLAY_UNIT);
const calorieUnit = computed(() => MOTION_CALORIE_DISPLAY_UNIT);
const calorieNumber = computed(
  () =>
    normalizeMotionCalorieKcal(toPositiveNumber(props.motionOverviewObj?.calorie, props.motionSummaryObj?.motionCalorie), {
      stepCount: stepNumber.value,
      targetCalorie: targetCalorie.value,
      unit: calorieSourceUnit.value
    }) || 0
);
const calorieText = computed(() => formatMotionCalorieKcal(calorieNumber.value));
const firstCricle = computed(() => {
  const Percentage = calorieNumber.value / targetCalorie.value;
  // 乘以100得到百分比，并限制在0-100之间
  return Math.min(Math.max(Percentage * 100, 0), 100);
});
const secoundCricle = computed(() => {
  const Percentage = stepNumber.value / targetStep.value;
  // 乘以100得到百分比，并限制在0-100之间
  return Math.min(Math.max(Percentage * 100, 0), 100);
});
const thirdCricle = computed(() => {
  const Percentage = motionTimeNumber.value / targetMotionTime.value;
  // 乘以100得到百分比，并限制在0-100之间
  return Math.min(Math.max(Percentage * 100, 0), 100);
});
const jumpSetting = () => {
  (uni as any).$uv.route('/pagesA/mines/setting');
};
const initPie = async () => {
  if (!pieRef.value) return;
  try {
    const pie = await pieRef.value.init(echarts);
    // 动态设置三个圈的值
    const dynamicOption = {
      ...pressureOption,
      series: [
        {
          ...pressureOption.series[0],
          data: [{ value: firstCricle.value }], // 最外层圈：活动时间
          progress: {
            ...pressureOption.series[0].progress,
            show: firstCricle.value > 0 // 最外层圈是否显示进度
          }
        },
        {
          ...pressureOption.series[1],
          data: [{ value: secoundCricle.value }], // 中间层圈：活动步数
          progress: {
            ...pressureOption.series[1].progress,
            show: secoundCricle.value > 0 // 中间层圈是否显示进度
          }
        },
        {
          ...pressureOption.series[2],
          data: [{ value: thirdCricle.value }], // 最内层圈：活动热量
          progress: {
            ...pressureOption.series[2].progress,
            show: thirdCricle.value > 0 // 最内层圈是否显示进度
          }
        }
      ]
    };

    pie.setOption(dynamicOption);
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
</script>
<template>
  <view class="mb-30 r-50 bg-white p-10">
    <view class="p-20 r-50" style="background-color: #fefdfb">
      <view class="flex ai-center jc-center" style="position: relative">
        <view class="" style="position: absolute; top: 0; right: 10rpx; z-index: 99" @tap="jumpSetting">
          <view class="setting-button">设置</view>
        </view>
        <l-echart ref="pieRef" @finished="initPie" style="width: 100%; height: 192rpx; margin: 0"></l-echart>
      </view>
    </view>
    <view class="stats-container">
      <!-- 活动热量 -->
      <view class="stat-item">
        <view class="indicator">
          <view class="dot heat-dot"></view>
          <text class="fs-24 t-979797">活动热量</text>
        </view>
        <view>
          <text class="fs-36">{{ calorieNumber > 0 ? calorieText : '00' }}</text>
          <text class="fs-24 t-979797">/{{ targetCalorie }}</text>
          <text class="fs-24 t-979797">{{ calorieUnit }}</text>
        </view>
      </view>
      <view class="stat-item">
        <view class="indicator">
          <view class="dot steps-dot"></view>
          <text class="fs-24 t-979797">活动步数</text>
        </view>
        <view>
          <text class="fs-36">{{ stepNumber || '00' }}</text>
          <text class="fs-24 t-979797">/{{ targetStep }}</text>
          <text class="fs-24 t-979797">步</text>
        </view>
      </view>
      <view class="stat-item">
        <view class="indicator">
          <view class="dot time-dot"></view>
          <text class="fs-24 t-979797">活动时间</text>
        </view>
        <view>
          <text class="fs-36">{{ motionTimeNumber || '00' }}</text>
          <text class="fs-24 t-979797">/{{ targetMotionTime }}</text>
          <text class="fs-24 t-979797">分钟</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.stats-container {
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 20rpx 10rpx;
  width: 100%;
  box-sizing: border-box;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.indicator {
  display: flex;
  align-items: center;
  margin-bottom: 15rpx;
}
.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin-right: 8rpx;
}

.heat-dot {
  background-color: #ec4899; /* 粉色 - 活动热量 */
}

.steps-dot {
  background-color: #f97316; /* 橙色 - 活动步数 */
}

.time-dot {
  background-color: #3b82f6; /* 蓝色 - 活动时间 */
}

.setting-button {
  padding: 6rpx 14rpx;
  border: 1rpx solid #e5e7eb;
  border-radius: 999rpx;
  background: #ffffff;
  color: #6b7280;
  font-size: 24rpx;
  line-height: 34rpx;
}
</style>
