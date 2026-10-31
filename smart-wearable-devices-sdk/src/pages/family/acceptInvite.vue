<script setup lang="ts">
import '@/pages/family/i18n/pack'
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { acceptFamilyInvite, getFamilyInvitePreview, type FamilyInvitePreview } from '@/common/api/family'
import { useI18n } from '@/i18n'
import { formatBleErrorMessage } from '@/utils/bleError'

const { t } = useI18n()

const inviteCode = ref('')
const preview = ref<FamilyInvitePreview | null>(null)
const loading = ref(false)
const submitting = ref(false)
const errorText = ref('')

const normalizedCode = computed(() => inviteCode.value.trim().toUpperCase())
const acceptDisabled = computed(() => (
  loading.value || submitting.value || !preview.value || preview.value.canAccept === false
))
const goBack = () => uni.navigateBack()

const loadPreview = async () => {
  const code = normalizedCode.value
  preview.value = null
  errorText.value = ''
  if (!code) return
  loading.value = true
  try {
    preview.value = await getFamilyInvitePreview(code)
  } catch {
    errorText.value = '邀请码无效或已失效'
  } finally {
    loading.value = false
  }
}

const confirmAccept = async () => {
  if (acceptDisabled.value) return
  submitting.value = true
  try {
    await acceptFamilyInvite(normalizedCode.value)
    uni.showToast({ title: t('已接受邀请'), icon: 'success' })
    setTimeout(() => uni.redirectTo({ url: '/pages/family/family' }), 800)
  } catch (error: any) {
    uni.showToast({ title: t(formatBleErrorMessage(error, '接受失败，请稍后重试')), icon: 'none' })
  } finally {
    submitting.value = false
  }
}

onLoad((options) => {
  inviteCode.value = String(options?.code || options?.i || '').trim().toUpperCase()
  if (inviteCode.value) loadPreview()
})
</script>

<template>
  <view class="page">
    <view class="nav"><text class="back" @tap="goBack">‹</text><text class="title">{{ t('确认邀请') }}</text><view class="space" /></view>
    <view class="card">
      <text class="label">{{ t('邀请码') }}</text>
      <view class="code-row">
        <input v-model="inviteCode" class="code-input" maxlength="16" :placeholder="t('请输入邀请码')" @blur="loadPreview" />
        <button class="lookup" :disabled="loading || !normalizedCode" @tap="loadPreview">{{ loading ? t('查询中') : t('查询') }}</button>
      </view>
      <text v-if="errorText" class="error">{{ t(errorText) }}</text>
    </view>

    <view v-if="preview" class="card detail-card">
      <text class="inviter">{{ t('{name} 邀请你共享健康数据', { name: preview.inviterName }) }}</text>
      <text class="summary">{{ preview.permissionSummary }}</text>
      <text class="expire">{{ t('有效期至 {time}', { time: preview.expireTime }) }}</text>
      <view v-if="!preview.canAccept" class="disabled-tip">{{ t(preview.disabledReason || '当前邀请不可接受') }}</view>
      <button class="accept" :disabled="acceptDisabled" :loading="submitting" @tap="confirmAccept">{{ t('接受邀请') }}</button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page{min-height:100vh;box-sizing:border-box;padding:0 28rpx 80rpx;background:linear-gradient(180deg,#eaf2ff 0,#f5f7fa 430rpx)}.nav{height:176rpx;padding-top:70rpx;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between}.back,.space{width:72rpx}.back{font-size:66rpx;line-height:1;color:#202938}.title{font-size:36rpx;font-weight:800;color:#172033}.card{margin-top:24rpx;padding:34rpx;border-radius:30rpx;background:#fff;box-shadow:0 14rpx 40rpx rgba(35,72,132,.07)}.label{display:block;margin-bottom:18rpx;font-size:27rpx;font-weight:700;color:#303a4a}.code-row{display:flex;gap:18rpx}.code-input{flex:1;height:82rpx;box-sizing:border-box;padding:0 24rpx;border:2rpx solid #e1e6ee;border-radius:18rpx;font-size:30rpx;text-transform:uppercase}.lookup{width:150rpx;height:82rpx;margin:0;border:0;border-radius:18rpx;background:#edf3ff;color:#2468ef;font-size:27rpx;line-height:82rpx}.lookup::after,.accept::after{border:0}.error{display:block;margin-top:18rpx;color:#e25757;font-size:25rpx}.inviter{display:block;font-size:34rpx;font-weight:800;color:#172033}.summary{display:block;margin-top:22rpx;font-size:27rpx;line-height:1.7;color:#667182}.expire{display:block;margin-top:20rpx;font-size:24rpx;color:#99a1ad}.disabled-tip{margin-top:28rpx;padding:22rpx;border-radius:18rpx;background:#fff2f1;color:#d84c4c;font-size:26rpx;text-align:center}.accept{height:92rpx;margin-top:32rpx;border:0;border-radius:46rpx;background:#2e70fc;color:#fff;font-size:30rpx;font-weight:700;line-height:92rpx}.accept[disabled]{background:#c8cfda;color:#fff}
</style>
