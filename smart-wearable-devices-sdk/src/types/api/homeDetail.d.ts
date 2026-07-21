// 获取心率详情参数
export type heartRateGetParams = {
  type?: string; // 查询类型（hour/day）
  date?: string; // 基准日期（@date 对应 string 格式，如 'YYYY-MM-DD'）
  offset?: number; // 偏移量
};
// 图表数据点
export type Point = {
  time?: string; // 时间点（@date 对应 string 格式，如 'YYYY-MM-DD HH:mm:ss'）
  value?: string; // 心率值（integer 对应 ts 中的 number）
};
export type SyncData = {
  // 记录时间（日期时间格式）
  recordTime: string;
  // 累计步数
  stepCount?: number;
  // 心率值
  heartRate?: number;
  // 血氧
  spo2?: number;
  // 心率变异性
  hrv?: number;
  // 压力指数
  stress?: number;
  // 体温
  temperature?: number;
  // RW blood sugar
  bloodSugar?: number;
  // RW blood pressure systolic
  systolic?: number;
  // RW blood pressure diastolic
  diastolic?: number;
  // 睡眠状态：0无效 1清醒 2快速眼动 3浅睡 4深睡 5小睡
  sleepState?: string | number;
  // 睡眠时长，单位分钟
  sleepDuration?: number;
  // 活动强度：0运动 1静止
  motionIntensity?: number;
  // 灌注率
  perfusionIndex?: number;
  // RR间期数组（JSON字符串格式）
  rrintervals?: string;
  rrIntervals?: string;
};
// 添加小睡参数
export type submitDataType = {
  // 设备MAC（必填）
  deviceMac: string;
  // 设备电量
  battery?: number;
  // 数据列表（必填）
  dataList: SyncData[];
};

export type HealthTempStatItem = any;

export type UserGirlHealthAllResponse = any;
// 获取生命特征
export type vitalSignType = {
  overallScore?: number; // 综合评分（integer 对应 ts 中的 number）
  heartRate?: number; // 心率（integer 对应 ts 中的 number）
  spo2?: number; // 血氧（integer 对应 ts 中的 number）
  heartRateChart?: Point[]; // 心率图表数据（数组项为 Point 类型）
  bloodSugar?: number;
  heartRateAvg?: number;
  hrv?: number;
  hrvAvg?: number;
  hrvMin?: number;
  hrvMax?: number;
  hrvChart?: Point[];
  spo2Avg?: number;
  temperatureAvg?: number;
  stressAvg?: number;
  bloodSugar?: number;
  bloodSugarAvg?: number;
  bloodSugarMin?: number;
  bloodSugarMax?: number;
  bloodSugarChart?: Point[];
  systolic?: number;
  diastolic?: number;
  bloodPressure?: string;
  systolicAvg?: number;
  systolicMin?: number;
  systolicMax?: number;
  diastolicAvg?: number;
  diastolicMin?: number;
  diastolicMax?: number;
  systolicChart?: Point[];
  diastolicChart?: Point[];
};
// 获取身心平衡评分
export type balanceScoreType = {
  overallScore?: number; // 综合评分
  sleepScore?: number; // 睡眠评分
  activityScore?: number; // 活动评分
  relaxScore?: number; // 放松评分
  vitalSignScore?: number; // 生命特征评分
};
// 获取心率详情
export type heartRateDetail = {
  healthScore?: number; // 健康评分（integer 对应 ts 中的 number）
  latestDesc?: string; // 最新描述
  minValue?: string; // 最小值
  maxValue?: string; // 最大值
  avgValue?: string; // 平均值
  avgValueRange?: string; // 平均值范围
  baseValue?: string; // 基准值
  baseValueMax?: string; // 最大基准值
  baseValueMin?: string; // 最小基准值
  diffValue?: string; // 差异值
  type?: string; // 本次查询的类型
  granularity?: string; // 粒度：hour/day
  startDate?: string; // 开始日期（@date 对应 string 格式，如 'YYYY-MM-DD'）
  endDate?: string; // 结束日期
  chartData?: Point[]; // 图表数据（数组项为 Point 类型）
  newValue?: string; // 新值
};
// 获取睡眠总览信息
export type sleepOverview = {
  sleepDuration?: string; // 睡眠时长
  sleepQuality?: string; // 睡眠质量
  sleepScore?: number; // 睡眠评分
  awakeCount?: number; // 清醒次数
};

