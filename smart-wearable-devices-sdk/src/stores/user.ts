import { defineStore, storeToRefs } from 'pinia';
import { ref } from 'vue';
import { useRingStore } from './ring';
import { getUserInfo, updateUserInfo } from '@/common/api/user';
import { sanitizeWechatNickName } from '@/utils/wechatProfile';

const LOGIN_TOKEN_KEYS = [
  'token',
  'accessToken',
  'access_token',
  'tokenValue',
  'token_value',
  'Authorization',
  'authorization',
  'jwt'
];

const LOGIN_USER_INFO_KEYS = ['userInfo', 'user', 'member', 'profile', 'account'];
const DEFAULT_PHONE_NICKNAME_RE = /^用户(\d{4})$/;
const PHONE_FIELD_KEYS = [
  'phone',
  'mobile',
  'mobilePhone',
  'phoneNumber',
  'telephone',
  'userPhone',
  'contactPhone',
  'phoneMasked',
  'mobileMasked'
];

type ApplyLoginResponseOptions = {
  wxProfile?: unknown;
  wxNickName?: string;
};

const pickFirstValue = (source: unknown, keys: string[], seen = new Set<unknown>()): string => {
  if (!source || typeof source !== 'object' || seen.has(source)) return '';
  seen.add(source);

  const record = source as Record<string, any>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }

  for (const value of Object.values(record)) {
    const nested = pickFirstValue(value, keys, seen);
    if (nested) return nested;
  }

  return '';
};

const pickFirstObject = (source: unknown, keys: string[], seen = new Set<unknown>()): Record<string, any> | null => {
  if (!source || typeof source !== 'object' || seen.has(source)) return null;
  seen.add(source);

  const record = source as Record<string, any>;
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }

  for (const value of Object.values(record)) {
    const nested = pickFirstObject(value, keys, seen);
    if (nested) return nested;
  }

  return null;
};

const createLoginFallbackUserInfo = (tokenValue: string) => ({
  id: tokenValue,
  nickName: 'User'
});

const getPhoneLast4 = (source: Record<string, any> | null | undefined) => {
  const phoneText = pickFirstValue(source, PHONE_FIELD_KEYS);
  const digits = phoneText.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
};

const isPhoneDefaultNickName = (nickName: unknown, source: Record<string, any> | null | undefined) => {
  const text = typeof nickName === 'string' ? nickName.trim() : '';
  const matched = text.match(DEFAULT_PHONE_NICKNAME_RE);
  if (!matched) return false;
  const phoneLast4 = getPhoneLast4(source);
  return !phoneLast4 || phoneLast4 === matched[1];
};

const getWechatNickNameFromProfile = (profile: unknown) => {
  const directRecord = profile && typeof profile === 'object' ? (profile as Record<string, any>) : null;
  const nestedRecord = pickFirstObject(profile, ['userInfo', 'profile', 'account']);
  return sanitizeWechatNickName(
    directRecord?.nickName ??
      directRecord?.nickname ??
      nestedRecord?.nickName ??
      nestedRecord?.nickname
  );
};

const getWechatNickNameFromLoginOptions = (payload: unknown, options: ApplyLoginResponseOptions) => {
  const fromOption = sanitizeWechatNickName(options.wxNickName);
  if (fromOption) return fromOption;

  const fromProfile = getWechatNickNameFromProfile(options.wxProfile);
  if (fromProfile) return fromProfile;

  const wxProfileFromPayload = pickFirstObject(payload, ['wxProfile', 'wechatProfile', 'wxUserInfo', 'wechatUserInfo']);
  return getWechatNickNameFromProfile(wxProfileFromPayload);
};

