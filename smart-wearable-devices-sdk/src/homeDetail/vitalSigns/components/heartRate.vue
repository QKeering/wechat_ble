<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { baseOption } from '@/homeDetail/vitalSigns/echartOptions';
import { useRingBLE } from '@/composables/useRingBLE';
import { useUserStore } from '@/stores/user';
import { submitData } from '@/common/api/homeDetail';
import type { heartRateDetail, Point } from '@/types/api/homeDetail';
import { cloneDeep } from 'lodash-es';
import Action from '@/components/action.vue';
import { formatBleErrorMessage } from '@/utils/bleError';
import {
  formatMetricRecordTime,
  getLatestHeartRateReading,
  getLatestStressReading,
  getSubmitDeviceMac,
  requestMetricRefresh
} from '@/composables/useRingMetricReadings';
import { useRwForegroundMeasurement } from '@/composables/useRwForegroundMeasurement';
const { sendActiveMeasureCommand, refreshHealthData } = useRingBLE();
const { runRwForegroundMeasurement, stopActiveRwMeasurement } = useRwForegroundMeasurement();
const userStore = useUserStore();
const echarts = require('../../../static/echarts.min.js');
const chartRef = ref<any>(null);
const popup = ref<any>(null);
const measurePopup = ref<any>(null);

const agreementChecked = ref(false);
const props = defineProps({
  heartRateData: {
    type: Object as () => heartRateDetail,
    default: () => ({})
  },
  isHeartTate: {
    type: Boolean,
    default: true
  }
});
// 添加watch监听props变化
watch(
  () => props.heartRateData,
  async (newVal, oldVal) => {
    if (newVal !== oldVal) {
      // 当sleepDetailObj变化时，重新初始化图表
      await initChart();
    }
  },
  { deep: true }
);
const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const getProcessedOption = () => {
  const newOption = cloneDeep(baseOption);
  let fullXData: string[] = [];
  let fullSeriesData: (number | null)[] = [];
  if (props.heartRateData?.chartData && props.heartRateData.chartData.length > 0) {
    // 有数据时使用实际数据
    fullXData = props.heartRateData.chartData.map((item: Point) => item.time?.toString() || '00:00');
    fullSeriesData =
      props.heartRateData?.chartData?.map((item: Point) => {
        const value = Number(item.value);
        // 将0值替换为null，让ECharts跳过这些点
        return value === 0 ? null : value;
      }) || [];
  } else {
    // 没有数据时生成24小时的默认数据
    fullXData = Array.from({ length: 24 }, (_, i) => {
      const hour = i.toString().padStart(2, '0');
      return `${hour}:00`;
    });
  }
  // 替换xAxis.data和series.data为完整数据
  newOption.xAxis.data = fullXData;
  newOption.series[0].data = fullSeriesData as any;
  if (props.heartRateData?.chartData && props.heartRateData.chartData.length > 0) {
    // 过滤掉null值，计算有效数据的最大值
    const validData = fullSeriesData.filter((value) => value !== null && !isNaN(value)) as number[];
    if (validData.length > 0) {
      const maxValue = Math.max(...validData);
      // 如果最大值超过100，则动态调整Y轴最大值
      if (maxValue > 100) {
        const yAxisConfigs = [
          { max: 120, splitNumber: 6 },
          { max: 140, splitNumber: 7 },
          { max: 160, splitNumber: 8 },
          { max: 180, splitNumber: 9 },
          { max: 200, splitNumber: 10 },
          { max: 220, splitNumber: 11 },
          { max: 240, splitNumber: 12 }
        ];
        const config = yAxisConfigs.find((cfg) => maxValue <= cfg.max);
        if (config) {
          newOption.yAxis.max = config.max;
          newOption.yAxis.splitNumber = config.splitNumber;
        } else {
          // 如果超过240，使用自动调整
          newOption.yAxis.max = Math.ceil(maxValue / 20) * 20; // 向上取整到最近的20的倍数
          newOption.yAxis.splitNumber = Math.ceil(newOption.yAxis.max / 20); // 每20一个刻度
        }
      }
    }
  }
  // 设置x轴
  newOption.xAxis.axisLabel = {
    ...newOption.xAxis.axisLabel,
    interval: 0,
    formatter: (value: string, index: number) => {
      const dataLength = newOption.xAxis.data.length;
      // 如果数据长度为24，则只显示指定刻度
      if (dataLength === 24) {
        return [0, 6, 12, 18, 23].includes(index) ? value : '';
      } else {
        // 数据长度不为24时，显示两端和部分中间刻度
        const firstIndex = 0;
        const lastIndex = dataLength - 1;

        // 总是显示第一个和最后一个刻度
        if (index === firstIndex || index === lastIndex) {
          return value;
        }
        // 根据数据长度决定中间显示几个刻度
        if (dataLength <= 5) {
          // 数据很少时，显示所有刻度
          return value;
        } else if (dataLength <= 10) {
          // 中等长度数据，显示中间1个刻度
          const midIndex = Math.floor(dataLength / 2);
          return index === midIndex ? value : '';
        } else {
          // 较长数据，显示中间2个刻度（四等分点）
          const midIndex = Math.floor(dataLength / 2);
          const quarter1 = Math.floor(dataLength / 4);
          const quarter3 = Math.floor((dataLength * 3) / 4);
          return index === quarter1 || index === quarter3 || index === midIndex ? value : '';
        }
      }
    }
  } as any;
  return newOption;
};
const initChart = async () => {
  if (!chartRef.value) return;
  try {
    const pie = await chartRef.value.init(echarts);
    pie.setOption(getProcessedOption());
  } catch {
    // 图表失败时保持页面可用，避免体验版输出原始运行时错误。
  }
};
const jumpDetail = () => {
  (uni as any).$uv.route('/homeDetail/vitalSignsHeartDetail/vitalSignsDetail', {
    heartRate: heartRate.value
  });
};

