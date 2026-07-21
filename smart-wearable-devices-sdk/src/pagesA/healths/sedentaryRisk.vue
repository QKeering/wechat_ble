<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
import sleepEchartItem from '@/components/sleepEchartItem.vue';
import { defaultEchartOption, sleepTimeOption } from '@/pagesA/echartOptions/sedentaryRiskOptions';
import lineProgresss from '@/pagesA/components/lineProgress.vue';
import { getSittingRiskDetail } from '@/common/api/heatlthSummary';
import type { SittingRiskResp } from '@/types/api/healthSummary';
import { getSleepDurationHours, getSleepDurationMinutes } from '@/utils/utils.js';
import { cloneDeep } from 'lodash-es';
const echarts = require('../../static/echarts.min.js');
const sittingRiskInfo = ref<SittingRiskResp>();
const getProcessedOption = () => {
  const testTrendChartData = [
    { weekLabel: '11月第1周', score: 70, level: '优秀' },
    { weekLabel: '11月第2周', score: 65, level: '良好' },
    { weekLabel: '11月第3周', score: 72, level: '优秀' },
    { weekLabel: '11月第4周', score: 68, level: '良好' },
    { weekLabel: '12月第1周', score: 75, level: '优秀' },
    { weekLabel: '12月第2周', score: 62, level: '正常' },
    { weekLabel: '12月第3周', score: 78, level: '优秀' },
    { weekLabel: '12月第4周', score: 71, level: '良好' }
  ];

  return createChartOption(
    defaultEchartOption,
    sittingRiskInfo?.value?.trendChart || [],
    // testTrendChartData,
    (item) => Number(item.score)
  );
};

