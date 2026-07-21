<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="用户名称" prop="nickname">
        <el-input
          v-model="queryParams.nickname"
          placeholder="请输入用户名称"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="操作类型" prop="operation">
        <el-select
          v-model="queryParams.operation"
          placeholder="请选择操作类型"
          clearable
        >
          <el-option label="登录操作" :value="0" />
          <el-option label="绑定操作" :value="1" />
          <el-option label="解绑操作" :value="2" />
          <el-option label="修改信息" :value="3" />
          <el-option label="同步数据" :value="4" />
        </el-select>
      </el-form-item>
      <el-form-item label="设备MAC" prop="deviceMac" label-width="80px">
        <el-input
          v-model="queryParams.deviceMac"
          placeholder="请输入设备MAC地址"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="日志时间">
        <el-date-picker
          v-model="daterangeLogTime"
          style="width: 240px"
          value-format="yyyy-MM-dd"
          type="daterange"
          range-separator="-"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        ></el-date-picker>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <!-- <el-col :span="1.5">
        <el-button
          type="primary"
          plain
          icon="el-icon-plus"
          size="mini"
          @click="handleAdd"
        >新增</el-button>
      </el-col>
      <el-col :span="1.5">
        <el-button
          type="success"
          plain
          icon="el-icon-edit"
          size="mini"
          :disabled="single"
          @click="handleUpdate"
        >修改</el-button>
      </el-col>
      <el-col :span="1.5">
        <el-button
          type="danger"
          plain
          icon="el-icon-delete"
          size="mini"
          :disabled="multiple"
          @click="handleDelete"
        >删除</el-button>
      </el-col> -->
      <el-col :span="1.5">
        <el-button
          type="warning"
          plain
          icon="el-icon-download"
          size="mini"
          @click="handleExport"
        >导出</el-button>
      </el-col>
      <right-toolbar :showSearch.sync="showSearch" @queryTable="getList"></right-toolbar>
    </el-row>

    <el-table v-loading="loading" :data="logList" @selection-change="handleSelectionChange">
      <!-- <el-table-column type="selection" width="55" align="center" /> -->
      <el-table-column label="用户编号" align="center" prop="userId" />
      <el-table-column label="用户名称" align="center" prop="nickname" />
      <el-table-column label="操作类型" align="center" prop="operation">
        <template slot-scope="scope">
          <span v-if="scope.row.operation === 0">登录操作</span>
          <span v-else-if="scope.row.operation === 1">绑定操作</span>
          <span v-else-if="scope.row.operation === 2">解绑操作</span>
          <span v-else-if="scope.row.operation === 3">修改信息</span>
          <span v-else-if="scope.row.operation === 4">同步数据</span>
        </template>
      </el-table-column>
      <el-table-column label="IP地址" align="center" prop="ipAddr" min-width="110" />
      <el-table-column label="地址" align="center" prop="location" />
      <el-table-column label="日志时间" align="center" prop="logTime" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.logTime, '{y}-{m}-{d} {h}:{i}:{s}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" class-name="small-padding fixed-width" width="100">
        <template slot-scope="scope">
          <el-button
            size="mini"
            type="text"
            icon="el-icon-view"
            @click="handleViewDetail(scope.row)"
          >查看详情</el-button>
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

    <!-- 查看详情对话框 -->
    <el-dialog title="日志详情" :visible.sync="detailOpen" width="600px" append-to-body>
      <el-descriptions :column="1" border label-class-name="log-detail-label">
        <el-descriptions-item label="用户编号">{{ detailData.userId }}</el-descriptions-item>
        <el-descriptions-item label="用户名称">{{ detailData.nickname }}</el-descriptions-item>
        <el-descriptions-item label="操作类型">
          <span v-if="detailData.operation === 0">登录操作</span>
          <span v-else-if="detailData.operation === 1">绑定操作</span>
          <span v-else-if="detailData.operation === 2">解绑操作</span>
          <span v-else-if="detailData.operation === 3">修改信息</span>
          <span v-else-if="detailData.operation === 4">同步数据</span>
        </el-descriptions-item>
        <el-descriptions-item label="IP地址">{{ detailData.ipAddr }}</el-descriptions-item>
        <el-descriptions-item label="实际地址">{{ detailData.location }}</el-descriptions-item>
        <el-descriptions-item label="设备MAC地址" v-if="detailData.deviceMac">{{ detailData.deviceMac }}</el-descriptions-item>
        <el-descriptions-item label="日志时间">{{ parseTime(detailData.logTime, '{y}-{m}-{d} {h}:{i}:{s}') }}</el-descriptions-item>
        <el-descriptions-item label="日志信息">{{ detailData.logMsg }}</el-descriptions-item>
      </el-descriptions>
      <div slot="footer" class="dialog-footer">
        <el-button @click="detailOpen = false">关 闭</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { listLog, getLog, delLog, addLog, updateLog } from "@/api/user/log"

