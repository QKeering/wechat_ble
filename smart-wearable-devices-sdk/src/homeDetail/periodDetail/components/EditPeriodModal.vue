<template>
  <uv-popup ref="popup1" v-model:show="visible" mode="bottom" :close-on-click-modal="true" @close="onClose">
    <view class="edit-period-modal">
      <!-- 模态框头部 -->
      <view class="modal-header">
        <text class="modal-title">修正经期信息</text>
        <view class="modal-close" @tap="onClose">
          <uv-icon name="close" size="24" color="#909399" />
        </view>
      </view>

      <!-- 经期开始日期 -->
      <view class="modal-section">
        <view class="section-label">
          <text class="label-text">经期开始日期</text>
		   <text class="date-value" style="float: right;">{{ displayStartDate }}</text>
        </view>
       <!-- <view class="date-display" @tap="onDatePick">
          <text class="date-value">{{ displayStartDate }}</text>
          <uv-icon name="arrow-right" size="20" color="#c0c4cc" />
        </view> -->
      </view>

      <!-- 日历选择器 -->
      <view class="calendar-section">
        <view class="calendar-header">
          <view class="calendar-nav" @tap="prevMonth">
            <uv-icon name="arrow-left" size="20" color="#ff4081" />
          </view>
          <text class="calendar-title">{{ calendarTitle }}</text>
          <view class="calendar-nav" @tap="nextMonth">
            <uv-icon name="arrow-right" size="20" color="#ff4081" />
          </view>
        </view>
        
        <!-- 星期标题 -->
        <view class="calendar-weekdays">
          <view v-for="day in weekDays" :key="day" class="weekday-cell">
            <text class="weekday-text">{{ day }}</text>
          </view>
        </view>

        <!-- 日期网格 -->
        <view class="calendar-days">
          <view
            v-for="(cell, index) in calendarDays"
            :key="index"
            class="day-cell"
            :class="{
              'day-cell--other-month': cell.isOtherMonth,
              'day-cell--selected': isSelectedDate(cell.date),
              'day-cell--in-range': isInRange(cell.date)
            }"
            @tap="onDayTap(cell)"
          >
            <text
              class="day-text"
              :class="{
                'day-text--selected': isSelectedDate(cell.date),
                'day-text--in-range': isInRange(cell.date)
              }"
            >
              {{ cell.day }}
            </text>
          </view>
        </view>
      </view>

      <!-- 周期天数 -->
      <view class="modal-section">
        <view class="section-label">
          <text class="label-text">周期天数</text>
        </view>
        <view class="counter-row">
          <view class="counter-btn" @tap="decreaseCycleDays">
            <uv-icon name="minus" size="20" color="#ff4081" />
          </view>
          <input
            class="counter-input"
            type="number"
            :value="formData.cycleDays"
            @input="onCycleDaysInput"
            placeholder="28"
          />
          <view class="counter-btn" @tap="increaseCycleDays">
            <uv-icon name="plus" size="20" color="#ff4081" />
          </view>
          <view class="counter-hint">
            <text class="hint-text">正常范围：21-35 天</text>
          </view>
        </view>
      </view>

      <!-- 经期天数 -->
      <view class="modal-section">
        <view class="section-label">
          <text class="label-text">经期天数</text>
        </view>
        <view class="counter-row">
          <view class="counter-btn" @tap="decreasePeriodDays">
            <uv-icon name="minus" size="20" color="#ff4081" />
          </view>
          <input
            class="counter-input"
            type="number"
            :value="formData.periodDays"
            @input="onPeriodDaysInput"
            placeholder="5"
          />
          <view class="counter-btn" @tap="increasePeriodDays">
            <uv-icon name="plus" size="20" color="#ff4081" />
          </view>
          <view class="counter-hint">
            <text class="hint-text">正常范围：3-7 天</text>
          </view>
        </view>
      </view>

      <!-- 底部按钮 -->
      <view class="modal-footer">
		  <button class="footer-btn footer-btn--save" @tap="onSave">
		    <uv-icon name="checkmark" size="20" color="#ffffff" />
		    <text class="save-text">保存修改</text>
		  </button>
        <button class="footer-btn footer-btn--cancel" @tap="onCancel">取消</button>
       
      </view>
    </view>
  </uv-popup>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

// 星期标题
const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

// 弹窗显示状态
const visible = ref(false);
const popup1=ref()
// 表单数据
const formData = ref({
  startDate: '',
  cycleDays: 28,
  periodDays: 5,
  id:0
});

