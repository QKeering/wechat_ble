<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

type MetricKey = 'heartRate' | 'spo2' | 'temperature' | 'heartRateVariability' | 'stressIndex' | 'bloodSugar' | 'bloodPressure';

const metrics = ref<Record<MetricKey, string>>({
  heartRate: '',
  spo2: '',
  temperature: '',
  heartRateVariability: '',
  stressIndex: '',
  bloodSugar: '',
  bloodPressure: ''
});

const metricCards = computed(() => [
  {
    key: 'heartRate',
    label: '心率',
    value: metrics.value.heartRate || '-',
    unit: metrics.value.heartRate ? 'bpm' : ''
  },
  {
    key: 'spo2',
    label: '血氧',
    value: metrics.value.spo2 || '-',
    unit: metrics.value.spo2 ? '%' : ''
  },
  {
    key: 'temperature',
    label: '皮肤温度',
    value: metrics.value.temperature || '设备未返回',
    unit: metrics.value.temperature ? '°C' : ''
  },
  {
    key: 'heartRateVariability',
    label: 'HRV',
    value: metrics.value.heartRateVariability || '-',
    unit: ''
  },
  {
    key: 'stressIndex',
    label: '压力',
    value: metrics.value.stressIndex || '-',
    unit: metrics.value.stressIndex ? '%' : ''
  },
  {
    key: 'bloodSugar',
    label: '血糖',
    value: metrics.value.bloodSugar || '-',
    unit: metrics.value.bloodSugar ? 'mmol/L' : ''
  },
  {
    key: 'bloodPressure',
    label: '血压',
    value: metrics.value.bloodPressure || '-',
    unit: metrics.value.bloodPressure ? 'mmHg' : ''
  }
]);

const hasValidResult = computed(() => Object.values(metrics.value).some(Boolean));

const normalizeMetric = (value: unknown) => {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return `${numeric}`;
  if (typeof value === 'string') {
    const matched = value.trim().match(/^(\d+(?:\.\d+)?)(?:\s*[^\d].*)?$/);
    if (matched) {
      const parsed = Number(matched[1]);
      if (Number.isFinite(parsed) && parsed > 0) return `${parsed}`;
    }
  }
  return '';
};

const getOptionMetric = (options: Record<string, unknown>, aliases: string[]) => {
  for (const alias of aliases) {
    const value = normalizeMetric(options[alias]);
    if (value) return value;
  }
  return '';
};

const normalizeBloodPressure = (...values: unknown[]) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const normalized = normalizeBloodPressureParts(value[0], value[1]);
      if (normalized) return normalized;
      continue;
    }
    if (typeof value === 'string' && value.includes('/')) {
      const [systolic, diastolic] = value.split('/');
      const normalized = normalizeBloodPressureParts(systolic, diastolic);
      if (normalized) return normalized;
      continue;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const normalized = normalizeBloodPressureParts(
        record.systolic ?? record.high ?? record.highPressure ?? record.bloodPressureHigh ?? record.sbp,
        record.diastolic ?? record.low ?? record.lowPressure ?? record.bloodPressureLow ?? record.dbp
      );
      if (normalized) return normalized;
    }
  }
  return '';
};

const normalizeBloodPressureParts = (systolic: unknown, diastolic: unknown) => {
  const normalizedSystolic = normalizeMetric(systolic);
  const normalizedDiastolic = normalizeMetric(diastolic);
  if (!normalizedSystolic && !normalizedDiastolic) return '';
  return [normalizedSystolic, normalizedDiastolic].filter(Boolean).join('/');
};

const leftClick = () => {
  uni.switchTab({
    url: '/pages/health/health'
  });
};

onLoad((options = {}) => {
  const reportOptions = options as Record<string, unknown>;
  const directBloodPressure = normalizeBloodPressure(
    reportOptions.bloodPressure,
    reportOptions.blood_pressure,
    reportOptions.bp
  );
  metrics.value = {
    heartRate: getOptionMetric(reportOptions, ['heartRate', 'heart_rate', 'heartRateValue', 'hr', 'HR']),
    spo2: getOptionMetric(reportOptions, [
      'spo2',
      'SpO2',
      'SPO2',
      'bloodOxygen',
      'blood_oxygen',
      'bloodOxygenSaturation',
      'oxygen',
      'oxygenSaturation'
    ]),
    temperature: getOptionMetric(reportOptions, ['temperature', 'temp', 'bodyTemperature', 'body_temperature', 'bodyTemp', 'skinTemperature']),
    heartRateVariability: getOptionMetric(reportOptions, ['heartRateVariability', 'heart_rate_variability', 'hrv', 'HRV']),
    stressIndex: getOptionMetric(reportOptions, ['stressIndex', 'stress_index', 'stress']),
    bloodSugar: getOptionMetric(reportOptions, ['bloodSugar', 'blood_sugar', 'glucose']),
    bloodPressure:
      directBloodPressure ||
      normalizeBloodPressureParts(
        reportOptions.systolic ?? reportOptions.high ?? reportOptions.highPressure ?? reportOptions.bloodPressureHigh ?? reportOptions.sbp,
        reportOptions.diastolic ?? reportOptions.low ?? reportOptions.lowPressure ?? reportOptions.bloodPressureLow ?? reportOptions.dbp
      )
  };
});
</script>

<template>
  <view class="report-page">
    <uv-navbar
      placeholder
      leftIcon="arrow-left"
      title="检测报告"
      bgColor="#f1f3f6"
      @leftClick="leftClick"
    ></uv-navbar>

    <view class="hero">
      <text class="hero-eyebrow">智能戒指</text>
      <text class="hero-title">健康检测结果</text>
      <text class="hero-desc">{{ hasValidResult ? '本次检测已完成' : '设备暂未返回有效检测值' }}</text>
    </view>

    <view class="metric-grid">
      <view v-for="item in metricCards" :key="item.key" class="metric-card">
        <text class="metric-label">{{ item.label }}</text>
        <view class="metric-value-row">
          <text class="metric-value">{{ item.value }}</text>
          <text v-if="item.unit" class="metric-unit">{{ item.unit }}</text>
        </view>
      </view>
    </view>

    <view class="tip-card">
      <text class="tip-title">说明</text>
      <text class="tip-text">未显示的指标表示当前设备未返回实时数值，不会按 0 参与记录。</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.report-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 30rpx;
  background: #f1f3f6;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding: 42rpx 36rpx;
  border-radius: 32rpx;
  background: linear-gradient(135deg, #2e70fc, #6b8eff);
  color: #fff;
}

.hero-eyebrow {
  font-size: 24rpx;
  opacity: 0.82;
}

.hero-title {
  font-size: 48rpx;
  font-weight: 700;
}

.hero-desc {
  font-size: 28rpx;
  opacity: 0.9;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20rpx;
  margin-top: 28rpx;
}

.metric-card {
  min-height: 156rpx;
  box-sizing: border-box;
  padding: 28rpx;
  border-radius: 24rpx;
  background: #fff;
}

.metric-label {
  display: block;
  color: #8b95a5;
  font-size: 26rpx;
}

.metric-value-row {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  margin-top: 22rpx;
}

.metric-value {
  color: #111827;
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.1;
}

.metric-unit {
  color: #6b7280;
  font-size: 24rpx;
}

.tip-card {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 28rpx;
  padding: 30rpx;
  border-radius: 24rpx;
  background: #fff;
}

.tip-title {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.tip-text {
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.6;
}
</style>
