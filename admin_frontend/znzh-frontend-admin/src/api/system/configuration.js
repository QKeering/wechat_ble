import request from '@/utils/request'

// 查询系统参数配置列表
export function listConfiguration(query) {
  return request({
    url: '/admin/sysConfiguration/list',
    method: 'get',
    params: query
  })
}

// 查询系统参数配置详细
export function getConfiguration(id) {
  return request({
    url: '/admin/sysConfiguration/' + id,
    method: 'get'
  })
}

// 新增系统参数配置
export function addConfiguration(data) {
  return request({
    url: '/admin/sysConfiguration',
    method: 'post',
    data: data
  })
}

// 修改系统参数配置
export function updateConfiguration(data) {
  return request({
    url: '/admin/sysConfiguration',
    method: 'put',
    data: data
  })
}

// 删除系统参数配置
export function delConfiguration(id) {
  return request({
    url: '/admin/sysConfiguration/' + id,
    method: 'delete'
  })
}
