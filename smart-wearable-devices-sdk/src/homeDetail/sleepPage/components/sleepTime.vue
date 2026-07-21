<script setup lang="ts">
import { computed, ref, getCurrentInstance } from 'vue';
import type { sleepDetail, sleepSegment, Point } from '@/types/api/homeDetail';

const props = defineProps({
  sleepDetailObj: {
    type: Object as () => sleepDetail,
    default: () => ({})
  },
  sleepSegmentObj: {
    type: Object as () => sleepSegment,
    default: () => ({})
  }
});

// ===== 睡眠时长展示 =====
const sleepDurationHours = computed(() => {
  if (!props.sleepDetailObj?.sleepDuration) return 0;
  return Math.floor(props.sleepDetailObj.sleepDuration / 60);
});
const sleepDurationMinutes = computed(() => {
  if (!props.sleepDetailObj?.sleepDuration) return 0;
  return props.sleepDetailObj.sleepDuration % 60;
});
const formattedMinutes = computed(() => sleepDurationMinutes.value.toString().padStart(2, '0'));

// ===== 阶段配置 =====
const STAGE_CONFIG: Record<string, { level: number; color: string }> = {
  清醒: { level: 0, color: '#feba8a' },
  快速眼动: { level: 1, color: '#baacfb' },
  浅睡: { level: 2, color: '#8c65f6' },
  深睡: { level: 3, color: '#4b13be' }
};

// ===== 时间工具 =====
const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const seconds = parseInt(parts[2], 10) || 0;
  return hours * 60 + minutes + Math.floor(seconds / 60);
};

const formatTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// ===== 从 chartDataSection 获取各阶段时长（分钟） =====
const getStageDuration = (stageName: string): number => {
  const chartDataSection = props.sleepSegmentObj?.chartDataSection;
  if (!chartDataSection || !Array.isArray(chartDataSection)) return 0;
  const stage = chartDataSection.find((item: Point) => item.time === stageName);
  return stage ? parseInt(String(stage.value || '0'), 10) : 0;
};

// ===== 处理时间段：保证所有时间段首尾连续 =====
// 1. 缺失 → 清醒填充  2. 交叉 → 对齐  3. 乱序 → 排序
// 4. 重复时间戳 → 跳过  5. 跨午夜 → 归一化  6. 超范围 → 裁剪  7. 同类型相邻 → 合并
const processTimeSegments = (): Array<{ start: number; duration: number; type: string }> => {
  const chartData = props.sleepDetailObj?.chartData;
  // 睡眠状态映射（与后端 API 契约一致：0无效 1清醒 2快速眼动 3浅睡 4深睡 5小睡）
  const stateMap: Record<number, string> = {
    1: '清醒',
    2: '快速眼动',
    3: '浅睡',
    4: '深睡',
    5: '小睡'
  };

  if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
    const segments: Array<{ start: number; duration: number; type: string }> = [];
    let currentStart = 0;
    const stages = ['深睡', '浅睡', '快速眼动', '清醒'];
    stages.forEach((stage) => {
      const duration = getStageDuration(stage);
      if (duration > 0) {
        segments.push({ start: currentStart, duration, type: stage });
        currentStart += duration;
      }
    });
    return segments;
  }

  const startStr = props.sleepSegmentObj?.startTime || '';
  const endStr = props.sleepSegmentObj?.endTime || '';
  const startMins = parseTimeToMinutes(startStr);
  const endMins = parseTimeToMinutes(endStr);
  const firstDataMins = parseTimeToMinutes(chartData[0]?.time || '');
  const lastDataMins = parseTimeToMinutes(chartData[chartData.length - 1]?.time || '');

  const refStart = startMins > 0 ? startMins : firstDataMins;
  const refEnd = endMins > 0 ? endMins : lastDataMins;
  const crossesMidnight = refStart > refEnd;

  const normalizeTime = (minutes: number): number => {
    if (crossesMidnight && minutes < refStart) return minutes + 1440;
    return minutes;
  };

  const sleepStart = normalizeTime(refStart);
  const sleepEnd = normalizeTime(refEnd);

  const sortedPoints = chartData
    .map((item: any) => ({
      time: normalizeTime(parseTimeToMinutes(item.time || '')),
      value: item.value || ''
    }))
    .sort((a: any, b: any) => a.time - b.time);

  const segments: Array<{ start: number; duration: number; type: string }> = [];
  let cursor = sleepStart;

  for (let i = 0; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];
    if (point.time >= sleepEnd) break;

    const rawSegEnd = i < sortedPoints.length - 1 ? sortedPoints[i + 1].time : sleepEnd;
    const segEnd = Math.min(rawSegEnd, sleepEnd);

    if (point.time > cursor) {
      segments.push({ start: cursor, duration: point.time - cursor, type: '清醒' });
      cursor = point.time;
    }

    const segStart = Math.max(point.time, cursor);
    const duration = segEnd - segStart;

    if (duration > 0) {
      const numValue = parseInt(String(point.value), 10);
      const type = stateMap[numValue] || '清醒';
      segments.push({ start: segStart, duration, type });
      cursor = segStart + duration;
    }
  }

  if (cursor < sleepEnd) {
    segments.push({ start: cursor, duration: sleepEnd - cursor, type: '清醒' });
  }

  const merged: Array<{ start: number; duration: number; type: string }> = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type && last.start + last.duration === seg.start) {
      last.duration += seg.duration;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
};

