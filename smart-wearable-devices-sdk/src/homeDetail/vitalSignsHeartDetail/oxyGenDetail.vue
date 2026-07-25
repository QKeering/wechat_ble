<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow, onPullDownRefresh, onReachBottom, onUnload } from '@dcloudio/uni-app';
import homeHeartChart from '@/components/homeHeartChart.vue';
import { defaultEchartOption } from '@/homeDetail/vitalSignsHeartDetail/echartOptions';
import { getBloodOxygenDetail } from '@/common/api/homeDetail';
import { formatDate, calculateOffset, getPrevDate, getNextDate, formatLocalDate } from '@/utils/utils.js';
import type { heartRateDetail, Point } from '@/types/api/homeDetail';
import type { HistoryPageSilentRequestConfig } from '@/composables/useRingBusinessHistoryPageSync';
import { cloneDeep } from 'lodash-es';
import { useUserStore } from '@/stores/user';
import { pickMetricNumber, withMetricDetailFallback } from './metricFallback';
import { buildDetailTimeTicks } from './detailTimeAxis';
const userStore = useUserStore();
const echarts = require('../../static/echarts.min.js');
const getVitalDetailSilentRequestConfig = (): HistoryPageSilentRequestConfig => ({
  timeout: 90000,
  custom: { toast: false, catch: true }
});

// 滑动日期相关
const list = ref<string[]>(['日', '周', '月']);
const current = ref<number>(0);
const currentName = ref('day');
const currentList = ref<string[]>(['day', 'week', 'month']);
const offset = ref<number>(0);

const chartRefT = ref<any>(null);

const scrollTop = ref<number>(0);
const activeEchartOption = ref(defaultEchartOption);
const chartInstance = ref<any>(null);

const oxyGen = ref(0);
const oxyGenDisplay = computed(() => (oxyGen.value > 0 ? oxyGen.value : '--'));
const currentDate = ref(new Date());

const heartRateList = ref([
  { label: '平均血氧', value: '43' },
  { label: '平均范围', value: '76' }
]);

const heartRateObj = ref<heartRateDetail>({});
const chartData = ref<Point[]>([]);
const chartTimeTicks = computed(() => buildDetailTimeTicks(chartData.value));
watch(
  chartData,
  (newData, oldData) => {
    if (newData.length > 0 && chartRefT.value && chartRefT.value.chartRef) {
      // 有数据且图表已初始化，重新设置图表选项
      initChart(chartRefT.value.chartRef);
    }
  },
  { deep: true, immediate: true }
);
const heartRateIcon = computed(() => {
  const oxygenLevel = oxyGen.value;
  if (!Number.isFinite(oxygenLevel) || oxygenLevel <= 0) return '/static/images/homeDetail/normal.png';

  // 重度缺氧 - 血氧过低（低于85%）
  if (oxygenLevel < 89) {
    return '/static/images/homeDetail/cry.png';
  }
  // 轻度缺氧 - 血氧偏低（90%-94%）
  else if (oxygenLevel >= 90 && oxygenLevel <= 94) {
    return '/static/images/homeDetail/normal.png';
  }
  // 正常血氧 - 正常范围（95%-100%）
  else if (oxygenLevel >= 95 && oxygenLevel <= 100) {
    return '/static/images/homeDetail/smile.png';
  }
  // 默认返回normal
  return '/static/images/homeDetail/normal.png';
});
const oxyGenText = computed(() => {
  const oxygenLevel = oxyGen.value;
  if (!Number.isFinite(oxygenLevel) || oxygenLevel <= 0) return '\u6682\u65e0';
  // 重度缺氧 - 血氧过低（低于85%）
  if (oxygenLevel < 85) {
    return '严重缺氧';
  }
  // 中度缺氧 - 血氧偏低（85%-89%）
  else if (oxygenLevel >= 85 && oxygenLevel <= 89) {
    return '中度缺氧';
  }
  // 轻度缺氧 - 血氧偏低（90%-94%）
  else if (oxygenLevel >= 90 && oxygenLevel <= 94) {
    return '轻度缺氧';
  }
  // 正常血氧 - 正常范围（95%-100%）
  else if (oxygenLevel >= 95 && oxygenLevel <= 100) {
    return '正常';
  }

  // 默认返回正常
  return '正常';
});
const statusClass = computed(() => {
  const classMap = {
    严重缺氧: 'status-bad',
    中度缺氧: 'status-bad',
    轻度缺氧: 'status-normal',
    正常: 'status-good',
    暂无: 'status-normal'
  };
  return classMap[oxyGenText.value] || 'status-good';
});
const change = async (index: number) => {
  current.value = index;
  currentName.value = currentList.value[index];
  currentDate.value = new Date();
  offset.value = 0;
  await getOxyGenDetail();

  if (chartRefT.value && chartRefT.value.chartRef) {
    initChart(chartRefT.value.chartRef);
  }
};
const formatDateLocal = (date: Date, timeString: string) => {
  return formatDate(date, timeString);
};
// 计算偏移量的方法
const calculateOffsetLocal = () => {
  offset.value = calculateOffset(currentDate.value, current.value);
};

