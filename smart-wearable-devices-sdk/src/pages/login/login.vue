<script setup>
import { ref } from 'vue';
import { onPageScroll } from '@dcloudio/uni-app';
import { wechatLogin } from '@/common/api/login';
import { useUserStore } from '@/stores/user';
import { formatBleErrorMessage } from '@/utils/bleError';

const userStore = useUserStore();

const scrollTop = ref(0);
const agreementChecked = ref(false);
const isLoggingIn = ref(false);

onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});

const showToast = (title) => {
  uni.showToast({
    title,
    icon: 'none',
    duration: 2500
  });
};

const getErrorMessage = (error, fallback) => formatBleErrorMessage(error, fallback);

const withTimeout = (promise, timeout = 15000, message = '请求超时，请稍后重试') => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeout);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
};

const finishLogin = async (response) => {
  await userStore.applyLoginResponse(response);
  uni.showToast({
    title: '登录成功',
    icon: 'success'
  });
  setTimeout(() => {
    uni.switchTab({ url: '/pages/awareness/awareness' });
  }, 300);
};

const handleGetPhoneNumber = async (event) => {
  if (isLoggingIn.value) return;
  if (!agreementChecked.value) {
    showToast('请先同意用户协议');
    return;
  }

  const phoneCode = event?.code || event?.detail?.code;
  const errMsg = event?.errMsg || event?.detail?.errMsg || '';
  if (!phoneCode) {
    showToast(errMsg.includes('deny') ? '授权已取消' : '未获取到手机号授权');
    return;
  }

  isLoggingIn.value = true;
  uni.showLoading({ title: '登录中' });
  try {
    const wxResult = await withTimeout(wx.login(), 10000, '微信登录凭证获取超时');
    if (!wxResult?.code) {
      throw new Error('微信登录凭证获取失败');
    }
    const response = await withTimeout(
      wechatLogin(
        {
          openidCode: wxResult.code,
          phoneCode
        },
        { custom: { auth: false } }
      ),
      15000,
      '授权登录超时，请稍后重试'
    );
    await finishLogin(response);
  } catch (error) {
    showToast(getErrorMessage(error, '授权登录失败'));
  } finally {
    isLoggingIn.value = false;
    uni.hideLoading();
  }
};

const handleMobileLoginEntry = () => {
  uni.navigateTo({
    url: '/pages/login/login-mobile'
  });
};

const leftClick = () => {
  uni.navigateBack();
};
</script>

<template>
  <view class="login-auth-page min-h-screen bg-white">
    <uv-navbar
      placeholder
      @leftClick="leftClick"
      leftIcon="arrow-left"
      title="登录"
      :bgColor="scrollTop > 0 ? '#f1f3f6' : 'rgba(255, 255, 255, 0)'"
    ></uv-navbar>
    <view class="login-bg">
      <uv-image src="/static/images/bg01.png" width="100%" mode="widthFix"></uv-image>
    </view>
    <view class="login-page">
      <view class="login-product">
        <uv-image src="/static/images/mine/logo3.png" width="330rpx" height="330rpx" mode="aspectFit"></uv-image>
      </view>

      <view class="login-hero">
        <view class="login-title">欢迎登录</view>
        <view class="login-subtitle">轻刻智能戒指</view>
        <view class="login-divider"></view>
      </view>

      <view class="login-actions">
        <button class="login-btn login-btn-primary" :disabled="isLoggingIn" hover-class="none" open-type="getPhoneNumber" @getphonenumber="handleGetPhoneNumber">
          {{ isLoggingIn ? '登录中...' : '微信授权登录' }}
        </button>
        <button class="login-mobile-entry" :disabled="isLoggingIn" hover-class="none" @click="handleMobileLoginEntry">手机号验证登录</button>
      </view>

      <view @click="agreementChecked = !agreementChecked" class="agreement-row">
        <view :class="['agreement-checkbox', { checked: agreementChecked }]">
          <uv-icon v-if="agreementChecked" name="checkmark" color="#ffffff" size="13"></uv-icon>
        </view>
        <view class="agreement-text">
          我已阅读并同意
          <text class="agreement-link" @click.stop="$uv.route('/pages/login/agreement?type=user')">《用户协议》</text>
          和
          <text class="agreement-link" @click.stop="$uv.route('/pages/login/agreement?type=privacy')">《隐私政策》</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.login-auth-page {
  position: relative;
  overflow: hidden;
}

.login-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 0;
}

.login-page {
  position: relative;
  z-index: 1;
  min-height: calc(100vh - 88rpx);
  padding: 0 54rpx 140rpx;
  box-sizing: border-box;
}

.login-product {
  display: flex;
  justify-content: center;
  padding-top: 132rpx;
}

.login-hero {
  margin-top: 86rpx;
  text-align: center;
  color: #111827;
}

.login-title {
  font-size: 58rpx;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: 2rpx;
}

.login-subtitle {
  margin-top: 30rpx;
  color: #6d7580;
  font-size: 36rpx;
  line-height: 1.2;
  font-weight: 600;
}

.login-divider {
  width: 68rpx;
  height: 8rpx;
  margin: 44rpx auto 0;
  border-radius: 999rpx;
  background: #2e70fc;
}

.login-actions {
  margin-top: 116rpx;
}

.login-btn,
.login-mobile-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100% !important;
  min-width: 0 !important;
  padding: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  border: 0 !important;
  box-sizing: border-box;
  text-align: center;
  background: transparent;
}

.login-btn::after,
.login-mobile-entry::after {
  border: 0;
}

.login-btn-primary {
  height: 116rpx !important;
  line-height: 116rpx !important;
  border-radius: 58rpx !important;
  color: #ffffff;
  background: #2e70fc;
  font-size: 36rpx !important;
  font-weight: 500;
}

.login-mobile-entry {
  margin-top: 72rpx !important;
  height: 64rpx !important;
  line-height: 64rpx !important;
  color: #2e70fc;
  font-size: 34rpx !important;
  font-weight: 600;
}

.login-btn[disabled],
.login-mobile-entry[disabled] {
  opacity: 0.65;
}

.agreement-row {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 100rpx;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 32rpx;
  box-sizing: border-box;
}

.agreement-checkbox {
  flex: 0 0 auto;
  width: 34rpx;
  height: 34rpx;
  margin-right: 8rpx;
  border: 3rpx solid #1f2933;
  border-radius: 50%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
}

.agreement-checkbox.checked {
  border-color: #20c66a;
  background: #20c66a;
}

.agreement-text {
  color: #222222;
  font-size: 26rpx;
  line-height: 1.4;
}

.agreement-link {
  color: #2e70fc;
}
</style>
