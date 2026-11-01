import { t } from '@/i18n';

// 图内文案（gauge 名称）必须在每次渲染时取当前语言：模块级常量会让切换语言后
// 图表仍停留在启动时的语言。
export const createHabitOption = () => ({
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
      data: [{ value: 67, name: t('睡眠评分'), title: { offsetCenter: ['0%', '0%'] }, detail: { offsetCenter: ['0%', '-30%'] } }],
      radius: '100%',
      center: ['50%', '50%']
    }
  ]
});
