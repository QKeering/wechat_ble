<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad, onPageScroll, onShow, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app';
import homeHeartChart from '@/components/homeHeartChart.vue';
import HeartRate from '@/homeDetail/vitalSigns/components/heartRate.vue';
import oxyGen from '@/homeDetail/vitalSigns/components/oxyGen.vue';
import heartRateVariability from '@/homeDetail/vitalSigns/components/heartRateVariability.vue';
import temperature from '@/homeDetail/vitalSigns/components/temperature.vue';
import { getDateInfo, getYesterday, getBeforeYesterday, formatLocalDate } from '@/utils/utils.js';
import { getHeartRateDetail, getBloodOxygenDetail, getBodyTemperatureDetail, getHrvDetail, getVitalSign } from '@/common/api/homeDetail';
import type { heartRateDetail, Point, vitalSignType } from '@/types/api/homeDetail';
import { useUserStore } from '@/stores/user';
import { useRingStore } from '@/stores';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingBusinessHistoryPageSync, type HistoryPageSilentRequestConfig } from '@/composables/useRingBusinessHistoryPageSync';
import { submitData } from '@/common/api/homeDetail';
import { formatBleErrorMessage, isExpectedBleRuntimeError } from '@/utils/bleError';
import {
  buildRingHistorySubmitRecords,
  getRingHistoryRecordUnixTime,
  getRingSubmitDeviceMac,
  isRingHistoryPayload,
  isRingHistoryReadComplete
} from '@/composables/useRingHistoryUpload';

import DetailInfo from '@/components/DetailInfo.vue';
import {usePopupFixer} from '@/hooks/usePopupFixer'

const { isDeviceConnected, autoConnectLastDevice, deviceInfo: ringDeviceInfo, readLocalData, refreshHealthData } = useRingBLE();
const userStore = useUserStore();
const ringStore = useRingStore();
const ringBleBridge = useRingBusinessHistoryPageSync();
const scrollTop = ref<number>(0);

const { isPopupActive, fixedPageStyle } = usePopupFixer()


// 记录上一次的 localData 长度，用于判断是否是新数据
let lastLocalDataLength = 0;

const calendar = ref<any>(null);

const today = ref(new Date());
const yesterday = ref(getYesterday(today.value));
const beforeYesterday = ref(getBeforeYesterday(today.value));

// 计算日期信息（星期+日）
const yesterdayInfo = ref(getDateInfo(yesterday.value));
const beforeYesterdayInfo = ref(getDateInfo(beforeYesterday.value));

// 当前选中的日期索引（0:前天，1:昨天，2:今天）
const selectedDayIndex = ref(2);

const heartRateObj = ref<heartRateDetail>({});
const oxyGenObj = ref<heartRateDetail>({});
const temperatureObj = ref<heartRateDetail>({});
const hrvObj = ref<heartRateDetail>({});
const extendedVitalObj = ref<vitalSignType>({});

const getMetricNumber = (value: unknown) => {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};
const RW_BLOOD_PRESSURE_STATUS_BYTES = new Set([0x11, 0x31]);
const getObjectValue = (source: unknown, key: string) =>
  source && typeof source === 'object' ? (source as Record<string, any>)[key] : undefined;
