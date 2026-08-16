<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getBoundRingDevice } from '@/api/ringDevice';
import {
  getCustomerServiceConfig,
  submitFeedback,
  uploadFeedbackImage,
  type FeedbackCategory,
  type FeedbackSubmitResult
} from '@/common/api/feedback';
import { useUserStore } from '@/stores/user';

type FeedbackCategoryOption = {
  value: FeedbackCategory;
  label: string;
};

const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const categoryOptions: FeedbackCategoryOption[] = [
  { value: 'connect_failed', label: '连接不上' },
  { value: 'sync_failed', label: '数据同步失败' },
  { value: 'data_abnormal', label: '数据异常' },
  { value: 'charge_failed', label: '设备充不上电' },
  { value: 'bind_failed', label: '无法绑定' },
  { value: 'wear_measure', label: '佩戴/测量问题' },
  { value: 'account_family', label: '账号/亲友共享' },
  { value: 'other', label: '其他问题' }
];

const category = ref<FeedbackCategory | ''>('');
const description = ref('');
const contact = ref('');
const imagePaths = ref<string[]>([]);
const sourcePage = ref('');
const sourceFaqId = ref('');
const sourceFaqTitle = ref('');
const submitting = ref(false);
const submitted = ref(false);
const submitResult = ref<FeedbackSubmitResult>({});
const devicePreview = ref({
  name: '-',
  mac: '-',
  version: '-'
});

const descriptionLength = computed(() => description.value.trim().length);
const selectedCategoryLabel = computed(() => categoryOptions.find((item) => item.value === category.value)?.label || '');
const canAddImage = computed(() => imagePaths.value.length < MAX_IMAGE_COUNT);

const getFirstText = (source: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
};

const collectFeedbackContext = async () => {
  const userStore = useUserStore();
  const userInfo = userStore.userInfo || uni.getStorageSync('userInfo') || {};
  const ring = (await getBoundRingDevice()) || {};
  let systemInfo: Record<string, any> = {};
  try {
    systemInfo = uni.getSystemInfoSync() || {};
  } catch {
    systemInfo = {};
  }

  const context = {
    userId: getFirstText(userInfo, ['id', 'userId', 'user_id']),
    nickname: getFirstText(userInfo, ['nickName', 'nickname', 'name']),
    phone: getFirstText(userInfo, ['phone', 'mobile', 'mobilePhone', 'phoneNumber']),
    deviceMac: getFirstText(ring, ['mac', 'uniMacId']),
    deviceName: getFirstText(ring, ['deviceName', 'name']),
    deviceModel: getFirstText(ring, ['model', 'deviceModel', 'protocol']),
    firmwareVersion: getFirstText(ring, ['firmwareVersion', 'firmware', 'version']),
    appVersion: 'mp-weixin',
    platform: getFirstText(systemInfo, ['uniPlatform', 'platform', 'system']) || 'mp-weixin',
    systemInfo,
    sourcePage: sourcePage.value,
    sourceFaqId: sourceFaqId.value,
    sourceFaqTitle: sourceFaqTitle.value
  };
  devicePreview.value = {
    name: context.deviceName || '-',
    mac: context.deviceMac || '-',
    version: context.firmwareVersion || '-'
  };
  return context;
};

const chooseImages = () => {
  if (!canAddImage.value) return;
  uni.chooseImage({
    count: MAX_IMAGE_COUNT - imagePaths.value.length,
    sizeType: ['compressed', 'original'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      const files = (res.tempFiles || []) as Array<{ path?: string; size?: number }>;
      const validPaths: string[] = [];
      for (const file of files) {
        if (file.size && file.size > MAX_IMAGE_SIZE) {
          uni.showToast({ title: '单张图片不能超过5MB', icon: 'none' });
          continue;
        }
        if (file.path) validPaths.push(file.path);
      }
      imagePaths.value = [...imagePaths.value, ...validPaths].slice(0, MAX_IMAGE_COUNT);
    }
  });
};

