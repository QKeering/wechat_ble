// utils/echartOptions.ts
// 1. 运动卡
export const heartRateOption = {
  backgroundColor: '#fff',
  tooltip: {
    show: false
  },
  xAxis: {
    type: 'category',
    data: ['00:00', '06:00', '12:00', '18:00', '21:00', '24:00'],
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: '#999',
      fontSize: 12
    },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    splitNumber: 5,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true },
    splitLine: {
      lineStyle: { type: 'dashed', color: '#eee' }
    }
  },
  series: [
    {
      data: [60, 70, 75, 70, 65, 68],
      type: 'line',
      smooth: true,
      itemStyle: { color: '#ff5a5f' },
      lineStyle: { color: '#ff5a5f', width: 2 },
      symbol: 'circle', // 改为可见的标记
      symbolSize: 0, // 将标记大小设置为0，不显示圆点
      label: {
        show: true, // 显示标签
        position: 'top', // 标签位置：top（上方）、bottom（下方）、inside（内部）
        color: '#ff5a5f', // 标签颜色
        fontSize: 10, // 字体大小
        fontWeight: 'bold', // 字体粗细
        formatter: function (params: any) {
          // 如果值为0，返回空字符串不显示标签
          if (params.value == 0) {
            return '';
          }
          // 否则显示数值
          return params.value;
        }
      }
    }
  ],
  grid: {
    left: '2%',
    right: '2%',
    bottom: '5%',
    top: '10%',
    containLabel: true
  }
};

// 2. 运动步数
export const stepCount = {
  backgroundColor: '#fff',
  tooltip: { show: false },
  xAxis: {
    type: 'category',
    data: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#999', fontSize: 12 },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    // splitNumber: 5,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true },
    splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
  },
  series: [
    {
      data: [95, 94, 96, 98, 97, 96, 95],
      type: 'line',
      smooth: true,
      itemStyle: { color: '#ffb27b' },
      lineStyle: { color: '#ffb27b', width: 2 },
      symbol: 'circle', // 改为可见的标记
      symbolSize: 0, // 将标记大小设置为0，不显示圆点
      label: {
        show: true, // 显示标签
        position: 'top', // 标签位置：top（上方）、bottom（下方）、inside（内部）
        color: '#ffb27b', // 标签颜色
        fontSize: 10, // 字体大小
        fontWeight: 'bold', // 字体粗细
        formatter: function (params: any) {
          // 如果值为0，返回空字符串不显示标签
          if (params.value == 0) {
            return '';
          }
          // 否则显示数值
          return params.value;
        }
      }
    }
  ],
  grid: { left: '2%', right: '2%', bottom: '5%', top: '10%', containLabel: true }
};
// 运动里程
export const exerciseMileage = {
  backgroundColor: '#fff',
  tooltip: { show: false },
  xAxis: {
    type: 'category',
    data: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'],
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#999', fontSize: 12 },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 10,
    // splitNumber: 5,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true },
    splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
  },
  series: [
    {
      data: [100, 110, 90, 80, 120, 130, 110, 95, 105],
      type: 'line',
      smooth: true,
      itemStyle: { color: '#3ca3ff' },
      lineStyle: { color: '#3ca3ff', width: 2 },
      symbol: 'circle', // 改为可见的标记
      symbolSize: 0, // 将标记大小设置为0，不显示圆点
      label: {
        show: true, // 显示标签
        position: 'top', // 标签位置：top（上方）、bottom（下方）、inside（内部）
        color: '#3ca3ff', // 标签颜色
        fontSize: 10, // 字体大小
        fontWeight: 'bold', // 字体粗细
        formatter: function (params: any) {
          // 如果值为0，返回空字符串不显示标签
          if (params.value == 0) {
            return '';
          }
          // 否则显示数值
          return params.value;
        }
      }
    }
  ],
  grid: { left: '2%', right: '2%', bottom: '5%', top: '10%', containLabel: true }
};
