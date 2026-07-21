# 亲情共享与长辈守护重新设计方案

## 1. 设计结论

亲情共享不应只做成“子女账号里的一组家人卡片”，而应设计成“老人健康数据所有权 + 家庭授权关系 + 设备归属 + 长辈友好 UI + AI 照护建议”的完整闭环。

本方案合并两部分优点：

- 保留现有实现的最小可用闭环：子女添加家人、代绑定设备、设备数据写入老人数据账号、子女查看 dashboard、权限关闭后数据不可访问。
- 吸收新版文档的长期模型：`family_relation` 作为共享关系主表，引入邀请、待认领老人档案、设备绑定日志、后台治理和隐私审计。

推荐采用“两层设计”：

- 一期产品层：继续兼容当前 `memberId` 页面和接口，快速让小程序可用。
- 长期数据层：逐步切换到 `relationId`，把亲情共享从“家人成员”升级为“授权关系”。

## 2. 核心目标

### 对老人

- 不改变老人原来的主要使用路径：佩戴设备、打开小程序、同步数据、查看自己的健康状态。
- 提供“长辈模式”：大字体、少按钮、强提示，一屏看懂今天状态。
- 清楚知道谁正在查看自己的健康数据，并可随时暂停或取消共享。
- 不给老人制造复杂绑定流程，允许子女先完成设备准备。

### 对子女

- 可以先添加父母/家人，再代绑定设备。
- 可以查看父母的健康概览、关键指标、设备电量、最近同步时间、异常提醒和 AI 今日摘要。
- 可以接收“未同步、低电量、异常指标”等照护提示。
- 只拥有查看授权，不拥有老人健康数据。

### 对平台和运营

- 共享关系可审计、可停用、可追溯。
- 设备归属变更有日志。
- 健康数据不复制，降低数据一致性和隐私风险。
- 后续可扩展家庭群组、健康周报、异常事件中心和后台人工协助。

## 3. 产品形态

### 3.1 子女先绑定设备给老人

适合设备由子女购买、配置，老人只负责佩戴。

流程：

1. 子女登录小程序。
2. 进入“我的 -> 家人守护”。
3. 添加老人，可选择手机号搜索、微信邀请、手动创建老人档案。
4. 为该老人绑定设备。
5. 老人佩戴设备并打开小程序同步。
6. 子女在“家人健康”查看老人数据。

设计规则：

- 老人已有账号时，设备和健康数据归属老人 `app_user.id`。
- 老人没有账号时，一期可创建影子数据账号保证数据闭环；二期升级为 `elder_profile` 待认领档案。
- 子女只通过共享关系读取老人数据，不直接拥有设备数据。

### 3.2 老人自己绑定设备并共享给子女

适合老人已有账号并能完成基础操作。

流程：

1. 老人登录并绑定设备。
2. 老人在“共享管理”生成邀请码/二维码，或填写子女手机号发起邀请。
3. 子女登录后接受邀请。
4. 老人确认授权范围。
5. 子女查看授权范围内的数据。

设计规则：

- 老人是授权发起方。
- 子女接受后关系才生效。
- 老人可随时暂停、取消或调整授权。

### 3.3 长辈模式

长辈模式不是独立账号，也不是另一个小程序，而是当前小程序内的一种首页视图。

首屏只保留：

- 今日健康状态。
- 同步设备数据按钮。
- 心率、血氧、体温、睡眠、步数、电量。
- 最近同步时间。
- “我的家人正在查看这些数据”入口。

页面原则：

- 字号更大，按钮更大，入口更少。
- 避免复杂图表和专业术语。
- 每个指标给一句可理解解释，例如“心率正常”“血氧偏低，建议休息后复测”。
- 所有异常提示只做健康提醒，不做医疗诊断。

## 4. 信息架构

### 子女端

- 家人守护首页
- 添加家人
- 绑定设备
- 家人健康详情
- 指标详情
- 共享权限设置
- 邀请处理

### 老人端

- 长辈模式首页
- 我的设备
- 共享管理
- 谁在查看我的数据
- 邀请家人

