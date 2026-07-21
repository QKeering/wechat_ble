<script setup>
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { uploadImage } from '@/common/api/upload';
import { getFullUrl } from '@/utils/utils.js';
import { useUserStore } from '@/stores/user';
import { useRingBLE } from '@/composables/useRingBLE';

const { disconnect } = useRingBLE();
const userStore = useUserStore();

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

const avatar = computed(() => getFullUrl(userInfo.value.avatar) || '/static/images/mine/avatar.png');
const profileFields = computed(() => [
  {
    label: '昵称',
    value: userInfo.value.nickName || '未填写',
    editable: true,
    key: 'nickName'
  },
  {
    label: '生日',
    value: userInfo.value.birthday || '未填写',
    editable: true,
    key: 'birthday'
  },
  {
    label: '性别',
    value: userInfo.value.sex == '0' ? '男' : userInfo.value.sex == '1' ? '女' : '未知',
    editable: true,
    key: 'sex'
  },
  {
    label: '身高',
    value: userInfo.value.height ? `${userInfo.value.height}厘米` : '未填写',
    editable: true,
    key: 'height'
  },
  {
    label: '体重',
    value: userInfo.value.weight ? `${userInfo.value.weight}公斤` : '未填写',
    editable: true,
    key: 'weight'
  },
  {
    label: 'ID',
    value: IP.value || '未分配',
    editable: false,
    key: 'id'
  }
]);

const uploadFilePromise = (url) => {
  return new Promise((resolve, reject) => {
    uni.showLoading({
      title: '上传中...',
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
        reject(error.result);
      })
      .finally(() => {
        uni.hideLoading();
      });
  });
};

const onChooseAvatar = async (e) => {
  const { avatarUrl } = e.detail;
  userInfo.value.avatar = await uploadFilePromise(avatarUrl);
  if (userInfo.value.avatar) {
    await userStore.refreshUserInfo({ avatar: userInfo.value.avatar });
  }
};

const handleLogout = () => {
  uni.showModal({
    title: '提示',
    content: '确定要退出登录吗？',
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
  if (item.label == '昵称') {
    uni.$uv.route('/pagesA/mines/editNickname?nickName=' + item.value);
    return;
  }
  if (item.label == '生日') {
    datetimePicker.value.open();
    return;
  }
  if (item.label == '性别') {
    uni.showActionSheet({
      itemList: ['男', '女'],
      success: async (res) => {
        userInfo.value.sex = res.tapIndex;
        await userStore.refreshUserInfo({ sex: userInfo.value.sex });
      }
    });
    return;
  }
  if (item.label == '身高') {
    type.value = 'height';
    heightList.value = [];
    for (let i = 100; i <= 250; i++) {
      heightList.value.push(i);
    }
    columns.value = [heightList.value];
    picker.value.open();
    return;
  }
  if (item.label == '体重') {
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
    <view class="avatar-section flex jc-center ai-center mb-60">
      <button class="uv-reset-button" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
        <view style="width: 216rpx; height: 216rpx" class="relative">
          <uv-image :src="avatar" width="216rpx" height="216rpx" radius="50rpx"></uv-image>
          <view class="camera-overlay absolute bottom-0 right-0">+</view>
        </view>
      </button>
    </view>

    <view class="info-section">
      <view class="section-title fs-36 mb-50">基本资料</view>
      <view class="info-list mb-50">
        <view v-for="(item, index) in profileFields" :key="index" @click="handleClick(item)" class="info-item pt-40 pb-40 flex jc-between ai-center fs-36">
          <view class="info-label">{{ item.label }}</view>
          <view class="info-value flex ai-center">
            <view class="text-ellipsis">{{ item.value }}</view>
            <view class="ml-20" v-if="item.editable !== false">
              <uv-icon :name="item.label == '昵称' ? 'arrow-right' : 'arrow-down'" color="#010101" size="14"></uv-icon>
            </view>
          </view>
        </view>
      </view>
      <view class="info-note fs-24 t-979797">
        注: 性别、身高、体重和出生日期将用于个性化计算您的卡路里消耗量和运动时的心率范围等指标。我们尊重您的隐私和数据安全，这些信息仅用于为您提供更加准确的数据。
      </view>
    </view>

    <view class="logout-section mt-90">
      <uv-button
        text="退出登录"
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

    <uv-datetime-picker ref="datetimePicker" :minDate="minDate" :maxDate="maxDate" v-model="value" mode="date" @confirm="confirmDate" confirmColor="#2e70fc"></uv-datetime-picker>
    <uv-picker ref="picker" :columns="columns" @confirm="confirm" :title="type == 'height' ? '请选择身高(厘米)' : '请选择体重(公斤)'" confirmColor="#2e70fc"></uv-picker>
  </view>
</template>

<style lang="scss" scoped>
.camera-overlay {
  z-index: 1;
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #2e70fc;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  line-height: 48rpx;
}

.info-item {
  border-bottom: 2rpx solid #f4f4f4;
}

.text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400rpx;
}
</style>
