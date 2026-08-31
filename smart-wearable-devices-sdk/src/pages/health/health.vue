<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { onLoad, onPageScroll, onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { getHealthSummary } from '@/common/api/heatlthSummary';
import type { HabitAnalysisData } from '@/types/api/healthSummary';
import { habitOption } from '@/pages/health/echartOptions';
import ScoreProgressBar from '@/components/scoreProgressBar.vue';
import { cloneDeep } from 'lodash-es';
import { useUserStore } from '@/stores/user';
import { useRingStore } from '@/stores';
import { useRingBLE } from '@/composables/useRingBLE';
import { getBindInfo } from '@/common/api/device';
import AiLab from '../awareness/aiLab.vue';
import { formatBleErrorMessage } from '@/utils/bleError';
import { normalizeHealthLevel, normalizeHealthText } from '@/utils/healthText';
import { clearFrontendRingBindingState, hasBoundRingIdentity } from '@/utils/ringBinding';
import { isAnyDeviceSyncSessionRunning } from '@/utils/deviceSyncSession';

const echarts = require('../../static/echarts.min.js');
const userStore = useUserStore();
const ringStore = useRingStore();
const {
  connectedDeviceId,
  deviceInfo: ringDeviceInfo,
  normalMac,
  iosMacId,
  autoConnectLastDevice
} = useRingBLE();
const scrollTop = ref(0);
const getHealthSummaryCacheKey = () => {
  const userInfo = userStore.userInfo || {};
  const userId = String(userInfo.id || (userInfo as any).userId || (userInfo as any).user_id || 'anonymous');
  return `qkeer:health-summary:${userId}`;
};
const readHealthSummaryCache = (): HabitAnalysisData | undefined => {
  try {
    const cached = uni.getStorageSync(getHealthSummaryCacheKey());
    return cached && typeof cached === 'object' ? (cached as HabitAnalysisData) : undefined;
  } catch {
    return undefined;
  }
};
const healthSummary = ref<HabitAnalysisData | undefined>(readHealthSummaryCache());
const chartRef1 = ref<any>(null);
type itemType = {
  name: string;
  score: number;
  level: string;
  path: string;
  type?: string;
  avg?: number | null;
  current?: number | null;
};
const pullDownRefresh = ref(false);
const pullDownProgress = ref(0);
const habitTrendText = computed(() => normalizeHealthText(healthSummary.value?.habitScore?.trend, '--'));
const normalizeIndicatorScore = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return score;
};
const getIndicatorLevel = (current: unknown) => {
  const score = normalizeIndicatorScore(current);
  return score == null ? '--' : normalizeHealthLevel('', score);
};
const sleepIndicators = computed<itemType[]>(() => [
  {
    name: '睡前准备',
    score: healthSummary.value?.sleep?.preparation?.score || 0,
    level: getIndicatorLevel(healthSummary.value?.sleep?.preparation?.current),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sleepPrep',
    avg: normalizeIndicatorScore(healthSummary.value?.sleep?.preparation?.avg),
    current: normalizeIndicatorScore(healthSummary.value?.sleep?.preparation?.current)
  },
  {
    name: '睡眠节律',
    score: healthSummary.value?.sleep?.rhythm?.score || 0,
    level: getIndicatorLevel(healthSummary.value?.sleep?.rhythm?.current),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sleepRhythm',
    avg: normalizeIndicatorScore(healthSummary.value?.sleep?.rhythm?.avg),
    current: normalizeIndicatorScore(healthSummary.value?.sleep?.rhythm?.current)
  },
  {
    name: '睡眠过程恢复',
    score: healthSummary.value?.sleep?.recovery?.score || 0,
    level: getIndicatorLevel(healthSummary.value?.sleep?.recovery?.current),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sleepRecovery',
    avg: normalizeIndicatorScore(healthSummary.value?.sleep?.recovery?.avg),
    current: normalizeIndicatorScore(healthSummary.value?.sleep?.recovery?.current)
  },
  {
    name: '睡眠激活',
    score: healthSummary.value?.sleep?.activation?.score || 0,
    level: getIndicatorLevel(healthSummary.value?.sleep?.activation?.current),
    path: '/pagesA/healths/indicatorDetail',
    type: 'wakeUpBoost',
    avg: normalizeIndicatorScore(healthSummary.value?.sleep?.activation?.avg),
    current: normalizeIndicatorScore(healthSummary.value?.sleep?.activation?.current)
  }
]);

