<script setup lang="ts">
import { ref, computed, watch, h } from 'vue';
import { onLoad, onPageScroll, onShow, onPullDownRefresh, onReachBottom, onUnload } from '@dcloudio/uni-app';
import homeHeartChart from '@/components/homeHeartChart.vue';
import { defaultEchartOption } from '@/homeDetail/vitalSignsHeartDetail/echartOptions';
import { getHrvDetail } from '@/common/api/homeDetail';
import { formatDate, calculateOffset, getPrevDate, getNextDate, formatLocalDate } from '@/utils/utils.js';
import type { heartRateDetail, Point } from '@/types/api/homeDetail';
import type { HistoryPageSilentRequestConfig } from '@/composables/useRingBusinessHistoryPageSync';
import { useUserStore } from '@/stores/user';
import { cloneDeep } from 'lodash-es';
import { pickMetricNumber, withMetricDetailFallback } from './metricFallback';
import { buildDailyDetailTimeTicks, buildDetailTimeTicks } from './detailTimeAxis';
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
const heartRateVariability = ref(0);
const normalizeIntegerDisplayMetric = (value: unknown, min = 0, max = Number.POSITIVE_INFINITY) => {
  const numeric = pickMetricNumber([value], min, max);
  return numeric == null ? 0 : Math.round(numeric);
};
const formatIntegerDisplayMetric = (value: unknown, fallback = '0', min = 0, max = Number.POSITIVE_INFINITY) => {
  const numeric = normalizeIntegerDisplayMetric(value, min, max);
  return numeric > 0 ? String(numeric) : fallback;
};
const formatIntegerRangeDisplayMetric = (value: unknown, fallback = '0') => {
  if (value == null || value === '') return fallback;
  const text = String(value);
  if (!/\d/.test(text)) return fallback;
  return text.replace(/-?\d+(?:\.\d+)?/g, (matched) => {
    const numeric = Number(matched);
    return Number.isFinite(numeric) ? String(Math.round(numeric)) : matched;
  });
};
const heartRateVariabilityDisplay = computed(() => formatIntegerDisplayMetric(heartRateVariability.value, '--', 1, 300));
const currentDate = ref(new Date());

const heartRateList = ref([
  { label: '心率变异性', value: '43' },
  { label: '关键指数', value: '76' }
]);

