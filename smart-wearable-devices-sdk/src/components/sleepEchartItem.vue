<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
const props = defineProps({
  title: {
    type: String,
    default: '睡前准备'
  },
  subtitle: {
    type: String,
    default: '可改善'
  },
  dateRange: {
    type: String,
    default: '11月3日-11月9日'
  },
  showChartDate: {
    type: Boolean,
    default: true
  },
  showSecoundTopTitle: {
    type: Boolean,
    default: true
  }
});
const chartRef = ref(null);
const emit = defineEmits(['chart-finished']);
defineExpose({
  chartRef
});
</script>
<!-- 睡前准备 -->
<template>
  <view class="bg-white r-50 mt-20 p-40">
    <!-- 标题区域 -->
    <view class="mb-20">
      <view>
        <text class="fs-36">{{ title }}</text>
      </view>
      <view class="flex ai-center mt-20" v-if="showSecoundTopTitle">
        <text class="fs-48">{{ subtitle }}</text>
        <slot name="comparison"></slot>
      </view>
    </view>

    <!-- 日期标签 -->
    <view class="flex jc-center" v-if="showChartDate">
      <view class="fs-24 mt-50 mb-20 date-tag">{{ dateRange }}</view>
    </view>
    <view class="flex ai-center jc-center">
      <l-echart :ref="(el: any) => (chartRef = el)" @finished="$emit('chart-finished', chartRef)" style="width: 100%; height: 424rpx; margin: 0"></l-echart>
    </view>
    <uv-safe-bottom></uv-safe-bottom>
  </view>
</template>

<style lang="scss" scoped>
.date-tag {
  background: #ebf1ff;
  color: #2e70fc;
  padding: 8rpx 16rpx;
  border-radius: 18rpx;
  display: inline-block;
}
</style>
