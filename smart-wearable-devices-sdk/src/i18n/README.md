# App 界面语言（i18n）

支持 **简体中文 / 繁体中文 / English**，默认「跟随系统」。不使用 `vue-i18n`：微信小程序生产环境禁止
`new Function`，而 vue-i18n 9 在运行时编译消息。这里是一套约 100 行的自研实现。

## 基本用法

```ts
import { t, useI18n } from '@/i18n';

// <script setup> 里拿响应式上下文
const { t, tt, locale, mode, setLocaleMode } = useI18n();

t('睡眠时长');                         // 普通文案：key 就是简体中文原文
t('目标已保存，{warning}', { warning }); // 占位符
tt(normalizeHealthText(value));        // 展示边界：只翻译已知 key，未知文本原样返回
```

- `t(key)`：查当前语言包，缺失时原样返回 key（即简体中文）。
- `tt(value)`：给服务端文案、映射函数返回值用；未知文本不翻译。
- `te(key)`：当前语言是否已有该 key。
- 模板里直接 `{{ t('...') }}` / `:prop="t('...')"`，切换语言会自动重渲染。

## key 约定

1. **默认用简体中文原文作 key**：`t('设置目标')`。这样未翻译的页面也能安全回退中文，支持分批迁移。
2. **同一中文在不同语境下英文不同**时，用 `@` 开头的语义 key：`t('@action.open')`。
   `@` key 必须在 `locales/zh-Hans/semantic.json` 里登记简体值，否则中文环境会直接显示 key。
3. **变量用占位符**：`t('{value}公斤', { value })`，不要字符串拼接。
4. **不要把翻译结果参与逻辑判断**：分支判断始终用稳定的 key / 枚举原始值，
   `t()` 只包裹最终展示值（例如 `profile.vue` 用 `item.key` 而不是 `item.label`）。
5. `.parity.ts`、协议日志、服务端下发的自由文本一律不翻译。

## 语言包放置规则（微信小程序主包体积）

uni-app 按**源码目录**决定产物落在主包还是分包，因此语言包必须物理放在对应分包目录内。
分包的边界是 `pages.json` 里 `subPackages[].root`，不是 `src/pagesA` 这种上层目录——`src/pagesA`
本身不是分包，`src/pagesA/echartOptions/` 之类会进主包。

| 位置 | 归属 | 说明 |
|---|---|---|
| `src/i18n/locales/{en,zh-Hant}/{common,main}.json` | 主包 | 通用按钮/单位 + 首页、健康、我的、登录页 |
| `src/i18n/locales/zh-Hans/semantic.json` | 主包 | 只存 `@` 语义 key 的简体值 |
| `src/pagesA/mines/i18n/locales/{en,zh-Hant}.json` | `pagesA/mines` 分包 | 我的 / 设置 / 设备连接 |
| `src/pagesA/healths/i18n/locales/{en,zh-Hant}.json` | `pagesA/healths` 分包 | 设备测量 / 检测报告 / 健康详情 |
| `src/homeDetail/i18n/locales/...` | `homeDetail` 分包 | 详情页 |
| `src/pages/family/i18n/locales/...` | `pages/family` 分包 | 家人关怀 |

- 主包页面只能引入 `@/i18n`；分包页面额外在 `<script setup>` 顶部加一行副作用引入
  `import '@/pagesA/mines/i18n/pack';`（healths / homeDetail / family 各用自己那一份）。
- **主包页面绝不能 import 分包 pack**，否则会把分包语言包拉回主包（主包上限 2 MB）。
- 两个分包共用的 key、以及主包文件（含 `common/`、`components/`、`pagesA/echartOptions/`）会用到的 key
  一律放主包；只属于一个分包的 key 才放该分包，否则运行时解析不到、静默回退中文。
  `npm run i18n:check` 会按真实分包根校验字面量 `t('...')`，但 `t(变量)` 的动态 key 仍需人工确认。

## 新增页面接入步骤

1. 主包页面：直接 `import { useI18n } from '@/i18n'`；分包页面先加副作用引入。
2. 模板静态文案改 `{{ t('原文') }}`，静态属性改 `:prop="t('原文')"`。
3. `<script setup>` 里的 `uni.showToast/showModal/showLoading`、校验文案、`formatBleErrorMessage`
   的中文兜底都包 `t()`。
4. 列表/常量改为 `computed`，否则切换语言不会刷新。
5. 默认导航栏页面调用 `usePageTitle(() => t('页面标题'))`。
6. 在 `locales/en/main.json` 与 `locales/zh-Hant/main.json` 补齐翻译。
7. 跑 `npm run i18n:check` 和 `npm run type-check`。

## 术语表

| 简体 | 繁體（台灣） | English |
|---|---|---|
| 设置 | 設定 | Settings |
| 设备 | 裝置 | Device |
| 数据 | 資料 | Data |
| 信息 | 資訊 | Info |
| 用户 | 使用者 | User |
| 保存 | 儲存 | Save |
| 连接 | 連線 | Connect |
| 绑定 | 綁定 | Bind |
| 电量 | 電量 | Battery |
| 步数 | 步數 | Steps |
| 热量 | 熱量 | Calories |
| 压力 | 壓力 | Stress |
| 网络 | 網路 | Network |
| 默认 | 預設 | Default |
| 请稍后重试 | 請稍後重試 | Please try again later |

品牌名 QKeer / L19 / AI / OTA 不翻译。英文用简洁祈使句，数字与单位之间留空格。
