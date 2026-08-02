<script setup lang="ts">
const handleApplyClick = () => {
  uni.navigateTo({
    url: '/pages/health/growth-girlfriend'
  });
};
</script>

<template>
  <view class="ai-lab-container">
    <view class="ai-lab-card" @tap="handleApplyClick">
      <view class="ai-lab-icon">
        <uv-image src="/static/images/brain.png" width="92rpx" height="92rpx"></uv-image>
      </view>

      <view class="ai-lab-content">
        <text class="ai-lab-title">小轻AI成长闺蜜</text>
        <text class="ai-lab-subtitle">会听你说，也更懂你的状态</text>
        <text class="ai-lab-desc">AI融合多维健康大数据，生成健康、美丽、成长建议</text>
      </view>

      <view class="ai-lab-button">
        <text>进入</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-lab-container {
  display: flex;
  justify-content: center;
  align-items: center;
}

.ai-lab-card {
  width: 100%;
  display: flex;
  align-items: center;
  overflow: hidden;
  border-radius: 36rpx;
  background: linear-gradient(135deg, #fff8fd 0%, #fff4fa 55%, #fffafd 100%);
}

.ai-lab-icon {
  width: 108rpx;
  height: 108rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #5f7cff 0%, #9b6dff 100%);
  display: flex;
  justify-content: center;
  align-items: center;
  margin-right: 22rpx;
  flex-shrink: 0;
  box-shadow: 0 8rpx 24rpx rgba(104, 102, 255, 0.22);
}

.ai-lab-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ai-lab-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #2b2f3a;
  line-height: 1.2;
}

.ai-lab-subtitle {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #697181;
  line-height: 1.35;
}

.ai-lab-desc {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #8d94a3;
  line-height: 1.35;
}

.ai-lab-button {
  width: 84rpx;
  height: 52rpx;
  margin-left: 18rpx;
  border-radius: 26rpx;
  background: #ffffff;
  color: #2e70fc;
  font-size: 24rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 6rpx 18rpx rgba(46, 112, 252, 0.12);
}
</style>
