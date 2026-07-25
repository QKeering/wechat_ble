// utils/echartOptions.ts
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
      symbol: 'none'
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

//睡眠时间
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
    data: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '23:00'],
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { fontSize: 12, color: '#979797', interval: 0, formatter: {} }
  },
  yAxis: {
    type: 'value', // 关键：改为数值轴
    min: 0, // 实际数值范围：0-4
    max: 3,
    interval: 1, // 刻度间隔1
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      fontSize: 12,
      color: '#979797',
      // 关键：将数值刻度转换为中文
      formatter: function (value) {
        const labelMap = {
          0: '深睡',
          1: '浅睡',
          2: '快速眼动',
          3: '清醒'
        };
        return labelMap[value] || '';
      }
    },
    splitLine: {
      show: true,
      lineStyle: {
        type: 'dashed',
        color: '#e6e5fc',
        width: 1,
        opacity: 0.6
      }
    }
  },
  series: [
    // 方案1：使用堆叠柱状图实现“悬浮”柱子（推荐）
    {
      type: 'bar',
      // 实际数据：每个值是Y轴数值（可以是小数）
      // data: [3, 2, 1, 0.2, 1, 2, 3, 0.5, 1],
      data: [2.3, 1.7, 0.8, 0.2, 0.5, 1.2, 2.8, 2.1, 1.5, 0.9, 0.3, 1.6, 2.4, 1.8, 1.1, 0.7, 0.4, 1.3, 2.6, 2.2, 1.9, 1.4, 0.6, 2.9],
      // 关键：柱子高度固定为1（对应一个刻度区间）
      barHeight: 20, // 固定柱子高度，替代barWidth
      // 关键：让柱子“悬浮”在对应数值位置（通过调整起始位置）
      // 计算柱子的起始位置：data值 - 0.5（让柱子中心对齐刻度）
      // 但ECharts的数值轴柱状图需要用两个系列堆叠实现，或用barGap
      // 更简单的方式：使用barGap: '-100%' + 固定高度
      barGap: '-100%', // 让柱子重叠，实现悬浮效果
      itemStyle: {
        color: function (params) {
          const colorMap = {
            深睡: '#5146D8',
            浅睡: '#9B93F5',
            快速眼动: '#48A7E8',
            清醒: '#F4A340'
          };
          // 关键：根据数值范围匹配睡眠阶段
          let categoryName;
          if (params.data >= 3) categoryName = '清醒';
          else if (params.data >= 2) categoryName = '快速眼动';
          else if (params.data >= 1) categoryName = '浅睡';
          else categoryName = '深睡';
          return colorMap[categoryName] || '#e6e5fc';
        }
      },
      barWidth: '90%',
      // 添加柱子之间的间距
      barCategoryGap: '10%'
    }
  ],
  backgroundColor: '#ffffff'
};
export const sleepRageOption = {
  title: {
    subtext: '睡眠\n比例',
    subtextStyle: {
      fontSize: 14,
      fontWeight: 'normal',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 20,
      color: '#979797'
    },
    left: '13%',
    top: '45%',
    textAlign: 'center',
    textVerticalAlign: 'middle'
  },
  series: [
    {
      type: 'pie',
      radius: ['40%', '55%'],
      center: ['15%', '53%'],
      data: [
        { value: 10, name: '清醒', itemStyle: { color: '#F4A340', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 8, name: '快速眼动', itemStyle: { color: '#48A7E8', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 22, name: '浅睡', itemStyle: { color: '#9B93F5', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 60, name: '深睡', itemStyle: { color: '#5146D8', borderWidth: 1, borderColor: '#ffffff' } }
      ],
      label: { show: false },
      labelLine: { show: false },
      // 为所有扇形统一设置边框样式，创建间隔效果
      itemStyle: {
        borderWidth: 2, // 边框宽度，控制间隔大小
        borderColor: '#ffffff' // 边框颜色，设置为背景色（白色）创建间隔效果
      }
    }
  ],
  legend: {
    orient: 'vertical',
    right: '0%',
    top: '20%',
    itemWidth: 12,
    itemHeight: 12,
    itemGap: 15,
    data: [
      { name: '清醒', icon: 'circle' },
      { name: '快速眼动', icon: 'circle' },
      { name: '浅睡', icon: 'circle' },
      { name: '深睡', icon: 'circle' }
    ],
    formatter: function (name) {
      let value = '',
        time = '';
      if (name === '清醒') {
        time = '0小时17分钟';
      } else if (name === '快速眼动') {
        time = '0小时13分钟';
      } else if (name === '浅睡') {
        time = '02小时12分钟';
      } else if (name === '深睡') {
        time = '06小时03分钟';
      }
      return `{nameStyle|${name}}{space|    }{timeStyle|${time}}`;
    },
    textStyle: {
      fontSize: 12,
      align: 'left',
      verticalAlign: 'middle',
      rich: {
        nameStyle: {
          color: '#979797',
          fontSize: 12,
          width: 60,
          align: 'left',
          lineHeight: 20
        },
        space: {
          width: 10, // 空格宽度，可调整
          lineHeight: 20
        },
        timeStyle: {
          color: '#010101',
          fontSize: 12,
          lineHeight: 20
        }
      }
    }
  },
  backgroundColor: 'rgba(255,255,255,0.8)',
  borderRadius: 12,
  padding: [10, 20, 10, 20]
};
