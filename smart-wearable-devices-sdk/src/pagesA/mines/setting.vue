<!-- 功能设置 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getBindInfo } from '@/common/api/device';
import { getGoalInfo, updateGoalInfo } from '@/common/api/user';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { useRingBusinessData } from '@/composables/useRingBusinessData';
import { formatBleErrorMessage } from '@/utils/bleError';
import { hasBoundRingIdentity } from '@/utils/ringBinding';

type PickerType = 'sleep' | 'step' | 'calorie' | 'activity' | 'collect';

const controller = useRingBusinessController();
const ringBle = useRingBLE();
const ring = useRingBusinessData();
const boundInfo = ref<Record<string, any> | null>(null);
const busyText = ref('');
const lastActionText = ref('');
const isSaving = ref(false);
const paddingBottomVal = 160;

const DEFAULT_GOAL_VALUES: Record<PickerType, string> = {
  sleep: '8',
  step: '8000',
  calorie: '500',
  activity: '30',
  collect: '60'
};

const sleepTarget = ref('');
const stepTarget = ref('');
const calorieTarget = ref('');
const activityDurationTarget = ref('');
const collectPeriodTarget = ref(DEFAULT_GOAL_VALUES.collect);

const pickerRef = ref<any>(null);
const modalPopup = ref<any>(null);
const pickerValue = ref([0]);
const pickerTitle = ref('');
const pickerColumns = ref<string[][]>([[]]);
const activePickerType = ref<PickerType>('sleep');
const content = ref('确定恢复出厂设置吗？');

const pickerOptions: Record<PickerType, string[]> = {
  sleep: ['5', '6', '7', '8', '9', '10', '11', '12'],
  step: ['4000', '6000', '8000', '10000', '12000', '15000', '20000'],
  calorie: ['100', '200', '300', '400', '500', '600', '800', '1000'],
  activity: ['15', '30', '45', '60', '90', '120'],
  collect: ['20', '30', '60']
};

const pickerTitleMap: Record<PickerType, string> = {
  sleep: '睡眠时长',
  step: '步数目标',
  calorie: '卡目标',
  activity: '活动时长目标',
  collect: '设备采集周期'
};

const isBusy = computed(() => Boolean(busyText.value) || controller.isRestoringDevice.value || controller.isRefreshingBusinessData.value);
const connectionText = computed(() => (ring.isConnected.value ? '已连接' : hasBoundRingIdentity(boundInfo.value) ? '待恢复连接' : '未绑定'));
const monitorText = computed(() => {
  const dbTarget = collectPeriodTarget.value || DEFAULT_GOAL_VALUES.collect;
  return `每 ${dbTarget} 分钟`;
});
const statusText = computed(() => busyText.value || lastActionText.value || `${connectionText.value} · 采集周期 ${monitorText.value}`);

const unwrapApiData = (source: any) => {
  const first = source?.data ?? source?.result ?? source;
  return first?.goalInfo ?? first?.userGoal ?? first?.data ?? first?.result ?? first ?? {};
};

const getValueByKeys = (source: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const toPositiveIntegerText = (value: unknown, fallback: string) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return String(Math.round(numeric));
};

const toSleepHourText = (data: Record<string, any>) => {
  const hourValue = getValueByKeys(data, ['sleepHour', 'sleep', 'sleepTarget', 'sleepHours', 'targetSleepHours']);
  if (hourValue !== undefined) return toPositiveIntegerText(hourValue, sleepTarget.value);
  const minuteValue = getValueByKeys(data, ['sleepDuration', 'sleepDurationTarget', 'targetSleepMinutes']);
  const minutes = Number(minuteValue);
  if (Number.isFinite(minutes) && minutes > 0) return String(Math.max(1, Math.round(minutes / 60)));
  return sleepTarget.value;
};
const toCollectPeriodText = (value: unknown, fallback = collectPeriodTarget.value) => {
  let numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (numeric > 120) numeric = Math.round(numeric / 60);
  if (numeric <= 20) return '20';
  if (numeric <= 30) return '30';
  return '60';
};

const loadBoundInfo = async () => {
  try {
    const info = await getBindInfo();
    boundInfo.value = info || null;
  } catch {
    boundInfo.value = null;
  }
};

