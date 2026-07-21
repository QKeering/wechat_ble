# 智能穿戴小程序与戒指 BLE SDK 项目交接文档

> 交接基线：2026-07-12，最后更新：2026-07-13（交接版）
>
> 小程序工作目录：`E:\qkeer\code\wechatProgram\smart-wearable-devices-next`
>
> 后端工作目录：`E:\qkeer\code\wechatAdmin\admin_fastapi`
>
> 本文是当前交接的优先事实来源。`RING_BLE_CURRENT_STATUS.md` 记录过多个历史方案，其中“延迟追读、ReadContinue、多轮自动补偿”等内容已经部分撤销或与当前代码不一致，接手时不要直接按旧文档继续实现。

> 最新发布基线：当前 `dist/build/mp-weixin` 已包含设备信息页电量/版本“共享 store 数据流”改造、RW 版本读取单命令收敛、睡眠/活动/压力历史闭环，以及生命体征页血糖/血压扩展。2026-07-13 已通过类型检查、全量 BLE parity、微信产物校验和主包大小检查，可以作为下一轮真机体验版输入；后端扩展需同步部署 `admin_fastapi`。

## 1. 最终目标

项目最终需要同时达到以下目标：

1. 将原 L19 戒指协议完整封装为统一 SDK，原小程序页面不再直接实现协议和 BLE 细节。
2. 将 RW/SY03 戒指协议接入同一 SDK，对页面暴露与 L19 尽量一致的扫描、连接、设备信息、实时健康数据和历史数据能力。
3. 保留原小程序正式页面和交互，通过兼容层迁移，不另做一套只能调试使用的 UI。
4. L19 与 RW 设备切换时，连接状态、设备信息、健康数据和历史数据不能串设备或残留旧状态。
5. 小程序主包必须小于微信 2 MB 发布限制。
6. 健康页、详情页和后端健康接口不能出现乱码或未翻译英文。
7. 最终必须完成 L19 与 RW/SY03 两类真机的完整验收，不能只以模拟测试或编译通过作为完成标准。

## 2. 当前总体结论

| 范围 | 状态 | 结论 |
| --- | --- | --- |
| L19 协议 SDK 化 | 代码基本完成 | 原协议已进入统一 SDK 和兼容层，仍需最终真机回归 |
| RW 扫描 | 已验证 | SY03 可以被搜索到 |
| RW 连接 | 代码已收敛，待真机验收 | 已修复并发建连、超时残留连接和扫描页假“已连”；稳定性仍需真机确认 |
| RW 电量 | 已有真机成功记录，最新链路待验 | 用户确认过电量正常；页面已改为从共享 store 等待新数据，需重构建后回归 |
| RW 固件/软件版本 | 最新链路待验收 | 页面已改为从共享 store 汇总版本字段，尚无最终真机通过记录 |
| RW 实时心率 | 设备通道已通，页面修复待验 | 日志已收到 73/75/76，最新代码修复页面消费链路，尚待真机确认 |
| RW 血氧 | parser 有真实样例，当前真机未闭环 | 保存样例可解析为 99%，但最近日志只有请求、没有 `0x024E` 回包，需单项重测 |
| RW 体温/HRV/压力 | 未完成 | 命令与解析有框架，无可信真机验收结果 |
| RW 血压/血糖 | 后端链路已补齐，真机未完成 | 前端解析、历史同步、幂等落库、日汇总和条件展示已有代码，仍无可信真机数值 |
| RW 历史数据 | 页面及睡眠后端链路已闭环，真机未完成 | 文件列表、上传、类型过滤、详情页提交和睡眠分段落库已有代码，真实文件格式与最终图表仍需逐项验收 |
| 健康页乱码/英文 | 后端兜底已扩展，待部署后页面复验 | 前端有编码保护；`admin_fastapi` 已对健康/详情接口扩展英文等级、算法结果和常见乱码文案兜底，仍需部署新版后逐页确认 |
| 睡眠等内页 | 部分完成 | 路由和部分页面已恢复，未完成全量真机/接口验收 |
| 微信主包大小 | 已完成 | 最新主包约 1006 KB，低于 2048 KB |

## 3. 代码架构与职责

### 3.1 页面兼容入口

- `src/composables/useRingBLE.ts`
  - 原页面继续调用的兼容门面。
  - 只能做参数和旧字段兼容，不应继续加入协议解析或直接 BLE 实现。
  - RW 默认快照已设置为不自动读取实时指标和历史快照：
    - `includeRealtimeMetrics: false`
    - `includeHistorySnapshot: false`

- `src/composables/useRingBusinessController.ts`
  - 页面级业务刷新、恢复连接、设备信息、实时指标、历史同步的编排层。
  - 代码仍保留 RW 自动重试和维持刷新定时器，但生产默认由 `rwBackgroundRefreshEnabled: false` 关闭；若日志再次大量并发，先检查是否被页面显式开启。

- `src/composables/useRingBusinessData.ts`
  - 页面读取统一状态和业务指标的入口。

### 3.2 SDK 核心

- `src/composables/useRingBleSdk.ts`
  - 统一 BLE SDK 运行时和协议适配器入口。
  - 负责扫描、连接、服务发现、数据监听及适配器调用。

- `src/composables/useRingBleStoreSdk.ts`
  - SDK 与 Pinia store 的桥接层。
  - 默认调用使用单例，避免页面各自创建互不相通的 adapter。

