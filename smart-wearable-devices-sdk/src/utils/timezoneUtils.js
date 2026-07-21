/**
 * 时区处理工具函数
 * 解决uniapp+vue3小程序在外国使用的时区问题
 */

/**
 * 获取UTC时间戳（统一使用UTC时间戳存储）
 */
export const getUTCTimestamp = () => {
  return Date.now(); // 直接返回UTC时间戳
};

/**
 * 获取UTC时间对象
 */
export const getUTCDate = () => {
  return new Date();
};

/**
 * 将本地时间转换为UTC时间字符串
 * @param {Date} localDate 本地时间对象
 * @returns {string} UTC时间字符串 YYYY-MM-DD HH:mm:ss
 */
export const formatToUTCString = (localDate = new Date()) => {
  const utcYear = localDate.getUTCFullYear();
  const utcMonth = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const utcDate = String(localDate.getUTCDate()).padStart(2, '0');
  const utcHours = String(localDate.getUTCHours()).padStart(2, '0');
  const utcMinutes = String(localDate.getUTCMinutes()).padStart(2, '0');
  const utcSeconds = String(localDate.getUTCSeconds()).padStart(2, '0');

  return `${utcYear}-${utcMonth}-${utcDate} ${utcHours}:${utcMinutes}:${utcSeconds}`;
};

/**
 * 将UTC时间戳转换为本地时间显示
 * @param {number} utcTimestamp UTC时间戳
 * @param {string} timezone 目标时区，默认用户当前时区
 * @returns {string} 本地时间字符串
 */
export const formatToLocalString = (utcTimestamp, timezone = '') => {
  const date = new Date(utcTimestamp);

  if (timezone) {
    return date.toLocaleString('zh-CN', { timeZone: timezone });
  }

  return date.toLocaleString('zh-CN');
};

/**
 * 获取用户当前时区
 */
export const getUserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.warn('无法获取用户时区，使用默认时区 Asia/Shanghai');
    return 'Asia/Shanghai';
  }
};

/**
 * 计算UTC时间的当天零点时间戳
 */
export const getUTCTodayZeroTimestamp = () => {
  const now = new Date();
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDate = now.getUTCDate();

  const utcZeroTime = new Date(Date.UTC(utcYear, utcMonth, utcDate, 0, 0, 0, 0));
  return Math.floor(utcZeroTime.getTime() / 1000); // 返回秒级时间戳
};

/**
 * 日期计算函数（基于UTC时间）返回计算好的UTC昨天日期对象
 */
export const getUTCYesterday = (date = new Date()) => {
  const yesterday = new Date(date);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday;
};
// 计算UTC时间的前天日期对象
export const getUTCBeforeYesterday = (date = new Date()) => {
  const beforeYesterday = new Date(date);
  beforeYesterday.setUTCDate(beforeYesterday.getUTCDate() - 2);
  return beforeYesterday;
};

/**
 * 格式化UTC日期为 YYYY-MM-DD 格式
 */
export const formatUTCToDateString = (date = new Date()) => {
  const utcYear = date.getUTCFullYear();
  const utcMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const utcDate = String(date.getUTCDate()).padStart(2, '0');
  return `${utcYear}-${utcMonth}-${utcDate}`;
};
