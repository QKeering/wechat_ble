<template>
  <view class="container">
    <view class="tab">
      <navigator
        v-for="(item, index) in list"
        :key="index"
        hover-class="none"
        open-type="switchTab"
        :url="`${item.pagePath}`"
        @success="handleJumpEnd(item.pagePath)"
        class="tab-item"
        :class="{ 'tab-item-active': value === index }"
      >
        <template v-if="index !== 1">
          <image class="tab-icon" :src="value === index ? item.selectedIconPath : item.iconPath" mode="aspectFit"></image>
          <text class="tab-text">{{ item.text }}</text>
        </template>
        <template v-else>
          <view class="inspect-btn">
            <uv-button :customStyle="inspectStyle" :customTextStyle="inspectTextStyle" :text="item.text"></uv-button>
          </view>
        </template>
      </navigator>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';

// 接收 props
const props = defineProps({
  value: {
    type: Number,
    default: 0
  }
});

// 定义 tabbar 列表
const list = [
  {
    iconPath: '/static/tabbar/awareness.png',
    selectedIconPath: '/static/tabbar/awareness-active.png',
    text: '感知',
    pagePath: '/pages/awareness/awareness'
  },
  {
    iconPath: '/static/tabbar/health.png',
    selectedIconPath: '/static/tabbar/health-active.png',
    text: '健康',
    pagePath: '/pages/health/health'
  },
  {
    iconPath: '/static/tabbar/mine.png',
    selectedIconPath: '/static/tabbar/mine-active.png',
    text: '我的',
    pagePath: '/pages/mine/mine'
  }
];

// 样式计算属性
const inspectStyle = computed(() => ({
  width: '94rpx',
  height: '94rpx',
  background: 'linear-gradient(180deg, #f76363 0%, #de1010 100%)',
  boxShadow: '0 10rpx 22rpx 0 #00000026',
  borderRadius: '50%'
}));

const inspectTextStyle = computed(() => ({
  color: '#ffffff',
  textAlign: 'center',
  fontSize: '24rpx'
}));

// 页面跳转方法
const handleJumpEnd = (url) => {
  uni.switchTab({
    url
  });
};
</script>

<style lang="scss" scoped>
.tab {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  justify-content: space-between;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  background-color: #fff;
  box-shadow: 0 0 26rpx 0 #00000026;
  z-index: 1;
}

.tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20rpx 84rpx 8rpx;
  .tab-icon {
    width: 54rpx;
    height: 54rpx;
  }
  .tab-text {
    margin-top: 10rpx;
    font-size: 20rpx;
    color: #818181;
  }
  &-active {
    .tab-text {
      color: #45c35d;
    }
  }

  &:nth-child(2) {
    position: absolute;
    top: -60rpx;
    left: 50%;
    transform: translateX(-50%);
    padding: 16rpx;
    background: #ffffff;
    border-radius: 50%;
    z-index: 2;
  }
}
</style>
