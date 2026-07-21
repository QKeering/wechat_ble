<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import {
  createFamilyAssistRequest,
  createFamilyGroup,
  getFamilyAssistRequests,
  getFamilyGroups,
  getFamilyHome,
  type FamilyAssistRequest,
  type FamilyGroup,
  type FamilyMember
} from '@/common/api/family';

const groups = ref<FamilyGroup[]>([]);
const requests = ref<FamilyAssistRequest[]>([]);
const members = ref<FamilyMember[]>([]);
const loading = ref(false);
const submitting = ref(false);
const selectedMemberId = ref<number | null>(null);
const contactPhone = ref('');
const deviceMac = ref('');
const description = ref('');

const relationOptions = computed(() =>
  members.value
    .filter((item) => item.relationId)
    .map((item) => ({
      label: `${item.name || '家人'} · ${item.cardSummary || '家庭守护对象'}`,
      value: Number(item.relationId),
      memberId: Number(item.id)
    }))
);

const selectedRelationId = computed(() => {
  const matched = relationOptions.value.find((item) => item.memberId === selectedMemberId.value);
  return matched?.value || 0;
});

const selectedMemberName = computed(() => {
  const matched = members.value.find((item) => Number(item.id) === selectedMemberId.value);
  return matched?.name || '请选择家人';
});

const fetchData = async () => {
  loading.value = true;
  try {
    const [home, groupData, requestData] = await Promise.all([getFamilyHome(), getFamilyGroups(), getFamilyAssistRequests()]);
    members.value = home?.members || [];
    groups.value = groupData || [];
    requests.value = requestData || [];
    if (!selectedMemberId.value && members.value.length) {
      selectedMemberId.value = Number(members.value[0].id);
    }
  } finally {
    loading.value = false;
  }
};

