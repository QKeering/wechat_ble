# RW SY03 交接补充

BuildTag: `rw-visible-build-tag-20260720-358`

## v358 focus
- v357 `增强睡眠73` (`CMD_SYNC_ENHANCE_SLEEP_READ = 0x73`) was isolated and timed out after 8s, so enhanced sleep read is not responding on SY03.
- `睡眠Native03` (`CMD_SYNC_SLEEP = 0x03`) was isolated on v358 and timed out after 12s. The packet matched the vendor SDK structure (`000101...000903...`), BLE write succeeded, and no parsed sleep response arrived.
- `睡眠续读0505` (`0x0505` + `KeyFlag=0x11`, hex `ab0100035dd3050511`) was isolated on v358 and timed out after 8s after BLE write success.
- Sleep command candidates tested so far: `0x0505` read -> empty ACK, `0x0505` read-continue -> timeout, `0x02fe` raw sleep -> timeout, QKeer V2 `0x31` sleep list -> timeout, QKeer V2 `0x73` enhance sleep read -> timeout, QKeer V2 `0x03` sleep detail -> timeout. Treat sleep as device-side/no-payload pending overnight data, not a page rendering issue.

## v357 focus
- v356 `睡眠Native31` (`history/qkeer-v2-sleep-list`, command `0x31`) was isolated after business idle/quiet and timed out after 12s, so `0x31` is not currently returning sleep list data on SY03.
- Added focused Mine probe button `增强睡眠73`, mapped to SDK `CMD_SYNC_ENHANCE_SLEEP_READ = 0x73`, and added RW parser support for `qkeer_v2_enhance_sleep_read`. Next real-device test should clear logs and tap only this button.

## v356 focus
- v355 logs finally produced a clean `rawSleepHistory` (`ab0100036ce002fe10`) window: history idle waited 29.2s, business quiet waited 6.0s, no battery/firmware/time command appeared between command TX and timeout.
- `0x02fe` therefore cleanly timed out on SY03 for this test condition.
- Added a focused Mine probe button `睡眠Native31`, mapped to `history/qkeer-v2-sleep-list` (`RwQkeerV2HistoryCommand.SleepList = 0x31`), so the next real-device test can isolate the native sleep list path used by business sync.

## v355 focus
- Latest backend logs on v354 still show `rawSleepHistory` (`ab0100036ce002fe10`) was polluted by a post-connect silent device-info refresh that started just before the diagnostic lock.
- The Mine single-command probe now waits for the controller's real in-flight state (`refreshPromise`/`historyPromise`/`restorePromise`) and then requires a 6s quiet window before sending the protocol command.
- Device-time sync and post-connect device-info refresh remain skipped while a RW diagnostic command lock is active.
- Next real-device sleep test should clear logs and tap only `原始睡眠02FE`; if no battery/firmware/device-time commands appear between `protocol-probe-command-start` and timeout/response, the result can finally be used to judge the sleep command itself.

## v345 focus
- Latest backend logs confirm SY03 active SpO2 and heart-rate communication is not blocked at BLE level.
- SpO2 `0x024e` returned valid realtime values such as 97/98/99, but Mine probe timed out because app realtime frames may use flag `0x00` instead of read flags `0x10/0x11`.
- Heart-rate `0x0224` returned 6-byte realtime payloads. Example `ab11000943e5022400033328cc4600` should decode value byte `0x46` = 70, not be treated as `rw_health_data_ack`.
- v345 fixes the parser and Mine predicate for app realtime health keys. Next real-device test should run only `bloodOxygenRealtime` then `heartRateRealtime`; both should be 3/3 OK with concrete values.

## v344 focus
- Current focus: heart-rate and SpO2 active measurement.
- Mine page exposes two command-level probes: `heartRateRealtime` and `bloodOxygenRealtime`.
- Each focused probe runs only three commands: control enable, app realtime read (`0x0224` for heart-rate, `0x024e` for SpO2), control disable.
- Foreground realtime metric helpers now prefer app realtime keys for heart-rate/SpO2 and keep `0x0503`/`0x0509` as compatible keys.
- Realtime display helpers reject RW packets that contain history-record payloads, so old history data should not be mistaken for current active measurement.
- Sleep remains deferred until new device-side data exists; ԭʼ˯��02FE stays documented as a hidden retained probe, not the current main path.

## v343 note
- Mine page no longer sets `mine-sleep-probe-isolation` on every page show.
- Stale `mine-sleep-probe-isolation` can still be cleared by the page lifecycle.
- Reason: v342 backend logs showed `manual-history-sync stress` was skipped by the sleep isolation lock, so pressure/HRV history validation could be falsely blocked before any BLE history command was sent.

