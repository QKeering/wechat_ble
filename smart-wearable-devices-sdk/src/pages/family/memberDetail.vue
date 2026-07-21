<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import {
  getFamilyAiMonthlyReport,
  getFamilyAiWeeklyReport,
  getFamilyDashboard,
  getFamilyRelationAiMonthlyReport,
  getFamilyRelationAiWeeklyReport,
  getFamilyRelationDashboard,
  type FamilyDashboard,
  type FamilyWeeklyReport
} from '@/common/api/family';
import { getBoundRingIdentity, hasBoundRingIdentity } from '@/utils/ringBinding';

const memberId = ref(0);
const relationId = ref(0);
const dashboard = ref<FamilyDashboard | null>(null);
const weeklyReport = ref<FamilyWeeklyReport | null>(null);
const monthlyReport = ref<FamilyWeeklyReport | null>(null);
const loading = ref(false);

const member = computed(() => dashboard.value?.member);
const alerts = computed(() => dashboard.value?.alerts || []);
const aiSummary = computed(() => dashboard.value?.aiSummary);
const summary = computed(() => dashboard.value?.summary || {});
const device = computed(() => dashboard.value?.device || {});
const hasDeviceBinding = computed(() => hasBoundRingIdentity(device.value));
const deviceIdentity = computed(() => getBoundRingIdentity(device.value));
const deviceStatusText = computed(() => {
  if (!hasDeviceBinding.value) return '还没有给这位家人绑定设备';
  const label = device.value.deviceName || deviceIdentity.value;
  return `${label} · ${device.value.online ? '最近已同步' : '可能离线'}`;
});

const overallStatus = computed(() => {
  if (!dashboard.value) return '加载中';
  if (alerts.value.some((item) => item.level === 'danger')) return '需要尽快关注';
  if (alerts.value.length > 0) return '有事项需关注';
  return '今日状态平稳';
});

const overallClass = computed(() => {
  if (alerts.value.some((item) => item.level === 'danger')) return 'danger';
  if (alerts.value.length > 0) return 'warn';
  return 'good';
});

const metricCards = computed(() => [
  { label: '心率', value: Math.round(Number(summary.value.heartRateAvg || 0)) || '--', unit: '次/分' },
  { label: '血氧', value: Math.round(Number(summary.value.spo2Avg || 0)) || '--', unit: '%' },
  { label: '睡眠评分', value: Math.round(Number(summary.value.sleepScore || 0)) || '--', unit: '分' },
  { label: '活动评分', value: Math.round(Number(summary.value.motionScore || 0)) || '--', unit: '分' }
]);

const weeklyMetricCards = computed(() => {
  const metrics = weeklyReport.value?.metrics;
  return [
    { label: '同步天数', value: metrics?.syncedDays != null ? `${metrics.syncedDays}/${metrics.totalDays || 7}` : '--', unit: '天' },
    { label: '平均心率', value: metrics?.heartRateAvg ?? '--', unit: '次/分' },
    { label: '平均血氧', value: metrics?.spo2Avg ?? '--', unit: '%' },
    { label: '睡眠均分', value: metrics?.sleepScoreAvg ?? '--', unit: '分' }
  ];
});

const monthlyMetricCards = computed(() => {
  const metrics = monthlyReport.value?.metrics;
  return [
    { label: '同步天数', value: metrics?.syncedDays != null ? `${metrics.syncedDays}/${metrics.totalDays || 30}` : '--', unit: '天' },
    { label: '平均心率', value: metrics?.heartRateAvg ?? '--', unit: '次/分' },
    { label: '平均血氧', value: metrics?.spo2Avg ?? '--', unit: '%' },
    { label: '平均步数', value: metrics?.stepsAvg ?? '--', unit: '步' }
  ];
});

const fetchDashboard = async () => {
  if (!memberId.value && !relationId.value) return;
  loading.value = true;
  try {
    const dashboardRequest = relationId.value
      ? getFamilyRelationDashboard(relationId.value)
      : getFamilyDashboard({ memberId: memberId.value });
    const weeklyRequest = relationId.value
      ? getFamilyRelationAiWeeklyReport(relationId.value)
      : getFamilyAiWeeklyReport({ memberId: memberId.value });
    const monthlyRequest = relationId.value
      ? getFamilyRelationAiMonthlyReport(relationId.value)
      : getFamilyAiMonthlyReport({ memberId: memberId.value });
    const [dashboardResult, weeklyResult, monthlyResult] = await Promise.allSettled([
      dashboardRequest,
      weeklyRequest,
      monthlyRequest
    ]);
    if (dashboardResult.status === 'fulfilled') {
      dashboard.value = dashboardResult.value;
      memberId.value = Number(dashboardResult.value?.member?.id || memberId.value || 0);
    }
    if (weeklyResult.status === 'fulfilled') {
      weeklyReport.value = weeklyResult.value;
    } else {
      weeklyReport.value = null;
    }
    if (monthlyResult.status === 'fulfilled') {
      monthlyReport.value = monthlyResult.value;
    } else {
      monthlyReport.value = null;
    }
  } finally {
    loading.value = false;
  }
};

