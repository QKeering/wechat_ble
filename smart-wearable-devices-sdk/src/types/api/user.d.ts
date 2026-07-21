export type UserInfo = {
  id?: number;
  avatar?: string;
  nickName?: string;
  birthday?: string;
  sex?: number;
  height?: number;
  weight?: number;
};

export type UserGoal = {
  id?: number; // 主键id（int64对应TS的number，如需精确值可使用bigint）
  userId?: number; // 用户id（int64）
  sleep?: number; // 睡眠时长（单位未明确，这里用number兼容integer）
  sleepHour?: number; // 睡眠时长（单位小时，number对应原字段的number类型）
  step?: number; // 目标步数
  calorie?: number; // 目标卡路里
  motionTime?: number; // 目标活动时长（单位分钟）,
  acquisitionCycle?: number; // 数据采集周期（单位分钟）
};
