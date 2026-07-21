## RW v270 补充交接

Build tag: `rw-visible-build-tag-20260718-271`

### 本次日志结论

- 用户最新日志仍是 268 版，不是本地最新代码。
- 08:12 首页历史同步已经触发，但 `history-page-sync-result` 返回 `records=0`、`status=empty`，随后 `history-page-upload-skip`，所以这次没有任何历史记录上传到 `admin_fastapi`。
- 当前“步数、睡眠没有”的直接原因不是详情页读取覆盖，而是这次 RW 历史同步没有读到记录；数据库里已有的心率、血氧、压力、HRV 多数来自其他实时/手动/历史批次。
- 睡眠原始表里 `sleep_state=0` 不能形成有效睡眠；如果底层返回的是睡眠段记录，需要后端写入 `sleep_record` 后业务页才稳定可见。
- 体温链路仍未闭环：设备返回了控制 ACK，但没有返回 `0x0508` 体温结果包，仍需要底层协议继续验证。

### 已补齐

- 前端首页历史同步包含 `sleepData` 时增加一日回看窗口。页面日期为今天时，日志会出现 `historyStartDate`，并从前一天开始读取，避免跨午夜睡眠从昨晚开始而被当天 00:00 起点漏掉。
- `admin_fastapi` 的睡眠入库兜底已兼容 RW 字段：`sleepStatus/sleepStage/state/stage` 与 `durationMinutes/sleepMinutes/duration/sleepLen` 等别名可以生成 `sleep_record`。
- `/app/device/current` 仍只作为绑定设备查询；`getBindInfo` 已有 5 秒远端缓存和本地缓存兜底，不参与 RW 数据同步。

### 下一轮真机重点

- 确认日志 build tag 是 `rw-visible-build-tag-20260718-271`。
- 首页同步后看 `history-page-sync-result.historyStartDate` 是否为前一天，`recordCount` 是否大于 0。
- 如果 `recordCount > 0`，继续看 `history-page-upload-result.count/sleepCount/healthCount`。
- 如果仍然 `records=0`，问题在设备历史读取通道或设备没有生成历史文件；后端页面不用继续排查。
- 体温仍按单命令继续抓包：重点看 `0x0508` 是否有结果包，而不是只看控制 ACK。
