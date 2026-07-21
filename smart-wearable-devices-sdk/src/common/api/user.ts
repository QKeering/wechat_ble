export const getUserInfo = (params?: any, config = {}) => uni.$uv.http.get('/app/user/getInfo', params, config);

export const updateUserInfo = (params: any, config = {}) => uni.$uv.http.put('/app/user/update', params, config);

export const getGoalInfo = (params?: any, config = {}) => uni.$uv.http.get('/app/user/goal/getInfo', params, config);

export const updateGoalInfo = (params: any, config = {}) => uni.$uv.http.put('/app/user/goal/update', params, config);
