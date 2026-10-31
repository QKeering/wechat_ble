<script setup lang="ts">
import '@/pages/family/i18n/pack';
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { acceptFamilyInvite, getFamilyInvites, rejectFamilyInvite, type FamilyInvite } from '@/common/api/family';
import { useI18n } from '@/i18n';

const { t } = useI18n();

const loading = ref(false);
const processingId = ref<number | string | null>(null);
const remark = ref('');
const invites = ref<FamilyInvite[]>([]);
const pendingInvites = computed(() => invites.value.filter(item => (
  Number(item.status) === 0 && (item.isReceived === true || item.direction === 'received')
)));
const scopeLabels = ['睡眠', '心率', '血氧', '步数', '压力趋势'];

const inviterName = (item: FamilyInvite) => item.inviterName || item.relationName || '亲友';

async function loadInvites() {
  loading.value = true;
  try {
    invites.value = await getFamilyInvites();
  } catch (error) {
    console.warn('[family-share] load invites failed', error);
    uni.showToast({ title: t('邀请加载失败'), icon: 'none' });
  } finally {
    loading.value = false;
  }
}

async function handleInvite(item: FamilyInvite, accept: boolean) {
  if (processingId.value !== null) return;
  processingId.value = item.id;
  try {
    if (accept) {
      await acceptFamilyInvite(item.inviteCode);
      uni.showToast({ title: t('已接受邀请'), icon: 'success' });
      setTimeout(() => uni.redirectTo({ url: '/pages/family/family' }), 350);
    } else {
      await rejectFamilyInvite(item.inviteCode);
      uni.showToast({ title: t('已拒绝邀请'), icon: 'success' });
      await loadInvites();
    }
  } catch (error) {
    console.warn('[family-share] handle invite failed', error);
    uni.showToast({ title: t('处理失败，请稍后重试'), icon: 'none' });
  } finally {
    processingId.value = null;
  }
}

onShow(loadInvites);
onPullDownRefresh(async () => {
  await loadInvites();
  uni.stopPullDownRefresh();
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder :title="t('亲友邀请')" bgColor="transparent" />
    <view v-if="loading" class="state-card">{{ t('正在加载邀请...') }}</view>
    <view v-else-if="pendingInvites.length === 0" class="state-card">
      <view class="empty-icon">✓</view>
      <view class="empty-title">{{ t('暂无待处理邀请') }}</view>
      <view class="empty-desc">{{ t('收到亲友的健康共享邀请后，会显示在这里。') }}</view>
    </view>
    <view v-else>
      <view v-for="item in pendingInvites" :key="item.id" class="invite-card">
        <view class="inviter">
          <view class="avatar">{{ inviterName(item).slice(0, 1) }}</view>
          <view>
            <view class="inviter-name">{{ inviterName(item) }}</view>
            <view class="invite-tip">{{ t('邀请你查看其健康数据') }}</view>
          </view>
        </view>
        <view class="scope-title">{{ t('共享内容') }}</view>
        <view class="scope-list">
          <view v-for="label in scopeLabels" :key="label" class="scope-chip">{{ t(label) }}</view>
        </view>
        <textarea v-model="remark" class="remark" maxlength="20" :placeholder="t('备注名称（选填）')" />
        <view class="expire">{{ t('邀请有效期至 {time}', { time: item.expireTime || t('7 天后') }) }}</view>
        <button class="accept-button" :loading="processingId === item.id" @click="handleInvite(item, true)">{{ t('接受邀请') }}</button>
        <button class="reject-button" :disabled="processingId !== null" @click="handleInvite(item, false)">{{ t('暂不接受') }}</button>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page{min-height:100vh;box-sizing:border-box;padding:0 28rpx 64rpx;background:linear-gradient(180deg,#eef4ff 0,#f3f5f8 360rpx)}
.state-card,.invite-card{margin-top:28rpx;padding:36rpx;border-radius:30rpx;background:#fff;box-shadow:0 12rpx 36rpx rgba(42,73,128,.07)}.state-card{text-align:center;color:#8b94a3;font-size:28rpx}.empty-icon{display:flex;align-items:center;justify-content:center;width:96rpx;height:96rpx;margin:12rpx auto 24rpx;border-radius:50%;background:#eaf7ef;color:#3ab873;font-size:42rpx}.empty-title{font-size:34rpx;font-weight:800;color:#172033}.empty-desc{margin-top:12rpx;line-height:1.6}
.inviter{display:flex;align-items:center}.avatar{display:flex;align-items:center;justify-content:center;width:94rpx;height:94rpx;margin-right:22rpx;border-radius:30rpx;background:linear-gradient(135deg,#4e87ff,#2767f2);color:#fff;font-size:38rpx;font-weight:800}.inviter-name{font-size:36rpx;font-weight:800;color:#172033}.invite-tip{margin-top:7rpx;font-size:27rpx;color:#828b9a}.scope-title{margin-top:34rpx;font-size:28rpx;font-weight:700;color:#3f4857}.scope-list{display:flex;flex-wrap:wrap;gap:14rpx;margin-top:16rpx}.scope-chip{padding:13rpx 22rpx;border-radius:999rpx;background:#edf3ff;color:#2e70fc;font-size:26rpx}.remark{box-sizing:border-box;width:100%;height:88rpx;margin-top:26rpx;padding:22rpx;border-radius:18rpx;background:#f6f8fb;font-size:28rpx}.expire{margin-top:18rpx;font-size:25rpx;text-align:center;color:#9aa2af}.accept-button,.reject-button{height:92rpx;border:0;border-radius:24rpx;font-size:31rpx;font-weight:700;line-height:92rpx}.accept-button{margin-top:26rpx;background:#2e70fc;color:#fff}.reject-button{margin-top:16rpx;background:#f2f4f7;color:#6f7886}.accept-button::after,.reject-button::after{border:0}
</style>
