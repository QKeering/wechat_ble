import { useUserStore } from '@/stores/user';

const API_BASE = (((import.meta as any).env?.VITE_API_BASE as string | undefined) || '').replace(/\/$/, '');

export type FeedbackCategory =
  | 'connect_failed'
  | 'sync_failed'
  | 'data_abnormal'
  | 'charge_failed'
  | 'bind_failed'
  | 'wear_measure'
  | 'account_family'
  | 'other';

export type FeedbackPayload = {
  category: FeedbackCategory;
  categoryLabel: string;
  description: string;
  contact?: string;
  images?: string[];
  sourcePage?: string;
  sourceFaqId?: string;
  sourceFaqTitle?: string;
  userId?: string | number;
  nickname?: string;
  phone?: string;
  deviceMac?: string;
  deviceName?: string;
  deviceModel?: string;
  firmwareVersion?: string;
  appVersion?: string;
  platform?: string;
  systemInfo?: Record<string, any>;
};

export type FeedbackSubmitResult = {
  feedbackId?: string;
  customerServiceQr?: string;
  customerServiceWechat?: string;
  qrUrl?: string;
  wechatId?: string;
  tips?: string;
};

const normalizeFeedbackResult = (value: any): FeedbackSubmitResult => {
  const payload = value?.data && typeof value.data === 'object' ? value.data : value || {};
  return {
    ...payload,
    customerServiceQr: payload.customerServiceQr || payload.qrUrl || '',
    customerServiceWechat: payload.customerServiceWechat || payload.wechatId || ''
  };
};

export const submitFeedback = async (data: FeedbackPayload): Promise<FeedbackSubmitResult> => {
  return normalizeFeedbackResult(await (uni as any).$uv.http.post('/app/feedback/submit', data));
};

export const getCustomerServiceConfig = async (): Promise<FeedbackSubmitResult> => {
  return normalizeFeedbackResult(await (uni as any).$uv.http.get('/app/config/customerService'));
};

const normalizeUploadUrl = (url: string) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
};

export const uploadFeedbackImage = (filePath: string): Promise<string> => {
  const userStore = useUserStore();
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${API_BASE}/app/upload/image`,
      filePath,
      name: 'file',
      header: {
        Authorization: userStore.token || '',
        token: userStore.token || ''
      },
      success: (res) => {
        try {
          const payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (payload?.code !== 200 && payload?.code !== 0) {
            reject(new Error(payload?.msg || '图片上传失败'));
            return;
          }
          const url =
            payload?.data?.url ||
            payload?.data?.fileName ||
            payload?.url ||
            payload?.fileName ||
            payload?.newFileName ||
            '';
          if (!url) {
            reject(new Error('图片上传接口未返回地址'));
            return;
          }
          resolve(normalizeUploadUrl(String(url)));
        } catch (error) {
          reject(error);
        }
      },
      fail: (error) => reject(error)
    });
  });
};
