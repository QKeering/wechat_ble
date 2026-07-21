<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow, onPullDownRefresh, onReachBottom, onUnload } from '@dcloudio/uni-app';
import homeHeartChart from '@/components/homeHeartChart.vue';
import { temperatureOption } from '@/homeDetail/vitalSignsHeartDetail/echartOptions';
import { getBodyTemperatureDetail } from '@/common/api/homeDetail';
import { formatDate, calculateOffset, getPrevDate, getNextDate, formatLocalDate } from '@/utils/utils.js';
import type { heartRateDetail, Point } from '@/types/api/homeDetail';
import type { HistoryPageSilentRequestConfig } from '@/composables/useRingBusinessHistoryPageSync';
import { cloneDeep } from 'lodash-es';
import { useUserStore } from '@/stores/user';
const userStore = useUserStore();
const echarts = require('../../static/echarts.min.js');
const getVitalDetailSilentRequestConfig = (): HistoryPageSilentRequestConfig => ({
  timeout: 90000,
  custom: { toast: false, catch: true }
});

const chartRefT = ref<any>(null);

// 滑动日期相关
const list = ref<string[]>(['日', '周', '月']);
const current = ref<number>(0);
const currentName = ref('day');
const currentList = ref<string[]>(['day', 'week', 'month']);
list.value = ['日', '周', '月'];
const offset = ref<number>(0);

const scrollTop = ref<number>(0);
const activeEchartOption = ref(temperatureOption);
const chartInstance = ref<any>(null);

const temperature = ref(0);
const currentDate = ref(new Date());

const heartRateList = ref([
  { label: '平均体温', value: '43' },
  { label: '平均范围', value: '76' }
]);

