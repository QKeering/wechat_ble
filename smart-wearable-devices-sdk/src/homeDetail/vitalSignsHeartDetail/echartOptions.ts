// utils/echartOptions.ts
// 引入 echarts （用于渐变等功能，若不需要可省略）
export const heartRateOption = {
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
    boundaryGap: false,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      show: false
    },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 180,
    splitNumber: 6,
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
    left: 24,
    right: 24,
    top: 56,
    bottom: 34,
    containLabel: false
  }
};
// 体温图表配置（默认）
export const temperatureOption = {
  backgroundColor: '#fff',
  tooltip: {
    show: true, // 启用tooltip
    trigger: 'axis', // 触发方式为坐标轴触发
    axisPointer: {
      type: 'line', // 显示指示线
      lineStyle: {
        color: '#4cae4c',
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
    data: ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '24:00'],
    boundaryGap: false,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      show: false
    },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 30,
    max: 40,
    splitNumber: 5, // 刻度分段数
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true },
    splitLine: {
      lineStyle: { type: 'dashed', color: '#eee' }
    }
  },
  series: [
    {
      data: [],
      type: 'bar',
      itemStyle: {
        // 渐变颜色（从浅绿到深绿）
        color: '#c23939ff'
      },
      // barWidth: 20, // 柱形宽度
      barWidth: '90%',
      barGap: '20%',
      emphasis: {
        scale: false // 取消 hover 时的缩放效果
      }
      // label: {
      //   color: '#4cae4c', // 标签颜色
      //   fontSize: 10, // 字体大小
      //   fontWeight: 'bold', // 字体粗细
      //   formatter: function (params: any) {
      //     // 如果值为0，返回空字符串不显示标签
      //     if (params.value == 30) {
      //       return '';
      //     }
      //     // 否则显示数值
      //     return params.value;
      //   }
      // }
    }
  ],
  grid: {
    left: 24,
    right: 24,
    top: 56,
    bottom: 34,
    containLabel: false
  }
};

// // 5. 配置映射表：navbarTitle → 对应的 option
// export const optionMap = {
//   心率详情: heartRateOption,
//   心率变异性详情: hrVOption,
//   体温详情: temperatureOption
// };

// 6. 默认 option（匹配不到时使用）
export const defaultEchartOption = heartRateOption;
