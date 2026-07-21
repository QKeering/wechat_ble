<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
const echarts = require('../../../static/echarts.min.js');
import { todayOption, lastDayOption } from '@/homeDetail/exercise/echartOptions';
import type { motionSummary, Point } from '@/types/api/homeDetail';
import { getSleepDurationHours, getSleepDurationMinutes } from '@/utils/utils.js';
import { cloneDeep } from 'lodash-es';
import { MOTION_CALORIE_DISPLAY_UNIT, formatMotionCalorieKcal, normalizeMotionCalorieKcal } from '@/utils/motionCalorie';
const props = defineProps({
  motionSummaryObj: {
    type: Object as () => motionSummary,
    default: () => ({})
  }
});
watch(
  () => props.motionSummaryObj,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      await initTodayChart();
      await initLastDayChart();
    }
  },
  { deep: true }
);
const todayRef = ref<any>(null);
const lastDayRef = ref<any>(null);
const motionCalorieText = computed(() =>
  formatMotionCalorieKcal(
    normalizeMotionCalorieKcal(props.motionSummaryObj?.motionCalorie, {
      unit: (props.motionSummaryObj as any)?.calorieUnit
    })
  )
);

// 计算步数差值
const stepDifference = computed(() => {
  const today = props.motionSummaryObj?.todayStep || 0;
  const yesterday = props.motionSummaryObj?.yesterdayStep || 0;
  return today - yesterday;
});

// 计算步数差值的绝对值
const stepDifferenceAbs = computed(() => Math.abs(stepDifference.value));
// 提取公共函数
const getMaxTime = (timeArray: string[] = []): string => {
  if (!timeArray || timeArray.length === 0) return '00:00';

  // 将时间字符串转换为分钟数进行比较
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':')?.map(Number);
    return hours * 60 + (minutes || 0);
  };

  // 找出最大时间
  const maxTime = timeArray.reduce((max, current) => {
    return timeToMinutes(current) > timeToMinutes(max) ? current : max;
  }, '00:00');

  return maxTime;
};

const getYAxisMax = (step: number): number => {
  if (step <= 2000) return 2000;
  if (step <= 5000) return 5000;
  if (step <= 10000) return 10000;
  // 如果超过10000，按5000的倍数向上取整
  return Math.ceil(step / 5000) * 5000;
};

const getLastWeekDateRange = (): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  // 获取昨天所在周的周一和周日
  const dayOfWeek = yesterday.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const monday = new Date(yesterday);
  monday.setDate(yesterday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  // 格式化日期为"月-日"格式
  const formatDate = (date: Date): string => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
  };

  return `${formatDate(monday)}-${formatDate(sunday)}`;
};

const formatTimeData = (data: Point[] = []): { xData: string[]; seriesData: number[] } => {
  const safeData = Array.isArray(data) ? data : [];
  const xData = safeData.map((item: Point) => {
    if (!item.time) return '00:00';
    return item.time.includes(':') ? item.time : `${item.time.padStart(2, '0')}:00`;
  });

  const seriesData = safeData.map((item: Point) => Number(item.value)).filter((value) => Number.isFinite(value));

  return { xData, seriesData };
};

const configureChartOptions = (newOption: any, xData: string[], seriesData: number[], titleText: string) => {
  const safeXData = xData.length ? xData : ['00:00'];
  const safeSeriesData = seriesData.length ? seriesData : [0];
  const maxValue = Math.max(...safeSeriesData);
  const yAxisMax = getYAxisMax(maxValue);
  const yAxisMid = yAxisMax / 2;

  // 设置数据
  newOption.xAxis.data = safeXData;
  newOption.series[0].data = safeSeriesData;

  // 设置标题
  newOption.title = {
    ...newOption.title,
    text: titleText
  };

  // 设置y轴
  newOption.yAxis = {
    ...newOption.yAxis,
    min: 0,
    max: yAxisMax,
    axisLabel: {
      ...newOption.yAxis.axisLabel,
      formatter: (value: number) => {
        if (value === 0 || value === yAxisMid || value === yAxisMax) {
          return value.toString();
        }
        return '';
      }
    }
  };

  newOption.xAxis.axisLabel = {
    ...newOption.xAxis.axisLabel,
    interval: 0,
    formatter: (value: string, index: number) => {
      const dataLength = newOption.xAxis.data.length;
      // 如果数据长度为24，则只显示指定刻度
      if (dataLength === 24) {
        // return [0, 6, 12, 18, 23].includes(index);
        return [0, 6, 12, 18, 23].includes(index) ? value : '';
      } else {
        // 数据长度不为24时，显示两端和部分中间刻度
        const firstIndex = 0;
        const lastIndex = dataLength - 1;

        // 总是显示第一个和最后一个刻度
        if (index === firstIndex || index === lastIndex) {
          return value;
        }
        // 根据数据长度决定中间显示几个刻度
        if (dataLength <= 5) {
          // 数据很少时，显示所有刻度
          return value;
        } else if (dataLength <= 10) {
          // 中等长度数据，显示中间1个刻度
          const midIndex = Math.floor(dataLength / 2);
          return index === midIndex ? value : '';
        } else {
          // 较长数据，显示中间2个刻度（四等分点）
          const midIndex = Math.floor(dataLength / 2);
          const quarter1 = Math.floor(dataLength / 4);
          const quarter3 = Math.floor((dataLength * 3) / 4);
          return index === quarter1 || index === quarter3 || index === midIndex ? value : '';
        }
      }
    }
  };

  return newOption;
};