// 当前日历显示的月份
const currentYear = ref(new Date().getFullYear());
const currentMonth = ref(new Date().getMonth());

// 打开弹窗
const openModal = (data?: { startDate: string; cycleDays: number; periodDays: number;id:number }) => {
  if (data) {
    formData.value = { ...data };
  }
  // 根据开始日期设置日历
  if (data?.startDate) {
    const date = new Date(data.startDate);
    currentYear.value = date.getFullYear();
    currentMonth.value = date.getMonth();
  }
  
  popup1.value?.open();
};

// 关闭弹窗
const onClose = () => {
   popup1.value?.close();
};

// 取消
const onCancel = () => {
  onClose();
};

// 保存
const emit = defineEmits<{
  (e: 'save', data: { startDate: string; cycleDays: number; periodDays: number;id:number }): void;
}>();

const onSave = () => {
  // 验证数据
  if (!formData.value.startDate) {
    uni.showToast({
      title: '请选择开始日期',
      icon: 'none'
    });
    return;
  }
  if(!formData.value.cycleDays){
	  uni.showToast({
	    title: '请选择周期天数',
	    icon: 'none'
	  });
	  return;
  }
  if(!formData.value.periodDays){
	  uni.showToast({
	    title: '请选择经期天数',
	    icon: 'none'
	  });
	  return;
  } 
  // if (formData.value.cycleDays < 21 || formData.value.cycleDays > 35) {
  //   uni.showToast({
  //     title: '周期天数应在 21-35 天之间',
  //     icon: 'none'
  //   });
  //   return;
  // }
  
  // if (formData.value.periodDays < 3 || formData.value.periodDays > 7) {
  //   uni.showToast({
  //     title: '经期天数应在 3-7 天之间',
  //     icon: 'none'
  //   });
  //   return;
  // }
  
  emit('save', {
	  ...formData.value
  });
  onClose();
};

