# 审核管理功能 - 前端变更文档

## 概述

在管理后台「系统管理」中添加「审核管理」菜单，用于：
1. 处理小程序端用户提交的AI实验室申请审核
2. 管理邀请码（批量添加、删除）
3. 审核时为每个用户配置个性化跳转地址

## 变更文件

### 新增/修改文件

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `znzh-frontend-admin/src/api/system/aiLab.js` | 修改 | 删除config接口，新增邀请码接口 |
| `znzh-frontend-admin/src/views/system/aiLab/index.vue` | 重写 | 审核列表 + 邀请码管理 |

## 数据库变更

> **注意**：以下SQL需要在数据库中执行

```sql
-- 1. 申请表新增字段
ALTER TABLE `ai_lab_apply` ADD COLUMN `jump_url` varchar(500) DEFAULT NULL COMMENT '个性化跳转地址' AFTER `remark`;
ALTER TABLE `ai_lab_apply` ADD COLUMN `invite_code_id` bigint DEFAULT NULL COMMENT '使用的邀请码ID' AFTER `jump_url`;

-- 2. 邀请码表
CREATE TABLE IF NOT EXISTS `ai_lab_invite_code` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(20) NOT NULL COMMENT '邀请码',
  `status` tinyint NOT NULL DEFAULT '0' COMMENT '状态: 0-未使用, 1-已使用',
  `used_user_id` bigint DEFAULT NULL COMMENT '使用者用户ID',
  `used_time` datetime DEFAULT NULL COMMENT '使用时间',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI实验室邀请码表';

-- 3. 菜单SQL
INSERT INTO `sys_menu` VALUES (1071, '审核管理', 1, 12, 'aiLab', 'system/aiLab/index', NULL, 'edit', 1, 1, 'C', '0', '0', '', 'edit', 'admin', '2026-04-21 21:30:00', 'admin', '2026-04-25 09:00:00', '');
```

## 菜单结构

```
系统管理
├── 用户管理
├── 角色管理
├── 菜单管理
├── 部门管理
├── 岗位管理
├── 字典管理
├── 字典类型
├── 参数配置
├── 通知公告
├── FQA管理
├── 协议管理
└── 审核管理  ← 新增 (menu_id: 1071)
```

## 功能说明

### Tab 1: 审核列表

- **搜索条件**：
  - 用户ID（精确查询）
  - 审核状态（待审核/已通过/已拒绝）
  - 申请时间（日期范围）

- **表格列**：编号、用户ID、昵称、手机号、跳转地址、申请时间、状态、审核时间、审核人、拒绝原因

- **操作**：
  - **通过**：弹出对话框填写该用户的个性化跳转地址（必填）
  - **拒绝**：弹出对话框填写拒绝原因（必填）
  - **详情**：查看完整申请信息

### Tab 2: 邀请码管理

- **功能**：
  - 批量添加邀请码（每行一个）
  - 随机生成邀请码（可指定数量1-100个，6位数字）
  - 删除邀请码
  - 查看邀请码使用状态

- **表格列**：编号、邀请码、状态、使用者ID、使用时间、创建时间

## 关联后端接口

| 接口 | 方法 | 说明 |
|-----|------|------|
| `/admin/aiLab/list` | GET | 获取申请列表（分页+条件） |
| `/admin/aiLab/{id}` | GET | 获取申请详情 |
| `/admin/aiLab/audit` | POST | 审核申请（通过时需填写jumpUrl） |
| `/admin/aiLab/inviteCode/list` | GET | 获取邀请码列表 |
| `/admin/aiLab/inviteCode/add` | POST | 批量添加邀请码 |
| `/admin/aiLab/inviteCode/generate` | POST | 随机生成邀请码（count参数，默认1，最大100） |
| `/admin/aiLab/inviteCode/{id}` | DELETE | 删除邀请码 |

## 部署步骤

1. **数据库执行SQL**
   - 执行上面的ALTER语句添加字段
   - 创建邀请码表
   - 执行菜单SQL

2. **重启前端服务**
   ```bash
   cd znzh-frontend-admin
   npm run dev
   ```

3. **登录后台刷新页面**，即可看到「审核管理」菜单

## 注意事项

1. 确保后端服务已实现 `/admin/aiLab/*` 接口
2. 确保数据库存在 `ai_lab_apply` 和 `ai_lab_invite_code` 表
3. 前端依赖 Element UI 组件库（已引入）
4. 审核通过时必须填写跳转地址（个性化配置）

## 相关文档

- 后端设计文档：`admin/docs/AI_LAB.md`
- 后端实现文档：`admin/docs/AI_LAB_ADMIN.md`