### 管理后台

新增菜单：`亲情共享`

子菜单：

- 共享关系列表
- 邀请记录
- 老人档案/待认领档案
- 设备归属变更记录
- 异常授权处理

## 5. 数据模型设计

### 5.1 一期兼容模型

当前已实现并可继续使用：

- `family_member`：子女侧的家人成员/父母档案。
- `family_member_device`：家人与设备绑定关系。
- `family_health_alert`：家庭健康提醒。

一期保留这些表，保证现有小程序页面和接口稳定。

### 5.2 长期标准模型

后续建议新增并逐步迁移到以下模型。

#### `family_relation`

共享关系主表，用来表达“谁可以看谁的数据”。

关键字段：

- `id`
- `elder_user_id`
- `elder_profile_id`
- `guardian_user_id`
- `relation_type`
- `display_name`
- `permission_scope`
- `status`
- `source`
- `last_view_time`
- `create_time`
- `update_time`
- `del_flag`

状态建议：

- `0` 待确认
- `1` 生效
- `2` 已暂停
- `3` 已取消
- `4` 已拒绝

#### `elder_profile`

待认领老人档案，用于“子女先创建、老人后登录认领”。

关键字段：

- `id`
- `creator_user_id`
- `real_user_id`
- `name`
- `phone`
- `sex`
- `birthday`
- `height`
- `weight`
- `claim_status`

#### `family_invite`

邀请记录，用于二维码、邀请码、手机号邀请。

关键字段：

- `invite_code`
- `inviter_user_id`
- `invitee_user_id`
- `elder_user_id`
- `elder_profile_id`
- `invite_type`
- `status`
- `expire_time`
- `accept_time`

#### `device_bind_log`

设备绑定/解绑/迁移日志。

关键字段：

- `device_id`
- `device_mac`
- `device_sn`
- `old_user_id`
- `new_user_id`
- `operator_user_id`
- `operator_type`
- `action`
- `reason`
- `create_time`

### 5.3 迁移关系

当前 `family_member.id` 可作为一期页面的 `memberId`。

长期切换时：

- `family_member.owner_user_id` 对应 `family_relation.guardian_user_id`。
- `family_member.data_user_id` 对应 `family_relation.elder_user_id`。
- `family_member.name` 对应 `family_relation.display_name`。
- `family_member.permissions` 对应 `family_relation.permission_scope`。
- `family_member_device` 迁移为设备当前归属 + `device_bind_log`。

## 6. 权限设计

### 基本原则

- 健康数据归老人所有。
- 子女读取数据必须有有效共享关系。
- 每次读取都要校验关系状态和权限范围。
- 子女不能通过传 `userId` 越权读取老人数据。
- 取消共享后，不再返回老人历史和最新数据。

### 一期权限

一期界面保持简单，只展示一个主开关：

- 允许家人查看健康数据

后端内部仍保留细分权限：

- `vitalSigns`
- `sleep`
- `motion`
- `alerts`
- `aiSummary`
- `deviceStatus`

### 二期权限

升级为更细粒度：

- `overview`
- `heart_rate`
- `spo2`
- `temperature`
- `sleep`
- `motion`
- `stress`
- `device_status`

## 7. 接口设计

### 7.1 兼容当前接口

继续保留：

- `GET /app/family/member/list`
- `POST /app/family/member/add`
- `GET /app/family/member/detail`
- `POST /app/family/member/remove`
- `POST /app/family/device/bind`
- `POST /app/family/share/updatePermissions`
- `GET /app/family/health/dashboard`
- `GET /app/family/data/vitalSign`
- `GET /app/family/data/sleep/sleepOverview`
- `GET /app/family/data/motion/motionOverview`
- `GET /app/family/alert/list`
- `GET /app/family/ai/dailySummary`

这些接口用于支撑当前小程序页面，短期不破坏。

### 7.2 新版 REST 接口

新增更清晰的 relation 体系接口：