- `src/sdk/ring-ble/protocolRegistry.ts`
  - L19、RW、QKeer V2 的协议识别和路由。

- `src/sdk/ring-ble/legacy/`
  - 原 L19 协议实现、解析、工作流及回归测试。

- `src/sdk/ring-ble/rw/protocol.ts`
  - RW key、控制 key、帧构建与基础协议定义。

- `src/sdk/ring-ble/rw/parser.ts`
  - RW 通知包、设备信息、实时健康数据和历史上传内容解析。

- `src/sdk/ring-ble/rw/adapter.ts`
  - RW 扫描、连接、服务/特征选择、命令发送、标准 BLE 兜底、日志和兼容别名。

- `src/sdk/ring-ble/rw/history.ts`
  - RW 文件历史同步、类型过滤和记录处理。

- `src/sdk/ring-ble/businessMetrics.ts`
  - 各协议数据向统一业务指标归一化。

### 3.3 状态层

- `src/stores/ring.ts`
  - 当前设备、连接状态、标准化数据、最新指标和历史数据的统一 store。

- `src/stores/user.ts`
  - 原页面使用的兼容字段和用户业务状态。

### 3.4 重点页面

- `src/pagesA/mines/connectDevice.vue`：扫描和连接。
- `src/pagesA/mines/device.vue`：设备信息、单独读取电量/版本、逐项实时指标验证、前端诊断日志。
- `src/pages/mine/mine.vue`：我的页面连接状态入口。
- `src/pages/awareness/awareness.vue`：首页/感知页和健康数据概览。
- `src/pages/health/health.vue`：健康评分和健康详情入口。
- `src/pagesA/healths/deviceData.vue`：实时健康测量流程。
- `homeDetail/`：睡眠、活动、压力和生命体征详情。

## 4. 已经完成的工作

### 4.1 L19 协议封装

- 原 L19 的扫描、连接、命令、解析和历史读取已迁移到统一 SDK。
- 原页面通过 `useRingBLE.ts` 兼容层调用统一 SDK。
- 旧字段别名已保留，例如心率、血氧、HRV、压力和体温相关字段。
- 相关 parity 测试覆盖了协议、adapter、store、兼容层和主要页面调用。
- 结论：代码迁移基本完成，但合并/发布前仍需拿 L19 真机做完整回归。

### 4.2 RW 扫描、连接通道与诊断能力

- SY03 可以扫描到。
- 已支持 A00A/B002 写入、B003 通知的实际设备通道。
- `setBLEMTU:fail:internal` 已按非致命错误处理，不再仅因 MTU 设置失败判定连接失败。
- 已增加服务、写特征、通知特征和候选通道诊断信息。
- 已增加 `[RW BLE]`、`[RW STORE]`、`[RW FLOW]`、`[RW PAGE]` 日志。
- 设备信息页支持查看、复制和清空日志，解决了只靠单张截图无法还原时序的问题。
- 早期 `ringDiagnosticLog.js is not defined` 的打包引用问题已经解决，后续真机已经能够导出完整日志。

### 4.3 RW 电量

- 电量请求、解析、store 归一化和设备信息页展示链路已打通。
- 用户在真机阶段确认过电量正常。
- 后续心率相关修改未主动改变电量协议，但最新最终包仍应重新读一次电量，防止共享状态改动带来回归。

### 4.4 最新心率修复

真机日志证明设备已经返回有效实时心率：

```text
21:52:06  key=0x0224 value=73
21:52:11  key=0x0224 value=75
21:52:14  key=0x0224 value=76
21:52:29  页面仍提示设备响应超时
```

已定位为“设备回包正常，但页面使用的 adapter waiter 没有消费到 store 已收到的数据”。最新代码已完成：

- `src/pagesA/mines/device.vue`
  - 单指标页面从统一共享数据流等待结果，不再依赖某个 adapter 实例的 waiter。
  - 只接受当前测量开始时间之后的数据。
  - 只接受指标对应的 AppRealTime key。
  - 成功、失败或超时后发送停止测量。

实时 key 当前定义为：

| 指标 | 实时 key |
| --- | --- |
| 心率 | `0x0224` |
| 血压 | `0x0231` |
| 体温 | `0x0230` |
| 血氧 | `0x024E` |
| 压力 | `0x024F` |
| HRV | `0x0269` |
| 血糖 | `0x026C` |

### 4.5 `0x0503` 历史心率误解析

真实回包：

```text
ab110009de9505031031e2aa454a00
```

其中 `0x0503` 是历史心率记录，数据结构按当前真机证据为：

```text
时间戳 4 字节 + 心率 1 字节 + 保留位 1 字节
31 e2 aa 45       4a            00
```

`0x4A=74` 才是心率。旧解析把时间字段中的 `0x31` 当成状态前缀，错误取出 `0xE2=226`。

已在 `src/sdk/ring-ble/rw/parser.ts` 修复，并增加真实包回归测试。页面实时测量也已限制只能由 `0x0224` 完成，`0x0503` 不会再冒充实时结果。

### 4.6 页面、编码和包体

- 主要健康详情路由已恢复并加入静态路由校验。
- 前端源码和构建产物增加了已知乱码片段检查。
- 最新微信构建产物：
  - `dist/build/mp-weixin`
  - 主包：1,030,076 bytes，约 1006 KB
  - 主包剩余空间：约 1042 KB
  - 总产物：约 1141 KB
