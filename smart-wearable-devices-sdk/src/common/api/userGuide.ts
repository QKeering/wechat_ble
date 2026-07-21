import type { FqaGuidItem } from '../../types/api/userGuides';
import type { HttpRequestConfig } from '@/uni_modules/uv-ui-tools/libs/luch-request/index';
// 获取FQA或用户指南列表
export const getfqaGuidList = (params: { type: number }, config: HttpRequestConfig = {}): Promise<FqaGuidItem[]> => {
  return (uni as any).$uv.http.get('/app/fqaGuid/list', { params, ...config });
};
// 获取FQA或用户指南详情
export const getfqaGuidDetail = (params: { id: string }, config: HttpRequestConfig = {}): Promise<FqaGuidItem> => {
  return (uni as any).$uv.http.get('/app/fqaGuid/getInfo', { params, ...config });
};
