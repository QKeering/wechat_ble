<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getfqaGuidList } from '@/common/api/userGuide';
import type { FqaGuidItem } from '@/types/api/userGuides';

const list = ref<FqaGuidItem[]>([]);
const loading = ref(false);
const fallbackGuideItems = [
  '请保持戒指有电，并确保戒指贴合佩戴。',
  '在“我的”页面点击去配对或重新连接设备。',
  '连接成功后进入首页下拉刷新，同步历史数据后查看健康概览。'
];

const openDetail = (item: FqaGuidItem) => {
  if (!item?.id) return;
  const title = encodeURIComponent(item.title || '使用指南');
  (uni as any).$uv.route(`/pagesA/mines/detail?id=${item.id}&title=${title}`);
};

onLoad(async () => {
  loading.value = true;
  try {
    const res = await getfqaGuidList({ type: 2 });
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
    <view class="page-title">使用指南</view>
    <view
      v-for="item in list"
      :key="item.id"
      @click="openDetail(item)"
      class="bg-white p-40 r-50 flex jc-between ai-center mb-30"
    >
      <view class="fs-36">{{ item.title }}</view>
      <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
    </view>
    <view v-if="!loading && list.length === 0" class="fallback-card">
      <view v-for="(item, index) in fallbackGuideItems" :key="item" class="fallback-item">
        {{ index + 1 }}. {{ item }}
      </view>
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
</style>
