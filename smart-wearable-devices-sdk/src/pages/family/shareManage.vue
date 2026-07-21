<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import {
  createFamilyInvite,
  deleteFamilyRelation,
  getFamilyGuardians,
  updateFamilyRelation,
  type FamilyGuardian
} from '@/common/api/family';

const loading = ref(false);
const guardians = ref<FamilyGuardian[]>([]);
const invitePhone = ref('');
const inviting = ref(false);
const savingRelationId = ref<number | null>(null);
const generatedInvite = ref('');
const inviteExpireTime = ref('');
const invitedPhone = ref('');

const hasGuardians = computed(() => guardians.value.length > 0);

const permissionOptions = [
  { key: 'deviceStatus', title: '设备状态', desc: '电量、同步时间和设备是否正常' },
  { key: 'vitalSigns', title: '生命体征', desc: '心率、血氧、体温等关键指标' },
  { key: 'sleep', title: '睡眠', desc: '睡眠时长、评分和质量' },
  { key: 'motion', title: '活动', desc: '步数、活动时间和运动评分' },
  { key: 'alerts', title: '异常提醒', desc: '低电量、未同步和异常指标提醒' },
  { key: 'aiSummary', title: 'AI 摘要', desc: '每日总结、周报月报和看护建议' }
];

const relationText = (relation?: string) => {
  const map: Record<string, string> = {
    father: '父亲',
    mother: '母亲',
    grandpa: '爷爷',
    grandma: '奶奶',
    parent: '父母',
    other: '家人'
  };
  return map[relation || ''] || '家人';
};

const enabledPermissionText = (guardian: FamilyGuardian) => {
  const permissions = guardian.permissions || {};
  const labels = [
    permissions.deviceStatus !== false ? '设备状态' : '',
    permissions.vitalSigns !== false ? '生命体征' : '',
    permissions.sleep !== false ? '睡眠' : '',
    permissions.motion !== false ? '活动' : '',
    permissions.alerts !== false ? '异常提醒' : '',
    permissions.aiSummary !== false ? 'AI 摘要' : ''
  ].filter(Boolean);
  return labels.length ? labels.join('、') : '未开启数据权限';
};

const isPaused = (guardian: FamilyGuardian) => guardian.status === 'paused' || Number(guardian.relationStatus) === 2;

const isPermissionEnabled = (guardian: FamilyGuardian, key: string) => {
  const permissions = guardian.permissions || {};
  return permissions[key] !== false;
};

const shareStatusText = (guardian: FamilyGuardian) => {
  if (guardian.statusText) return guardian.statusText;
  return isPaused(guardian) ? '已暂停' : '生效';
};

const fetchGuardians = async () => {
  loading.value = true;
  try {
    guardians.value = await getFamilyGuardians();
  } finally {
    loading.value = false;
  }
};

const updateLocalGuardianPermissions = (relationId: number, permissions: Record<string, boolean>) => {
  guardians.value = guardians.value.map((item) =>
    Number(item.relationId || 0) === relationId
      ? {
          ...item,
          permissions
        }
      : item
  );
};

const setGuardianPermission = async (guardian: FamilyGuardian, key: string, event: any) => {
  const relationId = Number(guardian.relationId || 0);
  if (!relationId) {
    uni.showToast({ title: '缺少共享关系编号', icon: 'none' });
    return;
  }
  const nextPermissions = {
    deviceStatus: true,
    vitalSigns: true,
    sleep: true,
    motion: true,
    alerts: true,
    aiSummary: true,
    ...(guardian.permissions || {}),
    [key]: Boolean(event?.detail?.value)
  };
  const previousPermissions = { ...(guardian.permissions || {}) };
  updateLocalGuardianPermissions(relationId, nextPermissions);
  savingRelationId.value = relationId;
  try {
    await updateFamilyRelation(relationId, { permissionScope: nextPermissions });
    uni.showToast({ title: '授权已更新', icon: 'success' });
  } catch (error) {
    updateLocalGuardianPermissions(relationId, previousPermissions);
    throw error;
  } finally {
    savingRelationId.value = null;
  }
};

const toggleShare = (guardian: FamilyGuardian) => {
  if (!guardian.relationId) {
    uni.showToast({ title: '缺少共享关系编号', icon: 'none' });
    return;
  }
  const paused = isPaused(guardian);
  uni.showModal({
    title: paused ? '恢复共享' : '暂停共享',
    content: paused
      ? '恢复后，这位家人可以继续查看您授权范围内的健康数据。'
      : '暂停后，这位家人暂时不能查看您的健康数据，您可以随时恢复。',
    confirmText: paused ? '恢复共享' : '暂停共享',
    confirmColor: paused ? '#2563EB' : '#F59E0B',
    success: async (res) => {
      if (!res.confirm) return;
      await updateFamilyRelation(Number(guardian.relationId), { status: paused ? 'active' : 'paused' });
      uni.showToast({ title: paused ? '已恢复共享' : '已暂停共享', icon: 'success' });
      fetchGuardians();
    }
  });
};