const openBind = () => {
  const relationQuery = relationId.value ? `&relationId=${relationId.value}` : '';
  uni.navigateTo({ url: `/pages/family/bindDevice?memberId=${memberId.value}${relationQuery}&name=${encodeURIComponent(member.value?.name || '')}` });
};

const openPermission = () => {
  const relationQuery = relationId.value ? `&relationId=${relationId.value}` : '';
  uni.navigateTo({ url: `/pages/family/sharePermission?memberId=${memberId.value}${relationQuery}` });
};

onLoad((query: any) => {
  memberId.value = Number(query?.memberId || 0);
  relationId.value = Number(query?.relationId || 0);
  fetchDashboard();
});

onPullDownRefresh(async () => {
  try {
    await fetchDashboard();
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="家人详情" bgColor="#f1f3f6"></uv-navbar>

    <view v-if="loading && !dashboard" class="loading">正在加载健康状态...</view>

    <template v-else>
      <view class="status-card" :class="overallClass">
        <view class="member-line">
          <view class="avatar">{{ member?.name?.slice(0, 1) || '家' }}</view>
          <view>
            <view class="name">{{ member?.name || '家人' }}</view>
            <view class="sub">设备 {{ hasDeviceBinding ? '已绑定' : '未绑定' }}</view>
          </view>
        </view>
        <view class="status-text">{{ overallStatus }}</view>
      </view>

      <view class="device-card">
        <view>
          <view class="card-title">设备状态</view>
          <view class="card-desc">
            {{ deviceStatusText }}
          </view>
        </view>
        <view class="device-actions">
          <uv-button text="共享权限" color="#E8F0FF" :customStyle="{ width: '172rpx', height: '72rpx' }" :customTextStyle="{ color: '#2E70FC', fontSize: '28rpx' }" @click="openPermission" />
          <view class="action-gap"></view>
          <uv-button :text="hasDeviceBinding ? '重新绑定' : '绑定设备'" color="#2E70FC" :customStyle="{ width: '172rpx', height: '72rpx' }" :customTextStyle="{ fontSize: '28rpx' }" @click="openBind" />
        </view>
      </view>

      <view class="metrics">
        <view v-for="item in metricCards" :key="item.label" class="metric-card">
          <view class="metric-label">{{ item.label }}</view>
          <view class="metric-value">{{ item.value }}<text class="metric-unit">{{ item.unit }}</text></view>
        </view>
      </view>

      <view class="section">
        <view class="section-title">异常提醒</view>
        <view v-if="alerts.length === 0" class="soft-text">暂无明显异常，继续保持佩戴和同步。</view>
        <view v-for="alert in alerts" :key="alert.alertType" class="alert-item" :class="alert.level">
          <view class="alert-title">{{ alert.title }}</view>
          <view class="alert-content">{{ alert.content }}</view>
        </view>
      </view>

      <view class="section">
        <view class="section-title">{{ aiSummary?.title || 'AI 今日健康摘要' }}</view>
        <view class="ai-conclusion">{{ aiSummary?.conclusion || '暂无摘要，请同步数据后再查看。' }}</view>
        <view v-for="item in aiSummary?.suggestions || []" :key="item" class="suggestion">{{ item }}</view>
        <view class="disclaimer">{{ aiSummary?.disclaimer }}</view>
      </view>

      <view class="section">
        <view class="section-title">{{ weeklyReport?.title || 'AI 看护周报' }}</view>
        <view class="week-period" v-if="weeklyReport">{{ weeklyReport.period.startDate }} 至 {{ weeklyReport.period.endDate }}</view>
        <view class="ai-conclusion">{{ weeklyReport?.conclusion || '暂无足够数据生成周报，请保持每日同步。' }}</view>
        <view class="weekly-metrics">
          <view v-for="item in weeklyMetricCards" :key="item.label" class="weekly-metric">
            <view class="metric-label">{{ item.label }}</view>
            <view class="weekly-value">{{ item.value }}<text class="metric-unit">{{ item.unit }}</text></view>
          </view>
        </view>
        <view v-for="item in weeklyReport?.suggestions || []" :key="item" class="suggestion">{{ item }}</view>
        <view class="disclaimer">{{ weeklyReport?.disclaimer || 'AI 周报仅供日常看护参考，不构成医疗诊断。' }}</view>
      </view>

      <view class="section">
        <view class="section-title">{{ monthlyReport?.title || 'AI 看护月报' }}</view>
        <view class="week-period" v-if="monthlyReport">{{ monthlyReport.period.startDate }} 至 {{ monthlyReport.period.endDate }}</view>
        <view class="ai-conclusion">{{ monthlyReport?.conclusion || '暂无足够数据生成月报，请保持每日同步。' }}</view>
        <view class="weekly-metrics">
          <view v-for="item in monthlyMetricCards" :key="item.label" class="weekly-metric">
            <view class="metric-label">{{ item.label }}</view>
            <view class="weekly-value">{{ item.value }}<text class="metric-unit">{{ item.unit }}</text></view>
          </view>
        </view>
        <view v-for="item in monthlyReport?.suggestions || []" :key="item" class="suggestion">{{ item }}</view>
        <view class="disclaimer">{{ monthlyReport?.disclaimer || 'AI 月报仅供日常看护参考，不构成医疗诊断。' }}</view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f1f3f6;
  padding: 0 30rpx 60rpx;
  box-sizing: border-box;
}
.loading {
  margin-top: 40rpx;
  color: #6b7280;
  text-align: center;
  font-size: 30rpx;
}
.status-card,
.device-card,
.section {
  margin-top: 28rpx;
  padding: 34rpx;
  background: #ffffff;
  border-radius: 24rpx;
}
.status-card.good {
  background: #eefaf3;
}
.status-card.warn {
  background: #fff8e8;
}
.status-card.danger {
  background: #fff0f0;
}
.member-line,
.device-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}
.device-card > view:first-child {
  flex: 1;
  min-width: 0;
}
.device-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.action-gap {
  width: 14rpx;
}
.member-line {
  justify-content: flex-start;
}
.avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: #ffffff;
  color: #2e70fc;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 700;
  margin-right: 24rpx;
}
.name {
  font-size: 38rpx;
  font-weight: 700;
  color: #111827;
}
.sub,
.card-desc,
.soft-text,
.alert-content,
.disclaimer {
  color: #6b7280;
  font-size: 28rpx;
  line-height: 1.6;
}
.status-text {
  margin-top: 30rpx;
  font-size: 48rpx;
  font-weight: 800;
  color: #111827;
}
.card-title,
.section-title {
  font-size: 34rpx;
  font-weight: 700;
  color: #111827;
}
.card-desc {
  margin-top: 10rpx;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20rpx;
  margin-top: 24rpx;
}
.metric-card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 30rpx;
}
.metric-label {
  color: #6b7280;
  font-size: 28rpx;
}
.metric-value {
  margin-top: 16rpx;
  font-size: 46rpx;
  font-weight: 800;
  color: #111827;
}
.metric-unit {
  margin-left: 6rpx;
  font-size: 24rpx;
  color: #6b7280;
  font-weight: 400;
}
.alert-item {
  margin-top: 20rpx;
  padding: 24rpx;
  border-radius: 18rpx;
  background: #f8fafc;
}
.alert-item.warning {
  background: #fff8e8;
}
.alert-item.danger {
  background: #fff0f0;
}
.alert-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #111827;
}
.ai-conclusion {
  margin-top: 18rpx;
  color: #111827;
  font-size: 30rpx;
  line-height: 1.7;
}
.suggestion {
  margin-top: 16rpx;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: #f8fafc;
  color: #374151;
  font-size: 28rpx;
}
.disclaimer {
  margin-top: 22rpx;
  font-size: 24rpx;
}
.week-period {
  margin-top: 10rpx;
  color: #6b7280;
  font-size: 26rpx;
}
.weekly-metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18rpx;
  margin-top: 22rpx;
}
.weekly-metric {
  padding: 22rpx;
  border-radius: 18rpx;
  background: #f8fafc;
}
.weekly-value {
  margin-top: 10rpx;
  font-size: 34rpx;
  font-weight: 800;
  color: #111827;
}
</style>
