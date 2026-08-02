<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="用户ID" prop="userId">
        <el-input
          v-model="queryParams.userId"
          placeholder="请输入用户ID"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="统计日期">
        <el-date-picker
          v-model="daterangeRecordDate"
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

    <el-card class="repair-card" shadow="never">
      <div slot="header" class="repair-card-header">
        <span>按日期修复个人解析数据</span>
        <span class="repair-card-tip">基于 ring_history_raw_frame 原始帧重建 health_raw、sleep_record 和每日汇总</span>
      </div>
      <el-form :model="repairForm" size="small" :inline="true" label-width="72px">
        <el-form-item label="用户ID">
          <el-input
            v-model="repairForm.userId"
            placeholder="必填"
            clearable
            style="width: 120px"
          />
        </el-form-item>
        <el-form-item label="设备Mac">
          <el-input
            v-model="repairForm.deviceMac"
            placeholder="可不填，修复该用户当天全部设备"
            clearable
            style="width: 260px"
          />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="repairForm.date"
            type="date"
            value-format="yyyy-MM-dd"
            placeholder="选择日期"
            style="width: 150px"
          />
        </el-form-item>
        <el-form-item label="清理旧数据">
          <el-switch v-model="repairForm.clearExisting" />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            icon="el-icon-refresh"
            :loading="repairLoading"
            @click="handleRepairByForm"
          >执行修复</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-row :gutter="10" class="mb8">
      <!-- <el-col :span="1.5">
        <el-button
          type="primary"
          plain
          icon="el-icon-plus"
          size="mini"
          @click="handleAdd"
          v-hasPermi="['system:summary:add']"
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
          v-hasPermi="['system:summary:edit']"
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
          v-hasPermi="['system:summary:remove']"
        >删除</el-button>
      </el-col> -->
      <el-col :span="1.5">
        <el-button
          type="warning"
          plain
          icon="el-icon-download"
          size="mini"
          @click="handleExport"
          v-hasPermi="['system:summary:export']"
        >导出</el-button>
      </el-col>
      <right-toolbar :showSearch.sync="showSearch" @queryTable="getList"></right-toolbar>
    </el-row>

    <el-table v-loading="loading" :data="summaryList" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" align="center" />
      <!-- <el-table-column label="主键ID" align="center" prop="id" /> -->
      <!-- <el-table-column label="用户ID" align="center" prop="userId" /> -->
      <el-table-column label="统计日期" align="center" prop="recordDate" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.recordDate, '{y}-{m}-{d}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="总步数" align="center" prop="totalSteps" />
      <el-table-column label="总距离(km)" align="center" prop="totalDistance" />
      <el-table-column label="总卡路里(kcal)" align="center" prop="totalCalorie" />
      <el-table-column label="活动时长(分钟)" align="center" prop="activeTime" />
      <!-- <el-table-column label="运动评分(0-100)" align="center" prop="motionScore" /> -->
      <el-table-column label="平均心率(bpm)" align="center" prop="heartRateAvg" />
      <!-- <el-table-column label="最低心率(bpm)" align="center" prop="heartRateMin" /> -->
      <!-- <el-table-column label="最高心率(bpm)" align="center" prop="heartRateMax" /> -->
      <!-- <el-table-column label="心率评分(0-100)" align="center" prop="heartRateScore" /> -->
      <!-- <el-table-column label="平均HRV(ms)" align="center" prop="hrvAvg" /> -->
      <!-- <el-table-column label="最低HRV(ms)" align="center" prop="hrvMin" /> -->
      <!-- <el-table-column label="最高HRV(ms)" align="center" prop="hrvMax" /> -->
      <!-- <el-table-column label="HRV评分(0-100)" align="center" prop="hrvScore" /> -->
      <el-table-column label="平均血氧(%)" align="center" prop="spo2Avg" />
      <!-- <el-table-column label="最低血氧(%)" align="center" prop="spo2Min" /> -->
      <!-- <el-table-column label="最高血氧(%)" align="center" prop="spo2Max" /> -->
      <!-- <el-table-column label="血氧评分(0-100)" align="center" prop="spo2Score" /> -->
      <el-table-column label="平均体温(℃)" align="center" prop="temperatureAvg" />
      <!-- <el-table-column label="最低体温(℃)" align="center" prop="temperatureMin" /> -->
      <!-- <el-table-column label="最高体温(℃)" align="center" prop="temperatureMax" /> -->
      <!-- <el-table-column label="体温评分(0-100)" align="center" prop="temperatureScore" /> -->
      <el-table-column label="平均压力指数" align="center" prop="stressAvg" />
      <!-- <el-table-column label="最低压力指数" align="center" prop="stressMin" /> -->
      <!-- <el-table-column label="最高压力指数" align="center" prop="stressMax" /> -->
      <!-- <el-table-column label="放松时长(分钟)" align="center" prop="stressRelaxedTime" /> -->
      <!-- <el-table-column label="正常时长(分钟)" align="center" prop="stressNormalTime" /> -->
      <!-- <el-table-column label="中度压力时长(分钟)" align="center" prop="stressMediumTime" /> -->
      <!-- <el-table-column label="高压时长(分钟)" align="center" prop="stressHighTime" /> -->
      <!-- <el-table-column label="压力评分(0-100)" align="center" prop="stressScore" /> -->
      <el-table-column label="总睡眠时长(分钟)" align="center" prop="sleepTotalTime" />
      <!-- <el-table-column label="深睡时长(分钟)" align="center" prop="sleepDeepTime" /> -->
      <!-- <el-table-column label="浅睡时长(分钟)" align="center" prop="sleepLightTime" /> -->
      <!-- <el-table-column label="REM睡眠时长(分钟)" align="center" prop="sleepRemTime" /> -->
      <!-- <el-table-column label="清醒时长(分钟)" align="center" prop="sleepAwakeTime" /> -->
      <!-- <el-table-column label="觉醒次数" align="center" prop="sleepAwakeCount" /> -->
      <!-- <el-table-column label="入睡时间" align="center" prop="sleepStartTime" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.sleepStartTime, '{y}-{m}-{d}') }}</span>
        </template>
      </el-table-column> -->
      <!-- <el-table-column label="起床时间" align="center" prop="sleepEndTime" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.sleepEndTime, '{y}-{m}-{d}') }}</span>
        </template>
      </el-table-column> -->
      <!-- <el-table-column label="睡眠效率(%)" align="center" prop="sleepEfficiency" /> -->
      <!-- <el-table-column label="睡眠评分(0-100)" align="center" prop="sleepScore" /> -->
      <el-table-column label="健康评分" align="center" prop="healthScore" />
      <!-- <el-table-column label="健康等级(优秀/良好/一般/较差)" align="center" prop="healthLevel" /> -->
      <el-table-column label="操作" align="center" class-name="small-padding fixed-width" width="240">
        <template slot-scope="scope">
          <el-button
            size="mini"
            type="text"
            icon="el-icon-view"
            @click="handleViewDetail(scope.row)"
          >查看详情</el-button>
          <el-button
            size="mini"
            type="text"
            icon="el-icon-document"
            @click="handleViewRawFrames(scope.row)"
          >原始帧</el-button>
          <el-button
            size="mini"
            type="text"
            icon="el-icon-refresh"
            :disabled="repairLoading"
            @click="handleRepairByRow(scope.row)"
          >按日期修复</el-button>
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
    <el-dialog title="健康数据详情" :visible.sync="detailOpen" width="700px" append-to-body>
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

    <el-dialog title="设备原始帧" :visible.sync="rawFrameOpen" width="1100px" append-to-body>
      <el-alert
        title="这里展示的是 ring_history_raw_frame 中按 用户ID + 设备Mac + 日期窗口 关联保存的 BLE 原始帧；健康数据列表本身是每日汇总，不是原始数据。"
        type="info"
        :closable="false"
        show-icon
        class="raw-frame-tip"
      />
      <el-table v-loading="rawFrameLoading" :data="rawFrameList" border size="mini" style="width: 100%">
        <el-table-column label="用户ID" align="center" prop="userId" width="80" />
        <el-table-column label="用户唯一标识" align="center" prop="userCode" width="140" />
        <el-table-column label="昵称" align="center" prop="nickName" width="110" />
        <el-table-column label="手机号" align="center" prop="phone" width="120" />
        <el-table-column label="上传账号ID" align="center" prop="uploadUserId" width="95" />
        <el-table-column label="上传账号" align="center" prop="uploadNickName" width="110" />
        <el-table-column label="设备Mac" align="center" prop="deviceMac" width="150" />
        <el-table-column label="类型" align="center" prop="sourceType" width="150" />
        <el-table-column label="字节数" align="center" prop="rawByteLength" width="80" />
        <el-table-column label="帧开始时间" align="center" prop="recordTimeStart" width="160">
          <template slot-scope="scope">
            <span>{{ parseTime(scope.row.recordTimeStart, '{y}-{m}-{d} {h}:{i}:{s}') || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="帧结束时间" align="center" prop="recordTimeEnd" width="160">
          <template slot-scope="scope">
            <span>{{ parseTime(scope.row.recordTimeEnd, '{y}-{m}-{d} {h}:{i}:{s}') || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="接收时间" align="center" prop="receivedAt" width="160">
          <template slot-scope="scope">
            <span>{{ parseTime(scope.row.receivedAt, '{y}-{m}-{d} {h}:{i}:{s}') || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="保存次数" align="center" prop="seenCount" width="80" />
        <el-table-column label="解析状态" align="center" prop="parseStatus" width="90" />
        <el-table-column label="解析条数" align="center" prop="parsedRecordCount" width="90" />
        <el-table-column label="raw_hex 预览" align="left" prop="rawHexPreview" min-width="260" show-overflow-tooltip />
      </el-table>
      <pagination
        v-show="rawFrameTotal>0"
        :total="rawFrameTotal"
        :page.sync="rawFrameQuery.pageNum"
        :limit.sync="rawFrameQuery.pageSize"
        @pagination="getRawFrameList"
      />
      <div slot="footer" class="dialog-footer">
        <el-button @click="rawFrameOpen = false">关 闭</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { getUserHealthDataHistory, getUserHealthRawFrames, repairUserHealthRawByDate } from "@/api/user/user"

export default {
  name: "HealthData",
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
      // 用户每日健康数据统计表格数据
      summaryList: [],
      // 弹出层标题
      title: "",
      // 是否显示弹出层
      open: false,
      // 是否显示详情对话框
      detailOpen: false,
      // 详情数据
      detailData: {},
      rawFrameOpen: false,
      rawFrameLoading: false,
      rawFrameList: [],
      rawFrameTotal: 0,
      rawFrameQuery: {
        pageNum: 1,
        pageSize: 10,
        userId: null,
        deviceMac: null,
        recordDate: null
      },
      repairLoading: false,
      repairForm: {
        userId: null,
        deviceMac: '',
        date: '',
        clearExisting: true
      },
      // 健康等级(优秀/良好/一般/较差)时间范围
      daterangeRecordDate: [],
      // 查询参数
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        userId: null,
        startDate: null,
        endDate: null
      }
    }
  },
  created() {
    // 获取路由传递的用户ID
    if (this.$route.query.userId) {
      this.queryParams.userId = this.$route.query.userId
      this.repairForm.userId = this.$route.query.userId
    }
    this.getList()
  },
  methods: {
    /** 查询用户每日健康数据统计列表 */
    getList() {
      this.loading = true
      this.queryParams.params = {}
      if (null != this.daterangeRecordDate && '' != this.daterangeRecordDate) {
        this.queryParams.startDate = this.daterangeRecordDate[0]
        this.queryParams.endDate = this.daterangeRecordDate[1]
      }
      getUserHealthDataHistory(this.queryParams).then(response => {
        this.summaryList = response.rows
        this.total = response.total
        this.loading = false
      })
    },
    /** 搜索按钮操作 */
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    /** 重置按钮操作 */
    resetQuery() {
      this.daterangeRecordDate = []
      this.queryParams.startDate = null
      this.queryParams.endDate = null
      this.resetForm("queryForm")
      this.handleQuery()
    },
    // 多选框选中数据
    handleSelectionChange(selection) {
      this.ids = selection.map(item => item.id)
      this.single = selection.length!==1
      this.multiple = !selection.length
    },
    /** 导出按钮操作 */
    handleExport() {
      this.download('/admin/user/healthData/export', {
        ...this.queryParams
      }, `summary_${new Date().getTime()}.xlsx`)
    },
    /** 查看详情 */
    handleViewDetail(row) {
      this.detailData = row
      this.detailOpen = true
    },
    handleViewRawFrames(row) {
      const userId = row && (row.userId || row.user_id)
      const deviceMac = row && (row.deviceMac || row.device_mac)
      const recordDate = this.formatRepairRecordDate(row)
      if (!userId || !deviceMac || !recordDate) {
        this.$message.warning('缺少用户、设备或日期，无法查询原始帧')
        return
      }
      this.rawFrameQuery = {
        pageNum: 1,
        pageSize: 10,
        userId,
        deviceMac,
        recordDate
      }
      this.rawFrameOpen = true
      this.getRawFrameList()
    },
    getRawFrameList() {
      this.rawFrameLoading = true
      getUserHealthRawFrames(this.rawFrameQuery).then(response => {
        this.rawFrameList = response.rows || []
        this.rawFrameTotal = response.total || 0
      }).finally(() => {
        this.rawFrameLoading = false
      })
    },
    formatRepairRecordDate(row) {
      const value = row && row.recordDate
      if (!value) return ''
      if (typeof value === 'string') return value.slice(0, 10)
      const parsed = this.parseTime(value, '{y}-{m}-{d}')
      return parsed || ''
    },
    formatRepairResultMessage(response) {
      const result = response && response.data ? response.data : {}
      const msg = response && response.msg ? response.msg : ''
      if (!result || !Object.keys(result).length) return msg || '原始数据重新解析完成'
      const frameCount = Number(result.frameCount || 0)
      const parsedPointCount = Number(result.parsedPointCount || 0)
      const sleepSegmentCount = Number(result.sleepSegmentCount || 0)
      const inputCount = Number(result.inputCount || 0)
      const deviceCount = Number(result.deviceCount || 0)
      const successCount = Number(result.successCount || (result.success ? 1 : 0))
      const scopeText = deviceCount > 0 ? `设备 ${successCount}/${deviceCount} 个` : `设备 ${result.deviceMac || '-'}`
      return `${msg || '原始数据重新解析完成'}：${scopeText}，原始帧 ${frameCount}，解析点 ${parsedPointCount}，睡眠段 ${sleepSegmentCount}，写入输入 ${inputCount}`
    },
    repairRawByDate(payload) {
      const userId = payload && payload.userId
      const recordDate = payload && payload.date
      if (!userId || !recordDate) {
        this.$message.warning('缺少用户ID或日期，无法重新解析')
        return Promise.resolve(false)
      }
      const deviceText = payload.deviceMac ? `设备 ${payload.deviceMac}` : '该用户当天全部设备'
      return this.$confirm(`确定按 ${recordDate} 修复用户 ${userId} 的解析数据吗？范围：${deviceText}。会先清理该日期相关解析数据后重建。`, '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }).then(() => {
        this.repairLoading = true
        this.loading = true
        return repairUserHealthRawByDate({
          userId,
          deviceMac: payload.deviceMac || '',
          date: recordDate,
          clearExisting: payload.clearExisting !== false
        })
      }).then((response) => {
        this.$message.success(this.formatRepairResultMessage(response))
        this.getList()
        if (this.rawFrameOpen) {
          this.getRawFrameList()
        }
        return true
      }).catch(() => false).finally(() => {
        this.repairLoading = false
        this.loading = false
      })
    },
    handleRepairByForm() {
      const payload = {
        userId: this.repairForm.userId,
        deviceMac: this.repairForm.deviceMac,
        date: this.repairForm.date,
        clearExisting: this.repairForm.clearExisting
      }
      this.repairRawByDate(payload)
    },
    handleRepairByRow(row) {
      const userId = row && (row.userId || row.user_id)
      const deviceMac = row && (row.deviceMac || row.device_mac)
      const recordDate = this.formatRepairRecordDate(row)
      if (!userId || !recordDate) {
        this.$message.warning('缺少用户或日期，无法重新解析')
        return
      }
      this.repairForm.userId = userId
      this.repairForm.deviceMac = deviceMac || ''
      this.repairForm.date = recordDate
      this.repairRawByDate({
        userId,
        deviceMac,
        date: recordDate,
        clearExisting: true
      })
    }
  }
}
</script>

<style scoped>
.repair-card {
  margin-bottom: 12px;
}

.repair-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.repair-card-tip {
  color: #909399;
  font-size: 12px;
  font-weight: normal;
}

.raw-frame-tip {
  margin-bottom: 12px;
}
</style>
