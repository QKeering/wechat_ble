<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { applyAiLab } from '@/common/api/aiLab';

const statusBarHeight = ref(0);
const isSubmitting = ref(false);
const inviteCode = ref('');

onMounted(() => {
  const systemInfo = uni.getSystemInfoSync();
  statusBarHeight.value = systemInfo.statusBarHeight || 0;
});

const handleSuccess = () => {
  uni.hideLoading();
  uni.showToast({
    title: '申请已提交，请等待审核',
    icon: 'success',
    duration: 2000
  });

  setTimeout(() => {
    uni.navigateBack();
  }, 1500);

  uni.$emit('refreshAiStatus');
};

// const handleAlreadyApplied = () => {
//   uni.hideLoading();
//   uni.showModal({
//     title: '提示',
//     content: '您已提交申请，请耐心等待审核',
//     showCancel: false,
//     confirmText: '确定',
//     success: () => {
//       uni.navigateBack();
//     }
//   });
//   uni.$emit('refreshAiStatus');
// };

// const handleAlreadyOpened = () => {
//   uni.hideLoading();
//   uni.showModal({
//     title: '提示',
//     content: '您已开通AI实验室体验资格，请返回查看',
//     showCancel: false,
//     confirmText: '确定',
//     success: () => {
//       uni.navigateBack();
//     }
//   });
//   uni.$emit('refreshAiStatus');
// };

const handleFail = (msg: string = '申请失败') => {
  uni.hideLoading();
  uni.showToast({
    title: msg,
    icon: 'none',
    duration: 2000
  });

  uni.$emit('refreshAiStatus');
};

const handleApply = async () => {
  if (isSubmitting.value) return;
  isSubmitting.value = true;

  uni.showLoading({ title: '提交中...' });

  try {
    const params: any = {};
    if (inviteCode.value) {
      params.inviteCode = inviteCode.value;
    }
    const res: boolean = await applyAiLab(params);

    if (res) {
      handleSuccess();
    }
  } catch (error: any) {
    const msg = error?.msg || '';
    handleFail(msg || '申请失败，请稍后重试');
  } finally {
    isSubmitting.value = false;
  }
};

// 处理返回
const goBack = () => {
  uni.navigateBack();
};
</script>

<template>
  <view class="page-container">
    <!-- 自定义顶部导航栏 -->
    <view class="custom-nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="nav-back-btn" @click="goBack">
        <!-- 使用 uv-icon 或 uni-icons，如果没有安装，可以用图片代替 -->
        <uv-icon name="arrow-left" color="#ffffff" size="20"></uv-icon>
      </view>
      <!-- <view class="nav-title">AI体验中心</view> -->
    </view>

    <view class="page-content">
      <!-- Hero 区域 -->
      <view class="ai-hero">
        <view class="ai-hero-icon">
          <!-- 这里可以使用 uv-icon 或者 image，暂时用文字代替图标，实际项目中请替换为图片 -->
          <!-- <text class="icon-text">🧠</text> -->
          <uv-image src="/static/images/brain.png" width="100rpx" height="100rpx"></uv-image>
        </view>
        <view class="ai-hero-title">AI智能体Lab</view>
        <view class="ai-hero-desc">
          基于QKeer轻刻Al戒指数据
          <br />
          AI 智能体的应用
        </view>
      </view>

      <!-- 邀请码输入区域 -->
      <view class="invite-code-section">
        <view class="invite-code-card">
          <view class="input-label">
            <text class="label-icon">🎟️</text>
            <text class="label-text">邀请码</text>
            <text class="label-hint">（选填）</text>
          </view>
          <view class="input-wrapper">
            <input v-model="inviteCode" type="text" placeholder="请输入邀请码" placeholder-class="input-placeholder" class="invite-input" maxlength="20" />
          </view>
        </view>
      </view>

      <!-- 介绍内容区域 -->
      <view class="ai-intro">
        <view class="intro-card">
          <view class="card-header">
            <text class="header-icon">💡</text>
            <text class="header-title">抢先体验新功能</text>
          </view>
          <view class="card-body">
            <text class="body-text">QKeer轻刻Lab让您有机会在创新功能正式加入QKeer轻刻前，抢先体验并参与优化这些功能。</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 底部固定按钮 -->
    <view class="apply-bottom">
      <button class="apply-btn" :disabled="isSubmitting" @click="handleApply">
        {{ isSubmitting ? '提交中...' : '申请体验' }}
      </button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 变量定义 */
$primary-color: #3b82f6;
$primary-light: #60a5fa;
$bg-color: #f5f5f5;
$text-main: #1a1a1a;
$text-sub: #666666;
$text-light: #999999;

