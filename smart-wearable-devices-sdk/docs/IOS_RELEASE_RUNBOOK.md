# iOS App 打包发布手册

> 适用项目：`smart-wearable-devices-sdk`（uni-app 3 / Vue 3 CLI 项目）
> 打包方式：HBuilderX 云打包（本机版本 4.87+）
> Bundle ID（App ID）：`com.qkeer.smartring`
> DCloud AppID：`__UNI__31A4F95`

## 0. 前置条件（人工确认）

- [ ] Apple Developer Program 账号有效（公司主体需 D-U-N-S）
- [ ] DCloud 开发者中心已绑定 `__UNI__31A4F95`，且与 HBuilderX 登录账号一致（云打包强制）
- [ ] 上架中国大陆区 App Store 已取得工信部 App 备案号（未备案无法上架，周期最长，最先启动）

## 1. 证书与 Profile

### 1.1 本机已生成的材料

| 文件 | 用途 |
|---|---|
| `.ios-signing/ios-development.key` | 开发证书私钥（有密码） |
| `.ios-signing/ios-development.certSigningRequest` | 上传 Apple 创建开发证书 |
| `.ios-signing/ios-distribution.key` | 发布证书私钥（有密码） |
| `.ios-signing/ios-distribution.certSigningRequest` | 上传 Apple 创建发布证书 |
| `.ios-signing/passwords.txt` | 两把私钥的密码 |

`.ios-signing/`、`*.p12`、`*.mobileprovision` 均已 gitignore，**严禁提交**。

### 1.2 Apple 后台操作（人工）

1. Certificates, Identifiers & Profiles → Identifiers → 新建 App ID：
   - Bundle ID：`com.qkeer.smartring`（Explicit）
   - Capabilities 不需要额外勾选；蓝牙后台模式由 manifest 的 `UIBackgroundModes` 写入 Info.plist
2. Certificates → 分别创建：
   - **Apple Development**（上传 `ios-development.certSigningRequest`）
   - **Apple Distribution**（上传 `ios-distribution.certSigningRequest`）
3. Devices → 注册调试 iPhone 的 UDID（Apple Devices / Finder 里可查看）
4. Profiles：
   - Development profile：App ID + 开发证书 + 调试设备
   - App Store Distribution profile：App ID + 发布证书
5. 下载两个 `.cer` 和两个 `.mobileprovision`，放到 `.ios-signing/`

### 1.3 转 p12（本机执行）

```bash
cd smart-wearable-devices-sdk
# 开发证书
MSYS_NO_PATHCONV=1 openssl x509 -inform DER -in .ios-signing/ios_development.cer -out .ios-signing/dev-cert.pem
MSYS_NO_PATHCONV=1 openssl pkcs12 -export \
  -inkey .ios-signing/ios-development.key -in .ios-signing/dev-cert.pem \
  -name "QKeer iOS Development" -out .ios-signing/ios-development.p12 \
  -passout pass:<passwords.txt 里的开发密码>
# 发布证书同理，换成 ios-distribution.* 与 ios_distribution.cer
```

### 1.4 校验 Profile

```bash
MSYS_NO_PATHCONV=1 openssl smime -inform der -verify -noverify \
  -in .ios-signing/<xxx>.mobileprovision -out .ios-signing/profile.plist
```

在 `profile.plist` 中核对：`application-identifier` 以 `com.qkeer.smartring` 结尾、`ProvisionedDevices` 含调试机 UDID（仅 Development）、`ExpirationDate` 未过期、`DeveloperCertificates` 与所用证书匹配。

## 2. 打 iOS 自定义基座

标准基座**不包含** manifest 声明的 Bluetooth / Barcode / Record 模块、后台模式和隐私文案，必须打自定义基座。

1. HBuilderX 打开本项目（识别为 CLI 项目）
2. 运行 → 运行到手机或模拟器 → **制作自定义调试基座** → iOS
3. 选择 `ios-development.p12`（密码见 passwords.txt）+ Development profile
4. 打包完成后手机安装基座，运行 → 运行到 iOS 手机 → 选自定义基座

## 3. 真机回归清单（iOS 特有）

- [ ] 登录（手机号）
- [ ] 蓝牙权限弹窗文案正确；拒绝后引导跳 `app-settings:` 可用
- [ ] 搜索戒指：iOS 广播名可能为空，确认能扫到
- [ ] 连接/绑定/重连：确认从广播解析出稳定 MAC（看 BLE 诊断日志），否则绑定归属会退化
- [ ] 测量心率/血氧/体温 → 上报接口接受 iOS 的回退身份
- [ ] 切后台 30s 再回前台：链路无感恢复，历史同步补偿正常
- [ ] OTA（如适用）、历史数据同步
- [ ] 扫码（Barcode 模块 + 相机权限）
- [ ] 头像/反馈选图、保存二维码到相册（相册权限）
- [ ] 灵动岛 / 底部 home indicator 安全区

