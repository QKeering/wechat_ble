import { useUserStore } from '@/stores/user';

const API_BASE = (((import.meta as any).env?.VITE_API_BASE as string | undefined) || '').replace(/\/$/, '');

interface ApiResponse<T> {
  code: number;
  msg: string;
  data?: T;
}

export interface GrowthChatResponse {
  text: string;
  basis?: string[];
  confidence?: string;
  provider?: string;
  model?: string;
  modelStatus?: string;
  usage?: Record<string, any>;
}

export interface GrowthAsrResponse {
  text: string;
  provider?: string;
  model?: string;
  status?: string;
  message?: string;
  fileUrl?: string;
  fileSize?: number;
}

export interface GrowthTtsResponse {
  audioBase64?: string;
  audioUrl?: string;
  provider?: string;
  model?: string;
  status?: string;
  message?: string;
}

const normalizeNetworkError = (message?: string) => {
  const text = message || '';
  if (text.includes('time out') || text.includes('timeout') || text.includes('超时')) {
    return '识别时间较长，请稍后再试';
  }
  if (text.includes('fail')) {
    return '网络暂时不稳定，请稍后再试';
  }
  return text || '网络请求失败';
};

const request = async <T>(path: string, data?: Record<string, any>, method: 'GET' | 'POST' = 'POST'): Promise<T> => {
  const userStore = useUserStore();
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${API_BASE}/app${path}`,
      method,
      data,
      timeout: path.includes('/tts') || path.includes('/chat') ? 90000 : 30000,
      header: {
        Authorization: userStore.token || '',
        token: userStore.token || ''
      },
      success: (res) => {
        const payload = res.data as ApiResponse<T>;
        if (payload?.code === 200) {
          resolve(payload.data as T);
          return;
        }
        reject(new Error(payload?.msg || '请求失败'));
      },
      fail: (error) => reject(new Error(normalizeNetworkError(error.errMsg || '网络请求失败')))
    });
  });
};

export const chatWithGrowthGirlfriend = (question: string, context?: Record<string, any>) => {
  return request<GrowthChatResponse>('/health/growthGirlfriend/chat', { question, context });
};

export const getGrowthGirlfriendContext = () => {
  return request<Record<string, any>>('/health/growthGirlfriend/context', undefined, 'GET');
};

export const synthesizeGrowthSpeech = (text: string) => {
  return request<GrowthTtsResponse>('/health/growthGirlfriend/tts', { text });
};

export const transcribeGrowthAudio = (filePath: string) => {
  const userStore = useUserStore();
  return new Promise<GrowthAsrResponse>((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE}/app/health/growthGirlfriend/asr`,
      filePath,
      name: 'file',
      timeout: 180000,
      header: {
        Authorization: userStore.token || '',
        token: userStore.token || ''
      },
      success: (res) => {
        const rawData = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
        try {
          const payload = JSON.parse(rawData) as ApiResponse<GrowthAsrResponse>;
          if (payload.code === 200) {
            resolve(payload.data as GrowthAsrResponse);
            return;
          }
          reject(new Error(payload.msg || '语音识别失败'));
        } catch {
          const preview = rawData.replace(/\s+/g, ' ').slice(0, 120);
          reject(new Error(`语音识别接口返回非JSON，状态${res.statusCode || '-'}：${preview || '空响应'}`));
        }
      },
      fail: (error) => reject(new Error(normalizeNetworkError(error.errMsg || '语音上传失败')))
    });
  });
};
