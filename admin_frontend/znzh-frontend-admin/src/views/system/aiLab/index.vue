<template>
  <div class="app-container">
    <el-tabs v-model="activeName" type="border-card">
      <!-- 审核列表 -->
      <el-tab-pane label="审核列表" name="list">
        <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="90px">
          <el-form-item label="用户ID" prop="userId">
            <el-input
              v-model="queryParams.userId"
              placeholder="请输入用户ID"
              clearable
              @keyup.enter.native="handleQuery"
            />
          </el-form-item>
          <el-form-item label="审核状态" prop="status">
            <el-select v-model="queryParams.status" placeholder="请选择状态" clearable>
              <el-option label="待审核" :value="0" />
              <el-option label="已通过" :value="1" />
              <el-option label="已拒绝" :value="2" />
            </el-select>
          </el-form-item>
          <el-form-item label="申请时间">
            <el-date-picker
              v-model="dateRange"
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

        <el-table v-loading="loading" :data="applyList">
          <el-table-column label="编号" align="center" prop="id" width="80" />
          <el-table-column label="用户ID" align="center" prop="userId" width="100" />
          <el-table-column label="用户昵称" align="center" prop="nickName" />
          <el-table-column label="手机号" align="center" prop="phone" />
          <el-table-column label="跳转地址" align="center" prop="jumpUrl" show-overflow-tooltip />
          <el-table-column label="申请时间" align="center" prop="applyTime" width="160" />
          <el-table-column label="状态" align="center" prop="status" width="100">
            <template slot-scope="scope">
              <el-tag v-if="scope.row.status === 0" type="warning">待审核</el-tag>
              <el-tag v-else-if="scope.row.status === 1" type="success">已通过</el-tag>
              <el-tag v-else-if="scope.row.status === 2" type="danger">已拒绝</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审核时间" align="center" prop="auditTime" width="160" />
          <el-table-column label="审核人" align="center" prop="auditByName" />
          <el-table-column label="拒绝原因" align="center" prop="remark" show-overflow-tooltip />
          <el-table-column label="操作" align="center" width="150" fixed="right">
            <template slot-scope="scope">
              <el-button
                v-if="scope.row.status === 0"
                size="mini"
                type="text"
                icon="el-icon-check"
                @click="handleAudit(scope.row, 1)"
              >通过</el-button>
              <el-button
                v-if="scope.row.status === 0"
                size="mini"
                type="text"
                icon="el-icon-close"
                class="delete-btn"
                @click="handleAudit(scope.row, 2)"
              >拒绝</el-button>
              <el-button
                size="mini"
                type="text"
                icon="el-icon-view"
                @click="handleView(scope.row)"
              >详情</el-button>
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
      </el-tab-pane>

      <!-- 邀请码管理 -->
      <el-tab-pane label="邀请码管理" name="inviteCode">
        <el-form :model="inviteCodeQueryParams" ref="inviteCodeQueryForm" size="small" :inline="true" v-show="showSearch" label-width="90px">
          <el-form-item>
            <el-button type="primary" icon="el-icon-plus" size="mini" @click="handleAddInviteCode">添加邀请码</el-button>
            <el-button type="success" icon="el-icon-refresh" size="mini" @click="handleGenerateInviteCode">随机生成</el-button>
          </el-form-item>
        </el-form>

        <el-table v-loading="inviteCodeLoading" :data="inviteCodeList">
          <el-table-column label="编号" align="center" prop="id" width="80" />
          <el-table-column label="邀请码" align="center" prop="code" />
          <el-table-column label="跳转地址" align="center" prop="jumpUrl" show-overflow-tooltip />
          <el-table-column label="状态" align="center" prop="status" width="100">
            <template slot-scope="scope">
              <el-tag v-if="scope.row.status === 0" type="success">未使用</el-tag>
              <el-tag v-else-if="scope.row.status === 1" type="info">已使用</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="使用者ID" align="center" prop="usedUserId" />
          <el-table-column label="使用时间" align="center" prop="usedTime" width="160" />
          <el-table-column label="创建时间" align="center" prop="createTime" width="160" />
          <el-table-column label="操作" align="center" width="100" fixed="right">
            <template slot-scope="scope">
              <el-button
                size="mini"
                type="text"
                icon="el-icon-delete"
                class="delete-btn"
                @click="handleDeleteInviteCode(scope.row)"
              >删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <pagination
          v-show="inviteCodeTotal > 0"
          :total="inviteCodeTotal"
          :page.sync="inviteCodeQueryParams.pageNum"
          :limit.sync="inviteCodeQueryParams.pageSize"
          @pagination="getInviteCodeList"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 审核通过对话框 - 填写跳转地址 -->
    <el-dialog title="审核通过" :visible.sync="approveDialogVisible" width="500px" append-to-body>
      <el-form ref="approveForm" :model="approveForm" :rules="approveRules" label-width="100px">
        <el-form-item label="跳转地址" prop="jumpUrl">
          <el-input v-model="approveForm.jumpUrl" placeholder="请输入该用户的个性化跳转地址" />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitApprove">确 定</el-button>
        <el-button @click="cancelApprove">取 消</el-button>
      </div>
    </el-dialog>

    <!-- 审核拒绝对话框 -->
    <el-dialog title="拒绝原因" :visible.sync="rejectDialogVisible" width="500px" append-to-body>
      <el-form ref="rejectForm" :model="rejectForm" :rules="rejectRules" label-width="100px">
        <el-form-item label="拒绝原因" prop="remark">
          <el-input v-model="rejectForm.remark" type="textarea" placeholder="请输入拒绝原因" />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitReject">确 定</el-button>
        <el-button @click="cancelReject">取 消</el-button>
      </div>
    </el-dialog>

    <!-- 添加邀请码对话框 -->
    <el-dialog title="添加邀请码" :visible.sync="addInviteCodeDialogVisible" width="500px" append-to-body>
      <el-form ref="addInviteCodeForm" :model="addInviteCodeForm" :rules="addInviteCodeRules" label-width="100px">
        <el-form-item label="跳转地址" prop="jumpUrl">
          <el-input v-model="addInviteCodeForm.jumpUrl" placeholder="请输入邀请码跳转地址" />
        </el-form-item>
        <el-form-item label="邀请码" prop="codes">
          <el-input
            v-model="addInviteCodeForm.codes"
            type="textarea"
            :rows="5"
            placeholder="请输入邀请码，每行一个"
          />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitAddInviteCode">确 定</el-button>
        <el-button @click="cancelAddInviteCode">取 消</el-button>
      </div>
    </el-dialog>

    <!-- 随机生成邀请码对话框 -->
    <el-dialog title="随机生成邀请码" :visible.sync="generateInviteCodeDialogVisible" width="500px" append-to-body>
      <el-form ref="generateForm" :model="generateForm" :rules="generateRules" label-width="100px">
        <el-form-item label="跳转地址" prop="jumpUrl">
          <el-input v-model="generateForm.jumpUrl" placeholder="请输入邀请码跳转地址" />
        </el-form-item>
        <el-form-item label="生成数量" prop="count">
          <el-input-number v-model="generateForm.count" :min="1" :max="100" />
          <span style="margin-left: 10px; color: #909399;">个 (6位数字)</span>
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitGenerateInviteCode" :loading="generateLoading">确 定</el-button>
        <el-button @click="generateInviteCodeDialogVisible = false">取 消</el-button>
      </div>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog title="申请详情" :visible.sync="detailDialogVisible" width="600px" append-to-body>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="编号">{{ detailData.id }}</el-descriptions-item>
        <el-descriptions-item label="用户ID">{{ detailData.userId }}</el-descriptions-item>
        <el-descriptions-item label="用户昵称">{{ detailData.nickName }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ detailData.phone }}</el-descriptions-item>
        <el-descriptions-item label="头像">
          <img v-if="detailData.avatar" :src="detailData.avatar" style="width: 50px; height: 50px;" />
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag v-if="detailData.status === 0" type="warning">待审核</el-tag>
          <el-tag v-else-if="detailData.status === 1" type="success">已通过</el-tag>
          <el-tag v-else-if="detailData.status === 2" type="danger">已拒绝</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="跳转地址" :span="2">{{ detailData.jumpUrl || '-' }}</el-descriptions-item>
        <el-descriptions-item label="申请时间">{{ detailData.applyTime }}</el-descriptions-item>
        <el-descriptions-item label="审核时间">{{ detailData.auditTime }}</el-descriptions-item>
        <el-descriptions-item label="审核人">{{ detailData.auditByName }}</el-descriptions-item>
        <el-descriptions-item label="拒绝原因">{{ detailData.remark || '-' }}</el-descriptions-item>
      </el-descriptions>
      <div slot="footer" class="dialog-footer">
        <el-button @click="detailDialogVisible = false">关 闭</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { listAiLab, getAiLab, auditAiLab, listInviteCode, addInviteCode, deleteInviteCode, generateInviteCode } from "@/api/system/aiLab"

