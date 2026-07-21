import request from '@/utils/request'

// 查询FQA&用户指南 列表
export function listGuid(query) {
  return request({
    url: '/admin/fqaGuid/list',
    method: 'get',
    params: query
  })
}

// 查询FQA&用户指南 详细
export function getGuid(id) {
  return request({
    url: '/admin/fqaGuid/' + id,
    method: 'get'
  })
}

// 新增FQA&用户指南
export function addGuid(data) {
  return request({
    url: '/admin/fqaGuid',
    method: 'post',
    data: data
  })
}

// 修改FQA&用户指南
export function updateGuid(data) {
  return request({
    url: '/admin/fqaGuid',
    method: 'put',
    data: data
  })
}

// 删除FQA&用户指南
export function delGuid(id) {
  return request({
    url: '/admin/fqaGuid/' + id,
    method: 'delete'
  })
}