const activityIndicators = computed<itemType[]>(() => [
  {
    name: '久坐风险',
    score: healthSummary.value?.activity?.sedentaryRisk?.score || 0,
    level: getIndicatorLevel(healthSummary.value?.activity?.sedentaryRisk?.current),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sedentaryRisk',
    avg: normalizeIndicatorScore(healthSummary.value?.activity?.sedentaryRisk?.avg),
    current: normalizeIndicatorScore(healthSummary.value?.activity?.sedentaryRisk?.current)
  },
  {
    name: '活动强度',
    score: healthSummary.value?.activity?.activityRisk?.score || 0,
    level: getIndicatorLevel(healthSummary.value?.activity?.activityRisk?.current),
    path: '/pagesA/healths/indicatorDetail',
    type: 'activityIntensity',
    avg: normalizeIndicatorScore(healthSummary.value?.activity?.activityRisk?.avg),
    current: normalizeIndicatorScore(healthSummary.value?.activity?.activityRisk?.current)
  },
  {
    name: '运动规律性',
    score: healthSummary.value?.activity?.exerciseRegularity?.score || 0,
    level: getIndicatorLevel(healthSummary.value?.activity?.exerciseRegularity?.current),
    path: '/pagesA/healths/indicatorDetail',
    type: 'exerciseRegularity',
    avg: normalizeIndicatorScore(healthSummary.value?.activity?.exerciseRegularity?.avg),
    current: normalizeIndicatorScore(healthSummary.value?.activity?.exerciseRegularity?.current)
  }
]);

// 初始化图表
const initHabitChart = async () => {
  if (!chartRef1.value) return;

  try {
    const chart = await chartRef1.value.init(echarts);
    const option = cloneDeep(habitOption);
    option.series[0].data[0].value = healthSummary.value?.habitScore?.score || 0;
    chart.setOption(option);
  } catch (error) {
  }
};
// 跳转详情页
const jumpDetail = (item: itemType) => {
  const params = item.type ? { type: item.type, title: item.name } : undefined;
  (uni as any).$uv.route(item.path, params);
};
const hasRuntimeRingDevice = () =>
  Boolean(
    connectedDeviceId.value ||
      normalMac.value ||
      iosMacId.value ||
      userStore.deviceInfo?.deviceId ||
      userStore.normalMac ||
      userStore.iosMacId
  );
const getHealthPageSyncIdentity = () => {
  const userInfo = userStore.userInfo || {};
  const userId = String(userInfo.id || (userInfo as any).userId || (userInfo as any).user_id || 'anonymous');
  const mac = String(
    normalMac.value ||
      iosMacId.value ||
      (ringDeviceInfo.value as any)?.mac ||
      (ringDeviceInfo.value as any)?.uniMacId ||
      userStore.normalMac ||
      userStore.iosMacId ||
      ''
  );
  return { userId, mac };
};
const isHealthPageDeviceSyncRunning = () => {
  const { userId, mac } = getHealthPageSyncIdentity();
  return isAnyDeviceSyncSessionRunning(userId, mac) || isAnyDeviceSyncSessionRunning(userId);
};
const refreshBoundRingBusinessData = async () => {
  let boundDevice: any = null;
  try {
    boundDevice = await getBindInfo();
  } catch {
    boundDevice = null;
  }

  if (!hasBoundRingIdentity(boundDevice)) return;

  try {
    if (!hasRuntimeRingDevice()) {
      void autoConnectLastDevice().catch(() => {});
    }
  } catch {
  }
};
const loadHealthPageSnapshot = async (options: { waitForRing?: boolean } = {}) => {
  const deviceSyncActive = isHealthPageDeviceSyncRunning();
  // Health data comes from the backend and must remain available while the
  // home page owns BLE. Only suppress the competing BLE restore operation.
  const ringRefresh = deviceSyncActive ? Promise.resolve() : refreshBoundRingBusinessData();
  const summary = await getHealthSummary();
  healthSummary.value = summary;
  try {
    uni.setStorage({
      key: getHealthSummaryCacheKey(),
      data: summary
    });
  } catch {
  }
  if (options.waitForRing) {
    await ringRefresh;
  }
};
const jumpMeasureDetail = async () => {
  let boundDevice: any = null;
  try {
    boundDevice = await getBindInfo();
  } catch {
    boundDevice = null;
  }

  if (!hasBoundRingIdentity(boundDevice)) {
    await clearFrontendRingBindingState(userStore, ringStore);
    uni.showToast({
      title: '请先配对戒指',
      icon: 'none',
      duration: 2000
    });
    return;
  }

  const hasRuntimeDevice = Boolean(
    connectedDeviceId.value ||
      normalMac.value ||
      iosMacId.value ||
      userStore.deviceInfo?.deviceId ||
      userStore.normalMac ||
      userStore.iosMacId
  );
  if (hasRuntimeDevice) {
    (uni as any).$uv.route('/pagesA/healths/deviceData');
    return;
  }

  if (hasBoundRingIdentity(boundDevice)) {
    (uni as any).$uv.route('/pagesA/healths/deviceData');
    return;
  }

  uni.showToast({
    title: '请先配对戒指',
    icon: 'none',
    duration: 2000
  });
  userStore.updateDeviceInfo({});
  userStore.updateReceivedData([]);
};

