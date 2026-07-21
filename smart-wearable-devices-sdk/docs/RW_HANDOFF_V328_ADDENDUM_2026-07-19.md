# RW SY03 v328 补充交接

BuildTag: `rw-visible-build-tag-20260719-328`

## 当前已封住的链路

- 步数链路先冻结为可用路径：`0x051a` / `history-key/activity-current-day/read`。
- 只接受 `ab_activity_current_day_relative_hour`、`current_day_key_relative_hour` 这类带明确来源标记且属于本地当天的数据，再写入 `admin_fastapi` 的 `health_raw.step_count`。
- 真机已验证从 `118` 增长到 `136`，用户确认符合实际短距离走动。

## v327 睡眠日志结论

- 手动 `sleepHistory` 发送 `history-key/sleep/read`，TX 为 `ab0100039d12050510`。
- 设备返回 `ab1100039d12050510`，解析为 `rw_health_data_ack:sleep key=0x0505`，说明 0x0505 通信通路是通的。
- 返回帧是空 ACK，没有 sleep payload，所以页面和后端 `health_raw.sleep_state` 仍没有有效睡眠数据。
- 同一批日志里，在手动探针前后台同步已经执行 `history/ab-key/sleep-history/sdk-read`，随后又执行 `sdk-delete`。这会干扰判断：可能后台先读/删，再导致手动 0x0505 只能看到空 ACK。

## v328 变更

- Mine 页只保留 `sleepHistory` / `history-key/sleep/read` 的单条按钮，继续隐藏体温和步数专项按钮。
- 当前开关为 `MINE_SHOW_SLEEP_PROTOCOL_PROBE = true`、`MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false`、`MINE_SHOW_STEP_PROTOCOL_PROBES = false`。
- 新增 `MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK = true`。
- 进入 Mine 页时设置 `mine-sleep-probe-isolation` 锁并暂停业务自动刷新，后台历史同步应跳过，避免 `sleep-history/sdk-delete` 抢跑。
- 离开 Mine 页时清除隔离锁并恢复业务自动刷新。
- 点击睡眠 0505 时临时切到命令探针锁，命令结束后恢复 Mine 页隔离锁。
- 新增日志事件：
  - `sleep-probe-isolation-lock-set`
  - `sleep-probe-isolation-lock-clear`

## 下一次真机验证口径

1. 发布 v328。
2. 进入“我的”页后先观察日志是否出现 `sleep-probe-isolation-lock-set`。
3. 确认手动点击 `睡眠历史0505` 前，不再出现 `sleep-history/sdk-read` / `sleep-history/sdk-delete`。
4. 点击 `睡眠历史0505`。
5. 判断：
   - 如果仍是 `ab1100039d12050510` 空 ACK：设备当前没有可读睡眠历史，或睡眠生成条件/时间窗口仍不满足。
   - 如果出现 sleep payload：继续解析并写入 `admin_fastapi`，检查 `health_raw.sleep_state`。

## 最终目标保持不变

- RW/SY03 协议按 L19 业务页面可用口径封装成 SDK。
- 连接后由首页/业务同步链路负责把设备历史数据写入后端。
- 内页只读后端接口展示，不在内页临时等待设备同步。
- 已验证通路不再反复测试，后续只按未通通路逐条命令验证。
