/**
 * 将相对路径转换为完整 API 绝对 URL
 * - 若已是完整 URL（含 http/https），直接返回
 * - 若以 / 开头，拼接到 VITE_API_BASE 根路径
 * - 否则，作为子路径拼接（自动处理斜杠）
 * @param {string} url - 相对路径或完整 URL
 * @returns {string} 完整绝对 URL
 */
export const getFullUrl = (url) => {
  // 空值处理
  if (!url || typeof url !== 'string') {
    return '';
  }

  const baseUrl = import.meta.env.VITE_API_BASE;

  // 已是完整 URL（http/https 开头），直接返回
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  // 确保 baseUrl 以 / 结尾，url 不以 / 开头（避免双斜杠）
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = url.startsWith('/') ? url.slice(1) : url;

  return normalizedBase + (normalizedPath ? '/' + normalizedPath : '');
};

/**
 * 格式化日期
 * @param {Date} date - 要格式化的日期对象
 * @param {string} format - 格式类型 ('day', 'week', 'month')
 * @returns {string} 格式化后的日期字符串
 */
export const formatDate = (date, format = 'day') => {
  if (!(date instanceof Date)) {
    console.warn('Invalid date object passed to formatDate');
    return '';
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  switch (format) {
    case 'day':
      return `${month}月${day}号`;
    case 'week': {
      // 计算本周信息
      const weekInfo = getWeekInfo(date);
      // 修改这里：只显示日期区间，不显示第几周
      return `${weekInfo.startMonth}月${weekInfo.startDay}-${weekInfo.endDay}号`;
    }
    case 'month':
      return `${year}年${month}月`;
    default:
      return `${month}月${day}号`;
  }
};
/**
 * 获取指定日期所在周的信息
 * @param {Date} date - 指定日期
 * @returns {Object} 包含周信息的对象
 */
const getWeekInfo = (date) => {
  const currentDate = new Date(date);

  // 设置为周一为一周的开始
  const dayOfWeek = currentDate.getDay() === 0 ? 6 : currentDate.getDay() - 1;
  const startDate = new Date(currentDate);
  startDate.setDate(currentDate.getDate() - dayOfWeek);

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);

  return {
    startMonth: startDate.getMonth() + 1,
    startDay: startDate.getDate(),
    endMonth: endDate.getMonth() + 1,
    endDay: endDate.getDate()
  };
};

/**
 * 计算日期偏移量
 * @param {Date} currentDate - 当前日期
 * @param {number} viewType - 视图类型 (0: 日, 1: 周, 2: 月)
 * @returns {number} 偏移量
 */
export const calculateOffset = (currentDate, viewType) => {
  const targetDate = new Date();
  let diff = 0;

  switch (viewType) {
    case 0: // 日模式
      diff = Math.round((currentDate.getTime() - targetDate.getTime()) / (24 * 60 * 60 * 1000));
      break;
    case 1: // 周模式
      diff = Math.round((currentDate.getTime() - targetDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      break;
    case 2: // 月模式
      const targetYear = targetDate.getFullYear();
      const targetMonth = targetDate.getMonth();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth();

      diff = (currentYear - targetYear) * 12 + (currentMonth - targetMonth);

      // 考虑日期的具体天数进行微调
      const targetDay = targetDate.getDate();
      const currentDay = currentDate.getDate();

      if (currentDay < targetDay) {
        const targetDateAdjusted = new Date(targetYear, targetMonth, currentDay);
        if (currentDate < targetDateAdjusted) {
          diff--;
        }
      }
      break;
    default:
      return 0;
  }

  // 处理 -0 的情况，确保返回的是正 0
  return Object.is(diff, -0) ? 0 : diff;
};

/**
 * 获取前一天/周/月的日期
 * @param {Date} currentDate - 当前日期
 * @param {number} viewType - 视图类型 (0: 日, 1: 周, 2: 月)
 * @returns {Date} 新的日期对象
 */
export const getPrevDate = (currentDate, viewType) => {
  const newDate = new Date(currentDate);

  switch (viewType) {
    case 0: // 日模式
      newDate.setDate(newDate.getDate() - 1);
      break;
    case 1: // 周模式
      newDate.setDate(newDate.getDate() - 7);
      break;
    case 2: // 月模式
      newDate.setMonth(newDate.getMonth() - 1);
      break;
  }

  return newDate;
};

/**
 * 获取后一天/周/月的日期，并检查是否超过今天
 * @param {Date} currentDate - 当前日期
 * @param {number} viewType - 视图类型 (0: 日, 1: 周, 2: 月)
 * @returns {Date|null} 新的日期对象，如果超过今天则返回 null
 */
export const getNextDate = (currentDate, viewType) => {
  const newDate = new Date(currentDate);
  const today = new Date();

  switch (viewType) {
    case 0: // 日模式
      newDate.setDate(newDate.getDate() + 1);
      break;
    case 1: // 周模式
      newDate.setDate(newDate.getDate() + 7);
      break;
    case 2: // 月模式
      newDate.setMonth(newDate.getMonth() + 1);
      break;
  }

  // 检查是否超过了今天
  if (newDate > today) {
    return null; // 不允许跳转到未来日期
  }

  return newDate;
};
// 日期工具函数：获取指定日期的星期和日
export const getDateInfo = (date) => {
  // 星期映射（0-6对应周日-周六，可根据需求调整）
  const weekMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const week = weekMap[date.getDay()]; // 获取星期
  const day = date.getDate(); // 获取日（1-31）
  return { week, day };
};

// 计算昨天和前天的日期（修复时区问题）
export const getYesterday = (date) => {
  // 使用UTC时间戳计算，避免时区问题
  const yesterday = new Date(date);
  const utcTimestamp = yesterday.getTime() - 24 * 60 * 60 * 1000;
  return new Date(utcTimestamp);
};
export const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getBeforeYesterday = (date) => {
  // 使用UTC时间戳计算，避免时区问题
  const beforeYesterday = new Date(date);
  const utcTimestamp = beforeYesterday.getTime() - 2 * 24 * 60 * 60 * 1000;
  return new Date(utcTimestamp);
};

// 计算时长小时数（不足2位补0）
export const getSleepDurationHours = (time) => {
  // 显式将 time 转为数字（处理字符串情况）
  const timeNum = Number(time);

  // 检查转换后的数字是否有效
  if (isNaN(timeNum) || timeNum <= 0) return '00';

  const hours = Math.floor(timeNum / 60);
  return hours.toString().padStart(2, '0');
};
// 计算时长分钟数（不足2位补0）
export const getSleepDurationMinutes = (time) => {
  const timeNum = Number(time);
  if (isNaN(timeNum) || timeNum <= 0) return '00';
  const minutes = timeNum % 60;
  return minutes.toString().padStart(2, '0');
};