const cancelShare = (guardian: FamilyGuardian) => {
  if (!guardian.relationId) {
    uni.showToast({ title: '缺少共享关系编号', icon: 'none' });
    return;
  }
  const guardianName = guardian.guardianName || guardian.guardianPhoneMasked || '该家人';
  uni.showModal({
    title: '取消共享',
    content: `取消后，${guardianName} 将不能再查看您的历史和最新健康数据。`,
    confirmText: '继续取消',
    confirmColor: '#DC2626',
    success: async (res) => {
      if (!res.confirm) return;
      uni.showModal({
        title: '再次确认',
        content: `请确认要关闭 ${guardianName} 的共享权限。关闭后如需恢复，需要重新邀请或重新授权。`,
        confirmText: '确定关闭',
        confirmColor: '#DC2626',
        success: async (second) => {
          if (!second.confirm) return;
          await deleteFamilyRelation(Number(guardian.relationId));
          uni.showToast({ title: '已取消共享', icon: 'success' });
          fetchGuardians();
        }
      });
    }
  });
};

const inviteShareText = computed(() => {
  if (!generatedInvite.value) return '';
  const phoneText = invitedPhone.value ? `，仅限手机号 ${invitedPhone.value} 使用` : '';
  return `我在智能穿戴小程序中邀请你查看我的健康数据。邀请码：${generatedInvite.value}${phoneText}，有效期至 ${inviteExpireTime.value}。请打开小程序进入“家人邀请”处理。`;
});

const copyInvite = () => {
  if (!inviteShareText.value) {
    uni.showToast({ title: '请先生成邀请', icon: 'none' });
    return;
  }
  uni.setClipboardData({
    data: inviteShareText.value,
    success: () => {
      uni.showToast({ title: '邀请信息已复制', icon: 'success' });
    }
  });
};

const inviteGuardian = async () => {
  const phone = invitePhone.value.trim();
  if (!/^1\d{10}$/.test(phone)) {
    uni.showToast({ title: '请输入正确的家人手机号', icon: 'none' });
    return;
  }
  inviting.value = true;
  try {
    const result = await createFamilyInvite({ inviteType: 1, targetPhone: phone });
    generatedInvite.value = result.inviteCode;
    inviteExpireTime.value = result.expireTime;
    invitedPhone.value = phone;
    uni.showModal({
      title: '邀请已生成',
      content: `邀请码 ${result.inviteCode}，7 天内有效。可复制后发送给家人。`,
      showCancel: false,
      confirmText: '知道了'
    });
    invitePhone.value = '';
  } finally {
    inviting.value = false;
  }
};

onShow(fetchGuardians);