// ===== 时间范围 =====
const timeRange = computed(() => {
  const startStr = props.sleepSegmentObj?.startTime || '';
  const endStr = props.sleepSegmentObj?.endTime || '';
  const startMins = parseTimeToMinutes(startStr);
  const endMins = parseTimeToMinutes(endStr);

  if (startMins > 0 && endMins > 0) {
    return { min: startMins, max: endMins > startMins ? endMins : endMins + 1440 };
  }

  const chartData = props.sleepDetailObj?.chartData;
  if (chartData && chartData.length > 0) {
    const first = parseTimeToMinutes(chartData[0]?.time || '');
    const last = parseTimeToMinutes(chartData[chartData.length - 1]?.time || '');
    return { min: first, max: last > first ? last : last + 1440 };
  }

  return { min: 0, max: 1 };
});

// ===== 布局计算 =====
// 4 行，每行 25%；色块高度 = 行高的一半（间距=色块高度）
const ROW_COUNT = 4;
const ROW_PCT = 100 / ROW_COUNT;          // 25%
const BLOCK_PCT = ROW_PCT / 2;            // 12.5%
const BLOCK_OFFSET = (ROW_PCT - BLOCK_PCT) / 2; // 6.25%

const layoutList = computed(() => {
  const segments = processTimeSegments();
  const { min, max } = timeRange.value;
  const total = max - min || 1;
  const lastIdx = segments.length - 1;

  return segments.map((seg, idx) => {
    const config = STAGE_CONFIG[seg.type] || STAGE_CONFIG['清醒'];
    return {
      left: ((seg.start - min) / total) * 100,
      width: (seg.duration / total) * 100,
      top: config.level * ROW_PCT + BLOCK_OFFSET,
      height: BLOCK_PCT,
      color: config.color,
      idx,
      isFirst: idx === 0,
      isLast: idx === lastIdx
    };
  });
});

// ===== 网格线位置（每行色块的上下边缘） =====
const gridLines = computed(() => {
  const lines: number[] = [];
  for (let i = 0; i < ROW_COUNT; i++) {
    const center = i * ROW_PCT + ROW_PCT / 2;
    lines.push(center - BLOCK_PCT / 2);
    lines.push(center + BLOCK_PCT / 2);
  }
  return lines;
});

// ===== 相邻色块之间的连线 =====
// 时间段首尾连续，相邻不同行的色块在 X 轴上相接，连线为垂直线
// 两端各去掉 10rpx（与色块圆角对齐），颜色为渐变
const CORNER_TRIM_PCT = (10 / 300) * 100; // 10rpx 占图表高度 300rpx 的百分比

