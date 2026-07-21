/** post请求 */
// export const postMenu = (params, config = {}) => uni.$uv.http.post('/ebapi/public_api/index', params, config)
/** get请求 */
// export const getMenu = (data) => uni.$uv.http.get('/ebapi/public_api/index', data)
/**
 * 需要注意的是，get请求与post请求略有不同，get请求所有参数都在方法的第二个参数中，而post请求的第二个参数为请求参数params，而第三个参数才为配置项。
 * */
import * as LoginApi from './login.js';
import * as UserApi from './user';
import * as UploadApi from './upload';
import * as DeviceApi from './device';
export { LoginApi, UserApi, UploadApi, DeviceApi };
