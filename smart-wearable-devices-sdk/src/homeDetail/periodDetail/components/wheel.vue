<template>
  <view class="cycle-wheel">
    <view class="cycle-wrapper" :id="wheelWrapId">
      <canvas
        type="2d"
        class="cycle-canvas"
        :id="mainCanvasId"
        disable-scroll
        :style="{ width: layoutSizePx + 'px', height: layoutSizePx + 'px' }"
      />
      <!--
        这里原本是 cover-view（还嵌了 4 层）。cover-view 是给小程序原生组件做层级覆盖的，
        在 app-vue 页面上用不了：官方明确「App 端 vue 页面 cover-view 不支持嵌套其它组件，
        包括再次嵌套 cover-view」，而且它只能覆盖 video/map，样式也只认基本定位/布局/文本
        （box-shadow、CSS 变量全丢）。症状就是中心文字和 ✎ 按钮样式错乱、点不动。
        普通 view 才对：app-vue 的 canvas 是 webview 的 canvas，不是原生组件，靠 CSS 层叠
        就能盖住；微信小程序 canvas type="2d" 也已同层渲染（官方建议用 view 替代 cover-view）。
      -->
      <view class="cycle-overlay" :class="cardPhaseClass">
        <view class="cycle-center">
          <view class="cycle-content">
            <template v-if="cycleDay > 0">
              <view class="cycle-phase">{{ phaseLabel }}</view>
              <view class="cycle-day">第{{ currentDayNow }}天</view>
            </template>
            <template v-else>
              <view class="cycle-phase">暂无数据</view>
            </template>
          </view>
          <view
            v-if="cycleDay > 0"
            class="cycle-edit"
            hover-class="cycle-edit--hover"
            @tap.stop="onEdit"
          >
            <view class="cycle-edit-icon">✎</view>
          </view>
        </view>
      </view>
    </view>

    <view class="cycle-legend">
      <view
        v-for="p in legendPhaseKeys"
        :key="p"
        class="legend-item"
        :class="{ active: currentPhase === p }"
      >
        <view :class="['legend-dot', p]" />
        <text>{{ phaseLabels[p] }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, getCurrentInstance } from 'vue';
import { appendRingDiagnosticLog } from '@/utils/ringDiagnosticLog';

const GAP = 4;
const CAP = 4;
const RING_R = 110;
const BASE_WRAPPER = 320;
const CANVAS_INIT_MAX_RETRIES = 5;

type PhaseKey = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';

const phaseKeys: PhaseKey[] = ['menstrual', 'follicular', 'ovulation', 'luteal'];
const legendPhaseKeys: PhaseKey[] = ['menstrual', 'ovulation', 'follicular', 'luteal'];

const phaseLabels: Record<PhaseKey, string> = {
  menstrual: '月经期',
  follicular: '易孕期',
  ovulation: '排卵期',
  luteal: '安全期'
};

const defaultPhaseLength: Record<PhaseKey, number> = {
  menstrual: 7,
  follicular: 4,
  ovulation: 7,
  luteal: 12
};

const STROKE_DEEP = ['#FF4081', '#9c27b0', '#3f51b5', '#ff9800'];

const STROKE_LIGHT: Record<PhaseKey, string> = {
  menstrual: '#fce4ec',
  follicular: '#e1bee7',
  ovulation: '#c5cae9',
  luteal: '#ffe0b2'
};

const PHASE_ACCENT: Record<PhaseKey, string> = {
  menstrual: '#ff4081',
  follicular: '#9c27b0',
  ovulation: '#3f51b5',
  luteal: '#ff9800'
};

const props = withDefaults(
  defineProps<{
    day?: number;
    phaseLengths?: Partial<Record<PhaseKey, number>>;
  }>(),
  {
    day: 0,
    phaseLengths: () => ({})
  }
);

const emit = defineEmits<{
  (e: 'update:day', value: number): void;
  (e: 'edit'): void;
}>();

const instance = getCurrentInstance();
const uid = instance?.uid ?? 0;
const mainCanvasId = `periodCycleMain_${uid}`;
const wheelWrapId = `cycle-wheel-wrap_${uid}`;

