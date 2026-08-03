export const chartOptionFirst = {
  series: [
    // ========== 第一圈：最外层环（#FF5B7B）==========
    {
      type: 'gauge',
      startAngle: 90,
      endAngle: -270,
      pointer: { show: false },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          color: '#FF893B', // 第一圈的颜色
          borderWidth: 0,
          borderColor: '#464646'
        }
      },
      axisLine: {
        lineStyle: {
          width: 10,
          color: [[1, '#FFF0CB']]
        }
      },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      detail: {
        show: false
      },
      data: [{ value: 70 }],
      radius: '100%', // 最外层
      center: ['50%', '50%']
    },
    // ========== 第二圈：中间层环（#FF893B）==========
    {
      type: 'gauge',
      startAngle: 90,
      endAngle: -270,
      pointer: { show: false },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          color: '#FF5B7B', // 第二圈的颜色
          borderWidth: 0,
          borderColor: '#464646'
        }
      },
      axisLine: {
        lineStyle: {
          width: 10,
          color: [[1, '#FFF0CB']]
        }
      },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      detail: {
        show: false
      },
      data: [{ value: 70 }],
      radius: '80%', // 中间层
      center: ['50%', '50%']
    },
    // ========== 第三圈：最内层环（#2C9DFF）==========
    {
      type: 'gauge',
      startAngle: 90,
      endAngle: -270,
      pointer: { show: false },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          color: '#2C9DFF', // 第三圈的颜色
          borderWidth: 0,
          borderColor: '#464646'
        }
      },
      axisLine: {
        lineStyle: {
          width: 10,
          color: [[1, '#FFF0CB']]
        }
      },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      detail: {
        show: false
      },
      data: [{ value: 70 }],
      radius: '60%', // 最内层
      center: ['50%', '50%']
    }
  ]
};
export const chartOptionSecound = {
  title: {
    text: ''
  },
  tooltip: {
    trigger: 'item', // 触发类型为数据项
    formatter: function (params: any) {
      const values = params.value;
      const names = ['睡眠', '生命体征', '活动', '放松状态'];
    }
  },
  legend: {
    data: []
  },
  radar: {
    indicator: [
      { name: '睡眠', max: 100 },
      { name: '生命体征', max: 100 },
      { name: '活动', max: 100 },
      { name: '放松状态', max: 100 }
    ]
  },
  series: [
    {
      name: '个人健康评分',
      type: 'radar',
      areaStyle: { color: '#81A9FD' }, // 蓝色填充
      lineStyle: { color: '#2E70FC' }, // 线条颜色
      itemStyle: { color: '#2E70FC' }, // 点颜色
      data: [
        {
          value: [93, 85, 92, 95],
          name: '个人健康评分'
        }
      ]
    }
  ]
};
export const chartOptionThird = {
  series: [
    {
      type: 'gauge',
      startAngle: 90,
      endAngle: -270,
      pointer: { show: false },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          color: '#5F57EC',
          borderWidth: 0,
          borderColor: '#464646'
        }
      },
      axisLine: {
        lineStyle: {
          width: 10,
          color: [[1, '#EBF1FF']]
        }
      },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      title: { fontSize: 12, color: '#010101' },
      detail: {
        fontSize: 24,
        color: '#010101'
      },
      data: [{ value: 85, name: '睡眠评分', title: { offsetCenter: ['0%', '20%'] }, detail: { offsetCenter: ['0%', '-20%'] } }],
      radius: '100%',
      center: ['50%', '50%']
    }
  ]
};
export const vitalOption = {
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
      show: false // 隐藏x轴标签
    },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 260,
    splitNumber: 6,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      show: false // 隐藏y轴标签
    },
    splitLine: {
      show: false // 隐藏y轴网格线
    }
  },
  series: [
    {
      data: [60, 70, 75, 70, 65, 68],
      type: 'line',
      smooth: true,
      itemStyle: { color: '#ff5a5f' },
      lineStyle: { color: '#ff5a5f', width: 2 },
      symbol: 'none',
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            {
              offset: 0,
              color: 'rgba(255, 90, 95, 0.3)' // 淡红色
            },
            {
              offset: 1,
              color: 'rgba(255, 90, 95, 0)' // 透明
            }
          ]
        }
      }
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
export const relaxOption = {
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
      show: false // 隐藏x轴标签
    },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 300,
    splitNumber: 5,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      show: false // 隐藏y轴标签
    },
    splitLine: {
      show: false // 隐藏y轴网格线
    }
  },
  series: [
    {
      data: [60, 70, 75, 70, 65, 68],
      type: 'line',
      smooth: true,
      itemStyle: { color: '#3fe4b6' },
      lineStyle: { color: '#3fe4b6', width: 2 },
      symbol: 'none',
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            {
              offset: 0,
              color: 'rgba(227, 251, 245, 0.3)'
            },
            {
              offset: 1,
              color: 'rgba(227, 251, 245, 0)' // 透明
            }
          ]
        }
      }
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
