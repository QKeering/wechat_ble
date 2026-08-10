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
import type { RingRawHistoryFrame } from '@/api/ringDevice';
import { getFullUrl } from '@/utils/utils.js';
// 钃濈墮娴嬮噺瀹屾彁浜ゆ暟鎹帴鍙?
type SubmitDataRequestConfig = HttpRequestConfig & {
  timeout?: number;
  header?: Record<string, string>;
  headers?: Record<string, string>;
  custom?: Record<string, any>;
  getTask?: (task: { abort?: () => void } | null) => void;
  onTiming?: (phase: string, detail: Record<string, unknown>) => void;
};

const DATA_SYNC_URL = '/app/data/sync';

const parseSubmitDataBody = (value: unknown) => {
  if (typeof value !== 'string') return value as any;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const readSubmitDataToken = () => {
  try {
    return String(uni.getStorageSync?.('token') || '').trim();
  } catch {
    return '';
  }
};

const buildSubmitDataHeaders = (config: SubmitDataRequestConfig = {}) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((config as any).header || {}),
    ...((config as any).headers || {})
  };
  const token = readSubmitDataToken();
  if (token && config.custom?.auth !== false) {
    headers.Authorization = token;
    headers.token = token;
  }
  return headers;
};

const buildSubmitDataError = (payload: Record<string, any>) => ({
  code: payload.code,
  msg: payload.msg || payload.rawMsg || payload.errMsg || 'data sync request failed',
  rawMsg: payload.rawMsg || payload.msg || payload.errMsg || '',
  result: payload.result,
  url: DATA_SYNC_URL,
  statusCode: payload.statusCode,
  response: payload.response
});

export const submitData = (params: submitDataType, config: SubmitDataRequestConfig = {}) => {
  return new Promise((resolve, reject) => {
    const timeout = Number(config.timeout || 10000);
    let requestTask: { abort?: () => void } | null = null;
    const requestStartedAt = Date.now();
    let successCallbackAt = 0;
    let failCallbackAt = 0;
    const notifyTiming = (phase: string, detail: Record<string, unknown> = {}) => {
      try {
        config.onTiming?.(phase, {
          ...detail,
          elapsedMs: Date.now() - requestStartedAt,
          timeout
        });
      } catch {
        // Timing diagnostics must never affect the upload request.
      }
    };

    notifyTiming('before-request', {
      url: DATA_SYNC_URL,
      method: 'POST',
      dataCount: Array.isArray((params as any)?.dataList) ? (params as any).dataList.length : undefined
    });
    requestTask = uni.request({
      url: getFullUrl(DATA_SYNC_URL),
      method: 'POST',
      data: params,
      timeout,
      header: buildSubmitDataHeaders(config),
      success: (response: any) => {
        successCallbackAt = Date.now();
        const statusCode = Number(response?.statusCode || 0);
        const body = parseSubmitDataBody(response?.data);
        const bodyObject = body && typeof body === 'object' ? (body as Record<string, any>) : {};
        const codeValue = bodyObject.code ?? bodyObject.statusCode;
        const code = Number(codeValue);
        const msg = String(bodyObject.msg ?? bodyObject.message ?? '');
        const result = Object.prototype.hasOwnProperty.call(bodyObject, 'data') ? bodyObject.data : body;
        const httpOk = statusCode >= 200 && statusCode < 300;
        const businessOk = Number.isFinite(code) ? code === 0 || code === 200 : httpOk;
        notifyTiming('success-callback', {
          statusCode,
          code: Number.isFinite(code) ? code : undefined,
          businessOk,
          httpOk
        });

        if (httpOk && businessOk) {
          if (config.custom?.returnAll) {
            resolve({
              code: Number.isFinite(code) ? code : statusCode,
              msg,
              data: result,
              originalResponse: response
            });
          } else {
            resolve(result);
          }
          return;
        }

        reject(
          buildSubmitDataError({
            code: Number.isFinite(code) ? code : statusCode,
            msg: msg || `HTTP ${statusCode}`,
            rawMsg: msg,
            result,
            statusCode,
            response
          })
        );
      },
      fail: (error: any) => {
        failCallbackAt = Date.now();
        notifyTiming('fail-callback', {
          errCode: error?.errCode,
          errMsg: error?.errMsg || error?.message
        });
        reject(
          buildSubmitDataError({
            code: error?.errCode,
            msg: error?.errMsg || error?.message,
            rawMsg: error?.errMsg || error?.message,
            result: error,
            response: error
          })
        );
      },
      complete: (response: any) => {
        notifyTiming('complete-callback', {
          statusCode: response?.statusCode,
          errCode: response?.errCode,
          errMsg: response?.errMsg,
          afterSuccessMs: successCallbackAt > 0 ? Date.now() - successCallbackAt : undefined,
          afterFailMs: failCallbackAt > 0 ? Date.now() - failCallbackAt : undefined
        });
      }
    } as any) as any;

    notifyTiming('request-task-created', {
      hasAbort: typeof requestTask?.abort === 'function'
    });
    config.getTask?.(requestTask);
  });
};

