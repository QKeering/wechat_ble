<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
import homeHeartChart from '@/components/homeHeartChart.vue';
import { getSleepDetail, getSleepSegment, getHeartRateDetail, getSleepOverview } from '@/common/api/homeDetail';
import { formatDate, calculateOffset, getPrevDate, getNextDate, formatLocalDate } from '@/utils/utils.js';
import type { sleepDetail, sleepSegment, heartRateDetail, sleepOverview } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
import { heartRateOption, sleepTimeOption, sleepRageOption } from '@/homeDetail/sleepDetail/echartOptions';
import { appendRingDiagnosticLog, RW_DIAGNOSTIC_BUILD_TAG } from '@/composables/useRwForegroundMeasurement';
import { formatBleErrorMessage } from '@/utils/bleError';
const echarts = require('../../static/echarts.min.js');
const list = ref(['日', '周', '月']);
const current = ref<number>(0);
const currentName = ref('day');
const currentList = ref<string[]>(['day', 'week', 'month']);
const offset = ref<number>(0);
const scrollTop = ref<number>(0);

const sleepOverviewObj = ref<sleepOverview>();
const sleepDetailObj = ref<sleepDetail>();
const sleepSegmentObj = ref<sleepSegment>();
const heartRateObj = ref<heartRateDetail>();

const chartInstanceF = ref<any>(null);
const chartInstanceS = ref<any>(null);
const chartInstanceT = ref<any>(null);

const heartRateList = ref([
  { label: '平均心率', value: '43' },
  { label: '最大心率', value: '76' }
]);

const sleepRageRef = ref<any>(null);
const sleepTimeRef = ref<any>(null);

