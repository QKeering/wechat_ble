// utils/echartOptions.ts
// @ts-nocheck
type AnyEchartOption = any;

export const baseOption: AnyEchartOption = {
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
    axisLabel: { interval: {} }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 150,
    interval: 20, // 坐标轴刻度间隔
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
  backgroundColor: '#ffffff'
};