export type RingHistoryRawFramesSubmitParams = {
  deviceMac: string;
  uploadSessionId?: string;
  bindingId?: string | number;
  bindingVersion?: string;
  dataUserId?: string | number;
  protocol?: string;
  frames: RingRawHistoryFrame[];
};

const buildSilentRawUploadConfig = (config: HttpRequestConfig = {}): HttpRequestConfig => ({
  ...config,
  timeout: Number((config as any).timeout || 8000),
  custom: {
    toast: false,
    catch: true,
    ...((config as any).custom || {})
  }
});

const isRawEnqueueUnsupportedResponse = (response: unknown) => {
  const payload = response as { code?: unknown; statusCode?: unknown; data?: { code?: unknown; statusCode?: unknown } };
  const code = Number(payload?.code ?? payload?.statusCode ?? payload?.data?.code ?? payload?.data?.statusCode);
  return code === 404 || code === 405;
};

export const submitRingHistoryRawFrames = async (
  params: RingHistoryRawFramesSubmitParams,
  config: HttpRequestConfig = {}
) => {
  const requestConfig = buildSilentRawUploadConfig(config);
  try {
    const response = await (uni as any).$uv.http.post('/app/data/rawHistory/enqueue', params, requestConfig);
    if (isRawEnqueueUnsupportedResponse(response)) {
      throw new Error('raw enqueue api unsupported');
    }
    return response;
  } catch (error) {
    return (uni as any).$uv.http.post('/app/data/rawHistory/upload', params, requestConfig);
  }
};

export type RingHistoryRawRepairParams = {
  deviceMac: string;
  date?: string;
  recordDate?: string;
  clearExisting?: boolean;
};

export const repairRingHistoryRawToday = (params: RingHistoryRawRepairParams, config = {}) => {
  return (uni as any).$uv.http.post('/app/data/rawHistory/repairToday', params, config);
};

type GirlHealthSubmitParams = {
  birthday: string;         // 鍑虹敓鏃ユ湡 yyyy-MM-dd
  cycleDay: number;         // 骞冲潎鐢熺悊鍛ㄦ湡澶╂暟
  menstruationDay: number;  // 缁忔湡鎸佺画澶╂暟
  lastMenstruationDate: string; // 鏈€杩戜竴娆℃湀缁忓紑濮嬫棩鏈?yyyy-MM-dd
  cycleRegularity: string;  // 鍛ㄦ湡瑙勫緥锛歷ery_regular/regular/fairly_regular/irregular
  healthConditions: string; // 鍋ュ悍鎯呭喌锛屽閫夐€楀彿鎷兼帴
  userId?: number | string;
  id?: number;
};

type LegacyGirlHealthSubmitParams = Partial<GirlHealthSubmitParams> & {
  birthDay?: string;
  periodCycle?: number | string;
  periodRuntime?: number | string;
  lastPeriodTime?: string | string[];
  lastPeriodTimePoint?: string;
  isRuleType?: string;
  otherUnhealth?: string;
};

type GirlHealthSubmitCompatParams = GirlHealthSubmitParams & {
  birthDay: string;
  periodCycle: number;
  periodRuntime: number;
  lastPeriodTime: string[];
  lastPeriodTimePoint: string;
  isRuleType: string;
  otherUnhealth: string;
};

const normalizeGirlHealthDateList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return normalizeGirlHealthDateList(parsed);
    } catch {
      // 鍏煎闈炴爣鍑嗘暟缁勫瓧绗︿覆锛岀户缁蛋鍒嗛殧绗﹁В鏋愩€?
    }
  }
  return text
    .split(/[,锛孿s]+/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
};

const normalizeGirlHealthSubmitParams = (params: LegacyGirlHealthSubmitParams): GirlHealthSubmitCompatParams => {
  const lastPeriodTime = params.lastPeriodTime;
  const legacyDateList = normalizeGirlHealthDateList(lastPeriodTime);
  const lastMenstruationDate = params.lastMenstruationDate || legacyDateList[0] || '';
  const periodDateList = legacyDateList.length ? legacyDateList : normalizeGirlHealthDateList(lastMenstruationDate);
  const birthday = params.birthday || params.birthDay || '';
  const cycleDay = Number(params.cycleDay ?? params.periodCycle ?? 0);
  const menstruationDay = Number(params.menstruationDay ?? params.periodRuntime ?? 0);
  const cycleRegularity = params.cycleRegularity || params.isRuleType || '';
  const healthConditions = params.healthConditions || params.otherUnhealth || '';
  return {
    birthday,
    cycleDay,
    menstruationDay,
    lastMenstruationDate,
    cycleRegularity,
    healthConditions,
    // 鍏煎褰撳墠 FastAPI/鏃?Java 鍚庣琛ㄥ瓧娈碉細user_girl_health 浠嶈惤 birth_day銆乸eriod_cycle銆乸eriod_runtime銆乴ast_period_time銆?
    birthDay: birthday,
    periodCycle: cycleDay,
    periodRuntime: menstruationDay,
    lastPeriodTime: periodDateList,
    lastPeriodTimePoint: lastMenstruationDate,
    isRuleType: cycleRegularity,
    otherUnhealth: healthConditions,
    userId: params.userId,
    id: params.id
  };
};

