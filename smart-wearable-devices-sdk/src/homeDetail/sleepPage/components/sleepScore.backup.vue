<script setup lang="ts">
import { ref, computed } from 'vue';
import ProgressBar from '@/components/progressBar.vue';
import type { sleepOverview } from '@/types/api/homeDetail';
const props = defineProps({
  sleepOverviewObj: {
    type: Object as () => sleepOverview,
    default: () => ({})
  }
});
const sleepQualityText = computed(() => {
  const quality = Number(props.sleepOverviewObj.sleepQuality);
  if (!quality || quality < 0 || quality > 100) return '--';

  if (quality >= 0 && quality <= 20) return '较差';
  if (quality >= 21 && quality <= 40) return '一般';
  if (quality >= 41 && quality <= 60) return '中等';
  if (quality >= 61 && quality <= 80) return '良好';
  if (quality >= 81 && quality <= 100) return '优秀';

  return '--';
});
</script>
<template>
  <view class="bg-white r-50 mb-30 p-30">
    <view class="">
      <view class="score-title fs-36">
        睡眠评分
        <slot></slot>
      </view>
    </view>
    <view class="flex jc-between ai-end">
      <view class="fd-c jc-center ai-center h-full">
        <view class="ta-c">
          <text class="fs-72">{{ sleepOverviewObj.sleepScore }}</text>
          <text class="fs-24">分</text>
        </view>
        <view class="t-979797">清醒了{{ sleepOverviewObj.awakeCount || '--' }}次</view>
      </view>
      <view class="fd-c jc-between ai-center">
        <view class="mb-15">
          <text class="fs-24">睡眠质量</text>
          <text class="fs-36 ml-10">{{ sleepQualityText || '--' }}</text>
        </view>
        <view class="lineProgressStyle mb-10">
          <ProgressBar
            gradient="linear-gradient(270deg, #07a6f1 0%, #6cd6ad 25%, #e6c478 50%, #f99446 75%, #fe4451 100%);"
            :percentage="sleepOverviewObj.sleepScore"
            :custom-container-style="{ width: '100%', height: '16rpx' }"
          />
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.lineProgressStyle {
  width: 400rpx;
}
</style>