- 当前不存在主包超过 2 MB 的发布阻塞。

### 4.7 后端健康文案中文兜底

后端 `E:\qkeer\code\wechatAdmin\admin_fastapi\app\api\app.py` 已增加：

- `LEVEL_TEXT_MAP`
- `MOJIBAKE_TEXT_REPLACEMENTS`
- `localize_level_text()`
- `localize_payload_levels()`
- `localized_success()`

2026-07-13 继续扩展了后端兜底范围：

- `/health/index`、`/health/report`、睡眠/活动健康内页和 `/data/vitalSign`、`/data/balanceScore`、压力/运动/睡眠详情接口返回前会做中文归一化。
- 可将 `Needs improvement`、`Good`、`Excellent`、`No change`、`high/low/inactive` 等常见算法英文翻译为中文。
- 可将历史乱码常量如“保持不变、小时、分钟、放松、正常、中等、偏高、深睡、浅睡、清醒、小睡”等修正为中文。
- `admin_fastapi/scripts/verify_rw_health_sync.py` 已增加文案归一化断言，并通过回归。
- `admin_fastapi/scripts/check_health_text_response.py` 可在本地 `--sample-only` 验证兜底，也可在后端部署后带小程序用户 token 扫关键 `/app/health/*` 和 `/app/data/*` 健康接口。

注意：这项是后端源码改动，必须部署/重启 `admin_fastapi` 后小程序才能看到新版返回；页面仍需真机/接口联调复验。

### 4.8 RW 请求收敛与实时/历史拆分

2026-07-13 已完成两项代码收敛：

- `readRwHealthData()` 现在只发送对应的 `0x02xx` AppRealTime key，不再夹带 `0x05xx` 历史记录读取。
- RW 业务后台刷新改为默认关闭，App `onShow`、失败恢复和 60 秒维持检查不会再对 RW 自动发起隐藏刷新；页面显式读取和 L19 原生命周期行为保持不变。
- 如确有调试需要，可通过 `rwBackgroundRefreshEnabled: true` 显式开启旧后台机制，生产默认值为 `false`。
- `legacyRoutes.parity.ts` 已约束共享页面生命周期不能显式开启 `rwBackgroundRefreshEnabled`、`includeRealtimeMetrics`、`includeHistorySnapshot` 或 `realtimeMetricNames`。
- `useRingBusinessController.parity.ts` 已约束 `resumeBusinessAutoRefresh()` 在 RW 后台刷新关闭时只清理 timer 并返回，不会调度隐藏读取。
- RW adapter、业务控制器定向回归、全量 BLE parity 和类型检查均已通过。

### 4.9 扫描页连接状态统一

2026-07-13 修复了扫描页“同一个设备身份即显示已连”的问题。现在扫描结果显示“已连”必须同时满足：

- 统一 SDK/store 的 `isConnected` 为真。
- 业务通信字段完整，`isReady` 为真。
- 扫描行与当前设备身份一致。

如果只是扫描到之前绑定的同一枚戒指，但通信尚未 ready，按钮会显示“连接”并允许用户重新连接，不再与首页/我的页面状态矛盾。

### 4.10 连接超时与并发连接收敛

2026-07-13 已补齐连接生命周期清理：

- 同一个 RW 目标的并发连接调用复用同一个 `connectInFlight`，底层只执行一次 `createBLEConnection`。
- 手动取消连接会立即使当前 attempt token 失效，并关闭正在连接的目标 deviceId。
- 连接超时、连接完成但通信未 ready、自动恢复超时都会调用 `closeBLEConnection`，不再只结束页面 Promise。
- 页面/SDK cleanup 会关闭尚未完成的连接，晚到成功回调不能重新写入 deviceInfo 或连接状态。
- 已增加并发双连接、取消晚到回调和 cleanup 晚到回调回归测试。
- 同一 SY03 在不同页面可能分别使用绑定稳定 MAC、旧 platform deviceId 和新扫描 platform deviceId。不同 platform id 的连接请求会等待当前连接：如果当前连接成功且稳定身份相同，直接复用完整 ready 结果，不再第二次 `createBLEConnection`。
- 如果当前请求使用的旧 platform id 连接失败，等待中的新 platform id 仍会继续发起连接，不会因为稳定身份相同而错误复用失败结果。
- 已增加“同稳定 MAC + 不同 platform id 成功只建连一次”和“旧 id 失败后新 id 接续成功”的连接回归。

### 4.11 设备信息页共享数据流改造

最后一轮代码已将设备信息页的电量和版本等待逻辑改为消费统一 store 数据流：

- 电量只接受本次读取开始之后、范围为 `0-100` 的有效值，不把充电状态码或旧缓存当成新电量。
- 固件/软件版本从统一 normalized/received 数据中汇总，不再依赖页面局部 adapter waiter。
- L19 仍保留固件和软件两类读取命令；RW 只发送一条 `sendFirmwareVersion()`，并从同一响应取得 firmware、software/UI 字段，避免重复请求。
- 相关类型检查、`legacyRoutes.parity.ts` 定向校验和全量 BLE parity 已通过。

这部分修改已进入当前 `dist/build/mp-weixin`；编译后的 `pagesA/mines/device.js` 已核对存在 RW 单版本命令和 L19 双版本命令分支。

### 4.12 正式健康测量页 RW 单指标化

