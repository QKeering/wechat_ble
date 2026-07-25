<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const echarts = require('../../../static/echarts.min.js');
import { calorieOption } from '@/homeDetail/exercise/echartOptions';
import type { motionCalorie, Point } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
import { MOTION_CALORIE_DISPLAY_UNIT, formatMotionCalorieKcal, normalizeMotionCalorieKcal } from '@/utils/motionCalorie';
import { useUserStore } from '@/stores/user';
const userStore = useUserStore();
const props = defineProps({
  motionCalorieObj: {
    type: Object as () => motionCalorie,
    default: () => ({})
  },
  sleepDurationMinutes: {
    type: Number,
    default: 0
  }
});
watch(
  () => [props.motionCalorieObj, props.sleepDurationMinutes],
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      await initChart();
    }
  },
  { deep: true }
);
const chartRef = ref<any>(null);
const toPositiveNumber = (value: unknown) => {
  if (value == null || value === '') return 0;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};
const normalizeCalorie = (value: unknown) =>
  normalizeMotionCalorieKcal(value, {
    targetCalorie: props.motionCalorieObj?.targetCalorie,
    unit: props.motionCalorieObj?.calorieUnit
  }) || 0;
const calorieUnit = computed(() => MOTION_CALORIE_DISPLAY_UNIT);
const getAgeFromBirthday = (birthday: unknown) => {
  const birthdayText = String(birthday || '').trim();
  if (!birthdayText) return 30;
  const birthDate = new Date(birthdayText.replace(/-/g, '/'));
  if (Number.isNaN(birthDate.getTime())) return 30;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return Math.min(100, Math.max(12, age || 30));
};
const estimateDailyBasalCalorie = computed(() => {
  const profile = userStore.userInfo || {};
  const weight = toPositiveNumber(profile.weight) || 60;
  const height = toPositiveNumber(profile.height) || 165;
  const age = getAgeFromBirthday(profile.birthday || profile.birthDay);
  const sex = String(profile.sex ?? profile.gender ?? '').trim();
  const isFemale = sex === '1' || sex.toLowerCase() === 'female';
  const isMale = sex === '0' || sex.toLowerCase() === 'male';
  const adjustment = isFemale ? -161 : isMale ? 5 : -78;
  return Math.max(900, Math.round(10 * weight + 6.25 * height - 5 * age + adjustment));
});
const basalActiveRatio = computed(() => {
  const sleepMinutes = Number(props.sleepDurationMinutes) || 0;
  if (sleepMinutes <= 0) return 1;
  return Math.min(1, Math.max(0, (1440 - Math.min(sleepMinutes, 1440)) / 1440));
});
const rawBasalCalorie = computed(() => normalizeCalorie(props.motionCalorieObj?.basalCalorie));
const dailyBasalCalorie = computed(() => rawBasalCalorie.value > 0 ? rawBasalCalorie.value : estimateDailyBasalCalorie.value);
const motionCalorie = computed(() => normalizeCalorie(props.motionCalorieObj?.motionCalorie));
const basalCalorie = computed(() => dailyBasalCalorie.value * basalActiveRatio.value);
const totalCalorie = computed(() => {
  const rawTotal = normalizeCalorie(props.motionCalorieObj?.totalCalorie);
  if (rawTotal > 0 && rawBasalCalorie.value > 0) {
    return Math.max(0, rawTotal - rawBasalCalorie.value + basalCalorie.value);
  }
  if (motionCalorie.value > 0 || basalCalorie.value > 0) {
    return motionCalorie.value + basalCalorie.value;
  }
  return rawTotal;
});
const totalCalorieText = computed(() => formatMotionCalorieKcal(totalCalorie.value));
const motionCalorieText = computed(() => formatMotionCalorieKcal(motionCalorie.value));
const basalCalorieText = computed(() => formatMotionCalorieKcal(basalCalorie.value));
const hasTotalCalorie = computed(() => totalCalorie.value > 0);
const hasMotionCalorie = computed(() => motionCalorie.value > 0);
const hasBasalCalorie = computed(() => basalCalorie.value > 0);
const getProcessedOption = () => {
  const newOption = cloneDeep(calorieOption);
  const hasBasalChart = !!props.motionCalorieObj?.basalCalorieChart?.length;

  // 1. 根据数据生成完整的x轴数据
  const firstFullXData =
    props.motionCalorieObj?.motionCalorieChart?.map((item: Point) => item.time?.toString() || '00:00') ||
    props.motionCalorieObj?.basalCalorieChart?.map((item: Point) => item.time?.toString() || '00:00') ||
    Array.from({ length: 24 }, (_, index) => `${index.toString().padStart(2, '0')}:00`);
  // 2. 生成完整的series数据（数值类型）
  // const firstFullSeriesData = [0, 50, 48, 69, 31, 53, 60, 65, 80, 68, 76, 72, 78, 82, 85, 83, 80, 77, 75, 73, 70, 68, 65, 63];
  const firstFullSeriesData =
    props.motionCalorieObj?.motionCalorieChart?.map((item: Point) => normalizeCalorie(item.value)) ||
    firstFullXData.map(() => 0);
  // 给第二条线生成完整的series数据（数值类型）
  // const secoundFullSeriesData = [0, 60, 58, 59, 61, 63, 70, 75, 80, 78, 76, 72, 78, 82, 85, 83, 80, 77, 75, 73, 70, 68, 65, 63];
  const secoundFullSeriesData =
    (hasBasalChart && props.motionCalorieObj?.basalCalorieChart?.map((item: Point) => normalizeCalorie(item.value) * basalActiveRatio.value)) ||
    firstFullXData.map(() => Number((basalCalorie.value / Math.max(firstFullXData.length, 1)).toFixed(1)));
  // 3. 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = firstFullXData;
  newOption.series[0].data = firstFullSeriesData;
  newOption.series[1].data = secoundFullSeriesData;

  // 4. 控制x轴只显示指定刻度（00:00/06:00/12:00/18:00/24:00）
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
const initChart = async () => {
  if (!chartRef.value) return;
  try {
    const pie = await chartRef.value.init(echarts);
    pie.setOption(getProcessedOption());
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
</script>
<template>
  <view class="p-30 bg-white r-50 mb-30">
    <view class="">
      <text class="fs-36">全天卡</text>
      <text class="fs-28">({{ calorieUnit }})</text>
      <slot></slot>
    </view>
    <view class="flex jc-center mb-30 mt-30">
      <view class="flex jc-center ai-center">
        <view class="calorie-icon"></view>
        <view>
          <text class="fs-48">{{ hasTotalCalorie ? totalCalorieText : '00' }}</text>
          <text class="fs-28 ml-10 t-979797">/{{ motionCalorieObj?.targetCalorie || 500 }}{{ calorieUnit }}</text>
        </view>
      </view>
    </view>
    <view class="flex jc-between pl-50 pr-50">
      <view class="fd-c jc-center ai-center">
        <view class="fs-48 ta-c">{{ hasBasalCalorie ? basalCalorieText : '00' }}</view>
        <view class="flex ai-center">
          <view class="dot base-dot"></view>
          <text class="fs-24 t-979797">基础代谢</text>
        </view>
      </view>
      <view class="fd-c jc-between ai-center">
        <view class="fs-48 ta-c">{{ hasMotionCalorie ? motionCalorieText : '00' }}</view>
        <view class="flex ai-center">
          <view class="dot active-dot"></view>
          <text class="fs-24 t-979797">活动消耗</text>
        </view>
      </view>
    </view>
    <view class="flex ai-center jc-center mt-20">
      <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 324rpx; margin: 0"></l-echart>
    </view>
    <view class="fs-28 ta-c" style="color: #ff5d7c">全天卡目标，可通过修改活动卡目标，进行联动修改。</view>
  </view>
</template>

<style lang="scss" scoped>
.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin-right: 8rpx;
}
.calorie-icon {
  width: 28rpx;
  height: 40rpx;
  margin-right: 12rpx;
  border-radius: 18rpx 18rpx 20rpx 20rpx;
  background: linear-gradient(180deg, #ff8a5b 0%, #ff4d6d 100%);
  transform: rotate(12deg);
}
.base-dot {
  background-color: #ffd5dd; /* 灰色 */
}
.active-dot {
  background-color: #ff6b8b; /* 粉红色 */
}
</style>
