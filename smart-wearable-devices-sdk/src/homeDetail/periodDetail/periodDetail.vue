<template>
  <view class="period-detail-page">
    <!-- 编辑经期弹窗：置于根节点下，脱离 canvas 层叠上下文 -->
    <EditPeriodModal ref="editModalRef" @save="onSaveEdit" />

    <uv-navbar placeholder left-icon="arrow-left" title="" auto-back>
      <template #center>
        <view class="period-navbar-center">
          <text class="period-navbar-center__title">{{ navbarTitle }}</text>
          <uv-icon name="calendar" size="20" color="#303133" @tap.stop="onCalendarTap" />
        </view>
      </template>
    </uv-navbar>
    <view class="period-detail-body">
      <view class="period-week-card">
        <view class="period-week-row">
          <view
            v-for="cell in weekStrip"
            :key="cell.ymd"
            class="week-cell"
            @tap="onWeekDayTap(cell)"
          >
            <view class="week-cell-inner" :class="{ 'week-cell-inner--today': cell.isToday }">
              <text class="week-cell-label">{{ cell.topLabel }}</text>
              <view
                class="week-num"
                :class="{
                  'week-num--solid': cell.ringStyle === 'solid',
                  'week-num--dashed': cell.ringStyle === 'dashed',
                  'week-num--plain': cell.ringStyle === 'none'
                }"
              >
                <text>{{ cell.dayOfMonth }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
      <view v-if="showIntroCard" class="period-intro-card">
        <view class="period-intro-text">完整的月经记录将帮助我们为您提供更好的健康建议</view>
        <view class="period-intro-footer">  
          <view class="intro-more-btn" @tap="onMore">了解更多</view>
          <view class="intro-close" @tap="onCloseIntro">×</view>
        </view>
      </view>
      <PeriodCycleWheel v-model:day="cycleDay" :phase-lengths="phaseLengths" @edit="onEdit" />
      
  
      
      <view v-if="periodTipsText" class="period-remind-card">
        <view class="section-title">今日提醒</view>
        <view class="section-content">{{ periodTipsText }}</view>
      </view>

      <view class="period-temp-card">
        <view class="temp-header">
          <view class="temp-title">
            <text>皮肤温度 (℃)</text>
            <text class="temp-info">i</text>
          </view>
          <view class="temp-right-icon"></view>
        </view>
        <view class="temp-score">
          <text class="temp-value">{{ skinTempLatestDisplay }}</text>
          <text class="temp-divider">{{ skinTempSubtext }}</text>
        </view>
        <view class="temp-chart-wrap">
          <l-echart ref="tempChartRef" @finished="initTempChart" class="temp-chart" />
        </view>
      </view>

      <!-- 重要提醒卡片 -->
      <view v-if="importantReminders.length" class="remind-important-card">
        <view class="remind-important-title">重要提醒</view>
        <view
          v-for="(item, index) in importantReminders"
          :key="index"
          class="remind-important-item"
          :style="{ borderLeftColor: item.color }"
        >
          <view class="remind-item-icon-wrap">
            <uv-icon :name="item.icon" :color="item.color" size="36" />
          </view>
          <view class="remind-item-content">
            <text class="remind-item-title">{{ item.title }}</text>
            <text class="remind-item-desc">{{ item.desc }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getGirlHealth, getHealthTempStats, getUserGirlHealthAll } from '@/common/api/homeDetail';
import type { HealthTempStatItem, UserGirlHealthAllResponse } from '@/types/api/homeDetail';

import { updateGirlHealth } from '@/common/api/homeDetail';
const GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY = 'qkeer_girl_health_profile_updated_at';
const GIRL_HEALTH_PROFILE_EXISTS_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile_exists';
const GIRL_HEALTH_PROFILE_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile';
const getGirlHealthProfileExistsStorageKey = (userId?: unknown) =>
  `${GIRL_HEALTH_PROFILE_EXISTS_STORAGE_KEY_PREFIX}:${String(userId || 'anonymous')}`;
const getGirlHealthProfileStorageKey = (userId?: unknown) =>
  `${GIRL_HEALTH_PROFILE_STORAGE_KEY_PREFIX}:${String(userId || 'anonymous')}`;
/** 添加 periodTips 字段支持 */
interface GirlHealthAllExt extends UserGirlHealthAllResponse {
  periodTips?: string;
}
type GirlHealthModel = {
  id?: number;
  userId?: number | string;
  user_id?: number | string;
  birthday?: string;
  birthDay?: string;
  cycleDay?: number | string;
  periodCycle?: number | string;
  menstruationDay?: number | string;
  periodRuntime?: number | string;
  lastMenstruationDate?: string;
  lastPeriodTime?: string | string[];
  cycleRegularity?: string;
  isRuleType?: string;
  healthConditions?: string;
  otherUnhealth?: string;
};

const GIRL_HEALTH_CYCLE_KEYS = [
  'cycleDay',
  'periodCycle',
  'cycleLength',
  'averageCycle',
  'avgCycle',
  'cycleDays',
  'menstrualCycle'
];
const GIRL_HEALTH_MENSTRUAL_LENGTH_KEYS = [
  'menstruationDay',
  'periodRuntime',
  'menstrualDays',
  'periodDays',
  'menstrualLength',
  'menstruationLength',
  'periodLength',
  'duration'
];
const GIRL_HEALTH_LAST_START_KEYS = [
  'lastMenstruationDate',
  'lastMenstruationStartDate',
  'lastMenstrualStartDate',
  'lastMenstrualDate',
  'lastMenstrualTime',
  'lastMenstruationTime',
  'lastMenstruationStartTime',
  'lastMenstrualDateTime',
  'lastPeriodDate',
  'lastPeriodStartDate',
  'lastPeriodStartTime',
  'recentMenstruationDate',
  'menstruationStartDate',
  'menstruationStartTime',
  'periodStartDate',
  'periodStartTime',
  'lastPeriodTimePoint',
  'startDate'
];
const GIRL_HEALTH_PERIOD_LIST_KEYS = [
  'lastPeriodTime',
  'periodDates',
  'menstrualDates',
  'menstruationDates',
  'records'
];

const getFirstGirlHealthValue = (source: any, keys: string[]) => {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const normalizeGirlHealthModel = (source: any): GirlHealthModel => {
  const lastPeriodTime =
    getFirstGirlHealthValue(source, GIRL_HEALTH_PERIOD_LIST_KEYS) ||
    getFirstGirlHealthValue(source, GIRL_HEALTH_LAST_START_KEYS);
  const lastStartValue =
    getFirstGirlHealthValue(source, GIRL_HEALTH_LAST_START_KEYS) ||
    (Array.isArray(lastPeriodTime) ? lastPeriodTime[0] : lastPeriodTime);
  return {
    ...(source || {}),
    userId: source?.userId || source?.user_id,
    user_id: source?.user_id || source?.userId,
    birthday: source?.birthday || source?.birthDay || '',
    birthDay: source?.birthDay || source?.birthday || '',
    cycleDay: getFirstGirlHealthValue(source, GIRL_HEALTH_CYCLE_KEYS) as number | string | undefined,
    periodCycle: getFirstGirlHealthValue(source, GIRL_HEALTH_CYCLE_KEYS) as number | string | undefined,
    menstruationDay: getFirstGirlHealthValue(source, GIRL_HEALTH_MENSTRUAL_LENGTH_KEYS) as
      | number
      | string
      | undefined,
    periodRuntime: getFirstGirlHealthValue(source, GIRL_HEALTH_MENSTRUAL_LENGTH_KEYS) as
      | number
      | string
      | undefined,
    lastMenstruationDate: lastStartValue as string,
    lastPeriodTime,
    cycleRegularity: source?.cycleRegularity || source?.isRuleType || '',
    isRuleType: source?.isRuleType || source?.cycleRegularity || '',
    healthConditions: source?.healthConditions || source?.otherUnhealth || '',
    otherUnhealth: source?.otherUnhealth || source?.healthConditions || ''
  };
};
const getCurrentGirlHealthProfileUserId = (profile?: GirlHealthModel | null) => {
  try {
    const userInfo = uni.getStorageSync('userInfo') || {};
    return (
      profile?.userId ||
      profile?.user_id ||
      modelGirlHealth.value?.userId ||
      modelGirlHealth.value?.user_id ||
      userInfo?.id ||
      userInfo?.userId ||
      userInfo?.user_id ||
      userInfo?.uid
    );
  } catch {
    return profile?.userId || profile?.user_id || modelGirlHealth.value?.userId || modelGirlHealth.value?.user_id;
  }
};
const readLocalGirlHealthProfile = (): GirlHealthModel | null => {
  try {
    const userId = getCurrentGirlHealthProfileUserId();
    if (!userId) return null;
    const cached = uni.getStorageSync(getGirlHealthProfileStorageKey(userId));
    if (!cached) return null;
    const profile = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return profile && typeof profile === 'object' ? normalizeGirlHealthModel(profile) : null;
  } catch {
    return null;
  }
};
const writeLocalGirlHealthProfile = (profile: GirlHealthModel, userId?: unknown) => {
  try {
    const profileUserId = userId || getCurrentGirlHealthProfileUserId(profile);
    if (!profileUserId) return;
    const normalized = normalizeGirlHealthModel({ ...profile, userId: profileUserId, user_id: profileUserId });
    uni.setStorageSync(getGirlHealthProfileExistsStorageKey(profileUserId), true);
    uni.setStorageSync(getGirlHealthProfileStorageKey(profileUserId), normalized);
    uni.setStorageSync(GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY, Date.now());
  } catch {
    // 本地缓存失败不影响主流程，接口数据仍然可用。
  }
};
import PeriodCycleWheel from './components/wheel.vue';
import EditPeriodModal from './components/EditPeriodModal.vue';
import {
  formatPeriodDateYmd,
  getPeriodPhaseSegment,
  resolvePeriodPhaseKey,
  resolvePeriodProfileState,
  type PeriodPhaseKey
} from '@/utils/periodPhase';

const echarts = require('../../static/echarts.min.js');

const PERIOD_INTRO_DISMISSED_KEY = 'periodDetailIntroDismissed';

const cycleDay = ref(0);
const phaseLengths = ref<{
  menstrual?: number;
  follicular?: number;
  ovulation?: number;
  luteal?: number;
}>({});
type WheelPhaseKey = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';
const WHEEL_PHASE_ORDER: WheelPhaseKey[] = ['menstrual', 'follicular', 'ovulation', 'luteal'];
const DEFAULT_WHEEL_PHASE_LENGTHS: Record<WheelPhaseKey, number> = {
  menstrual: 5,
  follicular: 8,
  ovulation: 1,
  luteal: 14
};

const selectedDate = ref<Date>(startOfLocalDay(new Date()));

const editFormData = ref<{
  startDate: string;
  cycleDays: number;
  periodDays: number;
  id: number;
}>({
  startDate: '',
  cycleDays: 28,
  periodDays: 5,
  id:0
});

const editModalRef = ref<any>(null);


/** 一周 7 格：index 0=今天 -4 … index 4=今天 … index 6=今天 +2；实线/虚线后续接接口，当前写死 */
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function parseYmdToLocalDate(ymd?: string): Date | null {
  if (!ymd) return null;
  const normalized = formatPeriodDateYmd(ymd);
  if (!normalized) return null;
  const parts = normalized.split('-').map((x) => Number(x));
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function daysDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

function daysInclusive(start?: string, end?: string): number {
  const s = parseYmdToLocalDate(start);
  const e = parseYmdToLocalDate(end);
  if (!s || !e) return 0;
  const diff = daysDiff(e, s);
  return diff >= 0 ? diff + 1 : 0;
}

function isInRange(d: Date, start?: string, end?: string): boolean {
  const s = parseYmdToLocalDate(start);
  const e = parseYmdToLocalDate(end);
  if (!s || !e) return false;
  return d.getTime() >= s.getTime() && d.getTime() <= e.getTime();
}


const weekStrip = computed(() => {
  const center = startOfLocalDay(selectedDate.value);
  const today = startOfLocalDay(new Date());
  const items: {
    ymd: string;
    date: Date;
    dayOfMonth: number;
    topLabel: string;
    isToday: boolean;
    ringStyle: 'none' | 'solid' | 'dashed';
  }[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(center);
    d.setDate(center.getDate() + (i - 4));
    const isToday = d.getTime() === today.getTime();
    const ymd = formatDateYmd(d);
    const w = d.getDay();
    const ringStyle = resolveDayRingStyle(d);
    items.push({
      ymd,
      date: d,
      dayOfMonth: d.getDate(),
      topLabel: isToday ? '今天' : WEEK_CN[w],
      isToday,
      ringStyle
    });
  }
  return items;
});
const tempChartRef = ref();
const tempChartInstance = ref<any>(null);
const showIntroCard = ref(true);
const tempStatsRaw = ref<HealthTempStatItem[]>([]);
const tempStatsLoaded = ref(false);
const girlHealthAll = ref<GirlHealthAllExt | null>(null);
const modelGirlHealth = ref<GirlHealthModel>({});
const girlHealthEndDate= ref('')
/** lastPeriodTime 解析后的经期日期集合 (yyyy-MM-dd) */
const periodDates = ref<Set<string>>(new Set());

onLoad(() => {
  showIntroCard.value = !uni.getStorageSync(PERIOD_INTRO_DISMISSED_KEY);
  void reloadForSelectedDate();
});

const periodTipsText = computed(() => {
  return girlHealthAll.value?.periodTips || '';
});

/** 重要提醒列表（根据周期数据动态生成） */
/** 各阶段默认健康建议文案 */
const DEFAULT_HEALTH_TIPS: Record<string, string> = {
  menstrual: '经期注意保暖，避免生冷食物，充分休息',
  follicular: '卵泡期适量运动，补充蛋白质，保持规律作息',
  ovulation: '排卵期注意保暖，避免生冷食物，补充蛋白质',
  luteal: '黄体期保持情绪稳定，补充维生素 B6，适量运动'
};

const PERIOD_PHASE_HEALTH_TIPS: Record<PeriodPhaseKey, string> = {
  menstrual: '\u7ecf\u671f\u6ce8\u610f\u4fdd\u6696\uff0c\u907f\u514d\u751f\u51b7\u98df\u7269\uff0c\u4fdd\u8bc1\u5145\u8db3\u4f11\u606f\u3002',
  ovulation: '\u6392\u5375\u671f\u6ce8\u610f\u8eab\u4f53\u53d8\u5316\uff0c\u4fdd\u6301\u89c4\u5f8b\u4f5c\u606f\u548c\u9002\u91cf\u8fd0\u52a8\u3002',
  fertile: '\u6613\u5b55\u671f\u8bf7\u7ed3\u5408\u4e2a\u4eba\u8ba1\u5212\uff0c\u505a\u597d\u5907\u5b55\u6216\u907f\u5b55\u5b89\u6392\u3002',
  safe: '\u5efa\u8bae\u4fdd\u6301\u89c4\u5f8b\u4f5c\u606f\uff0c\u6301\u7eed\u8bb0\u5f55\u5468\u671f\u53d8\u5316\u3002'
};

const importantReminders = computed(() => {
  const data = girlHealthAll.value;
  const list: { icon: string; color: string; title: string; desc: string }[] = [];

  // 排卵期高峰
  const ov = data?.predictedCycle?.ovulation;
  if (ov?.start && ov?.end) {
    const startLabel = formatDateMD(ov.start);
    const endLabel = formatDateMD(ov.end);
    list.push({
      icon: 'calendar',
      color: '#9B6CF7',
      title: '排卵期高峰',
      desc: startLabel + '-' + endLabel + '为易孕期，备孕/避孕请注意'
    });
  } else {
    list.push({
      icon: 'calendar',
      color: '#9B6CF7',
      title: '排卵期高峰',
      desc: '暂无排卵期数据，请完善经期记录'
    });
  }

  // 下次经期提醒
  const nextStart = data?.predictedCycle?.luteal?.end;
  if (nextStart) {
	  let targetDate= new Date(nextStart);
	  targetDate.setDate(targetDate.getDate() + 1);
    const label = formatDateMD(targetDate.toISOString().split('T')[0]);
    list.push({
      icon: 'bell',
      color: '#F5A623',
      title: '下次经期提醒',
      desc: '预计' + label + '来月经，建议提前准备卫生巾'
    });
  } else {
    list.push({
      icon: 'bell',
      color: '#F5A623',
      title: '下次经期提醒',
      desc: '暂无预测数据，请完善经期记录'
    });
  }

  // 健康建议：优先接口数据，否则按当前阶段给默认文案
  const tips = data?.periodTips;
  const phase = data?.predictedCycle ? detectCurrentPhase(data.predictedCycle) : 'safe';
  const defaultTip = PERIOD_PHASE_HEALTH_TIPS[phase] || '\u8bf7\u4fdd\u6301\u89c4\u5f8b\u4f5c\u606f\uff0c\u5747\u8861\u996e\u98df\uff0c\u9002\u91cf\u8fd0\u52a8';
  list.push({
    icon: 'bag',
    color: '#F05F8F',
    title: '健康建议',
    desc: tips || defaultTip
  });

  return list;
});

/** 根据 predictedCycle 判断当前日期处于哪个阶段 */
function detectCurrentPhase(pc: any): PeriodPhaseKey {
  return resolvePeriodPhaseKey(selectedDate.value, pc, 'safe');
}

function formatDateMD(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length < 3) return ymd;
  return Number(parts[1]) + '月' + Number(parts[2]) + '日';
}

const navbarTitle = computed(() => {
  const d = selectedDate.value;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
});

function formatTimeLabel(iso?: string): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  const h = d.getHours();
  const m = d.getMinutes();
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

const SKIN_TEMP_TIME_KEYS = [
  'record_time',
  'recordTime',
  'collect_time',
  'collectTime',
  'create_time',
  'createTime',
  'time',
  'datetime',
  'dateTime',
  'date',
  'statDate',
  'newDate'
];

const SKIN_TEMP_VALUE_KEYS = [
  'temperature',
  'skinTemperature',
  'skin_temperature',
  'bodyTemperature',
  'body_temperature',
  'temperatureValue',
  'temp',
  'tempValue',
  'value',
  'newValue',
  'avgValue'
];

function getFirstDefinedValue(payload: Record<string, any>, keys: string[]): unknown {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function normalizeSkinTemperatureValue(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric > 600) return Number((numeric / 100).toFixed(1));
  if (numeric > 80) return Number((numeric / 10).toFixed(1));
  return Number(numeric.toFixed(1));
}

function parseSkinTempRows(rows: HealthTempStatItem[]): { record_time: string; temperature: number }[] {
  const out: { record_time: string; temperature: number }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const payload = row as Record<string, any>;
    const timeValue = getFirstDefinedValue(payload, SKIN_TEMP_TIME_KEYS);
    const temperature = normalizeSkinTemperatureValue(getFirstDefinedValue(payload, SKIN_TEMP_VALUE_KEYS));
    if (temperature == null) continue;
    const recordTime = String(timeValue || formatDateYmd(selectedDate.value));
    out.push({ record_time: recordTime, temperature });
  }
  return out.sort((a, b) => new Date(a.record_time).getTime() - new Date(b.record_time).getTime());
}

const skinTempPoints = computed(() => parseSkinTempRows(tempStatsRaw.value));

const skinTempLatestDisplay = computed(() => {
  const pts = skinTempPoints.value;
  if (!pts.length) return '--';
  return pts[pts.length - 1].temperature.toFixed(1);
});

const skinTempSubtext = computed(() => {
  const n = skinTempPoints.value.length;
  if (!tempStatsLoaded.value) return '';
  if (!n) return '暂无记录';
  return '共 ' + n + ' 条';
});

function buildSkinTempChartOption() {
  const pts = skinTempPoints.value;
  const labels = pts.map((p) => formatTimeLabel(p.record_time));
  const values = pts.map((p) => p.temperature);

  let yMin = 35.0;
  let yMax = 37.0;
  if (values.length) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (lo === hi) {
      yMin = Math.round((lo - 0.2) * 10) / 10;
      yMax = Math.round((hi + 0.2) * 10) / 10;
    } else {
      const pad = Math.max(0.05, (hi - lo) * 0.2);
      yMin = Math.floor((lo - pad) * 10) / 10;
      yMax = Math.ceil((hi + pad) * 10) / 10;
    }
  }

  return {
    grid: {
      left: '3%',
      right: '3%',
      bottom: '12%',
      top: '8%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: {
        lineStyle: {
          color: '#ececf1'
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: '#9ba0aa',
        fontSize: 10
      }
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      scale: values.length > 0,
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: '#9ba0aa',
        fontSize: 10
      },
      splitLine: {
        lineStyle: {
          color: '#f3f4f7'
        }
      }
    },
    series: [
      {
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: {
          color: '#f05f8f',
          width: 2
        },
        itemStyle: {
          color: '#f05f8f'
        }
      }
    ]
  };
}

