<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="82px">
      <el-form-item label="用户ID" prop="userId">
        <el-input v-model="queryParams.userId" clearable placeholder="请输入用户ID" @keyup.enter.native="handleQuery" />
      </el-form-item>
      <el-form-item label="接口" prop="endpoint">
        <el-input v-model="queryParams.endpoint" clearable placeholder="如 /physicalHealth/sleepScore" @keyup.enter.native="handleQuery" />
      </el-form-item>
      <el-form-item label="字段路径" prop="fieldPath">
        <el-input v-model="queryParams.fieldPath" clearable placeholder="如 score" @keyup.enter.native="handleQuery" />
      </el-form-item>
      <el-form-item label="环境" prop="env">
        <el-select v-model="queryParams.env" clearable placeholder="请选择">
          <el-option label="debug" value="debug" />
          <el-option label="prod" value="prod" />
        </el-select>
      </el-form-item>
      <el-form-item label="测试员" prop="tester">
        <el-input v-model="queryParams.tester" clearable placeholder="请输入测试员" @keyup.enter.native="handleQuery" />
      </el-form-item>
      <el-form-item label="审阅状态" prop="reviewStatus">
        <el-select v-model="queryParams.reviewStatus" clearable placeholder="请选择">
          <el-option label="待处理" value="pending" />
          <el-option label="已确认" value="confirmed" />
          <el-option label="已忽略" value="ignored" />
        </el-select>
      </el-form-item>
      <el-form-item label="诊断分类" prop="diagnosis">
        <el-select v-model="queryParams.diagnosis" clearable placeholder="请选择">
          <el-option label="前端映射" value="front" />
          <el-option label="数据/固件" value="data" />
          <el-option label="算法问题" value="algorithm" />
          <el-option label="待判断" value="unknown" />
        </el-select>
      </el-form-item>
      <el-form-item label="提交时间">
        <el-date-picker
          v-model="dateRange"
          style="width: 240px"
          value-format="yyyy-MM-dd"
          type="daterange"
          range-separator="-"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
        <el-button type="warning" plain icon="el-icon-download" size="mini" @click="handleExport">导出标注集</el-button>
      </el-col>
      <right-toolbar :showSearch.sync="showSearch" @queryTable="getList"></right-toolbar>
    </el-row>

    <el-table v-loading="loading" :data="snapshotList">
      <el-table-column label="ID" align="center" prop="id" width="80" />
      <el-table-column label="用户ID" align="center" prop="userId" width="110" />
      <el-table-column label="接口" align="left" prop="endpoint" min-width="220" show-overflow-tooltip />
      <el-table-column label="显示名称" align="center" prop="displayedAs" width="130" />
      <el-table-column label="字段路径" align="center" prop="fieldPath" width="150" show-overflow-tooltip />
      <el-table-column label="原值" align="center" width="120" show-overflow-tooltip>
        <template slot-scope="scope">{{ formatValue(scope.row.originalValue) }}</template>
      </el-table-column>
      <el-table-column label="纠错值" align="center" width="120" show-overflow-tooltip>
        <template slot-scope="scope">{{ formatValue(scope.row.correctedValue) }}</template>
      </el-table-column>
      <el-table-column label="原因" align="left" prop="reason" min-width="220" show-overflow-tooltip />
      <el-table-column label="设备/固件" align="center" width="160">
        <template slot-scope="scope">
          <div>{{ scope.row.deviceId || '-' }}</div>
          <div class="muted">{{ scope.row.firmware || '-' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="环境" align="center" prop="env" width="90" />
      <el-table-column label="审阅" align="center" width="160">
        <template slot-scope="scope">
          <el-tag :type="reviewStatusTag(scope.row.reviewStatus)" size="mini">{{ reviewStatusText(scope.row.reviewStatus) }}</el-tag>
          <div class="muted">{{ diagnosisText(scope.row.diagnosis) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="测试员" align="center" prop="tester" width="100" />
      <el-table-column label="提交时间" align="center" prop="createTime" width="160" />
      <el-table-column label="操作" align="center" width="220" fixed="right">
        <template slot-scope="scope">
          <el-button size="mini" type="text" icon="el-icon-view" @click="handleView(scope.row)">详情</el-button>
          <el-button size="mini" type="text" icon="el-icon-refresh" @click="handleRecalculate(scope.row)">复算</el-button>
          <el-button size="mini" type="text" icon="el-icon-edit" @click="handleReview(scope.row)">标注</el-button>
          <el-button size="mini" type="text" icon="el-icon-delete" class="text-danger" @click="handleDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <pagination
      v-show="total > 0"
      :total="total"
      :page.sync="queryParams.pageNum"
      :limit.sync="queryParams.pageSize"
      @pagination="getList"
    />

    <el-dialog title="反馈快照详情" :visible.sync="detailOpen" width="980px" append-to-body>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="快照ID">{{ detail.snapshotId }}</el-descriptions-item>
        <el-descriptions-item label="用户ID">{{ detail.userId }}</el-descriptions-item>
        <el-descriptions-item label="接口">{{ detail.endpoint }}</el-descriptions-item>
        <el-descriptions-item label="算法版本">{{ detail.algoVersion || '-' }}</el-descriptions-item>
        <el-descriptions-item label="显示名称">{{ detail.displayedAs }}</el-descriptions-item>
        <el-descriptions-item label="字段路径">{{ detail.fieldPath }}</el-descriptions-item>
        <el-descriptions-item label="原值">{{ formatValue(detail.originalValue) }}</el-descriptions-item>
        <el-descriptions-item label="纠错值">{{ formatValue(detail.correctedValue) }}</el-descriptions-item>
        <el-descriptions-item label="原因" :span="2">{{ detail.reason }}</el-descriptions-item>
        <el-descriptions-item label="设备ID">{{ detail.deviceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="固件">{{ detail.firmware || '-' }}</el-descriptions-item>
        <el-descriptions-item label="小程序版本">{{ detail.appVersion || '-' }}</el-descriptions-item>
        <el-descriptions-item label="环境/测试员">{{ detail.env || '-' }} / {{ detail.tester || '-' }}</el-descriptions-item>
        <el-descriptions-item label="审阅状态">{{ reviewStatusText(detail.reviewStatus) }}</el-descriptions-item>
        <el-descriptions-item label="诊断分类">{{ diagnosisText(detail.diagnosis) }}</el-descriptions-item>
        <el-descriptions-item label="审阅备注" :span="2">{{ detail.reviewRemark || '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-tabs class="mt16" type="border-card">
        <el-tab-pane label="原始请求体">
          <pre class="json-box">{{ pretty(detail.requestBody) }}</pre>
        </el-tab-pane>
        <el-tab-pane label="完整响应体">
          <pre class="json-box">{{ pretty(detail.responseBody) }}</pre>
        </el-tab-pane>
        <el-tab-pane label="上下文">
          <pre class="json-box">{{ pretty(detail.context) }}</pre>
        </el-tab-pane>
      </el-tabs>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" icon="el-icon-refresh" @click="handleRecalculate(detail)">一键复算</el-button>
        <el-button @click="detailOpen = false">关闭</el-button>
      </div>
    </el-dialog>

    <el-dialog title="复算结果" :visible.sync="recalcOpen" width="980px" append-to-body>
      <el-alert
        title="复算使用快照里的原始 requestBody 调用当前算法服务；纠错值仍作为待查信号，不会自动覆盖业务数据。"
        type="info"
        show-icon
        :closable="false"
        class="mb16"
      />
      <el-row :gutter="16">
        <el-col :span="12">
          <div class="json-title">当时响应</div>
          <pre class="json-box result-box">{{ pretty(recalcResult.oldResponse) }}</pre>
        </el-col>
        <el-col :span="12">
          <div class="json-title">当前复算响应</div>
          <pre class="json-box result-box">{{ pretty(recalcResult.currentResponse) }}</pre>
        </el-col>
      </el-row>
      <div class="json-title mt16">纠错信息</div>
      <pre class="json-box">{{ pretty(recalcResult.correction) }}</pre>
      <div slot="footer" class="dialog-footer">
        <el-button @click="recalcOpen = false">关闭</el-button>
      </div>
    </el-dialog>

    <el-dialog title="标注审阅结论" :visible.sync="reviewOpen" width="560px" append-to-body>
      <el-form ref="reviewFormRef" :model="reviewForm" label-width="90px">
        <el-form-item label="审阅状态">
          <el-radio-group v-model="reviewForm.reviewStatus">
            <el-radio label="pending">待处理</el-radio>
            <el-radio label="confirmed">已确认</el-radio>
            <el-radio label="ignored">已忽略</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="诊断分类">
          <el-radio-group v-model="reviewForm.diagnosis">
            <el-radio label="front">前端映射</el-radio>
            <el-radio label="data">数据/固件</el-radio>
            <el-radio label="algorithm">算法问题</el-radio>
            <el-radio label="unknown">待判断</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审阅人">
          <el-input v-model="reviewForm.reviewedBy" placeholder="请输入审阅人" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="reviewForm.reviewRemark" type="textarea" :rows="4" placeholder="填写判断依据或处理建议" />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitReview">确定</el-button>
        <el-button @click="reviewOpen = false">取消</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import {
  listFeedbackSnapshots,
  getFeedbackSnapshot,
  recalculateFeedbackSnapshot,
  exportFeedbackSnapshots,
  reviewFeedbackSnapshot,
  deleteFeedbackSnapshot
} from '@/api/feedback/snapshot'
import { saveAs } from 'file-saver'

export default {
  name: 'FeedbackSnapshot',
  data() {
    return {
      loading: false,
      showSearch: true,
      snapshotList: [],
      total: 0,
      dateRange: [],
      detailOpen: false,
      recalcOpen: false,
      reviewOpen: false,
      detail: {},
      recalcResult: {},
      reviewTarget: null,
      reviewForm: {
        reviewStatus: 'confirmed',
        diagnosis: 'unknown',
        reviewRemark: '',
        reviewedBy: ''
      },
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        userId: undefined,
        endpoint: undefined,
        fieldPath: undefined,
        env: undefined,
        tester: undefined,
        reviewStatus: undefined,
        diagnosis: undefined
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    buildQuery() {
      const query = { ...this.queryParams }
      if (this.dateRange && this.dateRange.length === 2) {
        query.beginTime = this.dateRange[0]
        query.endTime = this.dateRange[1]
      }
      return query
    },
    getList() {
      this.loading = true
      listFeedbackSnapshots(this.buildQuery()).then(response => {
        this.snapshotList = response.rows || []
        this.total = response.total || 0
        this.loading = false
      }).catch(() => {
        this.loading = false
      })
    },
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    resetQuery() {
      this.dateRange = []
      this.resetForm && this.resetForm('queryForm')
      this.handleQuery()
    },
    handleView(row) {
      getFeedbackSnapshot(row.id).then(response => {
        this.detail = response.data || {}
        this.detailOpen = true
      })
    },
    handleRecalculate(row) {
      const id = row.id
      if (!id) return
      recalculateFeedbackSnapshot(id).then(response => {
        this.recalcResult = response.data || {}
        this.recalcOpen = true
      })
    },
    handleReview(row) {
      this.reviewTarget = row
      this.reviewForm = {
        reviewStatus: row.reviewStatus || 'confirmed',
        diagnosis: row.diagnosis || 'unknown',
        reviewRemark: row.reviewRemark || '',
        reviewedBy: row.reviewedBy || ''
      }
      this.reviewOpen = true
    },
    submitReview() {
      if (!this.reviewTarget) return
      reviewFeedbackSnapshot(this.reviewTarget.id, this.reviewForm).then(() => {
        this.$modal && this.$modal.msgSuccess ? this.$modal.msgSuccess('标注成功') : this.$message.success('标注成功')
        this.reviewOpen = false
        this.getList()
      })
    },
    handleDelete(row) {
      const id = row.id
      if (!id) return
      const message = `确认删除反馈快照 ${row.snapshotId || id} 吗？`
      const confirm = this.$modal && this.$modal.confirm ? this.$modal.confirm(message) : this.$confirm(message, '提示', { type: 'warning' })
      confirm.then(() => deleteFeedbackSnapshot(id)).then(() => {
        this.$modal && this.$modal.msgSuccess ? this.$modal.msgSuccess('删除成功') : this.$message.success('删除成功')
        this.getList()
      }).catch(() => {})
    },
    handleExport() {
      exportFeedbackSnapshots(this.buildQuery()).then(blob => {
        saveAs(new Blob([blob], { type: 'text/csv;charset=utf-8' }), 'feedback_snapshots.csv')
      })
    },
    pretty(value) {
      if (value === undefined || value === null || value === '') return '-'
      try {
        return JSON.stringify(value, null, 2)
      } catch (e) {
        return String(value)
      }
    },
    formatValue(value) {
      if (value === undefined || value === null || value === '') return '-'
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    },
    reviewStatusText(value) {
      return ({ pending: '待处理', confirmed: '已确认', ignored: '已忽略' })[value] || '待处理'
    },
    reviewStatusTag(value) {
      return ({ pending: 'warning', confirmed: 'success', ignored: 'info' })[value] || 'warning'
    },
    diagnosisText(value) {
      return ({ front: '前端映射', data: '数据/固件', algorithm: '算法问题', unknown: '待判断' })[value] || '待判断'
    }
  }
}
</script>

<style scoped>
.muted {
  color: #909399;
  font-size: 12px;
  line-height: 18px;
}

.mt16 {
  margin-top: 16px;
}

.mb16 {
  margin-bottom: 16px;
}

.json-title {
  margin-bottom: 8px;
  font-weight: 600;
  color: #303133;
}

.json-box {
  max-height: 420px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  background: #f8fafc;
  color: #303133;
  font-size: 12px;
  line-height: 1.6;
}

.result-box {
  min-height: 360px;
}
</style>
