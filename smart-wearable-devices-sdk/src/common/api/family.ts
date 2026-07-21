export type FamilyRelation = 'father' | 'mother' | 'grandpa' | 'grandma' | 'parent' | 'other';

export interface FamilyMember {
  id: number;
  ownerUserId?: number;
  linkedUserId?: number;
  dataUserId?: number;
  relationId?: number;
  name: string;
  relation: FamilyRelation | string;
  phone?: string;
  avatar?: string;
  permissions?: Record<string, boolean>;
  deviceId?: string;
  deviceMac?: string;
  mac?: string;
  uniMacId?: string;
  protocol?: string;
  advertis?: {
    macInfo?: string;
  };
  serviceId?: string;
  deviceName?: string;
  battery?: number | string;
  lastSyncTime?: string;
  carePriority?: number;
  careReasons?: string[];
  careSuggestion?: string;
  cardSummary?: string;
  metrics?: {
    heartRate?: number | null;
    spo2?: number | null;
    sleepScore?: number | null;
    steps?: number | null;
    battery?: number | null;
  };
}

export interface FamilyMemberPayload {
  name: string;
  relation: FamilyRelation | string;
  phone?: string;
  avatar?: string;
  sex?: number;
  birthday?: string;
  height?: number | string;
  weight?: number | string;
}

export interface FamilyDeviceBindPayload {
  memberId?: number;
  mac: string;
  deviceId?: string;
  serviceId?: string;
  uniMacId?: string;
  protocol?: string;
  advertis?: {
    macInfo?: string;
  };
  deviceName?: string;
  forceBind?: boolean;
}

export interface FamilyAlert {
  level: 'info' | 'warning' | 'danger' | string;
  alertType: string;
  title: string;
  content?: string;
  metricValue?: string;
}

export interface FamilyDashboard {
  member: FamilyMember;
  device: {
    deviceId?: string;
    mac?: string;
    uniMacId?: string;
    protocol?: string;
    advertis?: {
      macInfo?: string;
    };
    deviceName?: string;
    battery?: number | string;
    lastSyncTime?: string;
    online?: boolean;
  };
  health: any;
  summary: Record<string, any>;
  alerts: FamilyAlert[];
  aiSummary?: {
    title: string;
    conclusion: string;
    metrics?: Record<string, number | null>;
    suggestions?: string[];
    disclaimer?: string;
  } | null;
}

export interface FamilyGuardian {
  memberId: number;
  relationId?: number;
  name: string;
  relation?: string;
  status?: string;
  statusText?: string;
  relationStatus?: number;
  guardianUserId: number;
  guardianName?: string;
  guardianAvatar?: string;
  guardianPhoneMasked?: string;
  permissions?: Record<string, boolean>;
}

export interface FamilyHome {
  members: Array<FamilyMember & { careStatus?: string; careStatusText?: string }>;
  guardians: FamilyGuardian[];
  pendingInviteCount: number;
  stats: {
    total: number;
    syncedToday: number;
    needAttention: number;
    unbound: number;
    guardians: number;
  };
  summaryText: string;
}

export interface FamilyCareReminder {
  memberId: number;
  relationId?: number;
  memberName: string;
  type: 'device_unsynced' | 'device_unbound' | 'low_battery' | 'health_attention' | string;
  level: 'warning' | 'danger' | string;
  priority: number;
  title: string;
  content: string;
  summary?: string;
  actionText?: string;
  actionUrl?: string;
  eventTime?: string;
}

export interface FamilyCareReminderBox {
  reminders: FamilyCareReminder[];
  unreadCount: number;
  summaryText: string;
  subscription: {
    subscribeEnabled: boolean;
    templateIds: string[];
    lastRequestStatus: Record<string, any>;
  };
}

export interface FamilyGroupMember {
  groupRelationId: number;
  relationId: number;
  memberId?: number;
  role?: string;
  status?: number;
  displayName?: string;
  relationType?: string;
  memberName?: string;
}

export interface FamilyGroup {
  id: number;
  ownerUserId: number;
  groupName: string;
  description?: string;
  status: number;
  memberCount: number;
  members: FamilyGroupMember[];
}

export interface FamilyAssistRequest {
  id: number;
  requesterUserId: number;
  relationId?: number;
  memberId?: number;
  requestType: string;
  status: number;
  statusText?: string;
  contactPhone?: string;
  contactPhoneMasked?: string;
  deviceMac?: string;
  description?: string;
  resultNote?: string;
  displayName?: string;
  memberName?: string;
  createTime?: string;
  updateTime?: string;
}

export interface FamilyUserSearchResult {
  userId: number;
  nickName: string;
  avatar?: string;
  phoneMasked: string;
}

