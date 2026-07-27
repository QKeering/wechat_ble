<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import {
  getFamilyHome,
  getFamilyMembers,
  type FamilyHome,
  type FamilyMember
} from '@/common/api/family';
import { hasBoundRingIdentity } from '@/utils/ringBinding';

const members = ref<FamilyMember[]>([]);
const home = ref<FamilyHome | null>(null);
const loading = ref(false);

const relationText = (relation?: string) => {
  const map: Record<string, string> = {
    father: '父亲',
    mother: '母亲',
    grandpa: '爷爷',
    grandma: '奶奶',
    parent: '父母',
    other: '家人'
  };
  return map[relation || ''] || '家人';
};

const getFamilyMemberBoundDevice = (member: FamilyMember) => ({
  deviceId: member.deviceId,
  mac: member.deviceMac || member.mac,
  uniMacId: member.uniMacId,
  protocol: member.protocol,
  advertis: member.advertis
});

const hasFamilyMemberDevice = (member: FamilyMember) => hasBoundRingIdentity(getFamilyMemberBoundDevice(member));

const getDeviceStatus = (member: FamilyMember) => {
  if (!hasFamilyMemberDevice(member)) return '未绑定设备';
  if (!member.lastSyncTime) return '已绑定，待同步';
  return `最近同步 ${String(member.lastSyncTime).slice(5, 16)}`;
};

const hasMembers = computed(() => members.value.length > 0);
const stats = computed(
  () =>
    home.value?.stats || {
      total: members.value.length,
      syncedToday: members.value.filter((item) => item.lastSyncTime).length,
      needAttention: members.value.filter((item) => hasFamilyMemberDevice(item) && !item.lastSyncTime).length,
      unbound: members.value.filter((item) => !hasFamilyMemberDevice(item)).length,
      guardians: 0
    }
);
const summaryText = computed(() => home.value?.summaryText || '父母佩戴设备，家人远程查看健康状态');

const getMemberCareStatus = (member: FamilyMember & { careStatus?: string; careStatusText?: string }) => {
  if (!hasFamilyMemberDevice(member)) return '';
  if (member.careStatusText) return member.careStatusText;
  if (!member.lastSyncTime) return '待同步';
  return '今日守护中';
};

const getMemberTag = (member: FamilyMember & { careStatus?: string }) => {
  if (Number(member.carePriority || 0) >= 50 || member.careStatus === 'attention' || member.careStatus === 'unsynced') return '需关注';
  if (!hasFamilyMemberDevice(member)) return '待绑定';
  return '守护中';
};

const formatIntegerMetric = (value: unknown) => {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
};

