<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="手机号" prop="phone">
        <el-input
          v-model="queryParams.phone"
          placeholder="请输入用户手机号"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="昵称" prop="nickName">
        <el-input
          v-model="queryParams.nickName"
          placeholder="请输入昵称"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="状态" prop="status">
        <el-select v-model="queryParams.status" placeholder="用户状态" clearable style="width: 120px">
          <el-option label="启用" :value="0" />
          <el-option label="禁用" :value="1" />
        </el-select>
      </el-form-item>
      <el-form-item label="性别" prop="sex">
        <el-select v-model="queryParams.sex" placeholder="用户性别" clearable style="width: 120px">
          <el-option label="男" :value="0" />
          <el-option label="女" :value="1" />
          <el-option label="其他" :value="2" />
        </el-select>
      </el-form-item>
      <el-form-item label="生日">
        <el-date-picker
          v-model="daterangeBirthday"
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
      </el-col> -->
      <el-col :span="1.5">
        <el-button
          type="danger"
          plain
          icon="el-icon-delete"
          size="mini"
          :disabled="multiple"
          @click="handleDelete"
        >删除</el-button>
      </el-col>
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

    <el-table v-loading="loading" :data="userList" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" align="center" />
      <!-- <el-table-column label="用户编号" align="center" prop="id" /> -->
      <el-table-column label="用户唯一标识" align="center" prop="code" min-width="140"/>
      <el-table-column label="OpenID" align="center" prop="openId" min-width="140"/>
      <el-table-column label="手机号" align="center" prop="phone" min-width="110"/>
      <el-table-column label="头像" align="center" prop="avatar" width="100">
        <template slot-scope="scope">
          <image-preview :src="scope.row.avatar" :width="50" :height="50"/>
        </template>
      </el-table-column>
      <el-table-column label="昵称" align="center" prop="nickName" />
      <el-table-column label="生日" align="center" prop="birthday" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.birthday, '{y}-{m}-{d}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="性别" align="center" prop="sex" />
      <el-table-column label="身高" align="center" prop="height" />
      <el-table-column label="体重" align="center" prop="weight" />
      <el-table-column label="账号状态" align="center" prop="status">
        <template slot-scope="scope">
          <el-switch v-model="scope.row.status" :active-value="0" :inactive-value="1" @change="handleStatusChange(scope.row)"></el-switch>
        </template>
      </el-table-column>
      <el-table-column label="最后一次登录IP" align="center" prop="lastIp" min-width="130"/>
      <el-table-column label="最后一次登录时间" align="center" prop="lastLoginTime" min-width="130">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.lastLoginTime, '{y}-{m}-{d}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="注册时间" align="center" prop="registerTime" min-width="100">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.registerTime, '{y}-{m}-{d}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" class-name="small-padding fixed-width" width="300" fixed="right">
        <template slot-scope="scope">
          <!-- <el-button
            size="mini"
            type="text"
            icon="el-icon-edit"
            @click="handleUpdate(scope.row)"
          >修改</el-button> -->
          <el-button
            size="mini"
            type="text"
            icon="el-icon-view"
            @click="handleViewLatest(scope.row)"
          >查看最新数据</el-button>
          <el-button
            size="mini"
            type="text"
            icon="el-icon-view"
            @click="handleViewHistory(scope.row)"
          >查看历史数据</el-button>
          <el-button
            size="mini"
            type="text"
            icon="el-icon-delete"
          >删除</el-button>
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

    <!-- 添加或修改用户对话框 -->
    <!-- <el-dialog :title="title" :visible.sync="open" width="500px" append-to-body>
      <el-form ref="form" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="小程序openid" prop="openId">
          <el-input v-model="form.openId" placeholder="请输入小程序openid" />
        </el-form-item>
        <el-form-item label="用户手机" prop="phone">
          <el-input v-model="form.phone" placeholder="请输入用户手机" />
        </el-form-item>
        <el-form-item label="用户头像" prop="avatar">
          <image-upload v-model="form.avatar"/>
        </el-form-item>
        <el-form-item label="昵称" prop="nickName">
          <el-input v-model="form.nickName" placeholder="请输入昵称" />
        </el-form-item>
        <el-form-item label="生日" prop="birthday">
          <el-date-picker clearable
            v-model="form.birthday"
            type="date"
            value-format="yyyy-MM-dd"
            placeholder="请选择生日">
          </el-date-picker>
        </el-form-item>
        <el-form-item label="身高" prop="height">
          <el-input v-model="form.height" placeholder="请输入身高" />
        </el-form-item>
        <el-form-item label="体重" prop="weight">
          <el-input v-model="form.weight" placeholder="请输入体重" />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitForm">确 定</el-button>
        <el-button @click="cancel">取 消</el-button>
      </div>
    </el-dialog> -->

    <!-- 查看最新健康数据对话框 -->
    <el-dialog title="最新健康数据" :visible.sync="detailOpen" width="700px" append-to-body>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="统计日期">{{ parseTime(detailData.recordDate, '{y}-{m}-{d}') }}</el-descriptions-item>
        <el-descriptions-item label="健康评分">{{ detailData.healthScore }}</el-descriptions-item>
        <el-descriptions-item label="健康等级">{{ detailData.healthLevel }}</el-descriptions-item>
        <el-descriptions-item label=""></el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">运动数据</el-divider>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="总步数">{{ detailData.totalSteps }}</el-descriptions-item>
        <el-descriptions-item label="运动评分">{{ detailData.motionScore }}</el-descriptions-item>
        <el-descriptions-item label="总距离(km)">{{ detailData.totalDistance }}</el-descriptions-item>
        <el-descriptions-item label="总卡路里(kcal)">{{ detailData.totalCalorie }}</el-descriptions-item>
        <el-descriptions-item label="活动时长(分钟)">{{ detailData.activeTime }}</el-descriptions-item>
        <el-descriptions-item label=""></el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">心率数据</el-divider>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="平均心率(bpm)">{{ detailData.heartRateAvg }}</el-descriptions-item>
        <el-descriptions-item label="心率评分">{{ detailData.heartRateScore }}</el-descriptions-item>
        <el-descriptions-item label="最低心率(bpm)">{{ detailData.heartRateMin }}</el-descriptions-item>
        <el-descriptions-item label="最高心率(bpm)">{{ detailData.heartRateMax }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">HRV数据</el-divider>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="平均HRV(ms)">{{ detailData.hrvAvg }}</el-descriptions-item>
        <el-descriptions-item label="HRV评分">{{ detailData.hrvScore }}</el-descriptions-item>
        <el-descriptions-item label="最低HRV(ms)">{{ detailData.hrvMin }}</el-descriptions-item>
        <el-descriptions-item label="最高HRV(ms)">{{ detailData.hrvMax }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">血氧数据</el-divider>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="平均血氧(%)">{{ detailData.spo2Avg }}</el-descriptions-item>
        <el-descriptions-item label="血氧评分">{{ detailData.spo2Score }}</el-descriptions-item>
        <el-descriptions-item label="最低血氧(%)">{{ detailData.spo2Min }}</el-descriptions-item>
        <el-descriptions-item label="最高血氧(%)">{{ detailData.spo2Max }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">体温数据</el-divider>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="平均体温(℃)">{{ detailData.temperatureAvg }}</el-descriptions-item>
        <el-descriptions-item label="体温评分">{{ detailData.temperatureScore }}</el-descriptions-item>
        <el-descriptions-item label="最低体温(℃)">{{ detailData.temperatureMin }}</el-descriptions-item>
        <el-descriptions-item label="最高体温(℃)">{{ detailData.temperatureMax }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">压力数据</el-divider>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="平均压力指数">{{ detailData.stressAvg }}</el-descriptions-item>
        <el-descriptions-item label="压力评分">{{ detailData.stressScore }}</el-descriptions-item>
        <el-descriptions-item label="最低压力指数">{{ detailData.stressMin }}</el-descriptions-item>
        <el-descriptions-item label="最高压力指数">{{ detailData.stressMax }}</el-descriptions-item>
        <el-descriptions-item label="放松时长(分钟)">{{ detailData.stressRelaxedTime }}</el-descriptions-item>
        <el-descriptions-item label="正常时长(分钟)">{{ detailData.stressNormalTime }}</el-descriptions-item>
        <el-descriptions-item label="中度压力时长(分钟)">{{ detailData.stressMediumTime }}</el-descriptions-item>
        <el-descriptions-item label="高压时长(分钟)">{{ detailData.stressHighTime }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">睡眠数据</el-divider>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="总睡眠时长(分钟)">{{ detailData.sleepTotalTime }}</el-descriptions-item>
        <el-descriptions-item label="睡眠评分">{{ detailData.sleepScore }}</el-descriptions-item>
        <el-descriptions-item label="深睡时长(分钟)">{{ detailData.sleepDeepTime }}</el-descriptions-item>
        <el-descriptions-item label="浅睡时长(分钟)">{{ detailData.sleepLightTime }}</el-descriptions-item>
        <el-descriptions-item label="REM睡眠时长(分钟)">{{ detailData.sleepRemTime }}</el-descriptions-item>
        <el-descriptions-item label="清醒时长(分钟)">{{ detailData.sleepAwakeTime }}</el-descriptions-item>
        <el-descriptions-item label="觉醒次数">{{ detailData.sleepAwakeCount }}</el-descriptions-item>
        <el-descriptions-item label="睡眠效率(%)">{{ detailData.sleepEfficiency }}</el-descriptions-item>
        <el-descriptions-item label="入睡时间">{{ parseTime(detailData.sleepStartTime, '{y}-{m}-{d} {h}:{i}') }}</el-descriptions-item>
        <el-descriptions-item label="起床时间">{{ parseTime(detailData.sleepEndTime, '{y}-{m}-{d} {h}:{i}') }}</el-descriptions-item>
      </el-descriptions>

      <div slot="footer" class="dialog-footer">
        <el-button @click="detailOpen = false">关 闭</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { listUser, getUser, delUser, addUser, updateUser, changeUserStatus, getUserHealthData } from "@/api/user/user"

export default {
  name: "User",
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
      // 用户表格数据
      userList: [],
      // 弹出层标题
      title: "",
      // 是否显示弹出层
      open: false,
      // 是否显示详情对话框
      detailOpen: false,
      // 详情数据
      detailData: {},
      // 账号状态 0.启用 1.禁用时间范围
      daterangeBirthday: [],
      // 查询参数
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        phone: null,
        nickName: null,
        birthday: null,
        sex: null,
        status: null,
      },
      // 表单参数
      form: {},
      // 表单校验
      rules: {
        code: [
          { required: true, message: "用户唯一标识不能为空", trigger: "blur" }
        ],
        openId: [
          { required: true, message: "小程序openid不能为空", trigger: "blur" }
        ],
        phone: [
          { required: true, message: "用户手机不能为空", trigger: "blur" }
        ],
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    /** 查询用户列表 */
    getList() {
      this.loading = true
      this.queryParams.params = {}
      if (null != this.daterangeBirthday && '' != this.daterangeBirthday) {
        this.queryParams.birthdayRangeStart = this.daterangeBirthday[0]
        this.queryParams.birthdayRangeEnd = this.daterangeBirthday[1]
      }
      listUser(this.queryParams).then(response => {
        this.userList = response.rows
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
        code: null,
        openId: null,
        phone: null,
        avatar: null,
        nickName: null,
        birthday: null,
        sex: null,
        height: null,
        weight: null,
        status: null,
        lastIp: null,
        lastLoginTime: null,
        registerTime: null,
        delFlag: null,
        createTime: null,
        updateTime: null
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
      this.daterangeBirthday = []
      this.queryParams = {
        pageNum: 1,
        pageSize: 10,
        phone: null,
        nickName: null,
        birthday: null,
        sex: null,
        status: null,
        birthdayRangeStart: null,
        birthdayRangeEnd: null,
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
      this.title = "添加用户"
    },
    /** 修改按钮操作 */
    handleUpdate(row) {
      this.reset()
      const id = row.id || this.ids
      getUser(id).then(response => {
        this.form = response.data
        this.open = true
        this.title = "修改用户"
      })
    },
    /** 提交按钮 */
    submitForm() {
      this.$refs["form"].validate(valid => {
        if (valid) {
          if (this.form.id != null) {
            updateUser(this.form).then(response => {
              this.$modal.msgSuccess("修改成功")
              this.open = false
              this.getList()
            })
          } else {
            addUser(this.form).then(response => {
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
      this.$modal.confirm('是否确认删除用户编号为"' + ids + '"的数据项？').then(function() {
        return delUser(ids)
      }).then(() => {
        this.getList()
        this.$modal.msgSuccess("删除成功")
      }).catch(() => {})
    },
    /** 导出按钮操作 */
    handleExport() {
      this.download('/admin/user/export', {
        ...this.queryParams
      }, `user_${new Date().getTime()}.xlsx`)
    },
    /** 状态修改操作 */
    handleStatusChange(row) {
      let text = row.status === 0 ? "启用" : "停用"
      this.$modal.confirm('确认要"' + text + '""' + row.nickName + '"用户吗？').then(function() {
        return changeUserStatus(row.userId, row.status)
      }).then(() => {
        this.$modal.msgSuccess(text + "成功")
      }).catch(function() {
        row.status = row.status === 0 ? 1 : 0
      })
    },
    /** 查看历史数据 */
    handleViewHistory(row) {
      this.$router.push({
        path: '/user-all/healthData',
        query: { userId: row.id }
      })
    },
    /** 查看最新数据 */
    handleViewLatest(row) {
      getUserHealthData(row.id).then(response => {
        if (response.data) {
          this.detailData = response.data
          this.detailOpen = true
        } else {
          this.$modal.msgWarning("暂无数据")
        }
      })
    },
  }
}
</script>