// 测量状态：'idle' | 'measuring' | 'completed'
const measureStatus = ref('idle');
const heartRate = ref(0);

// 动态文本（计算属性）
const measureText = computed(() => {
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    return '未连接';
  }
  return '测量';
});
// 监听 userStore.receivedData 变化
watch(
  () => [userStore.receivedData, userStore.latestMetrics, userStore.healthData],
  (newData) => {
    if (measureStatus.value !== 'measuring') return;

    const latestReading = getLatestHeartRateReading(userStore, measureStartedAt);

    if (latestReading) {
      void completeMeasureWithLatestReading();
    }
  },
  { deep: true }
);
// 监听测量状态变化，在测量完成时调用接口
watch(
  () => measureStatus.value,
  async (newStatus, oldStatus) => {
    if (newStatus === 'completed' && oldStatus !== 'completed') {
      const latest: any = getLatestHeartRateReading(userStore, measureStartedAt);
      if (!latest?.heartRate) {
        measureStatus.value = 'idle';
        uni.showToast({ title: '设备未返回有效测量值', icon: 'none' });
        return;
      }

      const latestStress: any = getLatestStressReading(userStore, measureStartedAt);
      if (latest?.heartRate) {
        heartRate.value = latest.heartRate;
        uni.showToast({ title: '测量完成', icon: 'none' });
        // 调用提交数据的接口
        try {
          uni.showLoading({ title: '提交中...' });
          const recordTime = formatMetricRecordTime(latest.timestamp || Date.now());
          const stress = latestStress?.stressIndex ?? latestStress?.stress;
          const measurementRecord: { recordTime: string; heartRate: number; stress?: number } = {
            recordTime: recordTime,
            heartRate: latest.heartRate
          };
          if (stress !== undefined && stress !== null) {
            measurementRecord.stress = stress;
          }
          await submitData({
            deviceMac: getSubmitDeviceMac(userStore, isIOS.value),
            dataList: [measurementRecord]
          });
          uni.hideLoading();
          jumpDetail();
        } catch (error) {
          uni.hideLoading();
          uni.showToast({ title: '数据提交失败', icon: 'none' });
        }
      }
    }
  },
  { immediate: false }
);
let measureTimeout: any = null;
let measureStartedAt = 0;
const measureChange = (e: any) => {};
const isRwDevice = () => userStore.deviceInfo?.protocol === 'rw';
const completeMeasureWithLatestReading = async () => {
  if (measureTimeout) {
    clearTimeout(measureTimeout);
    measureTimeout = null;
  }
  popup.value?.close();
  if (isRwDevice()) {
    await stopActiveRwMeasurement('RW VITAL');
  }
  measureStatus.value = 'completed';
};
// 开始测量
const handleMeasure = () => {
  // 如果勾选了不再提示，直接开始测量
  if (agreementChecked.value) {
    startMeasure();
  } else {
    // 否则显示提示弹窗
    measurePopup.value.open();
  }
};
const startMeasure = async () => {
  measurePopup.value.close();
  if (!getSubmitDeviceMac(userStore, isIOS.value)) {
    uni.showToast({ title: '请先连接设备', icon: 'none' });
    (uni as any).$uv.route('/pagesA/mines/connectDevice');
    return;
  }

  // 清除可能残留的旧定时器
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }

  measureStatus.value = 'measuring';
  measureStartedAt = Date.now();

  popup.value.open();
  // 发送测量命令
  try {
    if (isRwDevice()) {
      await runRwForegroundMeasurement('heart_rate', {
        startedAt: measureStartedAt,
        measureStatus: () => measureStatus.value,
        source: 'RW VITAL'
      });
      await completeMeasureWithLatestReading();
      return;
    }
    await requestMetricRefresh(refreshHealthData, sendActiveMeasureCommand, { expectedSteps: 'heart_rate' });
  } catch (error) {
    popup.value?.close();
    if (isRwDevice()) {
      await stopActiveRwMeasurement('RW VITAL');
    }
    measureStatus.value = 'idle';
    measureStartedAt = 0;
    uni.showToast({ title: formatBleErrorMessage(error, '测量指令发送失败'), icon: 'none' });
    return;
  }

  measureTimeout = setTimeout(() => {
    void completeMeasureWithLatestReading();
    measureTimeout = null; // 清空引用
  }, 35000);
};
onLoad(async () => {});
onShow(async () => {
  measureStatus.value = 'idle';
});
onUnload(() => {
  if (measureTimeout) {
    clearTimeout(measureTimeout);
  }
  void stopActiveRwMeasurement('RW VITAL');
  if (chartRef.value && chartRef.value) {
    chartRef.value?.dispose();
  }
});
</script>
<template>
  <view class="score-card mb-30 r-50 bg-white p-30">
    <!-- 标题栏 -->
    <view class="flex jc-between ai-center">
      <view>
        <text class="fs-36">心率</text>
        <text v-if="!isHeartTate" class="fs-28">(次/分钟)</text>
        <slot></slot>
      </view>
      <view v-if="isHeartTate" class="textBox" @click.stop="handleMeasure">