const getFirstOption = () => {
  const test = Array.from({ length: 24 }, (_, index) => ({
    time: `${index.toString().padStart(2, '0')}:00`,
    value: Math.floor(Math.random() * 3000 + 1000).toString()
  }));

  const newOption = cloneDeep(todayOption);
  const data = props.motionSummaryObj?.todayStepChart;
  // const data = test;
  const { xData, seriesData } = formatTimeData(data);
  const maxTime = getMaxTime(xData);

  return configureChartOptions(newOption, xData, seriesData, `今天（${maxTime}）`);
};

const getSecoundOption = () => {
  const test = Array.from({ length: 24 }, (_, index) => ({
    time: `${index.toString().padStart(2, '0')}:00`,
    value: Math.floor(Math.random() * 3000 + 1000).toString()
  }));

  const newOption = cloneDeep(lastDayOption);
  const data = props.motionSummaryObj?.yesterdayStepChart;
  // const data = test;
  const { xData, seriesData } = formatTimeData(data);
  const maxTime = getMaxTime(xData);

  return configureChartOptions(newOption, xData, seriesData, `${getLastWeekDateRange()}（${maxTime}）`);
};
const initTodayChart = async () => {
  if (!todayRef.value) return;
  try {
    const pie = await todayRef.value.init(echarts);
    pie.setOption(getFirstOption());
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
const initLastDayChart = async () => {
  if (!lastDayRef.value) return;
  try {
    const pie = await lastDayRef.value.init(echarts);
    pie.setOption(getSecoundOption());
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
onLoad(() => {});
</script>
<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view class="flex jc-start">
      <view class="score-title fs-36">
        活动总结
        <slot></slot>
      </view>
    </view>
    <view class="fs-28 mt-30">
      截止至此时，您的步数数量较昨天{{ stepDifference >= 0 ? '增加了' : '减少了' }}
      <text style="color: #ffa86a">{{ stepDifferenceAbs }}</text>
      <text>步。</text>
    </view>
    <view class="flex jc-between ai-center mt-50">
      <view class="itemBox p-30 flex fd-c jc-center ai-center">
        <view class="flex ai-center">
          <text class="fs-28">今天</text>
          <view :class="stepDifference > 0 ? 'arrow-up' : ''">
            <view class="trend-arrow"></view>
          </view>
        </view>
        <view class="">
          <text class="fs-36">{{ motionSummaryObj?.todayStep || '00' }}</text>
          <text class="fs-24">步</text>
        </view>
      </view>
      <view class="flex ai-center jc-center chartBox">
        <l-echart ref="todayRef" @finished="initTodayChart" style="width: 100%; height: 220rpx; margin: 0"></l-echart>
      </view>
    </view>
    <view class="flex jc-between ai-center mt-30">
      <view class="itemBox p-30 flex fd-c jc-center ai-center">
        <view class="flex ai-center">
          <text class="fs-28">昨天</text>
        </view>
        <view class="">
          <text class="fs-36">{{ motionSummaryObj?.yesterdayStep || '00' }}</text>
          <text class="fs-24">步</text>
        </view>
      </view>
      <view class="flex ai-center jc-center chartBox">
        <l-echart ref="lastDayRef" @finished="initLastDayChart" style="width: 100%; height: 220rpx; margin: 0"></l-echart>
      </view>
    </view>
    <view class="flex jc-between ai-center mt-50">
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start mr-30 pl-45">
        <view class="flex ai-center">
          <text class="fs-28">活动消耗</text>
        </view>
        <view class="">
          <text class="fs-36">{{ motionCalorieText }}</text>
          <text class="fs-24">{{ MOTION_CALORIE_DISPLAY_UNIT }}</text>
        </view>
      </view>
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start pl-45">
        <view class="flex ai-center">
          <text class="fs-28">活动时长</text>
        </view>
        <view class="">
          <text class="fs-36">{{ getSleepDurationHours(motionSummaryObj?.motionTime) || '00' }}</text>
          <text class="fs-24">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(motionSummaryObj?.motionTime) || '00' }}</text>
          <text class="fs-24">分钟</text>
        </view>
      </view>
    </view>
    <view class="flex jc-between ai-center mt-30">
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start mr-30 pl-45">
        <view class="flex ai-center">
          <text class="fs-28">中高强度时长</text>
        </view>
        <view class="">
          <text class="fs-36">{{ getSleepDurationHours(motionSummaryObj?.midHighTime) || '00' }}</text>
          <text class="fs-24">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(motionSummaryObj?.midHighTime) || '00' }}</text>
          <text class="fs-24">分钟</text>
        </view>
      </view>
      <view class="itemBottomBox r-50 flex fd-c jc-center ai-start pl-45">
        <view class="flex ai-center">
          <text class="fs-28">活动总分</text>
        </view>
        <view class="">
          <text class="fs-36">{{ motionSummaryObj?.motionScore || '00' }}</text>
          <text class="fs-24">分</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.itemBox {
  // width: 190rpx;
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
.arrow-up {
  transform: rotate(180deg);
  transition: transform 0.3s ease;
}

.trend-arrow {
  width: 0;
  height: 0;
  margin-left: 8rpx;
  border-left: 10rpx solid transparent;
  border-right: 10rpx solid transparent;
  border-top: 16rpx solid #ffa86a;
}
</style>
