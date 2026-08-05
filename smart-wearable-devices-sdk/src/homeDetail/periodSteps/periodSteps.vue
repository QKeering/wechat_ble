<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad , onShow} from '@dcloudio/uni-app';
import { addGirlHealth } from '@/common/api/homeDetail';

const GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY = 'qkeer_girl_health_profile_updated_at';
const GIRL_HEALTH_PROFILE_EXISTS_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile_exists';
const GIRL_HEALTH_PROFILE_STORAGE_KEY_PREFIX = 'qkeer_girl_health_profile';
const getGirlHealthProfileExistsStorageKey = (userId?: unknown) =>
  `${GIRL_HEALTH_PROFILE_EXISTS_STORAGE_KEY_PREFIX}:${String(userId || 'anonymous')}`;
const getGirlHealthProfileStorageKey = (userId?: unknown) =>
  `${GIRL_HEALTH_PROFILE_STORAGE_KEY_PREFIX}:${String(userId || 'anonymous')}`;

// ────────── Step3: 月历选择最近一次月经 ──────────
const calendarMonthOffset = ref(0); // 0=当月, -1=上月

const calendarDisplayYear = computed(() => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + calendarMonthOffset.value);
  return d.getFullYear();
});
const calendarDisplayMonth = computed(() => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + calendarMonthOffset.value);
  return d.getMonth() + 1;
});

// 月份标签（上月 / 当月）
const calendarTabs = computed(() => {
  const now = new Date();
  const tabs = [];
  for (let offset = -1; offset <= 0; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    tabs.push({ year: d.getFullYear(), month: d.getMonth() + 1, offset });
  }
  return tabs;
});

