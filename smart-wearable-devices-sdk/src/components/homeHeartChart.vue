<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
const props = defineProps({
  showRigntBox: {
    type: Boolean,
    default: true
  },
  showChartTitle: {
    type: Boolean,
    default: true
  },
  showButtomCard: {
    type: Boolean,
    default: true
  },
  showTopCard: {
    type: Boolean,
    default: false
  },
  showCardSmallTitle: {
    type: Boolean,
    default: false
  },
  showCardTitle: {
    type: Boolean,
    default: true
  },

  cardTitle: {
    type: String,
    default: '心率'
  },
  cardSmallTitle: {
    type: String,
    default: '(次/分钟)'
  },
  measureBtnText: {
    type: String,
    default: '测量'
  },
  currentRate: {
    type: [Number, String],
    default: 80
  },
  rateUnit: {
    type: String,
    default: '次/分钟'
  },
  stats: {
    type: Array<{ label: string; value: number | string }>,
    default: () => [
      { label: '平均心率', value: 43 },
      { label: '最大心率', value: 76 }
    ]
  }
});

const emit = defineEmits(['measure-click', 'chart-finished']);

const chartRef = ref(null);

const imageSrc = computed(() => {
  const srcMap = {
    心率: '/static/images/homeDetail/love.png',
    血氧饱和度: '/static/images/homeDetail/oxygen.png',
    心率变异性: '/static/images/homeDetail/heartLove.png'
  };
  return srcMap[props.cardTitle as keyof typeof srcMap] || '';
});
onLoad(() => {});
defineExpose({
  chartRef
});
</script>
<template>
  <view class="score-card r-50 bg-white p-30">
    <view>
      <!-- 标题栏 -->
      <view class="flex jc-between ai-center">
        <view>
          <text v-if="showCardTitle" class="fs-36">{{ cardTitle }}</text>
          <text v-if="showCardSmallTitle" class="fs-28 ml-10">{{ cardSmallTitle }}</text>
        </view>
        <view v-if="showRigntBox" class="textBox r-30 p-20 flex jc-between ai-center" @click="$emit('measure-click')">
          <uv-image v-if="imageSrc" :src="imageSrc" width="45rpx" height="45rpx"></uv-image>
          <text style="color: #ff5959">{{ measureBtnText }}</text>
        </view>
      </view>

      <view style="width: 100%" v-if="showChartTitle">
        <view class="flex ai-center jc-center">
          <uv-image v-if="imageSrc" :src="imageSrc" width="45rpx" height="45rpx"></uv-image>
          <view class="ml-15">
            <text class="fs-48">{{ currentRate }}</text>
            <text class="t-979797 fs-24">{{ rateUnit }}</text>
          </view>
        </view>
      </view>
      <view class="flex jc-around ai-center mt-30" v-if="showTopCard">
        <view class="ta-c" v-for="(item, index) in stats" :key="index">
          <view class="fs-36 fw-600">{{ item.value }}</view>
          <view class="fs-24 mt-10">{{ item.label }}</view>
        </view>
      </view>
      <view class="flex ai-center jc-center">
        <l-echart :ref="(el: any) => (chartRef = el)" @finished="$emit('chart-finished', chartRef)" style="width: 100%; height: 424rpx; margin: 0"></l-echart>
      </view>

      <!-- 统计信息 -->
      <view class="stats" v-if="showButtomCard">
        <view class="stat-item" v-for="(item, index) in stats" :key="index">
          <view class="stat-value">{{ item.value }}</view>
          <view class="stat-label">{{ item.label }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.score-card {
  margin-top: 30rpx;
  border-radius: 50rpx;
  background-color: #fff;
  padding: 30rpx;
  box-sizing: border-box;
}

.textBox {
  width: 100rpx;
  background-color: #ffeeee;
  border-radius: 30rpx;
  padding: 20rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}

.stats {
  display: flex;
  justify-content: space-around;
  align-items: center;
  margin-top: 36rpx;
  padding-top: 24rpx;
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 36rpx;
  font-weight: 600;
  color: #333;
  line-height: 1.2;
}

.stat-label {
  font-size: 24rpx;
  color: #999;
  margin-top: 8rpx;
}
</style>
