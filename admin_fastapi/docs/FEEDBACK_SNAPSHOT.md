# 调试版测试反馈快照联调说明

## 1. 数据库

FastAPI 启动时会自动创建 `feedback_snapshot` 表。若数据库网络不可达或需要手动提前建表，执行：

```sql
source docs/feedback_snapshot.sql;
```

## 2. 小程序提交入口

调试版小程序健康页会缓存最近的健康接口请求/响应：

- `/app/health*`
- `/app/data*`

健康页出现“调试反馈”模块后可执行：

- 上报整页快照：把当前缓存的健康接口统一上报。
- 数值纠错：选择最近接口，填写字段路径、显示名称、纠错值、原因。
- 后端聚合接口若返回 `_debugAlgorithmSnapshots`，小程序会自动拆出 `/api/physicalHealth/*` 算法级快照，后台可直接复算。

字段路径示例：

```text
habitScore.score
sleep.preparation.score
activity.activityRisk.score
```

## 3. 快照提交接口

```http
POST /v1/feedback/snapshot
Content-Type: application/json
X-Qkeer-User: <userId>
```

成功返回：

```json
{
  "ok": true,
  "snapshotId": "uuid",
  "storedAt": "2026-06-24T12:00:00Z",
  "duplicate": false
}
```

`snapshotId` 幂等：重复上报不会重复入库，返回 `duplicate: true`。

## 4. 后台审阅入口

后台 Vue 菜单：

```text
测试反馈 / 算法快照
```

支持：

- 按用户、接口、字段路径、环境、测试员、时间筛选。
- 按审阅状态、诊断分类筛选。
- 查看完整 `requestBody`、`responseBody`、`context`。
- 一键复算。
- 标注三分类结论：前端映射、数据/固件、算法问题、待判断。
- 导出标注集 CSV。

## 5. 后台接口

```http
GET  /admin/feedback/snapshots/list
GET  /admin/feedback/snapshots/{id}
POST /admin/feedback/snapshots/{id}/recalculate
PUT  /admin/feedback/snapshots/{id}/review
GET  /admin/feedback/snapshots/export
```

审阅标注请求：

```json
{
  "reviewStatus": "confirmed",
  "diagnosis": "front",
  "reviewRemark": "前端把 riskScore 当正向分展示",
  "reviewedBy": "reviewer"
}
```

字段取值：

```text
reviewStatus: pending / confirmed / ignored
diagnosis: front / data / algorithm / unknown
```

## 6. 复算说明

复算会使用快照里的 `endpoint` 和完整 `requestBody` 调用当前算法服务。

注意：

- 如果 `endpoint` 是 `/api/physicalHealth/sleepScore`，后端会转成算法服务的 `/physicalHealth/sleepScore`。
- 如果快照来自聚合接口 `/app/health/index`，只能保存和审阅，不能直接复算；小程序会优先上报聚合响应中拆出的算法级快照。
- 纠错值只是“待查信号”，不会自动覆盖业务数据。

## 7. 验证命令

```powershell
.\.venv\Scripts\python.exe -m compileall app
```

小程序：

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run build:mp-weixin
```

后台 Vue：

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run build:prod
```