- `GET /app/family/home`
- `GET /app/family/elders`
- `POST /app/family/elder-profile`
- `GET /app/family/users/search`
- `POST /app/family/invite`
- `POST /app/family/invite/{inviteCode}/accept`
- `POST /app/family/invite/{inviteCode}/reject`
- `GET /app/family/elders/{relationId}/health/overview`
- `GET /app/family/elders/{relationId}/health/heart-rate`
- `GET /app/family/elders/{relationId}/health/spo2`
- `GET /app/family/elders/{relationId}/health/temperature`
- `GET /app/family/elders/{relationId}/health/sleep`
- `GET /app/family/elders/{relationId}/health/motion`
- `POST /app/family/elders/{relationId}/devices/bind`
- `GET /app/family/guardians`
- `PUT /app/family/relations/{relationId}`
- `DELETE /app/family/relations/{relationId}`

### 7.3 兼容策略

前端一期继续用 `memberId`。

后端响应中逐步增加：

```json
{
  "memberId": 1,
  "relationId": 10
}
```

当新版页面完成后，前端再切换到 `relationId`。

## 8. 页面重新设计

### 8.1 家人守护首页

定位：子女每天打开后快速知道父母是否正常。

页面结构：

- 顶部标题：家人守护
- 顶部摘要：今日有几位家人已同步、几位需关注
- 家人卡片列表
- 添加家人按钮

家人卡片字段：

- 称呼和关系
- 今日状态：正常、需关注、未同步
- 最近同步时间
- 设备电量
- 关键指标摘要：心率、血氧、睡眠、步数
- AI 一句话摘要

交互：

- 点击卡片进入家人详情。
- 卡片右侧显示状态颜色，不用复杂装饰。
- 未同步时优先提示“请提醒家人打开小程序同步”。

### 8.2 家人健康详情

定位：子女查看某位老人的完整健康情况。

页面结构：

- 家人信息区：头像、称呼、设备在线、电量、最近同步。
- 今日健康概览：正常/需关注/未同步。
- AI 今日摘要：一句结论 + 2 到 3 条建议。
- 指标卡片：心率、血氧、体温、睡眠、步数。
- 异常提醒列表。
- 底部操作：绑定设备、共享权限、查看趋势。

设计重点：

- 不直接堆数字，要给解释。
- 趋势放二级，不挤占首屏。
- 异常指标要显示“建议复测/休息/充电/联系家人”，避免医疗诊断。

### 8.3 添加家人页

保留三个入口：

- 手机号搜索已有账号。
- 微信/二维码邀请。
- 先创建老人档案。

一期默认路径：

- 手动创建老人档案最快可用。

二期增强：

- 手机号搜索脱敏展示。
- 邀请码 7 天有效。
- 老人登录后可认领档案。

### 8.4 绑定设备页

流程：

1. 选择家人。
2. 扫码或蓝牙搜索设备。
3. 确认设备信息。
4. 绑定成功。
5. 展示佩戴说明。

关键规则：

- 设备已绑定他人时，不静默覆盖。
- 需要提示当前设备会作为该家人的健康数据来源。
- 成功后写入设备绑定日志。

### 8.5 长辈模式首页

定位：老人自己看得懂、用得动。

首屏布局：

- 大按钮：同步设备数据
- 今日状态：今天已同步/还未同步/需要关注
- 大卡片：心率、血氧、体温、睡眠、步数、电量
- 家人共享提示：家人正在查看这些数据

文案示例：

- “今天已同步，家人可以看到你的健康数据。”
- “设备电量较低，请及时充电。”
- “血氧偏低，建议休息 5 分钟后重新测量。”

### 8.6 老人共享管理页

页面内容：

- 谁正在查看我的数据。
- 每个家人的授权状态。
- 暂停共享。
- 取消共享。
- 添加家人。

设计重点：

- 文案要降低老人疑虑，例如“你可以随时关闭共享”。
- 取消共享前二次确认。

## 9. AI 赋能设计

AI 不做诊断，只做健康数据解释、趋势总结和照护建议。

### 子女端 AI

能力：

- 今日健康摘要。
- 异常原因提示。
- 低电量/未同步提醒话术。
- 周报/月报。
- 照护优先级排序。

