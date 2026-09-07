import { getWechatProfileForNickname } from './wechatProfile';

/**
 * 获取微信登录凭证 code，跨端抹平返回结构差异。
 *
 * - 小程序 `wx.login()` 返回 `{ code }`
 * - App 端 `uni.login({ provider: 'weixin' })` 返回 `{ authResult: { code } }`
 *
 * 统一返回 code 字符串；拿不到时抛错，由调用方兜底提示。
 */
export const getWechatLoginCode = (): Promise<string> => {
  // #ifdef APP-PLUS
  return new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (res) => {
        const code = (res as any)?.authResult?.code;
        if (code) {
          resolve(code);
        } else {
          reject(new Error('微信登录凭证获取失败'));
        }
      },
      fail: reject
    });
  });
  // #endif

  // #ifndef APP-PLUS
  return new Promise<string>((resolve, reject) => {
    const wxRuntime = (globalThis as any).wx;
    wxRuntime.login({
      success: (res: { code?: string }) => {
        if (res?.code) {
          resolve(res.code);
        } else {
          reject(new Error('微信登录凭证获取失败'));
        }
      },
      fail: reject
    });
  });
  // #endif
};

/**
 * 手机号登录所需的微信上下文。
 *
 * App 端手机号登录不再拉起微信授权，直接返回空凭证；其余端保持原逻辑
 * （静默获取 code + 拉取微信资料）。
 */
export const getPhoneLoginWechatContext = async (): Promise<{
  openIdCode: string;
  wxProfile: unknown;
}> => {
  // #ifdef APP-PLUS
  return { openIdCode: '', wxProfile: null };
  // #endif

  // #ifndef APP-PLUS
  const wxProfile = await getWechatProfileForNickname();
  const openIdCode = await getWechatLoginCode();
  return { openIdCode, wxProfile };
  // #endif
};
