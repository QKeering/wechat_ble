<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { getHealthSummary } from '@/common/api/heatlthSummary';
import { getVitalSign, getSleepOverview, getMotionOverview } from '@/common/api/homeDetail';
import { getBindInfo } from '@/common/api/device';
import { getFamilyGuardians, getFamilyInvites, type FamilyGuardian, type FamilyInvite } from '@/common/api/family';
import { hasBoundRingIdentity } from '@/utils/ringBinding';

const loading = ref(false);
const health = ref<any>(null);
const vital = ref<any>(null);
const sleep = ref<any>(null);
const motion = ref<any>(null);
const device = ref<any>(null);
const guardians = ref<FamilyGuardian[]>([]);
const invites = ref<FamilyInvite[]>([]);
const hasDeviceBinding = computed(() => hasBoundRingIdentity(device.value));
const pendingInviteCount = computed(() => invites.value.filter((item) => Number(item.status) === 0).length);
const sharingText = computed(() => {
  if (!guardians.value.length) return '当前没有家人查看您的健康数据';
  if (guardians.value.length === 1) {
    const guardian = guardians.value[0];
    return `${guardian.guardianName || guardian.guardianPhoneMasked || '家人'} 正在查看这些数据`;
  }
  return `${guardians.value.length} 位家人正在查看这些数据`;
});

const lastSyncText = computed(() => {
  const value = device.value?.lastSyncTime || device.value?.updateTime || health.value?.dateRange?.endDate;
  if (!value) return '还没有同步记录';
  return `最近同步：${String(value).slice(0, 16)}`;
});

const batteryText = computed(() => {
  const battery = device.value?.battery ?? device.value?.electricity ?? device.value?.power;
  if (battery === undefined || battery === null || battery === '') return '电量未知';
  const number = Math.round(Number(battery));
  if (Number.isNaN(number)) return '电量未知';
  if (number <= 20) return `电量 ${number}%，请及时充电`;
  return `电量 ${number}%，可以继续使用`;
});

const todayStatus = computed(() => {
  const score = Number(health.value?.habitScore?.score || vital.value?.overallScore || 0);
  if (!score) return '今天等待同步';
  if (score >= 75) return '今天状态正常';
  if (score >= 60) return '今天需要留意';
  return '今天建议联系子女';
});

const statusClass = computed(() => {
  const text = todayStatus.value;
  if (text.includes('联系')) return 'danger';
  if (text.includes('留意') || text.includes('等待')) return 'warn';
  return 'good';
});

const metrics = computed(() => [
  {
    label: '心率',
    value: Math.round(Number(vital.value?.heartRate || vital.value?.heartRateAvg || 0)) || '--',
    unit: '次/分',
    status: '正常',
    tip: '心率是心跳快慢，休息后再看更准。'
  },
  {
    label: '血氧',
    value: Math.round(Number(vital.value?.spo2 || vital.value?.spo2Avg || 0)) || '--',
    unit: '%',
    status: Number(vital.value?.spo2 || vital.value?.spo2Avg || 0) < 93 ? '偏低' : '正常',
    tip: Number(vital.value?.spo2 || vital.value?.spo2Avg || 0) < 93 ? '建议坐下休息 5 分钟后重新测量。' : '血氧正常，继续保持佩戴。'
  },
  {
    label: '睡眠',
    value: Math.round(Number(sleep.value?.sleepScore || 0)) || '--',
    unit: '分',
    status: Number(sleep.value?.sleepScore || 0) < 60 ? '偏低' : '正常',
    tip: '睡眠分数用于参考昨晚休息情况。'
  },
  {
    label: '步数',
    value: Math.round(Number(motion.value?.step || motion.value?.totalSteps || 0)) || '--',
    unit: '步',
    status: '今日',
    tip: '按身体情况活动，累了就休息。'
  },
  {
    label: '设备',
    value: hasDeviceBinding.value ? '已连' : '--',
    unit: '',
    status: hasDeviceBinding.value ? '可同步' : '未绑定',
    tip: batteryText.value
  }
]);

