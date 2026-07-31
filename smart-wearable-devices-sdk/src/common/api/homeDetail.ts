import type {
  submitDataType,
  heartRateDetail,
  heartRateGetParams,
  sleepOverview,
  sleepDetail,
  sleepSegment,
  sleepNapType,
  addSleepNapType,
  sleepSummaryData,
  motionOverview,
  motionCalorie,
  motionIntensity,
  motionSummary,
  stressDetail,
  stressProportion,
  stressSummaryType,
  vitalSignType,
  balanceScoreType,
  motionDetail,
  HealthTempStatItem,
  UserGirlHealthAllResponse
} from '@/types/api/homeDetail';
import type { HttpRequestConfig } from '@/uni_modules/uv-ui-tools/libs/luch-request/index';
// 蓝牙测量完提交数据接口
export const submitData = (params: submitDataType, config = {}) => {
  return (uni as any).$uv.http.post('/app/data/sync', params, config);
};

type GirlHealthSubmitParams = {
  birthday: string;         // 出生日期 yyyy-MM-dd
  cycleDay: number;         // 平均生理周期天数
  menstruationDay: number;  // 经期持续天数
  lastMenstruationDate: string; // 最近一次月经开始日期 yyyy-MM-dd
  cycleRegularity: string;  // 周期规律：very_regular/regular/fairly_regular/irregular
  healthConditions: string; // 健康情况，多选逗号拼接
  userId?: number | string;
  id?: number;
};

type LegacyGirlHealthSubmitParams = Partial<GirlHealthSubmitParams> & {
  birthDay?: string;
  periodCycle?: number | string;
  periodRuntime?: number | string;
  lastPeriodTime?: string | string[];
  isRuleType?: string;
  otherUnhealth?: string;
};

const normalizeGirlHealthSubmitParams = (params: LegacyGirlHealthSubmitParams): GirlHealthSubmitParams => {
  const lastPeriodTime = params.lastPeriodTime;
  const legacyLastDate = Array.isArray(lastPeriodTime)
    ? String(lastPeriodTime[0] || '')
    : String(lastPeriodTime || '').split(',').map((item) => item.trim()).filter(Boolean)[0] || '';
  return {
    birthday: params.birthday || params.birthDay || '',
    cycleDay: Number(params.cycleDay ?? params.periodCycle ?? 0),
    menstruationDay: Number(params.menstruationDay ?? params.periodRuntime ?? 0),
    lastMenstruationDate: params.lastMenstruationDate || legacyLastDate,
    cycleRegularity: params.cycleRegularity || params.isRuleType || '',
    healthConditions: params.healthConditions || params.otherUnhealth || '',
    userId: params.userId,
    id: params.id
  };
};

// 提交生理期问卷
export const addGirlHealth = (params: LegacyGirlHealthSubmitParams, config = {}) => {
  return (uni as any).$uv.http.post('/app/girlHealth/addGirlHealth', normalizeGirlHealthSubmitParams(params), config);
};

// 提交生理期问卷
export const updateGirlHealth = (params: LegacyGirlHealthSubmitParams & { id: number }, config = {}) => {
  return (uni as any).$uv.http.post('/app/girlHealth/updateGirlHealth', normalizeGirlHealthSubmitParams(params), config);
};
// 获取身心平衡评分
export const getBalanceScore = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<balanceScoreType> => {
  return (uni as any).$uv.http.get('/app/data/balanceScore', { params, ...config });
};
// 获取生命特征
export const getVitalSign = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<vitalSignType> => {
  return (uni as any).$uv.http.get('/app/data/vitalSign', { params, ...config });
};
// 获取心率详情
export const getHeartRateDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/heartRate/heartRateDetail', { params, ...config });
};
// 获取心率变异性
export const getHrvDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/hrv/hrvDetail', { params, ...config });
};
// 获取血氧详情
export const getBloodOxygenDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/bloodOxygen/bloodOxygenDetail', { params, ...config });
};
// 获取体温详情
export const getBodyTemperatureDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/bodyTemperature/bodyTemperatureDetail', { params, ...config });
};
// 获取睡眠总览信息
export const getSleepOverview = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepOverview> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepOverview', { params, ...config });
};
// 获取睡眠详情
export const getSleepDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<sleepDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepDetail', { params, ...config });
};
// 获取睡眠详情-心率详情
export const getSleepHeartRateDetail = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/heartRateDetail', { params, ...config });
};
// 获取睡眠详情-心率变异性详情
export const getSleepHrvDetail = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/hrvDetail', { params, ...config });
};
// 获取睡眠详情-血氧详情
export const getSleepBloodOxygenDetail = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/bloodOxygenDetail', { params, ...config });
};

