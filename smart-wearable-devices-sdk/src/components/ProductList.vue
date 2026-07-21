<script setup>
import { ref } from 'vue';
// 接收父组件传过来的值
const props = defineProps({
  list: {
    type: Array,
    default: () => []
  }
});
</script>

<template>
  <view class="flex-row jc-between wrap list">
    <view v-for="(item, index) in list" :key="item.goods_id" class="rounded-10 bg-c-ffffff m-b-20 item" @click="$uv.route(`/pages/indexs/productDetail?goods_id=${item.goods_id}`)">
      <uv-image :src="item.original_img" width="100%" height="302rpx" radius="10rpx"></uv-image>
      <view class="p-10">
        <view class="m-b-20">
          <text v-if="item.is_nuclear == 1" class="rounded-10 t-s-24" style="background-color: #029b4b; padding: 5rpx 10rpx; color: #fff">
            {{ item.is_nuclear == 1 ? '核销' : '' }}
          </text>
          {{ item.goods_name }}
        </view>
        <view class="flex-row ai-end t-s-20">
          <view class="m-r-10 t-c-ff2e2e">
            <text>¥</text>
            <text class="t-s-32">{{ item.market_price }}</text>
          </view>
          <view class="t-c-7e7e7e">已售{{ item.virtual_sales_sum || item.sales_sum }}件</view>
        </view>
      </view>
    </view>
  </view>
  <uv-empty v-if="list.length === 0"></uv-empty>
</template>

<style lang="scss" scoped>
.item {
  width: 345rpx;
  box-shadow: 0 16rpx 40rpx 0 #00000008;
}
</style>
