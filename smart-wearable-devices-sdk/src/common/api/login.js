/**
 * 微信登录
 */
export const wxLogin = (params, config = {}) => {
  const openIdCode = String(params?.openIdCode || params?.openidCode || '').trim();
  return uni.$uv.http.post(`/app/login/wxLogin?openIdCode=${encodeURIComponent(openIdCode)}`, {}, config);
};
/**
 * App 端微信登录（微信开放平台，后端走 oauth2/access_token 换取 openid）
 */
export const appWxLogin = (params, config = {}) => uni.$uv.http.post('/app/login/appWxLogin', params, config);
/**
 * 微信快捷登录：App 端走开放平台新接口，其余端走小程序接口。
 */
export const wechatQuickLogin = (params, config = {}) => {
  // #ifdef APP-PLUS
  return appWxLogin(params, config);
  // #endif
  // #ifndef APP-PLUS
  return wxLogin(params, config);
  // #endif
};
/**
 * 小程序手机号登录
 */
export const wechatLogin = (params, config = {}) => uni.$uv.http.post('/app/login/wechatLogin', params, config);
/**
 * 手机号+验证码登录
 */
export const phoneLogin = (params, config = {}) => uni.$uv.http.post('/app/login/phoneLogin', params, config);
/**
 * 获取手机号验证码
 */
export const getPhoneCode = (params, config = {}) => uni.$uv.http.post('/app/login/getPhoneCode', params, config);
/**
 * 获取隐私政策
 */
export const privacyPolicy = (params, config = {}) => uni.$uv.http.get('/app/login/privacyPolicy', params, config);
/**
 * 获取隐私政策
 */
export const userAgreement = (params, config = {}) => uni.$uv.http.get('/app/login/userAgreement', params, config);
