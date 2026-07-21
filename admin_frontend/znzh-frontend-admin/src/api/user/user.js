import request from '@/utils/request'

// 查询用户列表
export function listUser(query) {
  return request({
    url: '/admin/user/list',
    method: 'get',
    params: query
  })
}

// 查询用户详细
export function getUser(id) {
  return request({
    url: '/admin/user/' + id,
    method: 'get'
  })
}

// 新增用户
export function addUser(data) {
  return request({
    url: '/admin/user',
    method: 'post',
    data: data
  })
}

// 修改用户
export function updateUser(data) {
  return request({
    url: '/admin/user',
    method: 'put',
    data: data
  })
}

// 删除用户
export function delUser(id) {
  return request({
    url: '/admin/user/' + id,
    method: 'delete'
  })
}

// 用户状态修改
export function changeUserStatus(id, status) {
  const data = {
    id,
    status
  }
  return request({
    url: '/admin/user/changeStatus',
    method: 'put',
    data: data
  })
}

// 获取用户最新健康数据
export function getUserHealthData(userId) {
  return request({
    url: '/admin/user/latestHealthData/' + userId,
    method: 'get'
  })
}

// 获取用户历史健康数据
export function getUserHealthDataHistory(query) {
  return request({
    url: '/admin/user/historyHealthData',
    method: 'get',
    params: query
  })
}
