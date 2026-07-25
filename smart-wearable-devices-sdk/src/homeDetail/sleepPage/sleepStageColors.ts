export type SleepStageName = '深睡' | '浅睡' | '快速眼动' | '清醒' | '小睡';

export const SLEEP_STAGE_ORDER: SleepStageName[] = ['深睡', '浅睡', '快速眼动', '清醒', '小睡'];

export const SLEEP_STAGE_COLORS: Record<SleepStageName, string> = {
  深睡: '#5146D8',
  浅睡: '#9B93F5',
  快速眼动: '#48A7E8',
  清醒: '#F4A340',
  小睡: '#58C7B1'
};
