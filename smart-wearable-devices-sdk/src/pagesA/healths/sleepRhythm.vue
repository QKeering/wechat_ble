<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
import sleepEchartItem from '@/components/sleepEchartItem.vue';
import { defaultEchartOption, sleepTimeOption } from '@/pagesA/echartOptions/sleepRhythmOptions';
import lineProgresss from '@/pagesA/components/lineProgress.vue';
import { getSleepRhythmDetail } from '@/common/api/heatlthSummary';
import type { SleepRhythmResp, TrendChartItemS } from '@/types/api/healthSummary';
import { cloneDeep } from 'lodash-es';
const echarts = require('../../static/echarts.min.js');

const sleepRhythmInfo = ref<SleepRhythmResp>();
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
    sleepRhythmInfo?.value?.trendChart || [],
    // testTrendChartData,
    (item) => Number(item.score)
  );
};

const getSecoundOption = () => {
  const testTrendChartData = [
    { weekLabel: '11月第1周', avgSleepTime: 140 },
    { weekLabel: '11月第2周', avgSleepTime: 60 },
    { weekLabel: '11月第3周', avgSleepTime: 560 },
    { weekLabel: '11月第4周', avgSleepTime: 320 },
    { weekLabel: '12月第1周', avgSleepTime: 110 },
    { weekLabel: '12月第2周', avgSleepTime: 700 },
    { weekLabel: '12月第3周', avgSleepTime: 500 }
  ];

  return createChartOption(
    sleepTimeOption,
    sleepRhythmInfo?.value?.regularityChart || [],
    // testTrendChartData,
    (item) => Number(item.avgSleepTime)
  );
};

// 通用的图表选项创建函数
const createChartOption = (baseOption: any, data: any[], dataExtractor: (item: any) => number) => {
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
  sleepRhythmInfo.value = await getSleepRhythmDetail();
  if (!sleepRhythmInfo.value) {
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
      title="睡眠节律"
      :subtitle="sleepRhythmInfo?.overview?.level || '--'"
      :dateRange="sleepRhythmInfo?.overview?.dateRange || '--'"
      @chart-finished="(chartRef) => initChart(chartRef)"
    >
      <template #comparison>
        <!-- <view class="tag flex ai-center ml-20 p-10"> -->
        <view class="flex ai-center ml-20 p-10" :class="[sleepRhythmInfo?.overview?.trend !== '保持不变' ? 'tag' : 'date-tag']">
          <text>{{ sleepRhythmInfo?.overview?.trend || '--' }}</text>
          <view v-if="sleepRhythmInfo?.overview?.trend !== '保持不变'">
            <uv-image
              src="/static/images/homeDetail/orArrowBottom.png"
              width="24rpx"
              height="24rpx"
              :style="{ transform: (sleepRhythmInfo?.overview?.trendValue ?? 0) > 0 ? 'rotate(180deg)' : 'rotate(0deg)' }"
            ></uv-image>
          </view>
        </view>
      </template>
    </sleepEchartItem>
    <sleepEchartItem title="睡眠规律性" :showChartDate="false" :showSecoundTopTitle="false" @chart-finished="(chartRef) => lightSleepTimeChart(chartRef)"></sleepEchartItem>
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
.date-tag {
  background: #ebf1ff;
  color: #2e70fc;
  font-size: 24rpx;
  border-radius: 25rpx;
}
</style>
