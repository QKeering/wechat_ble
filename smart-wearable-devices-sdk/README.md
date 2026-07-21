# smart-wearable-devices-next

新版本小程序前端工程。旧工程 `smart-wearable-devices` 保持不动，本工程用于重新梳理结构、协议 SDK 和页面逻辑。

接手前请先阅读：

- [`docs/RW_SDK_HANDOFF_2026-07-13.md`](docs/RW_SDK_HANDOFF_2026-07-13.md)：当前最清晰的项目交接文档，包含最终目标、已完成、未完成、待验证和接手顺序。
- [`docs/RW_TRUE_DEVICE_CHECKLIST_2026-07-13.md`](docs/RW_TRUE_DEVICE_CHECKLIST_2026-07-13.md)：RW/SY03 真机逐项验证清单。
- [`docs/PROJECT_HANDOFF_2026-07-12.md`](docs/PROJECT_HANDOFF_2026-07-12.md)：更长的历史交接记录，仅作为背景材料。

## Directory

```text
src/
  app/                  app initialization and global lifecycle
  api/                  backend API clients
  assets/               static assets
  features/
    ring/               ring business flows
    health/             health data business flows
    user/               user and binding flows
    pet/                future AI pet business
  pages/                uni-app pages
  sdk/
    ring-ble/           internal ring BLE SDK
  shared/               shared components and utilities
  stores/               Pinia stores
```

## Migration Rule

Do not import legacy pages or composables directly into this project. Copy and reshape logic by module, then verify each module before switching user-facing routes.