const healthNumber = ref(56);
const sleepScore = ref(0);
const currentDate = ref(new Date());
let sleepDetailLoadSerial = 0;
const isCurrentSleepDetailLoad = (loadId?: number) => loadId == null || loadId === sleepDetailLoadSerial;
const appendSleepDetailPageLog = (event: string, details: Record<string, any> = {}) => {
  appendRingDiagnosticLog('RW PAGE', event, {
    buildTag: RW_DIAGNOSTIC_BUILD_TAG,
    page: 'sleepDetail',
    ...details
  });
};
const runSleepDetailEndpointTask = async <T>(
  endpoint: string,
  date: string,
  loadId: number,
  task: () => Promise<T>
) => {
  const startedAt = Date.now();
  try {
    const result = await task();
    appendSleepDetailPageLog('sleep-detail-page-endpoint-timing', {
      endpoint,
      date,
      loadId,
      ok: true,
      elapsedMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    appendSleepDetailPageLog('sleep-detail-page-endpoint-timing', {
      endpoint,
      date,
      loadId,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: formatBleErrorMessage(error, '睡眠详情接口请求失败')
    });
    throw error;
  }
};
const updateSleepDetailCharts = () => {
  chartInstanceF.value?.setOption(getHeartRateOption());
  chartInstanceS.value?.setOption(getProcessedOption());
  chartInstanceT.value?.setOption(getSleepRangOption());
};
const loadSleepDetailData = async (trigger = 'manual') => {
  const loadId = ++sleepDetailLoadSerial;
  const targetDate = currentDate.value;
  const date = formatLocalDate(targetDate);
  const startedAt = Date.now();
  appendSleepDetailPageLog('sleep-detail-page-load-start', {
    trigger,
    date,
    type: currentName.value,
    offset: offset.value,
    loadId
  });
  const results = await Promise.allSettled([
    runSleepDetailEndpointTask('sleep-detail', date, loadId, () => getSleepDetailInfo(targetDate, loadId)),
    runSleepDetailEndpointTask('sleep-segment', date, loadId, () => getSleepSegmentInfo(targetDate, loadId)),
    runSleepDetailEndpointTask('heart-rate-detail', date, loadId, () => getRatDetail(targetDate, loadId))
  ]);
  if (isCurrentSleepDetailLoad(loadId)) {
    updateSleepDetailCharts();
  }
  appendSleepDetailPageLog('sleep-detail-page-load-done', {
    trigger,
    date,
    type: currentName.value,
    offset: offset.value,
    loadId,
    current: isCurrentSleepDetailLoad(loadId),
    elapsedMs: Date.now() - startedAt,
    failedCount: results.filter((item) => item.status === 'rejected').length
  });
};

// 计算属性：将分钟数拆分为小时和分钟
const sleepDurationHours = computed(() => {
  if (!sleepDetailObj.value?.sleepDuration) return 0;
  return Math.floor(sleepDetailObj.value.sleepDuration / 60);
});

const sleepDurationMinutes = computed(() => {
  if (!sleepDetailObj.value?.sleepDuration) return 0;
  return sleepDetailObj.value.sleepDuration % 60;
});
const sleepIcon = computed(() => {
  const sleepLevel = sleepScore.value;

  // 严重
  if (sleepLevel < 60) {
    return '/static/images/homeDetail/cry.png';
  }
  // 良好
  else if (sleepLevel >= 60 && sleepLevel <= 79) {
    return '/static/images/homeDetail/normal.png';
  }
  // 优秀
  else if (sleepLevel >= 80 && sleepLevel <= 100) {
    return '/static/images/homeDetail/smile.png';
  }
  // 默认返回良好
  return '/static/images/homeDetail/normal.png';
});
const sleepText = computed(() => {
  const sleepLevel = sleepScore.value;
  // 严重
  if (sleepLevel < 60) {
    return '严重';
  }
  // 良好
  else if (sleepLevel >= 60 && sleepLevel <= 79) {
    return '良好';
  }
  // 优秀
  else if (sleepLevel >= 80 && sleepLevel <= 100) {
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
  return classMap[sleepText.value] || 'status-good';
});

const change = async (index: number) => {
  current.value = index;
  currentName.value = currentList.value[index];
  currentDate.value = new Date();
  offset.value = 0;
  await loadSleepDetailData('range-change');
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
  await loadSleepDetailData('prev-day');
};
const nextDay = async () => {
  const nextDate = getNextDate(currentDate.value, current.value);
  if (nextDate) {
    currentDate.value = nextDate;
    calculateOffsetLocal();
    await loadSleepDetailData('next-day');
  } else {
    (uni as any).$uv.toast('不能导航到未来的日期');
  }
};
// 睡眠详情
const getSleepDetailInfo = async (targetDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(targetDate);
  const res = await getSleepDetail({
    date: isoDate,
    type: currentName.value,
    offset: offset.value
  });
  if (res && isCurrentSleepDetailLoad(loadId)) {
    sleepDetailObj.value = res;
  }
};
// 睡眠区间
const getSleepSegmentInfo = async (targetDate = new Date(), loadId?: number) => {
  const res = await getSleepSegment({ date: formatLocalDate(targetDate) });
  if (res && isCurrentSleepDetailLoad(loadId)) {
    sleepSegmentObj.value = res;
  }
};
// 获取心率详情
const getRatDetail = async (targetDate = new Date(), loadId?: number) => {
  const isoDate = formatLocalDate(targetDate);
  const res = await getHeartRateDetail({
    date: isoDate,
    type: currentName.value,
    offset: offset.value
  });
  if (res && isCurrentSleepDetailLoad(loadId)) {
    heartRateObj.value = res;
    heartRateList.value = [
      { label: '平均心率', value: heartRateObj.value.avgValue || '0' },
      { label: '平均范围', value: heartRateObj.value.avgValueRange || '0' }
    ];
  }
};
// 分钟数转换为小时分钟格式的函数
const formatMinutesToTime = (minutesStr: string): string => {
  // 将字符串转换为数字
  const minutes = parseInt(minutesStr, 10);

  if (isNaN(minutes) || minutes < 0) {
    return '0小时00分钟';
  }

  // 计算小时和分钟
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  // 格式化输出，确保分钟数为两位数
  return `${hours}小时${remainingMinutes.toString().padStart(2, '0')}分钟`;
};
// 判断数组对象的所有value属性是否等于'0'
const areAllValuesZero = (dataArray: any[]): boolean => {
  if (!dataArray || dataArray.length === 0) {
    return false;
  }

  // 检查数组中每个对象的value属性是否都等于'0'
  return dataArray.every((item) => {
    return item.value === '0' || item.value === 0;
  });
};
const getProcessedOption = () => {
  // 深拷贝原option
  const newOption = cloneDeep(sleepTimeOption);

  // 确保chartData有数据，否则使用默认数据
  const hasChartData = sleepDetailObj.value?.chartData && sleepDetailObj.value?.chartData.length > 0;

  const fullXData = hasChartData ? sleepDetailObj.value?.chartData?.map((item: any) => item.time?.toString() || '00:00') : [];
  const fullSeriesData = hasChartData ? sleepDetailObj.value?.chartData?.map((item) => Number(item.value) || 0) : [];
  // 3. 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = fullXData || [];
  newOption.series[0].data = fullSeriesData || [];
  // 4. 控制x轴只显示指定刻度
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
          const quarter1 = Math.floor(dataLength / 4);
          const quarter3 = Math.floor((dataLength * 3) / 4);
          return index === quarter1 || index === quarter3 ? value : '';
        }
      }
    }
  };

  return newOption;
};
const getSleepRangOption = () => {
  // 测试数据
  const testData = {
    chartDataSectionList: [
      { time: '清醒', value: '0' },
      { time: '快速眼动', value: '0' },
      { time: '浅睡', value: '0' },
      { time: '深睡', value: '0' }
    ],
    chartData: [
      { time: '深睡', value: '60' },
      { time: '浅睡', value: '10' },
      { time: '快速眼动', value: '5' },
      { time: '清醒', value: '20' },
      { time: '小睡', value: '5' }
    ],
    chartDataSection: [
      { time: '清醒', value: '140' },
      { time: '快速眼动', value: '60' },
      { time: '浅睡', value: '80' },
      { time: '深睡', value: '80' },
      { time: '小睡', value: '60' }
    ]
  };

  // 深拷贝原option
  const newOption = cloneDeep(sleepRageOption);

  // 根据sleepSegmentObj动态修改配置
  if (sleepSegmentObj.value?.chartData && sleepSegmentObj.value?.chartDataSection) {
    // 使用props数据或测试数据
    const { chartData, chartDataSection } = sleepSegmentObj.value;
    // const { chartData, chartDataSection } = testData; // 测试时使用这行
    // 统一处理图例配置的函数
    const updateLegendConfig = (dataArray: any[]) => {
      if (!dataArray || dataArray.length === 0) return;

      // 创建时间映射对象
      const timeMap: Record<string, string> = {};
      dataArray.forEach((item) => {
        if (item.time && item.value) {
          timeMap[item.time] = formatMinutesToTime(item.value as unknown as string);
        }
      });

      const legendData = dataArray.map((item) => ({
        name: item.time || '',
        icon: 'circle'
      }));

      // 根据数据长度动态调整legend的top值
      let legendTop = '20%';
      if (dataArray.length === 5) {
        legendTop = '10%';
      } else if (dataArray.length > 5) {
        legendTop = '0%';
      }

      // 更新legend配置
      if (newOption.legend) {
        newOption.legend.data = legendData;
        newOption.legend.top = legendTop;
        newOption.legend.formatter = function (name: string) {
          const time = timeMap[name] || '0小时00分钟';
          return `{nameStyle|${name}}{space|    }{timeStyle|${time}}`;
        };
      }
    };

    // 如果chartData为空数组，显示单一颜色的饼图
    if ((chartData && chartData.length === 0) || areAllValuesZero(chartData) || areAllValuesZero(chartDataSection)) {
      // 使用chartDataSectionList生成单一颜色饼图
      if (newOption.series && newOption.series[0]) {
        const emptyColorMap = {
          清醒: '#F4A340',
          快速眼动: '#48A7E8',
          浅睡: '#9B93F5',
          深睡: '#5146D8',
          小睡: '#58C7B1'
        };
        newOption.series[0].data = testData.chartDataSectionList.map((item) => ({
          value: item.value || 0,
          itemStyle: {
            color: emptyColorMap[item.time as keyof typeof emptyColorMap] || '#eef0ff',
            borderWidth: 1,
            borderColor: '#ffffff'
          },
          name: item.time || ''
        }));
      }

      // 使用chartDataSectionList更新图例
      updateLegendConfig(testData.chartDataSectionList);
      return newOption;
    }

    // chartData有数据时，显示多颜色饼图
    if (chartData && chartData.length > 0) {
      // 颜色映射
      const colorMap = {
        清醒: '#F4A340',
        快速眼动: '#48A7E8',
        浅睡: '#9B93F5',
        深睡: '#5146D8',
        小睡: '#58C7B1'
      };

      // 生成饼图数据
      const pieData = chartData.map((item) => ({
        name: item.time || '',
        value: item.value || 0,
        itemStyle: {
          color: colorMap[item.time as keyof typeof colorMap] || '#e6e5fc',
          borderWidth: 1,
          borderColor: '#ffffff'
        }
      }));

      if (newOption.series && newOption.series[0]) {
        newOption.series[0].data = pieData;
      }

      // 使用chartDataSection更新图例
      updateLegendConfig(chartDataSection);
    }
  }

  return newOption;
};
const getHeartRateOption = () => {
  // 深拷贝原option
  const newOption = cloneDeep(heartRateOption);
  // 使用实际数据而不是测试数据
  const fullXData = heartRateObj.value?.chartData?.map((item: any) => item.time?.toString() || '00:00');
  const fullSeriesData = heartRateObj.value?.chartData?.map((item) => Number(item.value) || 0);
  // 替换xAxis.data和series.data为扩展后的数据
  newOption.xAxis.data = fullXData || [];
  newOption.series[0].data = fullSeriesData || [];
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
const initChart = async (chartRef: any) => {
  if (!chartRef) return;
  try {
    const chart = await chartRef.init(echarts);
    chartInstanceF.value = chart;
    chart.setOption(getHeartRateOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};
const initSleepTime = async () => {
  if (!sleepTimeRef) return;
  try {
    const chart = await sleepTimeRef.value.init(echarts);
    chartInstanceS.value = chart;
    chart.setOption(getProcessedOption());
  } catch (error) {
    console.error(`图表初始化失败:`, error);
  }
};
const initSleepRage = async () => {
  if (!sleepRageRef.value) return;
  try {
    const pie = await sleepRageRef.value.init(echarts);
    // pie.setOption(sleepRageOption);
    chartInstanceT.value = pie;
    pie.setOption(getSleepRangOption());
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
const leftClick = () => {
  uni.navigateBack();
};
onLoad(async (options) => {
  sleepScore.value = options?.sleepScore || 0;
  await loadSleepDetailData('page-load');
});
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
</script>
<template>
  <view class="relative pl-30 pr-30 pt-30">
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="睡眠" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view class="bgcWrapper"></view>
    <view class="content">
      <uv-subsection
        bgColor="#f2f1fe"
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
          <text class="fs-28 t-979797">昨日睡眠状态</text>
        </view>
        <view class="flex ai-center jc-between">
          <view class="flex ai-center">
            <uv-image :src="sleepIcon" width="68rpx" height="68rpx"></uv-image>
            <view>
              <text class="fs-72">{{ sleepScore }}</text>
            </view>
          </view>
          <!-- <view class="status-tag">优秀</view> -->
          <view class="status-tag" :class="statusClass">{{ sleepText }}</view>
        </view>
      </view>
      <view class="bg-white r-50 mt-30 p-30">
        <view class="">
          <view class="ta-c">
            <text class="fs-72">{{ sleepDurationHours || '00' }}</text>
            <text class="fs-24">小时</text>
            <text class="fs-72">{{ sleepDurationMinutes || '00' }}</text>
            <text class="fs-24">分钟</text>
          </view>
          <view class="ta-c">睡眠时间</view>
        </view>
        <view class="flex ai-center jc-center">
          <l-echart ref="sleepTimeRef" @finished="initSleepTime" style="width: 100%; height: 320rpx; margin: 0"></l-echart>
        </view>
      </view>
      <view class="bg-white r-50 mt-30 p-30">
        <view class="">
          <view class="score-title fs-36">睡眠区间</view>
        </view>
        <view class="mt-20">
          <view class="ta-l fs-48">
            <text>{{ sleepSegmentObj?.startTime || '00:00' }}</text>
            <text>-</text>
            <text>{{ sleepSegmentObj?.endTime || '00:00' }}</text>
          </view>
        </view>
        <view class="flex ai-center jc-center">
          <l-echart ref="sleepRageRef" @finished="initSleepRage" style="width: 100%; height: 320rpx; margin: 0"></l-echart>
        </view>
      </view>
      <view class="mt-30">
        <homeHeartChart
          card-title="心率"
          :stats="heartRateList"
          cardSmallTitle="(次/分钟)"
          :showCardSmallTitle="true"
          :showRigntBox="false"
          :showChartTitle="false"
          :showButtomCard="false"
          :showTopCard="true"
          @chart-finished="(chartRef) => initChart(chartRef)"
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
  background: linear-gradient(to bottom, #9f9af3, #f1f3f6);
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