.page-container {
  min-height: 100vh;
  background-color: $bg-color;
  display: flex;
  flex-direction: column;
}

/* 自定义导航栏样式 */
.custom-nav-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  height: 44px; /* 导航栏内容高度 */
  // 背景透明，因为下面是蓝色的 Hero 区域
  background: transparent;
  pointer-events: none; /* 让点击事件穿透到下层，除了按钮 */

  .nav-back-btn {
    position: absolute;
    left: 16px;
    bottom: 0;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto; /* 恢复按钮点击 */
    cursor: pointer;

    // 增加点击区域，方便用户点击
    &::after {
      content: '';
      position: absolute;
      top: -10px;
      left: -10px;
      right: -10px;
      bottom: -10px;
    }
  }

  .nav-title {
    flex: 1;
    text-align: center;
    font-size: 17px;
    font-weight: 600;
    color: #fff;
    position: absolute;
    // top: 50%;
    left: 50%;
    transform: translateX(-50%);
  }
}

.page-content {
  flex: 1;
  // 不需要额外 padding-top，因为 Hero 区域本身有 padding，且导航栏是悬浮透明的
}

/* Hero 区域 */
.ai-hero {
  // 增加顶部 padding，防止内容被状态栏遮挡 (状态栏高度 + 导航栏高度)
  padding: calc(var(--status-bar-height, 0px) + 60px) 48rpx 64rpx;
  background: linear-gradient(135deg, $primary-color 0%, $primary-light 100%);
  text-align: center;
  color: #fff;
  border-radius: 0 0 40rpx 40rpx;

  .ai-hero-icon {
    width: 144rpx;
    height: 144rpx;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 36rpx;
    margin: 0 auto 40rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(10px);

    .icon-text {
      font-size: 72rpx;
    }
  }

  .ai-hero-title {
    font-size: 44rpx;
    font-weight: 600;
    margin-bottom: 16rpx;
  }

  .ai-hero-desc {
    font-size: 28rpx;
    opacity: 0.85;
  }
}

/* 邀请码输入区域 */
.invite-code-section {
  padding: 0 32rpx 32rpx;

  .invite-code-card {
    background: #fff;
    border-radius: 32rpx;
    padding: 40rpx;
    box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);

    .input-label {
      display: flex;
      align-items: center;
      margin-bottom: 24rpx;

      .label-icon {
        font-size: 36rpx;
        margin-right: 12rpx;
      }

      .label-text {
        font-size: 32rpx;
        color: $text-main;
        font-weight: 600;
      }

      .label-hint {
        font-size: 24rpx;
        color: $text-light;
        margin-left: 8rpx;
      }
    }

    .input-wrapper {
      .invite-input {
        width: 90%;
        height: 88rpx;
        background: $bg-color;
        border-radius: 16rpx;
        padding: 0 24rpx;
        font-size: 28rpx;
        color: $text-main;
        border: 2rpx solid transparent;
        transition: all 0.3s;

        &:focus {
          border-color: $primary-color;
          background: #fff;
        }
      }

      .input-placeholder {
        color: $text-light;
      }
    }
  }
}

/* 介绍内容 */
.ai-intro {
  padding: 48rpx 32rpx;

  .intro-card {
    background: #fff;
    border-radius: 32rpx;
    padding: 40rpx;
    box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);

    .card-header {
      display: flex;
      align-items: center;
      margin-bottom: 24rpx;

      .header-icon {
        font-size: 36rpx;
        margin-right: 16rpx;
      }

      .header-title {
        font-size: 32rpx;
        color: $text-main;
        font-weight: 600;
      }
    }

    .card-body {
      .body-text {
        font-size: 28rpx;
        color: $text-sub;
        line-height: 1.6;
        text-align: justify;
      }
    }
  }
}

/* 底部按钮区域 */
.apply-bottom {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 32rpx;
  background: #fff;
  box-shadow: 0 -4rpx 32rpx rgba(0, 0, 0, 0.08);
  z-index: 10;
  /* 适配 iPhone X 等全面屏底部安全区 */
  padding-bottom: calc(32rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));

  .apply-btn {
    width: 100%;
    height: 96rpx;
    background: linear-gradient(135deg, $primary-color 0%, $primary-light 100%);
    color: #fff;
    border: none;
    border-radius: 48rpx;
    font-size: 32rpx;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;

    /* 禁用状态 */
    &[disabled] {
      opacity: 0.6;
      background: #ccc;
    }

    /* 移除 button 默认边框 */
    &::after {
      border: none;
    }

    &:active:not([disabled]) {
      opacity: 0.9;
      transform: scale(0.98);
    }
  }
}
</style>
