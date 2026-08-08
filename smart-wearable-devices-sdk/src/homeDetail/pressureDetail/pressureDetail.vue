<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app';
import homeHeartChart from '@/components/homeHeartChart.vue';
import { defaultEchartOption } from '@/homeDetail/vitalSignsHeartDetail/echartOptions';
import { getStressData } from '@/common/api/homeDetail';
import { formatDate, calculateOffset, getPrevDate, getNextDate, formatLocalDate } from '@/utils/utils.js';
import type { stressDetail, Point } from '@/types/api/homeDetail';
import { baseOption } from '@/homeDetail/pressureDetail/echartOptions';
import { cloneDeep } from 'lodash-es';
const echarts = require('../../static/echarts.min.js');
const PRESSURE_DETAIL_REQUEST_SOFT_TIMEOUT_MS = 3500;

// 滑动日期相关
const list = ref<string[]>(['日', '周', '月']);
const current = ref<number>(0);
const currentName = ref('day');
const currentList = ref<string[]>(['day', 'week', 'month']);
const offset = ref<number>(0);

const scrollTop = ref<number>(0);
const activeEchartOption = ref(defaultEchartOption);
const chartRef = ref<any>(null);
const chartInstance = ref<any>(null);

const pressureScore = ref(56);
const currentDate = ref(new Date());

const stressDetailObj = ref<stressDetail>();
const maxNumber = ref(0);
const minNumber = ref(0);
let stressDetailRequestSeq = 0;

const getPressureDetailSilentRequestConfig = () => ({
  custom: {
    toast: false,
    catch: true
  }
});

const withPressureDetailSoftTimeout = <T>(task: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`pressure detail request soft timeout: ${PRESSURE_DETAIL_REQUEST_SOFT_TIMEOUT_MS}ms`));
    }, PRESSURE_DETAIL_REQUEST_SOFT_TIMEOUT_MS);

    task()
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });

