<script setup>
import { onMounted, ref } from 'vue';
// import * as echarts from '../../static/echarts.esm.min.js';
const echarts = require('../../static/echarts.min.js');
const chartRef = ref(null);
// 图表配置项
const option = ref({
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    },
    confine: true
  },
  legend: {
    data: ['热度', '正面', '负面']
  },
  xAxis: [
    {
      type: 'value',
      axisLine: {
        lineStyle: {
          color: '#999999'
        }
      },
      axisLabel: {
        color: '#666666'
      }
    }
  ],
  yAxis: [
    {
      type: 'category',
      axisTick: {
        show: false
      },
      data: ['汽车之家', '今日头条', '百度贴吧', '一点资讯', '微信', '微博', '知乎'],
      axisLine: {
        lineStyle: {
          color: '#999999'
        }
      },
      axisLabel: {
        color: '#666666'
      }
    }
  ],
  series: [
    {
      name: '热度',
      type: 'bar',
      label: {
        show: true,
        position: 'inside'
      },
      data: [300, 270, 340, 344, 300, 320, 310]
    },
    {
      name: '正面',
      type: 'bar',
      stack: '总量',
      label: {
        show: true
      },
      data: [120, 102, 141, 174, 190, 250, 220]
    },
    {
      name: '负面',
      type: 'bar',
      stack: '总量',
      label: {
        show: true,
        position: 'left'
      },
      data: [-20, -32, -21, -34, -90, -130, -110]
    }
  ]
});
// 初始化图表
const initChart = async () => {
  if (!chartRef.value) return;

  try {
    const chart = await chartRef.value.init(echarts);

    chart.setOption(option.value);
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};

// onMounted(() => {
//   initChart();
// });
</script>

<template>
  <view>
    <view style="width: 750rpx; height: 750rpx">
      <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 600rpx"></l-echart>
    </view>
  </view>
</template>

<style lang="scss" scoped></style>
