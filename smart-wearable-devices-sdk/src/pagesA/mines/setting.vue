<!-- 功能设置 -->
<script setup lang="ts">
import '@/pagesA/mines/i18n/pack';
import { computed, onUnmounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getBindInfo } from '@/common/api/device';
import { getGoalInfo, updateGoalInfo } from '@/common/api/user';
import { useRingBLE } from '@/composables/useRingBLE';
import { useRingBusinessController } from '@/composables/useRingBusinessController';
import { formatBleErrorMessage } from '@/utils/bleError';
import { hasBoundRingIdentity } from '@/utils/ringBinding';
import { useUserStore } from '@/stores/user';
import {
  DEFAULT_CALORIE_GOAL_KCAL,
  buildCalorieGoalOptions,
  getCalorieGoalRange,
  normalizeCalorieGoalKcal
} from '@/utils/calorieGoal';
import { USER_GOAL_UPDATED_EVENT, type UserGoalUpdatedPayload } from '@/utils/goalSettings';
import { useI18n, usePageTitle } from '@/i18n';
import type { AppLocale, LocaleMode } from '@/i18n';

type PickerType = 'sleep' | 'step' | 'calorie' | 'activity' | 'collect';

const { t, mode: localeMode, systemLocale, setLocaleMode } = useI18n();
usePageTitle(() => t('功能设置'));

const LANGUAGE_MODES: LocaleMode[] = ['system', 'zh-Hans', 'zh-Hant', 'en'];
// 语言名一律用各语言自身书写，不随界面语言翻译。
const LANGUAGE_NAMES: Record<AppLocale, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English'
};

const languageOptions = computed(() => [t('跟随系统'), ...Object.values(LANGUAGE_NAMES)]);
const languageIndex = computed(() => Math.max(0, LANGUAGE_MODES.indexOf(localeMode.value)));
const currentLanguageLabel = computed(() =>
  localeMode.value === 'system'
    ? t('跟随系统（{language}）', { language: LANGUAGE_NAMES[systemLocale.value] })
    : LANGUAGE_NAMES[localeMode.value]
);

const onLanguageChange = (event: any) => {
  const index = Number(event?.detail?.value);
  const nextMode = LANGUAGE_MODES[index];
  if (!nextMode) return;
  setLocaleMode(nextMode);
  uni.showToast({ title: t('语言已切换'), icon: 'none' });
};

const controller = useRingBusinessController();
const ringBle = useRingBLE();
const userStore = useUserStore();
const boundInfo = ref<Record<string, any> | null>(null);
const busyText = ref('');
const lastActionText = ref('');
const isSaving = ref(false);
const paddingBottomVal = 160;
let statusClearTimer: any = null;
let initialLoadTimer: any = null;

const DEFAULT_GOAL_VALUES: Record<PickerType, string> = {
  sleep: '8',
  step: '8000',
  calorie: String(DEFAULT_CALORIE_GOAL_KCAL),
  activity: '30',
  collect: '30'
};

const sleepTarget = ref(DEFAULT_GOAL_VALUES.sleep);
const stepTarget = ref(DEFAULT_GOAL_VALUES.step);
const calorieTarget = ref(DEFAULT_GOAL_VALUES.calorie);
const activityDurationTarget = ref(DEFAULT_GOAL_VALUES.activity);
const collectPeriodTarget = ref(DEFAULT_GOAL_VALUES.collect);

const collectPeriodOptions = ['20', '30'];

const calorieGoalRange = computed(() => getCalorieGoalRange(userStore.userInfo?.sex));
const calorieGoalRangeText = computed(() =>
  t('建议范围 {min}–{max} 千卡', { min: calorieGoalRange.value.min, max: calorieGoalRange.value.max })
);
const pickerOptions = computed<Record<PickerType, string[]>>(() => ({
  sleep: ['5', '6', '7', '8', '9', '10', '11', '12'],
  step: ['4000', '6000', '8000', '10000', '12000', '15000', '20000'],
  calorie: buildCalorieGoalOptions(userStore.userInfo?.sex),
  activity: ['15', '30', '45', '60', '90', '120'],
  collect: collectPeriodOptions
}));

const isBusy = computed(() => Boolean(busyText.value) || controller.isRestoringDevice.value || controller.isRefreshingBusinessData.value);
const statusText = computed(() => busyText.value || lastActionText.value);