`src/pagesA/healths/deviceData.vue` 原先通过完整 `refreshHealthData` 执行 RW 单项测量。页面在 8 秒后切换阶段时，内部 35 秒刷新任务仍可能继续，最终触发 fallback 并重复发送命令。

当前已改为：

- L19 保持原 `requestMetricRefresh(refreshHealthData, legacyCommand)` 流程。
- RW 只走 `controlRwHealthData()` + `readRwHealthData()` 前台单指标链路。
- 每个指标在 1.5、4、10、20、30 秒读取；得到真实 store 数据或进入下一阶段时立即发送停止控制。
- RW 血氧恢复完整 35 秒窗口，不再因为已经取得心率而在 8 秒后跳过。
- canonical 数据和 L19 兼容别名可能连续进入 store，阶段切换现在使用单一可取消 timer，一个结果只能启动一次下一指标。
- 页面进入时清理旧 `active_measure`、`active_OxyGenMeasure`、`active_Temperature` 事件，防止旧结果结束本次测量。

类型检查、legacy routes 定向契约、全量 BLE parity、微信构建和产物校验均已通过。编译后的 `pagesA/healths/deviceData.js` 已确认包含 RW 控制/读取与读取时间表，不包含旧 `RW_OPTIONAL_SPO2_TIMEOUT_MS`。

### 4.13 主动测量与历史记录严格隔离

`useRingMetricReadings.ts` 过去按 `rw_health_data + 指标名` 取值，测量期间晚到的 `0x05xx` 历史记录可能被当成本次实时结果；当 normalized 记录缺少平铺 value 时，旧兜底还可能从六字节数据中取到时间戳字节。

当前规则：

- 传入 `since > 0` 的主动测量只接受指标对应的 AppRealTime key：心率 `0x0224`、血压 `0x0231`、体温 `0x0230`、血氧 `0x024E`、压力 `0x024F`、HRV `0x0269`、血糖 `0x026C`。
- `0x0503/0x0504/0x0508/0x0509/0x050A/0x050D/0x0510` 继续用于历史记录或读取状态，但不能完成当前主动测量。
- 六字节记录缺少平铺 value 时，按已确认的 `状态/时间字段 + 数值 + 保留位` 布局读取数值，不再扫描“第一个非状态字节”。
- 已加入真实 ACK：`ab1100030d13050410`、`ab1100036d17050a10`、`ab1100035d15050d10`、`ab1100030d1c051010`、`ab110003cddd051011`。这些包必须保持 `rw_health_data_ack` 且无 value。
- 已用真实历史心率包验证：测量开始后晚到的 `0x0503` 不能完成心率；`0x0224` 缺少平铺 value 时仍正确得到 73，不会取到时间字节 226。

### 4.14 睡眠、活动和压力详情页历史后端闭环

2026-07-13 审计发现：三个详情页虽然会调用 `readLocalData()`，SDK 的 `uploadHistoricalRecords` 默认只写小程序本地缓存；真正调用 `/app/data/sync` 的代码散落在首页和生命体征页 watcher 中。直接进入睡眠、活动或压力详情时，不能保证首页 watcher 存活，因此页面可能在设备同步结束后立即请求到旧后端数据。

当前已完成：

- `useRingHistoryUpload.ts` 新增 `submitRingHistorySyncResult()`，把同步结果转换成 L19 兼容的后端字段并显式等待 `/app/data/sync`。
- 睡眠、活动和压力详情页现在按“设备按类型同步 -> 有效记录提交后端 -> 更新最后同步时间 -> 刷新详情 API”的顺序执行。
- 纯文件元数据、空列表和无法转换成健康字段的记录不会发送空请求。
- 查看历史日期时不会把全局 `lastReadTimestamp` 倒退；后端对同设备、同时间记录已有更新兜底，重复触发不会无限插入重复数据。
- 页面只通过 `useRingBLE` 和 `useRingBusinessData` 访问 BLE/状态；编译产物已核对不直接依赖 `sdk/ring-ble` adapter。
- 新增共享提交函数和三个正式页面静态契约回归，类型检查及全量 parity 已通过。

这项证明“页面到后端的调用闭环”已完成，不证明 SY03 的真实睡眠/活动/压力文件内容已经解析正确；后者仍需真机导出文件列表、上传包和最终页面结果。

### 4.15 FastAPI 睡眠枚举与 RW 分段时长

2026-07-13 对照旧 Java 权威实现 `SleepType.java` 后确认，睡眠阶段协议为：

| 数值 | 阶段 |
| --- | --- |
| `0` | 无效 |
| `1` | 清醒 |
| `2` | REM/快速眼动 |
| `3` | 浅睡 |
| `4` | 深睡 |
| `5` | 小睡 |

FastAPI 原先两处映射误写为 `2=浅睡、3=深睡、4=REM`，会导致 L19 与 RW 的睡眠汇总都错位。当前后端已完成：

- `app/services/health.py` 使用与 Java/L19 一致的数值映射。
- `app/api/app.py` API 层复用 service 映射，不再维护第二份枚举。
- `/app/data/sync` 收到 RW 的 `sleepDuration` 后，会把“阶段、开始时间、结束时间、分钟数”幂等写入现有 `sleep_record`；同一用户、阶段和开始时间重复同步执行更新，不重复插入。
- 没有 `sleepDuration` 的 L19 通用记录继续沿用原 `health_raw` 流程，不改变旧协议提交语义。
- 新增 `admin_fastapi/scripts/verify_rw_health_sync.py`，覆盖 Java 枚举一致性、合法/非法状态、分段时长转换，以及内存 SQLite 重复写入更新。
- 已核对当前 MySQL 实际 `sleep_record` 列为 `id,user_id,date_ref,type,start_time,end_time,sleep_time`，满足新逻辑；Python 编译和回归脚本通过。

