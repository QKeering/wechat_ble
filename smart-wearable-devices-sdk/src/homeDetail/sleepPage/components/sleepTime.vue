<script setup lang="ts">
import { computed, ref, getCurrentInstance } from 'vue';
import type { sleepDetail, sleepSegment, Point } from '@/types/api/homeDetail';
import { SLEEP_STAGE_COLORS, type SleepStageName } from '@/homeDetail/sleepPage/sleepStageColors';

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
  快速眼动: { level: 0, color: SLEEP_STAGE_COLORS['快速眼动'] },
  清醒: { level: 1, color: SLEEP_STAGE_COLORS['清醒'] },
  浅睡: { level: 2, color: SLEEP_STAGE_COLORS['浅睡'] },
  深睡: { level: 3, color: SLEEP_STAGE_COLORS['深睡'] },
  小睡: { level: 0, color: SLEEP_STAGE_COLORS['小睡'] }
};

const STAGE_ALIASES: Record<string, string> = {
  '1': '清醒',
  awake: '清醒',
  wake: '清醒',
  清醒: '清醒',
  '2': '快速眼动',
  rem: '快速眼动',
  REM: '快速眼动',
  快速眼动: '快速眼动',
  眼动: '快速眼动',
  '3': '浅睡',
  light: '浅睡',
  浅睡: '浅睡',
  '4': '深睡',
  deep: '深睡',
  深睡: '深睡',
  '5': '小睡',
  nap: '小睡',
  小睡: '小睡'
};

type SleepTimelineSegment = { start: number; duration: number; type: string };
type SleepTimelineTick = { key: string; label: string; left: number; isFirst: boolean; isLast: boolean };

const normalizeStageType = (...values: unknown[]) => {
  for (const value of values) {
    const key = String(value ?? '').trim();
    if (!key) continue;
    const normalized = STAGE_ALIASES[key] || STAGE_ALIASES[key.toLowerCase()];
    if (normalized) return normalized;
  }
  return '';
};

const hasExplicitSleepType = (item: any) =>
  item?.sleepType !== undefined ||
  item?.sleep_type !== undefined ||
  item?.sleepTypeName !== undefined ||
  item?.sleep_type_name !== undefined;

const getPointStageType = (item: any) => {
  const explicitStage = normalizeStageType(
    item?.sleepType,
    item?.sleep_type,
    item?.sleepTypeName,
    item?.sleep_type_name
  );
  if (explicitStage) return explicitStage;
  // sleep-detail 明细会返回 sleepType 文案，同时 value 可能固定为 5。
  // sleepType 存在但不是阶段文案时，不能再把 value=5 误判为“小睡”。
  if (hasExplicitSleepType(item)) return '';

  return normalizeStageType(
    item?.sleepState,
    item?.sleep_state,
    item?.sleepStatus,
    item?.sleep_status,
    item?.sleepStage,
    item?.sleep_stage,
    item?.stageName,
    item?.status,
    item?.state,
    item?.stage,
    item?.type,
    item?.name,
    item?.value
  );
};

// ===== 时间工具 =====
const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const match = String(timeStr).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10) || 0;
  const minutes = parseInt(match[2], 10) || 0;
  const seconds = parseInt(match[3] || '0', 10) || 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return 0;
  return hours * 60 + minutes + Math.floor(seconds / 60);
};

const hasClockTime = (timeStr: unknown) => /(\d{1,2}):(\d{2})(?::(\d{2}))?/.test(String(timeStr ?? ''));

const formatTime = (minutes: number): string => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// ===== 从 chartDataSection 获取各阶段时长（分钟） =====
const getStageDuration = (stageName: string): number => {
  const chartDataSection = props.sleepSegmentObj?.chartDataSection;
  if (!chartDataSection || !Array.isArray(chartDataSection)) return 0;
  return chartDataSection.reduce((total: number, item: Point) => {
    if (normalizeStageType(item.time) !== stageName) return total;
    return total + (parseInt(String(item.value || '0'), 10) || 0);
  }, 0);
};

const formatCompactDuration = (minutes: number) => ({
  hours: Math.floor(Math.max(0, minutes) / 60),
  minutes: Math.max(0, minutes) % 60
});

const sleepTimeStats = computed(() => {
  const stages: SleepStageName[] = ['深睡', '浅睡', '快速眼动'];
  return stages.map((name) => {
    const duration = formatCompactDuration(getStageDuration(name));
    const config = STAGE_CONFIG[name] || STAGE_CONFIG['浅睡'];
    return {
      name,
      color: config.color,
      ...duration
    };
  });
});

// ===== 处理时间段：保证所有时间段首尾连续 =====
// 1. 缺失 → 清醒填充  2. 交叉 → 对齐  3. 乱序 → 排序
// 4. 重复时间戳 → 跳过  5. 跨午夜 → 归一化  6. 超范围 → 裁剪  7. 同类型相邻 → 合并
const mergeTimelineSegments = (segments: SleepTimelineSegment[]) => {
  const merged: SleepTimelineSegment[] = [];
  segments
    .filter((seg) => seg.duration > 0 && STAGE_CONFIG[seg.type])
    .sort((a, b) => a.start - b.start)
    .forEach((seg) => {
      const last = merged[merged.length - 1];
      if (last && last.type === seg.type && Math.abs(last.start + last.duration - seg.start) <= 0.01) {
        last.duration += seg.duration;
      } else {
        merged.push({ ...seg });
      }
    });
  return merged;
};

