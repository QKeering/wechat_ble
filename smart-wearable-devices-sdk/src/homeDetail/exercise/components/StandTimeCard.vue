<script setup lang="ts">
import { ref } from 'vue';
const echarts = require('../../../static/echarts.min.js');
import { categoryOption } from '@/homeDetail/exercise/echartOptions';
const categoryRef = ref(null);
const initCategory = async () => {
  if (!categoryRef.value) return;
  try {
    const pie = await categoryRef.value.init(echarts);
    pie.setOption(categoryOption);
  } catch (error) {
    console.error('图表初始化失败:', error);
  }
};
</script>
<template>
  <view class="p-30 bg-white r-50 mb-30">
    <view class="">
      <text class="fs-36">站立时长</text>
    </view>
    <view class="flex jc-between pl-50 pr-50 mt-30">
      <view class="fd-c jc-center ai-center">
        <view class="fs-48 ta-c">
          <text class="fs-48">2</text>
          <text class="fs-24">小时</text>
          <text class="fs-48">12</text>
          <text class="fs-24">分钟</text>
        </view>
        <view class="flex ai-center mt-10 jc-center">
          <text class="fs-24 t-979797">站立小时数</text>
        </view>
      </view>
      <view class="fd-c jc-center ai-center">
        <view class="fs-48 ta-c">
          <text class="fs-48">132</text>
          <text class="fs-24">分钟</text>
        </view>
        <view class="flex ai-center jc-center">
          <text class="fs-24 t-979797 mt-10">站立总计</text>
        </view>
      </view>
    </view>
    <view class="flex ai-center jc-center mt-20">
      <l-echart ref="categoryRef" @finished="initCategory" style="width: 100%; height: 224rpx; margin: 0"></l-echart>
    </view>
  </view>
</template>

<style lang="scss" scoped></style>
