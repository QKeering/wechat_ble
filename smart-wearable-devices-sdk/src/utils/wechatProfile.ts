type WechatProfileForNickname = {
  nickName: string;
  avatarUrl?: string;
  raw?: unknown;
};

const USELESS_WECHAT_NICKNAMES = new Set(['微信用户', 'WeChat User', '用户']);

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutTask = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('wechat profile timeout')), timeoutMs);
  });
  return Promise.race([promise, timeoutTask]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

export const sanitizeWechatNickName = (value: unknown) => {
  const nickName = typeof value === 'string' ? value.trim() : '';
  if (!nickName) return '';
  if (USELESS_WECHAT_NICKNAMES.has(nickName)) return '';
  return nickName;
};

export const pickWechatProfileForNickname = (payload: unknown): WechatProfileForNickname | null => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, any>;
  const userInfo = record.userInfo && typeof record.userInfo === 'object' ? record.userInfo : record;
  const nickName = sanitizeWechatNickName(userInfo.nickName ?? userInfo.nickname ?? record.nickName ?? record.nickname);
  if (!nickName) return null;
  const avatarUrl = `${userInfo.avatarUrl || userInfo.avatar || record.avatarUrl || record.avatar || ''}`.trim();
  return {
    nickName,
    ...(avatarUrl ? { avatarUrl } : {}),
    raw: payload
  };
};

export const getWechatProfileForNickname = async (timeoutMs = 6000): Promise<WechatProfileForNickname | null> => {
  const wxRuntime = (globalThis as any).wx;
  const uniRuntime = (globalThis as any).uni;
  const runtime = uniRuntime?.getUserProfile ? uniRuntime : wxRuntime?.getUserProfile ? wxRuntime : null;
  if (!runtime?.getUserProfile) return null;

  try {
    const result = await withTimeout(
      new Promise<unknown>((resolve, reject) => {
        runtime.getUserProfile({
          desc: '用于完善用户资料',
          lang: 'zh_CN',
          success: resolve,
          fail: reject
        });
      }),
      timeoutMs
    );
    return pickWechatProfileForNickname(result);
  } catch {
    return null;
  }
};
