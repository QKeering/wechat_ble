/** 评分项通用类型（如睡眠准备、睡眠节律、久坐风险等） */
export type ScoreItem = {
  /** 变化值（当期 - 前四周平均） */
  score: number;
  /** 等级：待改善/良好/优秀 */
  level: string;
  /** 当期评分值 */
  current: number;
  /** 前四周平均 */
  avg: number;
};

/** 生活习惯评分类型 */
export type HabitScore = {
  /** 评分 0-100 */
  score: number;
  /** 状态: 正常/偏低/偏高 */
  status: string;
  /** 趋势: 保持不变/上升/下降 */
  trend: string;
  /** 相比前四周变化值 */
  trendValue: number;
  /** 等级: 待改善/良好/优秀 */
  level: string;
};

/** 睡眠模块类型 */
export type SleepModule = {
  /** 睡前准备 */
  preparation: ScoreItem;
  /** 睡眠节律 */
  rhythm: ScoreItem;
  /** 睡眠过程恢复 */
  recovery: ScoreItem;
  /** 睡眠激活 */
  activation: ScoreItem;
};

/** 活动模块类型 */
export type ActivityModule = {
  /** 久坐风险 */
  sedentaryRisk: ScoreItem;
  /** 活动风险 */
  activityRisk: ScoreItem;
  /** 运动规律性 */
  exerciseRegularity: ScoreItem;
};

/** 根数据类型（接口返回的顶层数据） */
export type HabitAnalysisData = {
  /** 日期范围 */
  dateRange: string;
  /** 生活习惯评分 */
  habitScore: HabitScore;
  /** 睡眠模块 */
  sleep: SleepModule;
  /** 活动模块 */
  activity: ActivityModule;
};

// 若需导出联合类型（如等级、状态的字面量约束），可补充：
export type LevelType = '待改善' | '良好' | '优秀';
export type StatusType = '正常' | '偏低' | '偏高';
export type TrendType = '保持不变' | '上升' | '下降';

/** 周趋势图数据项类型 */
export type TrendChartItem = {
  /** 周标签: 11月第2周 */
  weekLabel: string;
  /** 等级: 优秀/正常/可改善 */
  level: string;
  /** 评分值 */
  value: number;
};

/** 指标变化（心率/心率变异性）类型 */
export type IndicatorChangeResp = {
  /** 当期变化值 */
  currentValue: number;
  /** 当期变化方向: 上升/下降 */
  currentDirection: string;
  /** 近期平均变化值 */
  avgValue: number;
  /** 近期平均变化方向: 上升/下降 */
  avgDirection: string;
};

/** 概览信息类型 */
export type OverviewResp = {
  /** 等级: 优秀/良好/可改善 */
  level: string;
  /** 趋势描述: +8 vs 前四周 */
  trend: string;
  /** 变化值 */
  trendValue: number;
  /** 日期范围: 12月9日-12月15日 */
  dateRange: string;
};

/** 睡眠准备数据顶层类型 */
export type SleepPreparationResp = {
  /** 概览信息 */
  overview: OverviewResp;
  /** 周趋势图数据（顶层冗余字段，若接口同时返回则保留） */
  trendChart: TrendChartItem[];
  /** 心率变化 */
  heartRateChange: IndicatorChangeResp;
  /** 心率变异性变化 */
  hrvChange: IndicatorChangeResp;
};

/** 周趋势图数据项类型 */
export type TrendChartItemS = {
  /** 周标签: 11月第2周 */
  weekLabel: string;
  /** 等级: 优秀/正常/可改善 */
  level: string;
  /** 评分值 */
  score: number;
};

/** 睡眠规律性图表数据项类型 */
export type RegularityChartItem = {
  /** 周标签: 11月第2周 */
  weekLabel: string;
  /** 平均入睡时间: 01:00 */
  avgSleepTime: number;
};

/** 概览信息类型 */
export type OverviewRespS = {
  /** 等级: 优秀/良好/待改善 */
  level: string;
  /** 趋势描述: 保持不变 / +8 vs 前四周 */
  trend: string;
  /** 变化值 */
  trendValue: number;
  /** 日期范围: 11月3日-11月9日 */
  dateRange: string;
};

