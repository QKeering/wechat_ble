// src/utils/echartOptions.ts
// 定义 ECharts Option 的类型（若项目中已引入 ECharts 类型，可直接使用）
const echarts = require('../../static/echarts.min.js');
// 第一个配置：baseOption
export const baseOption = {
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    top: '15%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    data: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '23:00'], // 可根据实际时间点调整
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    axisLabel: {}
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 50,
    interval: 10, // 坐标轴刻度间隔
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    splitLine: {
      lineStyle: {
        color: '#F0F0F0',
        type: 'dashed', // 设置为虚线
        width: 1,
        dashOffset: 0
      },
      show: true // 确保显示分割线
    }
  },
  series: [
    {
      type: 'bar',
      data: [0], // 模拟数据，需替换为真实压力值
      barHeight: 20,
      itemStyle: {
        color: function (params: any) {
          const value = params.value;
          // 根据数值范围设置颜色
          if (value >= 30) {
            return '#00cc99'; // 30以上 - 深绿色
          } else if (value >= 20) {
            return '#66e6cc'; // 20-30之间 - 浅绿色
          } else {
            return '#ccf5ed'; // 20以下 - 最浅绿色
          }
        }
      },
      // 修改柱子宽度为自适应，使用百分比而不是固定像素
      barWidth: '90%',
      // 添加柱子之间的间距
      barCategoryGap: '10%'
    }
  ],
  backgroundColor: '#f5fdfb'
};

// 第二个配置：pressureOption
export const pressureOption = {
  title: {
    show: false
  },
  series: [
    {
      type: 'pie',
      radius: ['45%', '65%'],
      center: ['20%', '53%'],
      data: [
        { value: 72, name: '放松', itemStyle: { color: '#e6f7f3', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 18, name: '正常', itemStyle: { color: '#66e6cc', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 10, name: '中等', itemStyle: { color: '#00cc99', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 10, name: '偏高', itemStyle: { color: '#00cc99', borderWidth: 1, borderColor: '#ffffff' } }
      ],
      label: {
        show: true,
        position: 'center',
        formatter: (params: any) => (params.dataIndex === 0 ? '压力\n比例' : ''),
        color: '#979797',
        fontSize: 14,
        fontWeight: 'normal',
        lineHeight: 20,
        align: 'center',
        verticalAlign: 'middle'
      },
      labelLine: { show: false }
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
      { name: '放松', icon: 'circle' },
      { name: '良好', icon: 'circle' },
      { name: '偏高', icon: 'circle' }
    ],
    formatter: function (name) {
      let value = '',
        time = '';
      if (name === '放松') {
        value = '72%';
        time = '21小时17分钟';
      } else if (name === '良好') {
        value = '18%';
        time = '03小时13分钟';
      } else if (name === '偏高') {
        value = '10%';
        time = '00小时40分钟';
      }
      // 修正富文本语法：用“|”分隔样式名和文本
      return `{nameStyle|${name}}    {percentStyle|${value}}    {timeStyle|${time}}`;
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
        percentStyle: {
          color: '#010101',
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

// 第三个配置：todayOption
export const todayOption = {
  title: {
    text: '今天（11:00）',
    left: '3%',
    top: '5%',
    textStyle: {
      fontSize: 12,
      color: '#979797'
    }
  },
  grid: {
    left: '15%',
    right: '5%',
    bottom: '5%',
    top: '35%',
    containLabel: true
  },
  xAxis: {
    axisLine: { lineStyle: { color: '#F0F0F0' } },
    splitLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    interval: 50,
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    splitLine: { show: false },
    axisLabel: {
      color: '#979797',
      fontSize: 12
    }
  },
  series: [
    {
      type: 'line',
      data: [10, 20, 15, 25, 35, 50, 70, 80, 75, 90],
      lineStyle: {
        color: '#2AE2AE',
        width: 2
      },
      symbol: 'none',
      itemStyle: {
        color: '#00cc99'
      },
      emphasis: {
        lineStyle: {
          width: 3
        }
      }
    }
  ],
  backgroundColor: 'rgba(255, 255, 255, 1)',
  borderRadius: 0
};

export const lastWeekOption = {
  title: {
    text: '11月3日-11月9日(11:00)',
    left: '3%',
    top: '5%',
    textStyle: {
      fontSize: 12,
      color: '#979797'
    }
  },
  grid: {
    left: '15%',
    right: '5%',
    bottom: '5%',
    top: '35%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    data: ['00:00', '06:00', '12:00', '18:00', '24:00'],
    axisLine: {
      lineStyle: { color: '#F0F0F0' }
    },
    axisTick: {
      show: false
    },
    axisLabel: {
      color: '#979797',
      fontSize: 12
    }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    interval: 50,
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    splitLine: {
      show: false
    },
    axisLabel: {
      color: '#666',
      fontSize: 12
    }
  },
  series: [
    {
      type: 'line',
      data: [10, 20, 50, 80, 100, 90, 70, 50, 30, 10],
      lineStyle: {
        color: 'rgba(200, 200, 200, 0.7)',
        width: 2,
        type: 'dashed' // 虚线样式，与示例风格匹配
      },
      symbol: 'none',
      itemStyle: {
        color: 'rgba(200, 200, 200, 0.7)'
      },
      emphasis: {
        lineStyle: {
          width: 3
        }
      }
    }
  ],
  backgroundColor: 'rgba(255, 255, 255, 1)',
  borderRadius: 0
};
