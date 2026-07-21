<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getFamilyMemberDetail, updateFamilyPermissions, updateFamilyRelation, type FamilyMember } from '@/common/api/family';

const memberId = ref(0);
const relationId = ref(0);
const member = ref<FamilyMember | null>(null);
const saving = ref(false);
const permissions = ref<Record<string, boolean>>({
  vitalSigns: true,
  sleep: true,
  motion: true,
  alerts: true,
  aiSummary: true,
  deviceStatus: true
});

const items = [
  { key: 'vitalSigns', title: '生命体征', desc: '心率、血氧、体温、压力等关键指标' },
  { key: 'sleep', title: '睡眠数据', desc: '睡眠评分、时长、质量和醒来次数' },
  { key: 'motion', title: '活动数据', desc: '步数、活动时间、卡路里和运动评分' },
  { key: 'alerts', title: '异常提醒', desc: '低血氧、心率异常、设备离线等提醒' },
  { key: 'aiSummary', title: 'AI 健康摘要', desc: '每日总结、趋势解释和看护建议' },
  { key: 'deviceStatus', title: '设备状态', desc: '设备绑定、在线、同步时间和电量' }
];

const loadDetail = async () => {
  if (!memberId.value) return;
  const detail = await getFamilyMemberDetail({ memberId: memberId.value });
  member.value = detail;
  permissions.value = {
    ...permissions.value,
    ...(detail.permissions || {})
  };
};

const toggle = (key: string) => {
  permissions.value[key] = !permissions.value[key];
};

const setPermission = (key: string, event: any) => {
  permissions.value[key] = Boolean(event?.detail?.value);
};

const save = async () => {
  if (!memberId.value && !relationId.value) return;
  saving.value = true;
  try {
    if (relationId.value) {
      const relation = await updateFamilyRelation(relationId.value, {
        permissionScope: permissions.value
      });
      if (relation?.memberId) {
        memberId.value = Number(relation.memberId);
      }
    }
    if (memberId.value) {
      member.value = await updateFamilyPermissions({
        memberId: memberId.value,
        permissions: permissions.value
      });
    }
    uni.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => {
      uni.navigateBack();
    }, 500);
  } finally {
    saving.value = false;
  }
};

onLoad((query: any) => {
  memberId.value = Number(query?.memberId || 0);
  relationId.value = Number(query?.relationId || 0);
  loadDetail();
});
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="共享权限" bgColor="#f1f3f6"></uv-navbar>

    <view class="header">
      <view class="title">{{ member?.name || '家人' }}的数据共享</view>
      <view class="desc">关闭某项后，亲情账号将无法查看对应健康数据，后端接口也会同步拦截。</view>
      <view class="auth-note">父母本人认领档案后，共享权限由父母在“长辈模式-共享管理”中调整；子女端仅可查看授权范围。</view>
    </view>

    <view class="list">
      <view v-for="item in items" :key="item.key" class="permission-item" @click="toggle(item.key)">
        <view>
          <view class="item-title">{{ item.title }}</view>
          <view class="item-desc">{{ item.desc }}</view>
        </view>
        <switch :checked="permissions[item.key]" color="#2E70FC" @click.stop @change.stop="setPermission(item.key, $event)" />
      </view>
    </view>

    <view class="bottom-action">
      <uv-button :loading="saving" text="保存权限" color="#2E70FC" :customStyle="{ height: '96rpx' }" :customTextStyle="{ fontSize: '34rpx' }" @click="save" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f1f3f6;
  padding: 0 30rpx 140rpx;
  box-sizing: border-box;
}
.header,
.list {
  margin-top: 28rpx;
  padding: 34rpx;
  background: #ffffff;
  border-radius: 24rpx;
}
.title {
  font-size: 40rpx;
  font-weight: 800;
  color: #111827;
}
.desc {
  margin-top: 14rpx;
  color: #6b7280;
  font-size: 28rpx;
  line-height: 1.7;
}
.auth-note {
  margin-top: 18rpx;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: #fff7ed;
  color: #9a3412;
  font-size: 26rpx;
  line-height: 1.6;
}
.permission-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 0;
  border-bottom: 1rpx solid #eef2f7;
}
.permission-item:last-child {
  border-bottom: 0;
}
.item-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #111827;
}
.item-desc {
  margin-top: 8rpx;
  width: 500rpx;
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.5;
}
.bottom-action {
  position: fixed;
  left: 30rpx;
  right: 30rpx;
  bottom: 40rpx;
}
</style>
