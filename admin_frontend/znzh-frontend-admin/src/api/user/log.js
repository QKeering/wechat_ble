import request from '@/utils/request'

// 查询用户日志 列表
export function listLog(query) {
  return request({
    url: '/admin/user/log/list',
    method: 'get',
    params: query
  })
}

// 查询用户日志 详细
export function getLog(id) {
  return request({
    url: '/admin/user/log/' + id,
    method: 'get'
  })
}

// 新增用户日志
export function addLog(data) {
  return request({
    url: '/admin/user/log',
    method: 'post',
    data: data
  })
}

// 修改用户日志
export function updateLog(data) {
  return request({
    url: '/admin/user/log',
    method: 'put',
    data: data
  })
}

// 删除用户日志
export function delLog(id) {
  return request({
    url: '/admin/user/log/' + id,
    method: 'delete'
  })
}
