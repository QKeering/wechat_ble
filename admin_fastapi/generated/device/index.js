import request from '@/utils/request'

export function listdevice(query) {
  return request({ url: '/admin/device/list', method: 'get', params: query })
}

export function getdevice(id) {
  return request({ url: '/admin/device/' + id, method: 'get' })
}

export function adddevice(data) {
  return request({ url: '/admin/device', method: 'post', data })
}

export function updatedevice(data) {
  return request({ url: '/admin/device', method: 'put', data })
}

export function deldevice(ids) {
  return request({ url: '/admin/device/' + ids, method: 'delete' })
}
