<template>
  <div class="app-container family-share-page">
    <el-card shadow="never" class="summary-card">
      <div class="summary-title">亲情共享治理</div>
      <div class="summary-desc">
        查看共享关系、邀请记录、老人档案和设备归属变更，用于处理授权异常、设备迁移和运营审计。
      </div>
    </el-card>

    <el-tabs v-model="activeTab" @tab-click="handleTabChange">
      <el-tab-pane
        v-for="tab in tabs"
        :key="tab.name"
        :label="tab.label"
        :name="tab.name"
      />
    </el-tabs>

    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="78px">
      <el-form-item :label="activeConfig.searchLabel">
        <el-input
          v-model.trim="queryParams.keyword"
          :placeholder="activeConfig.searchPlaceholder"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5" v-if="activeTab === 'relation'">
        <el-button type="warning" plain icon="el-icon-video-pause" size="mini" :disabled="single" @click="changeRelationStatus(2)">暂停共享</el-button>
      </el-col>
      <el-col :span="1.5" v-if="activeTab === 'relation'">
        <el-button type="success" plain icon="el-icon-video-play" size="mini" :disabled="single" @click="changeRelationStatus(1)">恢复共享</el-button>
      </el-col>
      <el-col :span="1.5" v-if="activeTab !== 'abnormal'">
        <el-button type="danger" plain icon="el-icon-delete" size="mini" :disabled="multiple" @click="handleDelete">{{ activeTab === 'relation' ? '取消共享' : '删除' }}</el-button>
      </el-col>
      <right-toolbar :showSearch.sync="showSearch" @queryTable="getList"></right-toolbar>
    </el-row>

    <el-table v-loading="loading" :data="rows" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" align="center" />
      <el-table-column
        v-for="column in activeConfig.columns"
        :key="column.prop"
        :label="column.label"
        :prop="column.prop"
        :min-width="column.minWidth || 120"
        align="center"
        show-overflow-tooltip
      >
        <template slot-scope="scope">
          <el-tag v-if="column.type === 'relationStatus'" :type="relationStatusTag(scope.row[column.prop])">
            {{ relationStatusText(scope.row[column.prop]) }}
          </el-tag>
          <el-tag v-else-if="column.type === 'inviteStatus'" :type="inviteStatusTag(scope.row[column.prop])">
            {{ inviteStatusText(scope.row[column.prop]) }}
          </el-tag>
          <el-tag v-else-if="column.type === 'assistStatus'" :type="assistStatusTag(scope.row[column.prop])">
            {{ assistStatusText(scope.row[column.prop]) }}
          </el-tag>
          <span v-else-if="column.type === 'time'">{{ parseTime(scope.row[column.prop], '{y}-{m}-{d} {h}:{i}') }}</span>
          <span v-else>{{ scope.row[column.prop] }}</span>
        </template>
      </el-table-column>
      <el-table-column v-if="activeTab !== 'abnormal'" label="操作" align="center" :width="activeTab === 'assistRequest' ? 260 : 180" fixed="right">
        <template slot-scope="scope">
          <el-button
            v-if="activeTab === 'relation' && Number(scope.row.status) !== 2"
            size="mini"
            type="text"
            icon="el-icon-video-pause"
            @click="changeRelationStatus(2, scope.row)"
          >暂停</el-button>
          <el-button
            v-if="activeTab === 'relation' && Number(scope.row.status) === 2"
            size="mini"
            type="text"
            icon="el-icon-video-play"
            @click="changeRelationStatus(1, scope.row)"
          >恢复</el-button>
          <el-button
            v-if="activeTab === 'assistRequest' && Number(scope.row.status) === 0"
            size="mini"
            type="text"
            icon="el-icon-s-claim"
            @click="changeAssistStatus(1, scope.row)"
          >接单</el-button>
          <el-button
            v-if="activeTab === 'assistRequest' && Number(scope.row.status) !== 2"
            size="mini"
            type="text"
            icon="el-icon-check"
            @click="changeAssistStatus(2, scope.row)"
          >完成</el-button>
          <el-button
            v-if="activeTab === 'assistRequest' && Number(scope.row.status) !== 3"
            size="mini"
            type="text"
            icon="el-icon-close"
            @click="changeAssistStatus(3, scope.row)"
          >关闭</el-button>
          <el-button size="mini" type="text" icon="el-icon-delete" @click="handleDelete(scope.row)">{{ activeTab === 'relation' ? '取消' : '删除' }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <pagination
      v-show="total>0"
      :total="total"
      :page.sync="queryParams.pageNum"
      :limit.sync="queryParams.pageSize"
      @pagination="getList"
    />
  </div>
</template>

<script>
import { deleteFamilyResource, listFamilyAbnormal, listFamilyResource, updateFamilyAssistStatus, updateFamilyRelationStatus } from '@/api/family/share'

const TAB_CONFIG = {
  relation: {
    resource: 'relation',
    label: '共享关系',
    searchLabel: '关系搜索',
    searchPlaceholder: '称呼/关系/备注',
    searchFields: ['displayName', 'relationType', 'remark'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '老人用户', prop: 'elderUserId' },
      { label: '老人档案', prop: 'elderProfileId' },
      { label: '子女用户', prop: 'guardianUserId' },
      { label: '称呼', prop: 'displayName' },
      { label: '关系', prop: 'relationType' },
      { label: '状态', prop: 'status', type: 'relationStatus' },
      { label: '来源', prop: 'source' },
      { label: '备注', prop: 'remark', minWidth: 180 },
      { label: '更新时间', prop: 'updateTime', type: 'time', minWidth: 160 }
    ]
  },
  invite: {
    resource: 'invite',
    label: '邀请记录',
    searchLabel: '邀请搜索',
    searchPlaceholder: '邀请码/手机号',
    searchFields: ['inviteCode', 'targetPhone'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '邀请码', prop: 'inviteCode', minWidth: 130 },
      { label: '邀请人', prop: 'inviterUserId' },
      { label: '接收人', prop: 'inviteeUserId' },
      { label: '目标手机号', prop: 'targetPhone', minWidth: 140 },
      { label: '档案', prop: 'elderProfileId' },
      { label: '关系', prop: 'relationId' },
      { label: '类型', prop: 'inviteType' },
      { label: '状态', prop: 'status', type: 'inviteStatus' },
      { label: '过期时间', prop: 'expireTime', type: 'time', minWidth: 160 }
    ]
  },
  elderProfile: {
    resource: 'elderProfile',
    label: '老人档案',
    searchLabel: '档案搜索',
    searchPlaceholder: '姓名/手机号',
    searchFields: ['name', 'phone'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '创建人', prop: 'creatorUserId' },
      { label: '真实用户', prop: 'realUserId' },
      { label: '姓名', prop: 'name' },
      { label: '手机号', prop: 'phone', minWidth: 140 },
      { label: '性别', prop: 'sex' },
      { label: '生日', prop: 'birthday', minWidth: 120 },
      { label: '身高', prop: 'height' },
      { label: '体重', prop: 'weight' },
      { label: '认领状态', prop: 'claimStatus' },
      { label: '更新时间', prop: 'updateTime', type: 'time', minWidth: 160 }
    ]
  },
  deviceBindLog: {
    resource: 'deviceBindLog',
    label: '设备归属日志',
    searchLabel: '设备搜索',
    searchPlaceholder: 'MAC/SN/动作/原因',
    searchFields: ['deviceMac', 'deviceSn', 'action', 'reason'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '设备ID', prop: 'deviceId' },
      { label: '设备MAC', prop: 'deviceMac', minWidth: 160 },
      { label: '设备SN', prop: 'deviceSn', minWidth: 160 },
      { label: '旧用户', prop: 'oldUserId' },
      { label: '新用户', prop: 'newUserId' },
      { label: '操作人', prop: 'operatorUserId' },
      { label: '动作', prop: 'action' },
      { label: '原因', prop: 'reason', minWidth: 200 },
      { label: '时间', prop: 'createTime', type: 'time', minWidth: 160 }
    ]
  },
  relationAudit: {
    resource: 'relationAudit',
    label: '共享审计',
    searchLabel: '审计搜索',
    searchPlaceholder: '动作/原因/操作人',
    searchFields: ['action', 'reason', 'operatorName'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '关系ID', prop: 'relationId' },
      { label: '旧状态', prop: 'oldStatus', type: 'relationStatus' },
      { label: '新状态', prop: 'newStatus', type: 'relationStatus' },
      { label: '操作人ID', prop: 'operatorUserId' },
      { label: '操作人', prop: 'operatorName' },
      { label: '动作', prop: 'action' },
      { label: '原因', prop: 'reason', minWidth: 220 },
      { label: '时间', prop: 'createTime', type: 'time', minWidth: 160 }
    ]
  },
  member: {
    resource: 'member',
    label: '家人成员',
    searchLabel: '成员搜索',
    searchPlaceholder: '姓名/手机号/关系/状态',
    searchFields: ['name', 'phone', 'relation', 'status'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '子女用户', prop: 'ownerUserId' },
      { label: '老人数据用户', prop: 'dataUserId' },
      { label: '关系ID', prop: 'relationId' },
      { label: '档案ID', prop: 'elderProfileId' },
      { label: '姓名', prop: 'name' },
      { label: '关系', prop: 'relation' },
      { label: '手机号', prop: 'phone', minWidth: 140 },
      { label: '状态', prop: 'status' },
      { label: '更新时间', prop: 'updateTime', type: 'time', minWidth: 160 }
    ]
  },
  group: {
    resource: 'group',
    label: '家庭群组',
    searchLabel: '群组搜索',
    searchPlaceholder: '群组名称/说明',
    searchFields: ['groupName', 'description'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '负责人用户', prop: 'ownerUserId' },
      { label: '群组名称', prop: 'groupName', minWidth: 160 },
      { label: '说明', prop: 'description', minWidth: 220 },
      { label: '状态', prop: 'status' },
      { label: '更新时间', prop: 'updateTime', type: 'time', minWidth: 160 }
    ]
  },
  groupRelation: {
    resource: 'groupRelation',
    label: '群组成员',
    searchLabel: '成员搜索',
    searchPlaceholder: '角色',
    searchFields: ['role'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '群组ID', prop: 'groupId' },
      { label: '关系ID', prop: 'relationId' },
      { label: '成员ID', prop: 'memberId' },
      { label: '角色', prop: 'role' },
      { label: '创建人', prop: 'createdBy' },
      { label: '状态', prop: 'status' },
      { label: '更新时间', prop: 'updateTime', type: 'time', minWidth: 160 }
    ]
  },
  assistRequest: {
    resource: 'assistRequest',
    label: '人工协助',
    searchLabel: '协助搜索',
    searchPlaceholder: '类型/手机号/MAC/说明',
    searchFields: ['requestType', 'contactPhone', 'deviceMac', 'description', 'resultNote'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 80 },
      { label: '请求用户', prop: 'requesterUserId' },
      { label: '关系ID', prop: 'relationId' },
      { label: '成员ID', prop: 'memberId' },
      { label: '类型', prop: 'requestType' },
      { label: '状态', prop: 'status', type: 'assistStatus' },
      { label: '联系电话', prop: 'contactPhone', minWidth: 140 },
      { label: '设备MAC', prop: 'deviceMac', minWidth: 160 },
      { label: '说明', prop: 'description', minWidth: 240 },
      { label: '处理人', prop: 'operatorName', minWidth: 120 },
      { label: '处理备注', prop: 'resultNote', minWidth: 220 },
      { label: '更新时间', prop: 'updateTime', type: 'time', minWidth: 160 }
    ]
  },
  abnormal: {
    resource: 'abnormal',
    label: '异常授权',
    searchLabel: '异常搜索',
    searchPlaceholder: '标题/内容/对象编号',
    searchFields: ['keyword'],
    columns: [
      { label: '编号', prop: 'id', minWidth: 140 },
      { label: '来源', prop: 'sourceType' },
      { label: '对象', prop: 'objectId', minWidth: 120 },
      { label: '标题', prop: 'title', minWidth: 160 },
      { label: '内容', prop: 'content', minWidth: 260 },
      { label: '等级', prop: 'severity' },
      { label: '时间', prop: 'eventTime', type: 'time', minWidth: 160 }
    ]
  }
}

