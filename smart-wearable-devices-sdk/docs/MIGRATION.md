# Migration Plan

旧工程：`code/wechatProgram/smart-wearable-devices`

新工程：`code/wechatProgram/smart-wearable-devices-next`

## Principle

- 旧工程保持可运行，不直接在旧工程里重构。
- 新工程按模块复制和重塑逻辑。
- 每迁移一个模块，先保证新模块边界清晰，再接页面。
- 戒指、健康、用户、AI 宠物分别独立，不再把通信、数据处理、页面状态混在一个文件里。

## Target Layers

```text
pages/
  -> features/
     -> sdk/
     -> stores/
     -> api/
shared/
```

## Migration Order

1. `sdk/ring-ble`
   - 迁移当前旧蓝牙协议的命令、解析、发包、连接流程。
   - 保持不依赖页面。

2. `features/ring`
   - 封装戒指扫描、连接、同步、OTA、设备状态。
   - 对页面只暴露业务方法。

3. `stores`
   - 重新定义用户、设备、健康数据状态。
   - 旧 store 中的蓝牙状态和健康数据状态拆开。

4. `api`
   - 迁移后端请求封装。
   - 避免页面直接拼接上传数据。

5. `features/health`
   - 迁移首页、体征、睡眠、压力等健康数据处理。
   - 所有戒指原始数据通过 normalizer 后进入健康模块。

6. `pages`
   - 页面只做展示、交互和路由。
   - 不直接写蓝牙协议、不直接解析设备包。

7. `features/pet`
   - 第三方 AI 宠物设备后续单独接入。
   - 不混入 `ring-ble`。

## Current Status

- 新工程骨架已创建。
- `sdk/ring-ble` 已放入初始 SDK 边界。
- 依赖安装因 npm registry 访问权限限制暂未完成。