function applySkinTempChart() {
  const chart = tempChartInstance.value;
  if (!chart) return;
  chart.setOption(buildSkinTempChartOption(), { notMerge: true });
}

watch(skinTempPoints, () => applySkinTempChart(), { deep: true });

function resolveDayRingStyle(d: Date): 'none' | 'solid' | 'dashed' {
  const ymd = formatDateYmd(d);

  if (periodDates.value.has(ymd)) return 'solid';

  const data = girlHealthAll.value;
  if (isInRange(d, data?.startDate, data?.endDate)) return 'dashed';

  return 'none';
}

function getObjectCandidates(source: any, depth = 0): Array<Record<string, any>> {
  if (!source || depth > 4) return [];
  if (Array.isArray(source)) return source.flatMap((item) => getObjectCandidates(item, depth + 1));
  if (typeof source !== 'object') return [];
  const payload = source as Record<string, any>;
  const candidates: Array<Record<string, any>> = [payload];
  for (const key of [
    'data',
    'payload',
    'body',
    'result',
    'profile',
    'info',
    'detail',
    'girlHealth',
    'girlHealthInfo',
    'girlHealthData',
    'userGirlHealth',
    'femaleHealth',
    'periodInfo',
    'health',
    'prediction',
    'analysis'
  ]) {
    const value = payload[key];
    if (value && value !== source) candidates.push(...getObjectCandidates(value, depth + 1));
  }
  for (const key of ['list', 'rows', 'records', 'items']) {
    const value = payload[key];
    if (Array.isArray(value)) candidates.push(...getObjectCandidates(value, depth + 1));
  }
  return candidates;
}

