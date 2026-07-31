<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getfqaGuidDetail } from '@/common/api/userGuide';
import { getBoundRingDevice } from '@/api/ringDevice';
import { useRingBLE } from '@/composables/useRingBLE';
import { formatBleErrorMessage } from '@/utils/bleError';
import { getBoundRingIdentityTail, hasBoundRingIdentity } from '@/utils/ringBinding';

const LOCAL_RING_CONNECT_FAILED_FAQ = 'ring-connect-failed';

const content = ref<string>('');
const loading = ref(false);
const localFaq = ref('');
const selfCheckBusy = ref(false);
const selfCheckResult = ref<{
  ok: boolean;
  title: string;
  detail: string;
  suggestions: string[];
} | null>(null);

const {
  deviceInfo,
  initBluetooth,
  ensureCommunicationReady,
  autoConnectLastDevice
} = useRingBLE();

const ringConnectPossibleCauses = [
  '手机蓝牙未打开，或微信/小程序没有蓝牙权限。',
  '戒指电量过低、距离手机太远，或戒指没有佩戴在可被搜索的范围内。',
  '戒指正在被另一个手机、官方 App 或其他小程序占用连接。',
  '本地绑定缓存和后台绑定信息不一致，导致自动重连目标不正确。',
  '系统蓝牙通道短暂异常，可尝试关闭蓝牙后重新打开，或重启小程序。'
];

const decodeTitle = (title: string) => {
  try {
    return decodeURIComponent(title);
  } catch {
    return title;
  }
};

const resolveSelfCheckTargetDevice = async () => {
  const currentDevice = deviceInfo.value || {};
  if (hasBoundRingIdentity(currentDevice)) return currentDevice;
  return getBoundRingDevice();
};

const buildSelfCheckSuggestions = (message: string) => {
  if (/未绑定|没有绑定/.test(message)) {
    return ['请先到“绑定新设备”完成绑定，再回到此页面自检。'];
  }
  if (/蓝牙|bluetooth|10001|不可用|未打开/i.test(message)) {
    return ['打开手机蓝牙，并在系统设置中允许微信使用蓝牙。', '返回小程序后重新点击自检。'];
  }
  if (/未搜索|未发现|找不到|距离|占用|重连/i.test(message)) {
    return ['把戒指靠近手机，确认戒指有电。', '关闭官方 App 或另一台手机上的蓝牙连接后重试。'];
  }
  if (/通信|服务|特征|notify|ready|超时|timeout/i.test(message)) {
    return ['保持戒指靠近手机，等待 5 秒后再试。', '如仍失败，请关闭小程序重新进入，或重启手机蓝牙。'];
  }
  return ['保持戒指靠近手机后重试。', '如果连续失败，请复制 RW 诊断日志排查。'];
};

const runRingConnectionSelfCheck = async () => {
  if (selfCheckBusy.value) return;
  selfCheckBusy.value = true;
  selfCheckResult.value = null;
  const startedAt = Date.now();

  try {
    const targetDevice = await resolveSelfCheckTargetDevice();
    if (!hasBoundRingIdentity(targetDevice)) {
      throw new Error('当前账号还没有绑定戒指。');
    }

    await initBluetooth();

    let ready = false;
    let firstReadyError = '';
    try {
      ready = await ensureCommunicationReady();
    } catch (error) {
      firstReadyError = formatBleErrorMessage(error);
    }

    if (!ready) {
      const reconnected = await autoConnectLastDevice();
      if (!reconnected) {
        throw new Error(firstReadyError || '未发现已绑定戒指，可能距离过远、戒指电量低，或戒指正在被其他设备占用。');
      }
      ready = await ensureCommunicationReady();
    }

    if (!ready) {
      throw new Error('戒指已尝试连接，但通信服务未就绪。');
    }

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const identityTail = getBoundRingIdentityTail(targetDevice);
    selfCheckResult.value = {
      ok: true,
      title: '自检通过',
      detail: `连接通道正常，已确认绑定戒指${identityTail === '-' ? '' : `（尾号 ${identityTail}）`}可以通信，用时约 ${elapsedSeconds} 秒。`,
      suggestions: ['如果仍然无法同步数据，请返回首页下拉刷新或重新进入小程序。']
    };
  } catch (error) {
    const message = formatBleErrorMessage(error, '连接通道自检失败，请靠近戒指后重试。');
    selfCheckResult.value = {
      ok: false,
      title: '自检未通过',
      detail: message,
      suggestions: buildSelfCheckSuggestions(message)
    };
  } finally {
    selfCheckBusy.value = false;
  }
};

