<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
import sleepEchartItem from '@/components/sleepEchartItem.vue';
import { defaultEchartOption, pressureOption } from '@/pagesA/echartOptions/sleepPrepOptions';
import lineProgresss from '@/pagesA/components/lineProgress.vue';
import { getSleepPreparationDetail } from '@/common/api/heatlthSummary';
import type { SleepPreparationResp, TrendChartItem } from '@/types/api/healthSummary';
import { cloneDeep } from 'lodash-es';
const echarts = require('../../static/echarts.min.js');

const sleepPrepInfo = ref<SleepPreparationResp>();
// 左边最大变化范围
const maxLeftRange = 50;
// 右边最大变化范围
const maxRightRange = 50;
const getProcessedOption = () => {
  const testTrendChartData = [
    { weekLabel: '11月第1周', value: 70, level: '优秀' },
    { weekLabel: '11月第2周', value: 65, level: '良好' },
    { weekLabel: '11月第3周', value: 72, level: '优秀' },
    { weekLabel: '11月第4周', value: 68, level: '良好' },
    { weekLabel: '12月第1周', value: 75, level: '优秀' },
    { weekLabel: '12月第2周', value: 62, level: '正常' },
    { weekLabel: '12月第3周', value: 78, level: '优秀' },
    { weekLabel: '12月第4周', value: 71, level: '良好' }
  ];
  // 深拷贝原option
  const newOption = cloneDeep(defaultEchartOption);

  // 1. 生成x轴数据 - 智能合并相同月份的周标签
  const fullXData =
    // testTrendChartData.map((item: TrendChartItem) => {
    sleepPrepInfo.value?.trendChart?.map((item: TrendChartItem) => {
      return item?.weekLabel;
    }) || [];

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

  // 2. 生成完整的series数据（数值类型）
  // const fullSeriesData = testTrendChartData.map((item) => Number(item.value)) || [];
  const fullSeriesData = sleepPrepInfo.value?.trendChart?.map((item) => Number(item.value)) || [];

  // 3. 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = processedXData;
  newOption.series[0].data = fullSeriesData;

  // 4. 使用自定义formatter显示月份标签
  newOption.xAxis.axisLabel.formatter = (value: string, index: number) => {
    return xAxisLabels[index] || ''; // 只显示月份标签，其他位置显示空字符串
  };

  return newOption;
};
const initChart = async (chartRef: any) => {
  if (!chartRef) return;
  try {
    const chart = await chartRef.init(echarts);
    // chart.setOption(defaultEchartOption);
    chart.setOption(getProcessedOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};

// const lightIntensityChart = async () => {
//   if (!lightIntensityRef.value) return;
//   try {
//     const pie = await lightIntensityRef.value.init(echarts);
//     pie.setOption(pressureOption);
//   } catch (error) {
//     console.error('图表初始化失败:', error);
//   }
// };
onLoad(async () => {
  sleepPrepInfo.value = await getSleepPreparationDetail();
});
</script>
<!-- 睡前准备 -->
<template>
  <view class="pl-30 pr-30 pt-30">
    <sleepEchartItem
      title="睡前准备"
      :subtitle="sleepPrepInfo?.overview?.level || '--'"
      :dateRange="sleepPrepInfo?.overview?.dateRange || '--'"
      @chart-finished="(chartRef) => initChart(chartRef)"
    >
      <template #comparison>
        <!-- <view class="tag flex ai-center ml-20 p-10"> -->
        <view class="flex ai-center ml-20 p-10" :class="[sleepPrepInfo?.overview?.trend === '保持不变' ? 'tag' : 'date-tag']">
          <text>{{ sleepPrepInfo?.overview?.trend || '--' }}</text>

          <view v-if="sleepPrepInfo?.overview?.trend !== '保持不变'">
            <uv-image
              src="/static/images/homeDetail/orArrowBottom.png"
              width="24rpx"
              height="24rpx"
              :style="{ transform: (sleepPrepInfo?.overview?.trendValue ?? 0) > 0 ? 'rotate(180deg)' : 'rotate(0deg)' }"
            ></uv-image>
          </view>
        </view>
      </template>
    </sleepEchartItem>

    <view class="flex ai-center jc-between mt-50 mb-30">
      <text class="fs-36 ml-40">睡前指标变化</text>
      <view class="flex ai-center">
        <view class="dot mr-10"></view>
        <text class="fs-24">正常范围</text>
      </view>
    </view>
    <view class="p-40 bg-white r-50 mb-30">
      <view class="fs-36 mb-30">心率变化</view>
      <view class="mb-50">
        <text class="t-979797 fs-28">一般而言，心率在入睡前有较明显下降幅度，反应入睡前身心放松较充分。</text>
      </view>
      <view class="ta-c">
        <text class="fs-24 mb-20 current-text">
          本周睡前{{ sleepPrepInfo?.heartRateChange?.currentDirection || '上升' }}{{ sleepPrepInfo?.heartRateChange?.currentValue || 0 }}次/分钟
        </text>
        <lineProgresss
          :current-value="sleepPrepInfo?.heartRateChange?.currentValue || 0"
          :avg-value="sleepPrepInfo?.heartRateChange?.avgValue || 0"
          :max-left-range="maxLeftRange"
          :max-right-range="maxRightRange"
        />
        <text class="fs-24 t-979797">近期睡前平均{{ sleepPrepInfo?.heartRateChange?.avgDirection || '上升' }}{{ sleepPrepInfo?.heartRateChange?.avgValue || 0 }}次/分钟</text>
      </view>
    </view>
    <view class="p-40 bg-white r-50 mb-30">
      <view class="fs-36 mb-30">心率变异性变化</view>
      <view class="mb-50">
        <text class="t-979797 fs-28">一般而言，心率变异性在入睡前有较明显上升幅度，反应入睡前身心放松较充分。</text>
      </view>
      <view class="ta-c">
        <text class="fs-24 mb-20 current-text">本周睡前{{ sleepPrepInfo?.hrvChange?.currentDirection }}{{ sleepPrepInfo?.hrvChange?.currentValue || 0 }}毫秒</text>
        <lineProgresss
          :current-value="sleepPrepInfo?.hrvChange?.currentValue || 0"
          :avg-value="sleepPrepInfo?.hrvChange?.avgValue || 0"
          :max-left-range="maxLeftRange"
          :max-right-range="maxRightRange"
        />
        <text class="fs-24 t-979797">近期睡前平均{{ sleepPrepInfo?.hrvChange?.avgDirection }}{{ sleepPrepInfo?.hrvChange?.avgValue || 0 }}毫秒</text>
      </view>
    </view>
    <!-- <view class="bg-white r-50 mb-30 p-30">
      <view class="">
        <view class="score-title fs-36">光照强度</view>
      </view>
      <view class="flex ai-center jc-center">
        <l-echart ref="lightIntensityRef" @finished="lightIntensityChart" style="width: 100%; height: 220rpx; margin: 0"></l-echart>
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

.date-tag {
  background: #ebf1ff;
  color: #2e70fc;
  font-size: 24rpx;
  border-radius: 25rpx;
}
.dot {
  width: 20rpx;
  height: 10rpx;
  border-radius: 5rpx;
  background-color: #2e70fc; /* 图中蓝色 */
}
.current-text {
  display: block;
}
</style>
