<script setup>
import { ref } from 'vue';
import { onPageScroll } from '@dcloudio/uni-app';
import { phoneLogin, getPhoneCode } from '@/common/api/login';
import { useUserStore } from '@/stores/user';
import { formatBleErrorMessage } from '@/utils/bleError';
import { getWechatProfileForNickname } from '@/utils/wechatProfile';
const userStore = useUserStore();

const scrollTop = ref(0);
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});

// 协议是否已勾选
const agreementChecked = ref(false);

const tips = ref('');
const seconds = ref(60);
const codeRef = ref(null);
const isLoggingIn = ref(false);
const codeChange = (e) => {
  tips.value = typeof e === 'string' ? e : '';
};
const start = () => {};
const showToast = (title) => {
  uni.showToast({
    title,
    icon: 'none',
    duration: 2500
  });
};
const getErrorMessage = (error, fallback) => formatBleErrorMessage(error, fallback);
const getCode = async () => {
  // 校验手机号
  if (!phone.value) {
    showToast('请输入手机号');
    return;
  }
  if (!validatePhoneNumber(phone.value)) {
    showToast('请输入正确的手机号');
    return;
  }
  if (codeRef.value?.canGetCode) {
    uni.showLoading({
      title: '正在获取验证码'
    });
    try {
      await getPhoneCode(
        {
          phone: phone.value
        },
        {
          custom: {
            auth: false
          }
        }
      );
      showToast('验证码已发送');
      codeRef.value?.start();
    } catch (error) {
      showToast(getErrorMessage(error, '验证码发送失败'));
    } finally {
      uni.hideLoading();
    }
  } else {
    showToast('倒计时结束后再发送');
  }
};

const phone = ref('');
const code = ref('');
const handlePhoneLogin = async () => {
  if (isLoggingIn.value) return;
  // 校验手机号
  if (!phone.value) {
    showToast('请输入手机号');
    return;
  }
  if (!validatePhoneNumber(phone.value)) {
    showToast('请输入正确的手机号');
    return;
  }
  // 校验验证码
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
  try {
    const wxProfile = await getWechatProfileForNickname();
    const res1 = await wx.login();
    const res2 = await phoneLogin(
      {
        phone: phone.value,
        code: code.value,
        openIdCode: res1.code
      },
      {
        custom: {
          auth: false
        }
      }
    );
    await userStore.applyLoginResponse(res2, { wxProfile });
    uni.showToast({
      title: '登录成功',
      icon: 'success'
    });
    uni.switchTab({
      url: '/pages/awareness/awareness'
    });
  } catch (error) {
    showToast(getErrorMessage(error, '登录失败，请稍后再试'));
  } finally {
    isLoggingIn.value = false;
  }
};

/**
 * 校验中国大陆手机号格式是否合法
 * @param {string | number} phone - 待校验的手机号（支持字符串或数字）
 * @returns {boolean} 合法返回 true，否则 false
 */
const validatePhoneNumber = (phone) => {
  if (!phone || typeof phone === 'boolean') return false;
  const str = String(phone).trim();
  return /^1[3-9]\d{9}$/.test(str);
};

const leftClick = () => {
  uni.navigateBack();
};
</script>

<template>
  <view style="position: relative" class="min-h-screen bg-white">
    <uv-navbar placeholder @leftClick="leftClick" leftIcon="arrow-left" title="登录" :bgColor="scrollTop > 0 ? '#f1f3f6' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view style="position: absolute; top: 0; left: 0; width: 100%">
      <uv-image src="/static/images/bg01.png" width="100%" mode="widthFix"></uv-image>
    </view>
    <view class="pl-30 pr-30 pt-100 pb-100 relative" style="z-index: 1; box-sizing: border-box">
      <view>
        <view class="pb-90 tc-010101">
          <view class="fs-56 mb-30">手机号</view>
          <view class="fs-48">登录/注册</view>
        </view>
        <view>
          <view class="form-row flex ai-center r-50 bg-white p-40">
            <view class="country-code fs-36">+86</view>
            <view class="ml-30 mr-30">|</view>
            <input v-model="phone" type="number" placeholder="请输入手机号" class="input-phone flex-1 fs-36" :maxlength="11" />
          </view>
          <view class="form-row flex ai-center r-50 bg-white p-40 mt-50">
            <input v-model="code" type="number" placeholder="请输入验证码" class="input-code flex-1 fs-36" :maxlength="6" />
            <uv-toast ref="toast"></uv-toast>
            <uv-code ref="codeRef" :seconds="seconds" @start="start" @change="codeChange"></uv-code>
            <view class="btn-get-code fs-36 t-2e70fc" @click="getCode">{{ tips || '获取验证码' }}</view>
          </view>

          <view class="flex jc-center ai-center mt-60">
            <view class="flex-1">
              <uv-button
                :text="isLoggingIn ? '登录中' : '手机号登录'"
                color="#2E70FC"
                :customTextStyle="{ 'font-size': '36rpx' }"
                :customStyle="{
                  'border-radius': '50rpx',
                  padding: '64rpx 0'
                }"
                :disabled="isLoggingIn"
                @click="handlePhoneLogin"
              ></uv-button>
            </view>
          </view>
        </view>
        <view @click="agreementChecked = !agreementChecked" class="agreement-row flex ai-center jc-center footer" style="bottom: 100rpx">
          <view :class="['agreement-checkbox', { checked: agreementChecked }]">
            <text v-if="agreementChecked" class="agreement-checkmark">✓</text>
          </view>
          <view class="fs-24" style="color: #222222">
            我已阅读并同意
            <text class="t-2e70fc" @click.stop="$uv.route('/pages/login/agreement?type=user')">《用户协议》</text>
            和
            <text class="t-2e70fc" @click.stop="$uv.route('/pages/login/agreement?type=privacy')">《隐私政策》</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.form-row {
  border: 2rpx solid #2e70fc;
}

.agreement-row {
  position: fixed;
  left: 30rpx;
  right: 30rpx;
}

.agreement-checkbox {
  width: 28rpx;
  height: 28rpx;
  margin-right: 8rpx;
  border: 2rpx solid #a7abb3;
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

.agreement-checkmark {
  color: #ffffff;
  font-size: 20rpx;
  line-height: 1;
  font-weight: 700;
}
</style>