const createDefaultGroup = async () => {
  const relationIds = relationOptions.value.map((item) => item.value);
  if (!relationIds.length) {
    uni.showToast({ title: '请先添加家人', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await createFamilyGroup({
      groupName: '我的家庭照护组',
      description: '用于多子女共同关注父母健康、设备同步和异常提醒。',
      relationIds
    });
    uni.showToast({ title: '已创建家庭群组', icon: 'none' });
    await fetchData();
  } catch (error) {
    uni.showToast({ title: '创建失败，请稍后重试', icon: 'none' });
  } finally {
    submitting.value = false;
  }
};

const chooseMember = () => {
  if (!relationOptions.value.length) {
    uni.showToast({ title: '请先添加家人', icon: 'none' });
    return;
  }
  uni.showActionSheet({
    itemList: relationOptions.value.map((item) => item.label),
    success: (res) => {
      selectedMemberId.value = relationOptions.value[res.tapIndex]?.memberId || selectedMemberId.value;
    }
  });
};

const submitAssist = async () => {
  if (!selectedRelationId.value || !selectedMemberId.value) {
    uni.showToast({ title: '请选择需要协助的家人', icon: 'none' });
    return;
  }
  if (description.value.trim().length < 4) {
    uni.showToast({ title: '请填写协助内容', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await createFamilyAssistRequest({
      relationId: selectedRelationId.value,
      memberId: selectedMemberId.value,
      requestType: 'device_bind',
      contactPhone: contactPhone.value,
      deviceMac: deviceMac.value,
      description: description.value
    });
    description.value = '';
    uni.showToast({ title: '已提交协助请求', icon: 'none' });
    await fetchData();
  } catch (error) {
    uni.showToast({ title: '提交失败，请稍后重试', icon: 'none' });
  } finally {
    submitting.value = false;
  }
};

onShow(fetchData);

onPullDownRefresh(async () => {
  try {
    await fetchData();
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<template>
  <view class="collab-page">
    <uv-navbar placeholder leftIcon="" title="协同照护" bgColor="#f1f3f6"></uv-navbar>

    <view class="intro-card">
      <view class="intro-title">家庭协同照护</view>
      <view class="intro-desc">把父母健康、设备状态和人工协助放在同一个家庭协作入口，方便后续多子女一起守护。</view>
    </view>

    <view class="section">
      <view class="section-head">
        <view>
          <view class="section-title">家庭群组</view>
          <view class="section-desc">用于后续多子女协同查看提醒和周/月报告。</view>
        </view>
        <uv-button text="创建" :loading="submitting" color="#E8F0FF" :customStyle="{ width: '128rpx', height: '68rpx' }" :customTextStyle="{ color: '#2E70FC', fontSize: '28rpx' }" @click="createDefaultGroup" />
      </view>
      <view v-if="!groups.length" class="empty-line">暂无家庭群组，可一键用当前家人创建。</view>
      <view v-for="group in groups" :key="group.id" class="group-card">
        <view class="group-name">{{ group.groupName }}</view>
        <view class="group-desc">{{ group.description || '家庭健康协作群组' }}</view>
        <view class="group-members">{{ group.memberCount || 0 }} 位家人 · {{ group.status === 1 ? '使用中' : '已停用' }}</view>
      </view>
    </view>

    <view class="section">
      <view class="section-title">人工协助绑定</view>
      <view class="section-desc">当设备绑定、老人认领或数据共享需要运营协助时，可提交请求，后台会留痕处理。</view>

      <view class="form-row picker" @click="chooseMember">
        <view>
          <view class="form-label">协助对象</view>
          <view class="form-value">{{ selectedMemberName }}</view>
        </view>
        <uv-icon name="arrow-right" color="#9CA3AF" size="16"></uv-icon>
      </view>
      <input v-model="contactPhone" class="input" placeholder="联系电话，可选" placeholder-class="placeholder" />
      <input v-model="deviceMac" class="input" placeholder="设备 MAC，可选" placeholder-class="placeholder" />
      <textarea v-model="description" class="textarea" placeholder="请描述需要协助的问题，例如：设备已给父亲佩戴但绑定不上" placeholder-class="placeholder" />
      <uv-button text="提交协助请求" :loading="submitting" color="#2E70FC" :customStyle="{ height: '88rpx', marginTop: '22rpx' }" :customTextStyle="{ fontSize: '32rpx' }" @click="submitAssist" />
    </view>

    <view class="section">
      <view class="section-title">最近请求</view>
      <view v-if="!requests.length" class="empty-line">暂无人工协助请求。</view>
      <view v-for="item in requests.slice(0, 5)" :key="item.id" class="request-card">
        <view class="request-top">
          <view class="request-name">{{ item.memberName || item.displayName || '家人' }}</view>
          <view class="request-status">{{ item.statusText || '待处理' }}</view>
        </view>
        <view class="request-desc">{{ item.description }}</view>
        <view class="request-meta">{{ item.updateTime || item.createTime || '' }}</view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.collab-page {
  min-height: 100vh;
  padding: 0 30rpx 60rpx;
  box-sizing: border-box;
  background: #f1f3f6;
}
.intro-card,
.section {
  margin-top: 24rpx;
  padding: 30rpx;
  border-radius: 22rpx;
  background: #ffffff;
}
.intro-title {
  font-size: 42rpx;
  font-weight: 800;
  color: #111827;
}
.intro-desc,
.section-desc,
.group-desc,
.group-members,
.request-desc,
.request-meta,
.empty-line {
  margin-top: 10rpx;
  font-size: 27rpx;
  line-height: 1.55;
  color: #6b7280;
}
.section-head,
.form-row,
.request-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}
.section-title {
  font-size: 34rpx;
  font-weight: 800;
  color: #111827;
}
.group-card,
.request-card {
  margin-top: 18rpx;
  padding: 24rpx;
  border-radius: 18rpx;
  background: #f8fafc;
}
.group-name,
.request-name {
  font-size: 31rpx;
  font-weight: 750;
  color: #111827;
}
.form-row {
  margin-top: 22rpx;
  padding: 24rpx;
  border-radius: 18rpx;
  background: #f8fafc;
}
.form-label {
  font-size: 25rpx;
  color: #6b7280;
}
.form-value {
  margin-top: 8rpx;
  font-size: 31rpx;
  font-weight: 700;
  color: #111827;
}
.input,
.textarea {
  width: 100%;
  margin-top: 18rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  border-radius: 18rpx;
  background: #f8fafc;
  color: #111827;
  font-size: 30rpx;
}
.input {
  height: 86rpx;
}
.textarea {
  min-height: 170rpx;
  padding-top: 22rpx;
  line-height: 1.5;
}
.placeholder {
  color: #9ca3af;
}
.request-status {
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: #fff7ed;
  color: #c2410c;
  font-size: 24rpx;
}
</style>