function unwrapHealthTempRows(source: unknown): HealthTempStatItem[] {
  if (Array.isArray(source)) return source as HealthTempStatItem[];
  if (!source || typeof source !== 'object') return [];
  const payload = source as Record<string, any>;
  if (
    SKIN_TEMP_TIME_KEYS.some((key) => payload[key] !== undefined) ||
    SKIN_TEMP_VALUE_KEYS.some((key) => payload[key] !== undefined)
  ) {
    return [payload as HealthTempStatItem];
  }
  for (const key of ['data', 'result', 'rows', 'list', 'records', 'items', 'chartData', 'dataList', 'statList']) {
    const rows = unwrapHealthTempRows(payload[key]);
    if (rows.length) return rows;
  }
  return [];
}

function getPredictedCycleFromSource(source: any): Record<string, any> | null {
  const candidates = getObjectCandidates(source);
  for (const payload of candidates) {
    const cycle = payload.predictedCycle || payload.cycle || payload.cycleInfo;
    if (cycle && typeof cycle === 'object') return cycle as Record<string, any>;

    const menstrual = payload.menstrual || payload.menstruation || payload.period;
    const ovulation = payload.ovulation;
    const fertility = payload.fertility || payload.fertile || payload.follicular;
    const safe = payload.safe || payload.luteal;
    if ([menstrual, ovulation, fertility, safe].some((item) => item && typeof item === 'object')) {
      return {
        menstrual: menstrual || undefined,
        ovulation: ovulation || undefined,
        fertility: fertility || undefined,
        safe: safe || undefined
      };
    }
  }
  return null;
}

