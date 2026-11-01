import type { Ref } from 'vue';
import { formatLocalDate } from '@/utils/utils.js';
import { HEALTH_METRICS_RECORDED_EVENT, readHealthSummaryReadyAt, type HealthMetricsRecordedPayload } from '@/utils/healthMetricsRefresh';

type VitalDetailSummaryRefreshOptions = {
  currentDate: Ref<Date>;
  currentName: Ref<string>;
  reload: () => Promise<unknown>;
};

/**
 * 详情页首屏只请求一次，而当日汇总是后端异步重算的。
 * 测量页在汇总 finalize 完成后会广播 HEALTH_METRICS_RECORDED_EVENT（summaryReady），
 * 这里据此补拉一次当日（'day'）详情，让健康分/等级描述不再是旧值。
 * 事件可能早于详情页 onLoad 注册监听器，因此额外用时间戳兜底。
 */
export const useVitalDetailSummaryRefresh = (options: VitalDetailSummaryRefreshOptions) => {
  let reloading = false;

  const runReload = async () => {
    if (options.currentName.value !== 'day') return;
    if (formatLocalDate(options.currentDate.value) !== formatLocalDate(new Date())) return;
    if (reloading) return;
    reloading = true;
    try {
      await options.reload();
    } catch {
      // 详情页已有自己的错误提示，这里只是补拉。
    } finally {
      reloading = false;
    }
  };

  const handleHealthMetricsRecorded = (payload?: HealthMetricsRecordedPayload) => {
    if (payload?.summaryReady !== true) return;
    void runReload();
  };

  const register = () => {
    uni.$off(HEALTH_METRICS_RECORDED_EVENT, handleHealthMetricsRecorded);
    uni.$on(HEALTH_METRICS_RECORDED_EVENT, handleHealthMetricsRecorded);
  };

  const unregister = () => {
    uni.$off(HEALTH_METRICS_RECORDED_EVENT, handleHealthMetricsRecorded);
  };

  /** 首屏请求开始时间早于汇总就绪时间时补拉一次（事件可能已被错过）。 */
  const refreshIfSummaryBecameReady = (loadStartedAt: number) => {
    const readyAt = readHealthSummaryReadyAt();
    if (readyAt > 0 && readyAt > loadStartedAt) {
      void runReload();
    }
  };

  return { register, unregister, refreshIfSummaryBecameReady };
};
