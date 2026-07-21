# RW SY03 v329 补充交接

BuildTag: `rw-visible-build-tag-20260719-329`

## 这批 v328 日志结论

- 进入 Mine 页后已经出现 `sleep-probe-isolation-lock-set`，说明页面隔离锁生效。
- 但后台历史同步在 Mine 页展示前已经启动：`history-page-sync-start` 早于 `sleep-probe-isolation-lock-set`。
- 已经启动的同步没有在 RW SDK 内部每条命令前重新检查锁，所以后续仍发送了：
  - `history/ab-key/sleep-history/sdk-read`
  - `history/ab-key/sleep-history/sdk-delete`
- 手动 `sleepHistory` 继续发送 `history-key/sleep/read`，TX 为 `ab0100039d12050510`，RX 为 `ab1100039d12050510` 空 ACK。
- 因为 `sdk-delete` 仍然抢跑，v328 还不能最终证明设备端没有睡眠 payload。

## v329 变更

- 继续保持 Mine 页诊断开关：`MINE_SHOW_SLEEP_PROTOCOL_PROBE = true`、`MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false`、`MINE_SHOW_STEP_PROTOCOL_PROBES = false`。
- Mine 页隔离锁仍为 `MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK = true`，进入页时输出 `sleep-probe-isolation-lock-set`，离开页时输出 `sleep-probe-isolation-lock-clear`。
- 在 `src/sdk/ring-ble/rw/history.ts` 内部引入 `getRwDiagnosticCommandLock`。
- 新增 `shouldSkipRwHistoryCommandForDiagnosticLock`。
- 在 AB 历史命令发送前增加锁检查，命中时输出 `history-command-skip-diagnostic-lock`：
  - `history/ab-key/{label}`
  - `history/ab-key/{label}/read`
  - `history/ab-key/{label}/read-continue`
  - `history/ab-key/{label}/sdk-read`
  - `history/ab-key/{label}/sdk-delete`
- 重点效果：哪怕后台同步已经在 Mine 页进入前启动，只要 Mine 页隔离锁已设置，后续 AB 历史 read/delete 就会停住。

## 已封住的通路

- 步数仍按 `0x051a` / `history-key/activity-current-day/read` 保留。
- 只允许 `ab_activity_current_day_relative_hour`、`current_day_key_relative_hour` 这类安全来源入库。
- `admin_fastapi` 写入 `health_raw.step_count` 的链路已验证。

## 下一次真机验证口径

1. 发布 v329。
2. 进入 Mine 页后确认出现 `sleep-probe-isolation-lock-set`。
3. 点击 `睡眠历史0505` 前后看日志：
   - 应看到后台已启动同步被 `history-command-skip-diagnostic-lock` 拦住。
   - 不应再看到后台 `sleep-history/sdk-delete` 抢跑。
4. 点击 `睡眠历史0505`，对应协议键是 `0x0505`。
5. 判断：
   - 如果仍返回 `ab1100039d12050510` 空 ACK：基本可判定当前设备无可读睡眠历史，下一步检查睡眠生成条件或设备时间窗口。
   - 如果返回 sleep payload：继续解析并上传到 `admin_fastapi`，检查 `health_raw.sleep_state`。

## 当前最终目标

- RW/SY03 按 L19 业务页面口径完成 SDK 封装。
- 首页/业务同步负责连接后上传历史数据。
- 内页只读后端接口展示。
- 后续继续按未通命令逐条验证，不再反复打已经确认的步数和体温专项通路。
