export const healthReportOption = {
  title: {
    text: '' // 可根据需要添加标题
  },
  tooltip: {
    show: false // 禁用tooltip，避免手指移动时显示数据列表
  },
  radar: {
    indicator: [
      { name: '运动', max: 100 },
      { name: '压力', max: 100 },
      { name: '血氧', max: 100 },
      { name: '心率变异性', max: 100 },
      { name: '心率', max: 100 },
      { name: '睡眠', max: 100 },
      { name: '体温', max: 100 }
    ],
    center: ['50%', '50%'],
    radius: '70%'
  },
  series: [
    {
      type: 'radar',
      symbol: 'none',
      data: [
        {
          value: [90, 97, 97, 100, 100, 95, 90, 91], // 对应各指标的数值，可根据实际数据调整
          name: '健康数据',
          areaStyle: {
            color: '#7fa7fd' // 蓝色填充
          },
          lineStyle: {
            color: 'rgba(100, 149, 237, 1)'
          }
        }
      ]
    }
  ]
};
