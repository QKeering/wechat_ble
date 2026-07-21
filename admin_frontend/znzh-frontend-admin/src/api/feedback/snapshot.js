import request from '@/utils/request'

export function listFeedbackSnapshots(query) {
  return request({
    url: '/admin/feedback/snapshots/list',
    method: 'get',
    params: query
  })
}

export function getFeedbackSnapshot(id) {
  return request({
    url: '/admin/feedback/snapshots/' + id,
    method: 'get'
  })
}

export function recalculateFeedbackSnapshot(id) {
  return request({
    url: '/admin/feedback/snapshots/' + id + '/recalculate',
    method: 'post'
  })
}

export function reviewFeedbackSnapshot(id, data) {
  return request({
    url: '/admin/feedback/snapshots/' + id + '/review',
    method: 'put',
    data: data
  })
}

export function deleteFeedbackSnapshot(id) {
  return request({
    url: '/admin/feedback/snapshots/' + id,
    method: 'delete'
  })
}

export function exportFeedbackSnapshots(query) {
  return request({
    url: '/admin/feedback/snapshots/export',
    method: 'get',
    params: query,
    responseType: 'blob'
  })
}