const fetchData = async () => {
  loading.value = true;
  try {
    const [healthRes, vitalRes, sleepRes, motionRes, deviceRes, guardiansRes, invitesRes] = await Promise.allSettled([
      getHealthSummary(),
      getVitalSign({}),
      getSleepOverview({}),
      getMotionOverview({}),
      getBindInfo(),
      getFamilyGuardians(),
      getFamilyInvites()
    ]);
    health.value = healthRes.status === 'fulfilled' ? healthRes.value : null;
    vital.value = vitalRes.status === 'fulfilled' ? vitalRes.value : null;
    sleep.value = sleepRes.status === 'fulfilled' ? sleepRes.value : null;
    motion.value = motionRes.status === 'fulfilled' ? motionRes.value : null;
    device.value = deviceRes.status === 'fulfilled' ? deviceRes.value : null;
    guardians.value = guardiansRes.status === 'fulfilled' ? guardiansRes.value : [];
    invites.value = invitesRes.status === 'fulfilled' ? invitesRes.value : [];
  } finally {
    loading.value = false;
  }
};

const openMeasure = () => {
  if (!hasDeviceBinding.value) {
    uni.showModal({
      title: '还没有绑定设备',
      content: '请让子女先在家人守护中为您绑定设备。设备绑定后，您只需要佩戴设备并点这里同步。',
      confirmText: '查看邀请',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) {
          callChild();
        }
      }
    });
    return;
  }
  uni.navigateTo({ url: '/pagesA/healths/deviceData' });
};

const callChild = () => {
  uni.navigateTo({ url: '/pages/family/inviteList' });
};

const openShareManage = () => {
  uni.navigateTo({ url: '/pages/family/shareManage' });
};

const openDevice = () => {
  uni.navigateTo({ url: '/pages/family/elderDevice' });
};

onShow(fetchData);

