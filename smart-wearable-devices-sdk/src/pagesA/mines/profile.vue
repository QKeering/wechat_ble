<script setup>
import '@/pagesA/mines/i18n/pack';
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { uploadImage } from '@/common/api/upload';
import { getFullUrl } from '@/utils/utils.js';
import { useUserStore } from '@/stores/user';
import { useRingBLE } from '@/composables/useRingBLE';
import { useI18n, usePageTitle } from '@/i18n';

const { t } = useI18n();
usePageTitle(() => t('个人信息'));
const { disconnect } = useRingBLE();
const userStore = useUserStore();
const DEFAULT_AVATAR = '/static/images/mine/logo3.png';
const avatarLoadFailed = ref(false);
const avatarUploading = ref(false);

const userInfo = ref({
  id: '',
  avatar: '',
  nickName: '',
  birthday: '',
  sex: '',
  height: 0,
  weight: 0
});
const IP = ref('');

onShow(() => {
  avatarLoadFailed.value = false;
  Object.assign(userInfo.value, {
    id: userStore.userInfo.id,
    avatar: userStore.userInfo.avatar,
    nickName: userStore.userInfo.nickName,
    birthday: userStore.userInfo.birthday,
    sex: userStore.userInfo.sex,
    height: userStore.userInfo.height,
    weight: userStore.userInfo.weight
  });
  IP.value = userStore.userInfo.lastIp;
});

const normalizeAvatarUrl = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw === '-' || ['null', 'undefined', 'none'].includes(raw.toLowerCase())) {
    return DEFAULT_AVATAR;
  }
  return getFullUrl(raw) || DEFAULT_AVATAR;
};
const avatar = computed(() => (avatarLoadFailed.value ? DEFAULT_AVATAR : normalizeAvatarUrl(userInfo.value.avatar)));
const handleAvatarError = () => {
  if (avatar.value !== DEFAULT_AVATAR) {
    avatarLoadFailed.value = true;
  }
};
const profileFields = computed(() => [
  {
    label: '昵称',
    value: userInfo.value.nickName || t('未填写'),
    editable: true,
    key: 'nickName'
  },
  {
    label: '生日',
    value: userInfo.value.birthday || t('未填写'),
    editable: true,
    key: 'birthday'
  },
  {
    label: '性别',
    value: userInfo.value.sex == '0' ? t('男') : userInfo.value.sex == '1' ? t('女') : t('未知'),
    editable: true,
    key: 'sex'
  },
  {
    label: '身高',
    value: userInfo.value.height ? t('{value}厘米', { value: userInfo.value.height }) : t('未填写'),
    editable: true,
    key: 'height'
  },
  {
    label: '体重',
    value: userInfo.value.weight ? t('{value}公斤', { value: userInfo.value.weight }) : t('未填写'),
    editable: true,
    key: 'weight'
  },
  {
    label: 'ID',
    value: IP.value || t('未分配'),
    editable: false,
    key: 'id'
  }
]);

const uploadFilePromise = (url) => {
  return new Promise((resolve, reject) => {
    uni.showLoading({
      title: t('上传中...'),
      mask: true
    });

    uploadImage({
      filePath: url,
      custom: { auth: true },
      name: 'file'
    })
      .then((res) => {
        resolve(res);
      })
      .catch((error) => {
        // uploadImage 失败时抛出 Error（含后端 msg），保证 toast 能给出可读原因。
        reject(error instanceof Error ? error : new Error(error?.msg || error?.errMsg || t('图片上传失败')));
      })
      .finally(() => {
        uni.hideLoading();
      });
  });
};

const uploadAvatar = async (avatarUrl) => {
  if (!avatarUrl) return;
  avatarLoadFailed.value = false;
  avatarUploading.value = true;
  try {
    // uploadImage 已从响应信封里取出地址字符串，这里始终是 string。
    const uploaded = await uploadFilePromise(avatarUrl);
    userInfo.value.avatar = uploaded;
    await userStore.refreshUserInfo({ avatar: uploaded });
    uni.showToast({ title: t('头像已更新'), icon: 'success' });
  } catch (error) {
    uni.showToast({
      title: t((error instanceof Error && error.message) || '头像上传失败，请重试'),
      icon: 'none'
    });
  } finally {
    avatarUploading.value = false;
  }
};

const onChooseAvatar = (e) => {
  // #ifdef MP-WEIXIN
  uploadAvatar(e.detail.avatarUrl);
  // #endif
};

const onChooseAvatarTap = () => {
  // #ifndef MP-WEIXIN
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const path = (res.tempFilePaths && res.tempFilePaths[0]) || (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].path);
      if (!path) {
        uni.showToast({ title: t('未获取到图片，请重试'), icon: 'none' });
        return;
      }
      uploadAvatar(path);
    },
    fail: (error) => {
      // 权限被拒时 uni.chooseImage 只走 fail，不加这个分支会表现为「点了没反应」。
      const message = String(error?.errMsg || '');
      const denied = /deny|denied|auth|permission/i.test(message);
      uni.showToast({ title: denied ? t('请先允许访问相册和相机权限') : t('打开相册失败，请重试'), icon: 'none' });
    }
  });
  // #endif
};

const handleLogout = () => {
  uni.showModal({
    title: t('提示'),
    content: t('确定要退出登录吗？'),
    confirmColor: '#2E70FC',
    success: async (res) => {
      if (res.confirm) {
        await disconnect();
        userStore.logout();
        uni.navigateTo({
          url: '/pages/login/login'
        });
      }
    }
  });
};