onLoad(async () => {});
onShow(() => {
  if (!userStore.token) {
    userStore.updateDeviceInfo({});
    userStore.updateReceivedData([]);
    return;
  }
  // Do not make tab activation wait for HTTP, chart work, or the BLE session.
  // Cached content is immediately interactive; a normal idle visit refreshes
  // it in the background. During a device sync we intentionally keep it stable.
  void (async () => {
    pullDownRefresh.value = true;
    pullDownProgress.value = 50;
    try {
      await loadHealthPageSnapshot();
      pullDownProgress.value = 80;
      await initHabitChart();
      pullDownProgress.value = 100;
    } finally {
      pullDownRefresh.value = false;
      pullDownProgress.value = 0;
    }
  })();
});
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
onPullDownRefresh(async () => {
  try {
    pullDownRefresh.value = true;
    pullDownProgress.value = 0; // 重置进度为0
    pullDownProgress.value = 30;
    await loadHealthPageSnapshot({ waitForRing: true });
    pullDownProgress.value = 60;
    await initHabitChart();
    pullDownProgress.value = 80;
    pullDownProgress.value = 100;
  } catch (error) {
    uni.showToast({
      title: formatBleErrorMessage(error, '刷新失败，请稍后再试'),
      icon: 'none',
      duration: 2000
    });
  } finally {
    pullDownRefresh.value = false;
    pullDownProgress.value = 0;
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view style="position: relative">
    <uv-navbar placeholder leftIcon="" title="健康" :bgColor="scrollTop > 0 ? '#f1f3f6' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view style="position: absolute; top: 0; left: 0; width: 100%">
      <uv-image src="/static/images/bg01.png" width="100%" mode="widthFix"></uv-image>
    </view>
    <view class="pt-30 pr-30 pb-100 pl-30 relative" style="z-index: 1; box-sizing: border-box">
      <view class="flex fd-c ai-center">
        <view class="report-period flex fd-c ai-center jc-center">
          <view class="period-date">{{ healthSummary?.dateRange || '00月00号-00月00号' }}</view>
          <view class="period-label fs-24">本周</view>
        </view>
      </view>

      <!-- AI 健康智能体 -->
      <view class="module mt-30">
        <AiLab />
      </view>

      <view class="score-card mt-30 r-50 bg-white p-40">
        <view class="score-title fs-36 mb-50">生活习惯评分</view>
        <view class="score-chart flex ai-center jc-center">
          <l-echart ref="chartRef1" @finished="initHabitChart" style="width: 524rpx; height: 262rpx"></l-echart>
        </view>
        <view class="score-trend flex fd-c ai-center">
          <view class="trend-text fs-36">{{ habitTrendText }}</view>
          <view class="trend-compare mt-10 t-979797">相比前四周</view>
        </view>
        <score-progress-bar
          :current-score="normalizeIndicatorScore(healthSummary?.habitScore?.score) ?? 0"
          :avg-score="normalizeIndicatorScore((healthSummary?.habitScore?.score ?? 0) - (healthSummary?.habitScore?.trendValue ?? 0)) ?? 0"
          :show-current-icon="normalizeIndicatorScore(healthSummary?.habitScore?.score) != null"
          :show-avg-icon="normalizeIndicatorScore(healthSummary?.habitScore?.score) != null"
        />
      </view>

      <view class="measure-guide mt-30 r-50 bg-white p-40">
        <view class="guide-title fs-36">全面测量</view>
        <view class="guide-desc mt-40 fs-32" style="color: #3d3d3d">我将从运动、皮肤温度、睡眠、心率、心率变异性、血氧、压力各项指标全面开始测量。</view>
        <view class="guide-action mt-90 flex jc-center ai-center relative" @click="jumpMeasureDetail">
          <view class="absolute center-xy flex fd-c ai-center" style="z-index: 1">
            <view class="t-white fs-60">测量</view>
            <view class="fs-24 mt-10" style="color: #ffffff80">点击开始</view>
          </view>
          <view class="circle-shadow-btn">
            <uv-image src="/static/images/icon13.png" width="280rpx" height="280rpx"></uv-image>
          </view>
        </view>
      </view>

      <view class="module sleep-module mt-40">
        <view class="module-header flex jc-between ai-center">
          <view class="module-title fs-36">睡眠</view>
          <view class="module-legend flex ai-center">
            <view class="legend-item flex ai-center mr-20">
              <uv-image src="/static/images/icon11.png" width="16rpx" height="16rpx"></uv-image>
              <view class="legend-label ml-10">前四周平均</view>
            </view>
            <view class="legend-item flex ai-center">
              <uv-image src="/static/images/icon12.png" width="28rpx" height="28rpx"></uv-image>
              <view class="legend-label ml-10">当前</view>
            </view>
          </view>
        </view>

        <view class="indicator-list">
          <view v-for="(item, index) in sleepIndicators" :key="index" class="indicator-item r-50 bg-white p-40 mt-30">
            <view class="indicator-header">
              <view class="indicator-name flex jc-between ai-center" @tap="jumpDetail(item)">
                <text class="fs-36">{{ item.name }}</text>
                <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
              </view>
              <view class="indicator-score mt-50">
                <!-- <text class="fs-48">{{ item.score > 0 ? '+' + item.score : item.score }}</text> -->
                <text class="score-level fs-36 ml-10">{{ item.level }}</text>
              </view>
            </view>
            <score-progress-bar
              :styleVersion="2"
              :current-score="item.current ?? 0"
              :avg-score="item.avg ?? 0"
              :show-current-icon="item.current != null"
              :show-avg-icon="item.avg != null"
            />
          </view>
        </view>
      </view>

      <view class="module sleep-module mt-40">
        <view class="module-header flex jc-between ai-center">
          <view class="module-title fs-36">活动</view>
          <view class="module-legend flex ai-center">
            <view class="legend-item flex ai-center mr-20">
              <uv-image src="/static/images/icon11.png" width="16rpx" height="16rpx"></uv-image>
              <view class="legend-label ml-10">前四周平均</view>
            </view>
            <view class="legend-item flex ai-center">
              <uv-image src="/static/images/icon12.png" width="28rpx" height="28rpx"></uv-image>
              <view class="legend-label ml-10">当前</view>
            </view>
          </view>
        </view>

        <view class="indicator-list">
          <view v-for="(item, index) in activityIndicators" :key="index" class="indicator-item r-50 bg-white p-40 mt-30">
            <view class="indicator-header">
              <view class="indicator-name flex jc-between ai-center" @tap="jumpDetail(item)">
                <text class="fs-36">{{ item.name }}</text>
                <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
              </view>
              <view class="indicator-score mt-50">
                <!-- <text class="fs-48">{{ item.score > 0 ? '+' + item.score : item.score }}</text> -->
                <text class="score-level fs-36 ml-10">{{ item.level }}</text>
              </view>
            </view>
            <score-progress-bar
              :styleVersion="3"
              :current-score="item.current ?? 0"
              :avg-score="item.avg ?? 0"
              :show-current-icon="item.current != null"
              :show-avg-icon="item.avg != null"
            />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style>
.report-period {
  border: 2rpx solid #ffffff;
  background: #3475ff05;
  backdrop-filter: blur(122rpx);
  width: 392rpx;
  height: 106rpx;
  border-radius: 53rpx;
}
.circle-shadow-btn {
  box-shadow:
    inset 0 0 60rpx 0 #2e70fc,
    0 16rpx 40rpx 0 #2e70fc4d;
  border-radius: 50%;
}
.wave-progress-wrapper {
  padding: 0; /* 移除上下padding，让波浪只在填充部分显示 */
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2rpx;
  overflow: hidden; /* 确保波浪不会溢出到容器外 */
}
</style>
