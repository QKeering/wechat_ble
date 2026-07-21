## RW v271 补充交接

Build tag: `rw-visible-build-tag-20260718-271`

### 本次继续收口

- 继续沿用 v270 的首页睡眠回看窗口：带 `sleepData` 同步时日志会出现 `historyStartDate`，避免跨午夜睡眠被当天 00:00 起点漏掉。
- 最新已知 268 版真机日志里首页历史同步曾返回 `records=0`，那一轮不会向 `admin_fastapi` 上传步数或睡眠，需要下一轮用 v271 再确认 `recordCount` 和 `history-page-upload-result`。
- 修正 RW/QKeer V2 睡眠阶段码到 L19 阶段码的转换。RW `sleepStatus=2` 表示深睡，现在上传给后端时会变成 L19 `sleepState=4`；`sleepStatus=1/2/3/4` 分别映射为 L19 `3/4/1/2`。
- `admin_fastapi` 同步入口也做了同样兜底，直接收到 RW 原始 `sleepStatus` 和 `durationMinutes` 时也能生成正确 `sleep_record`。
- 继续补齐 `admin_fastapi` 的 `health_raw.sleep_state` 兜底：旧包或旁路链路只传 `sleepStatus=2` 时，原始表也会落 L19 深睡 `4`；非睡眠记录里的通用 `status` 不会被误写为睡眠状态。
- 如果数据库里后续仍出现 `sleep_state=0`，优先看日志的 `sampleSubmittedRecords` 是否已经带 `sleepState=4/3/2/1`；如果上传样本正确但数据库不对，再回到后端部署版本排查。

### 仍需真机验证

- 首页同步后 `history-page-sync-result.recordCount > 0`。
- `history-page-upload-result.sleepCount > 0` 时，`sleep_record` 应出现非 0 的 type。
- 步数仍以 `health_raw.step_count` 和运动详情页为准，若 `records=0` 则说明底层历史读取没有拿到活动记录。
- 体温仍未闭环，已知问题是控制 ACK 有，但缺少 `0x0508` 结果包。

### 2026-07-18 后端补充

- 后端确认以 `admin_fastapi` 为准。
- 已补齐 `/app/data/sleep/napList` 的 RW/L19 兼容兜底：接口现在通过 `sleep_type_key` 判断小睡，能识别 `sleep_record.type=5`，不再只匹配字符串 `NAP`。
- 已补充 `scripts/verify_rw_health_sync.py` 用例：模拟 `type=5` 的 RW 小睡、跨日期小睡和非小睡记录，要求 `napList?date=2026-07-17` 只返回当天小睡。
- 本次不改前端业务页；同步仍放在首页，睡眠等详情页继续直接取后端接口展示。

### 2026-07-18 前端补充

- 真机截图显示 `health_raw` 今天已有心率/血氧/HRV/压力，但 `step_count=0`、`sleep_state` 为空、`motion_intensity=0`，重点问题在首页 RW 历史同步未拿到/上传步数和睡眠。
- 首页 RW 历史同步现在保持主流程不变；当主读取返回 `records=0` 且本次请求包含睡眠/活动数据类型时，自动追加一次仅针对 `sleepData + activity` 的全量兜底读取。
- 兜底读取虽然使用全量命令，但上传仍沿用原 `sinceTimestamp` 过滤，避免老数据批量回灌。
- 新日志关键字：`history-page-empty-fallback-start`、`history-page-empty-fallback-result`、`history-page-empty-fallback-upload-failed`、`history-page-empty-fallback-failed`。
