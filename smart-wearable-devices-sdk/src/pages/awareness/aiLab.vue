<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { getAiLabStatus, requestH5Ticket } from '@/common/api/aiLab';
import AiHealthAgentEntry from '@/pages/health/components/AiHealthAgentEntry.vue';

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
const isOpeningH5 = ref(false);
const XIAOQING_BASE_URL = 'https://sh.qkeering.com/xiaoqing/';
const XIAOQING_TODAY_SCENE_ID = 'xiaoqing_today';

const actionText = computed(() => {
  if (isLoading.value || isOpeningH5.value) return '加载中';
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

const openApprovedPage = async () => {
  if (!jumpUrl.value) {
    uni.showToast({ title: '体验页面暂未配置，请稍后再试', icon: 'none' });
    return;
  }

  let url = jumpUrl.value.trim();
  if (url === XIAOQING_BASE_URL) {
    if (isOpeningH5.value) return;
    isOpeningH5.value = true;
    try {
      const response: any = await requestH5Ticket({
        sceneId: XIAOQING_TODAY_SCENE_ID
      });
      const ticket = String(response?.ticket || response?.data?.ticket || '').trim();
      if (!ticket) throw new Error('H5 ticket 为空');
      url =
        `${XIAOQING_BASE_URL}` +
        `?ticket=${encodeURIComponent(ticket)}` +
        `&tab=today` +
        `&sceneId=${XIAOQING_TODAY_SCENE_ID}`;
    } catch (error) {
      console.warn('[AiLab] 获取小轻登录票据失败', error);
      uni.showToast({ title: '登录凭证获取失败，请稍后再试', icon: 'none' });
      return;
    } finally {
      isOpeningH5.value = false;
    }
  }
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
  if (isLoading.value || isOpeningH5.value || applyStatus.value === APPLY_STATUS.applying) return;

  if (applyStatus.value === APPLY_STATUS.passed) {
    void openApprovedPage();
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
  <view
    class="ai-lab-container"
    :class="{ disabled: isLoading || isOpeningH5 || applyStatus === APPLY_STATUS.applying }"
  >
    <AiHealthAgentEntry @tap="handleApplyClick" />
    <view class="ai-lab-action" @tap.stop="handleApplyClick">
      <text>{{ actionText }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-lab-container {
  position: relative;

  &.disabled {
    opacity: 0.82;
  }
}

.ai-lab-action {
  position: absolute;
  z-index: 3;
  top: 28rpx;
  left: 300rpx;
  min-width: 88rpx;
  height: 48rpx;
  padding: 0 18rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.88);
  color: #2e70fc;
  font-size: 22rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6rpx 18rpx rgba(46, 112, 252, 0.1);
}
</style>
