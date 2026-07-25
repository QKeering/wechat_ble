const APP_FOREGROUND_SESSION_KEY = 'qkeer_app_foreground_session_id';

export const refreshAppForegroundSessionId = () => {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    uni.setStorageSync(APP_FOREGROUND_SESSION_KEY, sessionId);
  } catch (error) {
    void error;
  }
  return sessionId;
};

export const getAppForegroundSessionId = () => {
  try {
    return String(uni.getStorageSync(APP_FOREGROUND_SESSION_KEY) || '');
  } catch (error) {
    void error;
    return '';
  }
};