const removeImage = (index: number) => {
  imagePaths.value = imagePaths.value.filter((_, itemIndex) => itemIndex !== index);
};

const validateForm = () => {
  if (!category.value) {
    uni.showToast({ title: '请选择问题类型', icon: 'none' });
    return false;
  }
  if (descriptionLength.value < 10) {
    uni.showToast({ title: '问题描述至少10个字', icon: 'none' });
    return false;
  }
  if (descriptionLength.value > 500) {
    uni.showToast({ title: '问题描述不能超过500个字', icon: 'none' });
    return false;
  }
  if (contact.value.trim().length > 50) {
    uni.showToast({ title: '联系方式不能超过50个字', icon: 'none' });
    return false;
  }
  return true;
};

const uploadImages = async () => {
  const urls: string[] = [];
  for (const imagePath of imagePaths.value) {
    urls.push(await uploadFeedbackImage(imagePath));
  }
  return urls;
};

const handleSubmit = async () => {
  if (submitting.value || !validateForm()) return;
  submitting.value = true;
  try {
    const images = imagePaths.value.length ? await uploadImages() : [];
    const result = await submitFeedback({
      category: category.value as FeedbackCategory,
      categoryLabel: selectedCategoryLabel.value,
      description: description.value.trim(),
      contact: contact.value.trim(),
      images,
      ...(await collectFeedbackContext())
    });
    submitResult.value = result || {};
    submitted.value = true;
  } catch (error: any) {
    uni.showToast({
      title: error?.message || '提交失败，请稍后重试',
      icon: 'none'
    });
  } finally {
    submitting.value = false;
  }
};

const copyWechat = () => {
  const wechat = submitResult.value.customerServiceWechat;
  if (!wechat) return;
  uni.setClipboardData({ data: wechat });
};

const previewCustomerServiceQr = () => {
  const qr = submitResult.value.customerServiceQr;
  if (!qr) return;
  uni.previewImage({ urls: [qr] });
};

const saveCustomerServiceQr = () => {
  const qr = submitResult.value.customerServiceQr;
  if (!qr) return;
  uni.downloadFile({
    url: qr,
    success: (downloadRes) => {
      if (downloadRes.statusCode !== 200 || !downloadRes.tempFilePath) {
        uni.showToast({ title: '二维码保存失败', icon: 'none' });
        return;
      }
      uni.saveImageToPhotosAlbum({
        filePath: downloadRes.tempFilePath,
        success: () => uni.showToast({ title: '已保存到相册', icon: 'none' }),
        fail: () => uni.showToast({ title: '请允许保存到相册', icon: 'none' })
      });
    },
    fail: () => uni.showToast({ title: '二维码下载失败', icon: 'none' })
  });
};

const backToFaq = () => {
  uni.navigateBack({
    fail: () => {
      uni.redirectTo({ url: '/pagesA/mines/question' });
    }
  });
};

const goHome = () => {
  uni.switchTab({ url: '/pages/awareness/awareness' });
};

onLoad(async (query = {}) => {
  sourcePage.value = String((query as any).source || '');
  sourceFaqId.value = String((query as any).faqId || '');
  sourceFaqTitle.value = decodeURIComponent(String((query as any).faqTitle || ''));
  try {
    const config = await getCustomerServiceConfig();
    submitResult.value = { ...submitResult.value, ...(config || {}) };
  } catch {
    // 客服配置获取失败不影响用户提交反馈。
  }
  await collectFeedbackContext();
});
</script>

