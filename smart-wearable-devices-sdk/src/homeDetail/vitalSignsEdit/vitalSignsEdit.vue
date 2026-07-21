<script setup lang="ts">
// @ts-nocheck
import { reactive, ref } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';

const form = reactive({
  heartRate: true,
  bloodOxygenSaturation: true,
  heartRateVariability: true,
  skinTemperature: true
});

const list = ref([
  { name: '心率', value: 'heartRate' },
  { name: '血氧饱和度', value: 'bloodOxygenSaturation' },
  { name: '心率变异性', value: 'heartRateVariability' },
  { name: '皮肤温度', value: 'skinTemperature' }
]);

// 拖拽后新的数据
const newList = ref([]);
const change = (v) => (newList.value = v);
const handleOk = () => {
  const cardConfig = {
    // 提取所有卡片标识，包含不显示的卡片，记录顺序
    visibleCards: (newList.value.length != 0 ? newList.value : list.value).map((item) => item?.content?.value || item?.value),
    // 提取拖拽后且为 true 要显示的卡片标识
    listDatal: (newList.value.length != 0 ? newList.value : list.value)
      .filter((item) => form[item?.content?.value || item?.value])
      .map((item) => item?.content?.value || item?.value),
    form: { ...form }
  };
  const pages = getCurrentPages();
  if (pages.length < 2) {
    uni.navigateBack();
    return;
  }
  const prevPage = pages[pages.length - 2];

  prevPage.$vm.receiveCardConfig(cardConfig);

  uni.navigateBack({ delta: 1 });
};

onLoad((options) => {
  let cardForm = null;
  try {
    cardForm = options?.cardForm ? JSON.parse(options.cardForm as string) : null;
  } catch (e) {
    console.error('解析 cardForm 失败', e);
  }
  if (cardForm && typeof cardForm === 'object' && cardForm !== null && Object.keys(cardForm).length > 0) {
    Object.assign(form, cardForm);
  }

  let receivedVisibleCards = null;
  try {
    receivedVisibleCards = options?.visibleCards ? JSON.parse(options.visibleCards as string) : null;
  } catch (e) {
    console.error('解析 visibleCards 失败', e);
  }
  if (receivedVisibleCards && Array.isArray(receivedVisibleCards) && receivedVisibleCards.length > 0) {
    list.value = receivedVisibleCards.map((cardId) => list.value.find((item) => item.value === cardId)).filter((item): item is (typeof list.value)[0] => Boolean(item));
  }
});
</script>

<template>
  <view class="p-30">
    <view class="p-40 t-979797 fs-28">您可以选择是否显示，并调整卡片的排列顺序</view>
    <view class="bg-white r-50 p-40">
      <l-drag :list="list" @change="change" :column="1">
        <template #grid="{ active, content }">
          <view class="flex jc-between ai-center pb-35 border-b w-full">
            <text>{{ content.name }}</text>
            <uv-switch v-model="form[content.value]" inactive-color="#f3f4f6" active-color="#2e70fc"></uv-switch>
          </view>
        </template>
      </l-drag>
    </view>
    <view class="purchase-section p-30">
      <uv-button @click="handleOk" text="保存" shape="circle" color="#2e70fc"></uv-button>
      <uv-safe-bottom></uv-safe-bottom>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.purchase-section {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  box-sizing: border-box;
}
</style>
