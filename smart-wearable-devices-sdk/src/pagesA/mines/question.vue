<script setup lang="ts">
import '@/pagesA/mines/i18n/pack';
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getfqaGuidList } from '@/common/api/userGuide';
import type { FqaGuidItem } from '@/types/api/userGuides';
import { getMiniProgramVersionText } from '@/utils/miniProgramVersion';
import { useI18n, usePageTitle } from '@/i18n';

const { t } = useI18n();
usePageTitle(() => t('常见问题'));

type LocalFqaGuidItem = {
  id: string;
  title: string;
  local: true;
};

const list = ref<FqaGuidItem[]>([]);
const loading = ref(false);
const showCommandDebugEntry = ref(false);
const debugTapCount = ref(0);
let debugTapTimer: ReturnType<typeof setTimeout> | null = null;

const miniProgramVersionText = computed(getMiniProgramVersionText);

const localQuestionItems: LocalFqaGuidItem[] = [
  {
    id: 'ring-connect-failed',
    title: '连接不上戒指',
    local: true
  }
];

const displayList = computed(() => {
  const localTitles = new Set(localQuestionItems.map((item) => item.title));
  const serverItems = list.value.filter((item) => !localTitles.has(item.title || ''));
  return [...localQuestionItems, ...serverItems];
});

const openDetail = (item: FqaGuidItem | LocalFqaGuidItem) => {
  const title = encodeURIComponent(item.title || '常见问题');
  if ('local' in item && item.local) {
    (uni as any).$uv.route(`/pagesA/mines/detail?local=${item.id}&title=${title}`);
    return;
  }
  if (!item?.id) return;
  (uni as any).$uv.route(`/pagesA/mines/detail?id=${item.id}&title=${title}`);
};

const openCommandDebug = () => {
  uni.navigateTo({
    url: '/pagesA/mines/bleCommandDebug'
  });
};

const openOnlineFeedback = () => {
  uni.navigateTo({
    url: '/pagesA/mines/onlineFeedback?source=faq_list'
  });
};

const handleVersionTap = () => {
  if (debugTapTimer) {
    clearTimeout(debugTapTimer);
    debugTapTimer = null;
  }

  debugTapCount.value += 1;
  if (debugTapCount.value >= 3) {
    debugTapCount.value = 0;
    showCommandDebugEntry.value = true;
    uni.showToast({
      title: t('调试入口已开启'),
      icon: 'none'
    });
    return;
  }

  debugTapTimer = setTimeout(() => {
    debugTapCount.value = 0;
    debugTapTimer = null;
  }, 1200);
};

onLoad(async () => {
  loading.value = true;
  try {
    const res = await getfqaGuidList({ type: 1 });
    list.value = Array.isArray(res) ? res : [];
  } catch {
    list.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <view class="mine-list-page p-30">
    <view class="page-title">{{ t('常见问题') }}</view>
    <view
      v-for="item in displayList"
      :key="item.id"
      @click="openDetail(item)"
      class="bg-white p-40 r-50 flex jc-between ai-center mb-30"
    >
      <view class="fs-36">{{ t(item.title) }}</view>
      <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
    </view>

    <view v-if="showCommandDebugEntry" class="debug-entry" @click="openCommandDebug">
      <view>
        <view class="debug-title">{{ t('BLE 命令测试') }}</view>
        <view class="debug-desc">{{ t('临时入口：验证血氧、心率、电量等命令回执') }}</view>
      </view>
      <uv-icon name="arrow-right" color="#3478f6" size="14"></uv-icon>
    </view>

    <view class="feedback-entry" @click="openOnlineFeedback">
      <view>
        <view class="feedback-title">{{ t('没有解决你的问题？') }}</view>
        <view class="feedback-desc">{{ t('提交问题反馈，附带设备和页面信息，便于定位。') }}</view>
      </view>
      <view class="feedback-action">
        <text>{{ t('在线反馈') }}</text>
        <uv-icon name="arrow-right" color="#3478f6" size="14"></uv-icon>
      </view>
    </view>

    <view class="debug-version" @click="handleVersionTap">{{ miniProgramVersionText }}</view>
  </view>
</template>

<style lang="scss" scoped>
.mine-list-page {
  min-height: 100vh;
  background: #f1f3f6;
  box-sizing: border-box;
}

.page-title {
  margin-bottom: 24rpx;
  color: #111827;
  font-size: 44rpx;
  font-weight: 700;
}

.debug-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 48rpx;
  padding: 30rpx 34rpx;
  border: 1rpx dashed rgba(52, 120, 246, 0.35);
  border-radius: 32rpx;
  background: rgba(52, 120, 246, 0.08);
}

.debug-title {
  color: #1f5fd6;
  font-size: 30rpx;
  font-weight: 700;
}

.debug-desc {
  margin-top: 8rpx;
  color: #6b7280;
  font-size: 24rpx;
  line-height: 1.35;
}

.debug-version {
  margin-top: 56rpx;
  padding: 20rpx 0 40rpx;
  color: #a7abb3;
  font-size: 22rpx;
  text-align: center;
}

.feedback-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 30rpx;
  padding: 32rpx 34rpx;
  border-radius: 32rpx;
  background: #fff;
}

.feedback-title {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.feedback-desc {
  margin-top: 8rpx;
  color: #8b93a3;
  font-size: 24rpx;
  line-height: 1.35;
}

.feedback-action {
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: #3478f6;
  flex: 0 0 auto;
  font-size: 26rpx;
  font-weight: 700;
}
</style>