注意：这是后端源码改动，必须部署/重启 `admin_fastapi` 后体验版才能使用。SY03 文件中真实睡眠阶段与时长仍需真机确认。

### 4.16 RW 血糖和血压持久化、汇总与展示

2026-07-13 已补齐此前“前端能解析和提交、生产数据库静默丢弃”的断点：

- `admin_fastapi/app/services/health.py` 新增启动期幂等 schema 扩展：
  - `health_raw`：`blood_sugar`、`systolic`、`diastolic`。
  - `health_daily_summary`：三项指标各自的 `avg/min/max`，共 9 列。
- migration 使用 SQLAlchemy inspector 检查列，首次启动补列，后续启动不重复执行；并发启动遇到另一进程已补列时会重新检查后继续。
- `/app/data/sync` 接收并校验：血糖 `1-33.3 mmol/L`、收缩压 `50-260 mmHg`、舒张压 `30-180 mmHg`。
- 原始健康记录改为按“用户、设备 MAC、记录时间”显式幂等 upsert；同一时间先提交心率、再提交血糖时会合并为一行，不再依赖数据库实际不存在的唯一索引。
- 日汇总生成血糖、收缩压、舒张压的平均/最小/最大值，但不把 RW 扩展指标强行加入原 L19 健康评分。
- `/app/data/vitalSign` 返回血糖、血压、三条趋势数据及统计字段。
- 正式生命体征页对 RW 按选中日期同步 6 类历史：心率、血氧、HRV、体温、血糖、血压；每类同步结果显式等待后端提交。
- 当前设备为 RW 且存在真实值时，生命体征页显示血糖和血压摘要；L19 或无数据时不显示扩展面板。
- `verify_rw_health_sync.py` 已覆盖 schema 首次迁移/重复迁移、合法/越界数值、原始数据合并和睡眠分段幂等写入。

部署注意：当前运行中的 MySQL 还没有这些扩展列。部署并重启新版 `admin_fastapi` 时会自动迁移；上线前仍应备份数据库，并在启动日志后核对 12 个新列。小程序端代码已进入最新 `dist/build/mp-weixin`。

## 5. 未完成和已知问题

### 5.1 P0：RW 连接仍不稳定

现象：

- 扫描页显示“已连接”。
- 首页仍显示“连接中”。
- 我的页面显示“未连接”或“重连中”。
- 有时约一分钟后连接超时，再开始重连。

说明物理 BLE 连接、SDK ready 状态、store 状态和页面状态仍没有完全统一。

扫描页假显示“已连”的 UI 判断已于 2026-07-13 修复；剩余工作是真机确认物理连接和 ready 状态是否还会掉线或超时。

排查重点：

1. `useRingBleSdk.ts` 中平台连接成功、服务发现成功和 adapter ready 的状态推进。
2. `useRingBleStoreSdk.ts` 是否始终复用默认单例。
3. `ringStore.isConnected`、`deviceInfo.deviceId/serviceId/cmdCharId/dataCharId` 是否同时完成。
4. 页面恢复连接时是否用稳定 MAC 去直接调用平台连接 ID。
5. `connectDevice.vue` 的“已连接”是否只依据本页局部状态，而首页依据统一 store。
6. 切页、onHide/onShow 时是否暂停或重新触发了恢复连接。

完成标准：连接成功后连续 3 分钟不自动断开，扫描页、首页、我的页面和设备信息页同时显示已连接；切换页面不重复建连。

### 5.2 P0：RW 请求收敛需要最新包真机确认

业务控制器仍保留三类可选定时器代码：

- `RW_PENDING_RETRY_INTERVAL_MS = 8000`，最多 8 次。
- `RW_EMPTY_REFRESH_RETRY_INTERVAL_MS = 5000`，最多 5 次。
- `RW_MAINTAIN_REFRESH_INTERVAL_MS = 60000`。

位置：`src/composables/useRingBusinessController.ts`。从 2026-07-13 起，生产默认由 `rwBackgroundRefreshEnabled = false` 禁用，不应再自动执行。

旧包日志在单项心率开始前出现过 `pendingWaiters: 19`，并同时生成血氧、体温、血糖、HRV、压力和血压 pending。最新包应不再出现这组后台请求，需要真机冷启动后确认。

如果最新包仍出现大量日志，按以下顺序排查：

1. 确认体验版确实来自最新 `dist/build/mp-weixin`，并彻底结束过旧小程序进程。
2. 搜索是否有页面显式传入 `rwBackgroundRefreshEnabled: true`。
3. 检查具体页面是否主动调用了整批 `refreshHealthData({ includeRealtimeMetrics: true })`。
4. 只保留“用户主动点一次 -> 启用一个指标 -> 读取一个指标 -> 收到结果 -> 停止”的链路。

### 5.3 P0：实时与历史命令拆分需要最新包真机确认

旧实现的 `buildRwHealthDataReadCommandVariants()` 会同时发送 `0x05xx` 和 `0x02xx`。2026-07-13 已修改为只返回 AppRealTime 命令：