/** 睡眠节律数据顶层类型 */
export type SleepRhythmResp = {
  /** 概览信息 */
  overview: OverviewRespS;
  /** 周趋势图数据（近5周等级趋势） */
  trendChart: TrendChartItemS[];
  /** 睡眠规律性图表数据（近5周入睡起床时间） */
  regularityChart: RegularityChartItem[];
};
export type durationItem = {
  /** 周标签: 11月第2周 */
  weekLabel: string;
  /** 平均睡眠时长（小时） */
  hours: number;
};
/** 睡眠过程恢复顶层类型 */
export type SleepRecoveryResp = {
  /** 概览信息 */
  overview: OverviewRespS;
  /** 周趋势图数据（近5周等级趋势） */
  trendChart: TrendChartItemS[];
  /** 睡眠时长图表数据（近5周入睡起床时间） */
  durationChart: durationItem[];
  /** 平均睡眠时长（6小时34分钟） */
  avgDuration: string;
  /** 睡眠时长等级: 充足/正常/不足 */
  durationLevel: string;
  /** 恢复性睡眠占比（38） */
  recoveryRatio: number;
};
// 睡眠激活
export type getSleepActivationResp = {
  /** 概览信息 */
  overview: OverviewRespS;
  /** 周趋势图数据（近5周等级趋势） */
  trendChart: TrendChartItemS[];
};

//
export type ActivityChartItem = {
  /** 周标签: 11月第2周 */
  weekLabel: string;
  /** 平均步数 */
  steps: number;
};

// 久坐风险
export type SittingRiskResp = {
  /** 概览信息 */
  overview: OverviewRespS;
  /** 周趋势图数据（近5周等级趋势） */
  trendChart: TrendChartItemS[];
  // 步数图表数据（近5周）
  stepChart: ActivityChartItem[];
  /** 平均步数 */
  avgSteps: number;
  /** 步数等级: 充足/正常/不足 */
  stepsLevel: string;
  /** 活动水平(PAL值) */
  activityLevel: number;
  /** 活动时长 */
  activeMinutes: number;
  /** 站立时长 */
  standingHours: number;
};
export type ActivityIntensityItem = {
  /** 周标签: 11月第2周 */
  weekLabel: string;
  /** 中高强度活动时长 */
  minutes: number;
};
// 活动强度
export type ActivityIntensityResp = {
  /** 概览信息 */
  overview: OverviewRespS;
  /** 周趋势图数据（近5周等级趋势） */
  trendChart: TrendChartItemS[];
  // 步数图表数据（近5周）
  durationChart: ActivityIntensityItem[];
  /** 本周中高强度活动总时长（分钟） */
  totalMinutes: number;
  /** 活动强度等级: 正常负荷/轻度负荷/高强度负荷 */
  intensityLevel: string;
};
export type RegularityChartItemF = {
  /** 周标签: 11月第2周 */
  weekLabel: string;
  /** 负荷平均指数 */
  index: number;
};
// 运动规律性
export type RegularityResp = {
  /** 概览信息 */
  overview: OverviewRespS;
  /** 周趋势图数据（近5周等级趋势） */
  trendChart: TrendChartItemS[];
  /** 负荷平均指数图表数据 */
  balanceChart: RegularityChartItemF[];
  /** 负荷平均指数 */
  balanceIndex: number;
  // 负荷等级: 正常负荷/轻度负荷/高强度负荷
  balanceLevel: string;
  /** 中高强度活动天数 */
  midHighDays: number;
};
export type reportParams = {
  heartRate: number;
  hrv: number;
  spo2: number;
  temperature: string;
  stress: number;
};
type userInfo = {
  nickname: string; //昵称
  avatar: string; //头像
  reportDate: string; //报告日期
};
type healthScore = {
  /** 健康评分 */
  score: number;
  /** 健康等级: 优秀/良好/待改善 */
  level: string;
};
type radarChartItem = {
  exercise: string;
  stress: string;
  spo2: string;
  hrv: string;
  heartRate: string;
  sleep: string;
  temperature: string;
  stress: string;
};
type indicatorsItem = {
  heartRate: string;
  hrv: string;
  spo2: string;
  temperature: string;
  stress: string;
  exercise: string;
  activity: string;
  sleep: string;
};
export type HealthReportResp = {
  /** 用户信息 */
  userInfo: userInfo;
  /** 健康评分 */
  healthScore: healthScore;
  /** 雷达图数据 */
  radarChart: radarChartItem;
  /** 各项指标数据 */
  indicators: indicatorsItem;
};
