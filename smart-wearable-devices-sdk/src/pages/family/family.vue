<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import {
  acceptFamilyInvite,
  getFamilyDashboard,
  getFamilyHome,
  getFamilyInvitePreview,
  getFamilyInvites,
  getFamilyRelationDashboard,
  updateFamilyRelation,
  type FamilyInvitePreview,
} from '@/common/api/family'

type AnyRecord = Record<string, any>
const home = ref<AnyRecord>({ members: [] })
const pendingInvites = ref<AnyRecord[]>([])
const selectedId = ref<number | string | null>(null)
const dashboard = ref<AnyRecord>({})
const loading = ref(false)
const dashboardLoading = ref(false)
const loadFailed = ref(false)
const inviteCode = ref('')
const invitePreview = ref<FamilyInvitePreview | null>(null)
const inviteLoading = ref(false)
const inviteSubmitting = ref(false)
const inviteError = ref('')
const remarkSubmitting = ref(false)

const unwrap = (value: any) => value?.data ?? value ?? {}
const members = computed<AnyRecord[]>(() => home.value?.members || [])
const selectedMember = computed(() => members.value.find(item => String(item.id) === String(selectedId.value)) || members.value[0])
const normalizedInviteCode = computed(() => inviteCode.value.trim().toUpperCase())
const acceptDisabled = computed(() => (
  inviteLoading.value || inviteSubmitting.value || !normalizedInviteCode.value || invitePreview.value?.canAccept === false
))

function pickNumber(...values: any[]) {
  const target = values.find(value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)))
  return target === undefined ? null : Number(target)
}

function readablePermission(member: AnyRecord) {
  const permissions = member?.permissions
  if (!permissions || typeof permissions !== 'object') return true
  return Object.values(permissions).some(Boolean)
}

const summary = computed(() => {
  const data = dashboard.value || {}
  const member = selectedMember.value || {}
  const overview = data.summary || data.overview || {}
  const health = data.health || data.healthData || {}
  const metrics = data.member?.metrics || member.metrics || {}
  const sleep = data.sleep || health.sleep || {}
  const motion = data.motion || health.motion || {}
  const vital = data.vitalSign || data.vitals || health.vitalSign || {}
  const stress = data.stress || health.stress || {}
  const sleepMinutes = pickNumber(
    overview.sleepDuration,
    overview.sleepDurationMinutes,
    overview.sleepMinutes,
    overview.totalSleepMinutes,
    sleep.sleepDuration,
    sleep.sleepDurationMinutes,
    sleep.totalMinutes,
    sleep.sleepMinutes,
    metrics.sleepDuration,
    metrics.sleepMinutes
  )
  return {
    sleep: sleepMinutes === null ? '--' : `${Math.floor(sleepMinutes / 60)}小时${Math.round(sleepMinutes % 60)}分`,
    heartRate: pickNumber(overview.heartRate, overview.avgHeartRate, vital.heartRate, vital.avgHeartRate, metrics.heartRate),
    spo2: pickNumber(overview.spo2, overview.avgSpo2, vital.spo2, vital.avgSpo2, metrics.spo2),
    steps: pickNumber(overview.steps, motion.steps, metrics.steps),
    emotion: overview.emotion || overview.stressText || stress.emotion || stress.statusText || metrics.emotion || '放松',
    lastSync: data.device?.lastSyncTime || member.lastSyncTime || member.syncTime || '暂无同步记录',
    connected: Boolean(data.device?.connected ?? member.connected ?? member.isConnected)
  }
})

const formatMetric = (value: number | null, suffix = '') => value === null ? '--' : `${Math.round(value)}${suffix}`

async function loadDashboard(member?: AnyRecord) {
  if (!member) { dashboard.value = {}; return }
  dashboardLoading.value = true
  try {
    const result = member.relationId
      ? await getFamilyRelationDashboard(member.relationId)
      : await getFamilyDashboard({ memberId: member.id })
    dashboard.value = unwrap(result)
  } catch { dashboard.value = {} }
  finally { dashboardLoading.value = false }
}

async function selectMember(member: AnyRecord) {
  selectedId.value = member.id
  await loadDashboard(member)
}

