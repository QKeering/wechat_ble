export const uploadImage = (params: any, config = {}) => uni.$uv.http.upload('/app/upload/image', params, config);