示例：

```text
爸爸今天数据整体平稳，上午心率略高但已恢复。昨晚睡眠时长偏短，建议今晚提前休息。
```

### 老人端 AI

能力：

- 把指标解释成简单语言。
- 给出非医疗建议。
- 提醒同步和充电。

示例：

```text
今天状态不错，设备电量还够用。记得晚上睡前打开小程序同步一次。
```

### 后台 AI

能力：

- 异常共享关系识别。
- 设备长期未同步人群筛选。
- 高风险异常事件聚合。
- 用户反馈自动分类。

## 10. 安全与隐私

- 手机号搜索必须脱敏。
- 邀请码随机生成，不使用连续 ID。
- 邀请码默认 7 天过期。
- 每次访问老人数据都校验关系状态。
- 取消共享后，子女不能继续读取历史数据。
- 后台停用共享关系要记录操作人和原因。
- 健康提醒必须避免诊断性表述。

## 11. 开发分期

### 一期：可上线 MVP

目标：当前小程序能完成家人守护闭环。

后端：

- 保留并完善 `family_member`、`family_member_device`、`family_health_alert`。
- 保证 `/app/family/member/list` 等当前接口稳定。
- 数据同步按设备 MAC 写入老人数据账号。
- dashboard 支持设备状态、健康摘要、异常提醒、AI 摘要。
- 权限关闭后接口和 dashboard 同步生效。

小程序：

- 家人守护首页。
- 添加家人。
- 绑定设备。
- 家人健康详情。
- 共享权限。
- 长辈模式首页。

后台：

- 共享关系列表。
- 共享关系停用。

### 二期：关系模型升级

目标：从 `memberId` 过渡到 `relationId`。

后端：

- 新增 `family_relation`。
- 新增 `family_invite`。
- 新增 `elder_profile`。
- 新增 `device_bind_log`。
- 新增新版 REST 接口。
- 当前接口兼容返回 `relationId`。

小程序：

- 邀请码/二维码。
- 手机号搜索脱敏展示。
- 待认领老人档案。
- 老人共享管理。

后台：

- 邀请记录。
- 待认领档案。
- 设备绑定历史。

### 三期：照护运营

目标：形成持续照护能力。

- 异常提醒推送。
- 健康周报/月报。
- 家庭群组。
- 异常事件中心。
- 后台人工协助绑定。
- 多子女协同照护。

## 12. 推荐实施顺序

1. 修复并稳定线上 family 接口部署，确保不再返回“接口待迁移”。
2. 完成当前 `memberId` 版本小程序页面验收。
3. 补充后台共享关系列表和停用能力。
4. 新增 `family_relation`，先与 `family_member` 双写。
5. 新增邀请和老人档案认领流程。
6. 前端从 `memberId` 平滑切换到 `relationId`。
7. 上线 AI 周报、异常提醒和后台运营工具。

## 13. 给老板/投资人的表达重点

### 对老人价值

- 减少操作负担，只需佩戴设备和打开小程序。
- 健康状态被家人看见，获得陪伴感和安全感。
- 长辈模式更适合老人使用，大字、少入口、强提示。
- 数据共享可控，老人知道谁在看，也可以随时关闭。

### 对子女价值

- 远程了解父母健康和设备状态。
- 及时发现未同步、低电量、异常指标。
- 不需要老人掌握复杂绑定流程。
- AI 摘要降低理解健康数据的门槛。

### 对平台价值

- 从单人健康工具升级为家庭照护平台。
- 增加设备购买和持续使用理由。
- 提升用户粘性和复购空间。
- 为后续订阅服务、健康周报、异常提醒、人工照护服务打基础。

## 14. 待确认问题

- 老人是否必须手机号登录，还是允许微信 openId 直接成为正式账号。
- 子女添加老人后是否立即生效，还是必须老人二次确认。
- 设备已绑定他人时，是否允许后台强制解绑。
- 异常提醒是否使用微信订阅消息。
- 健康周报/月报是否作为增值能力。
