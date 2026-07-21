<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { onLoad, onPageScroll, onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { pressureOption, calorieOption, categoryOption, actIntensityOption, activePieOption, todayOption, lastDayOption } from '@/homeDetail/exercise/echartOptions';
import ActivityScoreCard from '@/homeDetail/exercise/components/ActivityScoreCard.vue';
import CalorieCard from '@/homeDetail/exercise/components/CalorieCard.vue';
import StandTimeCard from '@/homeDetail/exercise/components/StandTimeCard.vue';
import ActivityIntensityCard from '@/homeDetail/exercise/components/ActivityIntensityCard.vue';
import ActivitySummaryCard from '@/homeDetail/exercise/components/ActivitySummaryCard.vue';
import { getDateInfo, getYesterday, getBeforeYesterday, formatLocalDate } from '@/utils/utils.js';
import { getMotionOverview, getMotionCalorie, getMotionIntensity, getMotionSummary } from '@/common/api/homeDetail';
import type { motionOverview, motionCalorie, motionIntensity, motionSummary } from '@/types/api/homeDetail';
import DetailInfo from '@/components/DetailInfo.vue';
import {usePopupFixer} from '@/hooks/usePopupFixer'
import { useRingBusinessHistoryPageSync } from '@/composables/useRingBusinessHistoryPageSync';

const scrollTop = ref<number>(0);

const { isPopupActive, fixedPageStyle } = usePopupFixer()
const ringBleBridge = useRingBusinessHistoryPageSync();

const listData = ref<string[]>(['valueFirst', 'valueSecound', 'valueThird', 'valueFourth', 'valueFifth']);
const visibleCards = ref<string[]>([]);
const cardForm = ref({});

const calendar = ref<any>(null);

const today = ref(new Date());
const yesterday = ref(getYesterday(today.value));
const beforeYesterday = ref(getBeforeYesterday(today.value));

// 修改选择的日期信息结构，添加monthDay字段
const selectedDateInfo = ref({
  year: today.value.getFullYear().toString(),
  monthDay: `${(today.value.getMonth() + 1).toString().padStart(2, '0')}-${today.value.getDate().toString().padStart(2, '0')}`
});

// 计算日期信息（星期+日）
const yesterdayInfo = ref(getDateInfo(yesterday.value));
const beforeYesterdayInfo = ref(getDateInfo(beforeYesterday.value));

// 添加是否已选择日期的状态
const hasSelectedDate = ref(false);

// 日期列表数据
const dateList = ref([
  { date: beforeYesterday.value, info: beforeYesterdayInfo.value, label: 'beforeYesterday' },
  { date: yesterday.value, info: yesterdayInfo.value, label: 'yesterday' },
  { date: today.value, info: { week: '今天', day: '' }, label: 'today' }
]);

// 当前选中的日期索引（0:前天，1:昨天，2:今天）
const selectedDayIndex = ref(2);
const queryActivityPage = <T>(endpoint: string, currentDate: Date, query: () => Promise<T>) =>
  ringBleBridge.queryHistoryPage({
    page: 'exercise',
    date: formatLocalDate(currentDate),
    endpoint,
    query
  });

const motionOverviewObj = ref<motionOverview>();
const motionCalorieObj = ref<motionCalorie>();
const motionIntensityObj = ref<motionIntensity>();
const motionSummaryObj = ref<motionSummary>();

// 点击日期处理函数
const handleDateClick = async (index: number) => {
  selectedDayIndex.value = index;
  const currentDate = dateList.value[index].date;
  await getMotionOverviewData(currentDate);
  await getMotionCalorieData(currentDate);
  await getMotionIntensityData(currentDate);
  await getMotionSummaryData(currentDate);
};

const receiveCardConfig = (config: { listDatal: string[]; visibleCards: string[]; form: any }) => {
  listData.value = config.listDatal;
  visibleCards.value = config.visibleCards;
  cardForm.value = config.form;
};
// 获取活动概览数据
const getMotionOverviewData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await queryActivityPage('motion-overview', currentDate, (requestConfig) => getMotionOverview({ date: isoDate }, requestConfig));
  if (res) {
    motionOverviewObj.value = res;
  }
};
// 获取活动卡数据
const getMotionCalorieData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await queryActivityPage('motion-calorie', currentDate, (requestConfig) => getMotionCalorie({ date: isoDate }, requestConfig));
  if (res) {
    motionCalorieObj.value = res;
  }
};
// 获取活动强度数据
const getMotionIntensityData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await queryActivityPage('motion-intensity', currentDate, (requestConfig) => getMotionIntensity({ date: isoDate }, requestConfig));
  if (res) {
    motionIntensityObj.value = res;
  }
};
// 获取活动强度数据
const getMotionSummaryData = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await queryActivityPage('motion-summary', currentDate, (requestConfig) => getMotionSummary({ date: isoDate }, requestConfig));
  if (res) {
    motionSummaryObj.value = res;
  }
};
const openTimePicker = () => {
  calendar.value.open();
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
  await getMotionOverviewData(currentDate);
  await getMotionCalorieData(currentDate);
  await getMotionIntensityData(currentDate);
  await getMotionSummaryData(currentDate);
};
const jumpEdit = () => {
  (uni as any).$uv.route('/homeDetail/exerciseEdit/exerciseEdit', { cardForm: JSON.stringify(cardForm.value), visibleCards: JSON.stringify(visibleCards.value) });
};
const leftClick = (): void => {
  uni.navigateBack();
};
onLoad(async (options) => {
  const rawDayIndex = options?.selectedDayIndex;
  const parsedDayIndex = rawDayIndex !== undefined && rawDayIndex !== '' ? Number(rawDayIndex) : 2;
  const dayIndex = Number.isFinite(parsedDayIndex) ? parsedDayIndex : 2;
  selectedDayIndex.value = dayIndex;

  if (dayIndex !== 3) {
    await handleDateClick(selectedDayIndex.value);
  } else {
    if (options?.selectedDate) {
      const formattedDate = uni.$uv.timeFormat(options.selectedDate, 'yyyy-mm-dd');
      if (formattedDate && formattedDate !== 'NaN-NaN-NaN') {
        await confirm({ fulldate: formattedDate });
        return;
      }
    }
    selectedDayIndex.value = 2;
    await handleDateClick(2);
  }
});
// onShow(async () => {
//   await getMotionOverviewData();
//   await getMotionCalorieData();
//   await getMotionIntensityData();
//   await getMotionSummaryData();
// });

