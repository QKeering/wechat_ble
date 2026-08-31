<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getfqaGuidList } from '@/common/api/userGuide';
import type { FqaGuidItem } from '@/types/api/userGuides';
import { getMiniProgramVersionText } from '@/utils/miniProgramVersion';

type LocalGuideItem = {
  id: string;
  title: string;
  local: true;
};

const guideList = ref<FqaGuidItem[]>([]);
const questionList = ref<FqaGuidItem[]>([]);
const loading = ref(false);
const showCommandDebugEntry = ref(false);
const debugTapCount = ref(0);
let debugTapTimer: ReturnType<typeof setTimeout> | null = null;
const miniProgramVersionText = computed(getMiniProgramVersionText);

const localGuideItems: LocalGuideItem[] = [
  {
    id: 'charging-case-indicator',
    title: '充电仓状态指示灯说明',
    local: true
  }
];

const localQuestionItems: LocalGuideItem[] = [
  {
    id: 'ring-connect-failed',
    title: '连接不上戒指',
    local: true
  }
];

const fallbackGuideItems = [
  '请保持戒指有电，并确保戒指贴合佩戴。',
  '在“我的”页面点击去配对或重新连接设备。',
  '连接成功后进入首页下拉刷新，同步历史数据后查看健康概览。'
];

const displayedGuideItems = computed(() => {
  const localTitles = new Set(localGuideItems.map((item) => item.title));
  return [...localGuideItems, ...guideList.value.filter((item) => !localTitles.has(item.title || ''))];
});

const displayedQuestionItems = computed(() => {
  const localTitles = new Set(localQuestionItems.map((item) => item.title));
  return [...localQuestionItems, ...questionList.value.filter((item) => !localTitles.has(item.title || ''))];
});

const openDetail = (item: FqaGuidItem | LocalGuideItem) => {
  const title = encodeURIComponent(item.title || '使用指南');
  if ('local' in item && item.local) {
    (uni as any).$uv.route(`/pagesA/mines/detail?local=${item.id}&title=${title}`);
    return;
  }
  if (!item?.id) return;
  (uni as any).$uv.route(`/pagesA/mines/detail?id=${item.id}&title=${title}`);
};

const openCommandDebug = () => {
  uni.navigateTo({ url: '/pagesA/mines/bleCommandDebug' });
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
    uni.showToast({ title: '调试入口已开启', icon: 'none' });
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
    const [guides, questions] = await Promise.allSettled([
      getfqaGuidList({ type: 2 }),
      getfqaGuidList({ type: 1 })
    ]);
    guideList.value = guides.status === 'fulfilled' && Array.isArray(guides.value) ? guides.value : [];
    questionList.value = questions.status === 'fulfilled' && Array.isArray(questions.value) ? questions.value : [];
  } catch {
    guideList.value = [];
    questionList.value = [];
  } finally {
    loading.value = false;
  }
});
</script>
<template>
  <view class="mine-list-page p-30">
    <view class="page-title">使用指南</view>
    <view
      v-for="item in displayedGuideItems"
      :key="item.id"
      @click="openDetail(item)"
      class="bg-white p-40 r-50 flex jc-between ai-center mb-30"
    >
      <view class="fs-36">{{ item.title }}</view>
      <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
    </view>
    <view v-if="!loading && guideList.length === 0" class="fallback-card">
      <view v-for="(item, index) in fallbackGuideItems" :key="item" class="fallback-item">
        {{ index + 1 }}. {{ item }}
      </view>
    </view>

    <view
      v-for="item in displayedQuestionItems"
      :key="`question-${item.id}`"
      @click="openDetail(item)"
      class="bg-white p-40 r-50 flex jc-between ai-center mb-30"
    >
      <view class="fs-36">{{ item.title }}</view>
      <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
    </view>

    <view v-if="showCommandDebugEntry" class="debug-entry" @click="openCommandDebug">
      <view>
        <view class="debug-title">BLE 命令测试</view>
        <view class="debug-desc">临时入口：验证血氧、心率、电量等命令回执</view>
      </view>
      <uv-icon name="arrow-right" color="#3478f6" size="14"></uv-icon>
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

.fallback-card {
  padding: 32rpx;
  border-radius: 24rpx;
  background: #fff;
}

.fallback-item {
  margin-bottom: 24rpx;
  color: #374151;
  font-size: 32rpx;
  line-height: 1.6;
}

.fallback-item:last-child {
  margin-bottom: 0;
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
</style>
