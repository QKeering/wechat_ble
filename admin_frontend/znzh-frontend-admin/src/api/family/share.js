import request from '@/utils/request'

export function listFamilyResource(resource, query) {
  return request({
    url: `/admin/family/${resource}/list`,
    method: 'get',
    params: query
  })
}

export function listFamilyAbnormal(query) {
  return request({
    url: '/admin/family/abnormal/list',
    method: 'get',
    params: query
  })
}

export function updateFamilyResource(resource, data) {
  return request({
    url: `/admin/family/${resource}`,
    method: 'put',
    data
  })
}

export function updateFamilyRelationStatus(relationId, data) {
  return request({
    url: `/admin/family/relation/${relationId}/status`,
    method: 'put',
    data
  })
}

export function updateFamilyAssistStatus(requestId, data) {
  return request({
    url: `/admin/family/assist/${requestId}/status`,
    method: 'put',
    data
  })
}

export function deleteFamilyResource(resource, ids) {
  return request({
    url: `/admin/family/${resource}/${ids}`,
    method: 'delete'
  })
}
