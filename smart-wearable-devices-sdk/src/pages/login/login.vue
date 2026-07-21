<script setup>
import { ref } from 'vue';
import { onPageScroll } from '@dcloudio/uni-app';
import { wechatLogin, phoneLogin, getPhoneCode } from '@/common/api/login';
import { useUserStore } from '@/stores/user';
import { formatBleErrorMessage } from '@/utils/bleError';

const userStore = useUserStore();

const scrollTop = ref(0);
const agreementChecked = ref(false);
const tips = ref('');
const seconds = ref(60);
const codeRef = ref(null);
const phone = ref('');
const code = ref('');
const isLoggingIn = ref(false);
const loginType = ref('');

onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});

const codeChange = (text) => {
  tips.value = typeof text === 'string' ? text : '';
};

const start = () => {};

const showToast = (title) => {
  uni.showToast({
    title,
    icon: 'none',
    duration: 2500
  });
};

const validatePhoneNumber = (value) => {
  if (!value || typeof value === 'boolean') return false;
  return /^1[3-9]\d{9}$/.test(String(value).trim());
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

const getCode = async () => {
  if (!phone.value) {
    showToast('请输入手机号');
    return;
  }
  if (!validatePhoneNumber(phone.value)) {
    showToast('请输入正确的手机号');
    return;
  }
  if (!codeRef.value?.canGetCode) {
    showToast('倒计时结束后再发送');
    return;
  }

  uni.showLoading({ title: '正在获取验证码' });
  try {
    await getPhoneCode({ phone: phone.value }, { custom: { auth: false } });
    showToast('验证码已发送');
    codeRef.value.start();
  } catch (error) {
    showToast(getErrorMessage(error, '验证码发送失败'));
  } finally {
    uni.hideLoading();
  }
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

const handlePhoneLogin = async () => {
  if (isLoggingIn.value) return;
  if (!phone.value) {
    showToast('请输入手机号');
    return;
  }
  if (!validatePhoneNumber(phone.value)) {
    showToast('请输入正确的手机号');
    return;
  }
  if (!code.value) {
    showToast('请输入验证码');
    return;
  }
  if (!/^\d{6}$/.test(code.value)) {
    showToast('请输入正确的验证码');
    return;
  }
  if (!agreementChecked.value) {
    showToast('请先同意用户协议');
    return;
  }

  isLoggingIn.value = true;
  loginType.value = 'phone';
  uni.showLoading({ title: '登录中' });
  try {
    const wxResult = await withTimeout(wx.login(), 10000, '微信登录凭证获取超时');
    if (!wxResult?.code) {
      throw new Error('微信登录凭证获取失败');
    }
    const response = await withTimeout(
      phoneLogin(
        {
          phone: phone.value,
          code: code.value,
          openIdCode: wxResult.code
        },
        { custom: { auth: false } }
      ),
      15000,
      '手机号登录超时，请稍后重试'
    );
    await finishLogin(response);
  } catch (error) {
    showToast(getErrorMessage(error, '登录失败'));
  } finally {
    isLoggingIn.value = false;
    loginType.value = '';
    uni.hideLoading();
  }
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
  loginType.value = 'wechat';
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
    loginType.value = '';
    uni.hideLoading();
  }
};

const leftClick = () => {
  uni.navigateBack();
};
</script>

<template>
  <view style="position: relative" class="min-h-screen bg-white">
    <uv-navbar
      placeholder
      @leftClick="leftClick"
      leftIcon="arrow-left"
      title="登录"
      :bgColor="scrollTop > 0 ? '#f1f3f6' : 'rgba(255, 255, 255, 0)'"
    ></uv-navbar>
    <view style="position: absolute; top: 0; left: 0; width: 100%">
      <uv-image src="/static/images/bg01.png" width="100%" mode="widthFix"></uv-image>
    </view>
    <view class="pl-30 pr-30 pt-100 pb-100 relative" style="z-index: 1; box-sizing: border-box">
      <view class="pb-90 tc-010101">
        <view class="fs-56 mb-30">手机号</view>
        <view class="fs-48">登录/注册</view>
      </view>

      <view class="form-row flex ai-center r-50 bg-white p-40">
        <view class="country-code fs-36">+86</view>
        <view class="ml-30 mr-30">|</view>
        <input v-model="phone" type="number" placeholder="请输入手机号" class="input-phone flex-1 fs-36" :maxlength="11" />
      </view>

      <view class="form-row flex ai-center r-50 bg-white p-40 mt-50">
        <input v-model="code" type="number" placeholder="请输入验证码" class="input-code flex-1 fs-36" :maxlength="6" />
        <uv-code ref="codeRef" :seconds="seconds" @start="start" @change="codeChange"></uv-code>
        <view class="btn-get-code fs-36 t-2e70fc" @click="getCode">{{ tips || '获取验证码' }}</view>
      </view>

      <view class="login-actions mt-60">
        <view class="login-action-item">
          <button class="login-btn login-btn-secondary" :disabled="isLoggingIn" hover-class="none" @click="handlePhoneLogin">
            {{ loginType === 'phone' ? '登录中' : '手机号登录' }}
          </button>
        </view>
        <view class="login-action-item">
          <button class="login-btn login-btn-primary" :disabled="isLoggingIn" hover-class="none" open-type="getPhoneNumber" @getphonenumber="handleGetPhoneNumber">
            {{ loginType === 'wechat' ? '登录中' : '授权登录' }}
          </button>
        </view>
      </view>

      <view @click="agreementChecked = !agreementChecked" class="mt-40 flex ai-center jc-center footer" style="bottom: 100rpx">
        <uv-icon :name="agreementChecked ? 'checkmark-circle-fill' : 'checkmark-circle'" :color="agreementChecked ? '#2E70FC' : ''" size="18"></uv-icon>
        <view class="fs-24" style="color: #222222">
          我已阅读并同意
          <text class="t-2e70fc" @click.stop="$uv.route('/pages/login/agreement?type=user')">《用户协议》</text>
          和
          <text class="t-2e70fc" @click.stop="$uv.route('/pages/login/agreement?type=privacy')">《隐私政策》</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.form-row {
  border: 2rpx solid #2e70fc;
}

.btn-get-code {
  min-width: 180rpx;
  text-align: right;
  white-space: nowrap;
}

.login-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30rpx;
  width: 100%;
}

.login-action-item {
  flex: 1;
  min-width: 0;
}

.login-btn {
  display: block;
  width: 100% !important;
  min-width: 0;
  height: 112rpx !important;
  line-height: 112rpx !important;
  padding: 0 !important;
  margin: 0 !important;
  box-sizing: border-box;
  border-radius: 56rpx !important;
  font-size: 36rpx !important;
  font-weight: 500;
  text-align: center;
}

.login-btn::after {
  border: 0;
}

.login-btn-secondary {
  color: #2e70fc;
  background: #f1f3f6;
}

.login-btn-primary {
  color: #ffffff;
  background: #2e70fc;
}

.login-btn[disabled] {
  opacity: 0.65;
}

.login-btn-secondary[disabled] {
  color: #2e70fc;
  background: #f1f3f6;
}

.login-btn-primary[disabled] {
  color: #ffffff;
  background: #2e70fc;
}
</style>
