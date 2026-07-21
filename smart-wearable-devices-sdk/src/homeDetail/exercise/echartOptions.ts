// @ts-nocheck
const echarts = require('../../static/echarts.min.js');
let temperatureGradient = '#rgba(255, 107, 139, 0)'; // 降级默认色
if (echarts && echarts.graphic && typeof echarts.graphic.LinearGradient === 'function') {
  temperatureGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: 'rgba(255, 107, 139, 0.1)' },
    { offset: 1, color: 'rgba(255, 107, 139, 0)' }
  ]);
}
export const pressureOption = {
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
          color: '#FF5B7B', // 第一圈的颜色
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
      data: [{ value: 0 }],
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
          color: '#FF893B', // 第二圈的颜色
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
      data: [{ value: 0 }],
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
      data: [{ value: 0 }],
      radius: '60%', // 最内层
      center: ['50%', '50%']
    }
  ]
};

export const calorieOption = {
  grid: {
    left: '0%',
    right: '5%',
    bottom: '15%',
    top: '5%',
    containLabel: true
  },
  xAxis: {
    type: 'category', // 改为category类型，使用自定义刻度
    data: ['00:00', '06:00', '12:00', '18:00', '24:00'], // 自定义刻度，第一个为0

    axisLine: {
      lineStyle: {
        color: '#eee' // 坐标轴线条颜色
      }
    },
    axisTick: {
      show: false // 隐藏刻度线
    },
    axisLabel: {
      fontSize: 12,
      color: '#999' // 坐标轴文字颜色
    },
    boundaryGap: false, // 重要：取消边界间隔，让折线从坐标轴开始
    splitLine: {
      show: false // 隐藏x轴的网格线
    }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    interval: 20, // 刻度间隔（0、30、60、100）
    axisLine: {
      show: false // 隐藏Y轴轴线
    },
    axisTick: {
      show: false // 隐藏Y轴刻度
    },
    splitLine: {
      lineStyle: {
        color: '#f5f5f5', // 网格线颜色
        type: 'dashed'
      }
    },
    axisLabel: {
      fontSize: 12,
      color: '#999' // Y轴文字颜色
    }
  },
  series: [
    // 第一条折线（主趋势线）
    {
      type: 'line',
      // 数据点对应x轴的刻度：0, 06:00, 12:00, 18:00, 24:00
      data: [0, 5, 45, 70, 0], // y轴数值
      smooth: false, // 非平滑折线（匹配图示棱角）
      lineStyle: {
        color: '#ffd8df', // 粉红色线条
        width: 2
      },
      symbol: 'none', // 隐藏数据点标记
      areaStyle: {
        color: temperatureGradient
      }
    },
    // 第二条折线（次要趋势线）
    {
      type: 'line',
      // 数据点对应x轴的刻度：0, 06:00, 12:00, 18:00, 24:00
      data: [0, 3, 30, 55, 0], // y轴数值
      smooth: false,
      lineStyle: {
        color: '#ff7991', // 浅粉色线条（与第一条区分）
        width: 2
      },
      symbol: 'none' // 隐藏数据点标记
    }
  ]
};
// 24小时时间轴配置 - 与图片完全一致
export const categoryOption = {
  grid: {
    left: '2%',
    right: '2%',
    bottom: '15%',
    top: '2%', // 减少顶部间距，降低图表高度
    containLabel: false
  },
  xAxis: {
    type: 'category',
    // 24小时数据点，每个小时一个（00:00-23:00，共24个）
    data: [
      '00:00',
      '01:00',
      '02:00',
      '03:00',
      '04:00',
      '05:00',
      '06:00',
      '07:00',
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
      '18:00',
      '19:00',
      '20:00',
      '21:00',
      '22:00',
      '23:00'
    ],
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    axisLabel: {
      // 只显示指定的时间点
      show: true,
      interval: 0, // 显示所有标签
      formatter: function (value) {
        // 只显示 00:00, 06:00, 12:00, 18:00
        // 最后一个位置（23:00）显示为 24:00
        if (value === '23:00') {
          return '24:00';
        }
        const showLabels = ['00:00', '06:00', '12:00', '18:00'];
        return showLabels.includes(value) ? value : '';
      },
      color: '#666',
      fontSize: 12
    },
    boundaryGap: true
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 1,
    axisLine: {
      show: false
    },
    axisTick: {
      show: false
    },
    axisLabel: {
      show: false
    },
    splitLine: {
      show: false
    }
  },
  series: [
    {
      type: 'bar',
      // 24个数据点，所有值设为1，使所有柱子高度相同
      data: Array(24).fill(1),
      barWidth: '90%',
      barCategoryGap: '8%',
      itemStyle: {
        // 根据时间段设置颜色
        color: function (params) {
          const hour = params.dataIndex;
          // 00:00-06:00: 浅灰色（未激活，但可见）
          if (hour >= 0 && hour < 6) {
            return '#f0f0f0';
          }
          // 06:00-12:00: 蓝色（激活）
          else if (hour >= 6 && hour < 12) {
            return '#2c9dff'; // 使用项目中的蓝色
          }
          // 12:00-15:00: 浅灰色（未激活）
          else if (hour >= 12 && hour < 15) {
            return '#f0f0f0';
          }
          // 15:00-20:00: 蓝色（激活）
          else if (hour >= 15 && hour < 20) {
            return '#2c9dff';
          }
          // 20:00-24:00: 浅灰色（未激活）
          else {
            return '#f0f0f0';
          }
        },
        // 设置圆角矩形
        borderRadius: [4, 4, 4, 4]
      },
      emphasis: {
        itemStyle: {
          // 鼠标悬停时稍微加深颜色
          color: function (params) {
            const hour = params.dataIndex;
            if (hour >= 0 && hour < 6) {
              return '#e0e0e0';
            } else if (hour >= 6 && hour < 12) {
              return '#1e5fd9';
            } else if (hour >= 12 && hour < 15) {
              return '#e0e0e0';
            } else if (hour >= 15 && hour < 20) {
              return '#1e5fd9';
            } else {
              return '#e0e0e0';
            }
          }
        }
      }
    }
  ],
  tooltip: {
    show: false
  },
  backgroundColor: 'transparent'
};
// 活动强度阶梯线图配置 - 与图片完全一致
export const actIntensityOption = {
  grid: {
    left: '15%',
    right: '5%',
    bottom: '5%', // 增加底部间距，为X轴标签留出更多空间
    top: '5%',
    containLabel: false
  },
  xAxis: {
    type: 'category',
    // 添加更多时间点以精确匹配活动模式（用于数据点定位）
    data: ['00:00', '06:00', '12:00', '18:00', '24:00'],
    axisTick: {
      show: false
    },
    axisLine: {
      show: true,
      lineStyle: {
        color: '#cccccc'
      }
    },
    axisLabel: {
      color: '#999999',
      fontSize: 10, // 减小字体大小，避免重叠
      // 显示所有主要时间点：00:00, 06:00, 12:00, 18:00, 24:00
      // 不需要formatter，直接显示所有标签
      // 确保显示最小和最大标签
      showMinLabel: true,
      showMaxLabel: true, // 显示最大标签（24:00）
      // 增加标签与轴线的距离，避免重叠
      margin: 10,
      // 强制显示所有标签位置
      interval: 0
    },
    boundaryGap: false // 不设置边界间距，确保所有标签都能显示
  },
  yAxis: {
    type: 'value', // 改为value类型
    min: 0, // 最小值设为0
    max: 100, // 最大值设为100
    interval: 25, // 刻度间隔为25，显示0, 25, 50, 75, 100五个刻度
    axisTick: {
      show: false
    },
    axisLine: {
      show: false
    },
    axisLabel: {
      color: function (value) {
        // 为每个强度级别设置不同的颜色
        const colorMap = {
          25: '#FFBC90', // 低强度
          50: '#FFA468', // 中强度
          75: '#FF893B', // 高强度
          100: '#FF893B' // 高强度
        };
        return colorMap[value] || '#666666'; // 默认颜色
      },
      fontSize: 14,
      // 将数值转换为中文标签
      formatter: function (value) {
        const labelMap = {
          25: '不活跃', // 30-69
          50: '低强度', // 70-79
          75: '中强度', // >=80
          100: '高强度' // >=80
        };
        return labelMap[value] || '';
      }
    },
    splitLine: {
      show: true,
      lineStyle: {
        color: '#eeeeee',
        type: 'dashed'
      }
    }
  },
  series: [
    {
      type: 'line',
      // 数据值对应y轴数值：0-100的百分比值
      // x轴索引：0=00:00, 1=06:00, 2=12:00, 3=18:00, 4=24:00
      data: [0, 0, 25, 75, 75], // 修改为0-100的百分比值
      symbol: 'none', // 不显示数据点标记
      lineStyle: {
        color: '#f5a623', // 橙色
        width: 1 // 加粗线条，匹配设计稿中的粗线条效果
      },
      smooth: true, // 不使用平滑，保持尖锐的阶梯角
      itemStyle: {
        color: '#f5a623'
      },
      // 明确不显示填充区域，只显示线条
      areaStyle: null // 不设置 areaStyle，确保没有填充
    }
  ],
  tooltip: {
    show: false
  },
  backgroundColor: 'transparent'
};
export const activePieOption = {
  title: {
    subtext: '活动\n比例',
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
        { value: 60, name: '不活跃', itemStyle: { color: '#FFDBC3', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 12, name: '低强度', itemStyle: { color: '#FFBC90', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 18, name: '中强度', itemStyle: { color: '#FFA468', borderWidth: 1, borderColor: '#ffffff' } },
        { value: 10, name: '高强度', itemStyle: { color: '#FF893B', borderWidth: 1, borderColor: '#ffffff' } }
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
      { name: '不活跃', icon: 'circle' },
      { name: '低强度', icon: 'circle' },
      { name: '中强度', icon: 'circle' },
      { name: '高强度', icon: 'circle' }
    ],
    formatter: function (name) {
      let value = '',
        time = '';
      if (name === '不活跃') {
        value = '60%';
        time = '21小时17分钟';
      } else if (name === '低强度') {
        value = '12%';
        time = '03小时13分钟';
      } else if (name === '中强度') {
        value = '18%';
        time = '00小时40分钟';
      } else if (name === '高强度') {
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
        color: '#ffac72',
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

export const lastDayOption = {
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