const withLoginProfileTimeout = <T>(task: Promise<T>, timeoutMs = 3000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutTask = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('user profile refresh timeout')), timeoutMs);
  });

  return Promise.race([task, timeoutTask]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

export const useUserStore = defineStore('user', () => {
  const ringStore = useRingStore();
  const ringRefs = storeToRefs(ringStore);
  const token = ref(uni.getStorageSync('token') || '');
  const userInfo = ref<Record<string, any>>(uni.getStorageSync('userInfo') || {});
  const reconnectCount = ref(1);
  const isShowLoginPopup = ref(false);

  const updateToken = (payload: string) => {
    token.value = payload;
    uni.setStorageSync('token', payload);
    const app = getApp();
    const appGlobalData = app.globalData || (app.globalData = {});
    appGlobalData.isLogin = Boolean(payload);
    if (payload) {
      appGlobalData.showLoginModal = false;
      isShowLoginPopup.value = false;
    }
  };

  const setUserInfo = (payload: Record<string, any>) => {
    userInfo.value = payload;
    uni.setStorageSync('userInfo', payload);
  };

  const fetchUserInfo = async () => {
    if (!token.value) {
      return userInfo.value;
    }
    const res = await getUserInfo();
    setUserInfo(res || {});
    return userInfo.value;
  };

  const refreshUserInfo = async (params?: Record<string, any>) => {
    if (params) {
      await updateUserInfo(params);
    }
    return fetchUserInfo();
  };

  const applyWechatNickNameForDefaultUser = async (wxNickName: string) => {
    if (!wxNickName) return;
    const currentUserInfo = userInfo.value || {};
    const currentNickName = currentUserInfo.nickName ?? currentUserInfo.nickname;
    if (!isPhoneDefaultNickName(currentNickName, currentUserInfo)) return;

    try {
      await withLoginProfileTimeout(updateUserInfo({ nickName: wxNickName }), 3000);
      setUserInfo({
        ...currentUserInfo,
        nickName: wxNickName
      });
    } catch {
      // 微信昵称修正失败不阻断登录，用户后续仍可在个人信息里手动修改。
    }
  };

  const applyLoginResponse = async (payload: unknown, options: ApplyLoginResponseOptions = {}) => {
    const wxNickName = getWechatNickNameFromLoginOptions(payload, options);
    const loginToken = pickFirstValue(payload, LOGIN_TOKEN_KEYS);
    if (!loginToken) {
      throw new Error('登录接口未返回 token');
    }

    updateToken(loginToken);
    const loginUserInfo = pickFirstObject(payload, LOGIN_USER_INFO_KEYS);
    if (loginUserInfo) {
      setUserInfo(loginUserInfo);
    } else if (!userInfo.value?.id) {
      setUserInfo(createLoginFallbackUserInfo(loginToken));
    }

    try {
      await withLoginProfileTimeout(fetchUserInfo());
    } catch {
      // 登录态已写入本地，用户资料失败不阻断进入首页。
    }

    await applyWechatNickNameForDefaultUser(wxNickName);

    return userInfo.value;
  };

  const logout = () => {
    updateToken('');
    setUserInfo({});
    isShowLoginPopup.value = false;
  };

  const setShowLoginPopup = (visible: boolean) => {
    isShowLoginPopup.value = visible;
  };

  const updateReconnectCount = (value: number) => {
    reconnectCount.value = value;
  };

  return {
    token,
    userInfo,
    reconnectCount,
    isShowLoginPopup,
    updateToken,
    applyLoginResponse,
    fetchUserInfo,
    refreshUserInfo,
    logout,
    setShowLoginPopup,
    updateIsShowLoginPopup: setShowLoginPopup,
    updateReconnectCount,

    devices: ringRefs.devices,
    deviceInfo: ringRefs.deviceInfo,
    receivedData: ringRefs.receivedData,
    normalizedData: ringRefs.normalizedData,
    latestMetrics: ringRefs.latestMetrics,
    healthData: ringRefs.healthData,
    localData: ringRefs.localData,
    normalMac: ringRefs.normalMac,
    iosMacId: ringRefs.iosMacId,
    deviceTime: ringRefs.deviceTime,
    lastReadTimestamp: ringRefs.lastReadTimestamp,
    lastMetricUpdateAt: ringRefs.lastMetricUpdateAt,
    isBluetoothReady: ringRefs.isBluetoothReady,
    isListenerRegistered: ringRefs.isListenerRegistered,
    hasRegisteredAdapterListener: ringRefs.hasRegisteredAdapterListener,
    isManualReconnecting: ringRefs.isManualReconnecting,
    isMinePageButtomClick: ringRefs.isMinePageButtomClick,
    isUnbinding: ringRefs.isUnbinding,
    isSending: ringRefs.isSending,
    isConnected: ringRefs.isConnected,
    isReconnecting: ringRefs.isReconnecting,
    isUploading: ringRefs.isUploading,
    reconnectStatus: ringRefs.reconnectStatus,
    reconnectResult: ringRefs.reconnectResult,
    uploadingStatus: ringRefs.uploadingStatus,

    updateDeviceInfo: ringStore.updateDeviceInfo,
    updateReceivedData: ringStore.updateReceivedData,
    handleParsedData: ringStore.handleParsedData,
    updateNormalMac: ringStore.updateNormalMac,
    updateIosMacId: ringStore.updateIosMacId,
    updateLastReadTimestamp: ringStore.updateLastReadTimestamp,
    resetLastReadTimestamp: ringStore.resetLastReadTimestamp,
    updateIsBluetoothReady: ringStore.updateIsBluetoothReady,
    updateIsConnected: ringStore.updateIsConnected,
    updateIsListenerRegistered: ringStore.updateIsListenerRegistered,
    updateHasRegisteredAdapterListener: ringStore.updateHasRegisteredAdapterListener,
    updateIsManualReconnecting: ringStore.updateIsManualReconnecting,
    updateIsMinePageButtomClick: ringStore.updateIsMinePageButtomClick,
    updateIsUnbinding: ringStore.updateIsUnbinding,
    updateIsSending: ringStore.updateIsSending,
    updateReconnectingStatus: ringStore.updateReconnectingStatus,
    updateReconnectResult: ringStore.updateReconnectResult,
    updateUploadingStatus: ringStore.updateUploadingStatus,
    clearRuntime: ringStore.clearRuntime,
    setUserInfo
  };
});
