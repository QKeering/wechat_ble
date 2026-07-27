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
  },
  timeTicks: {
    type: Array as () => Array<{ key: string; label: string; left: number; isFirst?: boolean; isLast?: boolean }>,
    default: () => []
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
      <view class="chart-card-header flex jc-between ai-center">
        <view class="chart-card-title">
          <text v-if="showCardTitle" class="fs-36">{{ cardTitle }}</text>
          <text v-if="showCardSmallTitle" class="fs-28 ml-10">{{ cardSmallTitle }}</text>
        </view>
        <view v-if="showRigntBox" class="textBox r-30 p-20 flex jc-between ai-center" @click="$emit('measure-click')">
<uv-image v-if="imageSrc" :src="imageSrc" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
          <text style="color: #ff5959">{{ measureBtnText }}</text>
        </view>
      </view>

      <view class="chart-value" v-if="showChartTitle">
        <view class="flex ai-center jc-center">
<uv-image v-if="imageSrc" :src="imageSrc" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
          <view class="ml-15">
            <text class="fs-48">{{ currentRate }}</text>
            <text class="t-979797 fs-24">{{ rateUnit }}</text>
          </view>
        </view>
      </view>
      <view class="top-stats flex jc-around ai-center mt-30" v-if="showTopCard">
        <view class="ta-c" v-for="(item, index) in stats" :key="index">
          <view class="fs-36 fw-600">{{ item.value }}</view>
          <view class="fs-24 mt-10">{{ item.label }}</view>
        </view>
      </view>
      <view class="chart-area flex ai-center jc-center">
        <l-echart :ref="(el: any) => (chartRef = el)" @finished="$emit('chart-finished', chartRef)" class="chart-canvas"></l-echart>
      </view>
      <view v-if="timeTicks.length" class="chart-time-axis">
        <text
          v-for="tick in timeTicks"
          :key="tick.key"
          class="chart-time-tick"
        >{{ tick.label }}</text>
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
  position: relative;
  margin-top: 30rpx;
  border-radius: 50rpx;
  background-color: #fff;
  padding: 30rpx;
  box-sizing: border-box;
  overflow: hidden;
}

.chart-card-header,
.chart-card-title,
.chart-value,
.top-stats,
.stats {
  position: relative;
  z-index: 2;
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

.chart-value {
  width: 100%;
  margin-top: 20rpx;
}

.top-stats {
  min-height: 96rpx;
  padding: 18rpx 12rpx;
  border-radius: 28rpx;
  background: #f8faff;
}

.chart-area {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 320rpx;
  margin-top: 18rpx;
  overflow: hidden;
}

.chart-canvas {
  width: 100%;
  height: 320rpx;
  margin: 0;
}

.chart-time-axis {
  position: relative;
  z-index: 2;
  height: 42rpx;
  margin: 2rpx 28rpx 0;
  display: flex;
  justify-content: space-between;
  color: #9ca3af;
  font-size: 20rpx;
  line-height: 1;
}

.chart-time-tick {
  white-space: nowrap;
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
