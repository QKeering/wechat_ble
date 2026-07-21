import request from '@/utils/request'

// 查询设备型号列表
export function listModel(query) {
  return request({
    url: '/admin/device/model/list',
    method: 'get',
    params: query
  })
}

// 查询设备型号详细
export function getModel(id) {
  return request({
    url: '/admin/device/model/' + id,
    method: 'get'
  })
}

// 新增设备型号
export function addModel(data) {
  return request({
    url: '/admin/device/model',
    method: 'post',
    data: data
  })
}

// 修改设备型号
export function updateModel(data) {
  return request({
    url: '/admin/device/model',
    method: 'put',
    data: data
  })
}

// 删除设备型号
export function delModel(id) {
  return request({
    url: '/admin/device/model/' + id,
    method: 'delete'
  })
}

// 获取设备型号下拉选项
export function getModelOptions() {
  return request({
    url: '/admin/device/model/options',
    method: 'get'
  })
}