onLoad(async (e) => {
  if (e?.title) {
    uni.setNavigationBarTitle({
      title: decodeTitle(String(e.title))
    });
  }

  if (e?.local) {
    localFaq.value = String(e.local);
    return;
  }

  if (e?.id) {
    loading.value = true;
    try {
      const res = await getfqaGuidDetail({ id: e.id });
      content.value = res?.content || '';
    } catch {
      content.value = '';
    } finally {
      loading.value = false;
    }
  }
});
</script>

<template>
  <view class="mine-detail-page p-30">
    <view v-if="localFaq === LOCAL_RING_CONNECT_FAILED_FAQ" class="faq-card">
      <view class="faq-title">连接不上戒指</view>
      <view class="faq-desc">
        如果戒指一直连接不上，通常不是单一原因。可以先按下面几个方向排查，也可以直接点击自检按钮，让小程序测试当前绑定戒指的蓝牙连接通道。
      </view>

      <view class="section-title">可能存在的问题</view>
      <view class="cause-list">
        <view v-for="item in ringConnectPossibleCauses" :key="item" class="cause-item">
          <text class="cause-dot"></text>
          <text>{{ item }}</text>
        </view>
      </view>

      <button class="self-check-button" :loading="selfCheckBusy" :disabled="selfCheckBusy" @tap="runRingConnectionSelfCheck">
        {{ selfCheckBusy ? '自检中...' : '自检连接通道' }}
      </button>

      <view v-if="selfCheckResult" class="self-check-result" :class="{ 'is-ok': selfCheckResult.ok, 'is-error': !selfCheckResult.ok }">
        <view class="result-title">{{ selfCheckResult.title }}</view>
        <view class="result-detail">{{ selfCheckResult.detail }}</view>
        <view v-if="selfCheckResult.suggestions.length" class="result-suggestions">
          <view v-for="item in selfCheckResult.suggestions" :key="item" class="suggestion-item">{{ item }}</view>
        </view>
      </view>
    </view>

    <uv-parse v-else-if="content" :content="content"></uv-parse>
    <view v-else-if="!loading" class="empty">暂无详情内容</view>
  </view>
</template>

<style lang="scss" scoped>
.mine-detail-page {
  min-height: 100vh;
  background: #f1f3f6;
  box-sizing: border-box;
}

.faq-card {
  padding: 36rpx 32rpx;
  border-radius: 28rpx;
  background: #fff;
}

.faq-title {
  color: #111827;
  font-size: 40rpx;
  font-weight: 700;
}

.faq-desc {
  margin-top: 18rpx;
  color: #6b7280;
  font-size: 28rpx;
  line-height: 1.65;
}

.section-title {
  margin-top: 34rpx;
  color: #111827;
  font-size: 32rpx;
  font-weight: 700;
}

.cause-list {
  margin-top: 18rpx;
}

.cause-item {
  align-items: flex-start;
  color: #4b5563;
  display: flex;
  font-size: 28rpx;
  line-height: 1.55;
  margin-bottom: 16rpx;
}

.cause-dot {
  background: #3176ff;
  border-radius: 50%;
  flex: 0 0 10rpx;
  height: 10rpx;
  margin-right: 16rpx;
  margin-top: 17rpx;
  width: 10rpx;
}

.self-check-button {
  align-items: center;
  background: #3176ff;
  border-radius: 22rpx;
  color: #fff;
  display: flex;
  font-size: 32rpx;
  font-weight: 600;
  height: 96rpx;
  justify-content: center;
  margin-top: 34rpx;
}

.self-check-button::after {
  border: none;
}

.self-check-result {
  border-radius: 22rpx;
  margin-top: 24rpx;
  padding: 24rpx;
}

.self-check-result.is-ok {
  background: #effaf5;
}

.self-check-result.is-error {
  background: #fff1f2;
}

.result-title {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.result-detail {
  color: #4b5563;
  font-size: 28rpx;
  line-height: 1.55;
  margin-top: 10rpx;
}

.result-suggestions {
  margin-top: 14rpx;
}

.suggestion-item {
  color: #6b7280;
  font-size: 26rpx;
  line-height: 1.5;
  margin-top: 8rpx;
}

.empty {
  padding: 80rpx 24rpx;
  color: #979797;
  font-size: 30rpx;
  text-align: center;
}
</style>
