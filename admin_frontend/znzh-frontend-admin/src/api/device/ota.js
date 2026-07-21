import request from '@/utils/request'

// 查询OTA固件版本 列表
export function listPackage(query) {
  return request({
    url: '/admin/device/ota/list',
    method: 'get',
    params: query
  })
}

// 查询OTA固件版本 详细
export function getPackage(id) {
  return request({
    url: '/admin/device/ota/' + id,
    method: 'get'
  })
}

// 新增OTA固件版本
export function addPackage(data) {
  return request({
    url: '/admin/device/ota',
    method: 'post',
    data: data
  })
}

// 修改OTA固件版本
export function updatePackage(data) {
  return request({
    url: '/admin/device/ota',
    method: 'put',
    data: data
  })
}

// 删除OTA固件版本
export function delPackage(id) {
  return request({
    url: '/admin/device/ota/' + id,
    method: 'delete'
  })
}
