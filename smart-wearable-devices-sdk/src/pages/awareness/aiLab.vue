<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { useI18n } from '@/i18n';
import { getAiLabStatus } from '@/common/api/aiLab';
import AiHealthAgentEntry from '@/pages/health/components/AiHealthAgentEntry.vue';

enum APPLY_STATUS {
  not_apply = -1,
  applying = 0,
  passed = 1,
  rejected = 2
}

const { t } = useI18n();
const applyStatus = ref<APPLY_STATUS>(APPLY_STATUS.not_apply);
const jumpUrl = ref('');
const remark = ref('');
const isLoading = ref(false);
const isOpeningH5 = ref(false);
const isXiaoqingH5Url = (value: string) =>
  /^https:\/\/sh\.qkeering\.com\/xiaoqin(?:g)?(?:\/|[?#]|$)/i.test(String(value || '').trim());
const openFullWebviewUrl = (value: string, needsXiaoqingTicket = false) => {
  const handoffId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storageKey = `qkeer:webview-handoff:${handoffId}`;
  const targetPage = '/pages/webview-custom/webview-custom';
  const ticketFlag = needsXiaoqingTicket ? '&xiaoqingTicket=1' : '';
  // Passing a complete URL through the mini-program route query is fragile:
  // some runtimes decode it before splitting `&`, which drops ticket params.
  // Hand off the short-lived URL through Storage and put only an opaque key in
  // the page route. The WebView page consumes and removes it immediately.
  try {
    // iOS WebView can invoke the asynchronous storage callback before the
    // value is visible to the newly opened page. A synchronous write plus a
    // read-back makes the handoff deterministic.
    uni.setStorageSync(storageKey, value);
    const storedValue = String(uni.getStorageSync(storageKey) || '').trim();
    if (storedValue !== value.trim()) throw new Error('WebView URL handoff verification failed');
    uni.navigateTo({ url: `${targetPage}?handoff=${encodeURIComponent(handoffId)}${ticketFlag}` });
  } catch (error) {
    console.warn('[AiLab] URL Storage 交接失败，使用路由参数降级', error);
    // Keep the authentication marker on the fallback route as well. Missing
    // this flag caused iOS to open Xiaoqing without requesting a ticket.
    uni.navigateTo({
      url: `${targetPage}?url=${encodeURIComponent(value)}${ticketFlag}`
    });
  }
};

const actionText = computed(() => {
  if (isLoading.value || isOpeningH5.value) return t('加载中');
  switch (applyStatus.value) {
    case APPLY_STATUS.applying:
      return t('审核中');
    case APPLY_STATUS.passed:
      return t('进入');
    case APPLY_STATUS.rejected:
      return t('重新申请');
    default:
      return t('申请体验');
  }
});

const openApprovedPage = async () => {
  const configuredUrl = jumpUrl.value.trim();
  if (!configuredUrl) {
    uni.showToast({ title: t('体验页面暂未配置，请稍后再试'), icon: 'none' });
    return;
  }

  if (isOpeningH5.value) return;
  const url = configuredUrl;
  if (url.startsWith('/pages/')) {
    uni.navigateTo({ url });
    return;
  }

  if (!/^https?:\/\//i.test(url) && url.includes('#')) {
    const route = url.substring(url.indexOf('#'));
    uni.navigateTo({
      url: `/pages/webview-custom/webview-custom?route=${encodeURIComponent(route)}`
    });
    return;
  }

  console.info('[AiLab] H5 地址已生成', {
    isXiaoqing: isXiaoqingH5Url(url),
    hasTicket: /[?&]ticket=/.test(url),
    hasSceneId: /[?&]sceneId=xiaoqing_today(?:&|#|$)/.test(url)
  });
  openFullWebviewUrl(url, isXiaoqingH5Url(configuredUrl));
};

const handleApplyClick = () => {
  if (isLoading.value || isOpeningH5.value || applyStatus.value === APPLY_STATUS.applying) return;

  if (applyStatus.value === APPLY_STATUS.passed) {
    void openApprovedPage();
    return;
  }

  if (applyStatus.value === APPLY_STATUS.rejected && remark.value) {
    uni.showModal({
      title: t('申请未通过'),
      content: t('拒绝原因：{remark}', { remark: remark.value }),
      confirmText: t('重新申请'),
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
