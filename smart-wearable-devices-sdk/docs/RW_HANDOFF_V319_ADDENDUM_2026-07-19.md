# RW 交接增量：v319 体温单命令 SDK 重试验证

后续接续版本：`rw-visible-build-tag-20260719-320`，用于修正 v319 中体温配置读取被后台历史同步污染的问题。

## 当前目标

继续把 RW/SY03 协议处理收敛到和 L19 一致：连接后由首页负责同步历史/实时数据，业务页优先读后端接口展示；我的页只保留用于排查底层协议通路的诊断按钮和日志闭环。

## v318 日志结论

后端日志最新构建号为 `rw-visible-build-tag-20260719-318`，最新日志 id 仍停留在 `3480`。体温三条单命令均处于“BLE 写入成功，但设备无响应”状态：

- `monitoring/temperature/read`：`0x027d`，hex `ab0100035c81027d10`，8 秒超时。
- `monitoring/temperature-detecting/write`：`0x021b`，hex `ab010009f5ee021b00ff0000173b3c`，8 秒超时。
- `history-key/temperature/read`：`0x0508`，hex `ab0100030d16050810`，8 秒超时。

同一会话中设备连接、服务发现、通知订阅、BLE 写入通道均已就绪；因此当前问题不是页面展示或前端转化问题，而是 SY03 对这些体温 key 没有返回。

## SDK 对照

反编译 APP SDK 后确认：

- `getTimedBodyTemperatureJL()` 使用 `BLE_KEY_TEMPERATURE_MONITORING`，即 `0x027d`，`READ`。
- `setTimedBodyTemperatureJL(...)` 使用 `BLE_KEY_TEMPERATURE_DETECTING`，即 `0x021b`，`UPDATE`，`SET_ACK`。
- SDK 的 AB 帧结构与当前小程序一致：`0xab + frameType + length + CRC + key + flag + payload`。
- SDK 命令超时策略为 5 秒，并最多重发 2 次，也就是初发 + 2 次重试。

## v319 改动

可见构建号：`rw-visible-build-tag-20260719-319`。

仅调整我的页三条体温单命令的诊断发送策略：

- 首次立即发送。
- 5 秒未返回则重发同一帧。
- 10 秒未返回再重发一次。
- 总等待 16 秒。

这用于复现 SDK 的重试策略。如果 v319 仍然三条都超时，可以基本排除“一次性发送时序问题”，下一步应判断该 SY03 固件不支持体温相关 key，或需要供应商提供实际 APP 抓包确认前置条件。

## 真机验证步骤

1. 发布 v319 后进入我的页，确认日志 buildTag 为 `rw-visible-build-tag-20260719-319`。
2. 设备保持唤醒和已连接。
3. 依次点击：
   - `体温配置`
   - `体温开启`
   - `体温历史`
4. 每次点击后等待按钮结束，再更新后端日志。
5. 重点看每条命令是否出现 `protocol-probe-command-response`；如果只有 `tx-ok` 和最终 timeout，则底层未通。

## 待处理

- 体温：等待 v319 真机日志确认 SDK 重试后是否仍无响应。
- 步数/睡眠：已不在本轮体温单命令里扩大处理，避免互相干扰。
- 业务页面：已恢复为读后端接口为主，后续只在底层通路确认后再处理展示转化。