export default {
  name: "Log",
  data() {
    return {
      // 遮罩层
      loading: true,
      // 选中数组
      ids: [],
      // 非单个禁用
      single: true,
      // 非多个禁用
      multiple: true,
      // 显示搜索条件
      showSearch: true,
      // 总条数
      total: 0,
      // 用户日志 表格数据
      logList: [],
      // 弹出层标题
      title: "",
      // 是否显示弹出层
      open: false,
      // 是否显示详情对话框
      detailOpen: false,
      // 详情数据
      detailData: {},
      // 删除标志(0.存在 2.删除)时间范围
      daterangeLogTime: [],
      // 查询参数
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        userId: null,
        nickname: null,
        operation: null,
        ipAddr: null,
        location: null,
        deviceMac: null,
        logMsg: null,
        logTime: null,
      },
      // 表单参数
      form: {},
      // 表单校验
      rules: {
        nickname: [
          { required: true, message: "用户名不能为空", trigger: "blur" }
        ],
        operation: [
          { required: true, message: "操作类型不能为空", trigger: "change" }
        ],
        ipAddr: [
          { required: true, message: "IP地址不能为空", trigger: "blur" }
        ],
        location: [
          { required: true, message: "地址不能为空", trigger: "blur" }
        ],
        logTime: [
          { required: true, message: "日志时间不能为空", trigger: "blur" }
        ],
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    /** 查询用户日志 列表 */
    getList() {
      this.loading = true
      this.queryParams.params = {}
      if (null != this.daterangeLogTime && '' != this.daterangeLogTime) {
        this.queryParams.logTimeRangeStart = this.daterangeLogTime[0]
        this.queryParams.logTimeRangeEnd = this.daterangeLogTime[1]
      }
      listLog(this.queryParams).then(response => {
        this.logList = response.rows
        this.total = response.total
        this.loading = false
      })
    },
    // 取消按钮
    cancel() {
      this.open = false
      this.reset()
    },
    // 表单重置
    reset() {
      this.form = {
        id: null,
        userId: null,
        nickname: null,
        operation: null,
        ipAddr: null,
        location: null,
        deviceMac: null,
        logMsg: null,
        logTime: null,
        delFlag: null
      }
      this.resetForm("form")
    },
    /** 搜索按钮操作 */
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    /** 重置按钮操作 */
    resetQuery() {
      this.daterangeLogTime = []
      this.queryParams = {
        pageNum: 1,
        pageSize: 10,
        userId: null,
        nickname: null,
        operation: null,
        ipAddr: null,
        location: null,
        deviceMac: null,
        logMsg: null,
        logTime: null,
        logTimeRangeStart: null,
        logTimeRangeEnd: null,
      }
      this.resetForm("queryForm")
      this.handleQuery()
    },
    // 多选框选中数据
    handleSelectionChange(selection) {
      this.ids = selection.map(item => item.id)
      this.single = selection.length!==1
      this.multiple = !selection.length
    },
    /** 新增按钮操作 */
    handleAdd() {
      this.reset()
      this.open = true
      this.title = "添加用户日志 "
    },
    /** 修改按钮操作 */
    handleUpdate(row) {
      this.reset()
      const id = row.id || this.ids
      getLog(id).then(response => {
        this.form = response.data
        this.open = true
        this.title = "修改用户日志 "
      })
    },
    /** 提交按钮 */
    submitForm() {
      this.$refs["form"].validate(valid => {
        if (valid) {
          if (this.form.id != null) {
            updateLog(this.form).then(response => {
              this.$modal.msgSuccess("修改成功")
              this.open = false
              this.getList()
            })
          } else {
            addLog(this.form).then(response => {
              this.$modal.msgSuccess("新增成功")
              this.open = false
              this.getList()
            })
          }
        }
      })
    },
    /** 删除按钮操作 */
    handleDelete(row) {
      const ids = row.id || this.ids
      this.$modal.confirm('是否确认删除用户日志 编号为"' + ids + '"的数据项？').then(function() {
        return delLog(ids)
      }).then(() => {
        this.getList()
        this.$modal.msgSuccess("删除成功")
      }).catch(() => {})
    },
    /** 导出按钮操作 */
    handleExport() {
      this.download('/admin/user/log/export', {
        ...this.queryParams
      }, `log_${new Date().getTime()}.xlsx`)
    },
    /** 查看详情 */
    handleViewDetail(row) {
      this.detailData = row
      this.detailOpen = true
    }
  }
}
</script>

<style scoped>
::v-deep .el-descriptions-item__label.log-detail-label {
  width: 90px !important;
  min-width: 90px !important;
  white-space: nowrap;
}
</style>