const getSecoundOption = () => {
  const testTrendChartData = [
    { weekLabel: '11月第1周', steps: 7211 },
    { weekLabel: '11月第2周', steps: 5332 },
    { weekLabel: '11月第3周', steps: 2456 },
    { weekLabel: '11月第4周', steps: 8222 },
    { weekLabel: '12月第1周', steps: 7123 },
    { weekLabel: '12月第2周', steps: 6444 },
    { weekLabel: '12月第3周', steps: 8111 }
  ];

  return createChartOption(
    sleepTimeOption,
    sittingRiskInfo?.value?.stepChart || [],
    // testTrendChartData,
    (item) => Number(item.steps),
    'steps'
  );
};
const getYAxisMax = (step: number): number => {
  if (step <= 2000) return 2000;
  if (step <= 5000) return 5000;
  if (step <= 10000) return 10000;
  // 如果超过10000，按5000的倍数向上取整
  return Math.ceil(step / 5000) * 5000;
};
// 通用的图表选项创建函数
const createChartOption = (baseOption: any, data: any[], dataExtractor: (item: any) => number, chartType: string = 'default') => {
  // 深拷贝原option
  const newOption = cloneDeep(baseOption);

  // 1. 生成x轴数据 - 智能合并相同月份的周标签
  const fullXData = data.map((item: any) => item?.weekLabel) || [];

  // 2. 智能处理x轴刻度显示
  const processedXData: any = [];
  const xAxisLabels: any = [];

  let currentMonth = '';
  let monthStartIndex = 0;

  fullXData.forEach((weekLabel, index) => {
    // 提取月份部分（如"11月"）
    const month = weekLabel.split('第')[0];

    if (month !== currentMonth) {
      // 新月份开始，记录月份标签位置
      if (currentMonth !== '') {
        // 为上一个月份设置标签位置（中间位置）
        const middleIndex = Math.floor((monthStartIndex + index - 1) / 2);
        xAxisLabels[middleIndex] = currentMonth;
      }
      currentMonth = month;
      monthStartIndex = index;
    }

    // 所有位置都添加空字符串作为占位
    processedXData.push(weekLabel);
    xAxisLabels.push('');
  });

  // 处理最后一个月份
  if (currentMonth !== '') {
    const middleIndex = Math.floor((monthStartIndex + fullXData.length - 1) / 2);
    xAxisLabels[middleIndex] = currentMonth;
  }

  // 3. 生成完整的series数据
  const fullSeriesData = data.map(dataExtractor) || [];

  // 4. 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = processedXData;
  newOption.series[0].data = fullSeriesData;

  if (chartType === 'steps') {
    const maxValue = Math.max(...fullSeriesData);
    const yAxisMax = getYAxisMax(maxValue);

    // 动态计算合适的interval，确保网格线不会太密集
    let interval = yAxisMax;
    if (yAxisMax <= 2000) interval = 500;
    else if (yAxisMax <= 5000) interval = 1000;
    else if (yAxisMax <= 10000) interval = 2000;
    else interval = 5000;

    // 只设置需要修改的属性，保留原有splitLine配置
    newOption.yAxis.min = 0;
    newOption.yAxis.max = yAxisMax;
    newOption.yAxis.interval = interval;
    newOption.yAxis.axisLabel.formatter = (value: number) => {
      // 修复：正确显示中间值
      const targetMidValue = Math.floor(yAxisMax / 2);
      const actualMidValue = Math.round(targetMidValue / interval) * interval;
      // 只显示关键刻度值：0、最接近的中间值、最大值
      if (value === 0 || value === actualMidValue || value === yAxisMax) {
        return value.toString();
      }
      return '';
    };
  }
  // 5. 使用自定义formatter显示月份标签
  newOption.xAxis.axisLabel.formatter = (value: string, index: number) => {
    return xAxisLabels[index] || '';
  };
  return newOption;
};
const initChart = async (chartRef: any) => {
  if (!chartRef) return;
  try {
    const chart = await chartRef.init(echarts);
    chart.setOption(getProcessedOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};

const lightSleepTimeChart = async (chartRef: any) => {
  if (!chartRef) return;
  try {
    const chart = await chartRef.init(echarts);
    chart.setOption(getSecoundOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};
onLoad(async () => {
  const res = await getSittingRiskDetail();
  sittingRiskInfo.value = res;
  if (!sittingRiskInfo.value) {
    uni.showToast({
      title: '暂无数据',
      icon: 'none'
    });
  }
});
</script>
<!-- 睡前准备 -->
<template>
  <view class="pl-30 pr-30 pt-30">
    <sleepEchartItem
      title="久坐风险"
      :subtitle="sittingRiskInfo?.overview?.level || '--'"
      :dateRange="sittingRiskInfo?.overview?.dateRange || '--'"
      @chart-finished="(chartRef) => initChart(chartRef)"
    >
      <template #comparison>
        <view class="tag flex ai-center ml-20 p-10">
          <text>{{ sittingRiskInfo?.overview?.trend || '--' }}</text>
        </view>
      </template>
    </sleepEchartItem>
    <sleepEchartItem
      :showChartDate="false"
      title="步数"
      :subtitle="'平均' + (sittingRiskInfo?.avgSteps || '--') + '步'"
      @chart-finished="(chartRef) => lightSleepTimeChart(chartRef)"
    >
      <template #comparison>
        <view class="tag flex ai-center ml-20 pl-20 pr-20 pt-10 pb-10">
          <text>{{ sittingRiskInfo?.stepsLevel || '--' }}</text>
        </view>
      </template>
    </sleepEchartItem>
    <view class="bg-white r-50 mt-20 p-40">
      <view class="flex ai-center jc-between">
        <text class="fs-36">步数</text>
        <text class="fs-36">{{ sittingRiskInfo?.avgSteps || '00' }}步</text>
      </view>
    </view>
    <view class="bg-white r-50 mt-20 p-40">
      <view class="flex ai-center jc-between">
        <text class="fs-36">活动水平</text>
        <text class="fs-36">{{ sittingRiskInfo?.activityLevel || '00' }}</text>
      </view>
    </view>
    <view class="bg-white r-50 mt-20 p-40">
      <view class="flex ai-center jc-between">
        <text class="fs-36">活跃时间</text>
        <!-- <text class="fs-36">10小时4分钟</text> -->
        <view>
          <text class="fs-36">{{ getSleepDurationHours(sittingRiskInfo?.activeMinutes || 0) }}</text>
          <text class="fs-36">小时</text>
          <text class="fs-36">{{ getSleepDurationMinutes(sittingRiskInfo?.activeMinutes || 0) }}</text>
          <text class="fs-36">分钟</text>
        </view>
      </view>
    </view>
    <!-- <view class="bg-white r-50 mt-20 p-40">
      <view class="flex ai-center jc-between">
        <text class="fs-36">站立时间</text>
        <text class="fs-36">{{ sittingRiskInfo?.standingHours || '00' }}h</text>
      </view>
    </view> -->
    <uv-safe-bottom></uv-safe-bottom>
  </view>
</template>

<style lang="scss" scoped>
.tag {
  background: #fef7ea;
  color: #fcb72e;
  font-size: 24rpx;
  border-radius: 25rpx;
}
</style>
