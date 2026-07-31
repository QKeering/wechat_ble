<template>
  <view class="growth-page">
    <uv-navbar placeholder leftIcon="arrow-left" title="小轻AI成长闺蜜" bgColor="transparent" autoBack :leftIconColor="'#332b34'" :titleStyle="{ color: '#332b34' }"></uv-navbar>
    <view class="header">
      <text class="title">小轻，今天也在你身边</text>
      <text class="subtitle">AI融合多维健康大数据，生成你的专属状态洞察</text>
      <view class="pills">
        <text class="pill">已同步 · {{ syncTimeText }}</text>
        <text class="pill">隐私可控</text>
      </view>
    </view>

    <view class="spectrum">
      <view class="spectrum-title">
        <text class="spectrum-main">今日状态光谱</text>
        <text class="spectrum-sub">AI实时理解健康、美丽、成长趋势，不只给数字。</text>
      </view>
      <view class="metrics">
        <view class="metric health">
          <text class="metric-label">健康</text>
          <text class="metric-value">{{ healthScore }}</text>
          <view class="bar"><view class="fill" :style="{ width: `${healthScore}%` }" /></view>
        </view>
        <view class="metric beauty">
          <text class="metric-label">美丽</text>
          <text class="metric-value">{{ beautyScore }}</text>
          <view class="bar"><view class="fill" :style="{ width: `${beautyScore}%` }" /></view>
        </view>
        <view class="metric growth">
          <text class="metric-label">成长</text>
          <text class="metric-value">{{ growthScore }}</text>
          <view class="bar"><view class="fill" :style="{ width: `${growthScore}%` }" /></view>
        </view>
      </view>
    </view>

    <view class="pet-zone">
      <text class="mood">温柔提醒中</text>
      <view class="pet" aria-label="小轻毛绒形象">
        <view class="fur-dot dot-a" />
        <view class="fur-dot dot-b" />
        <view class="fur-dot dot-c" />
        <view class="fur-dot dot-d" />
        <view class="ear ear-left" />
        <view class="ear ear-right" />
        <view class="eye eye-left"><view class="pupil" /></view>
        <view class="eye eye-right"><view class="pupil" /></view>
        <view class="smile" />
      </view>
      <view class="shadow" />

      <view class="dialog">
        <text class="dialog-title">小轻正在听你说</text>
        <text class="dialog-copy">{{ listeningDisplayText }}</text>
        <view class="waves">
          <view v-for="item in 6" :key="item" class="wave" />
        </view>
        <view class="divider" />
        <view class="reply-head">
          <text class="reply-title">小轻的回答</text>
        <button class="reply-tag" @tap="playAnswer">播报</button>
      </view>
        <text class="reply-copy">{{ isAnswering ? '小轻正在整理回答...' : answerText }}</text>
      </view>
    </view>

    <view class="quick">
      <button v-for="item in quickQuestions" :key="item" class="quick-button" @tap="askQuick(item)">
        {{ item }}
      </button>
    </view>

    <view class="composer">
      <view class="voice-wrap" :class="{ active: isVoiceActive }">
        <view class="voice-halo" />
        <text class="voice-tip">{{ isListening ? '松开后识别语音' : '按住说话' }}</text>
        <button
          class="voice-button"
          :class="{ listening: isListening, pressing: isPressingVoice }"
          @touchstart.stop.prevent="startVoice"
          @touchend.stop.prevent="stopVoice"
          @touchcancel.stop.prevent="cancelVoice"
        >
          ♪
        </button>
      </view>
      <view class="text-entry">
        <input v-model="question" class="question-input" placeholder="输入你的问题" confirm-type="send" @confirm="submitQuestion" />
        <button class="today-button" @tap="submitQuestion">发送</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { chatWithGrowthGirlfriend, getGrowthGirlfriendContext, synthesizeGrowthSpeech, transcribeGrowthAudio } from '@/api';
import { useRingBusinessData } from '@/composables/useRingBusinessData';

const ringBusinessData = useRingBusinessData();
const question = ref('');
const isListening = ref(false);
const isPressingVoice = ref(false);
const latestQuestion = ref('');
const heardText = ref('');
const greetingText = ref('');
const aiAnswer = ref('');
const isAnswering = ref(false);
const isSpeaking = ref(false);
const serverContext = ref<Record<string, any> | null>(null);
let recorder: UniApp.RecorderManager | null = null;
let audio: UniApp.InnerAudioContext | null = null;
let voiceStartAt = 0;
let ignoreNextVoiceResult = false;
let recorderBusy = false;
const VOICE_MIN_DURATION_MS = 500;
const VOICE_RECOGNIZE_TIMEOUT_MS = 25000;