export default {
  name: 'FamilyShare',
  data() {
    return {
      loading: false,
      showSearch: true,
      activeTab: 'relation',
      rows: [],
      total: 0,
      ids: [],
      single: true,
      multiple: true,
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        keyword: ''
      }
    }
  },
  computed: {
    tabs() {
      return Object.keys(TAB_CONFIG).map(name => ({ name, label: TAB_CONFIG[name].label }))
    },
    activeConfig() {
      return TAB_CONFIG[this.activeTab]
    }
  },
  created() {
    this.getList()
  },
  methods: {
    getList() {
      this.loading = true
      const params = {
        pageNum: this.queryParams.pageNum,
        pageSize: this.queryParams.pageSize
      }
      if (this.queryParams.keyword) {
        this.activeConfig.searchFields.forEach(field => {
          params[field] = this.queryParams.keyword
        })
      }
      const request = this.activeTab === 'abnormal'
        ? listFamilyAbnormal(params)
        : listFamilyResource(this.activeConfig.resource, params)
      request.then(response => {
        this.rows = response.rows || []
        this.total = response.total || 0
        this.loading = false
      }).catch(() => {
        this.loading = false
      })
    },
    handleTabChange() {
      this.queryParams.pageNum = 1
      this.queryParams.keyword = ''
      this.ids = []
      this.getList()
    },
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    resetQuery() {
      this.queryParams.keyword = ''
      this.handleQuery()
    },
    handleSelectionChange(selection) {
      this.ids = selection.map(item => item.id)
      this.single = selection.length !== 1
      this.multiple = !selection.length
    },
    changeRelationStatus(status, row) {
      const target = row || this.rows.find(item => item.id === this.ids[0])
      if (!target) return
      const text = status === 2 ? '暂停' : '恢复'
      this.$prompt(`请填写${text}共享的操作原因`, `${text}共享关系`, {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPattern: /\S+/,
        inputErrorMessage: '操作原因不能为空'
      }).then(({ value }) => {
        return updateFamilyRelationStatus(target.id, { status, reason: value })
      }).then(() => {
        this.$modal.msgSuccess(`${text}成功`)
        this.getList()
      })
    },
    changeAssistStatus(status, row) {
      if (!row) return
      const text = { 1: '接单处理', 2: '完成处理', 3: '关闭请求' }[status]
      const needsNote = status !== 1
      const submit = note => updateFamilyAssistStatus(row.id, { status, resultNote: note || '' })
      const done = () => {
        this.$modal.msgSuccess(`${text}成功`)
        this.getList()
      }
      if (!needsNote) {
        submit('').then(done)
        return
      }
      this.$prompt(`请填写${text}备注`, text, {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPattern: /\S+/,
        inputErrorMessage: '处理备注不能为空'
      }).then(({ value }) => submit(value)).then(done)
    },
    handleDelete(row) {
      const ids = row && row.id ? row.id : this.ids
      if (this.activeTab === 'relation') {
        const target = row || this.rows.find(item => item.id === this.ids[0])
        if (!target) return
        this.$prompt('请填写取消共享的操作原因', '取消共享关系', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          inputPattern: /\S+/,
          inputErrorMessage: '操作原因不能为空'
        }).then(({ value }) => {
          return updateFamilyRelationStatus(target.id, { status: 3, reason: value })
        }).then(() => {
          this.$modal.msgSuccess('取消成功')
          this.getList()
        })
        return
      }
      this.$modal.confirm(`确认删除编号为 ${ids} 的数据项吗？`).then(() => {
        return deleteFamilyResource(this.activeConfig.resource, ids)
      }).then(() => {
        this.$modal.msgSuccess('删除成功')
        this.getList()
      })
    },
    relationStatusText(value) {
      return { 0: '待确认', 1: '生效', 2: '已暂停', 3: '已取消', 4: '已拒绝' }[Number(value)] || value
    },
    relationStatusTag(value) {
      return { 0: 'info', 1: 'success', 2: 'warning', 3: 'danger', 4: 'danger' }[Number(value)] || 'info'
    },
    inviteStatusText(value) {
      return { 0: '待接受', 1: '已接受', 2: '已拒绝', 3: '已过期', 4: '已取消' }[Number(value)] || value
    },
    inviteStatusTag(value) {
      return { 0: 'warning', 1: 'success', 2: 'danger', 3: 'info', 4: 'info' }[Number(value)] || 'info'
    },
    assistStatusText(value) {
      return { 0: '待处理', 1: '处理中', 2: '已完成', 3: '已关闭' }[Number(value)] || value
    },
    assistStatusTag(value) {
      return { 0: 'warning', 1: 'primary', 2: 'success', 3: 'info' }[Number(value)] || 'info'
    }
  }
}
</script>

<style scoped>
.summary-card {
  margin-bottom: 16px;
}
.summary-title {
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}
.summary-desc {
  margin-top: 8px;
  color: #606266;
  line-height: 1.6;
}
</style>
