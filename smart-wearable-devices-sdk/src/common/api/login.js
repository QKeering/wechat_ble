/**
 * 微信登录
 */
export const wxLogin = (params, config = {}) => {
  const openIdCode = String(params?.openIdCode || params?.openidCode || '').trim()
  return uni.$uv.http.post(`/app/login/wxLogin?openIdCode=${encodeURIComponent(openIdCode)}`, {}, config)
}
/**
 * 小程序手机号登录
 */
export const wechatLogin = (params, config = {}) => uni.$uv.http.post('/app/login/wechatLogin', params, config)
/**
 * 手机号+验证码登录
 */
export const phoneLogin = (params, config = {}) => uni.$uv.http.post('/app/login/phoneLogin', params, config)
/**
 * 获取手机号验证码
 */
export const getPhoneCode = (params, config = {}) => uni.$uv.http.post('/app/login/getPhoneCode', params, config)
/**
 * 获取隐私政策
 */
export const privacyPolicy = (params, config = {}) => uni.$uv.http.get('/app/login/privacyPolicy', params, config)
/**
 * 获取隐私政策
 */
export const userAgreement = (params, config = {}) => uni.$uv.http.get('/app/login/userAgreement', params, config)
