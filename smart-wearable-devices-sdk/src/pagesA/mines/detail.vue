<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getfqaGuidDetail } from '@/common/api/userGuide';
const content = ref<string>('');
const loading = ref(false);

const decodeTitle = (title: string) => {
  try {
    return decodeURIComponent(title);
  } catch {
    return title;
  }
};

onLoad(async (e) => {
  if (e?.title) {
    uni.setNavigationBarTitle({
      title: decodeTitle(String(e.title))
    });
  }
  if (e?.id) {
    loading.value = true;
    try {
      const res = await getfqaGuidDetail({ id: e.id });
      content.value = res?.content || '';
    } catch {
      content.value = '';
    } finally {
      loading.value = false;
    }
  }
});
</script>

<template>
  <view class="mine-detail-page p-30">
    <uv-parse v-if="content" :content="content"></uv-parse>
    <view v-else-if="!loading" class="empty">暂无详情内容</view>
  </view>
</template>

<style lang="scss" scoped>
.mine-detail-page {
  min-height: 100vh;
  background: #f1f3f6;
  box-sizing: border-box;
}

.empty {
  padding: 80rpx 24rpx;
  color: #979797;
  font-size: 30rpx;
  text-align: center;
}
</style>