const getFallbackStartMinutes = () => {
  const segmentStart = parseTimeToMinutes(props.sleepSegmentObj?.startTime || '');
  if (hasClockTime(props.sleepSegmentObj?.startTime)) return segmentStart;
  const firstPoint = props.sleepDetailObj?.chartData?.[0] as any;
  return parseTimeToMinutes(firstPoint?.time || firstPoint?.startTime || firstPoint?.start_time || '');
};

const getFallbackSegmentsFromSummary = (): SleepTimelineSegment[] => {
  const segments: SleepTimelineSegment[] = [];
  let currentStart = getFallbackStartMinutes();
  const stages = ['深睡', '浅睡', '快速眼动', '清醒', '小睡'];
  stages.forEach((stage) => {
    const duration = getStageDuration(stage);
    if (duration > 0) {
      segments.push({ start: currentStart, duration, type: stage });
      currentStart += duration;
    }
  });
  return segments;
};

const getTypicalPointGap = (points: Array<{ time: number; type: string }>) => {
  const gaps = points
    .slice(0, -1)
    .map((point, index) => points[index + 1].time - point.time)
    .filter((gap) => gap > 0 && gap <= 90)
    .sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 10;
};

const processTimeSegments = (): SleepTimelineSegment[] => {
  const chartData = props.sleepDetailObj?.chartData;
  if (!Array.isArray(chartData) || chartData.length === 0) {
    return getFallbackSegmentsFromSummary();
  }

  const startMins = parseTimeToMinutes(props.sleepSegmentObj?.startTime || '');
  const endMins = parseTimeToMinutes(props.sleepSegmentObj?.endTime || '');
  const hasStartTime = hasClockTime(props.sleepSegmentObj?.startTime);
  const hasEndTime = hasClockTime(props.sleepSegmentObj?.endTime);
  const rawPointTimes = chartData
    .map((item: any) => {
      const rawTime = item?.time || item?.startTime || item?.start_time || '';
      return hasClockTime(rawTime) ? parseTimeToMinutes(rawTime) : null;
    })
    .filter((time): time is number => time != null)
    .filter((time) => Number.isFinite(time));
  const firstPointTime = rawPointTimes[0] ?? 0;
  const refStart = hasStartTime ? startMins : firstPointTime;
  const refEnd = hasEndTime ? endMins : (rawPointTimes[rawPointTimes.length - 1] ?? refStart);
  const crossesMidnight = refStart > refEnd;

  const normalizeTime = (minutes: number) => (crossesMidnight && minutes < refStart ? minutes + 1440 : minutes);

  const detailPoints = chartData
    .map((item: any) => {
      const rawTimeText = item?.time || item?.startTime || item?.start_time || '';
      if (!hasClockTime(rawTimeText)) return null;
      const rawTime = parseTimeToMinutes(rawTimeText);
      const type = getPointStageType(item);
      if (!Number.isFinite(rawTime) || !type) return null;
      return {
        time: normalizeTime(rawTime),
        type
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.time - b.time) as Array<{ time: number; type: string }>;

  if (!detailPoints.length) {
    return getFallbackSegmentsFromSummary();
  }

  const typicalGap = getTypicalPointGap(detailPoints);
  const sleepStart = hasStartTime ? normalizeTime(refStart) : detailPoints[0].time;
  const sleepEndCandidate = hasEndTime ? normalizeTime(refEnd) : detailPoints[detailPoints.length - 1].time + typicalGap;
  const sleepEnd = Math.max(sleepStart + 1, sleepEndCandidate);
  const segments: SleepTimelineSegment[] = [];

  if (detailPoints[0].time > sleepStart) {
    segments.push({
      start: sleepStart,
      duration: detailPoints[0].time - sleepStart,
      type: detailPoints[0].type
    });
  }

  detailPoints.forEach((point, index) => {
    if (point.time >= sleepEnd) return;
    const nextTime = detailPoints[index + 1]?.time ?? sleepEnd;
    const segStart = Math.max(point.time, sleepStart);
    const segEnd = Math.min(nextTime > segStart ? nextTime : segStart + typicalGap, sleepEnd);
    if (segEnd > segStart) {
      segments.push({
        start: segStart,
        duration: segEnd - segStart,
        type: point.type
      });
    }
  });

  const merged = mergeTimelineSegments(segments);
  return merged.length ? merged : getFallbackSegmentsFromSummary();
};

// ===== 时间范围 =====
const timeRange = computed(() => {
  const startStr = props.sleepSegmentObj?.startTime || '';
  const endStr = props.sleepSegmentObj?.endTime || '';
  const startMins = parseTimeToMinutes(startStr);
  const endMins = parseTimeToMinutes(endStr);

  if (hasClockTime(startStr) && hasClockTime(endStr)) {
    return { min: startMins, max: endMins > startMins ? endMins : endMins + 1440 };
  }

  if (hasClockTime(startStr)) {
    const summaryDuration = ['深睡', '浅睡', '快速眼动', '清醒', '小睡'].reduce((total, stage) => total + getStageDuration(stage), 0);
    if (summaryDuration > 0) {
      return { min: startMins, max: startMins + summaryDuration };
    }
  }

  const chartData = props.sleepDetailObj?.chartData;
  if (chartData && chartData.length > 0) {
    const firstRaw = chartData[0]?.time || '';
    const lastRaw = chartData[chartData.length - 1]?.time || '';
    if (hasClockTime(firstRaw) && hasClockTime(lastRaw)) {
      const first = parseTimeToMinutes(firstRaw);
      const last = parseTimeToMinutes(lastRaw);
      return { min: first, max: last > first ? last : last + 1440 };
    }
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
const sleepTimeTicks = computed<SleepTimelineTick[]>(() => {
  const { min, max } = timeRange.value;
  const span = Math.max(1, max - min);
  const minutesList: number[] = [min, max];
  const segments = processTimeSegments();

  segments.forEach((segment) => {
    minutesList.push(segment.start, segment.start + segment.duration);
  });

  const uniqueMinutes = Array.from(new Set(minutesList.filter((item) => Number.isFinite(item))))
    .filter((minutes) => minutes >= min && minutes <= max)
    .sort((a, b) => a - b);
  const rawTicks = uniqueMinutes.map((minutes, index) => ({
    key: `${minutes}-${index}`,
    label: formatTime(minutes),
    left: Math.max(0, Math.min(100, ((minutes - min) / span) * 100)),
    isFirst: false,
    isLast: false
  }));
  if (rawTicks.length <= 2) {
    return rawTicks.map((tick, index, list) => ({
      ...tick,
      isFirst: index === 0,
      isLast: index === list.length - 1
    }));
  }

  const minGapPercent = 9;
  const lastTick = rawTicks[rawTicks.length - 1];
  const filtered: SleepTimelineTick[] = [rawTicks[0]];
  rawTicks.slice(1, -1).forEach((tick) => {
    const prev = filtered[filtered.length - 1];
    if (tick.left - prev.left < minGapPercent) return;
    if (lastTick.left - tick.left < minGapPercent) return;
    filtered.push(tick);
  });
  const prev = filtered[filtered.length - 1];
  if (lastTick.left - prev.left < minGapPercent && filtered.length > 1) {
    filtered.pop();
  }
  filtered.push(lastTick);

  return filtered.map((tick, index, list) => ({
    ...tick,
    isFirst: index === 0,
    isLast: index === list.length - 1
  }));
});

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
          <text
            v-for="tick in sleepTimeTicks"
            :key="tick.key"
            class="time-tick"
            :class="{ 'is-first': tick.isFirst, 'is-last': tick.isLast }"
            :style="{ left: tick.left + '%' }"
          >{{ tick.label }}</text>
        </view>
      </view>
      <view class="sleep-time-summary">
        <view v-for="item in sleepTimeStats" :key="item.name" class="sleep-time-summary-item">
          <view class="sleep-time-summary-value">
            <text class="sleep-time-summary-hour">{{ item.hours }}</text>
            <text class="sleep-time-summary-unit">h</text>
            <text class="sleep-time-summary-minute">{{ item.minutes }}</text>
            <text class="sleep-time-summary-unit">min</text>
          </view>
          <view class="sleep-time-summary-label">
            <view class="sleep-time-summary-dot" :style="{ backgroundColor: item.color }"></view>
            <text>{{ item.name }}</text>
          </view>
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
  padding-bottom: 78rpx;
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
.time-tick {
  position: absolute;
  top: 100%;
  margin-top: 8rpx;
  font-size: 18rpx;
  color: #9ca3af;
  z-index: 2;
  white-space: nowrap;
  transform: translateX(-50%);
  transform-origin: top center;
}
.time-tick.is-first {
  transform: none;
  transform-origin: top left;
}
.time-tick.is-last {
  transform: translateX(-100%);
  transform-origin: top right;
}

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

.sleep-time-summary {
  display: flex;
  align-items: center;
  justify-content: space-around;
  margin-top: 26rpx;
  padding: 22rpx 4rpx 8rpx;
  border-top: 1rpx solid rgba(229, 231, 235, 0.75);
}

.sleep-time-summary-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.sleep-time-summary-value {
  display: flex;
  align-items: baseline;
  justify-content: center;
  color: #111827;
  line-height: 1;
}

.sleep-time-summary-hour,
.sleep-time-summary-minute {
  font-size: 38rpx;
  font-weight: 600;
}

.sleep-time-summary-minute {
  margin-left: 14rpx;
}

.sleep-time-summary-unit {
  margin-left: 4rpx;
  color: #6b7280;
  font-size: 22rpx;
}

.sleep-time-summary-label {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
  color: #6b7280;
  font-size: 22rpx;
}

.sleep-time-summary-dot {
  width: 14rpx;
  height: 14rpx;
  margin-right: 8rpx;
  border-radius: 50%;
}
</style>
