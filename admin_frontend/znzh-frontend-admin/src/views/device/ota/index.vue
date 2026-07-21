<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="版本号" prop="versionCode">
        <el-input
          v-model="queryParams.versionCode"
          placeholder="请输入版本号"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="适配设备型号" prop="deviceModel" label-width="100px">
        <el-input
          v-model="queryParams.deviceModel"
          placeholder="请输入适配设备型号"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="强制更新" prop="forceUpdate">
        <el-select v-model="queryParams.forceUpdate" placeholder="请选择是否强制更新" clearable>
          <el-option label="否" value="0" />
          <el-option label="是" value="1" />
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
      <right-toolbar :showSearch.sync="showSearch" @queryTable="getList"></right-toolbar>
    </el-row>

    <el-table v-loading="loading" :data="packageList" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" align="center" />
      <el-table-column label="版本号" align="center" prop="versionCode" />
      <el-table-column label="适配设备型号" align="center" prop="deviceModel" />
      <el-table-column label="更新文案" align="center">
        <template slot-scope="scope">
          <el-button size="mini" type="text" icon="el-icon-view" @click="handleViewContent(scope.row)">查看内容</el-button>
        </template>
      </el-table-column>
      <el-table-column label="是否强制更新" align="center" prop="forceUpdate">
        <template slot-scope="scope">
          <el-tag type="success" v-if="scope.row.forceUpdate === 1">是</el-tag>
          <el-tag type="info" v-if="scope.row.forceUpdate === 0">否</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="固件" align="center" prop="fileUrl">
        <template slot-scope="scope">
          <el-link :href="scope.row.fileUrl" :underline="false" target="_blank">
            <span class="el-icon-document"> {{ getFileName(scope.row.fileUrl) }} </span>
          </el-link>
        </template>
      </el-table-column>
      <el-table-column label="固件大小" align="center" prop="fileSize">
        <template slot-scope="scope">
          <span v-if="scope.row.fileSize >= 1048576">{{ (scope.row.fileSize / 1048576).toFixed(2) }} MB</span>
          <span v-else-if="scope.row.fileSize >= 1024">{{ (scope.row.fileSize / 1024).toFixed(2) }} KB</span>
          <span v-else>{{ scope.row.fileSize }} B</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" align="center" class-name="small-padding fixed-width">
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

    <el-dialog :title="textView.title" :visible.sync="textView.open" width="680px" append-to-body>
      <div v-html="textInfoData.description"></div>
      <div slot="footer" class="dialog-footer">
        <el-button @click="textCancel">关 闭</el-button>
      </div>
    </el-dialog>

    <!-- 添加或修改OTA固件版本 对话框 -->
    <el-dialog :title="title" :visible.sync="open" width="700px" append-to-body>
      <el-form ref="form" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="版本号" prop="versionCode">
          <el-input v-model="form.versionCode" placeholder="请输入版本号" style="width: 200px" />
        </el-form-item>
        <el-form-item label="型号" prop="deviceModel">
          <el-select v-model="form.deviceModel" placeholder="请选择型号" style="width: 200px">
            <el-option v-for="item in modelOptions" :key="item.id" :label="item.modelKey" :value="item.modelKey" />
          </el-select>
        </el-form-item>
        <el-form-item label="固件包" prop="fileUrl">
          <file-upload v-model="form.fileUrl" :fileType="['hex', 'bin', 'hex16']" action="/admin/device/ota/upload" :fileSize="10" :limit="1"/>
          <div class="el-upload__tip">只能上传 hex16/hex/bin 文件，且不超过 10MB</div>
        </el-form-item>
        <el-form-item label="更新文案">
          <editor v-model="form.description" :min-height="192"/>
        </el-form-item>
        <el-form-item label="是否强制更新" prop="forceUpdate">
          <el-radio-group v-model="form.forceUpdate">
            <el-radio :label="0">否</el-radio>
            <el-radio :label="1">是</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button type="primary" @click="submitForm">确 定</el-button>
        <el-button @click="cancel">取 消</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import { listPackage, getPackage, delPackage, addPackage, updatePackage } from "@/api/device/ota"
import { getModelOptions } from "@/api/device/model"

export default {
  name: "OtaPackage",
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
      // OTA固件版本 表格数据
      packageList: [],
      // 弹出层标题
      title: "",
      // 是否显示弹出层
      open: false,
      // 查看内容对话框
      textView: {
        title: "查看更新文案",
        open: false
      },
      // 查看内容数据
      textInfoData: {},
      // 设备型号下拉选项
      modelOptions: [],
      // 查询参数
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        versionCode: null,
        deviceModel: null,
        forceUpdate: null,
      },
      // 表单参数
      form: {},
      // 表单校验
      rules: {
        versionCode: [
          { required: true, message: "版本号不能为空", trigger: "blur" }
        ],
        deviceModel: [
          { required: true, message: "适配设备型号不能为空", trigger: "blur" }
        ],
        fileUrl: [
          { required: true, message: "固件包下载地址(.hex/.bin)不能为空", trigger: "blur" }
        ],
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    /** 查询OTA固件版本 列表 */
    getList() {
      this.loading = true
      listPackage(this.queryParams).then(response => {
        this.packageList = response.rows
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
        versionCode: null,
        deviceModel: null,
        fileUrl: null,
        fileSize: null,
        description: null,
        forceUpdate: null,
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
      getModelOptions().then(response => {
        this.modelOptions = response.data
      })
      this.open = true
      this.title = "添加OTA固件版本 "
    },
    /** 修改按钮操作 */
    handleUpdate(row) {
      this.reset()
      getModelOptions().then(response => {
        this.modelOptions = response.data
      })
      const id = row.id || this.ids
      getPackage(id).then(response => {
        this.form = response.data
        this.open = true
        this.title = "修改OTA固件版本 "
      })
    },
    /** 提交按钮 */
    submitForm() {
      this.$refs["form"].validate(valid => {
        if (valid) {
          if (this.form.id != null) {
            updatePackage(this.form).then(response => {
              this.$modal.msgSuccess("修改成功")
              this.open = false
              this.getList()
            })
          } else {
            addPackage(this.form).then(response => {
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
      this.$modal.confirm('是否确认删除OTA固件版本 编号为"' + ids + '"的数据项？').then(function() {
        return delPackage(ids)
      }).then(() => {
        this.getList()
        this.$modal.msgSuccess("删除成功")
      }).catch(() => {})
    },
    /** 导出按钮操作 */
    handleExport() {
      this.download('/admin/device/ota/export', {
        ...this.queryParams
      }, `package_${new Date().getTime()}.xlsx`)
    },
    // 获取文件名
    getFileName(fileUrl) {
      if (!fileUrl) {
        return ''
      }
      if (fileUrl.lastIndexOf("/") > -1) {
        return fileUrl.slice(fileUrl.lastIndexOf("/") + 1)
      } else {
        return fileUrl
      }
    },
    /** 查看内容 */
    handleViewContent(row) {
      this.textInfoData = row
      this.textView.title = "查看更新文案 - v" + row.versionCode
      this.textView.open = true
    },
    /** 关闭查看内容对话框 */
    textCancel() {
      this.textView.open = false
      this.textInfoData = {}
    }
  }
}
</script>