- 实时指标：只发送 `0x02xx`。
- 历史数据：继续走 `readLocalData()/syncHistory()` 文件同步链路。
- 删除历史指标：仍保留 `0x05xx/0x30` 删除语义。

最新心率单项测试应只看到 `0x0224`，不能再看到 `heart_rate/direct-read` 或 `0x0503` 读取。

如果仍收到设备主动上报的 `0x0503`，解析器会按历史记录结构处理，且页面实时 waiter 不会使用它完成测量。

### 5.4 P0：最新心率页面修复尚未真机确认

最新构建已经包含共享数据流 waiter 修复，但用户尚未对这版返回真机结果。

期望日志顺序：

```text
[RW PAGE] single-metric-start target=heart_rate
[RW BLE] ... control-enable
[RW BLE] ... app-realtime-read key=0x0224
[RW BLE] rx-parsed ... value=真实心率
[RW STORE] parsed-accepted
[RW PAGE] single-metric-result
[RW BLE] ... control-disable
```

收到 `rx-parsed value=73` 后，页面应在很短时间内显示 `73 bpm`，不能再等到 35 秒超时。

### 5.5 P1：血氧和其他实时指标未完成

- 仓库保存了真实血氧样例 `ab11000997fc024e0031d5ac7e6300`，key 为 `0x024E`，当前 parser 可得到 `99%`，并有 parity 覆盖。
- 对现有全部附件日志复查后，最近几轮只有 `blood_oxygen/app-realtime-read` 发送，没有任何 `rx-parsed key=590` 的真实血氧回包。因此最近失败点在“设备未上报”，不是页面把已有 `0x024E` 数值写错。
- SY03 对 `0x0609` 控制有时只返回 `ab11000351e6060900`，包内不带指标号。adapter 已按串行写队列把该通用 ACK 关联回具体指标、controlKey 和启用/停止动作，下一轮日志不再显示 `name=unknown`。
- 判定规则：出现 `rw_health_data_control_ack name=blood_oxygen status=success enabled=true` 只能证明启动命令已确认；必须随后出现 `rw_health_data name=blood_oxygen key=590 value=...`，才能认定设备返回了血氧。
- 如果控制 ACK 成功但 35 秒内没有 `key=590`，先检查佩戴和传感器采集条件，并保留完整日志；不要改 parser 猜一个血氧值。
- 正式“设备测量数据”页现在同样等待完整 35 秒并使用单指标控制/读取；诊断页成功但正式页不显示时，应同时检查 `deviceData.vue` 的 store 数据和提交记录，不再归因于旧的 8 秒跳过逻辑。
- 体温、HRV、压力、血压、血糖都必须逐项测试。
- 不要一次点击“读取全部”，否则无法判断哪个控制 key、读取 key 或解析规则错误。
- 每个指标必须记录：控制命令、读取命令、原始回包、解析值、store 值和页面值。
- RW 血糖/血压的 schema 迁移、同步、汇总、查询和条件展示代码已完成，但当前运行中的后端尚未部署迁移，也没有真实设备数值证明缩放与单位正确，仍不能算真机验收完成。

### 5.6 P1：固件和软件版本未完成验收

- 设备历史上可以返回固件和软件版本。
- 当前页面已从共享 store 等待版本字段，但最近真机没有确认最终页面展示。
- RW `parseFirmwareVersionFrame()` 会在同一响应中填充 `firmwareVersion`、`softwareVersion` 和 `uiVersion`，页面目前只发送一条 `sendFirmwareVersion()`；L19 保持原双命令语义。
- 真机需要确认该单条 RW 命令同时产生固件和软件版本；若设备只返回其中一项，再依据真实回包补充，不要恢复无依据的并发命令变体。

### 5.7 P1：RW 历史数据未完成真机闭环

已有代码：文件列表、文件上传、类型过滤、文本记录归一化、时间字段兼容、睡眠/活动/压力详情页提交后刷新 API，以及 RW 显式睡眠分段幂等写入 `sleep_record`。

未完成：

- SY03 实际文件列表是否完整返回。
- 睡眠、步数/活动、心率、血氧、HRV、压力、体温文件的真实格式。
- 历史上传触发频率和去重。
- 页面进入睡眠等详情时是否只读所需类型。
- 真实记录能否按预期写入 store、后端并驱动页面图表；调用链代码已闭环，但尚无 SY03 真机数据证明字段格式正确。

### 5.8 P1：健康页乱码和英文仍需部署后复验

前端截图曾出现乱码和 `Needs improvement`。

2026-07-13 已完成：

- `app/api/app.py` 已扩展后端中文归一化，覆盖 `status/level/*Level` 以及普通字符串中的已知算法英文和乱码片段。
- `/health/index`、`/health/report`、睡眠/活动健康内页、`/data/vitalSign`、`/data/balanceScore`、压力/运动/睡眠详情接口已接入本地化返回。
- `verify_rw_health_sync.py` 已增加 `Needs improvement`、`No change`、乱码“小时/放松”、风险等级和趋势文案断言。
- `app/api/app.py` 中旧版重复定义的 `score_level()`、`health_index_payload()`、`trend_chart()` 等已清理，仅保留当前生效实现和独立的 `health_report_payload()`。

剩余工作：

- 部署/重启新版 `admin_fastapi` 后，在小程序健康页和睡眠、活动、压力、生命体征详情页逐页确认。
- 若算法服务返回新的英文枚举或描述，需要按真实返回继续补 `LEVEL_TEXT_MAP`。