function cachePredictedCycle(pc: Record<string, any> | null) {
  if (!pc) return;
  try {
    uni.setStorageSync('menstrual', pc.menstrual || pc.menstruation || pc.period || null);
    uni.setStorageSync('ovulation', pc.ovulation || null);
    uni.setStorageSync('fertility', pc.fertility || pc.fertile || pc.follicular || null);
    uni.setStorageSync('safe', pc.safe || pc.luteal || null);
  } catch {
    // 算法结果缓存失败不影响本次页面渲染。
  }
}

function getPredictedCycleFromLocalStorage(): Record<string, any> | null {
  try {
    const menstrual = uni.getStorageSync('menstrual');
    const ovulation = uni.getStorageSync('ovulation');
    const fertility = uni.getStorageSync('fertility');
    const safe = uni.getStorageSync('safe');
    if (!menstrual && !ovulation && !fertility && !safe) return null;
    return {
      menstrual: menstrual || undefined,
      ovulation: ovulation || undefined,
      fertility: fertility || undefined,
      safe: safe || undefined
    };
  } catch {
    return null;
  }
}

function hasMeaningfulGirlHealthValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getGirlHealthProfileFromSource(source: any): GirlHealthModel | null {
  const candidates = getObjectCandidates(source);
  const profileDateKeys = [
    'lastMenstruationDate',
    'lastMenstruationStartDate',
    'lastMenstrualStartDate',
    'lastMenstrualDate',
    'lastMenstrualTime',
    'lastMenstruationTime',
    'lastMenstruationStartTime',
    'lastMenstrualDateTime',
    'lastPeriodTime',
    'lastPeriodTimePoint',
    'lastPeriodDate',
    'lastPeriodStartDate',
    'lastPeriodStartTime',
    'recentMenstruationDate',
    'menstruationStartDate',
    'menstruationStartTime',
    'periodStartDate',
    'periodStartTime',
    'periodDates',
    'menstrualDates',
    'menstruationDates',
    'records',
    'startDate'
  ];
  const resolvableProfile = candidates.find((payload) =>
    Boolean(resolvePeriodProfileState(selectedDate.value, normalizeGirlHealthModel(payload) as Record<string, any>))
  );
  const profile = resolvableProfile || candidates.find((payload) =>
    profileDateKeys.some((key) => hasMeaningfulGirlHealthValue(payload[key]))
  );
  return profile ? normalizeGirlHealthModel(profile) : null;
}