## 最终目�?
�?RW/SY03 处理成和 L19 一致的业务体验：连接、设备信息、电量、历史同步、首页、健康详情、我的页都走同一套业务页面和后端 `admin_fastapi` 数据链路。协议底层可以保�?RW 差异，但页面展示、入库字段、后端接口消费要对齐 L19，尤其是 `health_raw`、睡眠、步数、心率、血氧、HRV、压力、体温等业务指标�?
## 当前状�?
- L19 原协议处理和 SDK 封装已完成，当前主要收口 RW�?- RW/SY03 AB 帧读通路可用，电量、心率、血氧、HRV、压力、体温、步数都出现过真机回包或入库证据�?- 体温单点通路阶段性完成，历史和业务页稳定展示还要继续验证�?- 步数已经能入库，用户验证�?118 �?136 的短距离增长；后续重点是区分当日累计值和分时增量值�?- 睡眠还没闭环：`0x0505` 可达但多次为�?ACK，`0x02fe RawSleep` 写入成功但无响应，`0x051a` 更像活动/分时步数，不应当作睡眠主通路�?- 当前线上日志仍只�?`rw-visible-build-tag-20260719-333`，还没有 339 真机证据。发�?339 后，必须先确认日志中出现 `rw-visible-build-tag-20260719-347`�?
## v339 改动

1. 连接成功后补一条全局后台设备信息轻量刷新�?   - 不阻塞连接弹窗�?   - 只读电量/版本，不读实时健康和历史，避免日志和 BLE 命令爆炸�?   - 关键日志：`RW FLOW post-connect-device-info-refresh-start/result`�?
2. 我的�?RW 已连接时不再完全跳过刷新�?   - 页面显示�?RW 且通信 ready 时，会后台补一次设备信息轻量刷新�?   - 关键日志：`RW MINE rw-device-info-background-refresh-start/result`�?
3. 设备信息页已经恢复原业务页面字段，只显示�?   - 戒指大小
   - 设备版本
   - 固件版本
   - 序列�?   - 设备名称
   - Mac地址

4. 设备信息页不再额外显示：
   - 软件版本
   - 电量
   - 电量状�?
5. 首页 `RW HOME` 日志已改为共享上传，下一轮可以直接判断评分问题：
   - `business-overview-request-success`
   - `business-overview-request-failed`
   - `business-sync-refresh-overview-start`
   - `business-sync-refresh-overview-result`

## 下一轮真机验证顺�?
1. 发布 339 后先拉日志：
   `npm.cmd run check:rw-backend-log`

2. 先确认日志里有：
   `rw-visible-build-tag-20260719-347`

3. 连接 SY03 后确认电量链路：
   - `RW FLOW connect-ready`
   - `RW FLOW post-connect-device-info-refresh-start`
   - `RW BLE rx-parsed` 中有 `type=battery`
   - `RW FLOW device-info-resolved-from-data` �?`post-connect-device-info-refresh-result`
   - 我的页电量从 `--` 变成百分�?
4. 设备信息页只看页面还原：
   - 页面不应出现“软件版�?/ 电量 / 电量状态”三行�?   - 如果仍出现，优先检查微信开发者工具上传的 dist 是否是最新包�?
5. 首页评分问题�?`balanceScore`�?   - �?`RW HOME business-overview-request-success key=balanceScore` �?`activityScore` 空：问题�?`admin_fastapi` 评分/聚合�?   - 没有 `balanceScore` 请求日志：问题在前端首页刷新链路�?   - 有请求失败日志：先看 `rawError` 是否网络超时或后端超时�?
6. 睡眠不要继续优先�?`0x02fe`，先确认数据库和后端详情接口是否存在有效睡眠段；如果 DB 没有 `sleep_state != 0` 或睡眠段记录，再回到底层命令�?
7. 步数异常时先核对同一时间窗的 `rawDataType`、`record_time`、上�?payload，再判断是累计步数还是小时增量�?
## 协议结论

### 睡眠

- `0x0505` / `sleepHistory`�?  - 发送：`ab0100039d12050510`
  - 真机曾返回：`ab1100039d12050510`
  - 结论：通路可达，但当前是空 ACK，没有睡�?payload�?- Mine 单测命令名保留为 `history-key/sleep/read`，用于继续验�?0x0505 睡眠历史读�?- SDK 风格删除也验证过，日志标识为 `sdk-delete`，Delete �?ACK，但没有改变“无睡眠 payload”的事实�?- `0x0505 ReadContinue(0x11)`：写入成功但没有有效回包�?- `0x02fe` / `RawSleep` / `rawSleepHistory` / `原始睡眠02FE`：写入成功但无响应，保留隐藏入口，不作为当前主线�?- `0x051a`：有活动/步数�?payload，更�?`ab_activity_current_day_relative_hour` / `current_day_key_relative_hour`，不能证明它是睡眠�?