// 当前月日历格子
const calendarDays = computed(() => {
  const y = calendarDisplayYear.value;
  const m = calendarDisplayMonth.value;
  const firstDay = new Date(y, m - 1, 1).getDay(); // 0=日
  // 转成周一为第一列：0(日)->6, 1(一)->0 ...
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: Array<{ day: number | null; dateStr: string }> = [];
  for (let i = 0; i < startOffset; i++) cells.push({ day: null, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    cells.push({ day: d, dateStr: `${y}-${mm}-${dd}` });
  }
  return cells;
});

// 已选经期日期集合（实心勾）
const selectedPeriodDates = ref<Set<string>>(new Set([]));
// 推测日期集合（虚线勾）
const predictedDates = ref<Set<string>>(new Set(['2026-03-07', '2026-03-08', '2026-03-09']));

const togglePeriodDate = (dateStr: string) => {
  if (!dateStr) return;
  if (selectedPeriodDates.value.has(dateStr)) {
    selectedPeriodDates.value.delete(dateStr);
  } else {
   // predictedDates.value.delete(dateStr);
    selectedPeriodDates.value.add(dateStr);
  }
  // 触发响应式更新
  selectedPeriodDates.value = new Set(selectedPeriodDates.value);
};

const getDayStatus = (dateStr: string) => {
  if (!dateStr) return 'empty';
  if (selectedPeriodDates.value.has(dateStr)) return 'selected';
  if (predictedDates.value.has(dateStr)) return 'predicted';
  return 'normal';
};

// ────────── Step6: 健康情况多选 ──────────
const healthConditions = ref([
  { value: 'none',              label: '无' },
  { value: 'pcos',              label: '多囊卵巢综合征（PCOS）' },
  { value: 'endometriosis',     label: '子宫内膜异位症' },
  { value: 'fibroid',           label: '子宫肌瘤/子宫息肉' },
  { value: 'hyperthyroidism',   label: '甲状腺功能亢进' },
  { value: 'hypothyroidism',    label: '甲状腺功能减退' },
  { value: 'diabetes',          label: '糖尿病' },
  { value: 'eating_disorder',   label: '饮食失调症' },
  { value: 'hyperprolactinemia',label: '高泌乳素血症' },
  { value: 'other',             label: '其他' }
]);
const selectedConditions = ref<Set<string>>(new Set([]));

const NONE_VALUE = 'none';
const toggleCondition = (value: string) => {
  const next = new Set(selectedConditions.value);
  if (next.has(value)) {
    next.delete(value);
  } else {
    // “无”与其他选项互斥
    if (value === NONE_VALUE) {
      next.clear();
    } else {
      next.delete(NONE_VALUE);
    }
    next.add(value);
  }
  selectedConditions.value = next;
};

const submitQuestionnaire = async () => {
  // ── 组装各步骤数据 ──
  // Step1: 出生日期
  const birthday = `${selectedYear.value}-${selectedMonth.value}-${selectedDay.value}`;

  // Step2: 平均生理周期天数
  const cycleDay = Number(selectedOnlyDay.value);

  // Step3: 经期持续天数
  const menstruationDay = Number(selectedLongOnlyDay.value);

  // Step4: 最近一次月经开始日期（取所选日期中最早的一天）
  const periodDatesArr = Array.from(selectedPeriodDates.value).sort();
  const lastMenstruationDate = periodDatesArr.length > 0 ? periodDatesArr[0] : '';
  if (!lastMenstruationDate) {
    uni.showToast({ title: '请选择最近一次月经时间', icon: 'none' });
    return;
  }
  // Step5: 周期规律
  const cycleRegularity = selectedRegularity.value;

  // Step6: 健康情况（多选，逗号拼接）
  const healthConditionsStr = Array.from(selectedConditions.value).join(',');
  const userData = uni.getStorageSync("userInfo") || {};
  const currentUserId = userData?.id || userData?.userId || userData?.user_id || userData?.uid;
  
  const params = {
    birthday,
    cycleDay,
    menstruationDay,
    lastMenstruationDate,
    cycleRegularity,
    healthConditions: healthConditionsStr,
    userId: currentUserId
  };
  const legacyParamsForReference = {
    birthDay:birthday, //出生日期
    periodCycle:cycleDay, //经期周期
    periodRuntime:menstruationDay,//持续天数
    lastPeriodTime:periodDatesArr, //月经开始结束周期
    lastPeriodTimePoint: lastMenstruationDate, // 最近一次月经开始日
    isRuleType:cycleRegularity, //周期规律
    otherUnhealth: healthConditionsStr,//其他病状
	userId:currentUserId
  };
  try {
    uni.showLoading({ title: '提交中...', mask: true });
    await addGirlHealth({ ...params, ...legacyParamsForReference });
    uni.setStorageSync(GIRL_HEALTH_PROFILE_UPDATED_STORAGE_KEY, Date.now());
    if (currentUserId) {
      uni.setStorageSync(getGirlHealthProfileExistsStorageKey(currentUserId), true);
      uni.setStorageSync(getGirlHealthProfileStorageKey(currentUserId), {
        ...params,
        user_id: currentUserId,
        birthDay: birthday,
        periodCycle: cycleDay,
        periodRuntime: menstruationDay,
        lastPeriodTime: periodDatesArr,
        lastPeriodTimePoint: lastMenstruationDate,
        isRuleType: cycleRegularity,
        otherUnhealth: healthConditionsStr
      });
    }
    uni.hideLoading();
    uni.showToast({ title: '提交成功', icon: 'success' });
    setTimeout(() => uni.navigateBack({ delta: 10 }), 1500);
  } catch (err: any) {
    uni.hideLoading();
    uni.showToast({
      title: err?.msg || err?.message || '提交失败，请重试',
      icon: 'none',
      duration: 2000
    });
  }
};

// ────────── Step5: 生理周期规律情况 ──────────
const regularityOptions = ref([
  { value: 'very_regular', label: '非常规律', desc: '每次月经都在固定的周期天数到来' },
  { value: 'regular', label: '规律', desc: '每次月经的开始日期会在平均周期天数的3天内波动' },
  { value: 'fairly_regular', label: '比较规律', desc: '每次月经的开始日期在平均周期的3-7天内波动' },
  { value: 'irregular', label: '不规律', desc: '每次月经开始日期的波动会超过平均周期的一周' }
]);
const selectedRegularity = ref('very_regular');

// ────────── 当前步骤 ──────────
const currentStep = ref(1);
const totalSteps = 6;

// ────────── 答题数据 ──────────
// Step1: 出生日期
const onlyDayList = Array.from({ length: 19 }, (_, i) => 20 + i); // 20-38
const onlyLongDayList = Array.from({ length: 8 }, (_, i) => 3 + i); // 3-10
const yearList = Array.from({ length: 38 }, (_, i) => 1970 + i); // 1965~2024
const monthList = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const dayList = computed(() => {
  const days = new Date(Number(selectedYear.value), Number(selectedMonth.value), 0).getDate();
  return Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0'));
});

const now = new Date();
const selectedYear = ref(String(now.getFullYear() - 10));
const selectedMonth = ref('01');
const selectedDay = ref('01');
const selectedOnlyDay= ref('20')
const selectedLongOnlyDay=ref('3')
const yearIndex = computed(() => yearList.findIndex((y) => String(y) === selectedYear.value));
const monthIndex = computed(() => monthList.findIndex((m) => m === selectedMonth.value));
const dayIndex = computed(() => dayList.value.findIndex((d) => d === selectedDay.value));
const onlyDayIndex =computed(() => onlyDayList.findIndex((y) => String(y) === selectedOnlyDay.value));
const onlyLongDayIndex =computed(() => onlyLongDayList.findIndex((y) => String(y) === selectedLongOnlyDay.value));
const onOnlyLongDayChange =(e :any ) =>{
 selectedLongOnlyDay.value=String(onlyLongDayList[e.detail.value]);
};
const onOnlyDayChange =(e :any ) =>{
 selectedOnlyDay.value=String(onlyDayList[e.detail.value]);
};
const onYearChange = (e: any) => {
  selectedYear.value = String(yearList[e.detail.value]);
  // 防止日超出当月天数
  if (Number(selectedDay.value) > dayList.value.length) {
    selectedDay.value = String(dayList.value.length).padStart(2, '0');
  }
};
const onMonthChange = (e: any) => {
  selectedMonth.value = monthList[e.detail.value];
  if (Number(selectedDay.value) > dayList.value.length) {
    selectedDay.value = String(dayList.value.length).padStart(2, '0');
  }
};
const onDayChange = (e: any) => {
  selectedDay.value = dayList.value[e.detail.value];
};

type PickerViewChangeEvent = {
  detail: {
    value: number[];
  };
};

const onBirthDatePickerChange = (e: PickerViewChangeEvent) => {
  const [year = 0, month = 0, day = 0] = e.detail.value || [];
  onYearChange({ detail: { value: year } });
  onMonthChange({ detail: { value: month } });
  onDayChange({ detail: { value: day } });
};

const onCycleDayPickerChange = (e: PickerViewChangeEvent) => {
  onOnlyDayChange({ detail: { value: e.detail.value?.[0] ?? 0 } });
};

const onMenstruationDayPickerChange = (e: PickerViewChangeEvent) => {
  onOnlyLongDayChange({ detail: { value: e.detail.value?.[0] ?? 0 } });
};

// ────────── 导航 ──────────
const goBack = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
  } else {
    uni.navigateBack();
  }
};

