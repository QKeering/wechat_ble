const isQkeerV2VendorDebugEnabled = () => {
  try {
    const root = typeof globalThis !== 'undefined' ? globalThis : {};
    return root.__QKEER_V2_VENDOR_DEBUG__ === true || root.__QKEER_V2_DEBUG__ === true;
  } catch (error) {
    return false;
  }
};

const callConsole = (method, args) => {
  if (!isQkeerV2VendorDebugEnabled()) return;
  const target = typeof console !== 'undefined' ? console : null;
  if (!target) return;
  const fn = typeof target[method] === 'function' ? target[method] : target.log;
  if (typeof fn === 'function') {
    fn.apply(target, args);
  }
};

const qkeerV2VendorConsole = {
  log: (...args) => callConsole('log', args),
  info: (...args) => callConsole('info', args),
  warn: (...args) => callConsole('warn', args),
  error: (...args) => callConsole('error', args),
  debug: (...args) => callConsole('debug', args)
};

export { isQkeerV2VendorDebugEnabled, qkeerV2VendorConsole };
export default qkeerV2VendorConsole;
