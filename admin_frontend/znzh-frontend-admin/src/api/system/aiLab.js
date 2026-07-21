import request from '@/utils/request'

// 获取申请列表
export function listAiLab(query) {
  return request({
    url: '/admin/aiLab/list',
    method: 'get',
    params: query
  })
}

// 获取申请详情
export function getAiLab(id) {
  return request({
    url: '/admin/aiLab/' + id,
    method: 'get'
  })
}

// 审核申请
export function auditAiLab(data) {
  return request({
    url: '/admin/aiLab/audit',
    method: 'post',
    data: data
  })
}

// 获取邀请码列表
export function listInviteCode(query) {
  return request({
    url: '/admin/aiLab/inviteCode/list',
    method: 'get',
    params: query
  })
}

// 添加邀请码
export function addInviteCode(data) {
  return request({
    url: '/admin/aiLab/inviteCode/add',
    method: 'post',
    data: data
  })
}

// 删除邀请码
export function deleteInviteCode(id) {
  return request({
    url: '/admin/aiLab/inviteCode/' + id,
    method: 'delete'
  })
}

// 生成邀请码
export function generateInviteCode(data) {
  return request({
    url: '/admin/aiLab/inviteCode/generate',
    method: 'post',
    data: data
  })
}
