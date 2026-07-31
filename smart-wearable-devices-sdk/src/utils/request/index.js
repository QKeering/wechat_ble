import { useUserStore } from '@/stores/user';
import { showErrorToast } from '@/utils/errorToast';
export const Request = () => {
  const userStore = useUserStore();
  const successCodes = [0, 200];
  const normalizeMessage = (message = '') =>
    String(message)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const isRequestOkMessage = (message = '') => normalizeMessage(message) === 'requestok';
  const normalizeNetworkErrorMessage = (message = '') => {
    const raw = String(message || '').trim();
    const lower = raw.toLowerCase();
    if (/err_connection_timed_out|timeout|time\s*out|fail:time\s*out|超时/.test(lower)) {
      return '网络请求超时，请稍后重试';
    }
    if (/request:fail|net::|err_|network|fail/.test(lower)) {
      return '网络连接异常，请稍后重试';
    }
    return raw || '网络错误，请稍后重试';
  };

  // 初始化请求配置
  uni.$uv.http.setConfig((defaultConfig) => {
    /*
     * 设置根域名（baseURL），从环境变量中获取。
     * 设置自定义参数 custom，默认需要认证，并由调用方捕获错误。
     */
    return Object.assign(defaultConfig, {
      baseURL: import.meta.env.VITE_API_BASE,
      custom: {
        auth: true,
        catch: true,
        toast: false
      }
    });
  });

  // 请求拦截器：在每个请求发送前执行
  uni.$uv.http.interceptors.request.use(
    (config) => {
      // 初始化请求拦截器时会执行此方法，此时 data 为 undefined，赋予默认值
      config.data = config.data || {};
      config.header = config.header || {};
      config.__authTokenAtRequest = config?.custom?.auth && userStore.token ? userStore.token : '';

      // 根据 custom 参数配置决定是否需要 token，并添加对应请求头
      if (config?.custom?.auth && config.__authTokenAtRequest) {
        config.header.Authorization = config.__authTokenAtRequest;
        config.header.token = config.__authTokenAtRequest;
      }

      return config;
    },
    (error) => {
      const message = error?.errMsg || error?.message || error?.msg || '请求发送失败';
      console.error('HTTP request failed:', error);
      return Promise.reject({ ...error, msg: message });
    }
  );

  // 响应拦截器：在接收到服务器响应后执行
  uni.$uv.http.interceptors.response.use(
    async (response) => {
      // 解构并提供默认值，避免部分字段不存在
      const { code = 0, msg = '未知错误', data: result = {} } = response.data || {};
      // 自定义参数
      const custom = response.config?.custom || {};
      const app = getApp();
      const appGlobalData = app.globalData || (app.globalData = {});
      const url = response.config?.url || '';
      const tokenAtRequest = response.config?.__authTokenAtRequest || '';
      const currentToken = userStore.token || '';

      // 判断是否登录失效
      const isLoginExpired = code === 401 || code === 403;
      const isStaleAuthResponse = isLoginExpired && currentToken && tokenAtRequest !== currentToken;
      if (isStaleAuthResponse) {
        return Promise.reject({
          code,
          msg: normalizeNetworkErrorMessage(msg),
          rawMsg: msg,
          result,
          url,
          staleAuth: true
        });
      }

      if (isLoginExpired) {
        userStore.logout();
      }

      // 处理未登录或登录失效的情况
      if (isLoginExpired && !appGlobalData.isLogin) {
        if (!appGlobalData.showLoginModal && !userStore.isShowLoginPopup) {
          appGlobalData.showLoginModal = true;
          userStore.setShowLoginPopup?.(true);
          await uni.showModal({
            title: '提示',
            content: '未登录或登录失效，请重新登录!',
            confirmColor: '#2e70fc',
            success: async (modalResult) => {
              if (modalResult.confirm) {
                uni.navigateTo({
                  url: '/pages/login/login'
                });
              }
            },
            complete: () => {
              appGlobalData.showLoginModal = false;
              userStore.setShowLoginPopup?.(false);
            }
          });
        }

        return Promise.reject({
          code,
          msg: normalizeNetworkErrorMessage(msg),
          rawMsg: msg,
          result,
          url,
          loginExpired: true
        });
      }

      // 判断响应是否成功
      if (!successCodes.includes(code) && !isRequestOkMessage(msg)) {
        // 根据 custom 配置决定是否显示 toast 消息通知用户
        if (custom.toast !== false) {
          showErrorToast(normalizeNetworkErrorMessage(msg));
        }

        // 根据 custom 配置决定是否抛出异常
        if (custom.catch) {
          return Promise.reject({ code, msg: normalizeNetworkErrorMessage(msg), rawMsg: msg, result, url });
        } else {
          return new Promise(() => {});
        }
      }
      if (custom.returnAll) {
        return {
          code,
          msg,
          data: result,
          originalResponse: response // 可选：包含原始响应对象
        };
      }
      // 成功时返回业务数据
      return result;
    },
    (error) => {
      const message = error?.msg || error?.errMsg || error?.message || '网络错误';
      const custom = error?.config?.custom || {};
      const rawMessage = message;
      const displayMessage = normalizeNetworkErrorMessage(rawMessage);
      if (isRequestOkMessage(displayMessage)) {
        return Promise.resolve(error?.data || {});
      }
      if (custom.toast !== false) {
        showErrorToast(displayMessage);
      }
      return Promise.reject({ ...error, msg: displayMessage, rawMsg: rawMessage });
    }
  );
};
