// utils/echartOptions.ts
// 引入 echarts （用于渐变等功能，若不需要可省略）
// @ts-nocheck
const echarts = require('../../static/echarts.min.js');
type AnyEchartOption = any;
// import * as echarts from '@/static/echarts.min.js';
let temperatureGradient = '#4cae4c'; // 降级默认色
if (echarts && echarts.graphic && typeof echarts.graphic.LinearGradient === 'function') {
  temperatureGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: '#d6f5d6' },
    { offset: 1, color: '#4cae4c' }
  ]);
}
export const defaultEchartOption: AnyEchartOption = {
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
      color: '#666',
      interval: 0, // 关键：强制显示所有标签，0表示无间隔
      // rotate: 30, // 可选：标签旋转30度，避免文字重叠（根据需求调整角度）
      margin: 8 // 可选：增加标签与轴线的间距
    }
  },
  yAxis: {
    type: 'value', // 改为数值型
    min: 0, // 最小值0
    max: 100, // 最大值100
    interval: 20,
    axisLine: { show: false }, // 隐藏y轴线
    axisTick: { show: false }, // 隐藏y轴刻度
    axisLabel: {
      fontSize: 12,
      color: '#999',
      align: 'right', // 文字右对齐
      margin: 10, // 与图表的间距
      formatter: function (value: number) {
        // 只在特定位置显示中文标签
        if (value === 20) return '可改善';
        if (value === 60) return '正常';
        if (value === 80) return '优秀';
        return ''; // 其他位置不显示标签
      }
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
      data: [0, 50, 67, 72, 80, 90], // 对应y轴的索引（2=可改善，1=正常）
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

export const pressureOption: AnyEchartOption = {
  title: {
    subtext: '强度\n比例',
    subtextStyle: {
      fontSize: 14,
      fontWeight: 'normal',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 20,
      color: '#979797'
    },
    left: '13%',
    top: '42%',
    textAlign: 'center',
    textVerticalAlign: 'middle'
  },
  series: [
    {
      type: 'pie',
      radius: ['55%', '80%'],
      center: ['15%', '53%'],
      data: [
        { value: 72, name: '户外光照', itemStyle: { color: '#ebf1ff', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 18, name: '室内灯光', itemStyle: { color: '#abc6fe', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 10, name: '室内昏暗', itemStyle: { color: '#2e70fc', borderWidth: 1, borderColor: '#ffffff' } }
      ],
      label: { show: false },
      labelLine: { show: false }
    }
  ],
  legend: {
    orient: 'vertical',
    right: '0%',
    top: '15%',
    itemWidth: 12,
    itemHeight: 12,
    itemGap: 15,
    data: [
      { name: '户外光照', icon: 'circle' },
      { name: '室内灯光', icon: 'circle' },
      { name: '室内昏暗', icon: 'circle' }
    ],
    formatter: function (name) {
      let value = '',
        time = '';
      if (name === '户外光照') {
        time = '21小时17分钟';
      } else if (name === '室内灯光') {
        time = '03小时13分钟';
      } else if (name === '室内昏暗') {
        time = '00小时40分钟';
      }
      // 修正富文本语法：用“|”分隔样式名和文本
      return `{nameStyle|${name}}{space|}{timeStyle|${time}}`;
    },
    textStyle: {
      fontSize: 12,
      align: 'left',
      verticalAlign: 'middle',
      rich: {
        nameStyle: {
          color: '#979797',
          fontSize: 12
        },
        space: {
          width: 40, // 设置间距宽度
          fontSize: 12
        },
        timeStyle: {
          color: '#010101',
          fontSize: 12
        }
      }
    }
  },
  backgroundColor: 'rgba(255,255,255,0.8)',
  borderRadius: 12,
  padding: [10, 20, 10, 20]
};