const heartRateObj = ref<heartRateDetail>({});
const chartData = ref<Point[]>([]);
const normalizeTemperatureDisplay = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Number(numeric.toFixed(2));
};
const temperatureDisplay = computed(() => (temperature.value > 0 ? temperature.value : '--'));
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
const temperatureIcon = computed(() => {
  const rate = temperature.value;
  if (!Number.isFinite(rate) || rate <= 0) return '/static/images/homeDetail/normal.png';

  // 心动过缓 (Bradycardia) - 心率过低
  if (rate < 36) {
    return '/static/images/homeDetail/normal.png';
  }
  // 正常心率 (Normal) - 理想的静息心率范围
  else if (rate >= 36 && rate <= 37.5) {
    return '/static/images/homeDetail/smile.png';
  }
  // 高体温 - 体温过高
  else if (rate > 37.5) {
    return '/static/images/homeDetail/cry.png';
  }

  // 默认返回normal
  return '/static/images/homeDetail/normal.png';
});
const temperatureText = computed(() => {
  const temp = temperature.value;
  if (!Number.isFinite(temp) || temp <= 0) return '暂无';

  // 低体温 - 体温过低
  if (temp < 36) {
    return '偏低';
  }
  // 正常体温 - 正常范围
  else if (temp >= 36 && temp <= 37.5) {
    return '正常';
  }
  // 高体温 - 体温过高
  else if (temp > 37.5) {
    return '偏高';
  }

  // 默认返回正常
  return '正常';
});
const statusClass = computed(() => {
  const classMap: Record<string, string> = {
    偏低: 'status-bad',
    正常: 'status-good',
    偏高: 'status-normal'
  };
  return classMap[temperatureText.value] || 'status-good';
});
const change = async (index: number) => {
  current.value = index;
  currentName.value = currentList.value[index];
  currentDate.value = new Date();
  offset.value = 0;
  await getTemperatureDetail();
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
  await getTemperatureDetail();
  if (chartRefT.value && chartRefT.value.chartRef) {
    initChart(chartRefT.value.chartRef);
  }
};
const nextDay = async () => {
  const nextDate = getNextDate(currentDate.value, current.value);
  if (nextDate) {
    currentDate.value = nextDate;
    calculateOffsetLocal();
    await getTemperatureDetail();
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
  // 使用实际数据而不是测试数据
  // 1. 根据数据生成完整的x轴数据，如果没有数据则生成24小时数据
  let fullXData: string[];
  let fullSeriesData: number[];

  if (chartData.value && chartData.value?.length > 0) {
    // 有数据时使用实际数据
    fullXData = chartData.value.map((item: Point) => item.time?.toString() || '00:00');
    fullSeriesData = chartData.value.map((item) => Number(item.value) || 0);
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
  const startColor = '#e9f7ee';
  const endColor = '#69ca8d';

  const mixColors = (percent: number): string => {
    // 解析十六进制颜色为RGB数组
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [255, 255, 255];
    };
    const startRgb = hexToRgb(startColor);
    const endRgb = hexToRgb(endColor);
    // 根据占比混合RGB值
    const rgb = startRgb.map((c, i) => Math.round(c + (endRgb[i] - c) * percent));
    return `rgb(${rgb.join(',')})`;
  };
  // const seriesData = test1;
  const seriesData = fullSeriesData.map((value, index) => {
    // 处理单个数据点的情况
    let percent = 0.5; // 默认使用中间颜色

    if (fullSeriesData.length > 1) {
      // 多个数据点时正常计算百分比
      percent = index / (fullSeriesData.length - 1);
    }

    // 生成纯色（随索引增加，颜色越来越深）
    const solidColor = mixColors(percent);

    return {
      value: value,
      // 每个柱子单独设置纯色
      itemStyle: { color: solidColor }
    };
  });
  // 替换xAxis.data和series.data为扩展后的数据
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = seriesData;

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
  // // 针对单个数据点的特殊处理
  // if (fullSeriesData.length === 1) {
  //   // 显示数据点标记
  //   newOption.series[0].symbol = 'circle';
  //   newOption.series[0].symbolSize = 6;
  //   // 显示tooltip以便查看数据
  //   newOption.tooltip.show = true;
  // }
  // else {
  //   // 多个数据点时使用默认配置
  //   newOption.series[0].symbol = 'none';
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
const getTemperatureDetail = async () => {
  const isoDate = formatLocalDate(currentDate.value);
  const res = await getBodyTemperatureDetail({
    date: isoDate, //固定今天日期
    type: currentName.value,
    offset: offset.value
  }, getVitalDetailSilentRequestConfig());
  if (res) {
    heartRateObj.value = res;
    heartRateList.value = [
      { label: '平均体温', value: heartRateObj.value.avgValue || '0' },
      { label: '平均范围', value: heartRateObj.value.avgValueRange || '0' }
    ];
    chartData.value = heartRateObj.value.chartData || [];
    const latestPoint = [...chartData.value].reverse().find((item) => normalizeTemperatureDisplay(item.value) > 0);
    temperature.value = normalizeTemperatureDisplay(heartRateObj.value.newValue ?? latestPoint?.value ?? heartRateObj.value.avgValue ?? temperature.value);
    heartRateList.value = [
      { label: '平均体温', value: heartRateObj.value.avgValue || '0' },
      { label: '平均范围', value: heartRateObj.value.avgValueRange || '0' }
    ];
  }
};
const leftClick = () => {
  uni.navigateBack();
};
onLoad(async (options) => {
  currentName.value = currentList.value[current.value];
  temperature.value = normalizeTemperatureDisplay(options?.temperature);
  await getTemperatureDetail();
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
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="体温详情" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view class="bgcWrapper"></view>
    <view class="content">
      <uv-subsection
        bgColor="#f2fbf5"
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
        <text class="date-text fs-36 fw-400">{{ formatDate(currentDate) }}</text>
        <view @tap="nextDay">
          <uv-icon name="arrow-right" size="22"></uv-icon>
        </view>
      </view>
      <view class="health-card p-30 bg-white r-50 mt-40">
        <view class="flex ai-center jc-between mb-20">
          <text class="fs-36 fw-400">体温</text>
          <text class="fs-28 t-979797">当前体温值</text>
        </view>
        <view class="flex ai-center jc-between">
          <view class="flex ai-center">
            <uv-image :src="temperatureIcon" width="68rpx" height="68rpx"></uv-image>
            <view>
              <text class="fs-72">{{ temperatureDisplay }}</text>
              <text class="fs-24 ml-10">°C</text>
            </view>
          </view>
          <view class="status-tag" :class="statusClass">{{ temperatureText }}</view>
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
  background: linear-gradient(to bottom, #a6e0bc, #f1f3f6);
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