const handleClick = (item) => {
  if (item.editable === false) return;
  if (item.key == 'nickName') {
    uni.$uv.route('/pagesA/mines/editNickname?nickName=' + item.value);
    return;
  }
  if (item.key == 'birthday') {
    datetimePicker.value.open();
    return;
  }
  if (item.key == 'sex') {
    uni.showActionSheet({
      itemList: [t('男'), t('女')],
      success: async (res) => {
        userInfo.value.sex = res.tapIndex;
        await userStore.refreshUserInfo({ sex: userInfo.value.sex });
      }
    });
    return;
  }
  if (item.key == 'height') {
    type.value = 'height';
    heightList.value = [];
    for (let i = 100; i <= 250; i++) {
      heightList.value.push(i);
    }
    columns.value = [heightList.value];
    picker.value.open();
    return;
  }
  if (item.key == 'weight') {
    type.value = 'weight';
    weightList.value = [];
    for (let i = 30; i <= 300; i++) {
      weightList.value.push(i);
    }
    columns.value = [weightList.value];
    picker.value.open();
  }
};

const datetimePicker = ref(null);
const value = ref(new Date());
const today = new Date();
const maxDate = ref(today.getTime());
const minDate = ref(new Date(today.getFullYear() - 100, today.getMonth(), today.getDate()).getTime());
const confirmDate = async (e) => {
  userInfo.value.birthday = uni.$uv.date(e.value, 'yyyy-mm-dd');
  await userStore.refreshUserInfo({ birthday: userInfo.value.birthday });
};

const type = ref('');
const heightList = ref([]);
const weightList = ref([]);
const picker = ref(null);
const columns = ref([]);
const confirm = async (e) => {
  if (type.value == 'height') {
    userInfo.value.height = e.value[0];
    await userStore.refreshUserInfo({ height: userInfo.value.height });
  }
  if (type.value == 'weight') {
    userInfo.value.weight = e.value[0];
    await userStore.refreshUserInfo({ weight: userInfo.value.weight });
  }
};
</script>

<template>
  <view class="p-30 bg-white min-h-screen">
    <!-- 头像区域 -->
    <view class="avatar-section flex jc-center ai-center mb-60">
      <button class="uv-reset-button" open-type="chooseAvatar" :disabled="avatarUploading" @chooseavatar="onChooseAvatar" @tap="onChooseAvatarTap">
        <view style="width: 216rpx; height: 216rpx" class="relative">
          <uv-image :src="avatar" width="216rpx" height="216rpx" radius="50rpx" @error="handleAvatarError" observe-lazy-load></uv-image>
          <view class="camera-overlay absolute bottom-0 right-0">
            <uv-image src="/static/images/mine/camera.png" width="48rpx" height="48rpx" observe-lazy-load></uv-image>
          </view>
        </view>
      </button>
    </view>

    <!-- 基本资料 -->
    <view class="info-section">
      <view class="section-title fs-36 mb-50">{{ t('基本资料') }}</view>
      <view class="info-list mb-50">
        <view v-for="(item, index) in profileFields" :key="index" @click="handleClick(item)" class="info-item pt-40 pb-40 flex jc-between ai-center fs-36">
          <view class="info-label">{{ t(item.label) }}</view>
          <view class="info-value flex ai-center">
            <view class="text-ellipsis">{{ item.value }}</view>
            <view class="ml-20" v-if="item.editable !== false">
              <uv-icon :name="item.key == 'nickName' ? 'arrow-right' : 'arrow-down'" color="#010101" size="14"></uv-icon>
            </view>
          </view>
        </view>
      </view>
      <view class="info-note fs-24 t-979797">
        {{ t('注: 性别、身高、体重和出生日期将用于个性化计算您的卡消耗量和运动时的心率范围等指标。我们尊重您的隐私和数据安全，这些信息仅用于为您提供更加准确的数据。') }}
      </view>
    </view>

    <!-- 退出登录 -->
    <view class="logout-section mt-90">
      <uv-button
        :text="t('退出登录')"
        color="#F1F3F6"
        :customTextStyle="{ color: '#FF5959', 'font-size': '36rpx' }"
        :customStyle="{
          'border-radius': '50rpx',
          padding: '64rpx 0'
        }"
        @click="handleLogout"
      ></uv-button>
      <uv-safe-bottom></uv-safe-bottom>
    </view>

    <uv-datetime-picker
      ref="datetimePicker"
      :minDate="minDate"
      :maxDate="maxDate"
      v-model="value"
      mode="date"
      @confirm="confirmDate"
      confirmColor="#2e70fc"
      :cancelText="t('取消')"
      :confirmText="t('确定')"
    ></uv-datetime-picker>
    <uv-picker
      ref="picker"
      :columns="columns"
      @confirm="confirm"
      :title="type == 'height' ? t('请选择身高(厘米)') : t('请选择体重(公斤)')"
      confirmColor="#2e70fc"
      :cancelText="t('取消')"
      :confirmText="t('确定')"
    ></uv-picker>
  </view>
</template>

<style lang="scss" scoped>
.camera-overlay {
  z-index: 1;
}

.info-item {
  border-bottom: 2rpx solid #f4f4f4;
}

.text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400rpx; /* 可以根据实际布局调整最大宽度 */
}
</style>
