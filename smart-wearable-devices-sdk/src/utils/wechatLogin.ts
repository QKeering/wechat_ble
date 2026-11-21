import { getWechatProfileForNickname } from './wechatProfile';

/**
 * 获取小程序微信登录凭证 code。
 *
 * App 端不做微信登录（仅提供手机号登录），因此这里只保留小程序实现。
 */
export const getWechatLoginCode = (): Promise<string> => {
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
