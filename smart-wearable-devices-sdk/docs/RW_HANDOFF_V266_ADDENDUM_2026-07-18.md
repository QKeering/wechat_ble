# RW Handoff V266 Addendum

Build tag: `rw-visible-build-tag-20260718-266`

本增量继续收口 RW 与 L19 的业务一致性，重点处理跨天睡眠的日期归属问题。
这版延续 v265 的首页同步、详情页后端接口展示、体温/HRV 兜底展示路径，并补齐睡眠跨天归属。

## 已完成

- 前端历史上传在没有显式 `dateRef` 时，跨天睡眠记录会使用 `endTime` 的日期作为归属日期。
- 后端 `admin_fastapi` 在接收睡眠同步记录时也做同样兜底：显式 `dateRef` 优先；否则跨天睡眠归属到醒来日期。
- 前端 parity 覆盖 `overnightSleepSubmitRecords`，证明跨天睡眠归属到醒来日期，同时不会覆盖设备/上游显式传入的 `dateRef`。
- 后端 RW 同步校验覆盖两种跨天场景：有 `endTime` 的跨天睡眠，以及只有 `recordTime + sleepDuration` 的跨天睡眠。

## 待真机验证

1. 我的页诊断面板 buildTag 为 `rw-visible-build-tag-20260718-266`。
2. 晚上佩戴后，次日进入睡眠页查询次日日期，应能看到昨晚跨天睡眠。
3. 如果数据库已有跨天睡眠记录，确认 `sleep_record.date_ref` 是否落在醒来当天，而不是入睡当天。

## 仍未完成

- RW 真机完整验收仍需日志证明：睡眠、活动、压力、生命体征历史同步均上传成功，并且业务页面都只通过后端接口展示稳定数据。
- 体温历史 `0x0508` 是否由 SY03 固件返回仍需继续依赖真机日志确认。
