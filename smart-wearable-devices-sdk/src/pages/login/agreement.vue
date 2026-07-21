<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { privacyPolicy, userAgreement } from '@/common/api/login';

const content = ref('');
onLoad(async (e) => {
  let res;
  if (e.type == 'privacy') {
    uni.setNavigationBarTitle({
      title: '隐私政策'
    });
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
    uni.setNavigationBarTitle({
      title: '用户协议'
    });
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
