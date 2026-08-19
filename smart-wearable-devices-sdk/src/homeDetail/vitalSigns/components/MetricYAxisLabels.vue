<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    splitNumber?: number;
  }>(),
  {
    min: 0,
    max: 120,
    splitNumber: 6
  }
);

const ticks = computed(() => {
  const splitNumber = Math.max(1, Math.round(props.splitNumber));
  const span = props.max - props.min;
  return Array.from({ length: splitNumber + 1 }, (_, index) => ({
    key: `${props.min}-${props.max}-${index}`,
    label: Math.round(props.max - (span * index) / splitNumber),
    top: (index / splitNumber) * 100
  }));
});
</script>

<template>
  <view class="metric-y-axis" aria-hidden="true">
    <text
      v-for="tick in ticks"
      :key="tick.key"
      class="metric-y-tick"
      :style="{ top: `${tick.top}%` }"
    >{{ tick.label }}</text>
  </view>
</template>

<style lang="scss" scoped>
.metric-y-axis {
  position: absolute;
  z-index: 3;
  left: 0;
  top: 112rpx;
  bottom: 36rpx;
  width: 70rpx;
  color: #666;
  font-size: 20rpx;
  line-height: 1;
  pointer-events: none;
}

.metric-y-tick {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  white-space: nowrap;
}
</style>