const getFirstObjectMetricValue = (sources: unknown[], keys: string[]) => {
  for (const source of sources) {
    for (const key of keys) {
      const value = getObjectValue(source, key);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
};
const getExtendedVitalValue = (...keys: string[]) => getFirstObjectMetricValue([extendedVitalObj.value], keys);
const getCachedMetricValue = (...keys: string[]) => getFirstObjectMetricValue([userStore.healthData, userStore.latestMetrics], keys);
const withMetricFallback = (source: heartRateDetail, value: unknown, extra: Record<string, any> = {}) => {
  const metric = getMetricNumber(value);
  if (!metric) return source;
  const hasChartData = Array.isArray((source as any)?.chartData) && (source as any).chartData.length > 0;
  return {
    ...source,
    newValue: getMetricNumber((source as any)?.newValue) ? (source as any).newValue : metric,
    avgValue: getMetricNumber((source as any)?.avgValue) ? (source as any).avgValue : metric,
    maxValue: getMetricNumber((source as any)?.maxValue) ? (source as any).maxValue : metric,
    chartData: hasChartData ? (source as any).chartData : [{ time: 'now', value: metric }],
    ...extra
  } as heartRateDetail;
};
const heartRateDisplayObj = computed(() =>
  withMetricFallback(
    heartRateObj.value,
    getExtendedVitalValue('heartRateAvg', 'heartRate') ?? userStore.healthData?.heartRate ?? userStore.latestMetrics?.heartRate
  )
);
const oxyGenDisplayObj = computed(() =>
  withMetricFallback(
    oxyGenObj.value,
    getExtendedVitalValue('spo2Avg', 'spo2', 'bloodOxygen', 'bloodOxygenSaturation') ??
      userStore.healthData?.bloodOxygen ??
      userStore.healthData?.bloodOxygenSaturation ??
      userStore.latestMetrics?.bloodOxygen,
    {
      avgValueRange: (oxyGenObj.value as any)?.avgValueRange || '95-100'
    }
  )
);
const hrvDisplayObj = computed(() =>
  withMetricFallback(
    hrvObj.value,
    getExtendedVitalValue('hrvAvg', 'hrv', 'heartRateVariability') ??
      userStore.healthData?.hrv ??
      userStore.healthData?.heartRateVariability ??
      userStore.latestMetrics?.hrv,
    {
      avgValueRange: (hrvObj.value as any)?.avgValueRange || '--'
    }
  )
);
const temperatureDisplayObj = computed(() => {
  const metric = getMetricNumber(
    getExtendedVitalValue('temperatureAvg', 'temperature', 'skinTemperature') ??
      userStore.healthData?.temperature ??
      userStore.healthData?.skinTemperature ??
      userStore.latestMetrics?.temperature
  );
  if (!metric) return temperatureObj.value;
  return {
    ...temperatureObj.value,
    avgValue: getMetricNumber((temperatureObj.value as any)?.avgValue) ? (temperatureObj.value as any).avgValue : `${metric}°C`,
    baseValue: getMetricNumber((temperatureObj.value as any)?.baseValue) ? (temperatureObj.value as any).baseValue : `${metric}°C`,
    diffValue: (temperatureObj.value as any)?.diffValue || '0°C'
  } as heartRateDetail;
});
const isSelectedToday = computed(() => selectedHistoryDate.value === formatLocalDate(new Date()));
const bloodSugarDisplay = computed(() =>
  getMetricNumber(
    getExtendedVitalValue('bloodSugarAvg', 'bloodSugar', 'blood_sugar', 'glucose', 'sugar') ??
      (isSelectedToday.value ? getCachedMetricValue('bloodSugar', 'blood_sugar', 'glucose', 'sugar') : null)
  )
);
const getBloodPressureParts = (...sources: unknown[]) => {
  for (const value of sources) {
    if (Array.isArray(value)) {
      const values =
        typeof value[0] === 'number' && RW_BLOOD_PRESSURE_STATUS_BYTES.has(value[0]) ? value.slice(1) : value;
      const systolic = getMetricNumber(values[0]);
      const diastolic = getMetricNumber(values[1]);
      if (systolic || diastolic) return [systolic, diastolic];
      continue;
    }
    if (value && typeof value === 'object') {
      const item = value as Record<string, any>;
      const systolic = getMetricNumber(
        item.systolic ??
          item.systolicValue ??
          item.systolic_value ??
          item.high ??
          item.highPressure ??
          item.high_pressure ??
          item.bloodPressureHigh ??
          item.blood_pressure_high ??
          item.sbp ??
          item.sp
      );
      const diastolic = getMetricNumber(
        item.diastolic ??
          item.diastolicValue ??
          item.diastolic_value ??
          item.low ??
          item.lowPressure ??
          item.low_pressure ??
          item.bloodPressureLow ??
          item.blood_pressure_low ??
          item.dbp ??
          item.dp
      );
      if (systolic || diastolic) return [systolic, diastolic];
      continue;
    }
    const matched = String(value || '').match(/(\d{2,3})\D+(\d{2,3})/);
    if (matched) return [getMetricNumber(matched[1]), getMetricNumber(matched[2])];
  }
  return [null, null];
};
const bloodPressureDisplay = computed(() => {
  const apiSystolic = getMetricNumber(
    getExtendedVitalValue('systolicAvg', 'systolic', 'highAvg', 'highPressureAvg', 'bloodPressureHighAvg', 'high', 'highPressure', 'bloodPressureHigh', 'sbp', 'sp')
  );
  const apiDiastolic = getMetricNumber(
    getExtendedVitalValue('diastolicAvg', 'diastolic', 'lowAvg', 'lowPressureAvg', 'bloodPressureLowAvg', 'low', 'lowPressure', 'bloodPressureLow', 'dbp', 'dp')
  );
  if (apiSystolic && apiDiastolic) return `${Math.round(apiSystolic)}/${Math.round(apiDiastolic)}`;
  if (!isSelectedToday.value) return '';
  const [systolic, diastolic] = getBloodPressureParts(
    getCachedMetricValue('bloodPressure', 'blood_pressure', 'bloodPressureValue', 'blood_pressure_value', 'bp', 'bpValue', 'bp_value'),
    {
      systolic: getCachedMetricValue(
        'systolic',
        'systolicValue',
        'systolic_value',
        'high',
        'highPressure',
        'high_pressure',
        'bloodPressureHigh',
        'blood_pressure_high',
        'sbp',
        'sp'
      ),
      diastolic: getCachedMetricValue(
        'diastolic',
        'diastolicValue',
        'diastolic_value',
        'low',
        'lowPressure',
        'low_pressure',
        'bloodPressureLow',
        'blood_pressure_low',
        'dbp',
        'dp'
      )
    }
  );
  return systolic && diastolic ? `${Math.round(systolic)}/${Math.round(diastolic)}` : '';
});
const getCurrentRingProtocol = () =>
  ringDeviceInfo.value?.protocol || ringStore.deviceInfo?.protocol || userStore.deviceInfo?.protocol;
const isCurrentRwRing = () => getCurrentRingProtocol() === 'rw';
const showRwExtendedVitals = computed(() => Boolean(isCurrentRwRing() && (bloodSugarDisplay.value || bloodPressureDisplay.value)));

const refreshBleMetricsSafely = async () => {
  try {
    await refreshHealthData({
      includeDeviceTime: false,
      includeCollectPeriod: false,
      includeRealtimeMetrics: isCurrentRwRing() ? false : undefined,
      includeHistorySnapshot: isCurrentRwRing() ? false : undefined,
      timeoutMs: isCurrentRwRing() ? 35000 : 3500
    });
  } catch (error) {
    if (!isExpectedBleRuntimeError(error)) {
      formatBleErrorMessage(error);
    }
  }
};

const refreshBleMetricsAfterRestore = async () => {
  const { deviceId, serviceId } = userStore.deviceInfo;
  if (deviceId) {
    const alreadyConnected = await isDeviceConnected(deviceId, serviceId || '');
    if (alreadyConnected) {
      await refreshBleMetricsSafely();
      return;
    }
  }

  const restored = await autoConnectLastDevice();
  if (restored || userStore.deviceInfo.deviceId) {
    await refreshBleMetricsSafely();
  }
};

// 日期列表数据
const dateList = ref([
  { date: beforeYesterday.value, info: beforeYesterdayInfo.value, label: 'beforeYesterday' },
  { date: yesterday.value, info: yesterdayInfo.value, label: 'yesterday' },
  { date: today.value, info: { week: '今天', day: '' }, label: 'today' }
]);

// 添加是否已选择日期的状态
const hasSelectedDate = ref(false);

// 修改选择的日期信息结构，添加monthDay字段
const selectedDateInfo = ref({
  year: today.value.getFullYear().toString(),
  monthDay: `${(today.value.getMonth() + 1).toString().padStart(2, '0')}-${today.value.getDate().toString().padStart(2, '0')}`
});
const selectedHistoryDate = ref(formatLocalDate(today.value));
const queryVitalPage = <T>(endpoint: string, query: (requestConfig: HistoryPageSilentRequestConfig) => Promise<T>) =>
  ringBleBridge.queryHistoryPage({
    page: 'vitalSigns',
    date: selectedHistoryDate.value,
    endpoint,
    query
  });

const local = computed(() => userStore.localData);
// 是否为iOS的计算属性
const isIOS = computed(() => {
  const systemInfo = uni.getSystemInfoSync();
  return systemInfo.platform.toLowerCase().includes('ios');
});
const updateSelectedHistoryDateFromIndex = (index: number) => {
  const targetDate = dateList.value[index]?.date || today.value;
  selectedHistoryDate.value = formatLocalDate(targetDate);
};
const syncVitalSignsHistorySafely = async () => {
  try {
    if (!isCurrentRwRing()) {
      await readLocalData(false);
    }
  } catch (error) {
    if (!isExpectedBleRuntimeError(error)) {
      formatBleErrorMessage(error);
    }
  }
  await getExtendedVitalSignData().catch(() => undefined);
};
watch(
  () => userStore.reconnectResult, // 监听的目标属性
  async (newValue, oldValue) => {
    if (newValue === true) {
      await syncVitalSignsHistorySafely();
    }
  }
);
// 监听 localData 的变化，处理历史数据上传
watch(
  () => userStore.localData,
  async (newData) => {
    const localData: any = userStore.receivedData?.filter(isRingHistoryPayload);
    if (!localData || localData.length === 0) {
      return;
    }

    const isRwHistoryPayload = localData.some((item: any) => item?.protocol === 'rw' || item?.type === 'rw_upload_file' || item?.type === 'rw_file_list');
    if (isCurrentRwRing() && isRwHistoryPayload) {
      return;
    }

    // 如果是新开始的数据读取（localData 长度变化），显示 loading
    // if (userStore.localData.length > lastLocalDataLength) {
    //   uni.showLoading({
    //     title: '读取设备历史数据中，请勿离开',
    //     mask: true
    //   });
    // }
    lastLocalDataLength = userStore.localData.length;

    try {
      if (isRingHistoryReadComplete(localData)) {
        // 数据读取完成，隐藏 loading
        // uni.hideLoading();

        const filteredRecords = local.value || [];
        const submitArray = buildRingHistorySubmitRecords(filteredRecords, userStore.lastReadTimestamp);

        if (submitArray.length !== 0) {
          uni.showLoading({
            title: '上传历史数据中...',
            mask: true
          });
          await submitData({
            deviceMac: getRingSubmitDeviceMac(userStore, isIOS.value),
            dataList: submitArray
          });

          const submittedTimestamps = filteredRecords
            .map((record: any) => getRingHistoryRecordUnixTime(record))
            .filter(
              (timestamp): timestamp is number =>
                Boolean(timestamp && timestamp > 0 && (!userStore.lastReadTimestamp || timestamp >= userStore.lastReadTimestamp))
            );
          if (submittedTimestamps.length > 0) {
            const maxTimestamp = Math.max(...submittedTimestamps);
            userStore.updateLastReadTimestamp(maxTimestamp);
          }

          await new Promise((resolve) => setTimeout(resolve, 300));
          uni.hideLoading();
        }
      }
    } catch (error) {
      uni.hideLoading();
      uni.showToast({
        title: '处理数据失败',
        icon: 'none',
        duration: 2000
      });
    }
  },
  { deep: true }
);
// 点击日期处理函数
const handleDateClick = async (index: number) => {
  selectedDayIndex.value = index;
  updateSelectedHistoryDateFromIndex(index);
  const currentDate = dateList.value[index]?.date || today.value;
  await syncVitalSignsHistorySafely();
  await getRatDetail(currentDate);
  await getOxyGenDetail(currentDate);
  await getTemperatureDetail(currentDate);
  await getHrvData(currentDate);
};

const normalizeSelectedDayIndex = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 3 ? numeric : 2;
};

const listData = ref<string[]>(['heartRate', 'bloodOxygenSaturation', 'heartRateVariability', 'skinTemperature']);
const visibleCards = ref<string[]>([]);
const cardForm = ref();

const getExtendedVitalSignData = async () => {
  const result = await queryVitalPage('vital-sign', (requestConfig) => getVitalSign({ date: selectedHistoryDate.value }, requestConfig));
  extendedVitalObj.value = result || {};
};

// 获取心率详情
const getRatDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();
    // 今天减去选择日期，得到正的天数差值
    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  const res = await queryVitalPage('heart-rate-detail', (requestConfig) => getHeartRateDetail({
    date: isoDate,
    type: 'day',
    offset
  }, requestConfig));
  if (res) {
    heartRateObj.value = res;
  }
};
// 获取心率变异性详情
const getHrvData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  // const index = selectedDayIndex.value - 2;
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();
    // 今天减去选择日期，得到正的天数差值
    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  const res = await queryVitalPage('hrv-detail', (requestConfig) => getHrvDetail({
    date: isoDate,
    type: 'day',
    offset
  }, requestConfig));
  if (res) {
    hrvObj.value = res;
  }
};
// 获取血氧详情
const getOxyGenDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  // const index = selectedDayIndex.value - 2;
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();
    // 今天减去选择日期，得到正的天数差值
    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  const res = await queryVitalPage('blood-oxygen-detail', (requestConfig) => getBloodOxygenDetail({
    date: isoDate,
    type: 'day',
    offset
  }, requestConfig));
  if (res) {
    oxyGenObj.value = res;
  }
};

