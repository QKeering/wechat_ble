# RW 测试版上传说明 2026-07-20

BuildTag: `rw-visible-build-tag-20260720-2048`

## 推荐方式

用微信开发者工具打开项目根目录：

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next`

项目配置已指定：

- AppID: `wx52f427a73d7678cb`
- `miniprogramRoot`: `dist/build/mp-weixin/`

因此不要单独导入 `src`，也不要手动改根目录。微信开发者工具会按 `project.config.json` 使用已经构建好的 `dist/build/mp-weixin`。

## 上传前本地校验

在项目根目录执行：

`npm.cmd run verify:rw-test-release`

通过后再上传。当前已通过的关键结果：

- 主包约 `1330 KB`
- 主包剩余约 `718 KB`
- 38 个页面核心产物完整
- 静态资源缺失 0
- 非 `我的` 页面 RW 诊断入口 0
- 当前 buildTag: `rw-visible-build-tag-20260720-2048`

## 微信开发者工具上传备注建议

版本号建议：

`RW-20260720-2048`

项目备注建议：

`RW正式业务收口测试：我的页保留诊断，其他页面移除诊断入口；BH03扫描绑定；设备信息页空态收口。`

## 推荐上传操作

当前建议使用微信开发者工具右上角 `上传` 按钮发布测试版本。

开发者工具已能打开当前项目，确认左侧项目根为 `MP-WEIXIN`，右侧模拟器能进入首页后，点击右上角 `上传`，填写：

- 版本号：`RW-20260720-2048`
- 项目备注：`RW正式业务收口测试：我的页保留诊断，其他页面移除诊断入口；BH03扫描绑定；设备信息页空态收口。`

开发者工具底部代码质量里可能提示“主包应小于 1.5M”，这是质量建议；当前主包约 `1330 KB`，低于微信小程序主包 `2 MB` 发布限制。

## 备选 CLI 上传命令

本机已找到微信开发者工具 CLI：

`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`

如当前登录的微信开发者工具账号具备该小程序上传权限，可在项目根目录执行：

`"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" upload --project "E:\qkeer\code\wechatProgram\smart-wearable-devices-next" -v "RW-20260720-2048" -d "RW正式业务收口测试：我的页保留诊断，其他页面移除诊断入口；BH03扫描绑定；设备信息页空态收口。"`

该命令会真正上传版本；执行前需要确认微信开发者工具已登录正确账号，并且本地校验已通过。

注意：2026-07-20 本机曾尝试 CLI 上传，但开发者工具自动化端口长时间无响应，未生成 `upload-info` 文件。因此本次发测优先使用图形界面上传。

## 发给测试工程师的文件

如果需要文件留档，可使用：

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\release\rw-test-release-20260720-2048-mp-weixin.zip`

配套清单：

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\release\rw-test-release-20260720-2048.manifest.json`

说明文档：

- `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\docs\RING_BLE_RELEASE_CHECKLIST.md`
- `E:\qkeer\code\wechatProgram\smart-wearable-devices-next\docs\RW_TEST_RELEASE_2026-07-20.md`

## 测试重点

- `我的` 页面可以保留 RW 诊断按钮和日志能力。
- 首页、健康页、设备信息页、睡眠/活动/情绪/体征详情页不应出现 RW 诊断或协议测试入口。
- BH3/BH03 可以扫描并进入 RW 绑定链路。
- 设备信息页刷新无结果时显示 `暂未获取到设备信息，请稍后刷新`，不再显示 `已请求电量，等待设备返回`。