const metrics = computed(() => ringBusinessData.healthData.value);
const isVoiceActive = computed(() => isListening.value || isPressingVoice.value);

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const healthScore = computed(() => {
  const serverScore = Number(serverContext.value?.scores?.health);
  if (Number.isFinite(serverScore) && serverScore > 0) return clampScore(serverScore);
  const parts = [
    scoreHeartRate(numberValue(metrics.value.heartRate)),
    scoreSpo2(numberValue(metrics.value.bloodOxygen)),
    scoreHrv(numberValue(metrics.value.hrv)),
    scoreStress(numberValue(metrics.value.stress), true)
  ].filter((item) => item > 0);
  if (parts.length === 0) return 68;
  return clampScore(parts.reduce((sum, item) => sum + item, 0) / parts.length);
});

const beautyScore = computed(() => {
  const serverScore = Number(serverContext.value?.scores?.beauty);
  if (Number.isFinite(serverScore) && serverScore > 0) return clampScore(serverScore);
  const stress = numberValue(metrics.value.stress);
  const hrv = numberValue(metrics.value.hrv);
  if (stress <= 0 && hrv <= 0) return 72 + new Date().getDate() % 8;
  return clampScore(82 - stress * 0.35 + Math.min(hrv, 80) * 0.12);
});

const growthScore = computed(() => {
  const serverScore = Number(serverContext.value?.scores?.growth);
  if (Number.isFinite(serverScore) && serverScore > 0) return clampScore(serverScore);
  const steps = numberValue(metrics.value.stepCount);
  const sleepMinutes = numberValue(metrics.value.sleepTotalMinutes);
  const stepScore = Math.min(100, steps / 80);
  const sleepScore = sleepMinutes > 0 ? Math.min(100, sleepMinutes / 4.8) : 60;
  return clampScore(stepScore * 0.65 + sleepScore * 0.35);
});

const syncTimeText = computed(() => {
  return ringBusinessData.businessDataFreshnessText.value;
});

const greetingOptions = [
  '今天想先聊聊状态，还是想让我陪你定个小目标？',
  '我在这里，先说一句你现在最想解决的事吧。',
  '今天也不用一个人扛着，慢慢说给我听。',
  '想变美、放松，还是准备重要的事？我听着呢。'
];

const listeningDisplayText = computed(() => {
  if (isListening.value) return '我正在听，松开后帮你整理成文字。';
  if (heardText.value) return `你说：${heardText.value}`;
  return greetingText.value || greetingOptions[0];
});

const answerText = computed(() => {
  if (aiAnswer.value) return aiAnswer.value;
  const serverAnswer = serverContext.value?.answer?.text;
  if (serverAnswer) return serverAnswer;
  if (latestQuestion.value) {
    return `关于“${latestQuestion.value}”，小轻会结合AI健康大数据、今日体征趋势和你的个人上下文，整理成更适合你的建议。`;
  }
  return '小轻已同步你的多维状态：今天建议先保持轻节奏，优先完成低压力事项，再根据恢复感安排重点任务。';
});

const quickQuestions = ['我今天状态怎么样？', '帮我变美', '陪我准备面试'];

const scoreHeartRate = (value: number) => {
  if (!value) return 0;
  return clampScore(100 - Math.abs(value - 72) * 1.4);
};

const scoreSpo2 = (value: number) => {
  if (!value) return 0;
  return clampScore((value - 90) * 10);
};

const scoreHrv = (value: number) => {
  if (!value) return 0;
  return clampScore(value * 1.4);
};

const scoreStress = (value: number, inverse = false) => {
  if (!value) return 0;
  return clampScore(inverse ? 100 - value : value);
};

const startVoice = () => {
  if (!recorder) {
    uni.showToast({ title: '当前环境不支持录音', icon: 'none' });
    return;
  }
  if (recorderBusy || isListening.value) {
    return;
  }
  recorderBusy = true;
  ignoreNextVoiceResult = false;
  voiceStartAt = Date.now();
  isPressingVoice.value = true;
  isListening.value = true;
  try {
    recorder.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    });
  } catch {
    recorderBusy = false;
    isListening.value = false;
    isPressingVoice.value = false;
    uni.showToast({ title: '录音正在准备，请稍后再试', icon: 'none' });
  }
};