### 5.9 P2：部分内页需要逐页验收

睡眠、活动、压力和生命体征路由已做恢复，但仍需确认：

- 页面能进入且无 not-found。
- 日期参数正确。
- 空数据时不报错、不显示乱码。
- RW 历史数据返回后图表和摘要更新。
- L19 原逻辑没有被 RW 兼容改动破坏。

## 6. 最新构建与自动化结果

截至本文创建时，最新本地结果：

| 检查 | 结果 |
| --- | --- |
| `npm.cmd run type-check` | 通过；2026-07-13 再次覆盖新增 RW 防请求风暴静态约束 |
| RW parser 定向 parity | 通过 |
| legacy routes 定向 parity | 通过 |
| `npm.cmd run build:mp-weixin` | 通过 |
| `npm.cmd run verify:mp-weixin-artifact` | 通过 |
| `npm.cmd run check:mp-weixin-size` | 通过，主包约 1006 KB |
| `npm.cmd run verify:ring-ble` | 通过，2026-07-13 最终全量 parity 耗时约 216 秒 |
| `.venv\Scripts\python.exe scripts\verify_rw_health_sync.py` | 通过，覆盖 RW/L19 健康同步、血糖/血压 schema 与后端健康文案中文兜底 |
| `.venv\Scripts\python.exe scripts\check_health_text_response.py --sample-only` | 通过，验证健康接口文案中文兜底扫描器 |

最新心率页面消费、历史心率解析、实时/历史命令拆分及 RW 后台请求收敛均已进入全量 parity 覆盖。

当前发布基线：

- 当前源码与 `dist/build/mp-weixin` 已同步，包含设备信息页共享电量/版本消费、RW 单版本命令、三个详情页历史后端闭环及生命体征页血糖/血压扩展。
- `type-check`、legacy routes 定向 parity 和全量 `verify:ring-ble` 均通过；全量 parity 最终耗时约 216 秒。
- 微信构建、产物指纹检查和包体检查通过；主包 1,030,076 bytes（约 1006 KB），剩余约 1042 KB，总产物 1,168,009 bytes（约 1141 KB）。
- 构建期间出现过开发者工具锁定 dist 的提示，但后续 `verify:mp-weixin-artifact` 已通过，未发现旧产物残留。

构建命令：

```powershell
cd E:\qkeer\code\wechatProgram\smart-wearable-devices-next
npm.cmd run type-check
npm.cmd run verify:ring-ble
npm.cmd run build:mp-weixin
npm.cmd run verify:mp-weixin-artifact
npm.cmd run check:mp-weixin-size
```

也可以直接执行完整发布校验：

```powershell
npm.cmd run verify:ring-ble:release
```

微信开发者工具导入目录：

```text
E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin
```

构建时会出现 Sass deprecated 和 QKeer V2 circular chunk 警告，目前不阻塞构建。清理 dist 时偶尔提示目录被微信开发者工具锁定，产物校验会检查是否有旧文件残留；构建前最好关闭开发者工具对该目录的占用。

## 7. RW 真机验收顺序

真机跟测的可打勾版本见 `docs/RW_TRUE_DEVICE_CHECKLIST_2026-07-13.md`。本节保留概要顺序和关键通过标准。

每次测试必须先彻底关闭旧小程序进程，再打开最新体验版，避免旧 JS 定时器继续运行。

### 7.1 准备

1. 导入最新 `dist/build/mp-weixin`。
2. 真机冷启动小程序。
3. 清空设备信息页诊断日志。
4. 确保附近只操作目标 SY03，避免误连 L19。
5. 每完成一项就复制完整日志，不只截某一帧。

### 7.2 验收清单

| 顺序 | 项目 | 通过标准 |
| --- | --- | --- |
| 1 | 扫描 | 10 秒内稳定出现 SY03，设备身份不重复 |
| 2 | 连接 | 连接后 3 分钟不掉线，所有页面状态一致 |
| 3 | 页面切换 | 首页、健康、我的、设备信息来回切换不重连 |
| 4 | 电量 | 单击一次读取，页面显示 0-100%，无请求风暴 |
| 5 | 固件/软件版本 | 页面显示真实版本，不显示 `-` 或假值 |
| 6 | 心率 | 只测心率，回包值、store 值、页面值一致 |
| 7 | 血氧 | 只测血氧，回包值、store 值、页面值一致 |
| 8 | 体温 | 只测体温，单位和缩放正确 |
| 9 | HRV | 只测 HRV，不使用心率或时间字段代替 |
| 10 | 压力 | 只测压力，范围和页面状态正确 |
| 11 | 血压 | 收缩压/舒张压结构正确 |
| 12 | 血糖 | 缩放和单位正确 |
| 13 | 历史文件列表 | 主动同步一次，只返回一次完整列表 |
| 14 | 睡眠历史 | 睡眠详情页能展示真实记录 |
| 15 | 活动历史 | 步数、卡路里、活动时间正确 |
| 16 | 断线恢复 | 关蓝牙/远离后提示明确，恢复后只重连一次 |
| 17 | L19 回归 | 扫描、连接、电量、版本、健康和历史均不回归 |

最新包单测心率时，重点确认：

- 日志中只出现 `heart_rate/app-realtime-read`，不再出现 `heart_rate/direct-read`。
- 读取 key 为 `0x0224`，不再主动读取 `0x0503`。
- 返回真实值后出现 `[RW PAGE] single-metric-result`，随后发送 `control-disable`。
- App 前后台切换及页面切换后，不应自动出现其他六项健康指标的 pending/tx 日志。

