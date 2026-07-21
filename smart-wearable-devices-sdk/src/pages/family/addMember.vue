<script setup lang="ts">
import { computed, ref } from 'vue';
import { acceptFamilyInvite, createFamilyElderProfile, createFamilyInvite, searchFamilyUser, type FamilyUserSearchResult } from '@/common/api/family';

const name = ref('');
const phone = ref('');
const relation = ref('father');
const sex = ref('');
const birthday = ref('');
const height = ref('');
const weight = ref('');
const mode = ref<'profile' | 'phone' | 'invite'>('profile');
const inviteCode = ref('');
const searchResult = ref<FamilyUserSearchResult | null>(null);
const generatedInvite = ref('');
const inviteExpireTime = ref('');
const submitting = ref(false);

const relationOptions = [
  { label: '父亲', value: 'father' },
  { label: '母亲', value: 'mother' },
  { label: '爷爷', value: 'grandpa' },
  { label: '奶奶', value: 'grandma' },
  { label: '其他家人', value: 'other' }
];

const modeOptions = [
  { label: '先建档案', value: 'profile', desc: '适合子女先准备设备，老人后续佩戴' },
  { label: '手机号添加', value: 'phone', desc: '搜索已注册老人账号并建立守护关系' },
  { label: '邀请码', value: 'invite', desc: '老人或子女通过邀请码确认共享' }
] as const;

const activeModeDesc = computed(() => modeOptions.find((item) => item.value === mode.value)?.desc || '');
const inviteShareText = computed(() => {
  if (!generatedInvite.value) return '';
  const target = phone.value.trim() ? `，此邀请码仅限手机号 ${phone.value.trim()} 使用` : '';
  return `我在智能穿戴小程序中邀请你确认家人健康数据共享。邀请码：${generatedInvite.value}${target}，有效期至 ${inviteExpireTime.value}。请打开小程序，进入“家人邀请/邀请码”后输入邀请码处理。`;
});

