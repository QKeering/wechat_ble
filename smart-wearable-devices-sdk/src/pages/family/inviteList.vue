<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { acceptFamilyInvite, claimFamilyElderProfile, getFamilyInvites, rejectFamilyInvite, type FamilyInvite } from '@/common/api/family';

const loading = ref(false);
const invites = ref<FamilyInvite[]>([]);

const pendingInvites = computed(() => invites.value.filter((item) => item.status === 0));
const historyInvites = computed(() => invites.value.filter((item) => item.status !== 0));

const fetchInvites = async () => {
  loading.value = true;
  try {
    invites.value = await getFamilyInvites();
  } finally {
    loading.value = false;
  }
};

const titleOf = (invite: FamilyInvite) => {
  const name = invite.elderProfileName || invite.relationName || '家人';
  if (invite.inviteType === 1) return `${invite.inviterName || '家人'} 邀请你查看 ${name} 的健康数据`;
  return `${invite.inviterName || '家人'} 邀请老人确认共享`;
};

const descOf = (invite: FamilyInvite) => {
  const expire = invite.expireTime ? `有效期至 ${invite.expireTime}` : '请及时处理';
  const phone = invite.targetPhoneMasked || invite.targetPhone;
  if (phone) return `${expire} · 手机号 ${phone}`;
  return expire;
};

const acceptInvite = async (invite: FamilyInvite) => {
  await acceptFamilyInvite(invite.inviteCode);
  if (invite.elderProfileId && invite.inviteType === 2) {
    await claimFamilyElderProfile(Number(invite.elderProfileId));
  }
  uni.showToast({ title: '已接受邀请', icon: 'success' });
  fetchInvites();
};

const rejectInvite = async (invite: FamilyInvite) => {
  await rejectFamilyInvite(invite.inviteCode);
  uni.showToast({ title: '已拒绝', icon: 'success' });
  fetchInvites();
};

onShow(fetchInvites);

onPullDownRefresh(async () => {
  try {
    await fetchInvites();
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="家人邀请" bgColor="#f1f3f6"></uv-navbar>

    <view v-if="loading" class="empty">正在加载邀请...</view>

    <view v-else>
      <view class="section-title">待处理邀请</view>
      <view v-if="pendingInvites.length === 0" class="empty-card">
        <view class="empty-title">暂无待处理邀请</view>
        <view class="empty-desc">收到家人邀请后，会显示在这里。</view>
      </view>

      <view v-for="invite in pendingInvites" :key="invite.id" class="invite-card">
        <view class="invite-title">{{ titleOf(invite) }}</view>
        <view class="invite-desc">{{ descOf(invite) }}</view>
        <view class="invite-actions">
          <uv-button text="接受" color="#2E70FC" :customStyle="{ height: '82rpx' }" :customTextStyle="{ fontSize: '30rpx' }" @click="acceptInvite(invite)" />
          <view class="button-gap"></view>
          <uv-button text="拒绝" color="#F3F4F6" :customStyle="{ height: '82rpx' }" :customTextStyle="{ color: '#6B7280', fontSize: '30rpx' }" @click="rejectInvite(invite)" />
        </view>
      </view>

      <view class="section-title history-title">历史邀请</view>
      <view v-if="historyInvites.length === 0" class="soft-text">暂无历史邀请。</view>
      <view v-for="invite in historyInvites" :key="invite.id" class="history-card">
        <view class="history-main">{{ titleOf(invite) }}</view>
        <view class="history-desc">{{ invite.statusText }} · {{ invite.createTime || '' }}</view>
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
.section-title {
  margin-top: 30rpx;
  color: #111827;
  font-size: 36rpx;
  font-weight: 900;
}
.history-title {
  margin-top: 42rpx;
}
.empty,
.empty-card,
.invite-card,
.history-card {
  margin-top: 22rpx;
  padding: 32rpx;
  border-radius: 24rpx;
  background: #ffffff;
}
.empty,
.empty-card {
  text-align: center;
}
.empty-title,
.invite-title,
.history-main {
  color: #111827;
  font-size: 32rpx;
  font-weight: 800;
  line-height: 1.5;
}
.empty-desc,
.invite-desc,
.history-desc,
.soft-text {
  margin-top: 12rpx;
  color: #6b7280;
  font-size: 28rpx;
  line-height: 1.6;
}
.invite-actions {
  display: flex;
  align-items: center;
  margin-top: 26rpx;
}
.invite-actions :deep(.uv-button) {
  flex: 1;
}
.button-gap {
  width: 18rpx;
  flex: 0 0 18rpx;
}
.soft-text {
  padding: 26rpx 0;
}
</style>
