# WebClipper Notion P1 审计报告

- 审计方式：`plan-task-auditor`
- 计划文件：`.github/docs/WebClipper-Notion同步体验问题梳理.md`
- 审计范围：P1 / Task 1-6
- 仓库根目录：`/Users/chii_magnus/Github_OpenSource/SyncNos`

## TODO 看板（6 个任务）

- [x] Task 1: 为 Notion 同步增加轻量性能诊断打点
- [x] Task 2: 为 append/delete 建立统一按需退避策略
- [x] Task 3: 将 conversation 同步改为有限并发
- [x] Task 4: 移除 orchestrator 固定 item 间隔
- [x] Task 5: 提高清空 page children 并发并校验限流风险
- [x] Task 6: 完成 P1 compile/test/build 回归验证

## 任务到文件的映射

- Task 1
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- Task 2
  - `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
  - `Extensions/WebClipper/tests/smoke/notion-sync-service-rate-limit.test.ts`
- Task 3
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Task 4
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Task 5
  - `Extensions/WebClipper/src/sync/notion/notion-sync-service.ts`
  - `Extensions/WebClipper/tests/smoke/notion-sync-service-rate-limit.test.ts`
- Task 6
  - 验证命令，无新增代码文件

## 发现项

## 发现 F-01

- 任务：`Task 3: 将 conversation 同步改为有限并发`
- 严重级别：`Medium`
- 状态：`Resolved`
- 位置：`Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts:370`
- 摘要：`并发 worker 会同时调用 writeRunningJob()，但 job store 写入没有串行化，异步 storage.set 可能乱序落盘。`
- 风险：`运行中 notice 的 done/total、currentStage、currentConversationId 可能短暂倒退或跳回旧状态，影响进度展示可信度。`
- 预期修复：`将 running job 写入串行化，保证写入按调用顺序落盘。`
- 验证：`npm --prefix Extensions/WebClipper run test -- background-router-notion-sync`
- 解决证据：`在 writeRunningJob() 内引入 runningJobWriteChain 串行化写入，并补充了“keeps running job progress monotonic”回归测试；针对性测试、全量 test、compile、build 均通过。`

## 发现 F-02

- 任务：`Task 5: 提高清空 page children 的并发并校验限流风险`
- 严重级别：`Low`
- 状态：`Resolved`
- 位置：`Extensions/WebClipper/tests/smoke/notion-sync-service-rate-limit.test.ts:147`
- 摘要：`当前限流测试覆盖了 delete 重试，但没有断言 clearPageChildren 的并发上限，无法防止未来误改并发配置。`
- 风险：`后续若并发常量继续被抬高或 parallelEach 逻辑漂移，测试不会及时发现，可能放大 Notion 限流风险。`
- 预期修复：`新增一个 clearPageChildren 并发上限测试，验证 delete 同时在飞请求数不超过当前配置。`
- 验证：`npm --prefix Extensions/WebClipper run test -- notion-sync-service-rate-limit`
- 解决证据：`新增 clearPageChildren 并发上限测试，显式断言最多只会并发调度 6 个 delete；针对性测试、全量 test、compile、build 均通过。`

## 修复日志

- 已修复 F-01：为 running job 写入增加串行化链路，并新增并发进度单调性测试。
- 已修复 F-02：为 clearPageChildren 增加并发上限回归测试。

## 验证日志

- 审计修复后已执行
  - `npm --prefix Extensions/WebClipper run test -- background-router-notion-sync notion-sync-service-rate-limit` -> PASS
  - `npm --prefix Extensions/WebClipper run compile` -> PASS
  - `npm --prefix Extensions/WebClipper run test` -> PASS
  - `npm --prefix Extensions/WebClipper run build` -> PASS

## 最终状态与剩余风险

- 当前状态：`Resolved`
- 剩余风险：P1 范围内未发现新的阻塞问题；后续主要风险已经转移到 P2/P3 的 rebuild 策略和 warning 数据流改造。