const stopVoice = () => {
  isPressingVoice.value = false;
  if (!recorder || !isListening.value || !recorderBusy) return;
  const duration = Date.now() - voiceStartAt;
  if (duration < VOICE_MIN_DURATION_MS) {
    ignoreNextVoiceResult = true;
    uni.showToast({ title: '说得太短啦', icon: 'none' });
  } else {
    uni.showLoading({ title: '正在识别', mask: true });
  }
  recorder.stop();
  isListening.value = false;
};

const cancelVoice = () => {
  isPressingVoice.value = false;
  if (!recorder || !isListening.value || !recorderBusy) return;
  ignoreNextVoiceResult = true;
  recorder.stop();
  isListening.value = false;
};

const voiceErrorMessage = (message?: string) => {
  if (!message) return '语音识别暂不可用，请先文字输入';
  if (message.includes('dashscope') || message.includes('No module named')) {
    return '语音服务正在配置中，请先文字输入';
  }
  if (message.includes('time out') || message.includes('timeout') || message.includes('超时')) {
    return '识别时间较长，请稍后再试';
  }
  return message;
};

const compactToastMessage = (message: string) => {
  if (!message) return '语音识别暂不可用';
  return message.length > 18 ? '语音识别失败，请看回答区原因' : message;
};

const withTimeout = async <T,>(task: Promise<T>, ms: number, message: string): Promise<T> => {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
};

const askQuick = (value: string) => {
  heardText.value = value;
  question.value = value;
  submitQuestion();
};

const submitQuestion = async () => {
  const text = question.value.trim();
    if (!text) {
      uni.showToast({ title: '先说一句或输入问题', icon: 'none' });
      return;
    }
  heardText.value = text;
  latestQuestion.value = text;
  question.value = '';
  isAnswering.value = true;
  try {
    const result = await chatWithGrowthGirlfriend(text, {
      scores: {
        health: healthScore.value,
        beauty: beautyScore.value,
        growth: growthScore.value
      },
      metrics: metrics.value,
      dataFreshness: {
        text: ringBusinessData.businessDataFreshnessText.value,
        ageMs: ringBusinessData.businessDataAgeMs.value,
        isStale: ringBusinessData.isBusinessDataStale.value
      },
      device: {
        name: ringBusinessData.currentDeviceName.value,
        identity: ringBusinessData.currentDeviceIdentity.value
      }
    });
    aiAnswer.value = result.text || '';
    void playAnswer(false);
  } catch (error) {
    aiAnswer.value = `关于“${text}”，小轻先基于本地状态数据给你一个轻量建议：今天不要硬撑，先完成低压力任务，再根据恢复感安排重点事项。`;
    uni.showToast({ title: error instanceof Error ? error.message : 'AI 请求失败', icon: 'none' });
  } finally {
    isAnswering.value = false;
  }
};

onMounted(() => {
  greetingText.value = greetingOptions[Math.floor(Math.random() * greetingOptions.length)];
  void loadServerContext();
  recorder = uni.getRecorderManager();
  recorder.onStop(async (res) => {
    isListening.value = false;
    isPressingVoice.value = false;
    recorderBusy = false;
    if (ignoreNextVoiceResult) {
      ignoreNextVoiceResult = false;
      uni.hideLoading();
      return;
    }
    if (!res.tempFilePath) {
      uni.hideLoading();
      aiAnswer.value = '没有拿到录音文件，请确认已允许小程序使用麦克风权限。';
      return;
    }
    try {
      heardText.value = '正在识别你的语音...';
      const asr = await withTimeout(
        transcribeGrowthAudio(res.tempFilePath),
        VOICE_RECOGNIZE_TIMEOUT_MS,
        '语音识别超过25秒，请先文字输入'
      );
      if (!asr.text) {
        const detail = [asr.status, asr.message].filter(Boolean).join('：');
        const message = voiceErrorMessage(detail || '没有识别到语音内容，请稍微靠近麦克风再试一次。');
        uni.hideLoading();
        aiAnswer.value = `语音没有识别成文字。原因：${message}`;
        uni.showToast({ title: compactToastMessage(message), icon: 'none' });
        return;
      }
      uni.hideLoading();
      heardText.value = asr.text;
      question.value = asr.text;
      await submitQuestion();
    } catch (error) {
      const message = voiceErrorMessage(error instanceof Error ? error.message : '');
      uni.hideLoading();
      aiAnswer.value = `语音识别失败。原因：${message}`;
      uni.showToast({ title: compactToastMessage(message), icon: 'none' });
    } finally {
      uni.hideLoading();
    }
  });
  recorder.onError((error) => {
    isListening.value = false;
    isPressingVoice.value = false;
    recorderBusy = false;
    uni.hideLoading();
    const message = error.errMsg?.includes('audio is recording') ? '上一段语音还在收尾，请稍后再按' : error.errMsg || '录音失败';
    uni.showToast({ title: message, icon: 'none' });
  });
  audio = uni.createInnerAudioContext();
});