const submit = async () => {
  if (!name.value.trim()) {
    uni.showToast({ title: '请输入家人姓名', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    const result = await createFamilyElderProfile({
      name: name.value.trim(),
      phone: phone.value.trim(),
      relation: relation.value,
      sex: sex.value === '' ? undefined : Number(sex.value),
      birthday: birthday.value.trim(),
      height: height.value.trim(),
      weight: weight.value.trim()
    });
    uni.showToast({ title: '添加成功', icon: 'success' });
    setTimeout(() => {
      uni.redirectTo({ url: `/pages/family/memberDetail?memberId=${result.memberId}` });
    }, 500);
  } finally {
    submitting.value = false;
  }
};

const searchByPhone = async () => {
  if (!phone.value.trim()) {
    uni.showToast({ title: '请输入手机号', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    searchResult.value = await searchFamilyUser({ phone: phone.value.trim() });
    if (!searchResult.value) {
      uni.showToast({ title: '未找到账号，可先创建老人档案', icon: 'none' });
      mode.value = 'profile';
      return;
    }
    name.value = searchResult.value.nickName || name.value;
    const result = await createFamilyElderProfile({
      name: name.value || searchResult.value.nickName || '家人',
      phone: phone.value.trim(),
      relation: relation.value
    });
    uni.showToast({ title: '已添加', icon: 'success' });
    setTimeout(() => {
      uni.redirectTo({ url: `/pages/family/memberDetail?memberId=${result.memberId}` });
    }, 500);
  } finally {
    submitting.value = false;
  }
};

const createInvite = async () => {
  submitting.value = true;
  try {
    const result = await createFamilyInvite({
      inviteType: 2,
      targetPhone: phone.value.trim() || undefined
    });
    generatedInvite.value = result.inviteCode;
    inviteExpireTime.value = result.expireTime;
    uni.showToast({ title: '邀请码已生成', icon: 'success' });
  } finally {
    submitting.value = false;
  }
};

const copyGeneratedInvite = () => {
  if (!inviteShareText.value) {
    uni.showToast({ title: '请先生成邀请码', icon: 'none' });
    return;
  }
  uni.setClipboardData({
    data: inviteShareText.value,
    success: () => {
      uni.showToast({ title: '邀请信息已复制', icon: 'success' });
    }
  });
};

const acceptInvite = async () => {
  if (!inviteCode.value.trim()) {
    uni.showToast({ title: '请输入邀请码', icon: 'none' });
    return;
  }
  submitting.value = true;
  try {
    await acceptFamilyInvite(inviteCode.value.trim());
    uni.showToast({ title: '已接受邀请', icon: 'success' });
    setTimeout(() => {
      uni.navigateBack();
    }, 500);
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <view class="page">
    <uv-navbar placeholder title="添加家人" bgColor="#f1f3f6"></uv-navbar>

    <view class="mode-list">
      <view v-for="item in modeOptions" :key="item.value" class="mode-card" :class="{ active: mode === item.value }" @click="mode = item.value">
        <view class="mode-title">{{ item.label }}</view>
        <view class="mode-desc">{{ item.desc }}</view>
      </view>
    </view>

    <view class="section">
      <view class="section-note">{{ activeModeDesc }}</view>
      <view class="label">家人姓名</view>
      <input v-model="name" class="input" placeholder="例如：爸爸、妈妈" />

      <view class="label">关系</view>
      <view class="relation-grid">
        <view v-for="item in relationOptions" :key="item.value" class="relation-item" :class="{ active: relation === item.value }" @click="relation = item.value">
          {{ item.label }}
        </view>
      </view>

      <view class="label">手机号（选填）</view>
      <input v-model="phone" class="input" type="number" placeholder="用于后续父母本人授权或认领" />

      <template v-if="mode === 'profile'">
        <view class="profile-grid">
          <view>
            <view class="label">性别（选填）</view>
            <picker :range="['未知', '男', '女']" @change="sex = String($event.detail.value)">
              <view class="input picker-text">{{ ['未知', '男', '女'][Number(sex || 0)] }}</view>
            </picker>
          </view>
          <view>
            <view class="label">生日（选填）</view>
            <input v-model="birthday" class="input" placeholder="1958-01-01" />
          </view>
          <view>
            <view class="label">身高（选填）</view>
            <input v-model="height" class="input" type="number" placeholder="cm" />
          </view>
          <view>
            <view class="label">体重（选填）</view>
            <input v-model="weight" class="input" type="number" placeholder="kg" />
          </view>
        </view>
      </template>

      <template v-if="mode === 'invite'">
        <view class="label">输入邀请码</view>
        <input v-model="inviteCode" class="input" placeholder="例如：FAM123456" />
        <view v-if="generatedInvite" class="invite-box">
          <view class="invite-label">已生成邀请码</view>
          <view class="invite-code">{{ generatedInvite }}</view>
          <view class="invite-expire">7 天内有效，有效期至 {{ inviteExpireTime }}</view>
          <view class="invite-desc">复制后发送给家人。对方打开小程序，在“邀请码”中输入后即可处理共享授权。</view>
          <uv-button text="复制邀请信息" color="#2E70FC" :customStyle="{ height: '78rpx', marginTop: '18rpx' }" :customTextStyle="{ fontSize: '30rpx' }" @click="copyGeneratedInvite" />
        </view>
      </template>
    </view>

    <view class="tips">
      <view class="tips-title">推荐流程</view>
      <view class="tips-line">1. 先添加父母档案</view>
      <view class="tips-line">2. 再为父母绑定设备</view>
      <view class="tips-line">3. 父母佩戴后，子女即可查看健康状态</view>
    </view>

    <view class="bottom-action">
      <uv-button
        v-if="mode === 'profile'"
        :loading="submitting"
        text="保存并继续绑定设备"
        color="#2E70FC"
        :customStyle="{ height: '96rpx' }"
        :customTextStyle="{ fontSize: '34rpx' }"
        @click="submit"
      />
      <uv-button
        v-else-if="mode === 'phone'"
        :loading="submitting"
        text="搜索并添加"
        color="#2E70FC"
        :customStyle="{ height: '96rpx' }"
        :customTextStyle="{ fontSize: '34rpx' }"
        @click="searchByPhone"
      />
      <view v-else class="invite-actions">
        <uv-button :loading="submitting" text="接受邀请码" color="#2E70FC" :customStyle="{ height: '92rpx' }" :customTextStyle="{ fontSize: '32rpx' }" @click="acceptInvite" />
        <view class="button-gap"></view>
        <uv-button :loading="submitting" text="生成邀请" color="#E8F0FF" :customStyle="{ height: '92rpx' }" :customTextStyle="{ color: '#2E70FC', fontSize: '32rpx' }" @click="createInvite" />
      </view>
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
.section,
.tips {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 34rpx;
  margin-top: 28rpx;
}
.mode-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18rpx;
  margin-top: 28rpx;
}
.mode-card {
  padding: 28rpx 30rpx;
  border-radius: 20rpx;
  background: #ffffff;
  border: 2rpx solid transparent;
}
.mode-card.active {
  border-color: #2e70fc;
  background: #f5f8ff;
}
.mode-title {
  font-size: 32rpx;
  font-weight: 800;
  color: #111827;
}
.mode-desc,
.section-note {
  margin-top: 8rpx;
  font-size: 26rpx;
  color: #6b7280;
  line-height: 1.5;
}
.section-note {
  margin-top: 0;
  margin-bottom: 20rpx;
}
.label {
  font-size: 30rpx;
  font-weight: 700;
  color: #111827;
  margin: 26rpx 0 16rpx;
  &:first-child {
    margin-top: 0;
  }
}
.input {
  height: 88rpx;
  background: #f8fafc;
  border-radius: 18rpx;
  padding: 0 24rpx;
  font-size: 32rpx;
  color: #111827;
}
.picker-text {
  display: flex;
  align-items: center;
}
.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 18rpx;
}
.invite-box {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 18rpx;
  background: #f8fafc;
}
.invite-label,
.invite-expire,
.invite-desc {
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.5;
}
.invite-code {
  margin: 10rpx 0;
  color: #111827;
  font-size: 42rpx;
  font-weight: 900;
  letter-spacing: 0;
}
.relation-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18rpx;
}
.relation-item {
  height: 82rpx;
  border-radius: 18rpx;
  background: #f8fafc;
  color: #374151;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
}
.relation-item.active {
  background: #e8f0ff;
  color: #2e70fc;
  font-weight: 700;
}
.tips-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #111827;
  margin-bottom: 16rpx;
}
.tips-line {
  color: #6b7280;
  font-size: 28rpx;
  line-height: 1.8;
}
.bottom-action {
  position: fixed;
  left: 30rpx;
  right: 30rpx;
  bottom: 40rpx;
}
.invite-actions {
  display: flex;
  align-items: center;
}
.invite-actions :deep(.uv-button) {
  flex: 1;
}
.button-gap {
  width: 18rpx;
  flex: 0 0 18rpx;
}
</style>
