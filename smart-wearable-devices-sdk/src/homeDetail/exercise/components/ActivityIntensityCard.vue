<script setup lang="ts">
import { ref, watch } from 'vue';
const echarts = require('../../../static/echarts.min.js');
import { actIntensityOption, activePieOption } from '@/homeDetail/exercise/echartOptions';
import type { motionIntensity, Point } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
const props = defineProps({
  motionIntensityObj: {
    type: Object as () => motionIntensity,
    default: () => ({})
  }
});
watch(
  () => props.motionIntensityObj,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      await initActIntensity();
      await initActivePie();
    }
  },
  { deep: true }
);
const actIntensityRef = ref<any>(null);
const activePieRef = ref<any>(null);

// 分钟数转换为小时分钟格式的函数
const formatMinutesToTime = (minutes: number): string => {
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
const areAllValuesZero = (dataArray: any[] = []): boolean => {
  if (!dataArray || dataArray.length === 0) {
    return false;
  }

  // 检查数组中每个对象的value属性是否都等于'0'
  return dataArray.every((item) => {
    return item.value === '0' || item.value === 0;
  });
};
const getSecoundOption = () => {
  // 测试数据
  const testData = {
    motionRatioChart: [
      { time: '不活跃', value: '60' },
      { time: '低强度', value: '10' },
      { time: '中强度', value: '5' },
      { time: '高强度', value: '20' }
    ],
    motionRatioChart2: [
      { time: '不活跃', value: '0' },
      { time: '低强度', value: '0' },
      { time: '中强度', value: '0' },
      { time: '高强度', value: '0' }
    ]
  };

  // 深拷贝原option
  const newOption = cloneDeep(activePieOption);
  // 根据sleepSegmentObj动态修改配置
  if (props.motionIntensityObj?.motionRatioChart) {
    // 使用props数据或测试数据
    const { motionRatioChart } = props.motionIntensityObj;
    // const { motionRatioChart } = testData; // 测试时使用这行
    // 统一处理图例配置的函数
    const updateLegendConfig = (dataArray: Point[]) => {
      const inactiveDuration = props.motionIntensityObj?.inactiveDuration || 0; //不活跃时间
      const lowIntensity = props.motionIntensityObj?.lowIntensityDuration || 0; //低强度时间
      const mediumIntensity = props.motionIntensityObj?.moderateIntensityDuration || 0; //中强度时间
      const highIntensity = props.motionIntensityObj?.highIntensityDuration || 0; //高强度时间
      // 创建时间映射对象，直接从props获取时间值
      const timeMap: Record<string, string> = {
        不活跃: formatMinutesToTime(inactiveDuration),
        低强度: formatMinutesToTime(lowIntensity),
        中强度: formatMinutesToTime(mediumIntensity),
        高强度: formatMinutesToTime(highIntensity)
      };
      // 创建比例映射对象，从图表数据dataArray获取value值并添加百分号
      const percentMap: Record<string, string> = {};
      dataArray.forEach((item) => {
        if (item.time && item.value) {
          percentMap[item.time] = `${item.value}%`; // 添加百分号
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
          const percent = percentMap[name] || '0%'; // 获取比例值，默认为0%
          return `{nameStyle|${name}}{space|    }{percentStyle|${percent}}{space|    }{timeStyle|${time}}`;
        };
      }
    };

    // 如果motionRatioChart为空数组，显示单一颜色的饼图
    if ((motionRatioChart && motionRatioChart.length === 0) || areAllValuesZero(motionRatioChart)) {
      // 使用chartDataSectionList生成单一颜色饼图
      if (newOption.series && newOption.series[0]) {
        newOption.series[0].data = testData.motionRatioChart2.map((item) => ({
          value: item.value || 0,
          itemStyle: {
            color: '#fff4ec',
            borderWidth: 1,
            borderColor: '#fff4ec'
          },
          name: item.time || ''
        }));
      }
      updateLegendConfig(testData.motionRatioChart2);
      return newOption;
    }

    // motionRatioChart有数据时，显示多颜色饼图
    if (motionRatioChart && motionRatioChart.length > 0) {
      // 颜色映射
      const colorMap = {
        不活跃: '#ffdbc3',
        低强度: '#ffbc90',
        中强度: '#ffa468',
        高强度: '#ff893b'
      };

      // 生成饼图数据
      const pieData = motionRatioChart.map((item) => ({
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
      updateLegendConfig(motionRatioChart);
    }
  }

  return newOption;
};
const getFirstOption = () => {
  const newOption = cloneDeep(actIntensityOption);
  const test = [
    {
      time: '00:00',
      value: '0'
    },
    {
      time: '01:00',
      value: '1'
    },
    {
      time: '02:00',
      value: '2'
    },
    {
      time: '03:00',
      value: '3'
    }
  ];
  // 1. 生成24小时完整的x轴数据（格式："xx:00"）
  const fullXData =
    props.motionIntensityObj?.motionChart?.map((item: Point) => {
      if (!item.time) return '00:00';
      // 检查item.time是否已经包含冒号（即HH:MM格式）
      return item.time.includes(':') ? item.time : `${item.time.padStart(2, '0')}:00`;
    }) || [];

  // 2. 生成24小时完整的series数据（数值类型）
  const fullSeriesData = props.motionIntensityObj?.motionChart?.map((item: Point) => Number(item.value)) || [];
  // const fullSeriesData = test.map((item: Point) => Number(item.value)) || [];
  // 如果数据为空，使用默认的24小时时间轴数据
  if (fullXData.length === 0) {
    // 生成24小时的默认时间轴数据 ['00:00', '01:00', ..., '23:00']
    const defaultXData = Array.from({ length: 24 }, (_, i) => {
      return `${i.toString().padStart(2, '0')}:00`;
    });
    newOption.xAxis.data = defaultXData;

    // 使用默认的series数据（全部为0，表示不活跃状态）
    if (fullSeriesData.length === 0) {
      newOption.series[0].data = [];
    }
  } else {
    // 3. 替换xAxis.data和series.data为完整数据
    newOption.xAxis.data = fullXData;
    newOption.series[0].data = fullSeriesData;
  }

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

  return newOption;
};
const initActIntensity = async () => {
  if (!actIntensityRef.value) return;
  try {
    const pie = await actIntensityRef.value.init(echarts);
    pie.setOption(getFirstOption());
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
const initActivePie = async () => {
  if (!activePieRef.value) return;
  try {
    const pie = await activePieRef.value.init(echarts);
    pie.setOption(getSecoundOption());
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
</script>
<template>
  <view class="p-30 bg-white r-50 mb-30">
    <view class="">
      <text class="fs-36">
        全天活动强度
      </text>
      <slot></slot>
    </view>
    <view class="flex ai-center jc-center mt-20">
      <l-echart ref="actIntensityRef" @finished="initActIntensity" style="width: 100%; height: 310rpx; margin: 0"></l-echart>
    </view>
    <view class="flex ai-center jc-center">
      <l-echart ref="activePieRef" @finished="initActivePie" style="width: 100%; height: 320rpx; margin: 0"></l-echart>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin-right: 8rpx;
}
.active-dot {
  background-color: #ff6b8b; /* 粉红色 */
}
</style>