export interface FamilyElderProfileResult {
  memberId: number;
  relationId: number;
  elderProfileId?: number;
  elderUserId?: number;
}

export interface FamilyInviteResult {
  inviteCode: string;
  expireTime: string;
}

export interface FamilyInvite {
  id: number;
  inviteCode: string;
  inviterUserId: number;
  inviteeUserId?: number;
  elderUserId?: number;
  elderProfileId?: number;
  relationId?: number;
  inviteType: number;
  targetPhone?: string;
  targetPhoneMasked?: string;
  status: number;
  statusText: string;
  expireTime: string;
  createTime?: string;
  inviterName?: string;
  inviteeName?: string;
  elderProfileName?: string;
  relationName?: string;
}

export interface FamilyWeeklyReport {
  title: string;
  period: {
    startDate: string;
    endDate: string;
  };
  conclusion: string;
  metrics: {
    syncedDays: number;
    totalDays: number;
    heartRateAvg?: number | null;
    spo2Avg?: number | null;
    sleepScoreAvg?: number | null;
    motionScoreAvg?: number | null;
    stepsAvg?: number | null;
  };
  concerns: string[];
  suggestions: string[];
  records: Array<Record<string, any>>;
  disclaimer: string;
}

export const getFamilyMembers = (params = {}, config = {}): Promise<FamilyMember[]> =>
  (uni as any).$uv.http.get('/app/family/member/list', { params, ...config });

export const getFamilyHome = (params = {}, config = {}): Promise<FamilyHome> =>
  (uni as any).$uv.http.get('/app/family/home', { params, ...config });

export const getFamilyCareReminders = (params = {}, config = {}): Promise<FamilyCareReminderBox> =>
  (uni as any).$uv.http.get('/app/family/care/reminders', { params, ...config });

export const updateFamilyCareSubscribe = (
  params: { subscribeEnabled?: boolean; templateIds?: string[]; requestStatus?: Record<string, any> },
  config = {}
) => (uni as any).$uv.http.post('/app/family/care/subscribe', params, config);

export const getFamilyGroups = (params = {}, config = {}): Promise<FamilyGroup[]> =>
  (uni as any).$uv.http.get('/app/family/groups', { params, ...config });

export const createFamilyGroup = (
  params: { groupName: string; description?: string; relationIds?: number[] },
  config = {}
): Promise<FamilyGroup> => (uni as any).$uv.http.post('/app/family/groups', params, config);

export const addFamilyGroupRelation = (
  groupId: number,
  params: { relationId: number },
  config = {}
): Promise<FamilyGroup> => (uni as any).$uv.http.post(`/app/family/groups/${groupId}/relations`, params, config);

export const getFamilyAssistRequests = (params = {}, config = {}): Promise<FamilyAssistRequest[]> =>
  (uni as any).$uv.http.get('/app/family/assist/list', { params, ...config });

export const createFamilyAssistRequest = (
  params: {
    relationId?: number;
    memberId?: number;
    requestType?: string;
    contactPhone?: string;
    deviceMac?: string;
    description: string;
  },
  config = {}
): Promise<FamilyAssistRequest> => (uni as any).$uv.http.post('/app/family/assist', params, config);

export const getFamilyGuardians = (params = {}, config = {}): Promise<FamilyGuardian[]> =>
  (uni as any).$uv.http.get('/app/family/guardians', { params, ...config });

export const createFamilyElderProfile = (params: FamilyMemberPayload, config = {}): Promise<FamilyElderProfileResult> =>
  (uni as any).$uv.http.post('/app/family/elder-profile', params, config);

export const searchFamilyUser = (params: { phone: string }, config = {}): Promise<FamilyUserSearchResult | null> =>
  (uni as any).$uv.http.get('/app/family/users/search', { params, ...config });

export const createFamilyInvite = (
  params: { inviteType: number; targetPhone?: string; elderUserId?: number; elderProfileId?: number; relationId?: number },
  config = {}
): Promise<FamilyInviteResult> => (uni as any).$uv.http.post('/app/family/invite', params, config);

export const getFamilyInvites = (params = {}, config = {}): Promise<FamilyInvite[]> =>
  (uni as any).$uv.http.get('/app/family/invite/list', { params, ...config });

export const acceptFamilyInvite = (inviteCode: string, config = {}) =>
  (uni as any).$uv.http.post(`/app/family/invite/${inviteCode}/accept`, {}, config);

export const rejectFamilyInvite = (inviteCode: string, config = {}) =>
  (uni as any).$uv.http.post(`/app/family/invite/${inviteCode}/reject`, {}, config);

export const updateFamilyRelation = (
  relationId: number,
  params: { status?: 'active' | 'paused' | 'cancelled'; permissionScope?: Record<string, boolean>; displayName?: string },
  config = {}
) => (uni as any).$uv.http.put(`/app/family/relations/${relationId}`, params, config);

