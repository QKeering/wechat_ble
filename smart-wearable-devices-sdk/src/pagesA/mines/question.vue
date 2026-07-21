<template>
  <view class="page">
    <view class="title">常见问题</view>
    <view class="card">
      <view class="qa">
        <view class="q">搜索不到戒指怎么办？</view>
        <view class="a">请确认蓝牙已开启、戒指靠近手机，并重新搜索。</view>
      </view>
      <view class="qa">
        <view class="q">连接后没有数据怎么办？</view>
        <view class="a">请保持佩戴，点击健康数据页的刷新或开启健康监听。</view>
      </view>
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