const prevDay = async () => {
  currentDate.value = getPrevDate(currentDate.value, current.value);
  calculateOffsetLocal();
  await getOxyGenDetail();
  if (chartRefT.value && chartRefT.value.chartRef) {
    initChart(chartRefT.value.chartRef);
  }
};
const nextDay = async () => {
  const nextDate = getNextDate(currentDate.value, current.value);
  if (nextDate) {
    currentDate.value = nextDate;
    calculateOffsetLocal();
    await getOxyGenDetail();
    if (chartRefT.value && chartRefT.value.chartRef) {
      initChart(chartRefT.value.chartRef);
    }
  } else {
    (uni as any).$uv.toast('不能导航到未来的日期');
  }
};
const getProcessedOption = () => {
  // 深拷贝原option
  // const newOption = JSON.parse(JSON.stringify(activeEchartOption.value));
  const newOption = cloneDeep(activeEchartOption.value) as any;
  // 使用实际数据而不是测试数据
  // 1. 根据数据生成完整的x轴数据，如果没有数据则生成24小时数据
  let fullXData: string[];
  let fullSeriesData: (number | null)[] = [];

  if (chartData.value && chartData.value?.length > 0) {
    // 有数据时使用实际数据
    fullXData = chartData.value.map((item: Point) => item.time?.toString() || '00:00');
    // fullSeriesData = chartData.value.map((item) => Number(item.value) || 0);
    fullSeriesData =
      chartData.value?.map((item: Point) => {
        const value = Number(item.value);
        // 将0值替换为null，让ECharts跳过这些点
        return value === 0 ? null : value;
      }) || [];
  } else {
    // 没有数据时生成24小时的默认数据
    fullXData = Array.from({ length: 24 }, (_, i) => {
      const hour = i.toString().padStart(2, '0');
      return `${hour}:00`;
    });
    fullSeriesData = chartData.value.map((item) => Number(item.value) || 0);
  }
  // const fullXData = chartData.value.map((item: Point) => item.time?.toString() || '00:00');
  // const fullSeriesData = chartData.value.map((item) => Number(item.value) || 0);
  // 替换xAxis.data和series.data为扩展后的数据
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData;

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
  // 针对单个数据点的特殊处理
  if (fullSeriesData.length === 1) {
    // 显示数据点标记
    newOption.series[0].symbol = 'circle';
    newOption.series[0].symbolSize = 6;
    // 显示tooltip以便查看数据
    newOption.tooltip.show = true;
  }
  // else {
  //   // 多个数据点时使用默认配置
  //   newOption.series[0].symbol = 'none';
  // }
  // 根据数据最大值动态调整y轴
  // const maxValue = Math.max(...fullSeriesData.filter((v) => !isNaN(v)));
  // if (maxValue > 50) {
  //   newOption.yAxis.max = Math.ceil(maxValue / 10) * 10;
  //   newOption.yAxis.interval = Math.ceil(maxValue / 50) * 10;
  // }

  return newOption;
};
const initChart = async (chartRef: any) => {
  if (!chartRef) return;

  try {
    const chart = await chartRef.init(echarts);
    chartInstance.value = chart;
    // 应用处理后的option
    chart.setOption(getProcessedOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};
const getOxyGenDetail = async () => {
  const isoDate = formatLocalDate(currentDate.value);
  const res = await getBloodOxygenDetail({
    date: isoDate,
    type: currentName.value,
    offset: offset.value
  }, getVitalDetailSilentRequestConfig());
  if (res) {
    const detail = withMetricDetailFallback(
      res,
      userStore.healthData?.bloodOxygen ?? userStore.healthData?.bloodOxygenSaturation ?? userStore.latestMetrics?.bloodOxygen ?? oxyGen.value,
      {
        min: 70,
        max: 100,
        extra: { avgValueRange: (res as any)?.avgValueRange || '95-100' }
      }
    );
    heartRateObj.value = detail;
    heartRateList.value = [
      { label: '平均血氧', value: heartRateObj.value.avgValue || '0' },
      { label: '平均范围', value: heartRateObj.value.avgValueRange || '0' }
    ];
    chartData.value = heartRateObj.value.chartData || [];
    const latestPoint = [...chartData.value].reverse().find((item) => pickMetricNumber([item.value], 70, 100) !== undefined);
    oxyGen.value =
      pickMetricNumber([heartRateObj.value.newValue, latestPoint?.value, heartRateObj.value.avgValue, oxyGen.value], 70, 100) || 0;
  }
};
const leftClick = () => {
  uni.navigateBack();
};
onLoad(async (options) => {
  currentName.value = currentList.value[current.value];
  oxyGen.value = pickMetricNumber([options?.oxyGen], 70, 100) || 0;
  await getOxyGenDetail();
});
onUnload(() => {
  if (chartRefT.value && chartRefT.value.chartRef) {
    chartRefT.value.chartRef.dispose();
  }
});
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
</script>
<template>
  <view class="relative p-30">
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="血氧详情" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view class="bgcWrapper"></view>
    <view class="content">
      <uv-subsection
        bgColor="#fff0f0"
        :list="list"
        :current="current"
        activeColor="#010101"
        custom-style="height: 60rpx;border-radius: 40rpx; height:80rpx"
        custom-item-style="border-radius: 40rpx;backgroundColor: #ffffff"
        @change="change"
      ></uv-subsection>
      <view class="flex ai-center jc-between mt-40" style="z-index: 99">
        <view @tap="prevDay">
          <uv-icon name="arrow-left" size="22"></uv-icon>
        </view>
        <text v-if="current === 0" class="date-text fs-36 fw-400">{{ formatDateLocal(currentDate, 'day') }}</text>
        <text v-if="current === 1" class="date-text fs-36 fw-400">{{ formatDateLocal(currentDate, 'week') }}</text>
        <text v-if="current === 2" class="date-text fs-36 fw-400">{{ formatDateLocal(currentDate, 'month') }}</text>
        <view @tap="nextDay">
          <uv-icon name="arrow-right" size="22"></uv-icon>
        </view>
      </view>
      <view class="health-card p-30 bg-white r-50 mt-40">
        <view class="flex ai-center jc-between mb-20">
          <text class="fs-36 fw-400">血氧值</text>
          <text class="fs-28 t-979797">当前血氧</text>
        </view>
        <view class="flex ai-center jc-between">
          <view class="flex ai-center">
            <uv-image :src="heartRateIcon" width="68rpx" height="68rpx"></uv-image>
            <view>
              <text class="fs-72">{{ oxyGenDisplay }}</text>
              <text class="fs-24 ml-10">%</text>
            </view>
          </view>
          <view class="status-tag" :class="statusClass">{{ oxyGenText }}</view>
        </view>
      </view>
      <view class="mt-30">
        <homeHeartChart
          ref="chartRefT"
          card-title="指标数据"
          :stats="heartRateList"
          :showRigntBox="false"
          :showChartTitle="false"
          :showButtomCard="false"
          :showTopCard="true"
          :time-ticks="chartTimeTicks"
          @chart-finished="(chartRef) => initChart(chartRef)"
        />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.bgcWrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 25vh;
  z-index: -1;
}
.bgcWrapper {
  background: linear-gradient(to bottom, #ff9e9e, #f1f3f6);
}
.date-slider {
  gap: 16rpx;
}
.health-card {
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.05);
}
.status-good {
  font-size: 28rpx;
  color: #2e70fc;
  background-color: #ebf1ff;
  padding: 8rpx 24rpx;
  border-radius: 20rpx;
}
.status-normal {
  font-size: 28rpx;
  color: #fcb72e;
  background-color: #fff8eb;
  padding: 8rpx 24rpx;
  border-radius: 20rpx;
}
.status-bad {
  font-size: 28rpx;
  color: #fc2e2e;
  background-color: #ffebeb;
  padding: 8rpx 24rpx;
  border-radius: 20rpx;
}
</style>