// 获取温度详情
const getTemperatureDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  // const index = selectedDayIndex.value - 2;
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const today = new Date();
    // 今天减去选择日期，得到正的天数差值
    const diffTime = today.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }
  const res = await queryVitalPage('temperature-detail', (requestConfig) => getBodyTemperatureDetail({
    date: isoDate,
    type: 'day',
    offset
  }, requestConfig));
  if (res) {
    temperatureObj.value = res;
  }
};
const confirm = async (date: any) => {
  // 处理选择的日期，date可能是数组或单个日期对象
  let selectedDate;
  selectedDate = new Date(date.fulldate);
  // 更新选择的日期信息，使用月-日格式
  const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
  const day = selectedDate.getDate().toString().padStart(2, '0');

  selectedDateInfo.value = {
    year: selectedDate.getFullYear().toString(),
    monthDay: `${month}-${day}`
  };

  // 标记为已选择日期
  hasSelectedDate.value = true;
  selectedDayIndex.value = 3;
  const currentDate = selectedDate;
  selectedHistoryDate.value = formatLocalDate(currentDate);
  await syncVitalSignsHistorySafely();
  await getRatDetail(currentDate);
  await getOxyGenDetail(currentDate);
  await getTemperatureDetail(currentDate);
  await getHrvData(currentDate);
};
const receiveCardConfig = (config: { listDatal: string[]; visibleCards: string[]; form: any }) => {
  listData.value = config.listDatal;
  visibleCards.value = config.visibleCards;
  cardForm.value = config.form;
};

