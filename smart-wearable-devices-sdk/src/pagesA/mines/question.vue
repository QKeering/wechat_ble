<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getfqaGuidList } from '@/common/api/userGuide';
import type { FqaGuidItem } from '@/types/api/userGuides';
const list = ref<FqaGuidItem[]>([]);
const loading = ref(false);
const fallbackQuestionItems = [
  {
    question: '搜索不到戒指怎么办？',
    answer: '请确认手机蓝牙已开启、戒指靠近手机，并重新搜索设备。'
  },
  {
    question: '连接后没有数据怎么办？',
    answer: '请保持佩戴，回到首页下拉刷新同步历史数据，稍后再查看健康数据。'
  }
];

const openDetail = (item: FqaGuidItem) => {
  if (!item?.id) return;
  const title = encodeURIComponent(item.title || '常见问题');
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
      v-for="item in list"
      :key="item.id"
      @click="openDetail(item)"
      class="bg-white p-40 r-50 flex jc-between ai-center mb-30"
    >
      <view class="fs-36">{{ item.title }}</view>
      <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
    </view>
    <view v-if="!loading && list.length === 0" class="fallback-card">
      <view v-for="item in fallbackQuestionItems" :key="item.question" class="qa">
        <view class="q">{{ item.question }}</view>
        <view class="a">{{ item.answer }}</view>
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

.qa {
  margin-bottom: 32rpx;
}

.qa:last-child {
  margin-bottom: 0;
}

.q {
  color: #111827;
  font-size: 32rpx;
  font-weight: 700;
}

.a {
  margin-top: 12rpx;
  color: #6b7280;
  font-size: 30rpx;
  line-height: 1.6;
}
</style>
