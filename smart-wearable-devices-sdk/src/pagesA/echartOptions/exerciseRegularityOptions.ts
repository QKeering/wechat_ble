// utils/echartOptions.ts
// 引入 echarts （用于渐变等功能，若不需要可省略）
const echarts = require('../../static/echarts.min.js');
// import * as echarts from '@/static/echarts.min.js';
let temperatureGradient = '#4cae4c'; // 降级默认色
if (echarts && echarts.graphic && typeof echarts.graphic.LinearGradient === 'function') {
  temperatureGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: '#d6f5d6' },
    { offset: 1, color: '#4cae4c' }
  ]);
}
// 1. 心率图表配置
export const defaultEchartOption = {
  grid: {
    left: '0%', // 左侧留出状态文字的空间
    right: '0%',
    top: '10%',
    bottom: '10%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    data: ['10月', '11月', '12月'], // 月份标签
    axisLine: { show: false }, // 隐藏x轴线
    axisTick: { show: false }, // 隐藏x轴刻度
    axisLabel: {
      fontSize: 12,
      color: '#666'
    }
  },
  yAxis: {
    type: 'category',
    data: ['可改善', '正常', '优秀'], // 状态刻度
    axisLine: { show: false }, // 隐藏y轴线
    axisTick: { show: false }, // 隐藏y轴刻度
    axisLabel: {
      fontSize: 12,
      color: '#999',
      align: 'right', // 文字右对齐
      margin: 10 // 与图表的间距
    },
    splitLine: {
      show: true,
      lineStyle: {
        type: 'dashed', // 虚线分隔线
        color: '#eee'
      }
    }
  },
  series: [
    {
      type: 'line',
      data: [0, 1, 1, 2, 1, 2], // 对应y轴的索引（2=可改善，1=正常）
      symbol: 'circle', // 圆点标记
      symbolSize: 10, // 标记大小
      lineStyle: {
        color: '#2E70FC', // 蓝色线条
        width: 2
      },
      itemStyle: {
        color: '  #fff', // 圆点颜色
        borderColor: '#2E70FC', // 圆点边框（模拟图中白底效果）
        borderWidth: 1
      },
      smooth: false // 非平滑曲线
    }
  ]
};

// d:\work\smart-wearable-devices\smart-wearable-devices\src\pagesA\echartOptions\sleepRhythmOptions.ts
export const sleepTimeOption = {
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    top: '15%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    data: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'], // 可根据实际时间点调整
    axisLine: {
      show: true, // 显示X轴线
      lineStyle: { color: '#f7f7f7' } // X轴为实线
    },
    axisTick: { show: false },
    axisLabel: { fontSize: 12, color: '#666' }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 24,
    interval: 8, // 坐标轴刻度间隔
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    splitLine: {
      show: true,
      lineStyle: {
        type: 'dashed', // 虚线样式
        color: '#eee' // 虚线颜色
      }
    }
  },
  series: [
    {
      type: 'bar',
      data: [14, 14, 16, 13, 22, 14, 16, 18, 14, 16, 13], // 模拟数据，需替换为真实压力值
      itemStyle: {
        color: '#2e70fc'
      },
      barWidth: '20px'
    }
  ],
  backgroundColor: '#ffffff'
};
