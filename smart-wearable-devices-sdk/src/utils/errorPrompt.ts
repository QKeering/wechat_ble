const ERROR_PROMPT_PATTERNS = [
  /失败|错误|异常|超时|请稍后|未返回|不可用|连接断开|加载失败/,
  /request:fail|err_|timeout|failed|error|network/i
];

let installed = false;

export const shouldSuppressErrorPrompt = (message: unknown) => {
  const text = String(message ?? '').trim();
  if (!text) return false;
  return ERROR_PROMPT_PATTERNS.some((pattern) => pattern.test(text));
};

export const installFrontendErrorPromptGuard = () => {
  if (installed || typeof uni === 'undefined') return;
  installed = true;

  const uniAny = uni as any;
  const originalShowToast = typeof uniAny.showToast === 'function' ? uniAny.showToast.bind(uniAny) : null;
  if (originalShowToast) {
    uniAny.showToast = (options: any = {}) => {
      const title = typeof options === 'string' ? options : options?.title;
      const icon = typeof options === 'object' ? options?.icon : undefined;
      if (icon !== 'success' && shouldSuppressErrorPrompt(title)) {
        console.warn('[frontend-error-prompt-suppressed]', title);
        return Promise.resolve({ errMsg: 'showToast:ok' });
      }
      return originalShowToast(options);
    };
  }

  let attempts = 0;
  const installUvToastGuard = () => {
    attempts += 1;
    const uv = uniAny.$uv;
    if (!uv || uv.__errorPromptGuardInstalled) return attempts >= 20;
    const originalToast = typeof uv.toast === 'function' ? uv.toast.bind(uv) : null;
    if (!originalToast) return attempts >= 20;
    uv.__errorPromptGuardInstalled = true;
    uv.toast = (message: unknown, ...args: unknown[]) => {
      if (shouldSuppressErrorPrompt(message)) {
        console.warn('[frontend-error-prompt-suppressed]', message);
        return;
      }
      return originalToast(message, ...args);
    };
    return true;
  };

  if (!installUvToastGuard()) {
    const timer = setInterval(() => {
      if (installUvToastGuard()) clearInterval(timer);
    }, 500);
  }
};
