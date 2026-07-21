<template>
  <view>
    <web-view :src="url"></web-view>
  </view>
</template>

<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const url = ref('https://em.qkeering.com/#/aiPet');

// 👇 获取当前日期字符串，格式：YYYYMMDD
function getTodaysVersion() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // 月份从0开始
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

onShow(() => {
  // 获取用户ID
  const userId = userStore.userInfo?.id || '';

  const baseUrl = 'https://em.qkeering.com';
  const hashRoute = '#aiPet';
  // ✅ 每天生成新版本号，如 20260211
  const version = getTodaysVersion();

  let params = `?v=${version}`;

  if (userId) {
    const encodedUserId = encodeURIComponent(userId);
    params += `&userId=${encodedUserId}`;
  }

  url.value = `${baseUrl}${params}${hashRoute}`;
  // console.log(url.value);
});
</script>