function getWheelPeriodPhaseKey(phase: WheelPhaseKey): PeriodPhaseKey {
  if (phase === 'follicular') return 'fertile';
  if (phase === 'luteal') return 'safe';
  return phase;
}

function getWheelPhaseSegment(pc: any, phase: WheelPhaseKey) {
  return getPeriodPhaseSegment(pc, getWheelPeriodPhaseKey(phase));
}

function getPhaseLengthMapFromCycle(pc: any): Record<WheelPhaseKey, number> {
  return {
    menstrual:
      daysInclusive(getWheelPhaseSegment(pc, 'menstrual')?.start, getWheelPhaseSegment(pc, 'menstrual')?.end) ||
      DEFAULT_WHEEL_PHASE_LENGTHS.menstrual,
    follicular:
      daysInclusive(getWheelPhaseSegment(pc, 'follicular')?.start, getWheelPhaseSegment(pc, 'follicular')?.end) ||
      DEFAULT_WHEEL_PHASE_LENGTHS.follicular,
    ovulation:
      daysInclusive(getWheelPhaseSegment(pc, 'ovulation')?.start, getWheelPhaseSegment(pc, 'ovulation')?.end) ||
      DEFAULT_WHEEL_PHASE_LENGTHS.ovulation,
    luteal:
      daysInclusive(getWheelPhaseSegment(pc, 'luteal')?.start, getWheelPhaseSegment(pc, 'luteal')?.end) ||
      DEFAULT_WHEEL_PHASE_LENGTHS.luteal
  };
}

function resolveWheelPhaseFromText(value: unknown): WheelPhaseKey | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('menstrual') || text.includes('menstruation') || text.includes('period') || text.includes('月经') || text.includes('经期')) {
    return 'menstrual';
  }
  if (text.includes('ovulation') || text.includes('排卵')) return 'ovulation';
  if (text.includes('fertile') || text.includes('fertility') || text.includes('follicular') || text.includes('易孕') || text.includes('卵泡')) {
    return 'follicular';
  }
  if (text.includes('safe') || text.includes('luteal') || text.includes('安全') || text.includes('黄体')) return 'luteal';
  return null;
}

function resolveWheelPhaseFromIndex(value: unknown, mode: 'zeroBased' | 'oneBased'): WheelPhaseKey | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const index = Math.round(numeric);
  if (mode === 'zeroBased') {
    if (index === 0) return 'menstrual';
    if (index === 1) return 'ovulation';
    if (index === 2) return 'follicular';
    if (index === 3) return 'luteal';
    return null;
  }
  if (index === 1) return 'menstrual';
  if (index === 2) return 'ovulation';
  if (index === 3) return 'follicular';
  if (index === 4) return 'luteal';
  return null;
}

function getPositiveIntegerFromKeys(payload: Record<string, any>, keys: string[]): number | null {
  for (const key of keys) {
    const numeric = Number(payload[key]);
    if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
  }
  return null;
}

function getWheelCycleDayFromPhase(phase: WheelPhaseKey, dayInPhase: number): number {
  let offset = 0;
  const lengths = {
    ...DEFAULT_WHEEL_PHASE_LENGTHS,
    ...phaseLengths.value
  };
  for (const key of WHEEL_PHASE_ORDER) {
    if (key === phase) break;
    offset += lengths[key] || DEFAULT_WHEEL_PHASE_LENGTHS[key];
  }
  return offset + Math.max(1, dayInPhase);
}

function syncWheelFromDirectGirlHealthAll(source: any): boolean {
  const candidates = getObjectCandidates(source);
  for (const payload of candidates) {
    const phase =
      resolveWheelPhaseFromText(payload.phase) ||
      resolveWheelPhaseFromText(payload.currentPhase) ||
      resolveWheelPhaseFromText(payload.currentPhaseName) ||
      resolveWheelPhaseFromText(payload.periodPhase) ||
      resolveWheelPhaseFromText(payload.periodPhaseName) ||
      resolveWheelPhaseFromText(payload.stage) ||
      resolveWheelPhaseFromText(payload.stageName) ||
      resolveWheelPhaseFromText(payload.status) ||
      resolveWheelPhaseFromText(payload.statusName) ||
      resolveWheelPhaseFromText(payload.cycleStatus) ||
      resolveWheelPhaseFromText(payload.cycleStatusName) ||
      resolveWheelPhaseFromText(payload.currentStage) ||
      resolveWheelPhaseFromText(payload.currentStageName) ||
      resolveWheelPhaseFromIndex(payload.currentPhaseIndex, 'zeroBased') ||
      resolveWheelPhaseFromIndex(payload.phaseIndex, 'zeroBased') ||
      resolveWheelPhaseFromIndex(payload.periodPhaseIndex, 'zeroBased') ||
      resolveWheelPhaseFromIndex(payload.stageIndex, 'zeroBased') ||
      resolveWheelPhaseFromIndex(payload.currentPhaseCode, 'oneBased') ||
      resolveWheelPhaseFromIndex(payload.phaseCode, 'oneBased') ||
      resolveWheelPhaseFromIndex(payload.periodPhaseCode, 'oneBased') ||
      resolveWheelPhaseFromIndex(payload.stageCode, 'oneBased');
    const directCycleDay = getPositiveIntegerFromKeys(payload, [
      'currentCycleDay',
      'dayInCycle',
      'currentDayInCycle',
      'cycleDayNow',
      'currentCycleDayNo'
    ]);
    if (!phase && directCycleDay) {
      phaseLengths.value = {
        ...DEFAULT_WHEEL_PHASE_LENGTHS,
        ...phaseLengths.value
      };
      cycleDay.value = directCycleDay;
      return true;
    }
    if (!phase) continue;
    const dayInPhase =
      getPositiveIntegerFromKeys(payload, [
        'dayInPhase',
        'phaseDay',
        'currentDay',
        'currentDayNo',
        'stageDay',
        'periodDay',
        'menstrualDay',
        'menstruationDayNo',
        'cycleDayOfPhase'
      ]) || 1;
    phaseLengths.value = {
      ...DEFAULT_WHEEL_PHASE_LENGTHS,
      ...phaseLengths.value
    };
    cycleDay.value = getWheelCycleDayFromPhase(phase, dayInPhase);
    return true;
  }
  return false;
}