const closePage = () => {
  uni.navigateBack({ delta: 10 });
};
const goBacks =() =>{
	if (currentStep.value >1) {
	  currentStep.value--;
	}
}

const goNext = () => {
  if (currentStep.value < totalSteps) {
    currentStep.value++;
  } else {
    submitQuestionnaire();
  }
};
onShow(async ()=>{ 
});
onLoad(async () => { 
	const ruleList= uni.getStorageSync("ruleTypeDict");
	if(ruleList!=null){ 
		regularityOptions.value=[]
		for(let w=0;w<ruleList.length;w++){
			regularityOptions.value.push({
				value:ruleList[w].dictValue,
				label:ruleList[w].dictLabel,
				desc:ruleList[w].remark
			})
		}
	}
	// const unhealthList= uni.getStorageSync("unhealthDict");
	// if(unhealthList!=null){
	// 	healthConditions.value=[]
	// 	for(let e=0;e<unhealthList.length;e++){
	// 		healthConditions.value.push({
	// 			value:unhealthList[e].dictValue,
	// 			label:unhealthList[e].dictLabel
	// 		})
	// 	}
	// }
});
</script>

<template>
  <view class="page-wrap">
    <!-- 顶部导航 -->
    <uv-navbar placeholder leftIcon="" bgColor="#eef0f5">
      <template #left>
        <view class="nav-left flex ai-center">
          <view class="nav-btn" @tap="goBack">
            <uv-icon name="arrow-left" size="20" color="#333"></uv-icon>
          </view>
          <view class="nav-btn ml-20" @tap="closePage">
            <uv-icon name="close" size="20" color="#333"></uv-icon>
          </view>
        </view>
      </template>
      <template #center>
        <view class="step-indicator fs-32" style="color: #333">{{ currentStep }}/{{ totalSteps }}</view>
      </template>
    </uv-navbar>

    <!-- 内容区 -->
    <view class="content-wrap">

      <!-- ── Step 1: 出生日期 ── -->
      <view v-if="currentStep === 1" class="step-content">
             <view class="question-title">请选择你的出生日期</view>
             <view class="question-desc">提供准确的年龄，以便获得更准确的预测。</view>
        <!-- 滚轮选择器卡片 -->
        <view class="picker-card">
          <picker-view
            class="picker-view"
            :value="[yearIndex, monthIndex, dayIndex]"
            indicator-style="height: 88rpx;"
            @change="onBirthDatePickerChange"
          >
            <!-- 年 -->
            <picker-view-column>
              <view v-for="(y, i) in yearList" :key="i" class="picker-item">
                <text class="picker-text">{{ y }}</text>
                <text class="picker-unit" v-if="String(y) === selectedYear"> 年</text>
              </view>
            </picker-view-column>
            <!-- 月 -->
            <picker-view-column>
              <view v-for="(m, i) in monthList" :key="i" class="picker-item">
                <text class="picker-text">{{ m }}</text>
                <text class="picker-unit" v-if="m === selectedMonth"> 月</text>
              </view>
            </picker-view-column>
            <!-- 日 -->
            <picker-view-column>
              <view v-for="(d, i) in dayList" :key="i" class="picker-item">
                <text class="picker-text">{{ d }}</text>
                <text class="picker-unit" v-if="d === selectedDay"> 日</text>
              </view>
            </picker-view-column>
          </picker-view>
        </view>
      </view>

     <view v-if="currentStep === 2" class="step-content">
            <view class="question-title">请选择你的平均生理周期天数</view>
           <view class="question-desc">月经周期指上一次月经开始到下一次月经开始的周期，如果不确定周期天数，可以提供估计值。</view>
           <!-- 滚轮选择器卡片 -->
           <view class="picker-card">
             <picker-view
               class="picker-view"
               :value="[onlyDayIndex]"
               indicator-style="height: 88rpx;"
               @change="onCycleDayPickerChange"
             >
               <!-- 天 -->
               <picker-view-column>
                 <view v-for="(y, i) in onlyDayList" :key="i" class="picker-item">
                   <text class="picker-text">{{ y }}</text>
                   <text class="picker-unit" v-if="String(y) === selectedOnlyDay"> 天</text>
                 </view>
               </picker-view-column>
             </picker-view>
           </view>
         </view>
     <view v-if="currentStep === 3" class="step-content">
            <view class="question-title">请选择你的经期持续的时间</view>
           <view class="question-desc">提供经期持续的时间，以便获得更精准的预测。</view>
           <!-- 滚轮选择器卡片 -->
           <view class="picker-card">
             <picker-view
               class="picker-view"
               :value="[onlyLongDayIndex]"
               indicator-style="height: 88rpx;"
               @change="onMenstruationDayPickerChange"
             >
               <!-- 天 -->
               <picker-view-column>
                 <view v-for="(y, i) in onlyLongDayList" :key="i" class="picker-item">
                   <text class="picker-text">{{ y }}</text>
                   <text class="picker-unit" v-if="String(y) === selectedLongOnlyDay"> 天</text>
                 </view>
               </picker-view-column>
             </picker-view>
           </view>
         </view>
      <!-- ── Step 3: 最近一次月经时间（月历） ── -->
      <view v-if="currentStep === 4" class="step-content">
        <view class="question-title">请选择最近一次月经的时间</view>
        <view class="question-desc">
          如果您通过QkeeRing记录了连续60晚的睡眠数据小程序将基于这些数据进行分析，为您提供更精准的经期预测。
        </view>

        <!-- 日历卡片 -->
        <view class="calendar-card">
          <!-- 月份 Tab -->
          <view class="calendar-tabs flex">
            <view
              v-for="tab in calendarTabs"
              :key="tab.offset"
              class="calendar-tab flex-1 ta-c"
              :class="{ 'calendar-tab--active': tab.offset === calendarMonthOffset }"
              @tap="calendarMonthOffset = tab.offset"
            >
              <text class="calendar-tab-text">{{ tab.year }}年{{ tab.month }}月</text>
            </view>
          </view>

          <!-- 星期头 -->
          <view class="week-header flex">
            <view v-for="w in ['一','二','三','四','五','六','日']" :key="w" class="week-cell ta-c">
              <text class="week-text">{{ w }}</text>
            </view>
          </view>

          <!-- 日期格子   'day-number--predicted': getDayStatus(cell.dateStr) === 'predicted' 虚线圈圈-->
          <view class="days-grid">
            <view
              v-for="(cell, idx) in calendarDays"
              :key="idx"
              class="day-cell"
              @tap="togglePeriodDate(cell.dateStr)"
            >
              <template v-if="cell.day !== null">
                <text
                  class="day-number"
                  :class="{
                    'day-number--selected': getDayStatus(cell.dateStr) === 'selected',
                  
                  }"
                >{{ cell.day }}</text>
                <!-- 实心勾 -->
                <view v-if="getDayStatus(cell.dateStr) === 'selected'" class="day-check day-check--solid">
                  <text class="check-icon">✓</text>
                </view>
                <!-- 虚线勾（SVG实现虚线圆） -->
             <!--   <view v-else-if="getDayStatus(cell.dateStr) === 'predicted'" class="day-check day-check--dashed">
                 <!-- <svg width="44" height="44" viewBox="0 0 44 44" style="position:absolute;top:0;left:0;">
                    <circle cx="22" cy="22" r="19" fill="none" stroke="#ff3e7e" stroke-width="2.5" stroke-dasharray="5 3" stroke-linecap="round"/>
                  </svg> 
                  <text class="check-icon--dashed">✓</text>
                </view> -->
                <!-- 空圆 -->
                <view v-else class="day-check day-check--empty"></view>
              </template>
            </view>
          </view>

          <!-- 底部提示 -->
          <view class="calendar-tip ta-c mt-20">
            <text class="fs-24" style="color:#999">点击日历添加或删除经期</text>
          </view>
        </view>
      </view>

      <!-- ── Step 5: 生理周期规律情况 ── -->
      <view v-if="currentStep === 5" class="step-content">
        <view class="question-title">请选择你的生理周期规律情况</view>
        <view class="question-desc">月经周期指上一次月经开始到下一次月经开始，请选择最符合您情况的描述。</view>

        <view class="regularity-card">
          <view
            v-for="(opt, idx) in regularityOptions"
            :key="opt.value"
            class="regularity-item"
            :class="{ 'regularity-item--last': idx === regularityOptions.length - 1 }"
            @tap="selectedRegularity = opt.value"
          >
            <view class="regularity-left">
              <view class="regularity-label">{{ opt.label }}</view>
              <view class="regularity-desc">{{ opt.desc }}</view>
            </view>
            <view class="regularity-radio">
              <view v-if="selectedRegularity === opt.value" class="radio radio--active">
                <view class="radio-inner"></view>
              </view>
              <view v-else class="radio radio--normal"></view>
            </view>
          </view>
        </view>
      </view>

      <!-- ── Step 6: 健康情况多选 ── -->
      <view v-if="currentStep === 6" class="step-content step-content--step6">
        <view class="question-title">您是否具有以下情况（可多选）</view>

        <scroll-view scroll-y class="condition-card">
          <view
            v-for="(item, idx) in healthConditions"
            :key="item.value"
            class="condition-item"
            :class="{ 'condition-item--last': idx === healthConditions.length - 1 }"
            @tap="toggleCondition(item.value)"
          >
            <view class="condition-label">{{ item.label }}</view>
            <view class="condition-radio">
              <view v-if="selectedConditions.has(item.value)" class="radio radio--active">
                <view class="radio-inner"></view>
              </view>
              <view v-else class="radio radio--normal"></view>
            </view>
          </view>
        </scroll-view>
      </view>

    </view>

    <!-- 底部按钮：第6步用提交长条，其余步骤用圆形左右按钮 -->
    <view v-if="currentStep === 6" class="bottom-bar-step6">
      <view class="step6-back-btn" @tap="goBacks">
        <uv-icon name="arrow-leftward" color="#333" size="22"></uv-icon>
      </view>
      <view class="step6-submit-btn" @tap="submitQuestionnaire">
        <text class="step6-submit-text">提交问卷</text>
      </view>
    </view>
    <template v-else>
      <view v-if="currentStep > 1" class="left-btn-wrap">
        <view class="next-btn" @tap="goBacks">
          <uv-icon name="arrow-leftward" color="black" size="24"></uv-icon>
        </view>
      </view>
      <view class="next-btn-wrap">
        <view class="next-btn" @tap="goNext">
          <uv-icon name="arrow-rightward" color="#fff" size="24"></uv-icon>
        </view>
      </view>
    </template>

  </view>