const loadGoalInfo = async () => {
  try {
    const result = await getGoalInfo({}, { custom: { toast: false, catch: true } });
    const data = unwrapApiData(result);
    sleepTarget.value = toSleepHourText(data);
    stepTarget.value = toPositiveIntegerText(getValueByKeys(data, ['step', 'stepTarget', 'targetStep', 'stepsTarget']), stepTarget.value);
    calorieTarget.value = toPositiveIntegerText(
      getValueByKeys(data, ['calorie', 'calorieTarget', 'targetCalorie', 'caloriesTarget', 'targetCalories']),
      calorieTarget.value
    );
    activityDurationTarget.value = toPositiveIntegerText(
      getValueByKeys(data, ['motionTime', 'activityDurationTarget', 'targetActivityDuration', 'targetMotionTime', 'motionTimeTarget']),
      activityDurationTarget.value
    );
    collectPeriodTarget.value = toCollectPeriodText(
      getValueByKeys(data, [
        'acquisitionCycle',
        'acquisitionCycleMinutes',
        'collectPeriodTarget',
        'collectPeriodMinutes',
        'collectPeriod',
        'healthCollectPeriod'
      ]),
      collectPeriodTarget.value
    );
    const collectSeconds = Number(getValueByKeys(data, ['acquisitionCycleSeconds', 'collectPeriodSeconds', 'collect_period_seconds']));
    if (Number.isFinite(collectSeconds) && collectSeconds > 0) {
      collectPeriodTarget.value = toCollectPeriodText(collectSeconds);
    }
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '目标配置读取失败，请稍后重试');
  }
};

const getCurrentPickerValue = (type: PickerType) => {
  if (type === 'sleep') return sleepTarget.value;
  if (type === 'step') return stepTarget.value;
  if (type === 'calorie') return calorieTarget.value;
  if (type === 'activity') return activityDurationTarget.value;
  return collectPeriodTarget.value;
};

const setCurrentPickerValue = (type: PickerType, value: string) => {
  if (!value) return;
  if (type === 'sleep') sleepTarget.value = value;
  else if (type === 'step') stepTarget.value = value;
  else if (type === 'calorie') calorieTarget.value = value;
  else if (type === 'activity') activityDurationTarget.value = value;
  else collectPeriodTarget.value = value;
};

const openPicker = (type: PickerType) => {
  activePickerType.value = type;
  pickerTitle.value = pickerTitleMap[type];
  const columns = pickerOptions[type];
  pickerColumns.value = [columns];
  pickerValue.value = [Math.max(0, columns.indexOf(getCurrentPickerValue(type) || DEFAULT_GOAL_VALUES[type]))];
  pickerRef.value?.open?.();
};

const getPickerConfirmValue = (event: any) => {
  const directValue = Array.isArray(event?.value) ? event.value[0] : event?.value;
  if (directValue !== undefined && directValue !== null && typeof directValue !== 'object') {
    return String(directValue);
  }
  const eventIndex = Array.isArray(event?.indexs)
    ? event.indexs[0]
    : Array.isArray(event?.index)
      ? event.index[0]
      : event?.index;
  const index = Number.isFinite(Number(eventIndex)) ? Number(eventIndex) : pickerValue.value[0];
  return pickerColumns.value[0]?.[index] || '';
};

const onPickerConfirm = (event: any) => {
  setCurrentPickerValue(activePickerType.value, getPickerConfirmValue(event));
};

const getGoalNumber = (value: string, fallback: string) => {
  const numeric = Number(value || fallback);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : Number(fallback);
};

const buildGoalPayload = () => {
  const sleepHour = getGoalNumber(sleepTarget.value, DEFAULT_GOAL_VALUES.sleep);
  const step = getGoalNumber(stepTarget.value, DEFAULT_GOAL_VALUES.step);
  const calorie = getGoalNumber(calorieTarget.value, DEFAULT_GOAL_VALUES.calorie);
  const motionTime = getGoalNumber(activityDurationTarget.value, DEFAULT_GOAL_VALUES.activity);
  const acquisitionCycle = getGoalNumber(collectPeriodTarget.value, DEFAULT_GOAL_VALUES.collect);

  return {
    sleepHour,
    step,
    calorie,
    motionTime,
    acquisitionCycle
  };
};

const ensureDeviceReady = async () => {
  if (controller.isReady.value) return true;
  return controller.restoreLastBusinessDevice({ refreshAfterRestore: false });
};

const applyCollectPeriodToDevice = async () => {
  const minutes = Number(collectPeriodTarget.value);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  if (!hasBoundRingIdentity(boundInfo.value) && !controller.isReady.value) return;
  const ready = await ensureDeviceReady();
  if (!ready) throw new Error('设备未连接，采集周期将在下次连接后生效');
  await ringBle.sendCollectPeriodSettingCommand(minutes * 60);
};

