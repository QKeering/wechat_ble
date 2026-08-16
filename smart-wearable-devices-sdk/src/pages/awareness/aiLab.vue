<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { getAiLabStatus } from '@/common/api/aiLab';

enum APPLY_STATUS {
  not_apply = -1,
  applying = 0,
  passed = 1,
  rejected = 2
}

const applyStatus = ref<APPLY_STATUS>(APPLY_STATUS.not_apply);
const jumpUrl = ref('');
const remark = ref('');
const isLoading = ref(false);

const actionText = computed(() => {
  if (isLoading.value) return '加载中';
  switch (applyStatus.value) {
    case APPLY_STATUS.applying:
      return '审核中';
    case APPLY_STATUS.passed:
      return '进入';
    case APPLY_STATUS.rejected:
      return '重新申请';
    default:
      return '申请体验';
  }
});

const openApprovedPage = () => {
  if (!jumpUrl.value) {
    uni.showToast({ title: '体验页面暂未配置，请稍后再试', icon: 'none' });
    return;
  }

  const url = jumpUrl.value.trim();
  if (url.startsWith('/pages/')) {
    uni.navigateTo({ url });
    return;
  }

  if (url.includes('#')) {
    const route = url.substring(url.indexOf('#'));
    uni.navigateTo({
      url: `/pages/webview-custom/webview-custom?route=${encodeURIComponent(route)}`
    });
    return;
  }

  uni.navigateTo({
    url: `/pages/webview-custom/webview-custom?url=${encodeURIComponent(url)}`
  });
};

const handleApplyClick = () => {
  if (isLoading.value || applyStatus.value === APPLY_STATUS.applying) return;

  if (applyStatus.value === APPLY_STATUS.passed) {
    openApprovedPage();
    return;
  }

  if (applyStatus.value === APPLY_STATUS.rejected && remark.value) {
    uni.showModal({
      title: '申请未通过',
      content: `拒绝原因：${remark.value}`,
      confirmText: '重新申请',
      success: ({ confirm }) => {
        if (confirm) uni.navigateTo({ url: '/pages/awareness/aiApply' });
      }
    });
    return;
  }

  uni.navigateTo({ url: '/pages/awareness/aiApply' });
};

const fetchApplyStatus = async () => {
  if (isLoading.value) return;
  isLoading.value = true;
  try {
    const result: any = await getAiLabStatus();
    if (result && typeof result.status === 'number') {
      applyStatus.value = result.status as APPLY_STATUS;
      jumpUrl.value = result.jumpUrl || '';
      remark.value = result.remark || '';
    }
  } catch (error) {
    console.warn('[AiLab] 获取申请状态失败', error);
  } finally {
    isLoading.value = false;
  }
};

onLoad(() => uni.$on('refreshAiStatus', fetchApplyStatus));
onShow(fetchApplyStatus);
onUnload(() => uni.$off('refreshAiStatus', fetchApplyStatus));
</script>

<template>
  <view class="ai-lab-container">
    <view class="ai-lab-card" @tap="handleApplyClick">
      <view class="ai-lab-icon">
        <uv-image src="/static/images/brain.png" width="92rpx" height="92rpx"></uv-image>
      </view>

      <view class="ai-lab-content">
        <text class="ai-lab-title">Ai lab</text>
        <text class="ai-lab-subtitle">会听你说，也更懂你的状态</text>
        <text class="ai-lab-desc">AI融合多维健康大数据，生成健康、美丽、成长建议</text>
      </view>

      <view class="ai-lab-button" :class="{ disabled: isLoading || applyStatus === APPLY_STATUS.applying }">
        <text>{{ actionText }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-lab-container {
  display: flex;
  justify-content: center;
  align-items: center;
}

.ai-lab-card {
  width: 100%;
  display: flex;
  align-items: center;
  overflow: hidden;
  border-radius: 36rpx;
  background: linear-gradient(135deg, #fff8fd 0%, #fff4fa 55%, #fffafd 100%);
}

.ai-lab-icon {
  width: 108rpx;
  height: 108rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #5f7cff 0%, #9b6dff 100%);
  display: flex;
  justify-content: center;
  align-items: center;
  margin-right: 22rpx;
  flex-shrink: 0;
  box-shadow: 0 8rpx 24rpx rgba(104, 102, 255, 0.22);
}

.ai-lab-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ai-lab-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #2b2f3a;
  line-height: 1.2;
}

.ai-lab-subtitle {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #697181;
  line-height: 1.35;
}

.ai-lab-desc {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #8d94a3;
  line-height: 1.35;
}

.ai-lab-button {
  min-width: 84rpx;
  height: 52rpx;
  padding: 0 16rpx;
  margin-left: 18rpx;
  border-radius: 26rpx;
  background: #ffffff;
  color: #2e70fc;
  font-size: 24rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 6rpx 18rpx rgba(46, 112, 252, 0.12);

  &.disabled {
    color: #9aa1ae;
    box-shadow: none;
  }
}
</style>