onUnmounted(() => {
  if (recorder && recorderBusy) recorder.stop();
  recorderBusy = false;
  if (audio) {
    audio.stop();
    audio.destroy();
  }
});

const loadServerContext = async () => {
  try {
    serverContext.value = await getGrowthGirlfriendContext();
  } catch {
    serverContext.value = null;
  }
};

const playAnswer = async (showPendingToast = true) => {
  if (!answerText.value || isSpeaking.value) return;
  isSpeaking.value = true;
  try {
    const result = await synthesizeGrowthSpeech(answerText.value);
    const source = result.audioUrl || (result.audioBase64 ? `data:audio/mp3;base64,${result.audioBase64}` : '');
    if (!source) {
      if (showPendingToast) uni.showToast({ title: result.message || '语音播报待配置', icon: 'none' });
      return;
    }
    if (!audio) audio = uni.createInnerAudioContext();
    audio.src = source;
    audio.play();
  } catch (error) {
    if (showPendingToast) uni.showToast({ title: error instanceof Error ? error.message : '语音播报失败', icon: 'none' });
  } finally {
    isSpeaking.value = false;
  }
};
</script>

<style lang="scss" scoped>
.growth-page {
  min-height: 100vh;
  padding: 32rpx 32rpx 28rpx;
  box-sizing: border-box;
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 207, 229, 0.76), transparent 34%),
    radial-gradient(circle at 14% 26%, rgba(154, 219, 137, 0.28), transparent 28%),
    radial-gradient(circle at 88% 32%, rgba(255, 230, 177, 0.44), transparent 28%),
    linear-gradient(180deg, #fff5f9 0%, #fffaf0 52%, #f4f8ef 100%);
}

.header,
.spectrum-title,
.pet-zone,
.dialog,
.reply-head {
  display: flex;
  align-items: center;
  flex-direction: column;
}

.header {
  gap: 8rpx;
  text-align: center;
}

.title {
  color: #332b34;
  font-size: 38rpx;
  font-weight: 800;
  line-height: 1.2;
}

.subtitle,
.spectrum-sub,
.dialog-copy,
.reply-copy {
  color: #8b7f88;
  font-size: 22rpx;
  line-height: 1.5;
}

.pills,
.metrics,
.quick,
.composer,
.text-entry {
  display: flex;
  align-items: center;
}

.pills {
  gap: 14rpx;
  margin-top: 8rpx;
}

.pill {
  padding: 12rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.78);
  color: #57935b;
  font-size: 22rpx;
  font-weight: 700;
  box-shadow: 0 10rpx 24rpx rgba(115, 82, 102, 0.1);
}

.spectrum {
  margin-top: 26rpx;
  padding: 26rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.78);
  border-radius: 26rpx;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.45)),
    radial-gradient(circle at 50% 18%, rgba(255, 221, 237, 0.9), transparent 38%);
  box-shadow: 0 18rpx 42rpx rgba(97, 77, 88, 0.12);
}

.spectrum-main {
  color: #332b34;
  font-size: 34rpx;
  font-weight: 800;
}

.metrics {
  gap: 18rpx;
  margin-top: 22rpx;
}

.metric {
  flex: 1;
  min-width: 0;
  padding: 20rpx;
  border-radius: 18rpx;
  background: rgba(255, 255, 255, 0.78);
  text-align: center;
  box-shadow: 0 12rpx 26rpx rgba(113, 88, 101, 0.08);
}

.metric-label {
  color: #8b7f88;
  font-size: 22rpx;
  font-weight: 700;
}