const handleOk = async () => {
  if (isSaving.value || isBusy.value) return;
  isSaving.value = true;
  busyText.value = '保存中';
  lastActionText.value = '';
  let collectWarning = '';
  try {
    await updateGoalInfo(buildGoalPayload(), { custom: { toast: false, catch: true } });
    try {
      await applyCollectPeriodToDevice();
    } catch (error) {
      collectWarning = formatBleErrorMessage(error, '设备采集周期下发失败');
    }
    await loadGoalInfo();
    lastActionText.value = collectWarning ? `目标已保存，${collectWarning}` : '目标已保存';
    uni.showToast({
      title: collectWarning ? '目标已保存' : '保存成功',
      icon: 'success'
    });
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '保存失败，请稍后再试');
    uni.showToast({ title: lastActionText.value, icon: 'none' });
  } finally {
    busyText.value = '';
    isSaving.value = false;
    await loadBoundInfo();
  }
};

const openConfirmBind = () => {
  content.value = '确定恢复出厂设置吗？';
  modalPopup.value?.open?.();
};

const confirmBind = async () => {
  if (isBusy.value) return;
  busyText.value = '恢复出厂中';
  lastActionText.value = '';
  try {
    const ready = await ensureDeviceReady();
    if (!ready) throw new Error('设备未连接，请重新连接后再试');
    await ringBle.sendFactoryResetWithTimeCommand();
    controller.clearBusinessData();
    lastActionText.value = '恢复出厂命令已发送';
    uni.showToast({ title: '已发送', icon: 'success' });
  } catch (error) {
    lastActionText.value = formatBleErrorMessage(error, '恢复出厂失败');
    uni.showToast({ title: lastActionText.value, icon: 'none' });
  } finally {
    busyText.value = '';
    await loadBoundInfo();
  }
};

const jumpOtaUpgrade = () => {
  uni.navigateTo({ url: '/pagesA/mines/otaUpgrade' });
};

onShow(async () => {
  await Promise.all([loadBoundInfo(), loadGoalInfo()]);
});
</script>

<template>
  <view class="p-30" :style="{ paddingBottom: paddingBottomVal + 'rpx' }">
    <view>
      <view class="mb-50 fs-36 pl-40 pr-40 mb-50">设置目标</view>
      <view>
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('sleep')">
          <view style="width: 50%">
            <text>睡眠时长</text>
            <text class="t-979797 fs-24">（小时）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ sleepTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('step')">
          <view style="width: 50%">
            <text>步数目标</text>
            <text class="t-979797 fs-24">（步数）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ stepTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('calorie')">
          <view style="width: 60%">
            <text>卡目标</text>
            <text class="t-979797 fs-24">（卡）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ calorieTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('activity')">
          <view style="width: 80%">
            <text>活动时长目标</text>
            <text class="t-979797 fs-24">（分钟）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ activityDurationTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>

        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36" @click="openPicker('collect')">
          <view style="width: 80%">
            <text>设备采集周期</text>
            <text class="t-979797 fs-24">（分钟）</text>
          </view>
          <view class="flex ai-center">
            <text class="mr-20">{{ collectPeriodTarget || '请选择' }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>
      </view>
    </view>

    <view>
      <view class="mb-50 fs-36 pl-40 pr-40">通用设置</view>
      <view @click="openConfirmBind">
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30">
          <view class="fs-36">恢复出厂设置</view>
          <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
        </view>
      </view>
      <view @click="jumpOtaUpgrade">
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30">
          <view class="fs-36">OTA升级</view>
          <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
        </view>
      </view>
    </view>

    <uv-picker
      ref="pickerRef"
      :defaultIndex="[pickerValue[0]]"
      :title="pickerTitle"
      :columns="pickerColumns"
      v-model="pickerValue"
      @confirm="onPickerConfirm"
      confirmColor="#2e70fc"
    ></uv-picker>

    <uv-modal ref="modalPopup" :showCancelButton="true" align="center" :content="content" @confirm="confirmBind"></uv-modal>
    <view class="purchase-section p-30 demo">
      <view v-if="statusText" class="save-status fs-28 t-979797">{{ statusText }}</view>
      <uv-button
        @click="handleOk"
        :text="isSaving ? '保存中' : '保存'"
        :loading="isSaving"
        :disabled="isSaving || isBusy"
        shape="circle"
        color="#2e70fc"
      ></uv-button>
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
  background: #f1f3f6;
  box-sizing: border-box;
}

.save-status {
  margin-bottom: 16rpx;
  line-height: 40rpx;
  text-align: center;
}
</style>
