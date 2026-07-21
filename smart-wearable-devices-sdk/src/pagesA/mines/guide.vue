<template>
  <view class="page">
    <view class="title">使用指南</view>
    <view class="card">
      <view class="item">1. 请保持戒指有电，并贴合佩戴。</view>
      <view class="item">2. 在“我的”页面点击去配对或重新连接。</view>
      <view class="item">3. 连接成功后进入健康数据页读取实时数据或同步历史。</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  padding: 32rpx;
  background: #f1f3f6;
  box-sizing: border-box;
}
.title {
  margin-bottom: 24rpx;
  color: #111827;
  font-size: 44rpx;
  font-weight: 700;
}
.card {
  padding: 32rpx;
  border-radius: 24rpx;
  background: #fff;
}
.item {
  margin-bottom: 24rpx;
  color: #374151;
  font-size: 32rpx;
  line-height: 1.6;
}
.item:last-child {
  margin-bottom: 0;
}
</style>
