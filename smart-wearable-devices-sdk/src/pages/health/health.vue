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

const echarts = require('../../static/echarts.min.js');
const userStore = useUserStore();
const ringStore = useRingStore();
const {
  connectedDeviceId,
  deviceInfo: ringDeviceInfo,
  normalMac,
  iosMacId,
  autoConnectLastDevice,
  ensureCommunicationReady,
  refreshHealthData
} = useRingBLE();
const scrollTop = ref(0);
const healthSummary = ref<HabitAnalysisData>();
const chartRef1 = ref<any>(null);
type itemType = {
  name: string;
  score: number;
  level: string;
  path: string;
  type?: string;
  avg?: number;
  current?: number;
};
const pullDownRefresh = ref(false);
const pullDownProgress = ref(0);
const habitTrendText = computed(() => normalizeHealthText(healthSummary.value?.habitScore?.trend, '--'));
const sleepIndicators = computed<itemType[]>(() => [
  {
    name: '睡前准备',
    score: healthSummary.value?.sleep?.preparation?.score || 0,
    level: normalizeHealthLevel(healthSummary.value?.sleep?.preparation?.level, healthSummary.value?.sleep?.preparation?.score || 0),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sleepPrep',
    avg: healthSummary.value?.sleep?.preparation?.avg || 0,
    current: healthSummary.value?.sleep?.preparation?.current || 0
  },
  {
    name: '睡眠节律',
    score: healthSummary.value?.sleep?.rhythm?.score || 0,
    level: normalizeHealthLevel(healthSummary.value?.sleep?.rhythm?.level, healthSummary.value?.sleep?.rhythm?.score || 0),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sleepRhythm',
    avg: healthSummary.value?.sleep?.rhythm?.avg || 0,
    current: healthSummary.value?.sleep?.rhythm?.current || 0
  },
  {
    name: '睡眠过程恢复',
    score: healthSummary.value?.sleep?.recovery?.score || 0,
    level: normalizeHealthLevel(healthSummary.value?.sleep?.recovery?.level, healthSummary.value?.sleep?.recovery?.score || 0),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sleepRecovery',
    avg: healthSummary.value?.sleep?.recovery?.avg || 0,
    current: healthSummary.value?.sleep?.recovery?.current || 0
  },
  {
    name: '睡眠激活',
    score: healthSummary.value?.sleep?.activation?.score || 0,
    level: normalizeHealthLevel(healthSummary.value?.sleep?.activation?.level, healthSummary.value?.sleep?.activation?.score || 0),
    path: '/pagesA/healths/indicatorDetail',
    type: 'wakeUpBoost',
    avg: healthSummary.value?.sleep?.activation?.avg || 0,
    current: healthSummary.value?.sleep?.activation?.current || 0
  }
]);

const activityIndicators = computed<itemType[]>(() => [
  {
    name: '久坐风险',
    score: healthSummary.value?.activity?.sedentaryRisk?.score || 0,
    level: normalizeHealthLevel(healthSummary.value?.activity?.sedentaryRisk?.level, healthSummary.value?.activity?.sedentaryRisk?.score || 0),
    path: '/pagesA/healths/indicatorDetail',
    type: 'sedentaryRisk',
    avg: healthSummary.value?.activity?.sedentaryRisk?.avg || 0,
    current: healthSummary.value?.activity?.sedentaryRisk?.current || 0
  },
  {
    name: '活动强度',
    score: healthSummary.value?.activity?.activityRisk?.score || 0,
    level: normalizeHealthLevel(healthSummary.value?.activity?.activityRisk?.level, healthSummary.value?.activity?.activityRisk?.score || 0),
    path: '/pagesA/healths/indicatorDetail',
    type: 'activityIntensity',
    avg: healthSummary.value?.activity?.activityRisk?.avg || 0,
    current: healthSummary.value?.activity?.activityRisk?.current || 0
  },
  {
    name: '运动规律性',
    score: healthSummary.value?.activity?.exerciseRegularity?.score || 0,
    level: normalizeHealthLevel(healthSummary.value?.activity?.exerciseRegularity?.level, healthSummary.value?.activity?.exerciseRegularity?.score || 0),
    path: '/pagesA/healths/indicatorDetail',
    type: 'exerciseRegularity',
    avg: healthSummary.value?.activity?.exerciseRegularity?.avg || 0,
    current: healthSummary.value?.activity?.exerciseRegularity?.current || 0
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
const getCurrentRingProtocol = () =>
  ringDeviceInfo.value?.protocol || ringStore.deviceInfo?.protocol || userStore.deviceInfo?.protocol;
const isCurrentRwRing = () => getCurrentRingProtocol() === 'rw';
const getRingRefreshTimeoutMs = () => (isCurrentRwRing() ? 35000 : 3500);
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
      const restored = await autoConnectLastDevice();
      if (!restored) return;
    }
    await ensureCommunicationReady();
    await refreshHealthData({
      includeDeviceTime: false,
      includeCollectPeriod: false,
      includeRealtimeMetrics: isCurrentRwRing() ? false : undefined,
      includeHistorySnapshot: isCurrentRwRing() ? false : undefined,
      timeoutMs: getRingRefreshTimeoutMs()
    });
  } catch {
  }
};
const loadHealthPageSnapshot = async (options: { waitForRing?: boolean } = {}) => {
  const ringRefresh = refreshBoundRingBusinessData();
  healthSummary.value = await getHealthSummary();
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
onShow(async () => {
  if (!userStore.token) {
    userStore.updateDeviceInfo({});
    userStore.updateReceivedData([]);
    return;
  }
  pullDownRefresh.value = true;
  pullDownProgress.value = 0;
  pullDownProgress.value = 50;
  await loadHealthPageSnapshot();
  pullDownProgress.value = 80;
  await initHabitChart();
  pullDownProgress.value = 100;
  pullDownRefresh.value = false;
  pullDownProgress.value = 0;
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

      <!-- AI 实验室 -->
      <view class="module bg-white p-40 mt-30 r-50">
        <AiLab></AiLab>
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
          :current-score="healthSummary?.habitScore?.score || 50"
          :avg-score="(healthSummary?.habitScore?.score || 50) + (healthSummary?.habitScore?.trendValue || 0)"
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
            <score-progress-bar :styleVersion="2" :current-score="item.current || 50" :avg-score="item.avg || 50" />
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
            <score-progress-bar :styleVersion="3" :current-score="item.current || 50" :avg-score="item.avg || 50" />
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