// 获取睡眠详情
export type sleepDetail = {
  healthScore?: number; // 健康评分（integer 对应 ts 中的 number）
  latestDesc?: string; // 最新描述
  sleepDuration?: number; // 睡眠时长
  type?: string; // 本次查询的类型
  startDate?: string; // 开始日期（@date 对应 string 格式，如 'YYYY-MM-DD'）
  endDate?: string; // 结束日期
  chartData?: Point[]; // 图表数据（数组项为 Point 类型）
};
// 获取睡眠区间
export type sleepSegment = {
  startTime?: string; // 开始时间（@date 对应 string 格式，如 'YYYY-MM-DD HH:mm:ss'）
  endTime?: string; // 结束时间（@date 对应 string 格式，如 'YYYY-MM-DD HH:mm:ss'）
  chartData?: Point[]; // 睡眠图表数据
  chartDataSection?: Point[]; // 睡眠区间数据
};
// 获取 naps 列表
export type sleepNapType = {
  id?: number; // integer(int64)
  userId?: number; // 用户Id
  dateRef?: string; // 归属日期
  type?: string; // 睡眠类型
  startTime?: string; // 开始时间
  endTime?: string; // 结束时间
  sleepTime?: number; // 睡眠时长
};
// 添加小睡参数
export type addSleepNapType = {
  date?: string; // 归属日期
  startTime?: string; // 开始时间
  endTime?: string; // 结束时间
};
// 睡眠活动总结
export type sleepSummaryData = {
  sleepMinutes: number; // 睡眠时长，单位：分钟
  avgSleepMinutes7d: number; // 近7天平均睡眠时长，单位：分钟
  bedTime: string; // 卧床时间
  sleepEfficiency: string; // 睡眠效率（必填）
  sleepHeartRate: string; // 睡眠心率
  sleepScore: string; // 睡眠总分
  lastNightSleepMinutes: number; // 昨晚睡眠时长，单位：分钟
};
// 获取活动概览
export type motionOverview = {
  step?: number; // 步数
  calorie?: number; // 消耗卡
  calorieUnit?: string; // 卡单位；后端统一返回“卡”，旧接口缺失时前端兜底
  motionTime?: number; // 运动时长
  targetStep?: number; // 目标步数
  targetCalorie?: number; // 目标卡
  targetMotionTime?: number; // 目标运动时长
};
// 获取活动消耗卡
export type motionCalorie = {
  totalCalorie?: number; // 总消耗卡
  calorieUnit?: string; // 卡单位；后端统一返回“卡”，旧接口缺失时前端兜底
  targetCalorie?: number; // 目标消耗卡
  motionCalorie?: number; // 活动消耗卡（必填）
  basalCalorie?: number; // 基础代谢消耗卡
  motionCalorieChart?: Point[]; // 活动消耗图表（数组，元素为 Point 类型）
  basalCalorieChart?: Point[]; // 基础代谢消耗图表（数组，元素为 Point 类型）
};
// 获取活动强度
export type motionIntensity = {
  motionChart?: Point[]; // 活动分布图表
  motionRatioChart?: Point[]; // 活动强度比例图表
  inactiveDuration?: number; // 不活跃时长（分钟）
  lowIntensityDuration?: number; // 低强度时长（分钟）
  moderateIntensityDuration?: number; // 中等强度时长（分钟）
  highIntensityDuration?: number; // 高强度时长（分钟）
};
// 获取活动详情
export type motionDetail = {
  calorie?: number; // 运动卡
  calorieUnit?: string; // 卡单位
  targetCalorie?: number; // 目标卡
  calorieChart?: Point[]; // 运动卡图表（数组，元素为 Point 类型）
  step?: number; // 步数
  targetStep?: number; // 目标步数
  stepChart?: Point[]; // 步数图表（数组，元素为 Point 类型）
  distance?: string; // 运动里程
  distanceChart?: Point[]; // 运动里程图表（数组，元素为 Point 类型）
};
// 获取活动总结
export type motionSummary = {
  todayStep: number; // 今天的步数
  todayStepChart: Point[]; // 今天的步数图表
  yesterdayStep: number; // 昨天的步数
  yesterdayStepChart: Point[]; // 昨天的步数图表
  motionCalorie: number; // 活动消耗的能量（卡）
  calorieUnit?: string; // 卡单位
  motionTime: number; // 活动时长
  midHighTime: number; // 中高强度活动时长
  motionScore: number; // 活动得分
};
// 获取压力详情
export type stressDetail = {
  stressValue?: number; // 压力值
  stressLevel?: string; // 压力等级
  stressChart?: Point[]; // 压力图表数据（数组项为 Point 类型）
  latestHrvValue?: string; // 最新HRV值
  dailyAvgHrvValue?: string; // 每日平均HRV值
  avgStressValue?: number; // 平均压力值
  stressRange?: string; // 压力范围
};
// 获取压力比例
export type stressProportion = {
  stressDuration?: Point[]; // 压力时长分布图表(分钟)
  stressProportionChart?: Point[]; // 压力比例图表
};
// 获取压力总结
export type stressSummaryType = {
  todayStressChart?: Point[]; // 今天压力图表
  weekStressChart?: Point[]; // 本周压力图表
  todayStressScore?: number; // 今天压力得分
  weekAvgStressScore?: number; // 本周压力得分
  relaxDuration?: number; // 放松时长（分钟）
  normalDuration?: number; // 正常时长（分钟）
  moderateStressDuration?: number; // 中等压力时长（分钟）
  highStressDuration?: number; // 高强度压力时长（分钟）
};
