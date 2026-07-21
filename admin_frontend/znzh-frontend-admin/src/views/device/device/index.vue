<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="设备名称" prop="deviceName">
        <el-input
          v-model="queryParams.deviceName"
          placeholder="请输入设备名称"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="MAC地址" prop="mac">
        <el-input
          v-model.trim="queryParams.mac"
          placeholder="请输入MAC地址"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="在线状态" prop="online">
        <el-select v-model="queryParams.online" placeholder="在线状态" clearable>
          <el-option label="离线" value="0" />
          <el-option label="在线" value="1" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" icon="el-icon-search" size="mini" @click="handleQuery">搜索</el-button>
        <el-button icon="el-icon-refresh" size="mini" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-row :gutter="10" class="mb8">
      <el-col :span="1.5">
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
      </el-col>
      <el-col :span="1.5">
                <el-button type="info" plain icon="el-icon-upload2" size="mini" @click="handleImport">导入</el-button>
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

    <el-table v-loading="loading" :data="deviceList" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" align="center" />
      <el-table-column label="设备编号" align="center" prop="id" />
      <!-- 如果未绑定用户，则显示未绑定 -->
      <!--<el-table-column label="绑定用户编号" align="center" prop="userId" width="120">-->
      <!--  <template slot-scope="scope">-->
      <!--    <span v-if="scope.row.userId">{{ scope.row.userId }}</span>-->
      <!--    <span v-else>未绑定</span>-->
      <!--  </template>-->
      <!--</el-table-column>-->
      <el-table-column label="设备型号" align="center" prop="modelKey" min-width="150" />
      <el-table-column label="设备名称" align="center" prop="deviceName" min-width="150" />
      <el-table-column label="设备大小" align="center" prop="deviceSize" min-width="150" />
      <el-table-column label="固件版本" align="center" prop="firmwareVersion" min-width="100" />
      <el-table-column label="硬件版本" align="center" prop="hardwareVersion" />
      <el-table-column label="序列号" align="center" prop="sn" min-width="180" />
      <el-table-column label="MAC地址" align="center" prop="mac" min-width="140" />
      <el-table-column label="二维码" align="center" prop="qrcodeUrl" min-width="180">
        <template slot-scope="scope">
          <el-image
            style="width: 80px; height: 80px"
            :src="baseApi + scope.row.qrcodeUrl"
            :preview-src-list="[baseApi + scope.row.qrcodeUrl]"
            fit="contain"
            :lazy="true"
          />
        </template>
      </el-table-column>
      <el-table-column label="在线状态" align="center" prop="online" />
      <el-table-column prop="online" label="状态" width="80">
        <template slot-scope="scope">
          <el-tag type="danger" v-if="scope.row.online === 0">离线</el-tag>
          <el-tag type="success" v-if="scope.row.online === 1">在线</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="设备电量" align="center" prop="battery" />
      <el-table-column label="最后同步地址" align="center" prop="lastSyncAddress" min-width="100"/>
      <el-table-column label="最后同步时间" align="center" prop="lastSyncTime" width="180">
        <template slot-scope="scope">
          <span>{{ parseTime(scope.row.lastSyncTime, '{y}-{m}-{d}') }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" class-name="small-padding fixed-width" fixed="right" width="200">
        <template slot-scope="scope">
          <el-button
            size="mini"
            type="text"
            icon="el-icon-edit"
            @click="handleUpdate(scope.row)"
          >修改</el-button>
          <el-button
            size="mini"
            type="text"
            icon="el-icon-delete"
            @click="handleDelete(scope.row)"
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

    <!-- 添加或修改设备对话框 -->
    <el-dialog :title="title" :visible.sync="open" width="500px" append-to-body>
      <el-form ref="form" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="型号">
          <el-select v-model="form.modelId" placeholder="请选择型号">
            <el-option v-for="item in modelOptions" :key="item.id" :label="item.modelKey" :value="item.id">
<!--              <span style="float: left">{{ item.modelName }}</span>
              <span style="float: right;font-size: 13px;">
                ( {{ item.modelKey }})
              </span>-->
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="设备名称" prop="deviceName">
          <el-input v-model="form.deviceName" placeholder="请输入设备名称" />
        </el-form-item>
        <el-form-item label="设备大小" prop="deviceSize">
          <el-input v-model="form.deviceSize" placeholder="请输入设备大小" />
        </el-form-item>
        <el-form-item label="固件版本" prop="firmwareVersion">
          <el-input v-model="form.firmwareVersion" placeholder="请输入固件版本" />
        </el-form-item>
        <el-form-item label="硬件版本" prop="hardwareVersion">
          <el-input v-model="form.hardwareVersion" placeholder="请输入硬件版本" />
        </el-form-item>
        <el-form-item label="MAC地址" prop="mac">
          <el-input v-model="form.mac" placeholder="请输入MAC地址" />
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitForm">确 定</el-button>
        <el-button @click="cancel">取 消</el-button>
      </div>
    </el-dialog>

    <!-- 设备导入对话框 -->
    <el-dialog :title="upload.title" :visible.sync="upload.open" width="400px" append-to-body>
      <el-upload ref="upload" :limit="1" accept=".xlsx" :headers="upload.headers" :action="upload.url + '?updateSupport=' + upload.updateSupport" :disabled="upload.isUploading" :on-progress="handleFileUploadProgress" :on-success="handleFileSuccess" :auto-upload="false" drag>
        <i class="el-icon-upload"></i>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <div class="el-upload__tip text-center" slot="tip">
          <div class="el-upload__tip" slot="tip">
            <el-checkbox v-model="upload.updateSupport" />是否更新已经存在的用户数据
          </div>
          <span>仅允许导入xls、xlsx格式文件。</span>
          <el-link type="primary" :underline="false" style="font-size: 12px; vertical-align: baseline" @click="importTemplate">下载模板</el-link>
        </div>
      </el-upload>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitFileForm">确 定</el-button>
        <el-button @click="upload.open = false">取 消</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { listDevice, getDevice, delDevice, addDevice, updateDevice } from "@/api/device/device"
import { getModelOptions } from "@/api/device/model"
import { getToken } from '@/utils/auth'

export default {
  name: "Device",
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
      // 设备表格数据
      deviceList: [],
      // 弹出层标题
      title: "",
      // 是否显示弹出层
      open: false,
      // 设备型号下拉选项
      modelOptions: [],
      // 用户导入参数
      upload: {
        // 是否显示弹出层（用户导入）
        open: false,
        // 弹出层标题（用户导入）
        title: "",
        // 是否禁用上传
        isUploading: false,
        // 是否更新已经存在的用户数据
        updateSupport: 0,
        // 设置上传的请求头部
        headers: { Authorization: "Bearer " + getToken() },
        // 上传的地址
        url: process.env.VUE_APP_BASE_API + "/admin/device/importData"
      },
      baseApi: process.env.VUE_APP_BASE_API,
      // 查询参数
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        deviceName: null,
        mac: null,
        online: null,
      },
      // 表单参数
      form: {},
      // 表单校验
      rules: {
        mac: [
          { required: true, message: "MAC地址不能为空", trigger: "blur" }
        ],
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    /** 查询设备列表 */
    getList() {
      this.loading = true
      listDevice(this.queryParams).then(response => {
        this.deviceList = response.rows
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
        modelId: null,
        deviceName: null,
        deviceSize: null,
        firmwareVersion: null,
        hardwareVersion: null,
        mac: null,
        online: null,
        battery: null,
        lastSyncAddress: null,
        lastSyncTime: null,
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
      getModelOptions().then(response => {
        this.modelOptions = response.data
      })
      this.title = "添加设备"
    },
    /** 修改按钮操作 */
    handleUpdate(row) {
      this.reset()
      const id = row.id || this.ids
      getModelOptions().then(response => {
        this.modelOptions = response.data
      })
      getDevice(id).then(response => {
        this.form = response.data
        this.open = true
        this.title = "修改设备"
      })
    },
    /** 提交按钮 */
    submitForm() {
      this.$refs["form"].validate(valid => {
        if (valid) {
          if (this.form.id != null) {
            updateDevice(this.form).then(response => {
              this.$modal.msgSuccess("修改成功")
              this.open = false
              this.getList()
            })
          } else {
            addDevice(this.form).then(response => {
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
      this.$modal.confirm('是否确认删除设备编号为"' + ids + '"的数据项？').then(function() {
        return delDevice(ids)
      }).then(() => {
        this.getList()
        this.$modal.msgSuccess("删除成功")
      }).catch(() => {})
    },
    /** 导出按钮操作 */
    handleExport() {
      this.download('/admin/device/export', {
        ...this.queryParams
      }, `device_${new Date().getTime()}.xlsx`)
    },
    /** 导入按钮操作 */
    handleImport() {
      this.upload.title = "设备导入"
      this.upload.open = true
    },
    /** 下载模板操作 */
    importTemplate() {
      this.download('/admin/device/importTemplate', {
      }, `device_template_${new Date().getTime()}.xlsx`)
    },
    // 文件上传中处理
    handleFileUploadProgress(event, file, fileList) {
      this.upload.isUploading = true
    },
    // 文件上传成功处理
    handleFileSuccess(response, file, fileList) {
      this.upload.open = false
      this.upload.isUploading = false
      this.$refs.upload.clearFiles()
      this.$alert("<div style='overflow: auto;overflow-x: hidden;max-height: 70vh;padding: 10px 20px 0;'>" + response.msg + "</div>", "导入结果", { dangerouslyUseHTMLString: true })
      this.getList()
    },
    // 提交上传文件
    submitFileForm() {
      const file = this.$refs.upload.uploadFiles
      if (!file || file.length === 0 || !file[0].name.toLowerCase().endsWith('.xlsx')) {
        this.$modal.msgError("请选择后缀为 “xls”或“xlsx”的文件。")
        return
      }
      this.$refs.upload.submit()
    }
  }
}
</script>
