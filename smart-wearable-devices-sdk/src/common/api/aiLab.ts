/**
 * 申请体验 AI 实验室
 */
export const applyAiLab = (params = {}, config = {}) =>
  (uni as any).$uv.http.post('/app/aiLab/apply', params, config);

/**
 * 获取 AI 实验室申请状态
 */
export const getAiLabStatus = (config = {}) =>
  (uni as any).$uv.http.get('/app/aiLab/status', {}, config);

/**
 * 创建小轻 H5 一次性登录票据
 */
export const requestH5Ticket = (params: { sceneId: string }, config = {}) =>
  (uni as any).$uv.http.post('/app/h5/session/create', params, config);
