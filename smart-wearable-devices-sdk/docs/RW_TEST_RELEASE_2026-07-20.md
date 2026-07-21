# RW 测试发布说明 2026-07-20

BuildTag: `rw-visible-build-tag-20260720-2048`

发布产物：

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`

发测归档：

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\release\rw-test-release-20260720-2048-mp-weixin.zip`

发测清单：

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\release\rw-test-release-20260720-2048.manifest.json`

上传说明：

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\docs\RW_TEST_UPLOAD_GUIDE_2026-07-20.md`

## 本版目标

- RW SDK 底层协议细节暂不继续扩展，等待设备商工程师反馈。
- `我的` 页面保留 RW 诊断按钮、测试接口和日志能力，便于继续真机排查。
- 其他正式业务页面按正常用户体验收口，不能暴露 RW 诊断、协议测试、自检按钮或测试文案。
- 生成一个可交给测试工程师的微信小程序测试包。

## 本版已收口内容

- BH/BH3/BH03 设备允许进入 RW 扫描、识别、绑定链路。
- RW 连接发现阶段不再只依赖首个 `0000B003` notify 特征；会按发现到的 notify/indicate 候选逐个尝试。
- 设备信息页文案改为正式业务空态：
  - 电量状态无值时显示 `-`。
  - 刷新后仍无设备信息时显示 `暂未获取到设备信息，请稍后刷新`。
- 非 `我的` 页面发布产物已确认没有诊断/测试入口文案。
- 菜单箭头已使用 CSS 绘制，发布产物中未发现 `&gt;` / `&lt;` 转义残留。
- 发布产物静态资源引用完整，没有缺失图片。

## 构建与验证结果

推荐执行：

`npm.cmd run verify:rw-test-release`

该命令已执行并通过，内部包含：

1. `npm.cmd run type-check`
2. `npm.cmd run build:mp-weixin`
3. `npm.cmd run verify:mp-weixin-artifact`
4. `npm.cmd run check:mp-weixin-size`
5. `npm.cmd run audit:rw-test-release`

产物检查结果：

- 主包大小：`1361909 bytes`，约 `1330 KB`
- 主包剩余空间：`735243 bytes`，约 `718 KB`
- 路由核心产物：38 个页面，`.js/.wxml/.json` 均存在
- 静态资源引用：79 个，缺失 0 个
- 非 `我的` 页面诊断/测试文案残留：0 个
- RW 发测审计：通过
- 发测归档：已生成，并确认包含 `app.json`、`pages/mine/mine.js`、`pagesA/mines/device.js`

构建中仍有既有警告：

- qkeer-v2 vendor circular chunk warning
- Sass legacy JS API / `@import` deprecation warning

以上警告不阻断本次测试包生成。

## 测试工程师校验清单

### 1. 设备扫描与绑定

- 扫描页可搜索到 `SY03`。
- 扫描页可搜索到 `BH3/BH03`。
- `BH3/BH03` 点击连接后不应立即报 `RW notify failed char=0000B003`。
- 若连接失败，重点保留日志：
  - `notify-primary-candidate-fail`
  - `notify-primary-fallback-enabled`
  - `connect-discover-fail`

### 2. 首页正式业务展示

- 首页不显示 RW 诊断、协议、自检、复制日志、清空日志等测试入口。
- 首页连接状态与设备实际状态一致。
- 活动卡片展示步数、卡路里、活动时间时，不出现明显异常大值。
- 健康概览卡片没有乱码或英文兜底文案。
- 网络超时时提示应为用户可理解文案，不应暴露原始异常堆栈。

### 3. 健康详情页

- 心率详情页可进入，列表/图表正常展示。
- 血氧详情页可进入，血氧值应在合理范围内。
- HRV 详情页可进入；如无数据，应显示正式空态。
- 压力详情页可进入；如由 HRV 算法兜底，应确认后端返回与页面展示一致。
- 体温详情页可进入；如无数据，应显示正式空态。
- 睡眠详情页可进入；无睡眠数据时不应白屏。

### 4. 设备信息页

- 页面字段按正式业务展示：
  - 连接状态
  - 电量
  - 电量状态
  - 戒指大小
  - 设备版本
  - 固件版本
  - 软件版本
  - 序列号
  - 设备名称
  - Mac 地址
- 点击 `刷新设备信息` 后，电量/版本有值时能更新。
- 暂无结果时显示 `暂未获取到设备信息，请稍后刷新`，不要显示 `已请求电量，等待设备返回`。

### 5. 我的页面诊断保留范围

- `我的` 页面可以保留 RW 诊断面板和测试按钮。
- `我的` 页面可以保留日志清空、命令测试、历史同步等入口。
- 其他页面不应出现这些入口。

## 当前不作为阻塞项

- RW 睡眠底层命令仍等待设备侧或 SDK 反馈进一步确认。
- RW SDK 协议细节不在本轮继续扩展。
- 真机数据准确性以测试工程师实际佩戴、同步、后端入库和页面展示结果为准。