async function loadPage() {
  if (loading.value) return
  loading.value = true
  loadFailed.value = false
  try {
    const [homeResult, inviteResult] = await Promise.all([getFamilyHome(), getFamilyInvites()])
    home.value = unwrap(homeResult)
    const inviteList = unwrap(inviteResult)
    pendingInvites.value = (Array.isArray(inviteList) ? inviteList : inviteList?.list || []).filter((item: AnyRecord) => {
      const status = String(item.status ?? item.statusText ?? '').toLowerCase()
      const isReceived = item.isReceived === true || item.direction === 'received'
      return isReceived && (status === '0' || status === 'pending' || status.includes('待处理') || status.includes('待接受'))
    })
    const target = members.value.find(item => String(item.id) === String(selectedId.value)) || members.value[0]
    selectedId.value = target?.id ?? null
    await loadDashboard(target)
  } catch {
    loadFailed.value = true
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

const goBack = () => uni.navigateBack()
const goShare = () => uni.navigateTo({ url: '/pages/family/shareManage' })

const safeDecode = (value: string) => {
  try { return decodeURIComponent(value) } catch { return value }
}

const parseInviteCode = (value: unknown) => {
  let raw = safeDecode(String(value || '').trim())
  const sceneMatch = raw.match(/(?:^|[?&])scene=([^&#]+)/i)
  if (sceneMatch?.[1]) raw = safeDecode(sceneMatch[1])
  const codeMatch = raw.match(/(?:^|[?&])(?:code|i)=([a-z0-9]+)/i)
  const code = (codeMatch?.[1] || (/^[a-z0-9]{6,16}$/i.test(raw) ? raw : '')).toUpperCase()
  return code
}

const loadInvitePreview = async (code = normalizedInviteCode.value) => {
  const normalizedCode = parseInviteCode(code)
  invitePreview.value = null
  inviteError.value = ''
  if (!normalizedCode) {
    inviteError.value = '请输入有效的邀请码'
    return
  }
  inviteCode.value = normalizedCode
  inviteLoading.value = true
  try {
    invitePreview.value = await getFamilyInvitePreview(normalizedCode)
    if (invitePreview.value?.canAccept === false) {
      inviteError.value = invitePreview.value.disabledReason || '当前邀请不可接受'
    }
  } catch {
    inviteError.value = '邀请码无效或已失效'
  } finally {
    inviteLoading.value = false
  }
}

const confirmAcceptInvite = async (code = normalizedInviteCode.value) => {
  const normalizedCode = parseInviteCode(code)
  if (!normalizedCode || inviteSubmitting.value) return
  if (!invitePreview.value || invitePreview.value.inviteCode !== normalizedCode) {
    await loadInvitePreview(normalizedCode)
  }
  if (!invitePreview.value || invitePreview.value.canAccept === false) return
  inviteSubmitting.value = true
  try {
    await acceptFamilyInvite(normalizedCode)
    uni.showToast({ title: '已接受邀请', icon: 'success' })
    inviteCode.value = ''
    invitePreview.value = null
    inviteError.value = ''
    await loadPage()
  } catch (error: any) {
    uni.showToast({ title: error?.message || '接受失败，请稍后重试', icon: 'none' })
  } finally {
    inviteSubmitting.value = false
  }
}

const acceptPendingInvite = async (invite: AnyRecord) => {
  const code = parseInviteCode(invite.inviteCode || invite.code)
  if (!code) {
    uni.showToast({ title: '邀请信息不完整', icon: 'none' })
    return
  }
  inviteCode.value = code
  await loadInvitePreview(code)
}

const editMemberRemark = () => {
  const member = selectedMember.value
  const relationId = Number(member?.relationId || 0)
  if (!member || !relationId || remarkSubmitting.value) {
    if (!relationId) uni.showToast({ title: '当前关系暂不支持修改备注', icon: 'none' })
    return
  }
  const currentName = String(member.name || member.nickname || '').trim()
  uni.showModal({
    title: '修改家人备注',
    editable: true,
    placeholderText: '请输入家人备注',
    content: currentName,
    confirmText: '保存',
    success: async (result: any) => {
      if (!result.confirm) return
      const displayName = String(result.content || '').trim()
      if (!displayName) {
        uni.showToast({ title: '备注不能为空', icon: 'none' })
        return
      }
      remarkSubmitting.value = true
      try {
        await updateFamilyRelation(relationId, { displayName })
        member.name = displayName
        uni.showToast({ title: '备注已更新', icon: 'success' })
      } catch (error: any) {
        uni.showToast({ title: error?.message || '修改失败，请稍后重试', icon: 'none' })
      } finally {
        remarkSubmitting.value = false
      }
    },
  })
}

const scanInviteCode = () => {
  uni.scanCode({
    onlyFromCamera: true,
    scanType: ['qrCode'],
    success: (result) => {
      const code = parseInviteCode(result.result || result.path)
      if (!code) {
        uni.showToast({ title: '未识别到有效邀请', icon: 'none' })
        return
      }
      inviteCode.value = code
      loadInvitePreview(code)
    },
  })
}
onShow(loadPage)
onLoad((options) => {
  const code = parseInviteCode(options?.scene || options?.code || options?.i)
  if (!code) return
  inviteCode.value = code
  void loadInvitePreview(code)
})
onPullDownRefresh(loadPage)
</script>

<template>
  <view class="page">
    <view class="nav"><text class="back" @tap="goBack">‹</text><text class="nav-title">亲友关怀</text><view class="nav-space" /></view>

    <view v-if="loading && !members.length" class="state-card"><view class="skeleton wide"/><view class="skeleton"/><view class="skeleton short"/></view>
    <view v-else-if="loadFailed" class="state-card center"><text class="state-title">加载失败</text><text class="state-desc">请检查网络后重试</text><button class="minor-button" @tap="loadPage">重新加载</button></view>
    <template v-else>
      <view class="card accept-card">
        <text class="card-title">接受亲友邀请</text>
        <text class="card-desc">通过邀请码或扫码接受定向分享，确认后建立共享关系</text>
        <view class="invite-code-row">
          <input
            v-model="inviteCode"
            class="invite-code-input"
            maxlength="16"
            placeholder="输入邀请码"
            confirm-type="done"
            @input="invitePreview = null; inviteError = ''"
            @confirm="loadInvitePreview()"
          />
          <button class="accept-button" :disabled="acceptDisabled" :loading="inviteSubmitting" @tap="confirmAcceptInvite()">
            接受
          </button>
        </view>
        <view v-if="invitePreview" class="invite-preview">
          <text class="preview-title">{{ invitePreview.inviterName }} 邀请你共享健康数据</text>
          <text class="preview-desc">{{ invitePreview.permissionSummary }}</text>
        </view>
        <text v-if="inviteError" class="invite-error">{{ inviteError }}</text>
        <button class="scan-button" :disabled="inviteLoading || inviteSubmitting" @tap="scanInviteCode">
          {{ inviteLoading ? '正在确认邀请' : '扫码接受邀请' }}
        </button>
      </view>
      <view v-if="pendingInvites.length" class="card pending-card">
        <text class="card-title">待处理邀请</text>
        <view v-for="invite in pendingInvites" :key="invite.id || invite.inviteCode" class="pending-item">
          <view class="pending-avatar">{{ (invite.inviterName || '亲').slice(0, 1) }}</view>
          <view class="grow">
            <text class="pending-name">{{ invite.inviterName || '亲友邀请' }}</text>
            <text class="card-desc">邀请你查看共享的健康数据</text>
          </view>
          <button class="pending-accept" @tap="acceptPendingInvite(invite)">查看</button>
        </view>
      </view>

      <view class="section-head"><text class="section-title">我的亲友</text></view>
      <view v-if="members.length" class="member-tabs">
        <view v-for="item in members" :key="item.id" class="member-pill" :class="{ active: String(item.id) === String(selectedId) }" @tap="selectMember(item)">
          <view class="avatar">{{ (item.name || item.nickname || '亲').slice(0, 1) }}</view><text>{{ item.name || item.nickname || '亲友' }}</text>
        </view>
      </view>

      <view v-if="selectedMember" class="card health-card">
        <view class="health-head">
          <view class="health-title">
            <text class="card-title">{{ selectedMember.name || selectedMember.nickname || '亲友' }}的健康摘要</text>
            <text class="card-desc">{{ summary.lastSync }}</text>
          </view>
          <view class="health-actions">
            <text class="edit-remark" @tap.stop="editMemberRemark">修改备注</text>
            <view class="status" :class="{ online: summary.connected }">{{ summary.connected ? '设备在线' : '最近数据' }}</view>
          </view>
        </view>
        <view v-if="!readablePermission(selectedMember)" class="permission-empty"><text class="empty-icon">♡</text><text class="empty-title">对方暂未开放健康数据</text><text class="empty-desc">授权后，健康摘要会显示在这里</text></view>
        <view v-else-if="dashboardLoading" class="metric-grid"><view v-for="i in 6" :key="i" class="metric skeleton-box"/></view>
        <view v-else class="metric-grid">
          <view class="metric"><text class="metric-label">睡眠</text><text class="metric-value">{{ summary.sleep }}</text></view>
          <view class="metric"><text class="metric-label">平均心率</text><text class="metric-value">{{ formatMetric(summary.heartRate, '次/分') }}</text></view>
          <view class="metric"><text class="metric-label">平均血氧</text><text class="metric-value">{{ formatMetric(summary.spo2, '%') }}</text></view>
          <view class="metric"><text class="metric-label">今日步数</text><text class="metric-value">{{ formatMetric(summary.steps, '步') }}</text></view>
          <view class="metric metric-wide"><text class="metric-label">情绪状态</text><text class="metric-value blue">{{ summary.emotion }}</text></view>
        </view>
      </view>
      <view v-else class="card empty-friends"><view class="empty-orbit">♡</view><text class="empty-title">还没有共享数据的亲友</text><text class="empty-desc">可在上方输入邀请码或扫描小程序码接受邀请</text></view>

      <view class="card share-card">
        <text class="card-title">分享我的数据</text>
        <text class="card-desc">生成二维码和链接，邀请亲友查看我的健康摘要</text>
        <button class="share-button" @tap="goShare">分享我的数据</button>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.page{min-height:100vh;box-sizing:border-box;padding:0 28rpx 80rpx;background:linear-gradient(180deg,#dfeaff 0,#eef4f3 360rpx,#f1f3f6 720rpx)}.nav{height:176rpx;padding-top:70rpx;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between}.back,.nav-space{width:72rpx}.back{font-size:66rpx;line-height:1;color:#202938}.nav-title{font-size:36rpx;font-weight:800;color:#172033}.card,.state-card{margin-top:24rpx;padding:34rpx;border-radius:46rpx;background:#fff;box-shadow:0 14rpx 40rpx rgba(35,72,132,.06)}.grow{flex:1;min-width:0}.card-title{display:block;font-size:36rpx;font-weight:800;color:#111b2c}.card-desc{display:block;margin-top:8rpx;font-size:25rpx;line-height:1.45;color:#8b94a3}.invite-code-row{display:flex;align-items:center;margin-top:24rpx;padding:8rpx 10rpx 8rpx 28rpx;border-radius:28rpx;background:#f1f5fd}.invite-code-input{flex:1;height:72rpx;font-size:27rpx;color:#1f2937}.accept-button{width:128rpx;height:72rpx;margin:0;border:0;border-radius:26rpx;background:#2e70fc;color:#fff;font-size:28rpx;font-weight:700;line-height:72rpx;box-shadow:0 8rpx 22rpx rgba(46,112,252,.25)}.accept-button[disabled]{background:#b9c8e8;color:#f5f7fb;box-shadow:none}.accept-button::after,.scan-button::after,.pending-accept::after,.share-button::after{border:0}.scan-button{height:84rpx;margin:18rpx 0 0;border:0;border-radius:28rpx;background:#eff4ff;color:#286af1;font-size:27rpx;line-height:84rpx}.invite-preview{margin-top:18rpx;padding:20rpx 24rpx;border-radius:22rpx;background:#f7f9fc}.preview-title,.preview-desc{display:block}.preview-title{font-size:27rpx;font-weight:700;color:#293448}.preview-desc{margin-top:7rpx;font-size:24rpx;color:#818b9b}.invite-error{display:block;margin-top:14rpx;font-size:24rpx;color:#d95050}.pending-card{padding-bottom:20rpx}.pending-item{display:flex;align-items:center;padding:22rpx 0;border-bottom:1rpx solid #edf0f5}.pending-item:last-child{border-bottom:0}.pending-avatar{display:flex;align-items:center;justify-content:center;width:68rpx;height:68rpx;margin-right:18rpx;border-radius:50%;background:#eaf1ff;color:#2e70fc;font-size:28rpx;font-weight:700}.pending-name{display:block;font-size:29rpx;font-weight:700;color:#253044}.pending-accept{width:108rpx;height:64rpx;margin:0;border:0;border-radius:24rpx;background:#eff4ff;color:#2e70fc;font-size:25rpx;line-height:64rpx}.section-head{display:flex;align-items:flex-end;justify-content:space-between;margin:42rpx 8rpx 20rpx}.section-title{font-size:36rpx;font-weight:800;color:#172033}.member-tabs{display:flex;gap:16rpx;overflow-x:auto;padding-bottom:4rpx}.member-pill{flex:none;display:flex;align-items:center;padding:10rpx 24rpx 10rpx 10rpx;border:2rpx solid transparent;border-radius:999rpx;background:#fff;color:#697383;font-size:27rpx}.member-pill.active{border-color:#2e70fc;background:#edf3ff;color:#1f64ef;font-weight:700}.avatar{display:flex;align-items:center;justify-content:center;width:58rpx;height:58rpx;margin-right:12rpx;border-radius:50%;background:#e8eef9;color:#5573a6}.member-pill.active .avatar{background:#2e70fc;color:#fff}.health-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18rpx}.health-title{flex:1;min-width:0}.health-actions{display:flex;flex:none;flex-direction:column;align-items:flex-end;gap:10rpx}.edit-remark{padding:4rpx 2rpx;font-size:25rpx;line-height:1.4;color:#2e70fc}.status{padding:9rpx 17rpx;border-radius:999rpx;background:#f1f3f7;color:#8992a0;font-size:22rpx}.status.online{background:#e8f8ef;color:#27a865}.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:18rpx;margin-top:30rpx}.metric{box-sizing:border-box;min-height:124rpx;padding:24rpx;border-radius:22rpx;background:#f6f8fb}.metric-wide{grid-column:1/3}.metric-label,.metric-value{display:block}.metric-label{font-size:24rpx;color:#8b94a2}.metric-value{margin-top:12rpx;font-size:31rpx;font-weight:800;color:#1c2534}.metric-value.blue{color:#2e70fc}.permission-empty,.empty-friends,.center{display:flex;flex-direction:column;align-items:center;text-align:center}.permission-empty{margin-top:28rpx;padding:38rpx;border-radius:22rpx;background:#f7f9fc}.empty-icon{font-size:58rpx;color:#79a3ff}.empty-title,.state-title{margin-top:12rpx;font-size:30rpx;font-weight:800;color:#273142}.empty-desc,.state-desc{margin-top:10rpx;font-size:25rpx;color:#939ba8}.empty-orbit{display:flex;align-items:center;justify-content:center;width:106rpx;height:106rpx;border-radius:50%;background:#edf3ff;color:#2e70fc;font-size:48rpx}.share-card{margin-top:34rpx}.share-button{height:94rpx;margin:25rpx 0 0;border:0;border-radius:47rpx;background:#2e70fc;color:#fff;font-size:30rpx;font-weight:700;line-height:94rpx}.minor-button{height:72rpx;margin-top:25rpx;padding:0 38rpx;border:0;border-radius:999rpx;background:#2e70fc;color:#fff;font-size:26rpx;line-height:72rpx}.minor-button::after{border:0}.skeleton{height:26rpx;margin:18rpx 0;border-radius:12rpx;background:#eef1f6}.skeleton.wide{width:76%}.skeleton.short{width:42%}.skeleton-box{animation:pulse 1.2s infinite;background:#eef1f6}@keyframes pulse{50%{opacity:.55}}
</style>