// 获取睡眠区间
export const getSleepSegment = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepSegment> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepSegment', { params, ...config });
};
// 获取小睡列表
export const getSleepNap = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepNapType[]> => {
  return (uni as any).$uv.http.get('/app/data/sleep/napList', { params, ...config });
};
// 添加小睡
export const addSleepNap = (params: addSleepNapType, config = {}) => {
  return (uni as any).$uv.http.post('/app/data/sleep/addNap', params, config);
};
//删除小睡
export const deleteSleepNap = (params: { id?: number }, config = {}) => {
  return (uni as any).$uv.http.delete(`/app/data/sleep/deleteNap?id=${params.id}`, {}, config);
};
//睡眠活动总结
export const getsleepSummary = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepSummaryData> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepSummary', { params, ...config });
};
// 获取活动概览
export const getMotionOverview = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionOverview> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionOverview', { params, ...config });
};
// 获取活动卡
export const getMotionCalorie = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionCalorie> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionCalorie', { params, ...config });
};
// 获取全天活动强度
export const getMotionIntensity = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionIntensity> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionIntensity', { params, ...config });
};
// 获取活动详情
export const getMotionDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<motionDetail> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionDetail', { params, ...config });
};
// 获取活动总结
export const getMotionSummary = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionSummary> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionSummary', { params, ...config });
};
// 获取压力详情
export const getStressData = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<stressDetail> => {
  return (uni as any).$uv.http.get('/app/data/stress/stressDetail', { params, ...config });
};
// 获取压力比例
export const getStressProportion = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<stressProportion> => {
  return (uni as any).$uv.http.get('/app/data/stress/stressProportion', { params, ...config });
};
// 获取压力总结
export const getStressSummary = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<stressSummaryType> => {
  return (uni as any).$uv.http.get('/app/data/stress/stressSummary', { params, ...config });
};
export const getSystemUnhealthDict =(params: { date?: string }, config: HttpRequestConfig = {}): Promise<stressSummaryType> => {
  return (uni as any).$uv.http.get('/app/system/dict/data/type/other_unhealth', { params, ...config });
};
export const getSystemRuleTypeDict =(params: { date?: string }, config: HttpRequestConfig = {}): Promise<stressSummaryType> => {
  return (uni as any).$uv.http.get('/app/system/dict/data/type/is_rule_type', { params, ...config });
};
export const getGirlHealth=(params: { date?: string }, config: HttpRequestConfig = {}): Promise<stressSummaryType> => {
  return (uni as any).$uv.http.get('/app/girlHealth/getGirlHealth', { params, ...config });
};
export const getUserIsOpenCard =(params: { cardGroup?: string }, config: HttpRequestConfig = {}): Promise<stressSummaryType> => {
  return (uni as any).$uv.http.get('/app/user/cardConfig/getCardConfig?cardGroup=girlHealth', { params, ...config });
};
export const getUserGirlHealthAll = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<UserGirlHealthAllResponse> => {
  return (uni as any).$uv.http.get('/app/girlHealth/getUserGirlHealthAll', { params, ...config });
};
export const getHealthTempStats = (
  params: { newDate?: string },
  config: HttpRequestConfig = {}
): Promise<HealthTempStatItem[]> => {
  return (uni as any).$uv.http.get('/app/girlHealth/getHealthTempStats', { params, ...config });
};