const pressureIcon = computed(() => {
  const pressireLevel = pressureScore.value;

  // 严重
  if (pressireLevel < 60) {
    return '/static/images/homeDetail/cry.png';
  }
  // 良好
  else if (pressireLevel >= 60 && pressireLevel <= 79) {
    return '/static/images/homeDetail/normal.png';
  }
  // 优秀
  else if (pressireLevel >= 80 && pressireLevel <= 100) {
    return '/static/images/homeDetail/smile.png';
  }
  // 默认返回良好
  return '/static/images/homeDetail/normal.png';
});
const pressureText = computed(() => {
  const pressireLevel = pressureScore.value;
  // 严重
  if (pressireLevel < 60) {
    return '严重';
  }
  // 良好
  else if (pressireLevel >= 60 && pressireLevel <= 79) {
    return '良好';
  }
  // 优秀
  else if (pressireLevel >= 80 && pressireLevel <= 100) {
    return '优秀';
  }

  // 默认返回正常
  return '优秀';
});
const statusClass = computed(() => {
  const classMap = {
    严重: 'status-bad',
    优秀: 'status-good',
    良好: 'status-normal'
  };
  return classMap[pressureText.value] || 'status-good';
});
const change = async (index: number) => {
  current.value = index;
  currentName.value = currentList.value[index];
  currentDate.value = new Date();
  offset.value = 0;
  void refreshPressureDetailChart();
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
  void refreshPressureDetailChart();
};
const nextDay = async () => {
  const nextDate = getNextDate(currentDate.value, current.value);
  if (nextDate) {
    currentDate.value = nextDate;
    calculateOffsetLocal();
    void refreshPressureDetailChart();
  } else {
    (uni as any).$uv.toast('不能导航到未来的日期');
  }
};
const getProcessedOption = () => {
  const testData = [
    // { time: '12-01', value: '60' },
    // { time: '12-02', value: '62' },
    { time: '12-03', value: '65' },
    { time: '12-04', value: '68' },
    { time: '12-05', value: '70' },
    { time: '12-06', value: '72' },
    { time: '12-07', value: '75' },
    { time: '12-08', value: '78' },
    { time: '12-09', value: '80' },
    { time: '12-10', value: '82' }
  ];
  // 深拷贝原option
  const newOption = cloneDeep(baseOption);
  // 确保chartData有数据，否则使用默认数据
  const hasChartData = stressDetailObj.value?.stressChart && stressDetailObj.value?.stressChart.length > 0;
  const fullXData = hasChartData ? stressDetailObj.value?.stressChart?.map((item: Point) => item.time?.toString() || '00:00') : [];
  const fullSeriesData = hasChartData
    ? stressDetailObj.value?.stressChart?.map((item: Point) => Number(item.value) || 0)
    : // testData.map((item: Point) => Number(item.value) || 0)
      // 默认13小时数据
      [];
  // 3. 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = fullXData || [];
  newOption.series[0].data = fullSeriesData || [];

  // 4. 根据series数据最大值动态调整y轴配置
  const validSeriesData = (fullSeriesData || []).filter((value) => Number.isFinite(value));
  const maxValue = validSeriesData.length > 0 ? Math.max(...validSeriesData) : 0;
  maxNumber.value = maxValue;
  minNumber.value = validSeriesData.length > 0 ? Math.min(...validSeriesData) : 0;
  newOption.yAxis = {
    ...newOption.yAxis,
    min: 0,
    max: 150,
    interval: 30
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
          const quarter1 = Math.floor(dataLength / 4);
          const quarter3 = Math.floor((dataLength * 3) / 4);
          return index === quarter1 || index === quarter3 ? value : '';
        }
      }
    }
  };
  return newOption;
};
const updatePressureChart = () => {
  if (chartInstance.value) {
    chartInstance.value.setOption(getProcessedOption());
  }
};
const getStressDetail = async () => {
  const requestSeq = ++stressDetailRequestSeq;
  const isoDate = formatLocalDate(currentDate.value);
  try {
    const res = await withPressureDetailSoftTimeout(() =>
      getStressData(
        {
          date: isoDate,
          type: currentName.value,
          offset: offset.value
        },
        getPressureDetailSilentRequestConfig()
      )
    );
    if (requestSeq !== stressDetailRequestSeq) return false;
    if (res) {
      stressDetailObj.value = res;
      return true;
    }
  } catch (error) {
    if (requestSeq === stressDetailRequestSeq) {
      console.warn('[pressureDetail] getStressDetail failed', error);
    }
  }
  return false;
};
const refreshPressureDetailChart = async () => {
  const changed = await getStressDetail();
  if (changed) updatePressureChart();
};
const initChart = async () => {
  if (!chartRef) return;
  try {
    const chart = await chartRef.value.init(echarts);
    chartInstance.value = chart;
    chart.setOption(getProcessedOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};
const leftClick = () => {
  uni.navigateBack();
};
onLoad((options) => {
  currentName.value = currentList.value[current.value];
  pressureScore.value = options?.pressure || 0;
  void refreshPressureDetailChart();
});
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
</script>
<template>
  <view class="relative p-30">
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="运动详情" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view class="bgcWrapper"></view>
    <view class="content">
      <uv-subsection
        bgColor="#ecfdf8"
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
          <text class="fs-36 fw-400">健康评分</text>
          <text class="fs-28 t-979797">当前压力值</text>
        </view>
        <view class="flex ai-center jc-between">
          <view class="flex ai-center">
            <uv-image :src="pressureIcon" width="68rpx" height="68rpx"></uv-image>
            <view>
              <text class="fs-72 ml-10">{{ pressureScore }}</text>
              <text class="fs-24">分</text>
            </view>
          </view>
          <view class="status-tag" :class="statusClass">{{ pressureText }}</view>
        </view>
      </view>
      <view class="mt-30 bg-white r-50 p-30">
        <view class="fs-36">指标数据</view>
        <view class="flex jc-between mt-30 pl-50 pr-50">
          <text class="fs-28 t-979797">压力指数范围</text>
          <text class="fs-28 t-979797">平均压力指数</text>
        </view>
        <view class="flex jc-between mt-20 pl-50 pr-50">
          <view>
            <text class="fs-48">{{ stressDetailObj?.stressRange }}</text>
            <text class="fs-24 t-979797">分</text>
          </view>
          <view>
            <text class="fs-48">{{ stressDetailObj?.avgStressValue }}</text>
            <text class="fs-24 t-979797">分</text>
          </view>
        </view>
        <view class="flex ai-center jc-center">
          <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 424rpx; margin: 0"></l-echart>
        </view>
      </view>
    </view>
    <uv-safe-bottom></uv-safe-bottom>
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
  background: linear-gradient(to bottom, #84eed0, #f1f3f6);
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
