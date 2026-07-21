import type {
  HabitAnalysisData,
  SleepPreparationResp,
  SleepRhythmResp,
  SleepRecoveryResp,
  getSleepActivationResp,
  SittingRiskResp,
  ActivityIntensityResp,
  RegularityResp,
  HealthReportResp,
  reportParams
} from '@/types/api/healthSummary';
import type { HttpRequestConfig } from '@/uni_modules/uv-ui-tools/libs/luch-request/index';
// 获取健康页信息
export const getHealthSummary = (params: any = {}, config: HttpRequestConfig = {}): Promise<HabitAnalysisData> => {
  return (uni as any).$uv.http.get('/app/health/index', { params, ...config });
};
// 睡前准备详情
export const getSleepPreparationDetail = (params: any = {}, config: HttpRequestConfig = {}): Promise<SleepPreparationResp> => {
  return (uni as any).$uv.http.get('/app/health/sleep/preparation', { params, ...config });
};
// 睡眠节律
export const getSleepRhythmDetail = (params: any = {}, config: HttpRequestConfig = {}): Promise<SleepRhythmResp> => {
  return (uni as any).$uv.http.get('/app/health/sleep/rhythm', { params, ...config });
};
// 睡眠过程恢复
export const getSleepRecoveryDetail = (params: any = {}, config: HttpRequestConfig = {}): Promise<SleepRecoveryResp> => {
  return (uni as any).$uv.http.get('/app/health/sleep/recovery', { params, ...config });
};
// 睡眠激活
export const getSleepActivationDetail = (params: any = {}, config: HttpRequestConfig = {}): Promise<getSleepActivationResp> => {
  return (uni as any).$uv.http.get('/app/health/sleep/activation', { params, ...config });
};

// 久坐风险
export const getSittingRiskDetail = (params: any = {}, config: HttpRequestConfig = {}): Promise<SittingRiskResp> => {
  return (uni as any).$uv.http.get('/app/health/activity/sedentary', { params, ...config });
};
// 活动强度
export const getActivityIntensityDetail = (params: any = {}, config: HttpRequestConfig = {}): Promise<ActivityIntensityResp> => {
  return (uni as any).$uv.http.get('/app/health/activity/intensity', { params, ...config });
};
// 运动规律性
export const getActivityRegularityDetail = (params: any = {}, config: HttpRequestConfig = {}): Promise<RegularityResp> => {
  return (uni as any).$uv.http.get('/app/health/activity/regularity', { params, ...config });
};
// 健康检测报告
export const getHealthReportDetail = (params: reportParams, config: HttpRequestConfig = {}): Promise<HealthReportResp> => {
  return (uni as any).$uv.http.get('/app/health/report', { params, ...config });
};
