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

    <el-table v-loading="loading" :data="batteryLogList">
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
import { getUserBatteryLogList } from '@/api/user/user'

export default {
  name: 'UserBatteryLog',
  data() {
    return {
      loading: false,
      showSearch: true,
      total: 0,
      batteryLogList: [],
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
      getUserBatteryLogList(params)
        .then(response => {
          this.batteryLogList = response.rows || []
          this.total = response.total || 0
        })
        .finally(() => {
          this.loading = false
        })
    },
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    resetQuery() {
      this.daterangeRecordTime = []
      this.resetForm('queryForm')
      this.handleQuery()
    }
  }
}
</script>