function syncWheelFromPredictedCycle(pc: any): boolean {
  if (!pc) return false;
  const lengths = getPhaseLengthMapFromCycle(pc);
  phaseLengths.value = lengths;
  const sel = startOfLocalDay(selectedDate.value);
  let offset = 0;

  for (const phase of WHEEL_PHASE_ORDER) {
    const seg = getWheelPhaseSegment(pc, phase);
    const start = parseYmdToLocalDate(seg?.start);
    const end = parseYmdToLocalDate(seg?.end);
    const len = lengths[phase] || DEFAULT_WHEEL_PHASE_LENGTHS[phase];
    if (start && end && sel.getTime() >= start.getTime() && sel.getTime() <= end.getTime()) {
      const dayInPhase = Math.max(1, Math.min(daysDiff(sel, start) + 1, len));
      cycleDay.value = offset + dayInPhase;
      return true;
    }
    offset += len;
  }

  const menstrualSeg = getWheelPhaseSegment(pc, 'menstrual');
  const mStart = parseYmdToLocalDate(menstrualSeg?.start);
  const cycleEnd = parseYmdToLocalDate(
    getWheelPhaseSegment(pc, 'luteal')?.end ||
      getWheelPhaseSegment(pc, 'ovulation')?.end ||
      getWheelPhaseSegment(pc, 'follicular')?.end ||
      menstrualSeg?.end
  );
  if (!mStart || !cycleEnd) return false;

  if (sel.getTime() < mStart.getTime() || sel.getTime() > cycleEnd.getTime()) return false;

  let dayIndex = daysDiff(sel, mStart) + 1;
  if (!Number.isFinite(dayIndex) || dayIndex < 1) dayIndex = 1;

  const total = WHEEL_PHASE_ORDER.reduce((sum, phase) => sum + (lengths[phase] || 0), 0);
  if (total > 0) dayIndex = Math.min(dayIndex, total);

  cycleDay.value = dayIndex;
  return true;
}

function syncWheelFromGirlHealthAll(): boolean {
  const data = girlHealthAll.value;
  if (!data) return false;
  const profile = getGirlHealthProfileFromSource(data);
  if (profile) {
    const state = resolvePeriodProfileState(selectedDate.value, profile as Record<string, any>);
    if (state) {
      modelGirlHealth.value = normalizeGirlHealthModel({
        ...modelGirlHealth.value,
        ...profile
      });
      cycleDay.value = state.cycleDay;
      phaseLengths.value = {
        menstrual: state.phaseLengths.menstrual,
        follicular: state.phaseLengths.fertile,
        ovulation: state.phaseLengths.ovulation,
        luteal: state.phaseLengths.safe
      };
      writeLocalGirlHealthProfile(modelGirlHealth.value);
      return true;
    }
  }
  const pc = getPredictedCycleFromSource(data);
  if (pc && syncWheelFromPredictedCycle(pc)) return true;
  return syncWheelFromDirectGirlHealthAll(data);
}

function syncWheelFromGirlHealthProfile(): boolean {
  const profileState = resolvePeriodProfileState(selectedDate.value, modelGirlHealth.value as Record<string, any>);
  if (!profileState) return false;
  cycleDay.value = profileState.cycleDay;
  phaseLengths.value = {
    menstrual: profileState.phaseLengths.menstrual,
    follicular: profileState.phaseLengths.fertile,
    ovulation: profileState.phaseLengths.ovulation,
    luteal: profileState.phaseLengths.safe
  };
  return true;
}

function getLatestPeriodStartFromDates(): Date | null {
  const dates = Array.from(periodDates.value)
    .map((item) => parseYmdToLocalDate(item))
    .filter((item): item is Date => Boolean(item))
    .map((item) => formatDateYmd(item))
    .sort();
  if (!dates.length) return null;
  const latestCluster = [dates[dates.length - 1]];
  for (let i = dates.length - 2; i >= 0; i -= 1) {
    const current = parseYmdToLocalDate(dates[i]);
    const first = parseYmdToLocalDate(latestCluster[0]);
    if (!current || !first || daysDiff(first, current) !== 1) break;
    latestCluster.unshift(dates[i]);
  }
  return parseYmdToLocalDate(latestCluster[0]);
}

function syncWheelFromPeriodDatesFallback(): boolean {
  const lastStart = getLatestPeriodStartFromDates();
  if (!lastStart) return false;
  const cycleLength = toPositiveNumber(modelGirlHealth.value.cycleDay ?? modelGirlHealth.value.periodCycle, 28);
  const menstrualLength = toPositiveNumber(
    modelGirlHealth.value.menstruationDay ?? modelGirlHealth.value.periodRuntime,
    5
  );
  if (cycleLength < 20 || cycleLength > 38 || menstrualLength < 3 || menstrualLength > 10) return false;
  const selected = startOfLocalDay(selectedDate.value);
  const cycleOffset = ((daysDiff(selected, lastStart) % cycleLength) + cycleLength) % cycleLength;
  const ovulationDay = Math.min(cycleLength, Math.max(menstrualLength + 1, cycleLength - 14));
  const follicularLength = Math.max(1, ovulationDay - menstrualLength - 1);
  const ovulationLength = 1;
  const lutealLength = Math.max(1, cycleLength - menstrualLength - follicularLength - ovulationLength);
  phaseLengths.value = {
    menstrual: menstrualLength,
    follicular: follicularLength,
    ovulation: ovulationLength,
    luteal: lutealLength
  };
  cycleDay.value = cycleOffset + 1;
  return true;
}

