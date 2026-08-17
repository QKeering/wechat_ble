<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { createFamilyInvite, deleteFamilyRelation, getFamilyGuardians, type FamilyGuardian } from '@/common/api/family';

const loading = ref(false);
const inviting = ref(false);
const guardians = ref<FamilyGuardian[]>([]);
const inviteCode = ref('');
const expireTime = ref('');
const miniProgramCodeUrl = ref('');

const hasGuardians = computed(() => guardians.value.length > 0);

const guardianName = (item: FamilyGuardian) => item.guardianName || item.guardianPhoneMasked || item.name || '亲友';

function goFamilyHome() {
  uni.redirectTo({
    url: '/pages/family/family',
    fail: () => uni.reLaunch({ url: '/pages/family/family' })
  });
}

function goBack() {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1, fail: goFamilyHome });
    return;
  }
  goFamilyHome();
}

async function loadGuardians() {
  loading.value = true;
  try {
    guardians.value = await getFamilyGuardians();
  } catch (error) {
    console.warn('[family-share] load guardians failed', error);
    uni.showToast({ title: '共享关系加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}

async function createInvite() {
  if (inviting.value) return;
  inviting.value = true;
  try {
    const result = await createFamilyInvite({ inviteType: 1 });
    inviteCode.value = result.inviteCode;
    expireTime.value = result.expireTime;
    miniProgramCodeUrl.value = result.miniProgramCodeUrl;
  } catch (error) {
    console.warn('[family-share] create invite failed', error);
    uni.showToast({ title: '邀请生成失败，请稍后重试', icon: 'none' });
  } finally {
    inviting.value = false;
  }
}

function copyInvite() {
  if (!inviteCode.value) return;
  uni.setClipboardData({
    data: inviteCode.value,
    success: () => uni.showToast({ title: '邀请码已复制', icon: 'success' })
  });
}

function cancelShare(item: FamilyGuardian) {
  const relationId = Number(item.relationId || item.memberId);
  if (!relationId) {
    uni.showToast({ title: '共享关系信息缺失', icon: 'none' });
    return;
  }
  uni.showModal({
    title: '取消共享',
    content: `取消后，${guardianName(item)} 将不能继续查看你的健康数据；如需再次共享，需要重新申请。`,
    confirmText: '确认取消',
    confirmColor: '#ef4444',
    success: async ({ confirm }) => {
      if (!confirm) return;
      try {
        await deleteFamilyRelation(relationId);
        uni.showToast({ title: '已取消共享', icon: 'success' });
        await loadGuardians();
      } catch (error) {
        console.warn('[family-share] cancel relation failed', error);
        uni.showToast({ title: '取消失败，请稍后重试', icon: 'none' });
      }
    }
  });
}

onShow(loadGuardians);
onPullDownRefresh(async () => {
  await loadGuardians();
  uni.stopPullDownRefresh();
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="分享我的数据" bgColor="transparent" @leftClick="goBack" />

    <view class="section-card">
      <view class="section-title">我的共享</view>
      <view class="section-desc">正在查看你健康数据的亲友。取消后需要重新申请才能恢复。</view>
      <view v-if="loading" class="state-text">正在加载...</view>
      <view v-else-if="!hasGuardians" class="empty-row">暂未分享给任何亲友</view>
      <view v-else class="guardian-list">
        <view v-for="item in guardians" :key="item.relationId || item.memberId" class="guardian-row">
          <view class="avatar">{{ guardianName(item).slice(0, 1) }}</view>
          <view class="guardian-info">
            <view class="guardian-name">{{ guardianName(item) }}</view>
            <view class="guardian-status">健康数据共享中</view>
          </view>
          <view class="cancel-action" @click="cancelShare(item)">取消</view>
        </view>
      </view>
    </view>

    <view class="invite-card">
      <view class="invite-icon">邀</view>
      <view class="invite-title">邀请亲友关注你</view>
      <view class="invite-desc">一键生成 7 天有效的邀请。对方接受后即可查看你的健康概览。</view>
      <button v-if="!inviteCode" class="primary-button" :loading="inviting" @click="createInvite">生成邀请</button>
      <view v-else class="result-panel">
        <view class="result-label">方式一：微信扫码进入小程序</view>
        <view class="qr-box">
          <image v-if="miniProgramCodeUrl" class="mini-code" :src="miniProgramCodeUrl" mode="aspectFit" />
          <view v-else class="code-loading">小程序码生成中...</view>
        </view>
        <view class="result-expire">小程序码有效期至 {{ expireTime || '7 天后' }}</view>
        <view class="result-label manual-label">方式二：输入邀请码</view>
        <view class="result-code">{{ inviteCode }}</view>
        <button class="primary-button" @click="copyInvite">复制邀请码</button>
        <view class="new-invite" @click="createInvite">重新生成</view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page{min-height:100vh;box-sizing:border-box;padding:0 28rpx 64rpx;background:linear-gradient(180deg,#eef4ff 0,#f3f5f8 360rpx)}
.section-card,.invite-card{margin-top:26rpx;padding:34rpx;border-radius:30rpx;background:#fff;box-shadow:0 12rpx 36rpx rgba(42,73,128,.07)}
.section-title,.invite-title{font-size:38rpx;font-weight:800;color:#172033}.section-desc,.invite-desc{margin-top:12rpx;font-size:28rpx;line-height:1.6;color:#7b8495}
.state-text,.empty-row{padding:48rpx 0 18rpx;text-align:center;font-size:28rpx;color:#9aa2af}.guardian-list{margin-top:20rpx}.guardian-row{display:flex;align-items:center;padding:24rpx 0;border-top:1rpx solid #edf0f4}.avatar{display:flex;align-items:center;justify-content:center;width:84rpx;height:84rpx;border-radius:50%;background:#e8f0ff;color:#2e70fc;font-size:34rpx;font-weight:800}.guardian-info{flex:1;margin-left:20rpx}.guardian-name{font-size:31rpx;font-weight:700;color:#1c2434}.guardian-status{margin-top:7rpx;font-size:25rpx;color:#929aa7}.cancel-action{padding:14rpx 22rpx;border-radius:999rpx;background:#fff0f1;color:#e44952;font-size:27rpx}
.invite-card{text-align:center}.invite-icon{display:flex;align-items:center;justify-content:center;width:98rpx;height:98rpx;margin:4rpx auto 22rpx;border-radius:30rpx;background:linear-gradient(135deg,#4e87ff,#2767f2);color:#fff;font-size:38rpx;font-weight:800}.primary-button{height:92rpx;margin-top:30rpx;border:0;border-radius:24rpx;background:#2e70fc;color:#fff;font-size:32rpx;font-weight:700;line-height:92rpx}.primary-button::after{border:0}.result-panel{margin-top:28rpx;padding:26rpx;border-radius:24rpx;background:#f6f8fc}.result-label{font-size:25rpx;color:#9098a6}.result-code{margin-top:8rpx;font-size:52rpx;font-weight:800;letter-spacing:6rpx;color:#172033}.result-expire{margin-top:8rpx;font-size:25rpx;color:#929aa7}.link-box{margin-top:22rpx;padding:20rpx;border-radius:16rpx;background:#fff;color:#6d7686;font-size:24rpx;line-height:1.5;word-break:break-all}.new-invite{padding-top:24rpx;color:#2e70fc;font-size:27rpx}
.manual-label{margin-top:28rpx}.qr-box{display:flex;align-items:center;justify-content:center;width:420rpx;min-height:420rpx;margin:18rpx auto 10rpx;border-radius:22rpx;background:#fff}.mini-code{width:390rpx;height:390rpx}.code-loading{font-size:25rpx;color:#929aa7}
</style>
