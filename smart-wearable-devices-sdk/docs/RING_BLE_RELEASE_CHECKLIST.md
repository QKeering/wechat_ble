# Ring BLE Release Checklist

Current RW test build: `rw-visible-build-tag-20260720-2048`

Detailed release note: [RW_TEST_RELEASE_2026-07-20.md](./RW_TEST_RELEASE_2026-07-20.md)

Upload guide: [RW_TEST_UPLOAD_GUIDE_2026-07-20.md](./RW_TEST_UPLOAD_GUIDE_2026-07-20.md)

Mini Program artifact:

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\build\mp-weixin`

Release archive:

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\release\rw-test-release-20260720-2048-mp-weixin.zip`

Release manifest:

`E:\qkeer\code\wechatProgram\smart-wearable-devices-next\dist\release\rw-test-release-20260720-2048.manifest.json`

## Required Local Gates

Run this before handing the package to a tester:

`npm.cmd run verify:rw-test-release`

The command runs the following gates:

1. `npm.cmd run type-check`
2. `npm.cmd run build:mp-weixin`
3. `npm.cmd run verify:mp-weixin-artifact`
4. `npm.cmd run check:mp-weixin-size`
5. `npm.cmd run audit:rw-test-release`

Current verified result:

- Main package: `1361909 bytes` / about `1330 KB`
- Main package headroom: `735243 bytes` / about `718 KB`
- Route core artifacts: 38 pages, required `.js/.wxml/.json` files present
- Static asset references: 79 references, 0 missing
- Visible RW diagnostic/test entry outside `pages/mine/mine`: 0
- RW test release audit: passed
- Release archive: created and contains `app.json`, `pages/mine/mine.js`, `pagesA/mines/device.js`

## Release Scope

- RW SDK protocol exploration is paused while waiting for vendor engineer feedback.
- The `我的` page may keep RW diagnostic buttons, protocol probes, history sync tests, and log controls.
- Formal business pages must not expose RW diagnostic/protocol-test/self-check/log-copy UI.
- Formal pages should show normal empty states instead of command-level waiting text.

## Tester Checklist

### Scan And Bind

- SY03 can be scanned and bound.
- BH3/BH03 can be scanned and enters the RW bind path.
- BH3/BH03 connection should not immediately fail only because `0000B003` notify cannot be enabled.
- If BH3/BH03 fails, collect logs around:
  - `notify-primary-candidate-fail`
  - `notify-primary-fallback-enabled`
  - `connect-discover-fail`

### Formal Pages

- 首页 shows no RW diagnostic/protocol/self-check/log controls.
- 健康页 shows no garbled text or English fallback text.
- 我的 page keeps RW diagnostic tools by design.
- 睡眠、活动、情绪、体征、设备信息 pages can be opened without white screen.
- Missing device data uses normal empty states, not raw protocol/debug text.

### Device Info Page

Expected fields:

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

Expected empty/refresh behavior:

- Empty battery status displays `-`.
- Refresh without a result displays `暂未获取到设备信息，请稍后刷新`.
- The old text `已请求电量，等待设备返回` should not appear.

### Health Data Pages

- 心率详情页 can open and show valid values when data exists.
- 血氧详情页 can open and SpO2 values should be in a reasonable range.
- HRV/压力/体温详情页 can open and use normal empty states when no data exists.
- 睡眠详情页 can open; no sleep payload should not cause white screen.

## Known Non-Blocking Items

- RW sleep command confirmation is still pending vendor/SDK feedback.
- RW protocol command expansion is intentionally paused for this release.
- qkeer-v2 circular chunk warnings and Sass deprecation warnings are existing build warnings and do not block this test package.
