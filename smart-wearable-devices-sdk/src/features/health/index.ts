export const healthFeatureName = 'health';

/**
 * ios-app-simple 分支：仅保留运动/活动展示。
 * false 时隐藏睡眠、压力、生命体征、生理期、AI 智能体、全面测量、亲友关怀等健康模块。
 * 注意：本分支同时在 pages.json 注销了对应页面路由，若改回 true 需一并恢复路由。
 */
export const HEALTH_MODULES_ENABLED = false;