// 显示的开始日期
const displayStartDate = computed(() => {
  if (!formData.value.startDate) {
    return '请选择日期';
  }
  const date = new Date(formData.value.startDate);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}年${month}月${day}日`;
});

// 日历标题
const calendarTitle = computed(() => {
  return `${currentYear.value}年${currentMonth.value + 1}月`;
});

// 生成日历数据
const calendarDays = computed(() => {
  const year = currentYear.value;
  const month = currentMonth.value;
  
  // 当月第一天
  const firstDay = new Date(year, month, 1);
  // 当月最后一天
  const lastDay = new Date(year, month + 1, 0);
  // 当月第一天是星期几
  const startWeekday = firstDay.getDay();
  // 当月总天数
  const totalDays = lastDay.getDate();
  
  const days: Array<{
    date: Date;
    day: number;
    isOtherMonth: boolean;
    ymd: string;
  }> = [];
  
  // 上个月的日期
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = prevMonthLastDay - i;
    const date = new Date(year, month - 1, day);
    days.push({
      date,
      day,
      isOtherMonth: true,
      ymd: formatDateYmd(date)
    });
  }
  
  // 当月的日期
  for (let i = 1; i <= totalDays; i++) {
    const date = new Date(year, month, i);
    days.push({
      date,
      day: i,
      isOtherMonth: false,
      ymd: formatDateYmd(date)
    });
  }
  
  // 下个月的日期（补齐 42 格）
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    const date = new Date(year, month + 1, i);
    days.push({
      date,
      day: i,
      isOtherMonth: true,
      ymd: formatDateYmd(date)
    });
  }
  
  return days;
});

// 格式化日期为 yyyy-MM-dd
function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 判断是否是选中的日期
const isSelectedDate = (date: Date) => {
  if (!formData.value.startDate) return false;
  const selectedDate = new Date(formData.value.startDate);
  return (
    date.getFullYear() === selectedDate.getFullYear() &&
    date.getMonth() === selectedDate.getMonth() &&
    date.getDate() === selectedDate.getDate()
  );
};

// 判断是否在经期内
const isInRange = (date: Date) => {
  if (!formData.value.startDate) return false;
  const startDate = new Date(formData.value.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + formData.value.periodDays - 1);
  
  return date >= startDate && date <= endDate;
};

// 点击日期
const onDayTap = (cell: { date: Date; ymd: string }) => {
  formData.value.startDate = cell.ymd;
};

// 上个月
const prevMonth = () => {
  currentMonth.value--;
  if (currentMonth.value < 0) {
    currentMonth.value = 11;
    currentYear.value--;
  }
};

// 下个月
const nextMonth = () => {
  currentMonth.value++;
  if (currentMonth.value > 11) {
    currentMonth.value = 0;
    currentYear.value++;
  }
};

// 点击日期选择器
// const onDatePick = () => {
//   // 可以在这里打开 uni-app 的日期选择器
//   uni.showDatePicker({
//     value: formData.value.startDate || new Date(),
//     mode: 'date',
//     success: (res) => {
//       formData.value.startDate = formatDateYmd(new Date(res.value));
//     }
//   });
// };

// 周期天数输入
const onCycleDaysInput = (e: any) => {
  const val = parseInt(e.detail.value) || 28;
  formData.value.cycleDays = Math.max(1, Math.min(99, val));
};

// 经期天数输入
const onPeriodDaysInput = (e: any) => {
  const val = parseInt(e.detail.value) || 5;
  formData.value.periodDays = Math.max(1, Math.min(99, val));
};

// 减少周期天数
const decreaseCycleDays = () => {
  formData.value.cycleDays = Math.max(1, formData.value.cycleDays - 1);
};

// 增加周期天数
const increaseCycleDays = () => {
  formData.value.cycleDays = Math.min(99, formData.value.cycleDays + 1);
};

// 减少经期天数
const decreasePeriodDays = () => {
  formData.value.periodDays = Math.max(1, formData.value.periodDays - 1);
};

// 增加经期天数
const increasePeriodDays = () => {
  formData.value.periodDays = Math.min(99, formData.value.periodDays + 1);
};

// 暴露方法给父组件
defineExpose({
  openModal
});
</script>

<style scoped lang="scss">
.edit-period-modal {
  background: #ffffff;
  border-radius: 20rpx;
  padding: 28rpx 24rpx;
  box-sizing: border-box;
  max-height: 75vh;
  overflow-y: hidden;
}

/* 头部 */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}

.modal-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #303133;
}

.modal-close {
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f5f6f7;
}

/* 区块 */
.modal-section {
  margin-bottom: 24rpx;
}

.section-label {
  margin-bottom: 12rpx;
}

.label-text {
  font-size: 24rpx;
  color: #606266;
  font-weight: 500;
}

/* 日期显示 */
.date-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 20rpx;
  background: #f5f6f7;
  border-radius: 12rpx;
  
  .date-value {
    font-size: 26rpx;
    color: #303133;
    font-weight: 500;
  }
}

/* 日历区域 */
.calendar-section {
  background: #fafafa;
  border-radius: 12rpx;
  padding: 16rpx;
  margin-bottom: 24rpx;
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.calendar-nav {
  width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffe4ec;
  border-radius: 50%;
}

.calendar-title {
  font-size: 26rpx;
  font-weight: 600;
  color: #303133;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 10rpx;
}

.weekday-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8rpx 0;
}

.weekday-text {
  font-size: 20rpx;
  color: #909399;
}

.calendar-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8rpx;
}

.day-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  position: relative;
  
  &--other-month {
    opacity: 0.3;
  }
  
  &--selected {
    background: #ff4081;
    
    .day-text {
      color: #ffffff;
      font-weight: 600;
    }
  }
  
  &--in-range {
    background: #ffe4ec;
    
    .day-text {
      color: #ff4081;
      font-weight: 600;
    }
  }
}

.day-text {
  font-size: 24rpx;
  color: #303133;
  
  &--selected {
    color: #ffffff;
  }
  
  &--in-range {
    color: #ff4081;
  }
}

/* 计数器行 */
.counter-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.counter-btn {
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffe4ec;
  border-radius: 50%;
  flex-shrink: 0;
}

.counter-input {
  flex: 1;
  height: 52rpx;
  background: #f5f6f7;
  border-radius: 12rpx;
  padding: 0 16rpx;
  font-size: 26rpx;
  color: #303133;
  font-weight: 600;
  text-align: center;
}

.counter-hint {
  flex: 1.5;
  
  .hint-text {
    font-size: 20rpx;
    color: #909399;
  }
}

/* 底部按钮 */
.modal-footer {
  display: flex;
  gap: 16rpx;
  margin-top: 28rpx;
}

.footer-btn {
  flex: 1;
  height: 72rpx;
  border-radius: 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  font-size: 26rpx;
  font-weight: 600;
  border: none;
  
  &--cancel {
    background: #f5f6f7;
    color: #606266;
  }
  
  &--save {
    background: linear-gradient(90deg, #ff4081, #ff6b9a);
    color: #ffffff;
    
    .save-text {
      color: #ffffff;
    }
  }
}

.footer-btn--cancel::after,
.footer-btn--save::after {
  border: none;
}

</style>
