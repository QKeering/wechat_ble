/**
 * 图片上传。注意 luch-request 的 `upload(url, config)` 只有两个参数，
 * filePath / name / custom 全部放在 config 里，不要按 `(url, params, config)` 传。
 */
export interface UploadImageOptions {
  filePath: string;
  name?: string;
  custom?: Record<string, any>;
  [key: string]: any;
}

const UPLOAD_URL_KEYS = ['url', 'fileName', 'newFileName'];

const pickFromRecord = (record: any): string => {
  if (!record || typeof record !== 'object') return '';
  for (const key of UPLOAD_URL_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

/**
 * `/app/upload/image` 把地址放在响应**信封顶层**
 * （`{code, msg, url, fileName, newFileName, ...}`），并没有 `data` 字段；
 * 而项目响应拦截器只返回 `response.data.data`，默认解出来是个空对象，地址会被丢掉。
 * 因此请求时带上 `custom.returnAll`，再从未解包的 `originalResponse.data` 里提取。
 */
const pickUploadedUrl = (value: any): string => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return pickFromRecord(value.originalResponse?.data) || pickFromRecord(value.data) || pickFromRecord(value);
};

/** 上传图片，成功时 resolve 图片地址字符串（形如 `/app/files/<uuid>.png`）。 */
export const uploadImage = async (options: UploadImageOptions): Promise<string> => {
  const response = await uni.$uv.http.upload('/app/upload/image', {
    ...options,
    custom: { ...(options.custom || {}), returnAll: true }
  });
  const url = pickUploadedUrl(response);
  if (!url) {
    throw new Error('上传成功但未获取到图片地址，请重试');
  }
  return url;
};