onPullDownRefresh(async () => {
  try {
    await fetchGuardians();
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="共享管理" bgColor="#f1f3f6"></uv-navbar>

    <view class="header">
      <view class="title">谁在查看我的数据</view>
      <view class="desc">您可以随时暂停、恢复或取消共享。暂停后，家人暂时不能查看您的健康数据。</view>
    </view>

    <view class="invite-card">
      <view class="section-title">邀请家人</view>
      <view class="desc compact">填写子女手机号，生成 7 天有效的邀请码。对方登录后接受，即可查看您授权的数据。</view>
      <uv-input
        v-model="invitePhone"
        type="number"
        maxlength="11"
        placeholder="请输入家人手机号"
        fontSize="32rpx"
        :customStyle="{ marginTop: '24rpx', height: '92rpx', background: '#F8FAFC', borderRadius: '18rpx', padding: '0 22rpx' }"
      />
      <uv-button
        text="生成邀请"
        color="#2E70FC"
        :loading="inviting"
        :customStyle="{ height: '92rpx', marginTop: '22rpx' }"
        :customTextStyle="{ fontSize: '34rpx', fontWeight: 800 }"
        @click="inviteGuardian"
      />
      <view v-if="generatedInvite" class="invite-result">
        <view class="invite-label">已生成邀请码</view>
        <view class="invite-code">{{ generatedInvite }}</view>
        <view class="invite-desc">有效期至 {{ inviteExpireTime }}。复制后发送给家人，对方登录小程序后即可接受。</view>
        <uv-button
          text="复制邀请信息"
          color="#E8F0FF"
          :customStyle="{ height: '82rpx', marginTop: '18rpx' }"
          :customTextStyle="{ color: '#2E70FC', fontSize: '32rpx', fontWeight: 800 }"
          @click="copyInvite"
        />
      </view>
    </view>

    <view v-if="loading" class="empty">正在加载共享关系...</view>

    <view v-else-if="!hasGuardians" class="empty-card">
      <view class="empty-title">当前没有共享给家人</view>
      <view class="empty-desc">当您授权家人后，这里会显示正在查看您健康数据的人。</view>
    </view>

    <view v-else class="guardian-list">
      <view v-for="guardian in guardians" :key="guardian.memberId" class="guardian-card">
        <view class="guardian-top">
          <view class="avatar">{{ (guardian.guardianName || guardian.guardianPhoneMasked || '家').slice(0, 1) }}</view>
          <view class="info">
            <view class="name">{{ guardian.guardianName || guardian.guardianPhoneMasked || '家人' }}</view>
            <view class="relation">{{ relationText(guardian.relation) }} · {{ shareStatusText(guardian) }}</view>
          </view>
          <view class="status-pill" :class="{ paused: isPaused(guardian) }">{{ shareStatusText(guardian) }}</view>
        </view>
        <view class="permission-text">{{ enabledPermissionText(guardian) }}</view>
        <view class="permission-panel">
          <view class="permission-panel-title">允许查看的数据</view>
          <view v-for="item in permissionOptions" :key="item.key" class="permission-row">
            <view class="permission-info">
              <view class="permission-name">{{ item.title }}</view>
              <view class="permission-desc">{{ item.desc }}</view>
            </view>
            <switch
              :checked="isPermissionEnabled(guardian, item.key)"
              :disabled="savingRelationId === Number(guardian.relationId || 0)"
              color="#2E70FC"
              @change="setGuardianPermission(guardian, item.key, $event)"
            />
          </view>
        </view>
        <view class="action-row">
          <uv-button
            :text="isPaused(guardian) ? '恢复共享' : '暂停共享'"
            :color="isPaused(guardian) ? '#E8F0FF' : '#FFF7E6'"
            :customStyle="{ flex: 1, height: '86rpx' }"
            :customTextStyle="{ color: isPaused(guardian) ? '#2563EB' : '#B45309', fontSize: '32rpx' }"
            @click="toggleShare(guardian)"
          />
          <uv-button
            text="取消共享"
            color="#FFF0F0"
            :customStyle="{ flex: 1, height: '86rpx', marginLeft: '18rpx' }"
            :customTextStyle="{ color: '#DC2626', fontSize: '32rpx' }"
            @click="cancelShare(guardian)"
          />
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f1f3f6;
  padding: 0 30rpx 60rpx;
  box-sizing: border-box;
}
.header,
.invite-card,
.guardian-card,
.empty,
.empty-card {
  margin-top: 28rpx;
  padding: 34rpx;
  border-radius: 24rpx;
  background: #ffffff;
}
.title {
  font-size: 42rpx;
  font-weight: 900;
  color: #111827;
}
.section-title {
  font-size: 36rpx;
  font-weight: 900;
  color: #111827;
}
.desc,
.empty-desc,
.relation,
.permission-text {
  margin-top: 14rpx;
  color: #6b7280;
  font-size: 30rpx;
  line-height: 1.6;
}
.compact {
  margin-top: 10rpx;
}
.invite-result {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #f8fafc;
}
.invite-label {
  color: #6b7280;
  font-size: 26rpx;
}
.invite-code {
  margin-top: 8rpx;
  color: #111827;
  font-size: 44rpx;
  font-weight: 900;
  letter-spacing: 0;
}
.invite-desc {
  margin-top: 10rpx;
  color: #6b7280;
  font-size: 28rpx;
  line-height: 1.55;
}
.guardian-top {
  display: flex;
  align-items: center;
}
.avatar {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: #e8f0ff;
  color: #2e70fc;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 900;
  margin-right: 24rpx;
}
.info {
  flex: 1;
  min-width: 0;
}
.name,
.empty-title {
  color: #111827;
  font-size: 36rpx;
  font-weight: 800;
}
.permission-text {
  padding: 20rpx 22rpx;
  border-radius: 18rpx;
  background: #f8fafc;
  color: #374151;
}
.permission-panel {
  margin-top: 22rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #f8fafc;
}
.permission-panel-title {
  font-size: 30rpx;
  font-weight: 800;
  color: #111827;
}
.permission-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 1rpx solid #e5eaf2;
}
.permission-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.permission-info {
  flex: 1;
  min-width: 0;
  padding-right: 20rpx;
}
.permission-name {
  font-size: 30rpx;
  font-weight: 800;
  color: #111827;
}
.permission-desc {
  margin-top: 8rpx;
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.45;
}
.status-pill {
  flex-shrink: 0;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background: #e8f0ff;
  color: #2563eb;
  font-size: 26rpx;
  font-weight: 800;
}
.status-pill.paused {
  background: #fff7e6;
  color: #b45309;
}
.action-row {
  display: flex;
  align-items: center;
  margin-top: 24rpx;
}
.empty,
.empty-card {
  text-align: center;
}
</style>