const clearStatusLater = (delay = 2600) => {
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
  }
  statusClearTimer = setTimeout(() => {
    lastActionText.value = '';
    statusClearTimer = null;
  }, delay);
};

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
  if (hourValue !== undefined) {
    const numeric = Number(hourValue);
    // Older data stored the sleep target in minutes (for example 480), even
    // though the current user_goal.sleep field and UI both use hours.
    if (Number.isFinite(numeric) && numeric > 24) {
      return String(Math.max(1, Math.round(numeric / 60)));
    }
    return toPositiveIntegerText(hourValue, sleepTarget.value);
  }
  const minuteValue = getValueByKeys(data, ['sleepDuration', 'sleepDurationTarget', 'targetSleepMinutes']);
  const minutes = Number(minuteValue);
  if (Number.isFinite(minutes) && minutes > 0) return String(Math.max(1, Math.round(minutes / 60)));
  return sleepTarget.value;
};
const toCollectPeriodText = (value: unknown, fallback = collectPeriodTarget.value) => {
  let numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  if (numeric > 120) numeric = Math.round(numeric / 60);
  const normalizedMinutes = String(Math.round(numeric));
  return collectPeriodOptions.includes(normalizedMinutes) ? normalizedMinutes : DEFAULT_GOAL_VALUES.collect;
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
    calorieTarget.value = String(
      normalizeCalorieGoalKcal(
        getValueByKeys(data, ['calorie', 'calorieTarget', 'targetCalorie', 'caloriesTarget', 'targetCalories']),
        DEFAULT_CALORIE_GOAL_KCAL,
        userStore.userInfo?.sex
      )
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
    lastActionText.value = t(formatBleErrorMessage(error, '目标配置读取失败，请稍后重试'));
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

const getPickerOptionList = (type: PickerType) => {
  const currentValue = getCurrentPickerValue(type) || DEFAULT_GOAL_VALUES[type];
  const columns = [...pickerOptions.value[type]];
  if (!columns.includes(currentValue)) {
    columns.push(currentValue);
    columns.sort((left, right) => Number(left) - Number(right));
  }
  return columns;
};

const getPickerIndex = (type: PickerType) => {
  const currentValue = getCurrentPickerValue(type) || DEFAULT_GOAL_VALUES[type];
  return Math.max(0, getPickerOptionList(type).indexOf(currentValue));
};

const onPickerChange = (type: PickerType, event: any) => {
  const index = Number(event?.detail?.value);
  if (!Number.isInteger(index) || index < 0) return;
  setCurrentPickerValue(type, getPickerOptionList(type)[index] || '');
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
    sleep: sleepHour,
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
  busyText.value = t('保存中');
  lastActionText.value = '';
  let collectWarning = '';
  try {
    const savedGoals = buildGoalPayload() as UserGoalUpdatedPayload;
    await updateGoalInfo(savedGoals, { custom: { toast: false, catch: true } });
    // 保存接口成功后立即把本次确定值同步给仍在页面栈中的首页、活动页。
    // 不等待各业务接口缓存刷新，避免返回后仍短暂显示旧目标。
    uni.$emit(USER_GOAL_UPDATED_EVENT, savedGoals);
    try {
      await applyCollectPeriodToDevice();
    } catch (error) {
      collectWarning = t(formatBleErrorMessage(error, '设备采集周期下发失败'));
    }
    lastActionText.value = collectWarning ? t('目标已保存，{warning}', { warning: collectWarning }) : t('目标已保存');
    clearStatusLater(collectWarning ? 4200 : 2600);
    uni.showToast({
      title: collectWarning ? t('目标已保存') : t('保存成功'),
      icon: 'success'
    });
  } catch (error) {
    lastActionText.value = t(formatBleErrorMessage(error, '保存失败，请稍后再试'));
    clearStatusLater(4200);
    uni.showToast({ title: lastActionText.value, icon: 'none' });
  } finally {
    busyText.value = '';
    isSaving.value = false;
    await loadBoundInfo();
  }
};

const scheduleInitialLoad = () => {
  if (initialLoadTimer) {
    clearTimeout(initialLoadTimer);
  }
  initialLoadTimer = setTimeout(async () => {
    initialLoadTimer = null;
    try {
      await userStore.fetchUserInfo();
    } catch {
      // 使用本地已缓存的性别资料计算热量目标范围，不阻断目标读取。
    }
    void Promise.all([loadBoundInfo(), loadGoalInfo()]);
  }, 60);
};

onShow(() => {
  scheduleInitialLoad();
});

onUnmounted(() => {
  if (statusClearTimer) {
    clearTimeout(statusClearTimer);
  }
  if (initialLoadTimer) {
    clearTimeout(initialLoadTimer);
    initialLoadTimer = null;
  }
});
</script>

<template>
  <view class="p-30" :style="{ paddingBottom: paddingBottomVal + 'rpx' }">
    <view class="mb-50">
      <view class="mb-50 fs-36 pl-40 pr-40 mb-50">{{ t('通用设置') }}</view>
      <picker mode="selector" :header-text="t('界面语言')" :range="languageOptions" :value="languageIndex" @change="onLanguageChange">
        <view class="bg-white p-40 r-50 flex jc-between ai-center mb-50 fs-36">
          <text>{{ t('界面语言') }}</text>
          <view class="flex ai-center">
            <text class="mr-20">{{ currentLanguageLabel }}</text>
            <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
          </view>
        </view>
      </picker>
    </view>

    <view>
      <view class="mb-50 fs-36 pl-40 pr-40 mb-50">{{ t('设置目标') }}</view>
      <view>
        <picker mode="selector" :header-text="t('睡眠时长')" :range="getPickerOptionList('sleep')" :value="getPickerIndex('sleep')" @change="onPickerChange('sleep', $event)">
          <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
            <view style="width: 50%">
              <text>{{ t('睡眠时长') }}</text>
              <text class="t-979797 fs-24">{{ t('（小时）') }}</text>
            </view>
            <view class="flex ai-center">
              <text class="mr-20">{{ sleepTarget || t('请选择') }}</text>
              <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
            </view>
          </view>
        </picker>

        <picker mode="selector" :header-text="t('步数目标')" :range="getPickerOptionList('step')" :value="getPickerIndex('step')" @change="onPickerChange('step', $event)">
          <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
            <view style="width: 50%">
              <text>{{ t('步数目标') }}</text>
              <text class="t-979797 fs-24">{{ t('（步数）') }}</text>
            </view>
            <view class="flex ai-center">
              <text class="mr-20">{{ stepTarget || t('请选择') }}</text>
              <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
            </view>
          </view>
        </picker>

        <picker mode="selector" :header-text="t('热量目标')" :range="getPickerOptionList('calorie')" :value="getPickerIndex('calorie')" @change="onPickerChange('calorie', $event)">
          <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
            <view style="width: 60%">
              <view><text>{{ t('热量目标') }}</text></view>
              <text class="t-979797 fs-24">{{ t('（千卡，{range}）', { range: calorieGoalRangeText }) }}</text>
            </view>
            <view class="flex ai-center">
              <text class="mr-20">{{ calorieTarget || t('请选择') }}</text>
              <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
            </view>
          </view>
        </picker>

        <picker mode="selector" :header-text="t('活动时长目标')" :range="getPickerOptionList('activity')" :value="getPickerIndex('activity')" @change="onPickerChange('activity', $event)">
          <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
            <view style="width: 80%">
              <text>{{ t('活动时长目标') }}</text>
              <text class="t-979797 fs-24">{{ t('（分钟）') }}</text>
            </view>
            <view class="flex ai-center">
              <text class="mr-20">{{ activityDurationTarget || t('请选择') }}</text>
              <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
            </view>
          </view>
        </picker>

        <picker mode="selector" :header-text="t('设备采集周期')" :range="getPickerOptionList('collect')" :value="getPickerIndex('collect')" @change="onPickerChange('collect', $event)">
          <view class="bg-white p-40 r-50 flex jc-between ai-center mb-30 fs-36">
            <view style="width: 80%">
              <text>{{ t('设备采集周期') }}</text>
              <text class="t-979797 fs-24">{{ t('（分钟）') }}</text>
            </view>
            <view class="flex ai-center">
              <text class="mr-20">{{ collectPeriodTarget || t('请选择') }}</text>
              <uv-icon name="arrow-right" color="#010101" size="14"></uv-icon>
            </view>
          </view>
        </picker>
      </view>
    </view>

    <view class="purchase-section p-30 demo">
      <view v-if="statusText" class="save-status fs-28 t-979797">{{ statusText }}</view>
      <uv-button
        @click="handleOk"
        :text="isSaving ? t('保存中') : t('保存')"
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
