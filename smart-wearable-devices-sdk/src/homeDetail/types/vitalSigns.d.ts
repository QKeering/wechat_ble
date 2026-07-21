/** 1. 统计项类型（用 type 替代 interface） */
export type StatItem = {
  label: string;
  value: number | string;
};

/** 2. 图表差异化配置类型 */
export type ChartOption = {
  xAxis: {
    data: string[]; // X轴标签数组
  };
  series: Array<{
    data: number[]; // 图表数据数组
  }>;
};

export type VitalSignItem = {
  id: string; // 组件唯一标识
  cardTitle: string; // 卡片标题
  measureBtnText: string; // 测量按钮文字
  currentRate: number | string; // 当前数值
  rateUnit: string; // 数值单位
  stats: StatItem[]; // 统计项数组
  chartOption: ChartOption; // 图表差异化配置
};