### 步数

- 已有入库和短距离增长证据�?- 可信来源优先看：
  - `ab_activity_current_day_relative_hour`
  - `current_day_key_relative_hour`
  - 后端 `health_raw.step_count`
- 不要只凭单个页面数值判断，要结合原�?payload �?`record_time`�?
### 体温

- 用户已反馈“体�?1 OK”，当前单点通路阶段性完成�?- 后续继续验证 `history-key/temperature/read`、入�?`health_raw.temperature`、详情页展示是否一致�?
## Mine 诊断开�?
当前 Mine 页不再显示协议单测按钮，避免已验证命令反复干扰业务同步；源码仍保留隐藏入口�?
- `MINE_SHOW_TEMPERATURE_PROTOCOL_PROBES = false`
- `MINE_SHOW_STEP_PROTOCOL_PROBES = false`
- `MINE_SHOW_SLEEP_PROTOCOL_PROBE = false`

历史隔离锁相关标识仍需保留�?
- `MINE_SLEEP_PROTOCOL_PROBE_ISOLATION_LOCK`
- `sleep-probe-isolation-lock-set`
- `sleep-probe-isolation-lock-clear`
- `history-command-skip-diagnostic-lock`

## 后端和入库边�?
后端项目�?`admin_fastapi`。前端目标不是替代后端聚合，而是�?RW 设备数据�?L19 兼容字段上传�?
- `health_raw.step_count`
- `health_raw.heart_rate`
- `health_raw.hrv`
- `health_raw.spo2`
- `health_raw.stress`
- `health_raw.temperature`
- `health_raw.sleep_state`

如果数据库有原始值但页面没有，优先查后端详情接口和前�?`homeDetail` 页面是否取了正确日期、字段别名和空值兜底�?
如果 BLE 有回包但没有入库，优先查 RW parser、`useRingBusinessHistoryPageSync.ts`、`useRingHistoryUpload.ts`�?
如果日志有入�?接口请求但页面空，优先查业务详情页转换和后端接口返回结构�?
## 2026-07-19 最新线上日志结�?
本轮已分别拉�?`/api/app/rw-debug/logs` �?`/api/app/rw-debug/logs/page`，两边都只看�?`rw-visible-build-tag-20260719-333`，没有看�?`rw-visible-build-tag-20260719-347`。所以这轮日志只能证明旧包问题，不能作为 339 的真机验收结论�?
增强后的分析命令�?
```bash
npm.cmd run analyze:rw-backend-log -- rw-debug-latest.json
```

本轮输出的三条归因：

1. 连接�?Mine 页电量不马上显示�?   - 旧包日志�?`RW MINE page-show-skip-rw-auto-refresh`�?   - 旧包没有 `RW MINE rw-device-info-background-refresh-start/result`�?   - 结论：旧包在 RW ready 后跳过了轻量设备信息刷新，能解释电量延迟或不显示�?39 已补上后台轻量刷新，需�?339 真机日志确认�?
2. 设备信息页未按原页面还原�?   - 旧包日志�?`RW DEVICE page-show`、`page-show-auto-refresh`、`device-info-refresh-result`�?   - 但当前用户反馈不能用旧包判断 339；本�?339 源码模板已只保留原业务项：戒指查找、解除绑定、戒指大小、设备版本、固件版本、序列号、设备名称、Mac地址�?   - 若真机仍不是该页面，优先检查微信开发者工具导�?上传�?dist 是否�?339�?
3. 首页活动有数据但评分不返回：
   - 旧包日志没有 `RW HOME business-overview-request-success/failed`，也没有 `business-sync-refresh-overview-result`�?   - 结论：旧包日志无法判�?`balanceScore` 是否请求�?39 已加�?RW HOME 日志，下一轮看 `key=balanceScore`�?     - �?success �?score 空：�?`admin_fastapi` 聚合/评分�?     - �?failed：查 `rawError`�?     - 没有任何 RW HOME 请求日志：查前端首页刷新链路�?
同一轮日志里的历史同步证据：

- 最�?`history-page-sync-result` 只有 1 条记录，`rawMetricCounts.stepCount=1`�?- 样本来自 `rawDataType=ab_activity_current_day_relative_hour`，步�?287，说明当前同步到的是“当日相对小�?活动”记录，不是完整睡眠或完整全天健康包�?- 旧包没有有效睡眠 payload；睡眠仍需�?339 包上继续�?`0x0505` / 详情接口 / 数据库字段三层排查�?