.metric-value {
  display: block;
  margin: 10rpx 0 14rpx;
  font-size: 42rpx;
  font-weight: 800;
  line-height: 1;
}

.health .metric-value {
  color: #359a50;
}

.beauty .metric-value {
  color: #e95f9d;
}

.growth .metric-value {
  color: #d59c54;
}

.bar {
  height: 12rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: #f1eaf0;
}

.fill {
  height: 100%;
  border-radius: inherit;
}

.health .fill {
  background: #77bc5d;
}

.beauty .fill {
  background: #e95f9d;
}

.growth .fill {
  background: #d59c54;
}

.pet-zone {
  position: relative;
  min-height: 664rpx;
  padding-top: 88rpx;
}

.mood {
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.78);
  color: #e95f9d;
  font-size: 22rpx;
  font-weight: 800;
  box-shadow: 0 12rpx 24rpx rgba(218, 91, 148, 0.12);
}

.pet {
  position: relative;
  width: 310rpx;
  height: 238rpx;
  margin-top: 42rpx;
  border-radius: 49% 50% 42% 43%;
  background:
    radial-gradient(circle at 29% 23%, rgba(255, 255, 255, 0.64) 0 8rpx, transparent 10rpx),
    radial-gradient(circle at 64% 18%, rgba(255, 255, 255, 0.38) 0 10rpx, transparent 12rpx),
    linear-gradient(180deg, #dbf58b 0%, #bde065 42%, #9ccc45 100%);
  box-shadow:
    0 28rpx 42rpx rgba(94, 127, 50, 0.22),
    inset 0 24rpx 38rpx rgba(255, 255, 255, 0.28),
    inset 0 -22rpx 36rpx rgba(86, 129, 37, 0.2);
}

.fur-dot,
.ear {
  position: absolute;
  border-radius: 50%;
  background: rgba(207, 235, 92, 0.72);
}

.dot-a {
  left: 28rpx;
  top: 92rpx;
  width: 42rpx;
  height: 42rpx;
}

.dot-b {
  right: 34rpx;
  top: 88rpx;
  width: 38rpx;
  height: 38rpx;
}

.dot-c {
  left: 74rpx;
  bottom: 34rpx;
  width: 44rpx;
  height: 44rpx;
}

.dot-d {
  right: 80rpx;
  bottom: 40rpx;
  width: 36rpx;
  height: 36rpx;
}

.ear-left {
  left: 70rpx;
  top: -14rpx;
  width: 44rpx;
  height: 34rpx;
}

.ear-right {
  right: 72rpx;
  top: -14rpx;
  width: 42rpx;
  height: 34rpx;
}

.eye {
  position: absolute;
  top: 88rpx;
  width: 62rpx;
  height: 70rpx;
  border: 5rpx solid #b5c0ba;
  border-radius: 50%;
  background: #f9fff9;
}

.eye-left {
  left: 92rpx;
}

.eye-right {
  right: 92rpx;
}

.pupil {
  position: absolute;
  right: 8rpx;
  bottom: 8rpx;
  width: 38rpx;
  height: 38rpx;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 28%, #ffffff 0 7rpx, transparent 8rpx), #0ab360;
}

.smile {
  position: absolute;
  left: 50%;
  bottom: 48rpx;
  width: 56rpx;
  height: 24rpx;
  transform: translateX(-50%);
  border-bottom: 5rpx solid rgba(73, 93, 45, 0.35);
  border-radius: 0 0 999rpx 999rpx;
}

.shadow {
  width: 230rpx;
  height: 34rpx;
  margin-top: -8rpx;
  border-radius: 50%;
  background: rgba(98, 125, 57, 0.16);
}

.dialog {
  width: 560rpx;
  max-width: 100%;
  margin-top: 10rpx;
  padding: 24rpx 28rpx;
  border: 1rpx solid rgba(255, 255, 255, 0.8);
  border-radius: 26rpx;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 14rpx 24rpx rgba(113, 88, 101, 0.09);
}

.dialog-title,
.reply-title {
  color: #332b34;
  font-size: 28rpx;
  font-weight: 800;
}

.waves {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 48rpx;
  margin-top: 12rpx;
}

.wave {
  width: 8rpx;
  border-radius: 999rpx;
  background: linear-gradient(180deg, #ff91c8, #e84d9d);
  animation: wave 1.1s ease-in-out infinite;
}

.wave:nth-child(1) {
  height: 18rpx;
}

.wave:nth-child(2) {
  height: 32rpx;
  animation-delay: 0.08s;
}

.wave:nth-child(3) {
  height: 44rpx;
  animation-delay: 0.16s;
}

.wave:nth-child(4) {
  height: 30rpx;
  animation-delay: 0.24s;
}

.wave:nth-child(5) {
  height: 38rpx;
  animation-delay: 0.32s;
}

.wave:nth-child(6) {
  height: 22rpx;
  animation-delay: 0.4s;
}

.divider {
  width: 100%;
  height: 1rpx;
  margin: 18rpx 0 16rpx;
  background: rgba(90, 65, 82, 0.08);
}

.reply-head {
  gap: 8rpx;
}

.reply-tag {
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: #eff8e9;
  color: #57935b;
  font-size: 20rpx;
  font-weight: 800;
}

.reply-copy {
  margin-top: 10rpx;
  color: #5b525b;
  text-align: center;
}

.quick {
  justify-content: center;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

.quick-button {
  height: 52rpx;
  margin: 0;
  padding: 0 18rpx;
  border: 1rpx solid rgba(219, 64, 143, 0.14);
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.78);
  color: #885a72;
  font-size: 22rpx;
  font-weight: 800;
  line-height: 52rpx;
}

.quick-button::after,
.voice-button::after,
.today-button::after {
  border: 0;
}

.voice-wrap {
  position: relative;
  width: 132rpx;
  height: 132rpx;
  flex: 0 0 132rpx;
}

.voice-halo {
  position: absolute;
  inset: -12rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 145, 200, 0.3), rgba(255, 145, 200, 0));
  opacity: 0;
  transform: scale(0.88);
  transition: opacity 0.18s ease, transform 0.18s ease;
  pointer-events: none;
}

