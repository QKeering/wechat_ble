<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
import homeHeartChart from '@/components/homeHeartChart.vue';
import { formatDate, calculateOffset, getPrevDate, getNextDate, formatLocalDate } from '@/utils/utils.js';
import { heartRateOption, stepCount, exerciseMileage } from '@/homeDetail/activeDetail/echartOptions';
import { getMotionDetail } from '@/common/api/homeDetail';
import type { motionDetail, Point } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
import { normalizeMotionCalorieKcal } from '@/utils/motionCalorie';
const echarts = require('../../static/echarts.min.js');
const list = ref(['日', '周', '月']);
const current = ref<number>(0);
const currentName = ref('day');
const currentList = ref<string[]>(['day', 'week', 'month']);
const offset = ref<number>(0);
const scrollTop = ref<number>(0);

const healthNumber = ref(56);
const activeScore = ref(0);
const currentDate = ref(new Date());

// 存储chartRef引用
const chartRefF = ref<any>(null);
const chartRefS = ref<any>(null);
const chartRefT = ref<any>(null);

const motionDetailData = ref<motionDetail>();
const motionCalorieKcal = computed(
  () =>
    normalizeMotionCalorieKcal(motionDetailData.value?.calorie, {
      stepCount: motionDetailData.value?.step,
      targetCalorie: motionDetailData.value?.targetCalorie,
      unit: (motionDetailData.value as any)?.calorieUnit
    }) || 0
);
const motionTargetCalorie = computed(() => Number(motionDetailData.value?.targetCalorie) || 500);
watch(
  () => motionDetailData.value,
  (newVal, oldVal) => {
    // 只有当数据真正发生变化时才刷新图表
    if (newVal !== oldVal && newVal) {
      refreshAllCharts();
    }
  },
  { deep: true } // 深度监听，确保对象内部变化也能触发
);
const isHealthy = computed(() => healthNumber.value > 50);
const activeIcon = computed(() => {
  const activeLevel = activeScore.value;

  // 严重
  if (activeLevel < 60) {
    return '/static/images/homeDetail/cry.png';
  }
  // 良好
  else if (activeLevel >= 60 && activeLevel <= 79) {
    return '/static/images/homeDetail/normal.png';
  }
  // 优秀
  else if (activeLevel >= 80 && activeLevel <= 100) {
    return '/static/images/homeDetail/smile.png';
  }
  // 默认返回良好
  return '/static/images/homeDetail/normal.png';
});
const activeText = computed(() => {
  const activeLevel = activeScore.value;
  // 严重
  if (activeLevel < 60) {
    return '严重';
  }
  // 良好
  else if (activeLevel >= 60 && activeLevel <= 79) {
    return '良好';
  }
  // 优秀
  else if (activeLevel >= 80 && activeLevel <= 100) {
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
  return classMap[activeText.value] || 'status-good';
});
const change = async (index: number) => {
  current.value = index;
  currentName.value = currentList.value[index];
  currentDate.value = new Date();
  offset.value = 0;
  await getMotionDetailData();
  refreshAllCharts();
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
  await getMotionDetailData();
  refreshAllCharts();
};
const nextDay = async () => {
  const nextDate = getNextDate(currentDate.value, current.value);
  if (nextDate) {
    currentDate.value = nextDate;
    calculateOffsetLocal();
    await getMotionDetailData();
    refreshAllCharts();
  } else {
    (uni as any).$uv.toast('不能导航到未来的日期');
  }
};
const getMotionDetailData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await getMotionDetail({
    date: isoDate,
    type: currentName.value,
    offset: offset.value
  });
  if (res) {
    motionDetailData.value = res;
  }
};
const getYAxisMax = (step: number): number => {
  if (step <= 0.1) return 0.1;
  if (step <= 1) return 1;
  if (step <= 10) return 10;
  if (step <= 50) return 50;
  if (step <= 100) return 100;
  if (step <= 500) return 500;
  if (step <= 1000) return 1000;
  if (step <= 2000) return 2000;
  if (step <= 5000) return 5000;
  if (step <= 10000) return 10000;
  // 如果超过10000，按5000的倍数向上取整
  return Math.ceil(step / 5000) * 5000;
};
// 通用的图表配置函数
const getChartOption = (chartData: Point[] | undefined, baseOption: any, chartType?: string) => {
  const newOption = cloneDeep(baseOption);

  // 1. 根据数据生成完整的x轴数据
  const fullXData = chartData?.map((item: Point) => item.time?.toString() || '00:00') || [];
  // 2. 生成完整的series数据（数值类型）
  const fullSeriesData =
    chartData?.map((item: Point) => {
      const value = Number(item.value);
      if (chartType === 'calorie') {
        return (
          normalizeMotionCalorieKcal(value, {
            stepCount: motionDetailData.value?.step,
            targetCalorie: motionDetailData.value?.targetCalorie,
            unit: (motionDetailData.value as any)?.calorieUnit
          }) || 0
        );
      }
      return Number.isFinite(value) ? value : 0;
    }) || [];

  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData;
  // 设置x轴
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
  // 设置y轴刻度
  const maxValue = fullSeriesData.length > 0 ? Math.max(...fullSeriesData) : 0;
  const yAxisMax = getYAxisMax(maxValue);
  const yAxisMid = yAxisMax / 2;
  if (chartType === 'mileage') {
    newOption.yAxis = {
      ...newOption.yAxis,
      min: 0,
      max: yAxisMax,
      // interval: 2, // 刻度间隔为2
      axisLabel: {
        ...newOption.yAxis.axisLabel
        // formatter: (value: number) => {
        //   // 显示0, 2, 4, 6, 8, 10这些刻度
        //   if (value % 2 === 0 && value >= 0 && value <= 10) {
        //     return value.toString();
        //   }
        //   return '';
        // }
      }
    };
  } else {
    newOption.yAxis = {
      ...newOption.yAxis,
      min: 0,
      max: yAxisMax,
      axisLabel: {
        ...newOption.yAxis.axisLabel
        // formatter: (value: number) => {
        //   if (value === 0 || value === yAxisMid || value === yAxisMax) {
        //     return value.toString();
        //   }
        //   return '';
        // }
      }
    };
  }
  return newOption;
};