<template>
  <view class="feedback-page">
    <view v-if="submitted" class="success-card">
      <view class="success-icon">✓</view>
      <view class="success-title">反馈已提交</view>
      <view class="success-desc">我们会根据你提交的信息排查问题。</view>
      <view v-if="submitResult.feedbackId" class="feedback-id">反馈编号：{{ submitResult.feedbackId }}</view>

      <image
        v-if="submitResult.customerServiceQr"
        class="service-qr"
        :src="submitResult.customerServiceQr"
        mode="aspectFit"
        @tap="previewCustomerServiceQr"
      />
      <view v-if="submitResult.customerServiceQr" class="qr-tip">长按或点击查看二维码，添加客服继续沟通</view>
      <view v-if="submitResult.customerServiceWechat" class="wechat-row">
        <text>客服微信：{{ submitResult.customerServiceWechat }}</text>
        <button class="copy-button" @tap="copyWechat">复制</button>
      </view>
      <button v-if="submitResult.customerServiceQr" class="secondary-button" @tap="saveCustomerServiceQr">保存客服二维码</button>

      <button class="primary-button" @tap="backToFaq">返回常见问题</button>
      <button class="secondary-button" @tap="goHome">返回首页</button>
    </view>

    <view v-else>
      <view class="section-card">
        <view class="section-title">问题类型 <text class="required">*</text></view>
        <view class="category-grid">
          <view
            v-for="item in categoryOptions"
            :key="item.value"
            class="category-item"
            :class="{ active: category === item.value }"
            @tap="category = item.value"
          >
            {{ item.label }}
          </view>
        </view>
      </view>

      <view class="section-card">
        <view class="section-title">问题描述 <text class="required">*</text></view>
        <textarea
          v-model="description"
          class="description-input"
          maxlength="500"
          placeholder="请描述出现问题的页面、操作步骤、设备状态或提示内容，至少10个字"
          placeholder-class="placeholder"
        />
        <view class="counter" :class="{ invalid: descriptionLength > 500 }">{{ descriptionLength }}/500</view>
      </view>

      <view class="section-card">
        <view class="section-title">上传图片 <text class="optional">最多3张，单张不超过5MB</text></view>
        <view class="image-list">
          <view v-for="(path, index) in imagePaths" :key="path" class="image-item">
            <image :src="path" mode="aspectFill" />
            <view class="remove-image" @tap.stop="removeImage(index)">×</view>
          </view>
          <view v-if="canAddImage" class="add-image" @tap="chooseImages">
            <view class="add-plus">＋</view>
            <view>添加图片</view>
          </view>
        </view>
      </view>

      <view class="section-card">
        <view class="section-title">联系方式 <text class="optional">选填</text></view>
        <input
          v-model="contact"
          class="contact-input"
          maxlength="50"
          placeholder="手机号、微信号或其他联系方式"
          placeholder-class="placeholder"
        />
      </view>

      <view class="section-card">
        <view class="section-title">设备信息</view>
        <view class="device-info-row">
          <text>设备名称</text>
          <text>{{ devicePreview.name }}</text>
        </view>
        <view class="device-info-row">
          <text>设备 MAC</text>
          <text>{{ devicePreview.mac }}</text>
        </view>
        <view class="device-info-row">
          <text>当前版本</text>
          <text>{{ devicePreview.version }}</text>
        </view>
      </view>

      <view class="privacy-note">
        提交后会自动附带账号、设备、系统和来源页面信息，仅用于定位和处理本次问题。
      </view>

      <button class="submit-button" :loading="submitting" :disabled="submitting" @tap="handleSubmit">
        {{ submitting ? '提交中...' : '提交反馈' }}
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.feedback-page {
  min-height: 100vh;
  padding: 28rpx 30rpx 56rpx;
  background: #f1f3f6;
  box-sizing: border-box;
}

.section-card,
.success-card {
  margin-bottom: 24rpx;
  padding: 32rpx;
  border-radius: 30rpx;
  background: #fff;
}

.section-title {
  color: #111827;
  font-size: 32rpx;
  font-weight: 700;
}

.required {
  color: #ff4d6d;
}

.optional {
  margin-left: 12rpx;
  color: #9aa1ae;
  font-size: 24rpx;
  font-weight: 400;
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20rpx;
  margin-top: 26rpx;
}

