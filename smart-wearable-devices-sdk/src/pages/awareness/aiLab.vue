<script setup lang="ts">
import { ref, computed } from 'vue';
import { onShow, onLoad, onUnload } from '@dcloudio/uni-app';
import { getAiLabStatus } from '@/common/api/aiLab';

enum APPLY_STATUS {
  not_apply = -1,
  applying = 0,
  passed = 1,
  rejected = 2
}

const applyStatus = ref<APPLY_STATUS>(APPLY_STATUS.not_apply);
const jumpUrl = ref<string>('');
const remark = ref<string>('');
const isLoading = ref(false);

const applyText = computed(() => {
  switch (applyStatus.value) {
    case APPLY_STATUS.not_apply:
      return '申请体验';
    case APPLY_STATUS.applying:
      return '审核中';
    case APPLY_STATUS.passed:
      return '进入体验';
    case APPLY_STATUS.rejected:
      return '重新申请';
    default:
      return '申请体验';
  }
});

const handleApplyClick = () => {
  if (applyStatus.value === APPLY_STATUS.passed && jumpUrl.value) {
    // 解析 jumpUrl，提取路由部分
    // 格式如：https://em.qkeering.com/#/aiPet -> 提取 #/aiPet
    let route = '';
    if (jumpUrl.value.includes('#')) {
      const hashIndex = jumpUrl.value.indexOf('#');
      route = jumpUrl.value.substring(hashIndex);
    } else if (jumpUrl.value.includes('em.qkeering.com')) {
      // 如果包含域名但没有 #，可能是新页面，直接传完整URL
      uni.navigateTo({ url: `/pages/webview-custom/webview-custom?url=${encodeURIComponent(jumpUrl.value)}` });
      return;
    } else {
      route = jumpUrl.value;
    }

    uni.navigateTo({
      url: `/pages/webview-custom/webview-custom?route=${encodeURIComponent(route)}`
    });
  } else if (applyStatus.value === APPLY_STATUS.rejected && remark.value) {
    uni.showModal({
      title: '申请未通过',
      content: `拒绝原因：${remark.value}`,
      showCancel: true,
      confirmText: '重新申请',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          uni.navigateTo({ url: '/pages/awareness/aiApply' });
        }
      }
    });
  } else if (applyStatus.value === APPLY_STATUS.not_apply || applyStatus.value === APPLY_STATUS.rejected) {
    uni.navigateTo({ url: '/pages/awareness/aiApply' });
  }
};

const fetchApplyStatus = async () => {
  if (isLoading.value) return;
  isLoading.value = true;

  try {
    const res: any = await getAiLabStatus();
    if (res) {
      const { status, jumpUrl: url, remark: reason } = res;
      applyStatus.value = status as APPLY_STATUS;
      jumpUrl.value = url || '';
      remark.value = reason || '';
    }
  } catch {
    remark.value = remark.value || '';
  } finally {
    isLoading.value = false;
  }
};

onLoad(() => {
  uni.$on('refreshAiStatus', fetchApplyStatus);
});

onShow(() => {
  fetchApplyStatus();
});

onUnload(() => {
  uni.$off('refreshAiStatus', fetchApplyStatus);
});
</script>

<template>
  <view class="ai-lab-container">
    <!-- AI实验室卡片 -->
    <view class="ai-lab-card">
      <!-- 左侧图标 -->
      <view class="ai-lab-icon">
        <text class="ai-lab-icon-text">AI</text>
      </view>
      
      <!-- 中间文字内容 -->
      <view class="ai-lab-content">
        <text class="ai-lab-title">AI智能体Lab</text>
        <text class="ai-lab-subtitle">AI体验中心</text>
      </view>
      
      <!-- 右侧按钮 -->
      <view class="ai-lab-button">
        <uv-button 
          type="primary" 
          size="mini" 
          color="RGB(46,112,252)"
          @click="handleApplyClick"
          :disabled="applyStatus === APPLY_STATUS.applying"
          :custom-style="{ borderRadius: '50rpx', padding: '0 50rpx', height: '70rpx', fontSize: '26rpx' }"
        >
          {{ applyText }}
        </uv-button>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-lab-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  // padding: 30rpx 0;
}

.ai-lab-card {
  display: flex;
  align-items: center;
  min-height: 116rpx;
  padding: 22rpx 24rpx;
  border-radius: 30rpx;
  background: #ffffff;
  border: 1rpx solid rgba(46, 112, 252, 0.08);
  box-shadow: 0 10rpx 24rpx rgba(31, 45, 61, 0.04);
  width: 100%;
  box-sizing: border-box;
}

.ai-lab-icon {
  width: 100rpx;
  height: 100rpx;
  border-radius: 50%;
  background: linear-gradient(180deg, #ff8cc7 0%, #3474ff 100%);
  display: flex;
  justify-content: center;
  align-items: center;
  margin-right: 20rpx;
  box-shadow: 0 12rpx 22rpx rgba(46, 112, 252, 0.18);
}

.ai-lab-icon-text {
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 800;
}

.ai-lab-content {
  flex: 1;
  flex-direction: column;
  display: flex;
}

.ai-lab-title {
  font-size: 36rpx;
  font-weight: bold;
  color: #333333;
  line-height: 1.2;
}

.ai-lab-subtitle {
  font-size: 28rpx;
  color: #666666;
  margin-top: 8rpx;
}

.ai-lab-button {
  margin-left: 20rpx;
}
</style>
