<template>
  <div class="app-container">
    <el-form :model="queryParams" ref="queryForm" size="small" :inline="true" v-show="showSearch" label-width="68px">
      <el-form-item label="配置名称" prop="name">
        <el-input
          v-model="queryParams.name"
          placeholder="请输入配置名称"
          clearable
          @keyup.enter.native="handleQuery"
        />
      </el-form-item>
      <el-form-item label="参数键名" prop="keyName">
        <el-input
          v-model="queryParams.keyName"
          placeholder="请输入参数键名"
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

    <el-table v-loading="loading" :data="configurationList" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" align="center" />
      <el-table-column label="配置ID" align="center" prop="id" />
      <el-table-column label="配置名称" align="center" prop="name" />
      <el-table-column label="参数键名" align="center" prop="keyName" />
      <el-table-column label="参数类型" align="center" prop="type">
        <template slot-scope="scope">
          <span v-if="scope.row.type === 'INT'">数字</span>
          <span v-else-if="scope.row.type === 'STRING'">字符串</span>
          <span v-else-if="scope.row.type === 'RICH_TEXT'">富文本</span>
          <span v-else-if="scope.row.type === 'LIST'">集合</span>
          <span v-else-if="scope.row.type === 'JSON'">JSON对象</span>
          <span v-else-if="scope.row.type === 'IMG'">图片</span>
        </template>
      </el-table-column>
      <el-table-column label="配置值" align="center">
        <template slot-scope="scope">
          <el-button size="mini" type="text" icon="el-icon-view" @click="handleViewContent(scope.row)">查看内容</el-button>
        </template>
      </el-table-column>
      <!-- <el-table-column label="备注说明" align="center" prop="notes" /> -->
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
      <div v-html="textInfoData.value"></div>
      <div slot="footer" class="dialog-footer">
        <el-button @click="textCancel">关 闭</el-button>
      </div>
    </el-dialog>

    <!-- 添加或修改系统参数配置对话框 -->
    <el-dialog :title="title" :visible.sync="open" width="500px" append-to-body>
      <el-form ref="form" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="配置名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入配置名称" />
        </el-form-item>
        <el-form-item label="参数键名" prop="keyName">
          <el-input v-model="form.keyName" placeholder="请输入参数键名" />
        </el-form-item>
        <el-form-item label="参数类型" prop="type">
          <el-select v-model="form.type" placeholder="请选择参数类型">
            <el-option label="数字" value="INT" />
            <el-option label="字符串" value="STRING" />
            <el-option label="富文本" value="RICH_TEXT" />
            <el-option label="集合" value="LIST" />
            <el-option label="JSON对象" value="JSON" />
            <el-option label="图片" value="IMG" />
          </el-select>
        </el-form-item>
        <el-form-item label="配置值" prop="value" v-if="form.type === 'RICH_TEXT'">
          <editor v-model="form.value" height="192" placeholder="请输入内容" />
        </el-form-item>
        <el-form-item label="配置值" prop="value" v-else>
          <el-input v-model="form.value" type="textarea" placeholder="请输入内容" />
        </el-form-item>
        <el-form-item label="备注说明" prop="notes">
          <el-input v-model="form.notes" type="textarea" placeholder="请输入内容" />
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
import { listConfiguration, getConfiguration, delConfiguration, addConfiguration, updateConfiguration } from "@/api/system/configuration"

export default {
  name: "Configuration",
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
      // 系统参数配置表格数据
      configurationList: [],
      // 弹出层标题
      title: "",
      // 是否显示弹出层
      open: false,
      // 查看内容对话框
      textView: {
        title: "查看配置内容",
        open: false
      },
      // 查看内容数据
      textInfoData: {},
      // 查询参数
      queryParams: {
        pageNum: 1,
        pageSize: 10,
        name: null,
        keyName: null,
        value: null,
        type: null,
        notes: null,
      },
      // 表单参数
      form: {},
      // 表单校验
      rules: {
        name: [
          { required: true, message: "配置名称不能为空", trigger: "blur" }
        ],
        keyName: [
          { required: true, message: "参数键名不能为空", trigger: "blur" }
        ],
        value: [
          { required: true, message: "配置值不能为空", trigger: "blur" }
        ],
        type: [
          { required: true, message: "参数类型不能为空", trigger: "change" }
        ],
        notes: [
          { required: true, message: "备注说明不能为空", trigger: "blur" }
        ],
      }
    }
  },
  created() {
    this.getList()
  },
  methods: {
    /** 查询系统参数配置列表 */
    getList() {
      this.loading = true
      listConfiguration(this.queryParams).then(response => {
        this.configurationList = response.rows
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
        name: null,
        keyName: null,
        value: null,
        type: null,
        notes: null,
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
      this.title = "添加系统参数配置"
    },
    /** 修改按钮操作 */
    handleUpdate(row) {
      this.reset()
      const id = row.id || this.ids
      getConfiguration(id).then(response => {
        this.form = response.data
        this.open = true
        this.title = "修改系统参数配置"
      })
    },
    /** 提交按钮 */
    submitForm() {
      this.$refs["form"].validate(valid => {
        if (valid) {
          if (this.form.id != null) {
            updateConfiguration(this.form).then(response => {
              this.$modal.msgSuccess("修改成功")
              this.open = false
              this.getList()
            })
          } else {
            addConfiguration(this.form).then(response => {
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
      this.$modal.confirm('是否确认删除系统参数配置编号为"' + ids + '"的数据项？').then(function() {
        return delConfiguration(ids)
      }).then(() => {
        this.getList()
        this.$modal.msgSuccess("删除成功")
      }).catch(() => {})
    },
    /** 导出按钮操作 */
    handleExport() {
      this.download('/admin/sysConfiguration/export', {
        ...this.queryParams
      }, `configuration_${new Date().getTime()}.xlsx`)
    },
    /** 查看内容 */
    handleViewContent(row) {
      this.textInfoData = row
      this.textView.title = "查看配置内容 - " + row.name
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
