<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { onLoad, onPageScroll, onPullDownRefresh } from '@dcloudio/uni-app';
import { getDateInfo, getYesterday, getBeforeYesterday, formatLocalDate } from '@/utils/utils.js';
import relaxValue from '@/homeDetail/relaxStatus/components/relaxValue.vue';
import pressureRatio from '@/homeDetail/relaxStatus/components/pressureRatio.vue';
import stressSummary from '@/homeDetail/relaxStatus/components/stressSummary.vue';
import type { stressDetail, stressProportion, stressSummaryType } from '@/types/api/homeDetail';
import { getStressData, getStressProportion, getStressSummary } from '@/common/api/homeDetail';
import DetailInfo from '@/components/DetailInfo.vue';
import { usePopupFixer } from '@/hooks/usePopupFixer';
import { useRingBusinessHistoryPageSync } from '@/composables/useRingBusinessHistoryPageSync';

const { isPopupActive, fixedPageStyle } = usePopupFixer();
const ringBleBridge = useRingBusinessHistoryPageSync();

const scrollTop = ref<number>(0);
const listData = ref<string[]>(['valueFirst', 'valueSecound', 'valueThird']);
const visibleCards = ref<string[]>([]);
const cardForm = ref({});
const calendar = ref<any>(null);

const stressDetailObj = ref<stressDetail>();
const stressProportionObj = ref<stressProportion>();
const stressSummaryObj = ref<stressSummaryType>();

const selectedDayIndex = ref(2);
const hasSelectedDate = ref(false);

const today = ref(new Date());
const yesterday = ref(getYesterday(today.value));
const beforeYesterday = ref(getBeforeYesterday(today.value));
const yesterdayInfo = ref(getDateInfo(yesterday.value));
const beforeYesterdayInfo = ref(getDateInfo(beforeYesterday.value));

const dateList = ref([
  { date: beforeYesterday.value, info: beforeYesterdayInfo.value, label: 'beforeYesterday' },
  { date: yesterday.value, info: yesterdayInfo.value, label: 'yesterday' },
  { date: today.value, info: { week: '今天', day: '' }, label: 'today' }
]);

const selectedDateInfo = ref({
  year: today.value.getFullYear().toString(),
  monthDay: `${(today.value.getMonth() + 1).toString().padStart(2, '0')}-${today.value.getDate().toString().padStart(2, '0')}`
});

const queryStressPage = <T>(endpoint: string, currentDate: Date, query: () => Promise<T>) =>
  ringBleBridge.queryHistoryPage({
    page: 'relaxStatus',
    date: formatLocalDate(currentDate),
    endpoint,
    query
  });

const receiveCardConfig = (config: { listDatal: string[]; visibleCards: string[]; form: any }) => {
  listData.value = config.listDatal;
  visibleCards.value = config.visibleCards;
  cardForm.value = config.form;
};

const getStressDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  let offset = 0;
  if (selectedDayIndex.value === 3) {
    const todayDate = new Date();
    const diffTime = todayDate.getTime() - currentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    offset = -diffDays;
  } else {
    offset = selectedDayIndex.value - 2;
  }

  const res = await queryStressPage('stress-data', currentDate, (requestConfig) =>
    getStressData({
      date: isoDate,
      type: 'day',
      offset
    }, requestConfig)
  );
  if (res) {
    stressDetailObj.value = res;
  }
};

const getStressProportionDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await queryStressPage('stress-proportion', currentDate, (requestConfig) => getStressProportion({ date: isoDate }, requestConfig));
  if (res) {
    stressProportionObj.value = res;
  }
};

const getStressSummaryDetail = async (currentDate = new Date()) => {
  const isoDate = formatLocalDate(currentDate);
  const res = await queryStressPage('stress-summary', currentDate, (requestConfig) => getStressSummary({ date: isoDate }, requestConfig));
  if (res) {
    stressSummaryObj.value = res;
  }
};

const handleDateClick = async (index: number) => {
  selectedDayIndex.value = index;
  const currentDate = dateList.value[index].date;
  await getStressDetail(currentDate);
  await getStressProportionDetail(currentDate);
  await getStressSummaryDetail(currentDate);
};

const openTimePicker = () => {
  calendar.value?.open?.();
};

const confirm = async (date: any) => {
  const selectedDate = new Date(date.fulldate);
  const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
  const day = selectedDate.getDate().toString().padStart(2, '0');

  selectedDateInfo.value = {
    year: selectedDate.getFullYear().toString(),
    monthDay: `${month}-${day}`
  };

  hasSelectedDate.value = true;
  selectedDayIndex.value = 3;
  await getStressDetail(selectedDate);
  await getStressProportionDetail(selectedDate);
  await getStressSummaryDetail(selectedDate);
};

const jumpEdit = () => {
  (uni as any).$uv.route('/homeDetail/relaxEdit/relaxEdit', {
    cardForm: JSON.stringify(cardForm.value),
    visibleCards: JSON.stringify(visibleCards.value)
  });
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
    return;
  }

  if (options?.selectedDate) {
    const formattedDate = uni.$uv.timeFormat(options.selectedDate, 'yyyy-mm-dd');
    if (formattedDate && formattedDate !== 'NaN-NaN-NaN') {
      await confirm({ fulldate: formattedDate });
      return;
    }
  }

  selectedDayIndex.value = 2;
  await handleDateClick(2);
});

onPullDownRefresh(async () => {
  try {
    selectedDayIndex.value = 2;
    await getStressDetail();
    await getStressProportionDetail();
    await getStressSummaryDetail();
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
    <uv-navbar @leftClick="leftClick" placeholder leftIcon="arrow-left" title="放松状态" :bgColor="scrollTop > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0)'"></uv-navbar>
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
      <relaxValue v-if="cardId === 'valueFirst'" :stressDetail="stressDetailObj" >
        <DetailInfo id="stress" size="small" v-model:isPopupActive="isPopupActive" style="margin-left: 14rpx;"></DetailInfo>
      </relaxValue>
      <pressureRatio v-else-if="cardId === 'valueSecound'" :stressProportion="stressProportionObj" />
      <stressSummary v-else-if="cardId === 'valueThird'" :stressSummaryObj="stressSummaryObj" />
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
  background: linear-gradient(to bottom, #7fedce, #f1f3f6);
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
</style>