export const deleteFamilyRelation = (relationId: number, config = {}) =>
  (uni as any).$uv.http.delete(`/app/family/relations/${relationId}`, {}, config);

export const claimFamilyElderProfile = (profileId: number, config = {}) =>
  (uni as any).$uv.http.post(`/app/family/elder-profile/${profileId}/claim`, {}, config);

export const addFamilyMember = (params: FamilyMemberPayload, config = {}): Promise<FamilyMember> =>
  (uni as any).$uv.http.post('/app/family/member/add', params, config);

export const getFamilyMemberDetail = (params: { memberId: number }, config = {}): Promise<FamilyMember> =>
  (uni as any).$uv.http.get('/app/family/member/detail', { params, ...config });

export const removeFamilyMember = (params: { memberId: number }, config = {}) =>
  (uni as any).$uv.http.post('/app/family/member/remove', params, config);

export const updateFamilyPermissions = (
  params: { memberId: number; permissions: Record<string, boolean> },
  config = {}
): Promise<FamilyMember> => (uni as any).$uv.http.post('/app/family/share/updatePermissions', params, config);

export const bindFamilyDevice = (params: FamilyDeviceBindPayload, config = {}): Promise<FamilyMember> =>
  (uni as any).$uv.http.post('/app/family/device/bind', normalizeFamilyDeviceBindPayload(params), config);

export const bindFamilyRelationDevice = (relationId: number, params: FamilyDeviceBindPayload, config = {}): Promise<FamilyMember> =>
  (uni as any).$uv.http.post(`/app/family/elders/${relationId}/devices/bind`, normalizeFamilyDeviceBindPayload(params), config);

const normalizeFamilyDeviceBindPayload = (params: FamilyDeviceBindPayload): FamilyDeviceBindPayload => {
  if (params.protocol !== 'rw') return params;
  const stableMac =
    params.mac ||
    params.advertis?.macInfo ||
    (isColonSeparatedBleMac(params.uniMacId) ? params.uniMacId : '') ||
    (isColonSeparatedBleMac(params.deviceId) ? params.deviceId : '');
  if (!stableMac || stableMac === params.mac) return params;
  return {
    ...params,
    mac: stableMac
  };
};

const isColonSeparatedBleMac = (value?: unknown) => /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){2,5}$/.test(String(value || '').trim());

export const getFamilyDashboard = (params: { memberId: number }, config = {}): Promise<FamilyDashboard> =>
  (uni as any).$uv.http.get('/app/family/health/dashboard', { params, ...config });

export const getFamilyRelationDashboard = (relationId: number, config = {}): Promise<FamilyDashboard> =>
  (uni as any).$uv.http.get(`/app/family/elders/${relationId}/health/overview`, config);

export const getFamilyAlerts = (params: { memberId: number }, config = {}): Promise<FamilyAlert[]> =>
  (uni as any).$uv.http.get('/app/family/alert/list', { params, ...config });

export const getFamilyAiDailySummary = (params: { memberId: number }, config = {}) =>
  (uni as any).$uv.http.get('/app/family/ai/dailySummary', { params, ...config });

export const getFamilyAiWeeklyReport = (params: { memberId: number }, config = {}): Promise<FamilyWeeklyReport> =>
  (uni as any).$uv.http.get('/app/family/ai/weeklyReport', { params, ...config });

export const getFamilyAiMonthlyReport = (params: { memberId: number }, config = {}): Promise<FamilyWeeklyReport> =>
  (uni as any).$uv.http.get('/app/family/ai/monthlyReport', { params, ...config });

export const getFamilyRelationAiWeeklyReport = (relationId: number, config = {}): Promise<FamilyWeeklyReport> =>
  (uni as any).$uv.http.get(`/app/family/elders/${relationId}/ai/weeklyReport`, config);

export const getFamilyRelationAiMonthlyReport = (relationId: number, config = {}): Promise<FamilyWeeklyReport> =>
  (uni as any).$uv.http.get(`/app/family/elders/${relationId}/ai/monthlyReport`, config);

export const getFamilyVitalSign = (params: { memberId: number; date?: string }, config = {}) =>
  (uni as any).$uv.http.get('/app/family/data/vitalSign', { params, ...config });

export const getFamilySleepOverview = (params: { memberId: number; date?: string }, config = {}) =>
  (uni as any).$uv.http.get('/app/family/data/sleep/sleepOverview', { params, ...config });

export const getFamilyMotionOverview = (params: { memberId: number; date?: string }, config = {}) =>
  (uni as any).$uv.http.get('/app/family/data/motion/motionOverview', { params, ...config });