onPullDownRefresh(async () => {
  try {
    selectedDayIndex.value = 2;
    await getMotionOverviewData();
    await getMotionCalorieData();
    await getMotionIntensityData();
    await getMotionSummaryData();
  } catch (error) {
    uni.showToast({
      title: '刷新失败，请稍后再试',
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
</script>
<template>
  <page-meta :page-style="fixedPageStyle"></page-meta>

  <view class="relative p-30" style="box-sizing: border-box">
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="活动" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
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
      <ActivityScoreCard v-if="cardId === 'valueFirst'" :motionOverviewObj="motionOverviewObj" :motionSummaryObj="motionSummaryObj" />
      <CalorieCard v-else-if="cardId === 'valueSecound'" :motionCalorieObj="motionCalorieObj" >
        <DetailInfo id="daily_calories" v-model:isPopupActive="isPopupActive" style="margin-left: 4rpx;"></DetailInfo>
      </CalorieCard>
      <!-- <StandTimeCard v-else-if="cardId === 'valueThird'" /> -->
      <ActivityIntensityCard v-else-if="cardId === 'valueFourth'" :motionIntensityObj="motionIntensityObj" >
        <DetailInfo id="daily_activity_intensity" v-model:isPopupActive="isPopupActive" style="margin-left: 2rpx;"></DetailInfo>
      </ActivityIntensityCard>
      <ActivitySummaryCard v-else-if="cardId === 'valueFifth'" :motionSummaryObj="motionSummaryObj" >
        <DetailInfo id="activity" v-model:isPopupActive="isPopupActive" style="margin-left: 2rpx;"></DetailInfo>
      </ActivitySummaryCard>
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
  background: linear-gradient(to bottom, #ffe08a, #f1f3f6);
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
.itemBox {
  // width: 190rpx;
  box-sizing: border-box;
  border-radius: 50rpx;
  background: #f7f7f7;
}
.itemBottomBox {
  width: 100%;
  height: 160rpx;
  background: #f7f7f7;
}

.chartBox {
  flex: 1;
}

.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  margin-right: 8rpx;
}

.heat-dot {
  background-color: #ec4899; /* 粉色 - 活动热量 */
}

.steps-dot {
  background-color: #f97316; /* 橙色 - 活动步数 */
}

.time-dot {
  background-color: #3b82f6; /* 蓝色 - 活动时间 */
}

.base-dot {
  background-color: #ffc0cb; /* 浅粉色 */
}

.active-dot {
  background-color: #ff6b8b; /* 粉红色 */
}
</style>
