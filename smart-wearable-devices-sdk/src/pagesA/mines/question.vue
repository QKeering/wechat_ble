<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getfqaGuidList } from '@/common/api/userGuide';
import type { FqaGuidItem } from '@/types/api/userGuides';

type LocalFqaGuidItem = {
  id: string;
  title: string;
  local: true;
};

const list = ref<FqaGuidItem[]>([]);
const loading = ref(false);

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
    <view class="page-title">常见问题</view>
    <view
      v-for="item in displayList"
      :key="item.id"
      @click="openDetail(item)"
      class="bg-white p-40 r-50 flex jc-between ai-center mb-30"
    >
      <view class="fs-36">{{ item.title }}</view>
      <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
    </view>
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
</style>
