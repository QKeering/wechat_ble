<template>
  <view>
    <web-view :src="url"></web-view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const url = ref('');

// 获取当前日期字符串，格式：YYYYMMDD
function getTodaysVersion() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

onLoad((options: any) => {
  // 获取用户ID
  const userId = userStore.userInfo?.id || '';

  const baseUrl = 'https://em.qkeering.com';
  // 每天生成新版本号
  const version = getTodaysVersion();

  // 解析传入的参数
  // 支持以下参数：
  // - url: 完整的URL（会覆盖其他参数）
  // - route: 路由路径（如 'aiPet' 或 '#/aiPet'）
  // - path: 与route相同，别名
  const fullUrl = decodeURIComponent(options?.url || '');
  let hashRoute = decodeURIComponent(options?.route || options?.path || '');

  // 如果hashRoute不以#开头，添加#
  if (hashRoute && !hashRoute.startsWith('#') && !hashRoute.startsWith('/')) {
    hashRoute = `#${hashRoute}`;
  } else if (hashRoute && hashRoute.startsWith('/') && !hashRoute.startsWith('#/')) {
    hashRoute = `#${hashRoute}`;
  }

  let params = `?v=${version}`;

  if (userId) {
    const encodedUserId = encodeURIComponent(userId);
    params += `&userId=${encodedUserId}`;
  }

  // 如果传入了完整URL，直接使用
  if (fullUrl) {
    url.value = fullUrl;
  } else {
    url.value = `${baseUrl}${params}${hashRoute}?userId=${userId ? encodeURIComponent(userId) : ''}`;
  }

  // console.log('url.value', url.value);

  // console.log('Webview URL:', url.value);
});
</script>
