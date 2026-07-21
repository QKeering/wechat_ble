# RW v268 交接补充

BuildTag: `rw-visible-build-tag-20260718-271`

## 本次变更

1. RW 历史同步入口补齐设备时间校准：`useRingBusinessController.syncBusinessHistory` 在真正读取历史前，会先调用 `updateDeviceTime(now, timezone)`，并通过 `RW_HISTORY_DEVICE_TIME_SYNC_DEDUP_MS` 做 10 分钟去重。
2. 校准是 best-effort：失败只写 `history-device-time-sync-failed` 日志，不阻断历史同步，避免 SY03 偶发无响应导致整条业务链路不可用。
3. 首页原本已有自己的同步前校时逻辑；v268 把我的页手动同步、验收同步、后续 controller 统一入口也覆盖上，重点处理数据库记录时间跑到未来的问题。
4. 详情页查询日志补齐 HRV、压力、体温别名：`latestHrvValue/dailyAvgHrvValue/stressValue/avgStressValue/temperatureAvg` 都会进入 `valueHints`，下一轮日志可以直接区分“后端没值”和“页面没展示”。

## 日志判断

用户 15:08 提供的日志仍是 `rw-visible-build-tag-20260717-250`，不是当前版本，只能作为历史现象参考。该日志仅覆盖血糖前台测量：控制 ACK 成功，但没有结果值；没有历史同步、设备信息、HRV、压力、血氧、体温等业务数据链路证据。

用户 07:40 提供的日志是 `rw-visible-build-tag-20260718-267`，也早于 v268。它显示连接 ready，首页历史上传成功，`uploadRawMetrics/submitMetrics` 已有 `hrv=8` 和 `stress=8`，但没有体温。详情页日志显示心率、血氧后端接口有值；HRV、体温、压力详情接口当时没有可读 valueHints。v268 已补日志字段别名；本地 `admin_fastapi` `/data/vitalSign` 代码已包含 `hrv/hrvAvg/hrvChart/stressAvg`，如果真机接口根字段仍缺这些，优先确认后端服务是否已部署并重启到当前代码。

## 当前目标

最终目标仍是把 RW 设备做到和 L19 一致：连接稳定、设备信息可读、首页负责数据同步、详情页只读后端接口，睡眠、活动、压力情绪、体征详情均能展示后端已入库数据。

## 待真机验证

1. 使用 v268 包重新清空日志后测试，确认复制日志里出现 `history-device-time-sync-start` 和 `history-device-time-sync-result`，随后才出现 `history-sync-start`。
2. 再查数据库 `health_raw_hr.record_time`，确认记录时间不再超过手机当前时间。
3. 首页触发同步后，详情页不要再等待设备，只应查询后端接口展示：睡眠、活动、压力情绪、体征详情都需要验证。
4. 体温仍是重点待确认项：如果底层没有返回有效体温，页面和后端只能保持空值，不能用状态 ACK 或异常值兜成业务数据。
5. HRV、压力、血氧饱和度如果底层有原始值但详情页不展示，继续按“底层原始日志 -> 上传转换 -> 后端接口 -> 页面字段映射”逐段排查。
