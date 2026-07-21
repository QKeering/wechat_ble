<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';

onLoad(() => {});

const goBack = () => {
  uni.navigateBack();
};

const closePage = () => {
  uni.navigateBack({ delta: 10 });
};

const startQuestionnaire = () => {
  uni.navigateTo({ url: '/homeDetail/periodSteps/periodSteps' });
};
</script>

<template>
  <view class="page-wrap">
    <!-- 顶部导航 -->
    <uv-navbar placeholder leftIcon="" bgColor="#f5f0ee">
      <template #left>
        <view class="nav-left flex ai-center">
          <view class="nav-btn" @tap="goBack">
            <uv-icon name="arrow-left" size="20" color="#333"></uv-icon>
          </view>
          <view class="nav-btn ml-20" @tap="closePage">
            <uv-icon name="close" size="20" color="#333"></uv-icon>
          </view>
        </view>
      </template>
    </uv-navbar>

    <!-- 主体内容 -->
    <view class="content-wrap">
      <!-- 图标区域 -->
      <view class="icon-area flex jc-center ai-center">
        <view class="questionnaire-icon">
          <!-- 后面卡片 -->
          <view class="card card-back"></view>
          <!-- 前面卡片 -->
          <view class="card card-front">
            <view class="card-dot"></view>
            <view class="card-line"></view>
            <view class="card-line card-line--short"></view>
          </view>
        </view>
      </view>

      <!-- 文字内容 -->
      <view class="text-area">
        <view class="main-title">生理期信息问卷</view>
        <view class="desc-text">
          接下来会通过几个简单的问题来了解你的生理周期情况,这些信息将作为你的生理期预测的基准。如果你记不住确定的数字或日期,可以提供估计值。
        </view>
      </view>
    </view>

    <!-- 底部按钮 -->
    <view class="bottom-btn-wrap">
      <view class="start-btn" @tap="startQuestionnaire">
        <text class="start-btn-text">开始问卷</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page-wrap {
  min-height: 100vh;
  background-color: #f5f0ee;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.nav-left {
  padding-left: 20rpx;

  .nav-btn {
    width: 64rpx;
    height: 64rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.content-wrap {
  flex: 1;
  padding: 80rpx 60rpx 40rpx;
  display: flex;
  flex-direction: column;

  // 图标区域
  .icon-area {
    padding: 60rpx 0 80rpx;

    .questionnaire-icon {
      position: relative;
      width: 200rpx;
      height: 220rpx;

      .card {
        position: absolute;
        width: 160rpx;
        height: 200rpx;
        border-radius: 20rpx;
      }

      // 后面的卡片（偏右偏上，浅粉色）
      .card-back {
        background: #f9a8c0;
        top: 0rpx;
        right: 0rpx;
        transform: rotate(10deg);
        opacity: 0.7;
      }

      // 前面的卡片（深粉色/玫红）
      .card-front {
        background: linear-gradient(160deg, #ff5e8a 0%, #ff3d72 100%);
        top: 20rpx;
        left: 0rpx;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 40rpx;
        z-index: 1;

        .card-dot {
          width: 36rpx;
          height: 36rpx;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.9);
          margin-bottom: 24rpx;
        }

        .card-line {
          width: 90rpx;
          height: 10rpx;
          border-radius: 6rpx;
          background: rgba(255, 255, 255, 0.75);
          margin-bottom: 16rpx;

          &--short {
            width: 60rpx;
          }
        }
      }
    }
  }

  // 文字区域
  .text-area {
    .main-title {
      font-size: 48rpx;
      font-weight: bold;
      color: #1a1a1a;
      margin-bottom: 32rpx;
      line-height: 1.3;
    }

    .desc-text {
      font-size: 30rpx;
      color: #555;
      line-height: 1.8;
    }
  }
}

// 底部按钮
.bottom-btn-wrap {
  padding: 30rpx 60rpx 60rpx;

  .start-btn {
    width: 100%;
    height: 100rpx;
    background: linear-gradient(135deg, #ff6eb4, #ff2d6e);
    border-radius: 50rpx;
    display: flex;
    align-items: center;
    justify-content: center;

    &:active {
      opacity: 0.85;
    }

    .start-btn-text {
      font-size: 36rpx;
      color: #fff;
      font-weight: 500;
      letter-spacing: 4rpx;
    }
  }
}
</style>
