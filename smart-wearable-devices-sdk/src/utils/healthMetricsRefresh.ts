import { finalizeDataSyncSummary } from '@/common/api/homeDetail';

/**
 * 前台测量（心率/血氧/体温/HRV）完成后，后端只把明细写入 health_raw，
 * 日汇总（首页概览、详情页分数）由后台任务异步重算；测量页紧接着跳转详情/返回首页，
 * 读到的仍是旧汇总。这里用一条跨页标记 + 汇总 finalize 把"刚测完"这件事显式广播出去，
 * 首页/生命体征页看到标记后强制刷新，绕过 5 分钟 onShow 去重。
 */
export const HEALTH_METRICS_RECORDED_EVENT = 'health-metrics-recorded';

const HEALTH_METRICS_RECORDED_STORAGE_KEY = 'qkeer_health_metrics_recorded_at';
// 汇总 finalize 完成的独立标记：详情页可能在该事件前就已 onLoad，
// 用时间戳兜底判断"首屏请求是否早于汇总就绪"。
const HEALTH_SUMMARY_READY_STORAGE_KEY = 'qkeer_health_summary_ready_at';
// 标记只用于"刚测完"的短窗口；过期标记不应长期压过首页自身的刷新去重。
const HEALTH_METRICS_RECORDED_FRESH_MS = 10 * 60 * 1000;
const SUMMARY_FINALIZE_RETRY_DELAYS_MS = [0, 1200, 2500] as const;
const SUMMARY_FINALIZE_TIMEOUT_MS = 12000;

export type HealthMetricsRecordedPayload = {
  at: number;
  metric?: string;
  deviceMac?: string;
  recordTime?: string;
  summaryReady?: boolean;
};

type HealthMetricsRecordedInput = Omit<HealthMetricsRecordedPayload, 'at'>;

const unwrapSummaryResponse = (response: unknown): Record<string, any> | null => {
  if (response == null || typeof response !== 'object') return null;
  let payload = response as Record<string, any>;
  // common HTTP 客户端可能保留一层/两层 { data: ... } 信封。
  for (let depth = 0; depth < 3; depth += 1) {
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) break;
    payload = payload.data as Record<string, any>;
  }
  return payload;
};

export const markHealthMetricsRecorded = (payload: HealthMetricsRecordedInput = {}) => {
  const at = Date.now();
  try {
    uni.setStorageSync(HEALTH_METRICS_RECORDED_STORAGE_KEY, at);
    if (payload.summaryReady === true) {
      uni.setStorageSync(HEALTH_SUMMARY_READY_STORAGE_KEY, at);
    }
  } catch {
    // 存储失败不影响页面内的事件广播。
  }
  try {
    uni.$emit(HEALTH_METRICS_RECORDED_EVENT, { at, ...payload } satisfies HealthMetricsRecordedPayload);
  } catch {
    // 没有订阅者时忽略。
  }
  return at;
};

const readFreshTimestamp = (key: string) => {
  try {
    const at = Number(uni.getStorageSync(key) || 0);
    if (!Number.isFinite(at) || at <= 0) return 0;
    return Date.now() - at <= HEALTH_METRICS_RECORDED_FRESH_MS ? at : 0;
  } catch {
    return 0;
  }
};

export const readHealthMetricsRecordedAt = () => readFreshTimestamp(HEALTH_METRICS_RECORDED_STORAGE_KEY);

export const readHealthSummaryReadyAt = () => readFreshTimestamp(HEALTH_SUMMARY_READY_STORAGE_KEY);

/**
 * 让后端在返回前完成当日汇总重算，避免首页/详情页读到旧分数。
 * 失败只做有限重试：测量数据本身已经提交成功，汇总失败时仍保留标记，
 * 首页下一次 onShow 会再尝试刷新。
 */
export const finalizeHealthSummaryAfterMeasurement = async (options: { date: string; metric?: string; deviceMac?: string }) => {
  const date = String(options.date || '')
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

  for (const delay of SUMMARY_FINALIZE_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    try {
      const response = await finalizeDataSyncSummary(
        { deviceMac: options.deviceMac || undefined, dates: [date] },
        { timeout: SUMMARY_FINALIZE_TIMEOUT_MS, custom: { toast: false, catch: true } }
      );
      if (unwrapSummaryResponse(response)?.summaryReady === true) {
        // 汇总就绪后再广播一次：即便首页已经因第一条标记刷新过（当时汇总还没好），
        // 现在也能拿到一致的数据。
        markHealthMetricsRecorded({
          metric: options.metric,
          deviceMac: options.deviceMac,
          summaryReady: true
        });
        return true;
      }
    } catch {
      // 继续下一轮重试。
    }
  }
  return false;
};

/** 测量数据提交成功后调用：立即广播标记，并异步补齐后端汇总。 */
export const notifyMeasurementSubmitted = (options: { recordTime: string; metric: string; deviceMac?: string }) => {
  const recordTime = String(options.recordTime || '').trim();
  markHealthMetricsRecorded({
    metric: options.metric,
    deviceMac: options.deviceMac,
    recordTime
  });
  const date = recordTime.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  void finalizeHealthSummaryAfterMeasurement({
    date,
    metric: options.metric,
    deviceMac: options.deviceMac
  });
};
