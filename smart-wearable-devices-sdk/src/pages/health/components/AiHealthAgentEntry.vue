<script setup lang="ts">
interface Props {
  robotSrc?: string;
  sleepIconSrc?: string;
  heartIconSrc?: string;
  trendIconSrc?: string;
}

withDefaults(defineProps<Props>(), {
  robotSrc: '/static/images/ai-health-agent-robot.png',
  sleepIconSrc: '/static/images/icon01.png',
  heartIconSrc: '/static/images/icon06.png',
  trendIconSrc: '/static/images/icon02.png'
});

const emit = defineEmits<{
  (event: 'tap'): void;
}>();
</script>

<template>
  <view class="ai-health-agent-entry" @tap="emit('tap')">
    <view class="entry-copy">
      <view class="entry-title">小轻AI健康智能体</view>
      <view class="entry-subtitle">会听你说，也更懂你的状态</view>

      <view class="entry-features">
        <view class="feature-item">
          <view class="feature-icon purple">
            <image :src="sleepIconSrc" mode="aspectFit" />
          </view>
          <text>自然对话</text>
        </view>
        <view class="feature-item">
          <view class="feature-icon rose">
            <image :src="heartIconSrc" mode="aspectFit" />
          </view>
          <text>状态洞察</text>
        </view>
        <view class="feature-item">
          <view class="feature-icon mint">
            <image :src="trendIconSrc" mode="aspectFit" />
          </view>
          <text>个性建议</text>
        </view>
      </view>
    </view>

    <view class="entry-visual">
      <view class="visual-glow"></view>
      <image class="robot-image" :src="robotSrc" mode="aspectFit" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-health-agent-entry {
  position: relative;
  min-height: 292rpx;
  overflow: hidden;
  border-radius: 34rpx;
  padding: 36rpx 34rpx 28rpx;
  display: flex;
  align-items: center;
  background:
    radial-gradient(circle at 90% 82%, rgba(207, 189, 255, 0.42), transparent 28%),
    radial-gradient(circle at 12% 18%, rgba(255, 234, 248, 0.82), transparent 32%),
    linear-gradient(135deg, #ffffff 0%, #f7f9ff 46%, #fff8fd 100%);
  box-shadow:
    inset 0 0 0 1rpx rgba(255, 255, 255, 0.9),
    0 16rpx 38rpx rgba(82, 102, 154, 0.08);
}

.ai-health-agent-entry::after {
  content: '';
  position: absolute;
  right: -46rpx;
  bottom: -52rpx;
  width: 162rpx;
  height: 162rpx;
  border-radius: 50%;
  background: rgba(205, 184, 255, 0.24);
}

.entry-copy {
  position: relative;
  z-index: 2;
  width: 390rpx;
  min-width: 0;
}

.entry-title {
  color: #242b3a;
  font-size: 42rpx;
  line-height: 1.12;
  font-weight: 900;
  letter-spacing: -1rpx;
}

.entry-subtitle {
  margin-top: 16rpx;
  color: #727b8f;
  font-size: 26rpx;
  line-height: 1.32;
  font-weight: 520;
}

.entry-features {
  margin-top: 38rpx;
  display: flex;
  gap: 36rpx;
}

.feature-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
  color: #4f5b70;
  font-size: 22rpx;
  line-height: 1;
  white-space: nowrap;
}

.feature-icon {
  width: 54rpx;
  height: 54rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
}

.feature-icon image {
  width: 30rpx;
  height: 30rpx;
}

.feature-icon.purple {
  background: #f0edff;
}

.feature-icon.rose {
  background: #fff0f6;
}

.feature-icon.mint {
  background: #eafaf3;
}

.entry-visual {
  position: absolute;
  z-index: 1;
  right: 18rpx;
  top: 2rpx;
  width: 274rpx;
  height: 286rpx;
}

.visual-glow {
  position: absolute;
  top: 6rpx;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 42%,
    rgba(255, 255, 255, 0.94),
    rgba(232, 238, 255, 0.52) 52%,
    transparent 72%
  );
}

.robot-image {
  position: absolute;
  right: -12rpx;
  bottom: -8rpx;
  width: 274rpx;
  height: 274rpx;
}
</style>
