export const baseOption = {
  backgroundColor: '#fff',
  tooltip: {
    show: true, // 启用tooltip
    trigger: 'axis', // 触发方式为坐标轴触发
    axisPointer: {
      type: 'line', // 显示指示线
      lineStyle: {
        color: '#ff5a5f',
        width: 1,
        type: 'solid'
      }
    },
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderColor: 'rgba(0, 0, 0, 0.8)',
    textStyle: {
      color: '#fff',
      fontSize: 12
    }
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
      connectNulls: true
      // label: {
      //   show: true, // 显示标签
      //   position: 'top', // 标签位置：top（上方）、bottom（下方）、inside（内部）
      //   color: '#ff5a5f', // 标签颜色
      //   fontSize: 10, // 字体大小
      //   fontWeight: 'bold', // 字体粗细
      //   formatter: function (params: any) {
      //     // 如果值为0，返回空字符串不显示标签
      //     if (params.value == 0) {
      //       return '';
      //     }
      //     // 否则显示数值
      //     return params.value;
      //   }
      // }
    }
  ],
  grid: {
    left: '1%',
    right: '5%',
    bottom: '5%',
    top: '10%',
    containLabel: true
  }
};