.voice-tip {
  position: absolute;
  left: 50%;
  bottom: 150rpx;
  z-index: 3;
  width: max-content;
  max-width: 260rpx;
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(63, 46, 58, 0.88);
  color: #ffffff;
  font-size: 22rpx;
  line-height: 1.3;
  opacity: 0;
  transform: translate(-50%, 10rpx);
  transition: opacity 0.18s ease, transform 0.18s ease;
  pointer-events: none;
  white-space: nowrap;
}

.voice-wrap.active .voice-halo {
  opacity: 1;
  transform: scale(1.08);
  animation: voiceGlow 1.2s ease-in-out infinite;
}

.voice-wrap.active .voice-tip {
  opacity: 1;
  transform: translate(-50%, 0);
}

.composer {
  gap: 20rpx;
  padding: 22rpx 24rpx;
  border: 1rpx solid rgba(219, 64, 143, 0.14);
  border-radius: 30rpx;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 18rpx 36rpx rgba(113, 88, 101, 0.14);
}

.voice-button {
  position: relative;
  z-index: 2;
  width: 132rpx;
  height: 132rpx;
  margin: 0;
  border-radius: 50%;
  background: linear-gradient(180deg, #ff91c8, #e84d9d);
  color: #ffffff;
  font-size: 54rpx;
  line-height: 132rpx;
  box-shadow: 0 10rpx 18rpx rgba(219, 64, 143, 0.25);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.voice-button.listening,
.voice-button.pressing {
  transform: scale(1.05);
  box-shadow:
    0 0 0 12rpx rgba(233, 95, 157, 0.13),
    0 0 34rpx rgba(232, 77, 157, 0.42),
    0 12rpx 22rpx rgba(219, 64, 143, 0.28);
}

.text-entry {
  flex: 1;
  gap: 12rpx;
  min-width: 0;
}

.question-input {
  flex: 1;
  height: 76rpx;
  min-width: 0;
  padding: 0 22rpx;
  border-radius: 18rpx;
  background: #fff7fb;
  color: #332b34;
  font-size: 24rpx;
}

.today-button {
  width: 126rpx;
  height: 76rpx;
  margin: 0;
  border-radius: 18rpx;
  background: #359a50;
  color: #ffffff;
  font-size: 22rpx;
  font-weight: 800;
  line-height: 76rpx;
}

@keyframes wave {
  0%,
  100% {
    transform: scaleY(0.55);
    opacity: 0.55;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

@keyframes voiceGlow {
  0%,
  100% {
    transform: scale(1.02);
    opacity: 0.72;
  }

  50% {
    transform: scale(1.18);
    opacity: 1;
  }
}
</style>