const jumpEdit = () => {
  (uni as any).$uv.route('/homeDetail/vitalSignsEdit/vitalSignsEdit', {
    cardForm: JSON.stringify(cardForm.value),
    visibleCards: JSON.stringify(visibleCards.value)
  });
};
const leftClick = (): void => {
  uni.navigateBack();
};
onLoad(async (options) => {
  const dayIndex = normalizeSelectedDayIndex(options?.selectedDayIndex);
  selectedDayIndex.value = dayIndex;

  if (dayIndex === 3 && options?.selectedDate) {
    const formattedDate = uni.$uv.timeFormat(options.selectedDate, 'yyyy-mm-dd');
    if (formattedDate && formattedDate !== 'NaN-NaN-NaN') {
      await confirm({ fulldate: formattedDate });
      return;
    }
  }

  await handleDateClick(dayIndex === 3 ? 2 : dayIndex);
});
onShow(async () => {
  // await getRatDetail();
  // await getOxyGenDetail();
  // await getTemperatureDetail();
  // await getHrvData();
  if (userStore.reconnectStatus === 'reconnecting' || userStore.isReconnecting === true) {
    uni.showToast({
      title: '正在重连中，请稍后再试',
      icon: 'none',
      duration: 2000
    });
    return;
  }
  if (!isCurrentRwRing()) {
    await refreshBleMetricsAfterRestore();
  }
  // await new Promise((resolve) => setTimeout(resolve, 1000));
  // await readLocalData(false);
});
// 下拉刷新事件处理器
onPullDownRefresh(async () => {
  try {
    selectedDayIndex.value = 2;
    updateSelectedHistoryDateFromIndex(2);
    if (userStore.reconnectStatus === 'reconnecting' || userStore.isReconnecting === true) {
      uni.showToast({
        title: '正在重连中，请稍后再试',
        icon: 'none',
        duration: 2000
      });
      return;
    }
    if (!isCurrentRwRing()) {
      await refreshBleMetricsAfterRestore();
    }
    await syncVitalSignsHistorySafely();
    await getRatDetail();
    await getOxyGenDetail();
    await getTemperatureDetail();
    await getHrvData();
  } catch (error) {
    uni.showToast({
      title: formatBleErrorMessage(error, '刷新失败，请稍后再试'),
      icon: 'none',
      duration: 2000
    });
  } finally {
    uni.stopPullDownRefresh();
  }
});
onPageScroll((e) => {
  scrollTop.value = e.scrollTop;
});
defineExpose({
  receiveCardConfig
});
const openTimePicker = () => {
  calendar.value.open();
};
</script>
<template>
  <page-meta :page-style="fixedPageStyle"></page-meta>

  <view class="relative p-30">
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="生命体征" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
    <view class="bgcWrapper"></view>
    <view class="pt-30 pr-30 pl-30 relative mb-30" style="z-index: 1; box-sizing: border-box">
      <view class="calendar-week flex">
        <view
          class="calendar-day flex fd-c jc-center ai-center mr-20"
          :class="{
            'calendar-day--selected': selectedDayIndex === 3
          }"
          @tap="openTimePicker()"
        >
          <view class="calendar-day__label" :class="selectedDayIndex === 3 ? 't-white' : 't-979797'">
            <template v-if="hasSelectedDate">
              <view class="ta-c">{{ selectedDateInfo.year }}</view>
              <view class="ta-c">{{ selectedDateInfo.monthDay }}</view>
            </template>
            <template v-else>
              <view class="ta-c">选择</view>
              <view class="ta-c">日期</view>
            </template>
          </view>
        </view>
        <view
          v-for="(dateItem, index) in dateList"
          :key="index"
          class="calendar-day flex fd-c jc-center ai-center mr-20"
          :class="{
            'calendar-day--selected': index === selectedDayIndex
          }"
          @tap="handleDateClick(index)"
        >
          <view class="calendar-day__label" :class="index === selectedDayIndex ? 't-white' : 't-979797'">
            {{ dateItem.info.week }}
          </view>
          <view class="calendar-day__date" :class="index === selectedDayIndex ? 't-white' : ''">
            <template v-if="index === 2">
              <uv-icon name="arrow-down" color="#fff" size="14" v-if="index === selectedDayIndex"></uv-icon>
              <uv-icon name="arrow-down" color="#010101" size="14" v-else></uv-icon>
            </template>
            <template v-else>
              {{ dateItem.info.day }}
            </template>
          </view>
        </view>
      </view>
    </view>
    <uni-calendar ref="calendar" :insert="false" @confirm="confirm" />
    <view v-for="cardId in listData" :key="cardId">
      <HeartRate v-if="cardId === 'heartRate'" :heartRateData="heartRateDisplayObj" >
        <DetailInfo id="heart_rate" v-model:isPopupActive="isPopupActive" style="margin-left: 14rpx;"></DetailInfo>
      </HeartRate>
      <oxyGen v-else-if="cardId === 'bloodOxygenSaturation'" :oxyGenData="oxyGenDisplayObj" >
        <DetailInfo id="blood_oxygen_saturation" v-model:isPopupActive="isPopupActive" style="margin-left: 14rpx;"></DetailInfo>
      </oxyGen>
      <heartRateVariability v-else-if="cardId === 'heartRateVariability'" :hrvData="hrvDisplayObj" >
        <DetailInfo id="heart_rate_variability" v-model:isPopupActive="isPopupActive" style="margin-left: 14rpx;"></DetailInfo>
      </heartRateVariability>
      <temperature v-else-if="cardId === 'skinTemperature'" :temperatureData="temperatureDisplayObj" >
        <!-- <DetailInfo id="vital_signs_status" v-model:isPopupActive="isPopupActive" style="margin-left: 14rpx;"></DetailInfo> -->
      </temperature>
    </view>
    <view v-if="showRwExtendedVitals" class="rw-extended-vitals">
      <view class="rw-extended-title">扩展生命体征</view>
      <view class="rw-extended-grid">
        <view v-if="bloodSugarDisplay" class="rw-extended-item">
          <text class="rw-extended-label">血糖</text>
          <text class="rw-extended-value">{{ bloodSugarDisplay }} mmol/L</text>
        </view>
        <view v-if="bloodPressureDisplay" class="rw-extended-item">
          <text class="rw-extended-label">血压</text>
          <text class="rw-extended-value">{{ bloodPressureDisplay }} mmHg</text>
        </view>
      </view>
    </view>
    <view @tap="jumpEdit" class="bg-white r-50 flex ai-center jc-center p-30">
      <view class="flex ai-center jc-center">
        <uv-image src="/static/images/homeDetail/editCardIcon.png" width="40rpx" height="40rpx"></uv-image>
        <text class="ml-10 fs-36">编辑卡片</text>
      </view>
    </view>
    <uv-safe-bottom></uv-safe-bottom>
  </view>
</template>
<style lang="scss" scoped>
.bgcWrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 30vh;
  background: linear-gradient(to bottom, #ff9e9e, #f1f3f6);
  z-index: -1;
}
.calendar-day {
  width: 128rpx;
  height: 128rpx;
  background-color: #ffffff;
  border-radius: 50%;
  transition: all 0.3s ease;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:last-child {
    margin-right: 0;
  }

  &:active {
    transform: scale(0.95);
  }
}
.calendar-day--selected {
  background: #2e70fc;
}
.rw-extended-vitals {
  margin-bottom: 30rpx;
  padding: 28rpx;
  border-radius: 16rpx;
  background: #fff;
}
.rw-extended-title {
  margin-bottom: 20rpx;
  font-size: 30rpx;
  font-weight: 600;
}
.rw-extended-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16rpx;
}
.rw-extended-item {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
  padding: 20rpx;
  border-radius: 12rpx;
  background: #f5f7fa;
}
.rw-extended-label {
  color: #69707d;
  font-size: 24rpx;
}
.rw-extended-value {
  overflow-wrap: anywhere;
  color: #16181d;
  font-size: 30rpx;
  font-weight: 600;
}
</style>