onPullDownRefresh(async () => {
  try {
    await fetchData();
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="长辈模式" bgColor="#f1f3f6"></uv-navbar>

    <view class="status" :class="statusClass">
      <view class="hello">您好</view>
      <view class="status-title">{{ loading ? '正在同步健康状态' : todayStatus }}</view>
      <view class="status-sub">{{ hasDeviceBinding ? '设备已绑定，请保持佩戴' : '还未绑定设备，请让子女协助绑定' }}</view>
      <view class="device-line">
        <view>{{ lastSyncText }}</view>
        <view>{{ batteryText }}</view>
      </view>
      <view class="share-line">{{ sharingText }}</view>
      <view v-if="pendingInviteCount > 0" class="invite-alert" @click="callChild">
        有 {{ pendingInviteCount }} 个家人邀请待处理，点这里查看
      </view>
    </view>

    <view class="sync-action">
      <uv-button
        :text="hasDeviceBinding ? '同步设备数据' : '等待子女绑定设备'"
        :color="hasDeviceBinding ? '#2E70FC' : '#9CA3AF'"
        :customStyle="{ height: '116rpx' }"
        :customTextStyle="{ fontSize: '40rpx', fontWeight: 800 }"
        @click="openMeasure"
      />
      <view class="sync-help">
        {{ hasDeviceBinding ? '点一下同步，家人就能看到最新健康数据。' : '设备由子女先绑定好后，您只需要佩戴并打开小程序。' }}
      </view>
    </view>

    <view class="metric-list">
      <view v-for="item in metrics" :key="item.label" class="metric-card">
        <view class="metric-info">
          <view class="metric-label">{{ item.label }}</view>
          <view class="metric-status">{{ item.status }}</view>
          <view class="metric-tip">{{ item.tip }}</view>
        </view>
        <view class="metric-value">{{ item.value }}<text>{{ item.unit }}</text></view>
      </view>
    </view>

    <view class="action-grid">
      <uv-button text="家人邀请" color="#16A34A" :customStyle="{ height: '100rpx' }" :customTextStyle="{ fontSize: '34rpx' }" @click="callChild" />
      <uv-button text="共享管理" color="#E8F0FF" :customStyle="{ height: '100rpx' }" :customTextStyle="{ color: '#2E70FC', fontSize: '34rpx' }" @click="openShareManage" />
      <view class="action-wide">
        <uv-button text="我的设备" color="#FFFFFF" :customStyle="{ height: '100rpx', border: '2rpx solid #BFDBFE' }" :customTextStyle="{ color: '#1D4ED8', fontSize: '34rpx', fontWeight: 800 }" @click="openDevice" />
      </view>
    </view>

    <view class="sharing-card" @click="openShareManage">
      <view class="sharing-head">
        <view class="sharing-title">家人共享状态</view>
        <uv-icon name="arrow-right" color="#9CA3AF" size="18"></uv-icon>
      </view>
      <view v-if="guardians.length === 0" class="sharing-desc">您还没有授权家人查看健康数据。</view>
      <view v-for="guardian in guardians" :key="guardian.memberId" class="guardian-row">
        <view class="guardian-avatar">{{ (guardian.guardianName || guardian.guardianPhoneMasked || '家').slice(0, 1) }}</view>
        <view class="guardian-info">
          <view class="guardian-name">{{ guardian.guardianName || guardian.guardianPhoneMasked || '家人' }}</view>
          <view class="guardian-desc">{{ guardian.statusText || '生效' }}：可查看设备状态、健康概览和已开启的指标</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f1f3f6;
  padding: 0 30rpx 60rpx;
  box-sizing: border-box;
}
.status {
  margin-top: 30rpx;
  padding: 42rpx 36rpx;
  border-radius: 28rpx;
  background: #eefaf3;
}
.status.warn {
  background: #fff8e8;
}
.status.danger {
  background: #fff0f0;
}
.hello {
  font-size: 34rpx;
  color: #6b7280;
}
.status-title {
  margin-top: 16rpx;
  font-size: 56rpx;
  font-weight: 900;
  color: #111827;
  line-height: 1.2;
}
.status-sub {
  margin-top: 18rpx;
  color: #374151;
  font-size: 32rpx;
  line-height: 1.5;
}
.device-line {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10rpx;
  margin-top: 20rpx;
  color: #374151;
  font-size: 30rpx;
  line-height: 1.5;
}
.share-line {
  margin-top: 24rpx;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: rgba(255, 255, 255, 0.72);
  color: #111827;
  font-size: 30rpx;
  line-height: 1.5;
}
.invite-alert {
  margin-top: 18rpx;
  padding: 20rpx 22rpx;
  border-radius: 18rpx;
  background: #fff7e6;
  color: #92400e;
  font-size: 32rpx;
  font-weight: 800;
  line-height: 1.5;
}
.sync-action {
  margin-top: 26rpx;
}
.sync-help {
  margin-top: 14rpx;
  color: #6b7280;
  font-size: 30rpx;
  line-height: 1.6;
  text-align: center;
}
.metric-list {
  margin-top: 26rpx;
}
.metric-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 34rpx;
  margin-bottom: 22rpx;
  background: #ffffff;
  border-radius: 24rpx;
  gap: 20rpx;
}
.metric-info {
  flex: 1;
  min-width: 0;
}
.metric-label {
  font-size: 36rpx;
  font-weight: 800;
  color: #111827;
}
.metric-status {
  margin-top: 10rpx;
  font-size: 30rpx;
  color: #6b7280;
}
.metric-tip {
  margin-top: 10rpx;
  color: #374151;
  font-size: 28rpx;
  line-height: 1.5;
}
.metric-value {
  font-size: 54rpx;
  font-weight: 900;
  color: #111827;
  flex-shrink: 0;
  max-width: 260rpx;
  text-align: right;
  word-break: break-all;
}
.metric-value text {
  margin-left: 6rpx;
  font-size: 26rpx;
  color: #6b7280;
  font-weight: 400;
}
.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22rpx;
  margin-top: 34rpx;
}
.action-wide {
  grid-column: 1 / -1;
}
.sharing-card {
  margin-top: 28rpx;
  padding: 34rpx;
  border-radius: 24rpx;
  background: #ffffff;
}
.sharing-title {
  font-size: 36rpx;
  font-weight: 800;
  color: #111827;
}
.sharing-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sharing-desc {
  margin-top: 14rpx;
  color: #6b7280;
  font-size: 30rpx;
  line-height: 1.6;
}
.guardian-row {
  display: flex;
  align-items: center;
  margin-top: 26rpx;
}
.guardian-avatar {
  width: 78rpx;
  height: 78rpx;
  border-radius: 50%;
  background: #e8f0ff;
  color: #2e70fc;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  font-weight: 800;
  margin-right: 22rpx;
}
.guardian-info {
  flex: 1;
  min-width: 0;
}
.guardian-name {
  color: #111827;
  font-size: 32rpx;
  font-weight: 700;
}
.guardian-desc {
  margin-top: 8rpx;
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.5;
}
</style>
