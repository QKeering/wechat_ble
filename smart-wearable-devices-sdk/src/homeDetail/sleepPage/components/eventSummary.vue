<script setup lang="ts">
import { ref, computed } from 'vue';
import ProgressBar from '@/components/progressBar.vue';
import { todayOption, lastWeekOption } from '@/homeDetail/relaxStatus/echartOptions';
import { getSleepDurationHours, getSleepDurationMinutes } from '@/utils/utils.js';
const echarts = require('../../../static/echarts.min.js');
const todayRef = ref(null);
const lastWeekRef = ref(null);
import type { sleepSummaryData } from '@/types/api/homeDetail';

const props = defineProps({
  sleepSummaryObj: {
    type: Object as () => sleepSummaryData,
    default: () => ({})
  }
});
const getCurrentWeekRange = () => {
  const now = new Date();
  const currentDay = now.getDay(); // 获取当前是星期几 (0-6, 0代表周日)

  // 计算本周的开始日期（周一）
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - (currentDay === 0 ? 6 : currentDay - 1));

  // 计算本周的结束日期（周日）
  const endDate = new Date(now);
  endDate.setDate(now.getDate() + (currentDay === 0 ? 0 : 7 - currentDay));

  // 格式化日期为 "月日" 格式
  const formatDate = (date: Date) => {
    const month = date.getMonth() + 1; // 月份从0开始，需要+1
    const day = date.getDate();
    return `${month}月${day}日`;
  };

  return `${formatDate(startDate)}-${formatDate(endDate)}`;
};
// 计算属性，动态显示当前周的日期范围
const currentWeekRange = computed(() => getCurrentWeekRange());
const growthText = computed(() => {
  // const growthTime = props.sleepSummaryObj.sleepMinutes - props.sleepSummaryObj.avgSleepMinutes7d;
  const growthTime = props.sleepSummaryObj.lastNightSleepMinutes - props.sleepSummaryObj.sleepMinutes;
  return growthTime > 0 ? '减少了' : '增加了';
});
const growthTimeText = computed(() => {
  const growthTime = props.sleepSummaryObj.lastNightSleepMinutes - props.sleepSummaryObj.sleepMinutes;
  const absoluteGrowthTime = Math.abs(growthTime);
  const hours = getSleepDurationHours(absoluteGrowthTime);
  const minutes = getSleepDurationMinutes(absoluteGrowthTime);
  if (hours === '00') {
    return `${minutes}分钟`;
  }
  return `${hours}小时${minutes}分钟`;
});
const sleepPercentage = computed(() => {
  const sleepMinutes = props.sleepSummaryObj.sleepMinutes || 0;
  const totalMinutesIn12Hours = 12 * 60; // 12小时的分钟数
  const totalMinutesIn24Hours = 24 * 60; // 24小时的分钟数

  // 如果睡眠时长超过12小时，则按24小时计算比例
  if (sleepMinutes > totalMinutesIn12Hours) {
    // 超过12小时的部分按24小时计算
    const percentage = (sleepMinutes / totalMinutesIn24Hours) * 100;
    return Math.min(Math.max(percentage, 0), 100);
  } else {
    // 不超过12小时的部分按12小时计算
    const percentage = (sleepMinutes / totalMinutesIn12Hours) * 100;
    return Math.min(Math.max(percentage, 0), 100);
  }
});
const sleepAvgPercentage = computed(() => {
  const sleepMinutes = props.sleepSummaryObj.avgSleepMinutes7d || 0;
  const totalMinutesIn12Hours = 12 * 60; // 12小时的分钟数
  const totalMinutesIn24Hours = 24 * 60; // 24小时的分钟数

  // 如果睡眠时长超过12小时，则按24小时计算比例
  if (sleepMinutes > totalMinutesIn12Hours) {
    // 超过12小时的部分按24小时计算
    const percentage = (sleepMinutes / totalMinutesIn24Hours) * 100;
    return Math.min(Math.max(percentage, 0), 100);
  } else {
    // 不超过12小时的部分按12小时计算
    const percentage = (sleepMinutes / totalMinutesIn12Hours) * 100;
    return Math.min(Math.max(percentage, 0), 100);
  }
});
</script>
<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view class="flex jc-start">
      <view class="fs-36">睡眠总结</view>
    </view>
    <view class="fs-28 mt-30">
      截止到此时，您的昨晚的睡眠时长{{ growthText }}
      <text style="color: #5f57ec">{{ growthTimeText }}</text>
    </view>
    <view class="mt-50">
      <text class="fs-28">昨晚</text>
      <text class="fs-48">{{ getSleepDurationHours(sleepSummaryObj.sleepMinutes) }}</text>
      <text class="fs-24">小时</text>
      <text class="fs-48">{{ getSleepDurationMinutes(sleepSummaryObj.sleepMinutes) }}</text>
      <text class="fs-24">分钟</text>
    </view>
    <view class="mt-20" style="border-radius: 14rpx; overflow: hidden">
      <uv-line-progress
        :customStyle="{ borderRadius: '20rpx !important' }"
        height="40rpx"
        activeColor="#5f57ec"
        inactiveColor="#ffffff"
        :percentage="sleepPercentage"
        :showText="false"
      ></uv-line-progress>
    </view>
    <view class="mt-40">
      <text class="fs-28">{{ currentWeekRange }}</text>
      <text class="fs-24 ml-20">平均</text>
      <text class="fs-48">{{ getSleepDurationHours(sleepSummaryObj.avgSleepMinutes7d) }}</text>
      <text class="fs-24">小时</text>
      <text class="fs-48">{{ getSleepDurationMinutes(sleepSummaryObj.avgSleepMinutes7d) }}</text>
      <text class="fs-24">分钟</text>
    </view>
    <view class="mt-20">
      <uv-line-progress
        :customStyle="{ borderRadius: '20rpx !important' }"
        height="40rpx"
        activeColor="#dfddfb"
        inactiveColor="#ffffff"
        :percentage="sleepAvgPercentage"
        :showText="false"
      ></uv-line-progress>
    </view>
    <view class="flex jc-between ai-center mt-50">
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start mr-30 pl-45">
        <view class="flex ai-center">
          <text class="fs-28">卧床时长</text>
        </view>
        <view class="">
          <text class="fs-36">{{ getSleepDurationHours(sleepSummaryObj.bedTime) }}</text>
          <text class="fs-24">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(sleepSummaryObj.bedTime) }}</text>
          <text class="fs-24">分钟</text>
        </view>
      </view>
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start pl-45">
        <view class="flex ai-center">
          <text class="fs-28">睡眠效率</text>
        </view>
        <view class="">
          <text class="fs-36">{{ sleepSummaryObj.sleepEfficiency || '00' }}</text>
          <text class="fs-24">%</text>
        </view>
      </view>
    </view>
    <view class="flex jc-between ai-center mt-30">
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start mr-30 pl-45">
        <view class="flex ai-center">
          <text class="fs-28">睡眠心率</text>
        </view>
        <view class="">
          <text class="fs-36">{{ sleepSummaryObj.sleepHeartRate || '00' }}</text>
          <text class="fs-24">(次/分钟)</text>
        </view>
      </view>
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start pl-45">
        <view class="flex ai-center">
          <text class="fs-28">睡眠总分</text>
        </view>
        <view class="">
          <text class="fs-36">{{ sleepSummaryObj.sleepScore || '00' }}</text>
          <text class="fs-24">分</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.itemBox {
  width: 160rpx;
  box-sizing: border-box;
  border-radius: 50rpx;
  background: #f7f7f7;
}
.itemBottomBox {
  width: 100%;
  height: 160rpx;
  background: #f7f7f7;
}
.chartBox {
  flex: 1;
}
</style>