const connectors = computed(() => {
  const items = layoutList.value;
  const result: Array<{ left: number; top: number; height: number; gradient: string }> = [];

  for (let i = 0; i < items.length - 1; i++) {
    const curr = items[i];
    const next = items[i + 1];
    if (curr.top === next.top) continue; // 同行不需要连线

    const x = next.left; // = curr.left + curr.width（连续）

    const currTop = curr.top;
    const currBottom = curr.top + curr.height;
    const nextTop = next.top;
    const nextBottom = next.top + next.height;

    const topY = Math.min(currTop, nextTop);
    const bottomY = Math.max(currBottom, nextBottom);
    // 上端使用位于上方的色块颜色，下端使用位于下方的色块颜色
    const topColor = currTop < nextTop ? curr.color : next.color;
    const bottomColor = currTop < nextTop ? next.color : curr.color;

    result.push({
      left: x,
      top: topY + CORNER_TRIM_PCT,
      height: bottomY - topY - CORNER_TRIM_PCT * 2,
      gradient: `linear-gradient(to bottom, ${topColor}, ${bottomColor})`
    });
  }
  return result;
});

// ===== 时间标签 =====
const startTimeLabel = computed(() => formatTime(timeRange.value.min));
const endTimeLabel = computed(() => formatTime(timeRange.value.max));

// ===== 点击指示器 =====
const instance = getCurrentInstance();
const indicatorX = ref<number | null>(null);
const indicatorInfo = ref<{
  type: string;
  color: string;
  startTime: string;
  endTime: string;
} | null>(null);

// 提示框水平位置：边界处做钳制，防止溢出
const tooltipLeft = computed(() => {
  if (indicatorX.value === null) return 0;
  return Math.max(15, Math.min(85, indicatorX.value));
});

const dismissIndicator = () => {
  indicatorX.value = null;
  indicatorInfo.value = null;
};

// 缓存 chart-body 的位置信息，touchmove 时同步使用避免异步延迟
let cachedRect: { left: number; width: number } | null = null;

const updateIndicator = (clientX: number) => {
  if (!cachedRect) return;
  const xPercent = Math.max(0, Math.min(100, ((clientX - cachedRect.left) / cachedRect.width) * 100));

  const { min, max } = timeRange.value;
  const time = min + (xPercent / 100) * (max - min);

  const segments = processTimeSegments();
  let seg = segments.find(s => time >= s.start && time < s.start + s.duration);
  if (!seg && segments.length > 0) seg = segments[segments.length - 1];
  if (!seg) return;

  const config = STAGE_CONFIG[seg.type] || STAGE_CONFIG['清醒'];
  indicatorX.value = xPercent;
  indicatorInfo.value = {
    type: seg.type,
    color: config.color,
    startTime: formatTime(seg.start),
    endTime: formatTime(seg.start + seg.duration)
  };
};

const queryRectAndUpdate = (clientX: number) => {
  uni.createSelectorQuery()
    .in(instance!.proxy)
    .select('.chart-body')
    .boundingClientRect((rect: any) => {
      if (!rect) return;
      cachedRect = { left: rect.left, width: rect.width };
      updateIndicator(clientX);
    })
    .exec();
};

const handleChartTouchStart = (e: any) => {
  const clientX = e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX;
  if (clientX === undefined) return;
  queryRectAndUpdate(clientX);
};

const handleChartTouchMove = (e: any) => {
  const clientX = e.touches?.[0]?.clientX;
  if (clientX === undefined) return;
  if (cachedRect) {
    updateIndicator(clientX);
  } else {
    queryRectAndUpdate(clientX);
  }
};
</script>