<uv-image src="/static/images/homeDetail/love.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
        <text style="color: #ff5959">{{ measureText }}</text>
      </view>
    </view>
    <view @click="jumpDetail">
      <view style="width: 100%" v-if="isHeartTate">
        <view class="flex ai-center jc-center">
<uv-image src="/static/images/homeDetail/love.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
          <view class="ml-15">
            <text class="fs-48">{{ heartRateData?.newValue || '00' }}</text>
            <text class="t-979797 fs-24">次/分钟</text>
          </view>
        </view>
      </view>
      <view class="stats" v-if="!isHeartTate">
        <view class="stat-item">
          <view class="stat-value">{{ heartRateData?.avgValue || '00' }}</view>
          <view class="stat-label">平均心率</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ heartRateData?.maxValue || '00' }}</view>
          <view class="stat-label">最大心率</view>
        </view>
      </view>
      <view class="flex ai-center jc-center">
        <l-echart ref="chartRef" @finished="initChart" style="width: 100%; height: 424rpx; margin: 0"></l-echart>
      </view>

      <!-- 统计信息 -->
      <view class="stats" v-if="isHeartTate">
        <view class="stat-item">
          <view class="stat-value">{{ heartRateData?.avgValue || '00' }}</view>
          <view class="stat-label">平均心率</view>
        </view>
        <view class="stat-item">
          <view class="stat-value">{{ heartRateData?.maxValue || '00' }}</view>
          <view class="stat-label">最大心率</view>
        </view>
      </view>
    </view>
    <uv-popup ref="popup" mode="center" round="10rpx" :overlay="true" :closeOnClickOverlay="false" :safeAreaInsetBottom="false">
      <view class="p-30 flex fd-c ai-center" style="background: #030305e6">
        <!-- 添加heartbeat-animation类名 -->
        <view class="heartbeat-animation">
<uv-image src="/static/images/homeDetail/love.png" width="45rpx" height="45rpx" mode="aspectFit"></uv-image>
        </view>
        <view class="ml-20 t-white">测量中...</view>
      </view>
    </uv-popup>
    <uv-popup round="20" ref="measurePopup" mode="center" @change="measureChange">
      <Action :agreementChecked="agreementChecked" @update:agreementChecked="agreementChecked = $event" @confirm="startMeasure" @close="measurePopup?.close()" />
    </uv-popup>
  </view>
</template>

<style lang="scss" scoped>
.heartbeat-animation {
  animation: heartbeat 1.5s ease-in-out infinite;
}

@keyframes heartbeat {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10rpx); /* 上下移动10rpx */
  }
}
.score-card {
  margin-top: 30rpx;
  border-radius: 50rpx;
  background-color: #fff;
  padding: 30rpx;
  box-sizing: border-box;
}

.textBox {
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
