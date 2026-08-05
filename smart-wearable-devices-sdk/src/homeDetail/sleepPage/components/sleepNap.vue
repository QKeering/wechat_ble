<script setup lang="ts">
import { ref, computed, type PropType } from 'vue';
import { onLoad, onPageScroll, onShow } from '@dcloudio/uni-app';
import type { sleepNapType } from '@/types/api/homeDetail';
import { addSleepNap, deleteSleepNap } from '@/common/api/homeDetail';
import { formatLocalDate } from '@/utils/utils.js';
const popup = ref<any>(null);
const datetimePicker = ref<any>(null);
const datetimePickerS = ref<any>(null);

// 时间绑定值（格式：HH:mm）
const startTime = ref('');
const endTime = ref('');

type selectDate = {
  mode: string;
  value: string;
};
const emit = defineEmits(['refresh']);
// 小睡列表
const props = defineProps({
  sleepNapList: {
    type: Array as () => sleepNapType[],
    default: () => []
  },
  currentDate: {
    type: [String, Number, Date] as PropType<string | number | Date>,
    default: () => new Date()
  }
});
const formatTime = (isoTime: string = '') => {
  if (!isoTime) return '';
  const date = new Date(isoTime);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const getPickerTimeValue = (payload: selectDate | string | any) => String(payload?.value ?? payload ?? '').trim();

const getTimeMinutes = (timeValue: string) => {
  const [hours, minutes] = timeValue.split(':').map((item) => Number(item));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
  return hours * 60 + minutes;
};

const isValidNapRange = (startValue = startTime.value, endValue = endTime.value) => {
  const start = getTimeMinutes(startValue);
  const end = getTimeMinutes(endValue);
  return Number.isFinite(start) && Number.isFinite(end) && start < end;
};

const getNapDateValue = () => {
  if (props.currentDate instanceof Date && !Number.isNaN(props.currentDate.getTime())) {
    return props.currentDate;
  }
  const date = new Date(props.currentDate);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const addNapConfirm = async () => {
  const napDate = getNapDateValue();
  const isoDate = formatLocalDate(napDate);
  uni.showLoading({ title: '添加中...' });
  try {
    const res = await addSleepNap({ date: isoDate, startTime: startTime.value, endTime: endTime.value });
    if (res) {
      (uni as any).$uv.toast('添加成功');
      emit('refresh', napDate);
      return true;
    }
  } finally {
    uni.hideLoading();
  }
  return false;
};
const deleteSleepNapConfirm = async (id?: number) => {
  if (!id) return;
  uni.showLoading({ title: '删除中...' });
  const res = await deleteSleepNap({ id });
  if (res) {
    (uni as any).$uv.toast('删除成功');
    emit('refresh');
  }
  uni.hideLoading();
};
// 计算小睡时长小时数（不足2位补0）
const getSleepDurationHours = (time: number = 0) => {
  if (!time || time <= 0) return '00';
  const hours = Math.floor(time / 60);
  return hours.toString().padStart(2, '0');
};
// 计算小睡时长分钟数（不足2位补0）
const getSleepDurationMinutes = (time: number = 0) => {
  if (!time || time <= 0) return '00';
  const minutes = time % 60;
  return minutes.toString().padStart(2, '0');
};
// 开始时间最大分钟（仅当小时=10时，分钟上限44；否则59）
const startMaxMinute = computed(() => {
  return 59;
});
// 获取当前日期格式化显示
const getCurrentDate = () => {
  const now = getNapDateValue();
  const month = now.getMonth() + 1; // 月份从0开始，需要+1
  const day = now.getDate();
  return `${month}月${day}日`;
};

// 开始时间变更时，同步限制结束时间（避免结束时间早于开始时间）
const handleStartChange = (_newTime: unknown) => {};

const openDatetimePicker = (type: 'start' | 'end') => {
  const picker = type === 'start' ? datetimePicker.value : datetimePickerS.value;
  picker?.open?.();
};

// 确认开始时间
const handleStartConfirm = (time: selectDate) => {
  const nextStartTime = getPickerTimeValue(time);
  // 如果已经有结束时间，验证开始时间是否早于结束时间
  if (endTime.value && nextStartTime) {
    if (!isValidNapRange(nextStartTime, endTime.value)) {
      (uni as any).$uv.toast('开始时间必须早于结束时间');
      return false; // 阻止确认
    }
  }
  startTime.value = nextStartTime;
  return true;
};

// 确认结束时间
const handleEndConfirm = (time: selectDate) => {
  const nextEndTime = getPickerTimeValue(time);
  if (startTime.value && nextEndTime) {
    if (!isValidNapRange(startTime.value, nextEndTime)) {
      (uni as any).$uv.toast('结束时间必须晚于开始时间');
      return false; // 阻止确认
    }
  }

  endTime.value = nextEndTime;
  return true;
};

// 取消操作（根据实际需求实现关闭弹窗逻辑）
const cancel = () => {
  popup.value.close();
};
const addNap = async () => {
  if (!startTime.value || !endTime.value) {
    (uni as any).$uv.toast('请选择开始时间和结束时间');
    return;
  }
  if (!isValidNapRange()) {
    (uni as any).$uv.toast('结束时间必须晚于开始时间');
    return;
  }
  const added = await addNapConfirm();
  if (added) {
    popup.value.close();
    startTime.value = '';
    endTime.value = '';
  }
};
const openPopup = () => {
  popup.value.open();
};
onLoad(() => {});
</script>
<template>
  <view class="bg-white r-50 mb-30 p-30 wrapper">
    <view class="flex jc-between ai-center">
      <view class="">
        <text class="fs-36">小睡</text>
        <slot></slot>
      </view>
    </view>
    <view class="pl-40 pr-40 mt-30">
      <view v-if="sleepNapList.length > 0">
        <view v-for="item in sleepNapList" :key="item.id" class="p-40 r-50 flex jc-between ai-center mb-10" style="background-color: #f7f7f7">
          <view>
            <text v-if="getSleepDurationHours(item.sleepTime) !== '00'" class="fs-48">{{ getSleepDurationHours(item.sleepTime) }}</text>
            <text v-if="getSleepDurationHours(item.sleepTime) !== '00'" class="fs-24">小时</text>
            <text class="fs-48">{{ getSleepDurationMinutes(item.sleepTime) }}</text>
            <text class="fs-24">分钟</text>
            <text class="ml-20 fs-24">{{ formatTime(item.startTime) }}</text>
            <text class="fs-24" v-if="item.endTime">-</text>
            <text class="fs-24">{{ formatTime(item.endTime) }}</text>
          </view>
          <view @tap="deleteSleepNapConfirm(item.id)">
            <view class="nap-delete">×</view>
          </view>
        </view>
      </view>
      <view v-else class="flex jc-center">
        <image class="nap-empty-icon" src="/static/images/homeDetail/sleepNapEmpty.png" mode="aspectFit" lazy-load />
      </view>
    </view>
    <view class="flex jc-center mt-50" @tap="openPopup">
      <view class="boxStyle flex jc-between ai-center p-20">
        <view class="nap-add">+</view>
        <text class="fs-28" style="color: #5f57ec">新增小睡</text>
      </view>
    </view>
    <uv-popup ref="popup" round="50rpx" custom-style="padding: 30rpx;">
      <view class="popupCard">
        <view class="ta-c fs-36">新增小睡</view>
        <view class="ta-c fs-28 t-979797 mt-20">可编辑时间区间</view>
        <view class="ta-c fs-28 mt-10">
          <text>{{ getCurrentDate() }}</text>
          <text class="ml-10">00:00-23:59</text>
        </view>
        <view class="flex jc-between mt-50">
          <view @tap="openDatetimePicker('start')" class="r-50 pt-40 pb-40 w-full mr-30 flex jc-center ai-center t-979797" style="background-color: #f7f7f7">
            {{ startTime ? startTime : '开始时间' }}
            <uv-datetime-picker ref="datetimePicker" mode="time" v-model="startTime" :maxMinute="startMaxMinute" @confirm="handleStartConfirm" @change="handleStartChange" />
          </view>
          <view @tap="openDatetimePicker('end')" class="r-50 pt-40 pb-40 w-full flex jc-center ai-center t-979797" style="background-color: #f7f7f7">
            {{ endTime ? endTime : '结束时间' }}
            <uv-datetime-picker ref="datetimePickerS" mode="time" v-model="endTime" @confirm="handleEndConfirm" />
          </view>
        </view>
        <view class="flex jc-between mt-100">
          <view @tap="cancel" class="r-50 pt-40 pb-40 w-full mr-30 flex jc-center ai-center" style="background-color: #efeefd; color: #5f57ec">取消</view>
          <view @tap="addNap" class="r-50 pt-40 pb-40 w-full flex jc-center ai-center t-white" style="background-color: #5f57ec">新增小睡</view>
        </view>
      </view>
    </uv-popup>
  </view>
</template>

<style lang="scss" scoped>
.wrapper {
  box-sizing: border-box !important;
}
.boxStyle {
  width: 206rpx;
  height: 74rpx;
  border-radius: 28rpx;
  background: #efeefd;
  box-sizing: border-box;
}

.nap-delete,
.nap-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  font-size: 34rpx;
  line-height: 44rpx;
}

.nap-delete {
  background: #f1f1f5;
  color: #9ca3af;
}

.nap-add {
  background: #5f57ec;
  color: #ffffff;
}

.nap-empty-icon {
  width: 116rpx;
  height: 116rpx;
  display: block;
}

.popupCard {
  box-sizing: border-box;
  width: 75vw;
}
</style>
