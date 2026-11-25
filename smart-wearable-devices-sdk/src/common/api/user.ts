export const getUserInfo = (params?: any, config = {}) => uni.$uv.http.get('/app/user/getInfo', params, config);

export const updateUserInfo = (params: any, config = {}) => uni.$uv.http.put('/app/user/update', params, config);

export const getGoalInfo = (params?: any, config = {}) => uni.$uv.http.get('/app/user/goal/getInfo', params, config);

export const updateGoalInfo = (params: any, config = {}) => uni.$uv.http.put('/app/user/goal/update', params, config);

// 注销当前登录账号：后端从 Authorization 解析用户，无需业务参数。
export const cancelAccount = (params: any = {}, config = {}) => uni.$uv.http.post('/app/user/cancelAccount', params, config);