</template>

<style lang="scss" scoped>
.page-wrap {
  min-height: 100vh;
  background-color: #f5f0ee;
  display: flex;
  flex-direction: column;
  position: relative;
  box-sizing: border-box;
}

.nav-left {
  padding-left: 20rpx;
  .nav-btn {
    width: 64rpx;
    height: 64rpx;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.step-indicator {
  font-weight: 500;
}

/* ── 内容区 ── */
.content-wrap {
  flex: 1;
  padding: 30rpx 50rpx 300rpx;
  position: relative;
}

.step-content {
  .question-title {
    font-size: 44rpx;
    font-weight: bold;
    color: #1a1a1a;
    margin-bottom: 20rpx;
    line-height: 1.4;
  }

  .question-desc {
    font-size: 28rpx;
    color: #999;
    margin-bottom: 60rpx;
    line-height: 1.6;
  }
}

/* ── 滚轮卡片 ── */
.picker-card {
  background: #fff;
  border-radius: 32rpx;
  padding: 20rpx 30rpx;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);

  .picker-view {
    width: 100%;
    height: 440rpx;
  }

  .picker-item {
    height: 88rpx;
    display: flex;
    align-items: center;
    justify-content: center;

    .picker-text {
      font-size: 36rpx;
	  font-weight: 600;
      color: #333;
    }

    .picker-unit {
      font-size: 30rpx;
      color: #333;
    }
  }
}
/* ── Step3 日历 ── */
.calendar-card {
  background: #fff;
  border-radius: 32rpx;
  padding: 30rpx 24rpx 30rpx;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);

  // 月份 Tab
  .calendar-tabs {
    margin-bottom: 20rpx;
    border-bottom: 1rpx solid #f0f0f0;

    .calendar-tab {
      padding-bottom: 16rpx;
      .calendar-tab-text {
        font-size: 26rpx;
        color: #bbb;
      }
      &--active .calendar-tab-text {
        color: #ff3e7e;
        font-weight: bold;
        border-bottom: 4rpx solid #ff3e7e;
        padding-bottom: 12rpx;
        display: inline-block;
      }
    }
  }

  // 星期头
  .week-header {
    margin-bottom: 10rpx;
    .week-cell {
      flex: 1;
      .week-text {
        font-size: 24rpx;
        color: #999;
      }
    }
  }

  // 日期网格：7列
  .days-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0;

    .day-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 10rpx 0;
      min-height: 96rpx;

      .day-number {
        font-size: 28rpx;
        color: #333;
        margin-bottom: 6rpx;
        &--selected { color: #ff3e7e; }
        &--predicted { color: #ff3e7e; }
      }

      // 实心勾圆
      .day-check {
        width: 44rpx;
        height: 44rpx;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;

        &--solid {
          background: #ff3e7e;
          .check-icon { color: #fff; font-size: 24rpx; }
        }

        &--dashed {
          border: 2rpx dashed #ff3e7e;
          background: transparent;
          position: relative;
          .check-icon--dashed {
			
            color: #ff3e7e;
            font-size: 22rpx;
            position: relative;
            z-index: 1;
          }
        }

        &--empty {
          border: 2rpx solid #e0e0e0;
          background: transparent;
        }
      }
    }
  }

  .calendar-tip {
    padding-top: 10rpx;
    border-top: 1rpx solid #f5f5f5;
  }
}

/* ── Step5 规律单选卡片 ── */
.regularity-card {
  background: #fff;
  border-radius: 32rpx;
  padding: 0 40rpx;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);
  overflow: hidden;

  .regularity-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 40rpx 0;
    border-bottom: 1rpx solid #f0f0f0;

    &--last {
      border-bottom: none;
    }

    .regularity-left {
      flex: 1;
      padding-right: 30rpx;

      .regularity-label {
        font-size: 32rpx;
        font-weight: 600;
        color: #1a1a1a;
        margin-bottom: 10rpx;
      }

      .regularity-desc {
        font-size: 26rpx;
        color: #999;
        line-height: 1.6;
      }
    }

    .regularity-radio {
      flex-shrink: 0;

      // 选中态
      .radio--active {
        width: 30rpx;
        height: 30rpx;
        border-radius: 50%;
        border: 4rpx solid #ff3e7e;
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;

        .radio-inner {
          width: 18rpx;
          height: 18rpx;
          border-radius: 50%;
          background: #ff3e7e;
        }
      }

      // 未选中态
      .radio--normal {
        width: 30rpx;
        height: 30rpx;
        border-radius: 50%;
        border: 3rpx solid #d0d0d0;
        background: #fff;
      }
    }
  }
}