.category-item {
  padding: 22rpx 14rpx;
  border: 1rpx solid #e6eaf0;
  border-radius: 22rpx;
  color: #4b5563;
  font-size: 28rpx;
  text-align: center;
}

.category-item.active {
  border-color: #3176ff;
  background: rgba(49, 118, 255, 0.1);
  color: #3176ff;
  font-weight: 700;
}

.description-input {
  width: 100%;
  min-height: 260rpx;
  margin-top: 22rpx;
  padding: 24rpx;
  border-radius: 22rpx;
  background: #f7f8fb;
  box-sizing: border-box;
  color: #111827;
  font-size: 28rpx;
  line-height: 1.55;
}

.placeholder {
  color: #a7abb3;
}

.counter {
  margin-top: 12rpx;
  color: #9aa1ae;
  font-size: 24rpx;
  text-align: right;
}

.counter.invalid {
  color: #ff4d6d;
}

.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 18rpx;
  margin-top: 24rpx;
}

.image-item,
.add-image {
  position: relative;
  width: 164rpx;
  height: 164rpx;
  border-radius: 22rpx;
  overflow: hidden;
}

.image-item image {
  width: 100%;
  height: 100%;
}

.remove-image {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: rgba(17, 24, 39, 0.72);
  color: #fff;
  font-size: 28rpx;
  line-height: 36rpx;
  text-align: center;
}

.add-image {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1rpx dashed #c8d0dc;
  color: #7b8494;
  font-size: 24rpx;
}

.add-plus {
  margin-bottom: 8rpx;
  color: #3176ff;
  font-size: 42rpx;
}

.contact-input {
  height: 88rpx;
  margin-top: 22rpx;
  padding: 0 24rpx;
  border-radius: 22rpx;
  background: #f7f8fb;
  color: #111827;
  font-size: 28rpx;
}

.privacy-note {
  margin: 18rpx 8rpx 28rpx;
  color: #8b93a3;
  font-size: 24rpx;
  line-height: 1.5;
}

.device-info-row {
  display: flex;
  justify-content: space-between;
  gap: 20rpx;
  margin-top: 22rpx;
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.35;
}

.device-info-row text:last-child {
  max-width: 430rpx;
  color: #111827;
  text-align: right;
  word-break: break-all;
}

.submit-button,
.primary-button,
.secondary-button {
  height: 96rpx;
  border-radius: 28rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 96rpx;
}

.submit-button,
.primary-button {
  background: #3176ff;
  color: #fff;
}

.submit-button::after,
.primary-button::after,
.secondary-button::after,
.copy-button::after {
  border: none;
}

.secondary-button {
  margin-top: 20rpx;
  background: #eef2f7;
  color: #3176ff;
}

.success-card {
  padding-top: 52rpx;
  text-align: center;
}

.success-icon {
  width: 96rpx;
  height: 96rpx;
  margin: 0 auto 24rpx;
  border-radius: 50%;
  background: #18c58f;
  color: #fff;
  font-size: 54rpx;
  line-height: 96rpx;
}

.success-title {
  color: #111827;
  font-size: 40rpx;
  font-weight: 800;
}

.success-desc,
.feedback-id {
  margin-top: 16rpx;
  color: #6b7280;
  font-size: 28rpx;
}

.service-qr {
  width: 260rpx;
  height: 260rpx;
  margin: 34rpx auto 8rpx;
}

.qr-tip {
  margin-top: 8rpx;
  color: #8b93a3;
  font-size: 24rpx;
}

.wechat-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  margin: 22rpx 0 34rpx;
  color: #4b5563;
  font-size: 26rpx;
}

.copy-button {
  margin: 0;
  padding: 0 24rpx;
  height: 56rpx;
  border-radius: 999rpx;
  background: rgba(49, 118, 255, 0.1);
  color: #3176ff;
  font-size: 24rpx;
  line-height: 56rpx;
}
</style>