const heartRateObj = ref<heartRateDetail>({});
const chartData = ref<Point[]>([]);
const chartTimeTicks = computed(() => (currentName.value === 'day' ? buildDailyDetailTimeTicks() : buildDetailTimeTicks(chartData.value)));
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
  const hrv = heartRateVariability.value;
  if (!Number.isFinite(hrv) || hrv <= 0) return '/static/images/homeDetail/normal.png';

  // 低心率变异性 - 自主神经系统功能较差
  if (hrv < 20) {
    return '/static/images/homeDetail/cry.png';
  }
  // 正常心率变异性 - 健康的自主神经功能
  else if (hrv >= 60 && hrv <= 100) {
    return '/static/images/homeDetail/normal.png';
  }
  // 高心率变异性 - 优秀的自主神经功能
  else if (hrv > 100) {
    return '/static/images/homeDetail/smile.png';
  }

  // 默认返回normal
  return '/static/images/homeDetail/normal.png';
});
const heartRateVariabilityText = computed(() => {
  const hrv = heartRateVariability.value; // 心率变异性值（单位：ms）
  if (!Number.isFinite(hrv) || hrv <= 0) return '\u6682\u65e0';

  // 低心率变异性 - 自主神经系统功能较差
  if (hrv < 20) {
    return '偏低';
  }
  // 正常心率变异性 - 健康的自主神经功能
  else if (hrv >= 20 && hrv <= 100) {
    return '正常';
  }
  // 高心率变异性 - 优秀的自主神经功能
  else if (hrv > 100) {
    return '偏高';
  }

  // 默认返回正常
  return '正常';
});
const statusClass = computed(() => {
  const classMap = {
    偏低: 'status-bad',
    正常: 'status-good',
    偏高: 'status-normal',
    暂无: 'status-normal'
  };
  return classMap[heartRateVariabilityText.value] || 'status-good';
});
const change = async (index: number) => {
  current.value = index;
  currentName.value = currentList.value[index];
  currentDate.value = new Date();
  offset.value = 0;
  await getHrvDetailData();
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
  await getHrvDetailData();
  if (chartRefT.value && chartRefT.value.chartRef) {
    initChart(chartRefT.value.chartRef);
  }
};
const nextDay = async () => {
  const nextDate = getNextDate(currentDate.value, current.value);
  if (nextDate) {
    currentDate.value = nextDate;
    calculateOffsetLocal();
    await getHrvDetailData();
    if (chartRefT.value && chartRefT.value.chartRef) {
      initChart(chartRefT.value.chartRef);
    }
  } else {
    (uni as any).$uv.toast('不能导航到未来的日期');
  }
};
const getProcessedOption = () => {
  // 深拷贝原option
  const newOption = cloneDeep(activeEchartOption.value) as any;

  // 1. 根据数据生成完整的x轴数据，如果没有数据则生成24小时数据
  let fullXData: string[];
  let fullSeriesData: (number | null)[] = [];

  if (chartData.value && chartData.value?.length > 0) {
    // 有数据时使用实际数据
    fullXData = chartData.value.map((item: Point) => item.time?.toString() || '00:00');
    fullSeriesData = chartData.value.map((item) => Number(item.value) || 0);
    fullSeriesData =
      chartData.value.map((item: Point) => {
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

  // 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData;
  newOption.yAxis.min = 0;
  newOption.yAxis.max = 200;
  newOption.yAxis.interval = 40;

  newOption.xAxis.axisLabel = {
    ...newOption.xAxis.axisLabel,
    interval: 0,
    formatter: (value: string, index: number) => {
      const dataLength = newOption.xAxis.data.length;
      // 如果数据长度为24，则只显示指定刻度
      if (dataLength === 24) {
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

  // 根据数据最大值动态调整y轴
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
const getHrvDetailData = async () => {
  const isoDate = formatLocalDate(currentDate.value);
  const res = await getHrvDetail({
    date: isoDate,
    type: currentName.value,
    offset: offset.value
  }, getVitalDetailSilentRequestConfig());
  if (res) {
    const detail = withMetricDetailFallback(
      res,
      userStore.healthData?.hrv ?? userStore.healthData?.heartRateVariability ?? userStore.latestMetrics?.hrv ?? heartRateVariability.value,
      {
        min: 1,
        max: 300,
        extra: { avgValueRange: (res as any)?.avgValueRange || '--' }
      }
    );
    heartRateObj.value = detail;
    heartRateList.value = [
      { label: '心率变异性', value: formatIntegerDisplayMetric(heartRateObj.value.avgValue, '0', 1, 300) },
      { label: '关键指数', value: formatIntegerRangeDisplayMetric(heartRateObj.value.avgValueRange) }
    ];
    chartData.value = heartRateObj.value.chartData || [];
    const latestPoint = [...chartData.value].reverse().find((item) => pickMetricNumber([item.value], 1, 300) !== undefined);
    heartRateVariability.value = normalizeIntegerDisplayMetric(
      pickMetricNumber(
        [heartRateObj.value.newValue, latestPoint?.value, heartRateObj.value.avgValue, heartRateVariability.value],
        1,
        300
      ),
      1,
      300
    );
  }
};
const leftClick = () => {
  uni.navigateBack();
};
onLoad(async (options) => {
  currentName.value = currentList.value[current.value];
  heartRateVariability.value = normalizeIntegerDisplayMetric(options?.heartRateVariability, 1, 300);

  await getHrvDetailData();
});
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
onUnload(() => {
  if (chartRefT.value && chartRefT.value.chartRef) {
    chartRefT.value.chartRef.dispose();
  }
});
</script>
<template>
  <view class="relative p-30">
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="心率变异性详情" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
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
          <text class="fs-36 fw-400">心率变异性</text>
          <text class="fs-28 t-979797">HRV</text>
        </view>
        <view class="flex ai-center jc-between">
          <view class="flex ai-center">
            <uv-image :src="heartRateIcon" width="68rpx" height="68rpx"></uv-image>
            <view>
              <text class="fs-72">{{ heartRateVariabilityDisplay }}</text>
            </view>
          </view>
          <view class="status-tag" :class="statusClass">{{ heartRateVariabilityText }}</view>
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