## 4. 云打包正式包

1. 版本号：`src/manifest.json` 的 `versionName` 对应 iOS 的 `CFBundleShortVersionString`；`versionCode` 对应 `CFBundleVersion`（构建号），**每次上传 TestFlight 都必须递增**，否则会报重复构建
2. 发行 → 原生App-云打包 → iOS
3. 选择 `ios-distribution.p12` + App Store Distribution profile
4. 勾选「自动生成启动图」；不勾选 IDFA
5. 产物为 `.ipa`
6. 上传前跑一遍 `npm run check:ios-packaging`（模块、后台模式、隐私文案、图标、ATS）

### 4.1 校验 IPA 的 ATS 配置（审核前必做）

manifest 已声明 `app-plus.distribute.ios.ATS.NSAllowsArbitraryLoads: false`，但 HBuilderX 云打包存在把它强改为 `true` 的已知问题，**必须解包确认**：

```bash
# 1. 解压 ipa（改成 .zip 用解压软件也可以）
unzip app.ipa -d ipa-check
# 2. 读取 Info.plist（Python 可直接解析二进制 plist）
python -c "import plistlib;d=plistlib.load(open('ipa-check/Payload/*.app/Info.plist','rb'));print(d.get('NSAppTransportSecurity'))"
```

期望输出包含 `'NSAllowsArbitraryLoads': False`。若为 `True`，该包不能提交审核，需改用离线打包或联系 DCloud 处理。

## 5. 上传与上架

1. Transporter（或 HBuilderX 内置上传）上传 `.ipa` 到 App Store Connect
2. TestFlight 内测通过后提交审核
3. 审核备注中写明：
   - 隐私政策 URL
   - App 隐私问卷：健康与健身数据、设备标识、手机号
   - 健康类说明：数据仅用于展示与健康管理，不做诊断
   - 蓝牙后台模式说明：保持与戒指连接以同步数据
   - AI 说明：读取哪些健康数据、是否发送外部 AI 服务、输出仅为趋势解读
   - 亲友共享：被关怀人如何授权、共享哪些指标、如何撤销

### 5.1 代码层面已处理的审核项

| 审核关注点 | 处理方式 |
|---|---|
| 内部 BLE 命令测试页 | `pagesA/mines/bleCommandDebug` 路由已从 `pages.json` 移除，使用指南/常见问题里的三连击入口已删除，页面不会打进包。文件保留在仓库，本地调试需要时临时加回路由 |
| 账户删除 | 「个人信息」页底部「注销账号」，二次确认后调用 `/app/user/cancelAccount`，并清理本地缓存 |
| 任意 HTTP 加载 | manifest 声明 `ATS.NSAllowsArbitraryLoads=false`；上传前按 4.1 解包核实 IPA |
| AI 医疗边界 | AI 入口下方固定展示“仅用于健康趋势参考，不构成医疗诊断或治疗建议” |
| 麦克风权限 | 仅 AI 语音问答使用（`Record` 模块 + 小程序页录音）。若后续下线语音功能，必须同时移除 `app-plus.modules.Record` 与 `NSMicrophoneUsageDescription` |
| 相机/相册 | 仅意见反馈图片上传与保存客服二维码，用途文案与功能一致 |

### 5.2 仍需人工准备的审核材料

- 稳定可用的测试账号（登录路径、测试数据）
- 实体 iPhone + 戒指的实拍配对/同步视频（硬件依赖类 App 必需）
- 亲友共享的授权/撤销流程说明与截图
- AI 数据流向说明（是否调用外部模型、是否留存）
- 确认审核期间后端 `https://sh.qkeering.com` 持续可用

## 6. 常见问题

| 现象 | 原因 |
|---|---|
| 基座里蓝牙/扫码不可用 | 用了标准基座，或自定义基座没选对模块 |
| 安装基座失败 / 设备不受支持 | Development profile 未包含该机 UDID |
| 云打包报证书错误 | 证书类型与 profile 不匹配（Development 证书不能配 App Store profile） |
| App Store 拒审隐私清单 | HBuilderX 版本过旧，需 4.24+（本机 4.87 满足） |
| 上架后发现搜索不到戒指 | 先看真机 BLE 日志，再决定是否改扫描过滤 |