// 简化的具体图表配置函数
const getFirstOption = () => {
  return getChartOption(motionDetailData.value?.calorieChart, heartRateOption, 'calorie');
};

const getStepCountOption = () => {
  return getChartOption(motionDetailData.value?.stepChart, stepCount);
};

const getExerciseMileageOption = () => {
  return getChartOption(motionDetailData.value?.distanceChart, exerciseMileage, 'mileage');
};

// 初始化函数（用于首次加载和数据刷新）
const initChart = async (chartRef?: any) => {
  if (!chartRefF.value) return;
  try {
    const chart = await chartRef.init(echarts);
    chart.setOption(getFirstOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};

const initStepCount = async (chartRef?: any) => {
  if (!chartRefS.value) return;
  try {
    const chart = await chartRef.init(echarts);
    chart.setOption(getStepCountOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};

const initExerciseMileage = async (chartRef?: any) => {
  if (!chartRefT.value) return;
  try {
    const chart = await chartRef.init(echarts);
    chart.setOption(getExerciseMileageOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};

// 刷新所有图表
const refreshAllCharts = () => {
  initChart(chartRefF.value.chartRef);
  initStepCount(chartRefS.value.chartRef);
  initExerciseMileage(chartRefT.value.chartRef);
};

const leftClick = () => {
  uni.navigateBack();
};
onLoad(async (options) => {
  activeScore.value = options?.sportScore || 0;
  await getMotionDetailData();
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
        bgColor="#fdf3ed"
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
          <text class="fs-28 t-979797">当前运动状态</text>
        </view>
        <view class="flex ai-center jc-between">
          <view class="flex ai-center">
            <uv-image :src="activeIcon" width="68rpx" height="68rpx"></uv-image>
            <view>
              <text class="fs-72">{{ activeScore }}</text>
              <text class="fs-24">分</text>
            </view>
          </view>
          <view class="status-tag" :class="statusClass">{{ activeText }}</view>
        </view>
      </view>
      <view class="mt-30">
        <homeHeartChart
          ref="chartRefF"
          :currentRate="motionCalorieKcal"
          :rateUnit="'/' + motionTargetCalorie + '千卡'"
          card-title="运动卡路里"
          :showRigntBox="false"
          :showChartTitle="true"
          :showButtomCard="false"
          @chart-finished="(chartRef) => initChart(chartRef)"
        />
      </view>
      <view class="mt-30">
        <homeHeartChart
          ref="chartRefS"
          :currentRate="motionDetailData?.step || 0"
          :rateUnit="'/' + motionDetailData?.targetStep + '步'"
          card-title="运动步数"
          :showRigntBox="false"
          :showChartTitle="true"
          :showButtomCard="false"
          @chart-finished="(chartRef) => initStepCount(chartRef)"
        />
      </view>
      <view class="mt-30">
        <homeHeartChart
          ref="chartRefT"
          :currentRate="motionDetailData?.distance || 0"
          rateUnit="公里"
          card-title="运动里程"
          :showRigntBox="false"
          :showChartTitle="true"
          :showButtomCard="false"
          @chart-finished="(chartRef) => initExerciseMileage(chartRef)"
        />
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
  background: linear-gradient(to bottom, #ffb384, #f1f3f6);
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
