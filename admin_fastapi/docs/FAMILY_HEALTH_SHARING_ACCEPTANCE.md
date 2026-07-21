# 亲情账号健康数据共享联调验收

## 目标

验证小程序可以完成以下闭环：

1. 子女账号添加父母/家人档案。
2. 子女账号给父母档案绑定穿戴设备。
3. 子女手机同步该设备健康数据时，后端按设备 MAC 写入父母档案对应的数据账号。
4. 子女账号通过 `memberId` 查看父母健康数据、设备状态、异常提醒和 AI 摘要。
5. 关闭某类共享权限后，对应家庭数据接口不可访问，dashboard 不再返回该类数据。

## 前置条件

1. 后端服务已启动，并连接可写数据库。
2. 小程序接口请求带有效 `Authorization` 或 `token`。
3. 当前登录用户作为子女账号。
4. 数据库中存在或允许创建 `device` 记录，至少有一个测试设备 MAC。

后端启动时会自动创建以下表：

```text
family_member
family_member_device
family_health_alert
```

## 接口验收流程

也可以先用脚本自动跑一遍核心接口闭环：

```powershell
cd E:\qkeer\code\wechatAdmin\admin_fastapi
python scripts\verify_family_health_sharing.py `
  --base-url http://127.0.0.1:8000 `
  --token "<子女账号小程序 token>" `
  --device-mac "TEST-FATHER-MAC-001"
```

如果是在本地后端环境，并且 Redis、数据库可用，也可以让脚本自动创建/复用一个测试子女账号并生成 token：

```powershell
cd E:\qkeer\code\wechatAdmin\admin_fastapi
.\.venv\Scripts\python.exe scripts\verify_family_health_sharing.py `
  --base-url http://127.0.0.1:8000 `
  --auto-token `
  --child-phone "13900009999" `
  --device-mac "TEST-FATHER-MAC-001"
```

脚本会自动完成：

```text
添加家人
绑定父母设备
用该 deviceMac 上传健康数据
读取家人 dashboard
读取家人体征详情接口
关闭生命体征权限
验证体征接口被拒绝
验证 dashboard 隐藏生命体征字段
```

脚本执行成功时会输出：

```text
Family health sharing verification passed.
```

### 1. 添加父母档案

```http
POST /app/family/member/add
Authorization: <child_token>
Content-Type: application/json

{
  "name": "爸爸",
  "relation": "father",
  "phone": "13800000001"
}
```

预期：

```text
返回 data.id，即 memberId
family_member 中生成一条 owner_user_id = 子女用户 id 的记录
如果手机号已是 app_user，则 data_user_id 指向该用户
如果手机号不是 app_user，则自动创建影子数据账号
```

### 2. 绑定父母设备

```http
POST /app/family/device/bind
Authorization: <child_token>
Content-Type: application/json

{
  "memberId": 1,
  "mac": "TEST-FATHER-MAC-001",
  "deviceName": "爸爸的设备",
  "serviceId": "optional-service-id"
}
```

预期：

```text
family_member_device 生成 active 记录
device.user_id 更新为该 member 的 data_user_id
设备不再归属子女本人账号
```

### 3. 子女手机同步父母设备数据

```http
POST /app/data/sync
Authorization: <child_token>
Content-Type: application/json

{
  "deviceMac": "TEST-FATHER-MAC-001",
  "battery": 82,
  "dataList": [
    {
      "recordTime": "2026-07-10 08:30:00",
      "heartRate": 76,
      "spo2": 98,
      "temperature": 36.6,
      "stepCount": 1200
    }
  ]
}
```

预期：

```text
health_raw.user_id = 父母档案 data_user_id
health_raw.device_mac = TEST-FATHER-MAC-001
health_daily_summary 为父母档案 data_user_id 生成当日汇总
device.last_sync_time 和 battery 更新
```

### 4. 子女查看父母看护面板

```http
GET /app/family/health/dashboard?memberId=1
Authorization: <child_token>
```

预期：

```text
返回 member、device、health、summary、alerts、aiSummary
summary 中包含父母设备上传后的心率、血氧、运动等汇总字段
device.online 在最近 24 小时同步后为 true
aiSummary.conclusion 生成可读摘要
```

### 5. 子女查看父母详细数据

```http
GET /app/family/data/vitalSign?memberId=1
GET /app/family/data/sleep/sleepOverview?memberId=1
GET /app/family/data/motion/motionOverview?memberId=1
Authorization: <child_token>
```

预期：

```text
接口查询的是父母档案 data_user_id 的健康数据
不是子女账号自己的健康数据
```

### 6. 验证共享权限

关闭生命体征共享：

```http
POST /app/family/share/updatePermissions
Authorization: <child_token>
Content-Type: application/json

{
  "memberId": 1,
  "permissions": {
    "vitalSigns": false,
    "sleep": true,
    "motion": true,
    "alerts": true,
    "aiSummary": true,
    "deviceStatus": true
  }
}
```

再次请求：

```http
GET /app/family/data/vitalSign?memberId=1
Authorization: <child_token>
```

预期：

```text
返回 code=500 或业务错误信息：当前亲情账号未开启该数据共享权限
dashboard.summary 不再包含 heartRateAvg、spo2Avg、temperatureAvg 等生命体征字段
```

## 小程序端验收流程

1. 登录子女账号。
2. 进入 `我的 -> 家人守护`。
3. 点击 `添加父母/家人`，创建父母档案。
4. 进入家人详情，点击 `绑定设备`。
5. 输入或扫码设备 MAC，或使用本机已连接设备。
6. 绑定成功后回到家人详情。
7. 使用该设备完成一次测量或历史数据同步。
8. 下拉刷新家人详情。
9. 确认可以看到：

```text
设备状态
心率
血氧
睡眠评分
活动评分
异常提醒
AI 今日健康摘要
```

10. 点击 `共享权限`，关闭某项权限。
11. 返回家人详情，下拉刷新，确认对应数据隐藏或无法访问。

## 验收通过标准

```text
子女账号可以创建父母档案
子女账号可以绑定父母设备
同一设备上传的数据归属父母档案 data_user_id
子女账号可以通过 memberId 查看父母数据
非 owner 用户不能通过该 memberId 查看数据
共享权限关闭后，后端接口和 dashboard 都生效
前端微信小程序构建通过
```
