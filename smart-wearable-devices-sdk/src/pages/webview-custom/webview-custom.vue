<template>
  <view>
    <web-view
      v-if="url"
      :src="url"
      @message="handleWebViewMessage"
      @load="handleWebViewLoad"
      @error="handleWebViewError"
    ></web-view>
  </view>
</template>

<script setup lang="ts">
import { onBackPress, onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { useUserStore } from '@/stores/user';
import { requestH5Ticket } from '@/common/api/aiLab';

const userStore = useUserStore();
const url = ref('');
let leavingWebView = false;

const leaveWebViewPage = () => {
  if (leavingWebView) return;
  leavingWebView = true;
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack({
      delta: 1,
      fail: () => {
        leavingWebView = false;
      }
    });
    return;
  }
  uni.reLaunch({
    url: '/pages/awareness/awareness',
    fail: () => {
      leavingWebView = false;
    }
  });
};

const handleWebViewMessage = (event: any) => {
  const messages = Array.isArray(event?.detail?.data) ? event.detail.data : [];
  const shouldLeave = messages.some((item: any) => {
    const action = String(item?.action || item?.type || '').trim().toLowerCase();
    return action === 'back' || action === 'close' || action === 'navigateback';
  });
  if (shouldLeave) leaveWebViewPage();
};

const handleWebViewLoad = () => {
  console.info('[WebView] 页面加载成功', { url: url.value });
};

const handleWebViewError = (event: any) => {
  console.error('[WebView] 页面加载失败', { url: url.value, detail: event?.detail });
  uni.showToast({ title: '页面加载失败，请稍后重试', icon: 'none' });
};

onBackPress(() => {
  leaveWebViewPage();
  return true;
});

// 获取当前日期字符串，格式：YYYYMMDD
function getTodaysVersion() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

const XIAOQING_TODAY_SCENE_ID = 'xiaoqing_today';
const buildXiaoqingTicketUrl = (value: string, ticket: string) => {
  const source = String(value || '').trim();
  const hashIndex = source.indexOf('#');
  const hash = hashIndex >= 0 ? source.slice(hashIndex + 1) : '';
  const beforeHash = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const queryIndex = beforeHash.indexOf('?');
  const base = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const retained = (queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '')
    .split('&')
    .filter(Boolean)
    .filter((item) => !['ticket', 'tab', 'sceneid'].includes(decodeURIComponent(item.split('=', 1)[0] || '').toLowerCase()));
  const query = [...retained, `ticket=${encodeURIComponent(ticket)}`, 'tab=today', `sceneId=${XIAOQING_TODAY_SCENE_ID}`].join('&');
  const hashTicket = `ticket=${encodeURIComponent(ticket)}&sceneId=${XIAOQING_TODAY_SCENE_ID}`;
  const nextHash = hash ? `${hash}${hash.includes('?') ? '&' : '?'}${hashTicket}` : hashTicket;
  return `${base}?${query}#${nextHash}`;
};

onLoad(async (options: any) => {
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
  const handoffId = String(options?.handoff || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const handoffStorageKey = handoffId ? `qkeer:webview-handoff:${handoffId}` : '';
  let handedOffUrl = '';
  if (handoffStorageKey) {
    try {
      handedOffUrl = String(uni.getStorageSync(handoffStorageKey) || '').trim();
    } catch {
      handedOffUrl = '';
    }
    uni.removeStorage({ key: handoffStorageKey });
  }
  let fullUrl = handedOffUrl || decodeURIComponent(options?.url || '');
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
    const isXiaoqingUrl = /^https:\/\/sh\.qkeering\.com\/xiaoqin(?:g)?(?:\/|[?#]|$)/i.test(fullUrl);
    let hasTicket = /(?:[?&#]|%3F|%23|%26)ticket=/i.test(fullUrl);
    // Do not depend on a route marker to authenticate Xiaoqing. Some WeChat
    // environments drop secondary route parameters while retaining the H5 URL.
    // The destination URL itself is authoritative and is already restricted to
    // the trusted Xiaoqing host/path.
    if (isXiaoqingUrl && !hasTicket) {
      try {
        const response: any = await requestH5Ticket({ sceneId: XIAOQING_TODAY_SCENE_ID });
        const ticket = String(response?.ticket || response?.data?.ticket || '').trim();
        if (!ticket) throw new Error('H5 ticket 为空');
        fullUrl = buildXiaoqingTicketUrl(fullUrl, ticket);
        hasTicket = true;
      } catch (error) {
        console.error('[WebView] 获取小轻登录票据失败', error);
        uni.showToast({ title: '登录凭证获取失败，请稍后再试', icon: 'none' });
        setTimeout(() => uni.navigateBack(), 1200);
        return;
      }
    }
    if (isXiaoqingUrl && !hasTicket) {
      console.error('[WebView] 小轻地址缺少登录票据', {
        source: handedOffUrl ? 'storage-handoff' : 'route-query'
      });
      uni.showToast({ title: '登录参数传递失败，请重新进入', icon: 'none' });
      setTimeout(() => uni.navigateBack(), 1200);
      return;
    }
    url.value = fullUrl;
    console.info('[WebView] 完整地址已接收', {
      source: handedOffUrl ? 'storage-handoff' : 'route-query',
      hasTicket,
      hasSceneId: /[?&]sceneId=xiaoqing_today(?:&|#|$)/.test(fullUrl)
    });
  } else {
    url.value = `${baseUrl}${params}${hashRoute}?userId=${userId ? encodeURIComponent(userId) : ''}`;
  }

  // console.log('url.value', url.value);

  // console.log('Webview URL:', url.value);
});
</script>
