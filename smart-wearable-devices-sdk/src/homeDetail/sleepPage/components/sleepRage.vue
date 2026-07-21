<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { sleepRageOption } from '@/homeDetail/sleepPage/echartOptions';
import type { sleepSegment, Point } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
const echarts = require('../../../static/echarts.min.js');
const props = defineProps({
  sleepSegmentObj: {
    type: Object as () => sleepSegment,
    default: () => ({})
  }
});
// 添加watch监听props变化
watch(
  () => props.sleepSegmentObj,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      // 当sleepDetailObj变化时，重新初始化图表
      await initChart();
    }
  },
  { deep: true }
);
const chartRef = ref<any>(null);
const chartData = ref<Point[]>([]);
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
// 睡眠区间图例显示顺序
const SLEEP_ORDER = ['清醒', '快速眼动', '小睡', '浅睡', '深睡'];
const SLEEP_COLORS: Record<string, string> = {
  清醒: '#e2e1fd',
  快速眼动: '#9994f4',
  小睡: '#feba8a',
  浅睡: '#c5c2f9',
  深睡: '#5f57ec'
};
// 按指定顺序对睡眠数据进行排序
const sortBySleepOrder = (dataArray: any[]): any[] => {
  return [...dataArray].sort((a, b) => {
    const idxA = SLEEP_ORDER.indexOf(a.time);
    const idxB = SLEEP_ORDER.indexOf(b.time);
    return (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB);
  });
};
const stageStats = computed(() => {
  const source = Array.isArray(props.sleepSegmentObj?.chartDataSection) ? props.sleepSegmentObj.chartDataSection : [];
  const values = SLEEP_ORDER.map((name) => {
    const item = source.find((entry: any) => entry?.time === name);
    const minutes = Math.max(0, parseInt(String(item?.value || 0), 10) || 0);
    return { name, minutes, color: SLEEP_COLORS[name] };
  });
  const total = values.reduce((sum, item) => sum + item.minutes, 0);
  return values.map((item) => ({
    ...item,
    duration: formatMinutesToTime(String(item.minutes)),
    percent: total > 0 ? `${((item.minutes / total) * 100).toFixed(1)}%` : '0.0%'
  }));
});
const getProcessedOption = () => {
  // 测试数据
  const testData = {
    chartDataSectionList: [
      { time: '清醒', value: '0' },
      { time: '快速眼动', value: '0' },
      { time: '小睡', value: '0' },
      { time: '浅睡', value: '0' },
      { time: '深睡', value: '0' }
    ],
    chartData: [
      { time: '快速眼动', value: '5' },
      { time: '深睡', value: '60' },
      { time: '浅睡', value: '10' },
      { time: '清醒', value: '20' },
      { time: '小睡', value: '5' }
    ],
    chartDataSection: [
      { time: '清醒', value: '0' },
      { time: '浅睡', value: '0' },
      { time: '深睡', value: '0' },
      { time: '快速眼动', value: '0' },
      { time: '小睡', value: '0' }
    ]
  };

  // 深拷贝原option
  const newOption = cloneDeep(sleepRageOption);
  if (newOption.legend) newOption.legend.show = false;
  if (newOption.title) {
    newOption.title.left = '50%';
    newOption.title.top = '45%';
  }
  if (newOption.series?.[0]) {
    newOption.series[0].center = ['50%', '50%'];
  }

  // 根据sleepSegmentObj动态修改配置
  if (props.sleepSegmentObj?.chartData && props.sleepSegmentObj?.chartDataSection) {
    // 使用props数据或测试数据
    const { chartData, chartDataSection } = props.sleepSegmentObj;
    // const { chartData, chartDataSection } = testData; // 测试时使用这行
    // 统一处理图例配置的函数
    const updateLegendConfig = (dataArray: any[]) => {
      if (!dataArray || dataArray.length === 0) return;
      // 按指定顺序排序后再生成图例
      dataArray = sortBySleepOrder(dataArray);

      // 1. 计算总时长 (用于计算百分比)
      const totalValue = dataArray.reduce((sum, item) => {
        const val = parseInt(item.value as string, 10);
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      // 创建时间映射对象
      const timeMap: Record<string, string> = {};
      // 创建百分比映射对象 (可选，如果直接在formatter里算也可以，但预计算性能更好)
      const percentMap: Record<string, string> = {};

      dataArray.forEach((item) => {
        if (item.time && item.value) {
          const minutes = parseInt(item.value as string, 10);
          // 原有的时间格式化
          timeMap[item.time] = formatMinutesToTime(item.value as unknown as string);

          // 2. 计算百分比
          let percent = 0;
          if (totalValue > 0) {
            percent = (minutes / totalValue) * 100;
          }
          // 保留一位小数，例如 "12.5%"
          percentMap[item.time] = `${percent.toFixed(1)}%`;
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
        newOption.legend.selectedMode = false;

        // 3. 更新 formatter，加入百分比
        newOption.legend.formatter = function (name: string) {
          const time = timeMap[name] || '0小时00分钟';
          const percent = percentMap[name] || '0.0%';
          // 假设你希望格式为: 名称   时间 (百分比)
          // 你可以根据需要调整空格和样式标签
          return `{nameStyle|${name}}{space|    }{timeStyle|${time} (${percent})}`;
        };
      }
    };

    // 如果chartData为空数组，显示单一颜色的饼图
    if ((chartData && chartData.length === 0) || areAllValuesZero(chartData) || areAllValuesZero(chartDataSection)) {
      // 使用chartDataSectionList生成单一颜色饼图
      if (newOption.series && newOption.series[0]) {
        newOption.series[0].data = testData.chartDataSectionList.map((item) => ({
          value: item.value || 0,
          itemStyle: {
            color: '#e2e1fd',
            borderWidth: 1,
            borderColor: '#e2e1fd'
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
        清醒: '#e2e1fd',
        浅睡: '#c5c2f9',
        快速眼动: '#9994f4',
        深睡: '#5f57ec',
        小睡: '#c5c2f9'
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
  <view class="bg-white r-50 mb-30 p-30">
    <view class="">
      <view class="score-title fs-36">
        睡眠区间
        <slot></slot>
      </view>
    </view>
    <view class="mt-20">
      <view class="ta-l fs-48">
        <text>{{ sleepSegmentObj.startTime || '00:00' }}</text>
        <text>-</text>
        <text>{{ sleepSegmentObj.endTime || '00:00' }}</text>
      </view>
    </view>
    <view class="sleep-range-content">
      <view class="sleep-range-chart">
        <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 380rpx; margin: 0"></l-echart>
      </view>
      <view class="sleep-stage-stats">
        <view v-for="item in stageStats" :key="item.name" class="sleep-stage-row">
          <view class="sleep-stage-name">
            <view class="sleep-stage-dot" :style="{ backgroundColor: item.color }"></view>
            <text>{{ item.name }}</text>
          </view>
          <view class="sleep-stage-value">
            <text>{{ item.duration }}</text>
            <text class="sleep-stage-percent">{{ item.percent }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.sleep-range-content {
  display: flex;
  align-items: center;
  width: 100%;
}

.sleep-range-chart {
  width: 42%;
  flex-shrink: 0;
}

.sleep-stage-stats {
  flex: 1;
  min-width: 0;
  padding-left: 20rpx;
}

.sleep-stage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 54rpx;
  font-size: 24rpx;
}

.sleep-stage-name,
.sleep-stage-value {
  display: flex;
  align-items: center;
}

.sleep-stage-dot {
  width: 20rpx;
  height: 20rpx;
  margin-right: 12rpx;
  border-radius: 4rpx;
}

.sleep-stage-value {
  color: #010101;
  white-space: nowrap;
}

.sleep-stage-percent {
  width: 78rpx;
  margin-left: 12rpx;
  color: #979797;
  text-align: right;
}
</style>
