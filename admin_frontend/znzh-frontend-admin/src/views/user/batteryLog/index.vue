<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="72px">
      <el-form-item label="用户ID" prop="userId">
        <el-input
          v-model="queryParams.userId"
          placeholder="请输入用户ID"
          clearable
          style="width: 140px"
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="Mac地址" prop="deviceMac">
        <el-input
          v-model="queryParams.deviceMac"
          placeholder="请输入设备Mac"
          clearable
          style="width: 220px"
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="记录时间">
        <el-date-picker
          v-model="daterangeRecordTime"
          style="width: 260px"
          value-format="yyyy-MM-dd HH:mm:ss"
          type="datetimerange"
          range-separator="-"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <right-toolbar :showSearch.sync="showSearch" @queryTable="getList"></right-toolbar>
    </el-row>

    <el-tabs v-model="activeTab" @tab-click="handleTabChange">
      <el-tab-pane label="电量记录" name="battery" />
      <el-tab-pane label="测量异常" name="measurement" />
    </el-tabs>

    <el-table v-if="activeTab === 'battery'" v-loading="loading" :data="batteryLogList">
      <el-table-column label="ID" align="center" prop="id" width="90" />
      <el-table-column label="用户ID" align="center" prop="userId" width="100" />
      <el-table-column label="用户编码" align="center" prop="userCode" min-width="140" show-overflow-tooltip />
      <el-table-column label="昵称" align="center" prop="nickName" min-width="120" show-overflow-tooltip />
      <el-table-column label="手机号" align="center" prop="phone" min-width="120" show-overflow-tooltip />
      <el-table-column label="Mac地址" align="center" prop="deviceMac" min-width="170" show-overflow-tooltip />
      <el-table-column label="真实电量" align="center" prop="realBattery" width="110">
        <template slot-scope="scope">
          <span>{{ scope.row.realBattery }}%</span>
        </template>
      </el-table-column>
      <el-table-column label="显示电量" align="center" prop="displayBattery" width="110">
        <template slot-scope="scope">
          <span>{{ scope.row.displayBattery == null ? '-' : `${scope.row.displayBattery}%` }}</span>
        </template>
      </el-table-column>
      <el-table-column label="来源" align="center" prop="source" min-width="130" show-overflow-tooltip />
      <el-table-column label="记录时间" align="center" prop="recordTime" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.recordTime) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="入库时间" align="center" prop="createTime" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.createTime) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <el-table v-else v-loading="loading" :data="measurementAnomalyList">
      <el-table-column type="expand" width="45">
        <template slot-scope="scope">
          <div class="anomaly-detail-title">异常详情</div>
          <pre class="anomaly-detail">{{ formatDetails(scope.row.details) }}</pre>
        </template>
      </el-table-column>
      <el-table-column label="ID" align="center" prop="id" width="90" />
      <el-table-column label="用户ID" align="center" prop="userId" width="100" />
      <el-table-column label="用户编码" align="center" prop="userCode" min-width="130" show-overflow-tooltip />
      <el-table-column label="昵称" align="center" prop="nickName" min-width="110" show-overflow-tooltip />
      <el-table-column label="Mac地址" align="center" prop="deviceMac" min-width="170" show-overflow-tooltip />
      <el-table-column label="测量类型" align="center" prop="measurementType" width="130" />
      <el-table-column label="异常情况" align="left" prop="anomaly" min-width="210" show-overflow-tooltip />
      <el-table-column label="阶段" align="center" prop="stage" min-width="120" show-overflow-tooltip />
      <el-table-column label="佩戴状态" align="center" prop="wearStatus" width="110">
        <template slot-scope="scope">
          <span>{{ scope.row.wearStatus || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="已有数据" align="left" min-width="220" show-overflow-tooltip>
        <template slot-scope="scope">
          <span>{{ formatMeasurementValues(scope.row.values) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="耗时" align="center" prop="elapsedMs" width="100">
        <template slot-scope="scope">
          <span>{{ formatDuration(scope.row.elapsedMs) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="异常时间" align="center" prop="recordTime" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.recordTime) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="版本" align="center" prop="buildTag" min-width="160" show-overflow-tooltip />
    </el-table>

    <pagination
      v-show="total > 0"
      :total="total"
      :page.sync="queryParams.pageNum"
      :limit.sync="queryParams.pageSize"
      @pagination="getList"
    />
  </div>
</template>

<script>
import { getUserBatteryLogList, getUserMeasurementAnomalyList } from '@/api/user/user'

export default {
  name: 'UserBatteryLog',
  data() {
    return {
      loading: false,
      showSearch: true,
      activeTab: 'battery',
      total: 0,
      batteryLogList: [],
      measurementAnomalyList: [],
      daterangeRecordTime: [],
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        userId: undefined,
        deviceMac: undefined,
        beginTime: undefined,
        endTime: undefined
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    getList() {
      this.loading = true
      const params = { ...this.queryParams }
      if (this.daterangeRecordTime && this.daterangeRecordTime.length === 2) {
        params.beginTime = this.daterangeRecordTime[0]
        params.endTime = this.daterangeRecordTime[1]
      } else {
        params.beginTime = undefined
        params.endTime = undefined
      }
      const requestList = this.activeTab === 'measurement'
        ? getUserMeasurementAnomalyList
        : getUserBatteryLogList
      const requestedTab = this.activeTab
      requestList(params)
        .then(response => {
          if (requestedTab === 'measurement') {
            this.measurementAnomalyList = response.rows || []
          } else {
            this.batteryLogList = response.rows || []
          }
          if (requestedTab === this.activeTab) this.total = response.total || 0
        })
        .finally(() => {
          if (requestedTab === this.activeTab) this.loading = false
        })
    },
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    handleTabChange() {
      this.queryParams.pageNum = 1
      this.total = 0
      this.getList()
    },
    formatDuration(value) {
      const milliseconds = Number(value)
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '-'
      if (milliseconds < 1000) return `${milliseconds}ms`
      return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)}秒`
    },
    formatMeasurementValues(values) {
      if (!values || typeof values !== 'object') return '-'
      const labels = {
        heartRate: '心率',
        hrv: 'HRV',
        spo2: '血氧',
        temperature: '温度'
      }
      const units = {
        heartRate: 'bpm',
        hrv: 'ms',
        spo2: '%',
        temperature: '℃'
      }
      const result = Object.keys(labels)
        .filter(key => values[key] !== null && values[key] !== undefined && values[key] !== '')
        .map(key => `${labels[key]} ${values[key]}${units[key]}`)
      return result.length ? result.join('，') : '-'
    },
    formatDetails(details) {
      if (!details) return '-'
      try {
        return JSON.stringify(details, null, 2)
      } catch (error) {
        return String(details)
      }
    },
    resetQuery() {
      this.daterangeRecordTime = []
      this.resetForm('queryForm')
      this.handleQuery()
    }
  }
}
</script>

<style scoped>
.anomaly-detail-title {
  margin-bottom: 8px;
  color: #303133;
  font-weight: 600;
}

.anomaly-detail {
  max-height: 360px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  color: #606266;
  background: #f7f8fa;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
