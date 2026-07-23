<template>
  <view class="bg-white r-30 p-30">
    <!-- 标题栏 -->
    <view class="flex jc-between ai-center mb-20">
      <view></view>
      <text class="fs-36 fw-600">{{ title }}</text>
      <view @click="$emit('close')">
        <uv-icon name="close" color="#ccc" size="20"></uv-icon>
      </view>
    </view>
    <!-- 图片 -->
    <view class="flex jc-center mb-20">
      <uv-image :src="imageSrc" width="120rpx" height="120rpx" mode="aspectFit"></uv-image>
    </view>
    <!-- 提示文字 -->
    <view class="ta-c mb-20">
      <text class="fs-28">{{ tipText }}</text>
    </view>
    <!-- 说明文字 -->
    <view class="mb-15">
      <text class="fs-28 fw-600">{{ description }}</text>
    </view>
    <!-- 注意事项列表 -->
    <view class="mb-25 ml-10">
      <view v-for="(item, index) in instructions" :key="index" class="flex ai-start mb-10">
        <text class="fs-28 mr-10">{{ index + 1 }}.</text>
        <text class="fs-28 flex-1">{{ item }}</text>
      </view>
    </view>
    <!-- 不再提示复选框 -->
    <view @tap="$emit('update:agreementChecked', !agreementChecked)" class="flex ai-center jc-center mb-30">
      <view>
        <view v-if="!agreementChecked" style="width: 24rpx; height: 24rpx; border: 1rpx solid #ccc; border-radius: 50%"></view>
        <view v-else>
          <uv-icon name="checkmark-circle-fill" color="#2E70FC" size="18"></uv-icon>
        </view>
      </view>
      <text class="fs-28 ml-10">不再提示</text>
    </view>
    <!-- 按钮 -->
    <view class="flex jc-center w-full r-10" style="overflow: hidden">
      <uv-button @click="$emit('confirm')" :customStyle="{ width: '100%' }" :text="confirmText" :color="confirmColor"></uv-button>
    </view>
  </view>
</template>

<script setup lang="ts">
interface Props {
  title?: string;
  imageSrc?: string;
  tipText?: string;
  description?: string;
  instructions?: string[];
  confirmText?: string;
  confirmColor?: string;
  agreementChecked?: boolean;
}

withDefaults(defineProps<Props>(), {
  title: '心率测量提示',
  imageSrc: '/static/images/homeDetail/heartLove.png',
  tipText: '测量时红灯将亮起30-60秒',
  description: '为保证测量结果的准确性，请您：',
  instructions: () => ['将戒指的凸起点紧贴指腹；', '尽量保持手部静止，手掌朝下。'],
  confirmText: '开始测量',
  confirmColor: '#5786fc',
  agreementChecked: false
});

defineEmits<{
  'update:agreementChecked': [value: boolean];
  confirm: [];
  close: [];
}>();
</script>
