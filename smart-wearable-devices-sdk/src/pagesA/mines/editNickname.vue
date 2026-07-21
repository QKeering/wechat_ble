<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const nickName = ref('');
const saving = ref(false);

const decodeRouteParam = (value = '') => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const updateUserNickName = async () => {
  const nextNickName = nickName.value.trim();
  if (!nextNickName) {
    return uni.showToast({
      title: '请输入昵称',
      icon: 'error'
    });
  }
  if (saving.value) return;
  saving.value = true;
  try {
    await userStore.refreshUserInfo({
      nickName: nextNickName
    });
    nickName.value = nextNickName;
    uni.showToast({
      title: '修改成功',
      icon: 'success'
    });
    uni.navigateBack();
  } catch {
    uni.showToast({
      title: '保存失败，请稍后再试',
      icon: 'none'
    });
  } finally {
    saving.value = false;
  }
};

onLoad((e) => {
  nickName.value = decodeRouteParam(e.nickName || '');
});
</script>

<template>
  <view class="p-30">
    <view class="bg-white p-40 r-50">
      <uv-input maxlength="20" border="none" placeholder="请输入内容" v-model="nickName" :customStyle="{ fontSize: '36rpx' }"></uv-input>
    </view>
    <view class="footer p-30">
      <uv-button
        text="保存"
        color="#2E70FC"
        :customTextStyle="{ 'font-size': '36rpx' }"
        :customStyle="{
          'border-radius': '50rpx',
          padding: '64rpx 0',
          'box-shadow': '0 8rpx 20rpx 0 #2e70fc80'
        }"
        :disabled="saving"
        @click="updateUserNickName"
      ></uv-button>
      <uv-safe-bottom></uv-safe-bottom>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.footer {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  box-sizing: border-box;
}
</style>