<template>
  <view class="mt-30 mb-30 r-50 bg-white p-10">
    <view class="p-20 r-50" style="background-color: #f8f8fe">
      <view class="ta-c">
        <text class="fs-72">{{ sleepDurationHours || '00' }}</text>
        <text class="fs-24">小时</text>
        <text class="fs-72">{{ formattedMinutes || '00' }}</text>
        <text class="fs-24">分钟</text>
      </view>
      <view class="ta-c fs-28">
        睡眠时间
        <slot></slot>
      </view>

      <!-- CSS 图表 -->
      <view class="chart-container">
        <view class="chart-body" @touchstart="handleChartTouchStart" @touchmove="handleChartTouchMove">
          <!-- 左右纵轴虚线 -->
          <view class="axis-v left"></view>
          <view class="axis-v right"></view>

          <!-- 横向网格虚线（色块上下边缘） -->
          <view
            v-for="(top, idx) in gridLines"
            :key="'grid-' + idx"
            class="grid-line"
            :style="{ top: top + '%' }"
          ></view>

          <!-- 相邻色块连线（渐变色） -->
          <view
            v-for="(conn, idx) in connectors"
            :key="'conn-' + idx"
            class="connector"
            :style="{
              left: conn.left + '%',
              top: conn.top + '%',
              height: conn.height + '%',
              backgroundImage: conn.gradient
            }"
          ></view>

          <!-- 阶段色块（相邻色块水平方向各延伸 1rpx，互相覆盖连接线宽度） -->
          <view
            v-for="item in layoutList"
            :key="'bar-' + item.idx"
            class="stage-bar"
            :class="{ 'is-first': item.isFirst, 'is-last': item.isLast }"
            :style="{
              left: 'calc(' + item.left + '% - 1rpx)',
              width: 'calc(' + item.width + '% + 2rpx)',
              top: item.top + '%',
              height: item.height + '%',
              backgroundColor: item.color
            }"
          ></view>

          <!-- 点击指示线 -->
          <view
            v-if="indicatorX !== null"
            class="indicator-line"
            :style="{ left: indicatorX + '%' }"
          ></view>

          <!-- 提示框 -->
          <view
            v-if="indicatorInfo"
            class="indicator-tooltip"
            :style="{ left: tooltipLeft + '%' }"
            @tap.stop="dismissIndicator"
          >
            <view class="tooltip-dot" :style="{ backgroundColor: indicatorInfo.color }"></view>
            <text class="tooltip-type">{{ indicatorInfo.type }}</text>
            <text class="tooltip-time">{{ indicatorInfo.startTime }}-{{ indicatorInfo.endTime }}</text>
          </view>

          <!-- 时间刻度 -->
          <text class="time-text left">{{ startTimeLabel }}</text>
          <text class="time-text right">{{ endTimeLabel }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.chart-container {
  position: relative;
  width: 100%;
  margin-top: 25rpx;
  padding-bottom: 50rpx;
}

.chart-body {
  position: relative;
  width: 100%;
  height: 300rpx;
  overflow: visible;
}

/* 左右纵轴虚线：与首尾横向网格线齐平，形成闭合矩形 */
.axis-v {
  position: absolute;
  top: 6.25%;
  bottom: 6.25%;
  width: 0;
  border-left: 1px dashed #e5e7eb;
  z-index: 1;
}
.axis-v.left { left: 0; }
.axis-v.right { right: 0; }

/* 横向网格虚线（层级在色块之下） */
.grid-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed #e5e7eb;
  z-index: 1;
}

/* 相邻色块连线 */
.connector {
  position: absolute;
  width: 2rpx;
  margin-left: -1rpx;
  z-index: 2;
}

/* 阶段色块 */
.stage-bar {
  position: absolute;
  border-radius: 6rpx;
  z-index: 2;
}

/* 时间刻度文字 */
.time-text {
  position: absolute;
  top: 100%;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #9ca3af;
  z-index: 2;
}
.time-text.left { left: 0; }
.time-text.right { right: 0; }

/* 点击指示线（与网格虚线同色） */
.indicator-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px dashed #e5e7eb;
  z-index: 4;
  pointer-events: none;
}

/* 提示框 */
.indicator-tooltip {
  position: absolute;
  top: -36rpx;
  transform: translateX(-50%);
  background: #ffffff;
  border-radius: 12rpx;
  padding: 8rpx 16rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  white-space: nowrap;
  z-index: 5;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.12);
}
.tooltip-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
}
.tooltip-type {
  font-size: 24rpx;
  color: #374151;
  font-weight: 600;
}
.tooltip-time {
  font-size: 22rpx;
  color: #6b7280;
}
</style>