.left-btn-wrap {
  position: fixed;
  left: 50rpx;
  bottom: 70rpx;

  .next-btn {
    width: 110rpx;
    height: 110rpx;
    border-radius: 20rpx;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8rpx 24rpx white;

    &:active {
      opacity: 0.85;
      transform: scale(0.95);
    }
  }
}
/* ── 右下角按钮 ── */
.next-btn-wrap {
  position: fixed;
  right: 50rpx;
  bottom: 70rpx;

  .next-btn {
    width: 110rpx;
    height: 110rpx;
    border-radius: 20rpx;
    background: linear-gradient(135deg, #ff6eb4, #ff2d6e);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8rpx 24rpx rgba(255, 60, 120, 0.4);

    &:active {
      opacity: 0.85;
      transform: scale(0.95);
    }
  }
}

/* ── Step6 内容留底部空间给固定栏 ──
.step-content--step6 {
  padding-bottom: 160rpx;
}
*/
/* ── Step6：标题固定，仅选项滚动 ── */
.step-content--step6 {
  position: absolute;
  top: 30rpx;
  right: 50rpx;
  bottom: 220rpx;
  left: 50rpx;
  display: flex;
  flex-direction: column;
}
/* ── Step6 健康情况多选卡片 ── */
.condition-card {
  flex: 1;
  min-height: 0;
  background: #fff;
  border-radius: 32rpx;
  padding: 0 40rpx;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);
  box-sizing: border-box;

  .condition-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 40rpx 0;
    border-bottom: 1rpx solid #f0f0f0;

    &--last {
      border-bottom: none;
    }

    .condition-label {
      font-size: 32rpx;
      color: #1a1a1a;
      flex: 1;
      padding-right: 30rpx;
    }

    .condition-radio {
      flex-shrink: 0;

      .radio--active {
        width: 44rpx;
        height: 44rpx;
        border-radius: 50%;
        border: 4rpx solid #ff3e7e;
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;

        .radio-inner {
          width: 22rpx;
          height: 22rpx;
          border-radius: 50%;
          background: #ff3e7e;
        }
      }

      .radio--normal {
        width: 44rpx;
        height: 44rpx;
        border-radius: 50%;
        border: 3rpx solid #d0d0d0;
        background: #fff;
      }
    }
  }
}

/* ── Step6 底部提交栏 ── */
.bottom-bar-step6 {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24rpx 40rpx 60rpx;
  background: #f5f0ee;
  display: flex;
  align-items: center;
  gap: 24rpx;

  .step6-back-btn {
    width: 110rpx;
    height: 100rpx;
    border-radius: 20rpx;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);

    &:active {
      opacity: 0.8;
    }
  }

  .step6-submit-btn {
    flex: 1;
    height: 100rpx;
    border-radius: 50rpx;
    background: linear-gradient(135deg, #ff6eb4, #ff2d6e);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8rpx 24rpx rgba(255, 60, 120, 0.35);

    &:active {
      opacity: 0.85;
    }

    .step6-submit-text {
      font-size: 36rpx;
      color: #fff;
      font-weight: 500;
      letter-spacing: 4rpx;
    }
  }
}
</style>