function syncWheelForSelectedDate() {
  if (syncWheelFromGirlHealthProfile()) return;
  if (syncWheelFromPeriodDatesFallback()) return;
  if (syncWheelFromGirlHealthAll()) return;
  if (syncWheelFromPredictedCycle(getPredictedCycleFromLocalStorage())) return;
  cycleDay.value = 0;
  phaseLengths.value = {};
}

function normalizePeriodDateList(value: unknown): string[] {
  const normalizeOne = (item: unknown) => {
    if (item && typeof item === 'object') {
      const payload = item as Record<string, any>;
      return formatPeriodDateYmd(
        getFirstGirlHealthValue(payload, [
          ...GIRL_HEALTH_LAST_START_KEYS,
          'date',
          'recordDate',
          'recordTime',
          'record_time',
          'periodDate',
          'menstrualDate',
          'menstruationDate',
          'day',
          'time'
        ]) as any
      );
    }
    return formatPeriodDateYmd(item as any);
  };
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(normalizeOne).filter(Boolean)));
  }
  const text = String(value || '').trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return normalizePeriodDateList(parsed);
      }
    } catch {
      // 兼容非标准数组字符串，继续按分隔符解析。
    }
  }
  return text
    .split(/[,，\s]+/)
    .map((s: string) => normalizeOne(s.trim().replace(/^['"\[]+|['"\]]+$/g, '')))
    .filter(Boolean);
}

function toPositiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

async function loadGirlHealthInfo() {
  try {
    const res: any = await getGirlHealth({ date: formatDateYmd(selectedDate.value) });
    const remoteProfile = getGirlHealthProfileFromSource(res);
    const cachedProfile = readLocalGirlHealthProfile();
    const remoteProfileUsable = Boolean(
      remoteProfile && resolvePeriodProfileState(selectedDate.value, remoteProfile as Record<string, any>)
    );
    const source = remoteProfileUsable ? remoteProfile : cachedProfile || remoteProfile;
    modelGirlHealth.value = normalizeGirlHealthModel(source || {});
    const hasRemoteProfile = Boolean(remoteProfile && remoteProfileUsable);
    if (hasRemoteProfile) {
      writeLocalGirlHealthProfile(modelGirlHealth.value);
    }
    const dates = normalizePeriodDateList(
      modelGirlHealth.value.lastPeriodTime || modelGirlHealth.value.lastMenstruationDate
    );
    periodDates.value = new Set(dates);
  } catch {
    const cachedProfile = readLocalGirlHealthProfile();
    modelGirlHealth.value = cachedProfile || {};
    periodDates.value = new Set(
      cachedProfile ? normalizePeriodDateList(cachedProfile.lastPeriodTime || cachedProfile.lastMenstruationDate) : []
    );
  }
}

async function loadSkinTempStats() {
  try {
    const rows = await getHealthTempStats({ newDate: formatDateYmd(selectedDate.value) });
    tempStatsRaw.value = unwrapHealthTempRows(rows);
  } catch {
    tempStatsRaw.value = [];
  } finally {
    tempStatsLoaded.value = true;
  }
}

async function loadGirlHealthAll() {
  try {
    const res = await getUserGirlHealthAll({ date: formatDateYmd(selectedDate.value) });
    girlHealthAll.value = res || null;
    const predictedCycle = getPredictedCycleFromSource(res);
    cachePredictedCycle(predictedCycle);
    const safeSeg = getPeriodPhaseSegment(predictedCycle, 'safe');
    girlHealthEndDate.value = safeSeg?.end || '';
  } catch {
    girlHealthAll.value = null;
    girlHealthEndDate.value = '';
  }
}

async function reloadForSelectedDate() {
  tempStatsLoaded.value = false;
  await Promise.all([loadGirlHealthInfo(), loadGirlHealthAll(), loadSkinTempStats()]);
  syncWheelForSelectedDate();
}

async function initTempChart() {
  if (!tempChartRef.value) return;
  try {
    const chart = await tempChartRef.value.init(echarts);
    tempChartInstance.value = chart;
    applySkinTempChart();
  } catch (error) {
    console.error('温度图初始化失败', error);
  }
}

function onWeekDayTap(cell: { ymd: string }) {
  const d = parseYmdToLocalDate(cell.ymd);
  if (!d) return;
  //.predictedCycle.luteal.end
  if(girlHealthEndDate.value!=null){
	  let otherDate=parseYmdToLocalDate(girlHealthEndDate.value)
	  if(otherDate!=null){
		 if(d.getTime()>otherDate.getTime()){
		 		 return;
		 }  
	  }
  }
  selectedDate.value = d;
  void reloadForSelectedDate();
}

function onCalendarTap() {
  uni.showToast({ title: '日历', icon: 'none' });
}

function onEdit() {
  // 打开编辑弹窗
  
  const data = modelGirlHealth.value;
  if (data) {
	  const dates = normalizePeriodDateList(data.lastPeriodTime || data.lastMenstruationDate).sort();
	  
	  editFormData.value = {
	    startDate: dates[0] || data.lastMenstruationDate || formatDateYmd(new Date()),
	    cycleDays: toPositiveNumber(data.cycleDay ?? data.periodCycle, 28),
	    periodDays: toPositiveNumber(data.menstruationDay ?? data.periodRuntime, 5),
		id:data.id || 0
	  };
    // editFormData.value = {
    //   startDate: data.predictedCycle.menstrual.start,
    //   cycleDays: daysInclusive(data.predictedCycle.menstrual?.start, data.predictedCycle.luteal?.end) || 28,
    //   periodDays: daysInclusive(data.predictedCycle.menstrual?.start, data.predictedCycle.menstrual?.end) || 5
    // };
  } else {
    editFormData.value = {
      startDate: formatDateYmd(new Date()),
      cycleDays: 30,
      periodDays: 7,
	  id:0
    };
  }
  
  // 打开弹窗
  editModalRef.value?.openModal(editFormData.value);
}
function getDateArray(startDateStr:string, days:number) {
    const result = [];
    // 1. 初始化日期对象 (JS会自动识别 '2026-3-10')
    let currentDate = new Date(startDateStr);

    for (let i = 0; i < days; i++) {
        // 2. 获取年份、月份、日期
        const year = currentDate.getFullYear();
        // 注意：月份需要 +1，且可能需要补零
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        // 日期可能需要补零
        const day = String(currentDate.getDate()).padStart(2, '0');

        // 3. 拼接成你想要的格式 (例如：2026-03-10)
        result.push(`${year}-${month}-${day}`);

        // 4. 日期递增 1 天
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return result;
}
async function onSaveEdit(data: { startDate: string; cycleDays: number; periodDays: number ; id:number}) {
  // 保存用户修改的经期信息
  
  // 更新表单数据
  editFormData.value = { ...data };
  const model = modelGirlHealth.value;
  if (!model) {
    uni.showToast({ title: '未获取到生理周期资料，请刷新后重试', icon: 'none' });
    return;
  }
  try {
    uni.showLoading({ title: '提交中...', mask: true });
	const dates=getDateArray(data.startDate,data.periodDays)
     await updateGirlHealth({
		    birthDay:modelGirlHealth.value.birthDay, //出生日期
		    periodCycle:editFormData.value.cycleDays, //经期周期
		    periodRuntime:editFormData.value.periodDays,//持续天数
		    lastPeriodTime:dates, //月经开始结束周期
		    isRuleType:modelGirlHealth.value.isRuleType, //周期规律
		    otherUnhealth: modelGirlHealth.value.otherUnhealth,//其他病状
			userId:modelGirlHealth.value.userId,
			id:editFormData.value.id
	 });
    const profileUserId = getCurrentGirlHealthProfileUserId(modelGirlHealth.value);
    if (profileUserId) {
      const profileCache = normalizeGirlHealthModel({
        ...modelGirlHealth.value,
        userId: profileUserId,
        cycleDay: editFormData.value.cycleDays,
        periodCycle: editFormData.value.cycleDays,
        menstruationDay: editFormData.value.periodDays,
        periodRuntime: editFormData.value.periodDays,
        lastMenstruationDate: data.startDate,
        lastPeriodTime: dates
      });
      modelGirlHealth.value = profileCache;
      writeLocalGirlHealthProfile(profileCache, profileUserId);
    }
    uni.hideLoading();
    uni.showToast({ title: '提交成功', icon: 'success' });	
      loadGirlHealthInfo()
	

  } catch (err: any) {
    uni.hideLoading();
    uni.showToast({
      title: err?.msg || err?.message || '提交失败，请重试',
      icon: 'none',
      duration: 2000
    });
  }
  uni.showToast({ 
    title: '保存成功', 
    icon: 'success' 
  });
  
  // 重新加载数据
  void reloadForSelectedDate();
}

function onMore() {
  uni.showToast({ title: '了解更多', icon: 'none' });
}

function onCloseIntro() {
  showIntroCard.value = false;
  uni.setStorageSync(PERIOD_INTRO_DISMISSED_KEY, true);
}
</script>

<style scoped lang="scss">
.period-detail-page {
  min-height: 100vh;
  background: #f5f6f8;
  box-sizing: border-box;
}

.period-detail-body {
  padding: 0 24rpx;
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
}

.period-navbar-center {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}

.period-navbar-center__title {
  font-size: 34rpx;
  font-weight: 600;
  color: #303133;
}

.period-week-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 20rpx 12rpx 24rpx;
  margin-bottom: 20rpx;
  box-sizing: border-box;
}

.period-week-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
}

.week-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.week-cell-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

.week-cell-inner--today .week-cell-label {
  color: #ff4081;
  font-weight: 600;
}

.week-cell-inner--today .week-num--plain text {
  color: #ff4081;
  font-weight: 600;
}

.week-cell-label {
  font-size: 22rpx;
  color: #8a8f99;
  line-height: 1.2;
  margin-bottom: 10rpx;
}

.week-num {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.week-num--plain {
  width: auto;
  height: auto;
  min-width: 56rpx;
  min-height: 56rpx;
  border-radius: 0;
}

.week-num--plain text {
  font-size: 30rpx;
  font-weight: 500;
  color: #1a1a1a;
}

.week-num--solid {
  background: #ff4081;
}

.week-num--solid text {
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
}

.week-num--dashed {
  border: 2rpx dashed #ff4081;
  background: transparent;
}

.week-num--dashed text {
  font-size: 28rpx;
  font-weight: 600;
  color: #ff4081;
}

.period-intro-card,
.period-remind-card,
.period-temp-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-sizing: border-box;
}

.period-intro-card {
  position: relative;
}

.period-intro-text {
  font-size: 24rpx;
  color: #4f5560;
  line-height: 1.5;
  padding-right: 40rpx;
}

.period-intro-footer {
  margin-top: 14rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.intro-more-btn {
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: #000;
  background: #FFE4EC;
}

.intro-close {
  position: absolute;
  top: 14rpx;
  right: 18rpx;
  font-size: 34rpx;
  color: #8a8f99;
  line-height: 1;
}

.section-title {
  font-size: 30rpx;
  color: #222;
  font-weight: 600;
  margin-bottom: 12rpx;
}

.section-content {
  font-size: 24rpx;
  color: #4f5560;
  line-height: 1.7;
}

.temp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.temp-title {
  display: flex;
  align-items: center;
  font-size: 30rpx;
  color: #222;
  font-weight: 600;
}

.temp-info {
  margin-left: 10rpx;
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  border: 1px solid #c9cdd5;
  color: #8a8f99;
  font-size: 20rpx;
  line-height: 28rpx;
  text-align: center;
}

.temp-right-icon {
  font-size: 28rpx;
  color: #8a8f99;
}

.temp-score {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
}

.temp-value {
  font-size: 44rpx;
  font-weight: 700;
  color: #222;
}

.temp-divider {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: #9ba0aa;
}

.temp-chart-wrap {
  margin-top: 10rpx;
  width: 100%;
  height: 260rpx;
}

.temp-chart {
  width: 100%;
  height: 100%;
}

/* ── 重要提醒卡片 ── */
.remind-important-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx 24rpx 12rpx;
  margin-bottom: 20rpx;
  box-sizing: border-box;
}

.remind-important-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #222;
  margin-bottom: 24rpx;
}

.remind-important-item {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  background: #FFF5F8;
  border-radius: 16rpx;
  border-left: 6rpx solid #9B6CF7;
  padding: 20rpx 20rpx 20rpx 16rpx;
  margin-bottom: 16rpx;
  box-sizing: border-box;
}

.remind-item-icon-wrap {
  margin-right: 16rpx;
  margin-top: 2rpx;
  flex-shrink: 0;
}

.remind-item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.remind-item-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #222;
  margin-bottom: 8rpx;
  line-height: 1.4;
}

.remind-item-desc {
  font-size: 24rpx;
  color: #666;
  line-height: 1.5;
}
</style>
