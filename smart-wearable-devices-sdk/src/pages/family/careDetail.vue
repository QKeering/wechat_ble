<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import {
  getFamilyDashboard,
  getFamilyMotionOverview,
  getFamilyRelationDashboard,
  getFamilyRelationMotionOverview,
  getFamilyRelationSleepOverview,
  getFamilyRelationVitalSign,
  getFamilySleepOverview,
  getFamilyVitalSign,
  type FamilyDashboard,
} from '@/common/api/family'

type AnyRecord = Record<string, any>
type ModuleKey = 'sleep' | 'heart' | 'oxygen' | 'steps'

const memberId = ref(0)
const relationId = ref(0)
const routeName = ref('亲友')
const dashboard = ref<FamilyDashboard | null>(null)
const vital = ref<AnyRecord>({})
const sleep = ref<AnyRecord>({})
const motion = ref<AnyRecord>({})
const activeModule = ref<ModuleKey>('sleep')
const loading = ref(false)
const loadFailed = ref(false)
const fromCache = ref(false)

const unwrap = (value: any) => value?.data ?? value ?? {}
const today = () => {
  const value = new Date()
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const cacheKey = computed(() => `family-care-detail:${relationId.value || `member-${memberId.value}`}`)
const member = computed<AnyRecord>(() => dashboard.value?.member || {})
const device = computed<AnyRecord>(() => dashboard.value?.device || {})
const summary = computed<AnyRecord>(() => dashboard.value?.summary || {})
const displayName = computed(() => member.value.name || routeName.value || '亲友')
const permissions = computed<Record<string, boolean> | null>(() => {
  const value = member.value.permissions
  return value && typeof value === 'object' ? value : null
})
const canRead = (key: string) => permissions.value ? permissions.value[key] !== false : true

const modules = computed<Array<{ key: ModuleKey; label: string }>>(() => [
  canRead('sleep') ? { key: 'sleep', label: '睡眠' } : null,
  canRead('vitalSigns') ? { key: 'heart', label: '心率' } : null,
  canRead('vitalSigns') ? { key: 'oxygen', label: '血氧' } : null,
  canRead('motion') ? { key: 'steps', label: '步数' } : null,
].filter(Boolean) as Array<{ key: ModuleKey; label: string }>)

const sharedLabels = computed(() => {
  const labels: string[] = []
  if (canRead('sleep')) labels.push('睡眠')
  if (canRead('vitalSigns')) labels.push('心率', '血氧')
  if (canRead('motion')) labels.push('步数')
  if (canRead('stress')) labels.push('情绪')
  return labels
})

const lastSync = computed(() => device.value.lastSyncTime || member.value.lastSyncTime || '')
const isFresh = computed(() => String(lastSync.value).slice(0, 10) === today())
const lastSyncText = computed(() => {
  if (!lastSync.value) return '暂无同步记录'
  const text = String(lastSync.value).replace('T', ' ')
  return isFresh.value ? `今天 ${text.slice(11, 16)}` : text.slice(0, 16)
})

function numberOf(...values: any[]) {
  const value = values.find(item => item !== '' && item !== null && item !== undefined && Number.isFinite(Number(item)))
  return value === undefined ? null : Number(value)
}

function rounded(value: any, fallback = '--') {
  const number = numberOf(value)
  return number === null ? fallback : String(Math.round(number))
}

function minutesLabel(value: any) {
  const minutes = Math.max(0, Math.round(numberOf(value) || 0))
  if (!minutes) return '--'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours}小时${rest}分` : `${rest}分钟`
}

function timeLabel(value: any) {
  if (!value) return '--:--'
  const text = String(value).replace('T', ' ')
  return text.length >= 16 ? text.slice(11, 16) : text.slice(-5)
}

const sleepData = computed(() => ({
  total: numberOf(sleep.value.sleepDuration, summary.value.sleepDuration, summary.value.sleepDurationMinutes) || 0,
  score: numberOf(sleep.value.sleepScore, summary.value.sleepScore),
  deep: numberOf(sleep.value.deepSleepDuration) || 0,
  light: numberOf(sleep.value.lightSleepDuration) || 0,
  rem: numberOf(sleep.value.remSleepDuration) || 0,
  awake: numberOf(sleep.value.awakeDuration) || 0,
  start: sleep.value.sleepStartTime,
  end: sleep.value.sleepEndTime,
}))
const sleepHasData = computed(() => sleepData.value.total > 0)
const sleepSegments = computed(() => {
  const data = sleepData.value
  const total = Math.max(data.deep + data.light + data.rem + data.awake, 1)
  return [
    { key: 'deep', label: '深睡', value: data.deep, width: `${Math.max(0, data.deep / total * 100)}%` },
    { key: 'light', label: '浅睡', value: data.light, width: `${Math.max(0, data.light / total * 100)}%` },
    { key: 'rem', label: '快速眼动', value: data.rem, width: `${Math.max(0, data.rem / total * 100)}%` },
    { key: 'awake', label: '清醒', value: data.awake, width: `${Math.max(0, data.awake / total * 100)}%` },
  ]
})
const sleepTrend = computed(() => {
  const rows = Array.isArray(sleep.value.trend7d) ? sleep.value.trend7d : []
  const maximum = Math.max(...rows.map((item: AnyRecord) => Number(item.sleepDuration || 0)), 1)
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  return rows.map((item: AnyRecord) => {
    const dateValue = String(item.date || '')
    const dateObject = new Date(`${dateValue}T00:00:00`)
    const duration = Number(item.sleepDuration || 0)
    return {
      date: dateValue,
      day: dateValue === today() ? '今天' : `周${labels[dateObject.getDay()] || ''}`,
      label: duration ? `${(duration / 60).toFixed(1)}h` : '--',
      height: `${Math.max(duration ? 12 : 3, duration / maximum * 100)}%`,
      today: dateValue === today(),
    }
  })
})

const heartAvg = computed(() => numberOf(vital.value.heartRateAvg, vital.value.heartRate, summary.value.heartRateAvg))
const heartMin = computed(() => numberOf(vital.value.summary?.heartRateMin, summary.value.heartRateMin))
const heartMax = computed(() => numberOf(vital.value.summary?.heartRateMax, summary.value.heartRateMax))
const oxygenAvg = computed(() => numberOf(vital.value.spo2Avg, vital.value.spo2, summary.value.spo2Avg))
const oxygenMin = computed(() => numberOf(vital.value.summary?.spo2Min, summary.value.spo2Min))
const oxygenMax = computed(() => numberOf(vital.value.summary?.spo2Max, summary.value.spo2Max))

function chartBars(source: any, minimum: number, maximum: number) {
  const rows = Array.isArray(source) ? source : []
  if (!rows.length) return []
  const step = Math.max(1, Math.ceil(rows.length / 24))
  return rows.filter((_: AnyRecord, index: number) => index % step === 0).slice(0, 24).map((item: AnyRecord) => {
    const value = numberOf(item.value, item.y, item.heartRate, item.spo2) || minimum
    const percent = Math.max(8, Math.min(100, (value - minimum) / Math.max(maximum - minimum, 1) * 100))
    return { value, height: `${percent}%`, time: item.time || item.recordTime || '' }
  })
}
const heartBars = computed(() => chartBars(vital.value.heartRateChart, 20, 180))
const oxygenBars = computed(() => chartBars(vital.value.spo2Chart, 80, 100))

const stepValue = computed(() => numberOf(motion.value.step, summary.value.totalSteps, summary.value.steps) || 0)
const stepTarget = computed(() => numberOf(motion.value.stepTarget, motion.value.stepsTarget, motion.value.targetSteps) || 8000)
const stepPercent = computed(() => Math.min(100, Math.round(stepValue.value / Math.max(stepTarget.value, 1) * 100)))
const calorie = computed(() => numberOf(motion.value.calorie, summary.value.totalCalorie))
const motionTime = computed(() => numberOf(motion.value.motionTime, summary.value.activeTime))

function restoreCache() {
  try {
    const value = uni.getStorageSync(cacheKey.value)
    if (!value || (value.memberId !== memberId.value && value.relationId !== relationId.value)) return
    dashboard.value = value.dashboard || null
    vital.value = value.vital || {}
    sleep.value = value.sleep || {}
    motion.value = value.motion || {}
    fromCache.value = true
  } catch {}
}

function saveCache() {
  try {
    uni.setStorageSync(cacheKey.value, {
      memberId: memberId.value,
      relationId: relationId.value,
      dashboard: dashboard.value,
      vital: vital.value,
      sleep: sleep.value,
      motion: motion.value,
      cachedAt: Date.now(),
    })
  } catch {}
}

async function loadDetail(showLoading = true) {
  if ((!memberId.value && !relationId.value) || loading.value) return
  loading.value = true
  loadFailed.value = false
  try {
    const dashboardResult = relationId.value
      ? await getFamilyRelationDashboard(relationId.value)
      : await getFamilyDashboard({ memberId: memberId.value })
    dashboard.value = unwrap(dashboardResult)
    memberId.value = Number(dashboard.value?.member?.id || memberId.value || 0)

    const date = today()
    const requests: Array<{ key: 'vital' | 'sleep' | 'motion'; promise: Promise<any> }> = []
    if (canRead('vitalSigns')) requests.push({
      key: 'vital',
      promise: relationId.value
        ? getFamilyRelationVitalSign(relationId.value, { date })
        : getFamilyVitalSign({ memberId: memberId.value, date }),
    })
    if (canRead('sleep')) requests.push({
      key: 'sleep',
      promise: relationId.value
        ? getFamilyRelationSleepOverview(relationId.value, { date })
        : getFamilySleepOverview({ memberId: memberId.value, date }),
    })
    if (canRead('motion')) requests.push({
      key: 'motion',
      promise: relationId.value
        ? getFamilyRelationMotionOverview(relationId.value, { date })
        : getFamilyMotionOverview({ memberId: memberId.value, date }),
    })
    const results = await Promise.allSettled(requests.map(item => item.promise))
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return
      const value = unwrap(result.value)
      if (requests[index].key === 'vital') vital.value = value
      if (requests[index].key === 'sleep') sleep.value = value
      if (requests[index].key === 'motion') motion.value = value
    })
    const firstModule = modules.value[0]?.key
    if (firstModule && !modules.value.some(item => item.key === activeModule.value)) activeModule.value = firstModule
    fromCache.value = false
    saveCache()
  } catch {
    loadFailed.value = !dashboard.value
    if (showLoading) uni.showToast({ title: dashboard.value ? '网络异常，已显示上次数据' : '健康明细加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function goBack() {
  uni.navigateBack()
}

onLoad((query?: AnyRecord) => {
  memberId.value = Number(query?.memberId || 0)
  relationId.value = Number(query?.relationId || 0)
  routeName.value = decodeURIComponent(String(query?.name || '亲友'))
  restoreCache()
  loadDetail()
})

onPullDownRefresh(async () => {
  try { await loadDetail(false) }
  finally { uni.stopPullDownRefresh() }
})
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="back" @tap="goBack">‹</view>
      <text class="nav-title">亲友健康明细</text>
      <view class="nav-space" />
    </view>

    <view v-if="loadFailed" class="state-card">
      <text class="state-title">暂时无法加载健康明细</text>
      <text class="state-desc">请检查网络后重试</text>
      <button class="retry" @tap="loadDetail()">重新加载</button>
    </view>

    <template v-else>
      <view class="card hero">
        <view class="person">
          <view class="avatar">{{ displayName.slice(0, 1) }}</view>
          <view class="person-main">
            <text class="person-name">{{ displayName }}的健康数据</text>
            <text class="sync-text">最近同步：{{ lastSyncText }}</text>
          </view>
          <text class="sync-tag" :class="{ stale: !isFresh }">{{ isFresh ? '已同步' : '最近数据' }}</text>
        </view>
        <view v-if="sharedLabels.length" class="share-list">
          <text v-for="(label, index) in sharedLabels" :key="label" class="share-dot">{{ index === 0 ? `已共享：${label}` : label }}</text>
        </view>
        <view class="freshness" :class="{ stale: !isFresh }">
          <view>
            <text class="fresh-title">{{ fromCache ? '当前展示上次同步数据' : (isFresh ? '今日数据已更新' : '今日暂未同步新数据') }}</text>
            <text class="fresh-desc">亲情关怀数据和提醒仅用于日常健康关注，不属于医疗监护服务。</text>
          </view>
        </view>
      </view>

      <view v-if="modules.length" class="module-tabs" :style="{ gridTemplateColumns: `repeat(${modules.length}, 1fr)` }">
        <view v-for="item in modules" :key="item.key" class="module-tab" :class="{ active: activeModule === item.key }" @tap="activeModule = item.key">
          {{ item.label }}
        </view>
      </view>

      <view v-if="!modules.length" class="card empty-card">
        <text class="empty-title">对方暂未共享健康明细</text>
        <text class="empty-desc">共享权限更新后即可在这里查看</text>
      </view>

      <view v-else-if="activeModule === 'sleep'" class="card panel">
        <view class="section-head">
          <view><text class="section-title">昨夜睡眠</text><text class="section-subtitle">阶段分布与近 7 天睡眠时长</text></view>
          <text v-if="sleepData.score !== null" class="tag">评分 {{ rounded(sleepData.score) }}</text>
        </view>
        <template v-if="sleepHasData">
          <view class="sleep-total"><text class="big-number">{{ minutesLabel(sleepData.total) }}</text><text class="big-label">总睡眠</text></view>
          <view class="kpi-grid">
            <view v-for="item in sleepSegments.slice(0, 3)" :key="item.key" class="kpi"><text class="kpi-num">{{ minutesLabel(item.value) }}</text><text class="kpi-label">{{ item.label }}</text></view>
          </view>
          <view class="timeline">
            <view class="time-row"><text>{{ timeLabel(sleepData.start) }}</text><text>{{ timeLabel(sleepData.end) }}</text></view>
            <view class="sleep-bar"><view v-for="item in sleepSegments" :key="item.key" class="segment" :class="item.key" :style="{ width: item.width }" /></view>
            <view class="legend"><view v-for="item in sleepSegments" :key="item.key" class="legend-item"><text class="legend-dot" :class="item.key" />{{ item.label }}</view></view>
          </view>
          <view v-if="sleepTrend.length" class="trend-head"><view><text class="trend-title">近 7 天睡眠</text><text class="trend-subtitle">单位：小时</text></view></view>
          <view v-if="sleepTrend.length" class="bars">
            <view v-for="item in sleepTrend" :key="item.date" class="bar-column">
              <text class="bar-value">{{ item.label }}</text><view class="bar-track"><view class="bar-fill sleep-fill" :class="{ today: item.today }" :style="{ height: item.height }" /></view><text class="bar-day">{{ item.day }}</text>
            </view>
          </view>
        </template>
        <view v-else class="empty"><text class="empty-title">暂无睡眠数据</text><text class="empty-desc">待对方佩戴设备并完成同步后显示</text></view>
      </view>

      <view v-else-if="activeModule === 'heart'" class="card panel">
        <view class="section-head"><view><text class="section-title">心率</text><text class="section-subtitle">今日心率趋势</text></view><text class="tag">次/分</text></view>
        <template v-if="heartAvg !== null || heartBars.length">
          <view class="kpi-grid">
            <view class="kpi"><text class="kpi-num">{{ rounded(heartAvg) }}</text><text class="kpi-label">平均心率</text></view>
            <view class="kpi"><text class="kpi-num">{{ rounded(heartMin) }}</text><text class="kpi-label">最低心率</text></view>
            <view class="kpi"><text class="kpi-num">{{ rounded(heartMax) }}</text><text class="kpi-label">最高心率</text></view>
          </view>
          <view class="vital-chart-wrap">
            <view class="vital-y-axis"><text>180</text><text>140</text><text>100</text><text>60</text><text>20</text></view>
            <view class="vital-chart-content">
              <view class="chart-bars vital-chart-bars"><view v-for="(item, index) in heartBars" :key="index" class="chart-column"><view class="chart-fill heart-fill" :style="{ height: item.height }" /></view></view>
              <view class="axis"><text>00:00</text><text>12:00</text><text>24:00</text></view>
            </view>
          </view>
        </template>
        <view v-else class="empty"><text class="empty-title">暂无心率数据</text><text class="empty-desc">待对方完成设备同步后显示</text></view>
      </view>

      <view v-else-if="activeModule === 'oxygen'" class="card panel">
        <view class="section-head"><view><text class="section-title">血氧饱和度</text><text class="section-subtitle">今日血氧趋势</text></view></view>
        <template v-if="oxygenAvg !== null || oxygenBars.length">
          <view class="kpi-grid">
            <view class="kpi"><text class="kpi-num">{{ rounded(oxygenAvg) }}<text class="kpi-unit">%</text></text><text class="kpi-label">平均血氧</text></view>
            <view class="kpi"><text class="kpi-num">{{ rounded(oxygenMin) }}<text class="kpi-unit">%</text></text><text class="kpi-label">最低血氧</text></view>
            <view class="kpi"><text class="kpi-num">{{ rounded(oxygenMax) }}<text class="kpi-unit">%</text></text><text class="kpi-label">最高血氧</text></view>
          </view>
          <view class="vital-chart-wrap">
            <view class="vital-y-axis"><text>100</text><text>95</text><text>90</text><text>85</text><text>80</text></view>
            <view class="vital-chart-content">
              <view class="chart-bars vital-chart-bars"><view v-for="(item, index) in oxygenBars" :key="index" class="chart-column"><view class="chart-fill oxygen-fill" :style="{ height: item.height }" /></view></view>
              <view class="axis"><text>00:00</text><text>12:00</text><text>24:00</text></view>
            </view>
          </view>
        </template>
        <view v-else class="empty"><text class="empty-title">暂无血氧数据</text><text class="empty-desc">待对方完成设备同步后显示</text></view>
      </view>

      <view v-else class="card panel">
        <view class="section-head"><view><text class="section-title">今日步数</text><text class="section-subtitle">活动完成情况</text></view><text class="tag green">{{ stepPercent }}%</text></view>
        <template v-if="stepValue > 0">
          <view class="step-total"><text class="step-number">{{ stepValue }}</text><text class="step-unit">步</text></view>
          <view class="progress-head"><text>目标 {{ stepTarget }} 步</text><text>{{ stepValue }} / {{ stepTarget }}</text></view>
          <view class="progress"><view class="progress-value" :style="{ width: `${stepPercent}%` }" /></view>
          <view class="kpi-grid two">
            <view class="kpi"><text class="kpi-num">{{ rounded(calorie) }}</text><text class="kpi-label">消耗（千卡）</text></view>
            <view class="kpi"><text class="kpi-num">{{ rounded(motionTime) }}</text><text class="kpi-label">活动（分钟）</text></view>
          </view>
        </template>
        <view v-else class="empty"><text class="empty-title">暂无步数数据</text><text class="empty-desc">待对方完成设备同步后显示</text></view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.page{min-height:100vh;box-sizing:border-box;padding:0 28rpx 72rpx;background:radial-gradient(circle at 10% 3%,rgba(109,153,255,.25),transparent 31%),radial-gradient(circle at 94% 0,rgba(213,246,222,.82),transparent 32%),linear-gradient(180deg,#eef5ff 0,#f4f6fa 42%,#f2f4f8 100%)}
.nav{height:176rpx;padding-top:70rpx;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between}.back,.nav-space{width:72rpx}.back{font-size:66rpx;line-height:1;color:#202938}.nav-title{font-size:36rpx;font-weight:900;color:#111827}
.card,.state-card{margin-top:26rpx;border:2rpx solid rgba(255,255,255,.74);border-radius:52rpx;background:rgba(255,255,255,.94);box-shadow:0 26rpx 52rpx rgba(70,82,104,.08)}.hero,.panel,.state-card{padding:30rpx}.person{display:grid;grid-template-columns:96rpx 1fr auto;gap:22rpx;align-items:center}.avatar{display:flex;align-items:center;justify-content:center;width:96rpx;height:96rpx;border-radius:34rpx;color:#fff;font-size:38rpx;font-weight:900;background:linear-gradient(145deg,#6f8fff,#5ed1b8);box-shadow:0 20rpx 38rpx rgba(69,115,223,.2)}.person-main{min-width:0}.person-name,.sync-text{display:block}.person-name{font-size:33rpx;font-weight:900;color:#111827}.sync-text{margin-top:8rpx;font-size:23rpx;color:#738096}.sync-tag,.tag{flex:none;padding:12rpx 18rpx;border-radius:999rpx;color:#11845b;background:#e6f8ef;font-size:22rpx;font-weight:800}.sync-tag.stale{color:#667085;background:#eef2f7}.share-list{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:24rpx}.share-dot{padding:11rpx 16rpx;border-radius:999rpx;color:#516079;background:rgba(244,247,252,.9);font-size:21rpx;font-weight:800}.freshness{margin-top:26rpx;padding:22rpx;border-radius:36rpx;background:rgba(237,244,255,.86)}.freshness.stale{background:#f3f5f9}.fresh-title,.fresh-desc{display:block}.fresh-title{font-size:25rpx;font-weight:850;color:#263244}.fresh-desc{margin-top:6rpx;font-size:21rpx;line-height:1.5;color:#718096}
.module-tabs{position:sticky;top:0;z-index:3;display:grid;gap:12rpx;margin-top:26rpx;padding:14rpx;border-radius:40rpx;background:rgba(255,255,255,.88);box-shadow:0 18rpx 40rpx rgba(70,82,104,.08)}.module-tab{padding:18rpx 0;text-align:center;border-radius:28rpx;color:#64748b;font-size:25rpx;font-weight:900}.module-tab.active{color:#fff;background:linear-gradient(135deg,#3474ff,#5a8dff);box-shadow:0 16rpx 30rpx rgba(52,116,255,.22)}
.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20rpx}.section-title,.section-subtitle{display:block}.section-title{font-size:38rpx;font-weight:900;color:#111827}.section-subtitle{margin-top:8rpx;font-size:23rpx;line-height:1.5;color:#7b8494}.tag{color:#3474ff;background:#edf4ff}.tag.green{color:#11845b;background:#e6f8ef}.sleep-total{display:flex;align-items:flex-end;gap:12rpx;margin-top:28rpx}.big-number{font-size:50rpx;font-weight:900;color:#1f2937}.big-label{padding-bottom:7rpx;font-size:23rpx;color:#7b8494}.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16rpx;margin-top:26rpx}.kpi-grid.two{grid-template-columns:repeat(2,1fr)}.kpi{padding:22rpx 14rpx;border-radius:32rpx;background:#f7f9fc}.kpi-num,.kpi-label{display:block}.kpi-num{font-size:29rpx;font-weight:900;color:#1f2937}.kpi-unit{margin-left:3rpx;font-size:20rpx;font-weight:800;color:#667085}.kpi-label{margin-top:8rpx;font-size:21rpx;color:#8791a2}.timeline{margin-top:26rpx;padding:22rpx;border-radius:36rpx;background:#f7f9fc}.time-row,.progress-head,.axis{display:flex;align-items:center;justify-content:space-between;font-size:22rpx;font-weight:800;color:#687387}.sleep-bar{overflow:hidden;display:flex;height:24rpx;margin:20rpx 0 14rpx;border-radius:999rpx;background:#eef2f8}.segment.deep,.legend-dot.deep{background:#5b61f6}.segment.light,.legend-dot.light{background:#b8b4ff}.segment.rem,.legend-dot.rem{background:#8bead6}.segment.awake,.legend-dot.awake{background:#ffb37a}.legend{display:flex;flex-wrap:wrap;gap:16rpx;font-size:20rpx;color:#758096}.legend-item{display:flex;align-items:center}.legend-dot{width:14rpx;height:14rpx;margin-right:7rpx;border-radius:50%}.trend-head{margin-top:28rpx}.trend-title,.trend-subtitle{display:block}.trend-title{font-size:28rpx;font-weight:900;color:#1f2937}.trend-subtitle{margin-top:5rpx;font-size:20rpx;color:#8a94a6}.bars{display:flex;align-items:stretch;gap:12rpx;height:250rpx;margin-top:18rpx;padding:10rpx 10rpx 0;border-radius:36rpx;background:linear-gradient(180deg,transparent 0 30%,rgba(148,163,184,.14) 30% 31%,transparent 31% 62%,rgba(148,163,184,.14) 62% 63%,transparent 63%),#f7f9fc}.bar-column{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center}.bar-value,.bar-day{font-size:18rpx;color:#8b95a7}.bar-track{flex:1;width:24rpx;display:flex;align-items:flex-end;margin:8rpx 0}.bar-fill{width:100%;min-height:6rpx;border-radius:999rpx 999rpx 8rpx 8rpx}.sleep-fill{background:linear-gradient(180deg,#7c8cff,#b9b5ff)}.sleep-fill.today{background:linear-gradient(180deg,#5667ff,#9a95ff);box-shadow:0 12rpx 24rpx rgba(52,116,255,.16)}
.chart-bars{height:260rpx;display:flex;align-items:flex-end;gap:5rpx;margin-top:28rpx;padding:24rpx 20rpx 0;border-radius:38rpx;background:linear-gradient(180deg,transparent 24%,rgba(148,163,184,.13) 24% 25%,transparent 25% 49%,rgba(148,163,184,.13) 49% 50%,transparent 50% 74%,rgba(148,163,184,.13) 74% 75%),#f7f9fc}.chart-column{flex:1;height:100%;display:flex;align-items:flex-end}.chart-fill{width:100%;min-height:8rpx;border-radius:999rpx 999rpx 5rpx 5rpx}.heart-fill{background:linear-gradient(180deg,#ff7d83,#ffb1a7)}.oxygen-fill{background:linear-gradient(180deg,#46d6b5,#8bead6)}.axis{padding:14rpx 22rpx 0;font-size:19rpx;color:#98a2b3}.step-total{margin-top:34rpx}.step-number{font-size:76rpx;font-weight:900;color:#1f2937}.step-unit{margin-left:10rpx;font-size:25rpx;color:#687387}.progress-head{margin-top:28rpx}.progress{height:22rpx;overflow:hidden;margin-top:18rpx;border-radius:999rpx;background:#e8edf5}.progress-value{height:100%;border-radius:inherit;background:linear-gradient(90deg,#41d0b2,#3474ff)}
.vital-chart-wrap{display:grid;grid-template-columns:52rpx minmax(0,1fr);gap:10rpx;margin-top:28rpx}.vital-y-axis{box-sizing:border-box;height:260rpx;padding:18rpx 0 2rpx;display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;color:#98a2b3;font-size:18rpx;line-height:1}.vital-chart-content{min-width:0}.vital-chart-bars{margin-top:0}.vital-chart-content .axis{padding-left:20rpx;padding-right:20rpx}
.empty,.empty-card,.state-card{display:flex;flex-direction:column;align-items:center;text-align:center}.empty{min-height:260rpx;justify-content:center;margin-top:24rpx;border-radius:36rpx;background:#f7f9fc}.empty-card,.state-card{padding:60rpx 30rpx}.empty-title,.state-title{font-size:29rpx;font-weight:900;color:#273142}.empty-desc,.state-desc{margin-top:12rpx;font-size:23rpx;color:#939ba8}.retry{height:72rpx;margin-top:28rpx;padding:0 38rpx;border:0;border-radius:999rpx;background:#2e70fc;color:#fff;font-size:25rpx;line-height:72rpx}.retry::after{border:0}
</style>
