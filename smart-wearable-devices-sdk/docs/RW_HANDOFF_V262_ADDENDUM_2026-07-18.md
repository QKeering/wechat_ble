# RW Handoff Addendum v262

Build tag: `rw-visible-build-tag-20260718-262`

## 本轮改动

- 恢复 `src/common/detailInfo.ts` 的健康说明弹窗文案，修复健康、睡眠、活动、压力、生命体征等说明页仍可能出现乱码的问题。
- 修复 RW parser 中用户可见的睡眠状态和健康数据状态提示乱码：
  - 睡眠状态：进入睡眠、浅睡、深睡、清醒、REM、退出睡眠、未知。
  - 测量状态：设备已确认测量请求、设备返回失败应答、设备未返回真实数值。
- 修复历史数据上传缺少设备 MAC 时的中文错误提示。
- 修复 RW 文本历史记录解析中的中文字段别名乱码，确保中文 `心率/血氧/体温/心率变异性/压力/血糖/血压/步数` 等 key 能进入统一字段。
- 调整历史数据上传的 `recordTime` 生成策略：优先使用可信 `unixTime/timestamp/startTimestamp` 格式化，只有缺少数字时间时才回退记录内已有字符串，降低“当前 20 点却落到 23 点”这类时间偏移。
- `audit:rw-l19` 新增核心可见文案乱码拦截，重点覆盖：
  - `src/common/detailInfo.ts`
  - `src/sdk/ring-ble/rw/parser.ts`
  - `src/composables/useRingHistoryUpload.ts`

## 仍未宣称完成

- RW = L19 的最终目标仍未完成，需要真机日志证明：
  - 首页同步后，业务详情页直接通过后端接口展示。
  - 心率、血氧、睡眠、活动、压力、HRV、体温等数据链路可闭环。
  - 未通协议命令需要继续按“我的页 RW 诊断”逐项验证。

## 下一轮真机测试重点

1. 确认我的页 build tag 为 `rw-visible-build-tag-20260718-262`。
2. 点开健康说明、生命体征说明、睡眠说明，确认不再出现乱码。
3. 继续复制我的页诊断日志，重点关注：
   - `metric:temperature`
   - `metric:hrv`
   - `metric:stress`
   - `history:sleep`
   - `history:activity`
   - `history:vital`