export default {
  name: "AiLab",
  data() {
    return {
      activeName: 'list',
      loading: true,
      showSearch: true,
      total: 0,
      applyList: [],
      dateRange: [],
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        userId: null,
        status: null,
        applyTimeStart: null,
        applyTimeEnd: null
      },
      // 邀请码管理
      inviteCodeLoading: false,
      inviteCodeTotal: 0,
      inviteCodeList: [],
      inviteCodeQueryParams: {
        pageNum: 1,
        pageSize: 10
      },
      // 审核通过
      approveDialogVisible: false,
      approveForm: {
        id: null,
        jumpUrl: ''
      },
      approveRules: {
        jumpUrl: [
          { required: true, message: "跳转地址不能为空", trigger: "blur" }
        ]
      },
      // 审核拒绝
      rejectDialogVisible: false,
      rejectForm: {
        id: null,
        remark: ''
      },
      rejectRules: {
        remark: [
          { required: true, message: "请输入拒绝原因", trigger: "blur" }
        ]
      },
      currentAuditRow: null,
      // 添加邀请码
      addInviteCodeDialogVisible: false,
      addInviteCodeForm: {
        codes: '',
        jumpUrl: ''
      },
      addInviteCodeRules: {
        jumpUrl: [
          { required: true, message: "请输入跳转地址", trigger: "blur" }
        ],
        codes: [
          { required: true, message: "请输入邀请码", trigger: "blur" }
        ]
      },
      // 随机生成邀请码
      generateInviteCodeDialogVisible: false,
      generateForm: {
        count: 1,
        jumpUrl: ''
      },
      generateRules: {
        jumpUrl: [
          { required: true, message: "请输入跳转地址", trigger: "blur" }
        ],
        count: [
          { required: true, message: "请输入生成数量", trigger: "change" }
        ]
      },
      generateLoading: false,
      // 详情
      detailDialogVisible: false,
      detailData: {}
    }
  },
  created() {
    this.getList()
    this.getInviteCodeList()
  },
  methods: {
    // ==================== 审核列表 ====================
    getList() {
      this.loading = true
      if (this.dateRange && this.dateRange.length === 2) {
        this.queryParams.applyTimeStart = this.dateRange[0]
        this.queryParams.applyTimeEnd = this.dateRange[1]
      } else {
        this.queryParams.applyTimeStart = null
        this.queryParams.applyTimeEnd = null
      }
      listAiLab(this.queryParams).then(response => {
        this.applyList = response.rows
        this.total = response.total
        this.loading = false
      })
    },
    handleQuery() {
      this.queryParams.pageNum = 1
      this.getList()
    },
    resetQuery() {
      this.dateRange = []
      this.queryParams = {
        pageNum: 1,
        pageSize: 10,
        userId: null,
        status: null
      }
      this.getList()
    },
    handleAudit(row, status) {
      this.currentAuditRow = row
      if (status === 1) {
        // 通过 - 弹出填写跳转地址
        this.approveForm = { id: row.id, jumpUrl: row.jumpUrl || '' }
        this.approveDialogVisible = true
      } else {
        // 拒绝
        this.rejectForm = { id: row.id, remark: '' }
        this.rejectDialogVisible = true
      }
    },
    submitApprove() {
      this.$refs.approveForm.validate(valid => {
        if (valid) {
          auditAiLab({
            id: this.approveForm.id,
            status: 1,
            jumpUrl: this.approveForm.jumpUrl,
            remark: ''
          }).then(() => {
            this.$message.success("审核通过")
            this.approveDialogVisible = false
            this.getList()
          })
        }
      })
    },
    cancelApprove() {
      this.approveDialogVisible = false
      this.approveForm = { id: null, jumpUrl: '' }
    },
    submitReject() {
      this.$refs.rejectForm.validate(valid => {
        if (valid) {
          auditAiLab({
            id: this.rejectForm.id,
            status: 2,
            remark: this.rejectForm.remark
          }).then(() => {
            this.$message.success("已拒绝")
            this.rejectDialogVisible = false
            this.getList()
          })
        }
      })
    },
    cancelReject() {
      this.rejectDialogVisible = false
      this.rejectForm = { id: null, remark: '' }
    },
    handleView(row) {
      getAiLab(row.id).then(response => {
        this.detailData = response.data
        this.detailDialogVisible = true
      })
    },
    // ==================== 邀请码管理 ====================
    getInviteCodeList() {
      this.inviteCodeLoading = true
      listInviteCode(this.inviteCodeQueryParams).then(response => {
        this.inviteCodeList = response.rows
        this.inviteCodeTotal = response.total
        this.inviteCodeLoading = false
      })
    },
    handleAddInviteCode() {
      this.addInviteCodeForm = { codes: '', jumpUrl: '' }
      this.addInviteCodeDialogVisible = true
    },
    submitAddInviteCode() {
      this.$refs.addInviteCodeForm.validate(valid => {
        if (valid) {
          // 将文本按行分割成数组
          const codes = this.addInviteCodeForm.codes.split('\n')
            .map(c => c.trim())
            .filter(c => c.length > 0)
          addInviteCode({
            codes,
            jumpUrl: this.addInviteCodeForm.jumpUrl
          }).then(() => {
            this.$message.success("添加成功")
            this.addInviteCodeDialogVisible = false
            this.getInviteCodeList()
          })
        }
      })
    },
    cancelAddInviteCode() {
      this.addInviteCodeDialogVisible = false
      this.addInviteCodeForm = { codes: '', jumpUrl: '' }
    },
    handleGenerateInviteCode() {
      this.generateForm = { count: 1, jumpUrl: '' }
      this.generateInviteCodeDialogVisible = true
    },
    submitGenerateInviteCode() {
      this.$refs.generateForm.validate(valid => {
        if (valid) {
          this.generateLoading = true
          generateInviteCode({
            count: this.generateForm.count,
            jumpUrl: this.generateForm.jumpUrl
          }).then(() => {
            this.$message.success("生成成功")
            this.generateInviteCodeDialogVisible = false
            this.getInviteCodeList()
          }).finally(() => {
            this.generateLoading = false
          })
        }
      })
    },
    handleDeleteInviteCode(row) {
      this.$confirm('确认删除该邀请码吗？', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }).then(() => {
        deleteInviteCode(row.id).then(() => {
          this.$message.success("删除成功")
          this.getInviteCodeList()
        })
      })
    }
  }
}
</script>

<style scoped>
.delete-btn {
  color: #F56C6C;
}
</style>