// 鎻愪氦鐢熺悊鏈熼棶鍗?
export const addGirlHealth = (params: LegacyGirlHealthSubmitParams, config = {}) => {
  return (uni as any).$uv.http.post('/app/girlHealth/addGirlHealth', normalizeGirlHealthSubmitParams(params), config);
};

// 鎻愪氦鐢熺悊鏈熼棶鍗?
export const updateGirlHealth = (params: LegacyGirlHealthSubmitParams & { id: number }, config = {}) => {
  return (uni as any).$uv.http.post('/app/girlHealth/updateGirlHealth', normalizeGirlHealthSubmitParams(params), config);
};
// 鑾峰彇韬績骞宠　璇勫垎
export const getBalanceScore = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<balanceScoreType> => {
  return (uni as any).$uv.http.get('/app/data/balanceScore', { params, ...config });
};
// 鑾峰彇鐢熷懡鐗瑰緛
export const getVitalSign = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<vitalSignType> => {
  return (uni as any).$uv.http.get('/app/data/vitalSign', { params, ...config });
};
// 鑾峰彇蹇冪巼璇︽儏
export const getHeartRateDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/heartRate/heartRateDetail', { params, ...config });
};
// 鑾峰彇蹇冪巼鍙樺紓鎬?
export const getHrvDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/hrv/hrvDetail', { params, ...config });
};
// 鑾峰彇琛€姘ц鎯?
export const getBloodOxygenDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/bloodOxygen/bloodOxygenDetail', { params, ...config });
};
// 鑾峰彇浣撴俯璇︽儏
export const getBodyTemperatureDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/bodyTemperature/bodyTemperatureDetail', { params, ...config });
};
// 鑾峰彇鐫＄湢鎬昏淇℃伅
export const getSleepOverview = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepOverview> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepOverview', { params, ...config });
};
// 鑾峰彇鐫＄湢璇︽儏
export const getSleepDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<sleepDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepDetail', { params, ...config });
};
// 鑾峰彇鐫＄湢璇︽儏-蹇冪巼璇︽儏
export const getSleepHeartRateDetail = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/heartRateDetail', { params, ...config });
};
// 鑾峰彇鐫＄湢璇︽儏-蹇冪巼鍙樺紓鎬ц鎯?
export const getSleepHrvDetail = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/hrvDetail', { params, ...config });
};
// 鑾峰彇鐫＄湢璇︽儏-琛€姘ц鎯?
export const getSleepBloodOxygenDetail = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<heartRateDetail> => {
  return (uni as any).$uv.http.get('/app/data/sleep/bloodOxygenDetail', { params, ...config });
};

// 鑾峰彇鐫＄湢鍖洪棿
export const getSleepSegment = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepSegment> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepSegment', { params, ...config });
};
// 鑾峰彇灏忕潯鍒楄〃
export const getSleepNap = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepNapType[]> => {
  return (uni as any).$uv.http.get('/app/data/sleep/napList', { params, ...config });
};
// 娣诲姞灏忕潯
export const addSleepNap = (params: addSleepNapType, config = {}) => {
  return (uni as any).$uv.http.post('/app/data/sleep/addNap', params, config);
};
//鍒犻櫎灏忕潯
export const deleteSleepNap = (params: { id?: number }, config = {}) => {
  return (uni as any).$uv.http.delete(`/app/data/sleep/deleteNap?id=${params.id}`, {}, config);
};
//鐫＄湢娲诲姩鎬荤粨
export const getsleepSummary = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<sleepSummaryData> => {
  return (uni as any).$uv.http.get('/app/data/sleep/sleepSummary', { params, ...config });
};
// 鑾峰彇娲诲姩姒傝
export const getMotionOverview = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionOverview> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionOverview', { params, ...config });
};
// 鑾峰彇娲诲姩鍗?
export const getMotionCalorie = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionCalorie> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionCalorie', { params, ...config });
};
// 鑾峰彇鍏ㄥぉ娲诲姩寮哄害
export const getMotionIntensity = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionIntensity> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionIntensity', { params, ...config });
};
// 鑾峰彇娲诲姩璇︽儏
export const getMotionDetail = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<motionDetail> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionDetail', { params, ...config });
};
// 鑾峰彇娲诲姩鎬荤粨
export const getMotionSummary = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<motionSummary> => {
  return (uni as any).$uv.http.get('/app/data/motion/motionSummary', { params, ...config });
};
// 鑾峰彇鍘嬪姏璇︽儏
export const getStressData = (params: heartRateGetParams, config: HttpRequestConfig = {}): Promise<stressDetail> => {
  return (uni as any).$uv.http.get('/app/data/stress/stressDetail', { params, ...config });
};
// 鑾峰彇鍘嬪姏姣斾緥
export const getStressProportion = (params: { date?: string }, config: HttpRequestConfig = {}): Promise<stressProportion> => {
  return (uni as any).$uv.http.get('/app/data/stress/stressProportion', { params, ...config });
};
// 鑾峰彇鍘嬪姏鎬荤粨
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
