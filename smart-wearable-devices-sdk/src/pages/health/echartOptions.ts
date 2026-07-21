export const habitOption = {
  series: [
    {
      type: 'gauge',
      startAngle: 180,
      endAngle: 0,
      pointer: { show: false },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          color: '#4C76F1',
          borderWidth: 0,
          borderColor: '#464646'
        }
      },
      axisLine: {
        lineStyle: {
          width: 10,
          color: [[1, '#EEF2FE']]
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
      data: [{ value: 67, name: '睡眠评分', title: { offsetCenter: ['0%', '0%'] }, detail: { offsetCenter: ['0%', '-30%'] } }],
      radius: '100%',
      center: ['50%', '50%']
    }
  ]
};