## 8. 推荐接手执行计划

### 接手第一天必须做的事

1. 阅读本文，不以旧聊天截图或 `RING_BLE_CURRENT_STATUS.md` 的历史重试方案作为实现依据。
2. 备份并保留当前工作目录；本项目当前不是一个干净、可直接按提交号恢复的交接基线，不要执行 `git reset --hard` 或覆盖未提交文件。
3. 当前 `dist` 已包含最后一轮电量/版本改动；若接手后又修改源码，必须重新执行 `npm.cmd run verify:ring-ble:release`。
4. 冷启动最新体验版，只测试 SY03 的连接、电量、版本、心率四项。
5. 每项导出完整诊断日志，必须包含 tx、rx、parsed、store、page 五层，不只提供截图。
6. 四项稳定后再开始血氧，禁止同时读取全部指标。

### 第一阶段：冻结自动化，稳定单链路

1. 用最新包确认 RW 后台请求默认关闭。
2. 确认实时读取只发送 `0x02xx`。
3. 统一四个页面的连接状态来源。
4. 只验证电量和心率，确认连接与数据消费链路稳定。

### 第二阶段：逐项补齐实时指标

按血氧、体温、HRV、压力、血压、血糖顺序逐项处理。每一项都必须先拿真实原始包，再写解析和测试，不能根据猜测复用其他指标格式。

### 第三阶段：历史数据

确认文件列表、上传协议、记录格式、采集频率和去重，再接睡眠/活动/生命体征页面。历史同步不应依赖高频轮询。

### 第四阶段：页面和后端收尾

1. 清理 `admin_fastapi/app/api/app.py` 重复函数和乱码。
2. 所有健康接口统一中文兜底。
3. 逐页验证健康页和详情页。
4. 最后做 L19 与 RW 双设备回归和发布包校验。

### 工期估算

以下估算建立在“SY03 和 L19 真机可持续使用、每轮能拿到完整日志、协议方能确认未知字段”的前提下：

| 阶段 | 预计时间 | 主要不确定性 |
| --- | --- | --- |
| 连接稳定、电量/版本/心率复验 | 0.5-1.5 个工作日 | 手机 BLE 差异、设备固件主动断开 |
| 血氧及其他实时指标逐项完成 | 1-3 个工作日 | 每个指标真实回包格式是否一致 |
| RW 历史文件、睡眠和活动闭环 | 2-5 个工作日 | 文件格式、上传触发和去重协议尚未完整确认 |
| 后端中文兜底部署后页面复验 | 0.25-0.5 个工作日 | 取决于后端部署窗口和页面覆盖速度 |
| L19/RW 双设备最终回归发布 | 0.5-1 个工作日 | 真机覆盖和微信体验版验证 |

乐观约 4 个工作日，正常约 6-10 个工作日。若缺少真实设备、完整日志或协议字段说明，时间无法可靠承诺。

## 9. 当前工作区与交接风险

- 工作目录位于父级仓库之下，当前 `git status` 将 `smart-wearable-devices-next` 整体显示为未跟踪目录，并且同级旧工程还有其他未提交修改。
- 不应把父级仓库当前 HEAD 当作本项目可恢复基线；交接前建议由项目负责人单独初始化/纳管新工程并提交一个明确基线。
- 不要回退或覆盖同级 `smart-wearable-devices` 的修改，它是旧工程且存在独立工作内容。
- 微信开发者工具可能锁住 `dist/build/mp-weixin`。构建清理失败时先关闭开发者工具，再重新执行完整发布校验。
- 诊断日志会包含 deviceId、serviceId、characteristicId 和原始健康包，外发前应按项目隐私要求处理。

## 10. 开发约束

- 不要在页面中重新实现 BLE 协议。
- 不要为解决一个 RW 问题破坏 L19 兼容接口。
- 不要用假数据或默认 0 伪装设备成功返回。
- ACK、pending、历史记录和实时数值必须明确区分。
- 连接状态只能有一个可信来源，页面局部状态不能覆盖 SDK/store 状态。
- 真机问题必须保留完整时序日志：tx、tx-ok/tx-fail、rx、rx-parsed、store accepted、page result。
- 每次改协议解析都要用真实 hex 增加 parity 测试。
- 每次发布前必须执行类型检查、产物校验和主包大小检查。

## 11. 完成定义

只有同时满足以下条件，项目才能标记为完成：

1. L19 真机完整验收通过。
2. SY03/RW 连接连续稳定，跨页面状态一致。
3. 电量、固件、软件、心率、血氧和设备支持的其他指标逐项通过。
4. 睡眠、活动和生命体征历史能从设备同步并正确展示。
5. 所有健康页面和后端接口无乱码、无未翻译英文。
6. 断线、重连、解绑、切换设备不产生脏状态和请求风暴。
7. 全量自动化检查通过。
8. 微信主包低于 2 MB，体验版和正式发布包一致。

## 12. 一句话交接

L19 SDK 化基本完成；RW 已打通扫描、通信和电量，设备也已经真实返回心率，自动请求及实时/历史混发已在代码中收敛。当前仍卡在最新包真机确认、连接状态统一和各指标逐项验收；接手人应先稳定单连接、单指标链路，再扩展到血氧和历史数据。
