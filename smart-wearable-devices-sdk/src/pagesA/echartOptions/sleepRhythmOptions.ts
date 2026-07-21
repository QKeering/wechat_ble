// utils/echartOptions.ts
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
        if (value === 20) return '不足';
        if (value === 60) return '正常';
        if (value === 80) return '充足';
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
    max: 720,
    interval: 120, // 坐标轴刻度间隔
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    axisLabel: {
      fontSize: 12,
      color: '#999',
      align: 'right', // 文字右对齐
      margin: 10, // 与图表的间距
      formatter: function (value: number) {
        // 只在特定位置显示中文标签
        if (value === 0) return '18:00';
        if (value === 120) return '20:00';
        if (value === 240) return '22:00';
        if (value === 360) return '00:00';
        if (value === 480) return '02:00';
        if (value === 600) return '04:00';
        if (value === 720) return '06:00';
        return ''; // 其他位置不显示标签
      }
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
