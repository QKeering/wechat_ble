<template>
  <view class="page">
    <view class="header">
      <text class="title">轻刻健康</text>
      <text class="subtitle">戒指健康数据演示</text>
    </view>

    <view class="section">
      <text class="section-title">戒指健康数据</text>
      <text class="section-text">连接戒指后查看电量、版本、心率、血氧、皮肤温度状态和历史同步状态。</text>
      <button class="primary-button" @tap="goRingBusiness">进入戒指健康数据</button>
    </view>
  </view>
</template>

<script setup lang="ts">
const goRingBusiness = () => {
  uni.navigateTo({ url: '/pagesA/mines/connectDevice' });
};
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 96rpx 32rpx 48rpx;
  box-sizing: border-box;
  background: #f6f8fb;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.title {
  color: #172033;
  font-size: 44rpx;
  font-weight: 700;
}

.subtitle {
  color: #667085;
  font-size: 26rpx;
}

.section {
  margin-top: 40rpx;
  padding: 28rpx;
  border: 1rpx solid #e5eaf2;
  border-radius: 8rpx;
  background: #ffffff;
}

.section.secondary {
  margin-top: 24rpx;
}

.section-title {
  display: block;
  color: #172033;
  font-size: 30rpx;
  font-weight: 600;
}

.section-text {
  display: block;
  margin-top: 14rpx;
  color: #475467;
  font-size: 26rpx;
  line-height: 1.6;
}

.primary-button {
  margin-top: 28rpx;
  height: 84rpx;
  border-radius: 8rpx;
  font-size: 28rpx;
  line-height: 84rpx;
}

.primary-button {
  background: #2f6df6;
  color: #ffffff;
}
</style>