const layoutSizePx = ref(BASE_WRAPPER);
const layoutScale = computed(() => layoutSizePx.value / BASE_WRAPPER);

function pathGapPx(): number {
  return GAP * layoutScale.value;
}

function pathCapPx(): number {
  return CAP * layoutScale.value;
}

const canvasCtx = ref<CanvasRenderingContext2D | null>(null);
const canvasNode = ref<any>(null);
let hasLoggedCanvasReady = false;

function normalizeCycleDay(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

const cycleDay = ref(normalizeCycleDay(props.day));

watch(
  () => props.day,
  (v) => {
    cycleDay.value = normalizeCycleDay(v);
  }
);

const phaseLength = computed(() => ({
  ...defaultPhaseLength,
  ...props.phaseLengths
}));

const totalCycleDays = computed(() =>
  phaseKeys.reduce((sum, p) => sum + (phaseLength.value[p] || 0), 0) || 1
);

const totalLen = ref(0);
const segmentLengths = ref<number[]>([]);
const segStarts = ref<number[]>([]);
const contentStarts = ref<number[]>([]);
const totalDrawable = ref(0);

function computeSegmentLengths() {
  const totalDays = phaseKeys.reduce((a, p) => a + (phaseLength.value[p] || 0), 0) || 1;
  const len = totalLen.value;
  const gap = pathGapPx();
  const drawable = len - 4 * gap;
  totalDrawable.value = drawable;

  const segLens: number[] = [];
  const starts: number[] = [];
  const cStarts: number[] = [];
  let pathAcc = 0;
  let contentAcc = 0;

  phaseKeys.forEach((p) => {
    starts.push(pathAcc);
    cStarts.push(contentAcc);
    const segLen = ((phaseLength.value[p] || 0) / totalDays) * drawable;
    segLens.push(segLen);
    contentAcc += segLen;
    pathAcc += segLen + gap;
  });

  segmentLengths.value = segLens;
  segStarts.value = starts;
  contentStarts.value = cStarts;
}

function initRing() {
  const r = RING_R * layoutScale.value;
  totalLen.value = 2 * Math.PI * r;
  computeSegmentLengths();
}

function getPhaseInfo(day: number): { phase: PhaseKey; dayInPhase: number } {
  const d = Math.max(1, Math.min(day, totalCycleDays.value));
  let acc = 0;
  for (let i = 0; i < phaseKeys.length; i++) {
    const p = phaseKeys[i];
    const plen = phaseLength.value[p] || 0;
    if (d <= acc + plen) 
	return { phase: p, dayInPhase: d - acc };
    acc += plen;
  }
  const last = phaseKeys[phaseKeys.length - 1];
  return { phase: last, dayInPhase: phaseLength.value[last] || 1 };
}

const currentPhase = computed(() => getPhaseInfo(cycleDay.value).phase);
const phaseLabel = computed(() => phaseLabels[currentPhase.value]);
const cardPhaseClass = computed(() => 'phase-' + currentPhase.value);
const currentDayNow =computed(() => getPhaseInfo(cycleDay.value).dayInPhase);
function getProgressLength(): number {
  const progressContent = (cycleDay.value / totalCycleDays.value) * totalDrawable.value;
  let nComplete = 0;
  const sl = segmentLengths.value;
  const cs = contentStarts.value;
  for (let i = 0; i < phaseKeys.length; i++) {
    if (progressContent >= cs[i] + (sl[i] || 0)) nComplete = i + 1;
  }
  return progressContent + nComplete * pathGapPx();
}

function drawDroplet(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.bezierCurveTo(cx + size * 0.15, cy - size * 0.6, cx + size * 0.7, cy - size * 0.1, cx + size * 0.55, cy + size * 0.3);
  ctx.bezierCurveTo(cx + size * 0.4, cy + size * 0.75, cx, cy + size * 0.9, cx, cy + size * 0.9);
  ctx.bezierCurveTo(cx, cy + size * 0.9, cx - size * 0.4, cy + size * 0.75, cx - size * 0.55, cy + size * 0.3);
  ctx.bezierCurveTo(cx - size * 0.7, cy - size * 0.1, cx - size * 0.15, cy - size * 0.6, cx, cy - size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAll() {
  const ctx = canvasCtx.value;
  if (!ctx) return;

  const L = layoutSizePx.value;
  if (L < 8) return;

  const s = L / BASE_WRAPPER;
  const cx = L / 2;
  const cy = L / 2;
  const r = RING_R * s;
  const cap = pathCapPx();
  const gap = pathGapPx();
  const accent = PHASE_ACCENT[currentPhase.value];

  ctx.clearRect(0, 0, L, L);

  ctx.beginPath();
  ctx.arc(cx, cy, 165 * s, 0, Math.PI * 2);
  ctx.fillStyle = '#fdf2f5';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, 140 * s, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = Math.max(0.5, s);
  ctx.stroke();

  const sl = segmentLengths.value;
  const ss = segStarts.value;
  const gapRad = gap / r;
  const strokeW = Math.max(2, 8 * s);

  let theta = -Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const drawLen = Math.max(0, (sl[i] || 0) - cap);
    const sweep = drawLen / r;
    if (sweep > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, theta, theta + sweep, false);
      ctx.strokeStyle = STROKE_LIGHT[phaseKeys[i]];
      ctx.lineWidth = strokeW;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    theta += sweep + gapRad;
  }

  if (cycleDay.value > 0) {
    const progressLen = getProgressLength();
    theta = -Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const segStart = ss[i];
      const drawLen = Math.max(0, (sl[i] || 0) - cap);
      const visibleLen = Math.max(0, Math.min(drawLen, progressLen - segStart));
      const sweep = visibleLen / r;
      if (sweep > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, theta, theta + sweep, false);
        ctx.strokeStyle = STROKE_DEEP[i];
        ctx.lineWidth = strokeW;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      theta += drawLen / r + gapRad;
    }

    const dotTheta = -Math.PI / 2 + progressLen / r;
    const dotCx = cx + r * Math.cos(dotTheta);
    const dotCy = cy + r * Math.sin(dotTheta);
    const dotR = 14 * s;

    ctx.beginPath();
    ctx.arc(dotCx, dotCy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.stroke();

    drawDroplet(ctx, dotCx, dotCy, dotR * 0.7, accent);
  }

}

function syncFromCycleDay() {
  nextTick(() => drawAll());
}

function onEdit() {
  emit('edit');
}

watch(cycleDay, () => syncFromCycleDay());

watch(
  () => props.phaseLengths,
  () => {
    nextTick(() => {
      initRing();
      syncFromCycleDay();
    });
  },
  { deep: true }
);

function initCanvas(retries = CANVAS_INIT_MAX_RETRIES): Promise<void> {
  return new Promise((resolve) => {
    const L = layoutSizePx.value;
    const q = uni.createSelectorQuery().in(instance?.proxy as any);
    (q.select(`#${mainCanvasId}`) as any)
      .fields({ node: true, size: true })
      .exec((res: any[]) => {
        const canvas = res?.[0]?.node;
        if (!canvas || typeof canvas.getContext !== 'function') {
          if (retries > 0) {
            setTimeout(() => initCanvas(retries - 1).then(resolve), 80);
          } else {
            // 拿不到 node 就等于圆环一根线都画不出来（drawAll 在 canvasCtx 为 null 时直接
            // return），而这里原来完全静默 —— 症状是「图表不见了但没有任何报错」。记一条，
            // 并用 couldGetRect 区分「选择器查不到元素」和「查到了但没有 node 实例」：
            // 后者说明这个平台的 canvas 要退回 uni.createCanvasContext。
            appendRingDiagnosticLog('PERIOD PAGE', 'wheel-canvas-node-missing', {
              maxRetries: CANVAS_INIT_MAX_RETRIES,
              couldGetRect: Boolean(res?.[0]?.width || res?.[0]?.height),
              layoutSizePx: layoutSizePx.value,
              canvasId: mainCanvasId
            });
            canvasCtx.value = null;
            resolve();
          }
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          appendRingDiagnosticLog('PERIOD PAGE', 'wheel-canvas-context-missing', { canvasId: mainCanvasId });
          resolve();
          return;
        }
        const dpr = uni.getSystemInfoSync().pixelRatio || 1;
        canvas.width = L * dpr;
        canvas.height = L * dpr;
        ctx.scale(dpr, dpr);
        canvasCtx.value = ctx as CanvasRenderingContext2D;
        canvasNode.value = canvas;
        // 只记第一次：这几行能确认 App 端的 node 取法确实走通了（`fields({node:true})` 是否
        // 可用在各平台并不一致，仓库里的 l-echart 就为它写了 createCanvasContext 兜底）。
        if (!hasLoggedCanvasReady) {
          hasLoggedCanvasReady = true;
          appendRingDiagnosticLog('PERIOD PAGE', 'wheel-canvas-ready', {
            layoutSizePx: layoutSizePx.value,
            dpr
          });
        }
        resolve();
      });
  });
}

function measureWheel(): Promise<void> {
  return new Promise((resolve) => {
    nextTick(() => {
      uni
        .createSelectorQuery()
        .in(instance?.proxy as any)
        .select(`#${wheelWrapId}`)
        .boundingClientRect()
        .exec((res: unknown) => {
          const rect = Array.isArray(res) ? (res[0] as { width?: number }) : (res as { width?: number });
          const w = rect?.width && rect.width > 8 ? rect.width : BASE_WRAPPER;
          layoutSizePx.value = w;
          resolve();
        });
    });
  });
}

function handleLayoutChange() {
  canvasCtx.value = null;
  measureWheel().then(() => {
    nextTick(() => {
      initCanvas().then(() => {
        initRing();
        syncFromCycleDay();
      });
    });
  });
}

onMounted(() => {
  nextTick(() => {
    setTimeout(() => handleLayoutChange(), 50);
  });
  uni.onWindowResize?.(handleLayoutChange);
});

onUnmounted(() => {
  canvasCtx.value = null;
  canvasNode.value = null;
  uni.offWindowResize?.(handleLayoutChange);
});
</script>

<style scoped lang="scss">
.cycle-wheel {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 32rpx 24rpx;
  box-sizing: border-box;
}

.cycle-wrapper {
  position: relative;
  width: 640rpx;
  height: 640rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cycle-canvas {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 0;
}

.cycle-overlay {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 87.5%;
  height: 87.5%;
  box-sizing: border-box;
  border-radius: 50%;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  pointer-events: none;

  &.phase-menstrual {
    --phase-color: #ff4081;
  }
  &.phase-follicular {
    --phase-color: #9c27b0;
  }
  &.phase-ovulation {
    --phase-color: #3f51b5;
  }
  &.phase-luteal {
    --phase-color: #ff9800;
  }
}

.cycle-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.cycle-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.cycle-phase {
  font-size: 28rpx;
  color: #333;
  margin-bottom: 8rpx;
}

.cycle-day {
  display: block;
  font-size: 56rpx;
  font-weight: 700;
  color: #1a1a1a;
  line-height: 1.25;
  letter-spacing: 0.02em;
}

.cycle-edit {
  margin-top: 24rpx;
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: var(--phase-color, #ff4081);
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(255, 64, 129, 0.35);
  flex-shrink: 0;

  .phase-follicular & {
    box-shadow: 0 2px 8px rgba(156, 39, 176, 0.35);
  }
  .phase-ovulation & {
    box-shadow: 0 2px 8px rgba(63, 81, 181, 0.35);
  }
  .phase-luteal & {
    box-shadow: 0 2px 8px rgba(255, 152, 0, 0.35);
  }
}

.cycle-edit-icon {
  color: #ffffff;
  font-size: 38rpx;
  line-height: 80rpx;
  text-align: center;
}

.cycle-edit--hover {
  opacity: 0.88;
}

.cycle-legend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  margin-top: 40rpx;
  flex-wrap: wrap;
  width: 100%;
  padding: 0 16rpx;
  box-sizing: border-box;
  font-size: 24rpx;
  color: #666;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 10rpx;

  &.active {
    font-weight: 600;
    color: #1a1a1a;
  }
}

.legend-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  flex-shrink: 0;

  &.menstrual {
    background: #ff4081;
  }
  &.follicular {
    background: #9c27b0;
  }
  &.ovulation {
    background: #3f51b5;
  }
  &.luteal {
    background: #ff9800;
  }
}
</style>
