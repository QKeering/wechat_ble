<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { privacyPolicy, userAgreement } from '@/common/api/login';
import { useI18n, usePageTitle } from '@/i18n';

const { t } = useI18n();
const content = ref('');
const pageType = ref('user');

usePageTitle(() => t(pageType.value == 'privacy' ? '隐私政策' : '用户协议'));

onLoad(async (e) => {
  let res;
  if (e.type == 'privacy') {
    pageType.value = 'privacy';
    try {
      res = await privacyPolicy(
        {},
        {
          custom: {
            auth: false
          }
        }
      );
      content.value = res.value;
    } catch {
      content.value = '';
    }
  } else if (e.type == 'user') {
    pageType.value = 'user';
    try {
      res = await userAgreement(
        {},
        {
          custom: {
            auth: false
          }
        }
      );
      content.value = res.value;
    } catch {
      content.value = '';
    }
  }
});
</script>

<template>
  <view class="p-30"><uv-parse :content="content"></uv-parse></view>
</template>

<style lang="scss" scoped></style>