const metricText = (member: FamilyMember) => {
  const metrics = member.metrics || {};
  const heartRate = formatIntegerMetric(metrics.heartRate);
  const spo2 = formatIntegerMetric(metrics.spo2);
  const parts = [
    heartRate ? `心率 ${heartRate}` : '',
    spo2 ? `血氧 ${spo2}%` : '',
    metrics.sleepScore ? `睡眠 ${metrics.sleepScore}分` : '',
    metrics.steps ? `步数 ${metrics.steps}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '暂无今日指标，请同步后查看';
};

const getMemberCardSummary = (member: FamilyMember) => String(member.cardSummary || '').trim();

const shouldShowMemberCardSummary = (member: FamilyMember) => {
  const summary = getMemberCardSummary(member);
  if (!summary) return false;
  if (!hasFamilyMemberDevice(member) && /(尚未绑定设备|未绑定设备|待绑定设备)/.test(summary)) return false;
  return summary !== metricText(member);
};

const fetchMembers = async () => {
  loading.value = true;
  try {
    try {
      const data = await getFamilyHome();
      home.value = data;
      members.value = data.members || [];
    } catch (error) {
      home.value = null;
      members.value = await getFamilyMembers();
    }
  } finally {
    loading.value = false;
  }
};

const openAdd = () => {
  uni.navigateTo({ url: '/pages/family/addMember' });
};

const openElderMode = () => {
  uni.navigateTo({ url: '/pages/family/elderHome' });
};

const openInvites = () => {
  uni.navigateTo({ url: '/pages/family/inviteList' });
};

const openCollaborate = () => {
  uni.navigateTo({ url: '/pages/family/familyCollaborate' });
};

const openDetail = (member: FamilyMember) => {
  const relationQuery = member.relationId ? `&relationId=${member.relationId}` : '';
  uni.navigateTo({ url: `/pages/family/memberDetail?memberId=${member.id}${relationQuery}` });
};

onShow(fetchMembers);

onPullDownRefresh(async () => {
  try {
    await fetchMembers();
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view class="family-page">
    <uv-navbar placeholder leftIcon="" title="家人守护" bgColor="#f1f3f6"></uv-navbar>

    <view class="hero">
      <view>
        <view class="hero-title">家庭健康看护</view>
        <view class="hero-desc">{{ summaryText }}</view>
      </view>
      <uv-button text="长辈模式" color="#E8F0FF" :customTextStyle="{ color: '#2E70FC', fontSize: '28rpx' }" :customStyle="{ width: '180rpx', height: '72rpx' }" @click="openElderMode" />
    </view>

    <view class="summary-grid">
      <view class="summary-item">
        <view class="summary-value">{{ stats.total }}</view>
        <view class="summary-label">守护家人</view>
      </view>
      <view class="summary-item">
        <view class="summary-value">{{ stats.syncedToday }}</view>
        <view class="summary-label">今日同步</view>
      </view>
      <view class="summary-item warn">
        <view class="summary-value">{{ stats.needAttention }}</view>
        <view class="summary-label">需关注</view>
      </view>
      <view class="summary-item invite" :class="{ active: (home?.pendingInviteCount || 0) > 0 }" @click="openInvites">
        <view class="summary-value">{{ home?.pendingInviteCount || 0 }}</view>
        <view class="summary-label">邀请</view>
      </view>
    </view>

    <view class="actions">
      <uv-button text="添加父母/家人" color="#2E70FC" :customStyle="{ height: '92rpx' }" :customTextStyle="{ fontSize: '34rpx' }" @click="openAdd" />
      <uv-button text="协同照护 / 人工协助" color="#FFFFFF" :customStyle="{ height: '86rpx', marginTop: '18rpx', border: '2rpx solid #D7DFEA' }" :customTextStyle="{ color: '#111827', fontSize: '30rpx' }" @click="openCollaborate" />
    </view>

    <view v-if="loading" class="empty">正在加载家人信息...</view>

    <view v-if="!loading && !hasMembers" class="empty-card">
      <view class="empty-title">还没有添加家人</view>
      <view class="empty-desc">先为父母建立档案，再绑定对应的穿戴设备。</view>
    </view>

    <view v-if="!loading && hasMembers" class="member-list">
      <view v-for="member in members" :key="member.id" class="member-card" @click="openDetail(member)">
        <view class="member-main">
          <view class="avatar">{{ member.name?.slice(0, 1) || '家' }}</view>
          <view class="member-info">
            <view class="member-name">{{ member.name }}</view>
            <view class="member-relation">{{ relationText(member.relation) }} · {{ getDeviceStatus(member) }}</view>
            <view v-if="getMemberCareStatus(member)" class="member-care">{{ getMemberCareStatus(member) }}</view>
            <view v-if="shouldShowMemberCardSummary(member)" class="member-summary">{{ getMemberCardSummary(member) }}</view>
            <view class="member-metrics">{{ metricText(member) }}</view>
          </view>
        </view>
        <view class="member-side">
          <view class="status-tag" :class="{ warn: getMemberTag(member) !== '守护中' }">{{ getMemberTag(member) }}</view>
          <uv-icon name="arrow-right" color="#9CA3AF" size="16"></uv-icon>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.family-page {
  min-height: 100vh;
  background: #f1f3f6;
  padding: 0 30rpx 60rpx;
  box-sizing: border-box;
}
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 34rpx 0 20rpx;
}
.hero-title {
  font-size: 44rpx;
  font-weight: 700;
  color: #111827;
}
.hero-desc {
  margin-top: 12rpx;
  font-size: 28rpx;
  color: #6b7280;
}
.actions {
  margin: 24rpx 0 30rpx;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16rpx;
  margin: 18rpx 0 28rpx;
}
.summary-item {
  padding: 24rpx 12rpx;
  background: #ffffff;
  border-radius: 18rpx;
  text-align: center;
}
.summary-value {
  font-size: 42rpx;
  font-weight: 900;
  color: #111827;
}
.summary-label {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #6b7280;
}
.summary-item.warn .summary-value {
  color: #d97706;
}
.summary-item.invite.active .summary-value {
  color: #2e70fc;
}
.empty,
.empty-card {
  margin-top: 28rpx;
  padding: 48rpx 36rpx;
  border-radius: 24rpx;
  background: #ffffff;
  color: #6b7280;
  font-size: 30rpx;
  text-align: center;
}
.empty-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #111827;
}
.empty-desc {
  margin-top: 16rpx;
  line-height: 1.6;
}
.member-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
  padding: 32rpx;
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 8rpx 24rpx rgba(46, 112, 252, 0.08);
}
.member-main,
.member-side {
  display: flex;
  align-items: center;
}
.member-main {
  flex: 1;
  min-width: 0;
}
.member-info {
  flex: 1;
  min-width: 0;
}
.member-side {
  flex-shrink: 0;
  align-self: flex-start;
  padding-top: 4rpx;
}
.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: #e8f0ff;
  color: #2e70fc;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 38rpx;
  font-weight: 700;
  margin-right: 24rpx;
}
.member-name {
  font-size: 36rpx;
  font-weight: 700;
  color: #111827;
}
.member-relation {
  margin-top: 10rpx;
  font-size: 26rpx;
  color: #6b7280;
}
.member-care {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #374151;
}
.member-summary {
  margin-top: 14rpx;
  color: #111827;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.5;
}
.member-metrics {
  margin-top: 8rpx;
  color: #6b7280;
  font-size: 24rpx;
  line-height: 1.5;
}
.status-tag {
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background: #e8f7ef;
  color: #16a34a;
  font-size: 24rpx;
  margin-right: 12rpx;
}
.status-tag.warn {
  background: #fff7e6;
  color: #d97706;
}
</style>
