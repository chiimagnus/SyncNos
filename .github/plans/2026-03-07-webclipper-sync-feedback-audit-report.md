# WebClipper Sync Feedback 审计报告

**Plan file:** `.github/plans/2026-03-07-webclipper-sync-feedback-implementation-plan.md`

**Repo root:** `/Users/chii_magnus/Github_OpenSource/SyncNos`

## TODO board (5 tasks)

- `Task 1`: 共享 sync job 持久化模型与纯读取状态接口
- `Task 2`: conversations sync controller 的挂载恢复、attach、dismiss 持久化清理
- `Task 3`: 共享反馈 UI 的进度与错误展示语义
- `Task 4`: conversations sync feedback 的恢复/接管/持久化回归测试
- `Task 5`: compile/test/build 全量回归与残留清理

## Task-to-file map

- `Task 1`
  - `Extensions/WebClipper/src/sync/sync-job-store.ts`
  - `Extensions/WebClipper/src/sync/notion/notion-sync-job-store.ts`
  - `Extensions/WebClipper/src/sync/obsidian/obsidian-sync-job-store.ts`
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
  - `Extensions/WebClipper/src/sync/obsidian/obsidian-sync-orchestrator.ts`
  - `Extensions/WebClipper/src/sync/background-handlers.ts`
  - `Extensions/WebClipper/src/bootstrap/background-services.ts`
  - `Extensions/WebClipper/src/entrypoints/background.ts`
  - `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`
  - `Extensions/WebClipper/src/sync/repo.ts`
- `Task 2`
  - `Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`
- `Task 3`
  - `Extensions/WebClipper/src/ui/conversations/ConversationSyncFeedbackNotice.tsx`
- `Task 4`
  - `Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`
  - `Extensions/WebClipper/tests/smoke/conversations-scene-popup-escape.test.ts`
- `Task 5`
  - `Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`
  - `Extensions/WebClipper/tests/smoke/conversations-sync-feedback.test.ts`

## Findings

## Finding F-01

- Task: `Task 2 / Task 5`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/conversations/useConversationSyncFeedback.ts`
- Summary: `前台 attach 既有 running job 仍依赖 message.includes('sync already in progress') 的英文字符串判断。`
- Risk: `后台如果调整错误文案、未来接入国际化、或改成其它 wording，attach 逻辑会静默退化回 failed，重新出现用户这次报告的错误进度与错误态。`
- Expected fix: `将 already-running 语义收敛为结构化错误 code，经 background handler -> repo unwrap -> controller 传递，不再由前台解析英文文案。`
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/conversations-sync-feedback.test.ts tests/smoke/background-router-notion-sync.test.ts tests/smoke/background-router-obsidian-sync.test.ts`
- Resolution evidence: `已在 sync orchestrator 中抛出 code=sync_already_running，并通过 background handler extra -> repo unwrap -> controller error.extra.code 贯通；targeted tests 已覆盖 Notion/Obsidian route 与 conversations attach。`

## Finding F-02

- Task: `Task 1`
- Severity: `Low`
- Status: `Resolved`
- Location: `.github/plans/2026-03-07-webclipper-sync-feedback-implementation-plan.md`
- Summary: `实施计划的 Non-goals 仍写着“不引入新的后台持久化机制”，但当前已引入共享 sync job store，并把 Obsidian 状态也持久化到了 storage.local。`
- Risk: `计划文档与已交付实现不一致，会误导后续继续按旧边界做维护或复盘。`
- Expected fix: `更新 implementation plan 的 Non-goals / Approach / Task 1 描述，使其反映当前已落地的共享持久化 job store。`
- Validation: `rg -n '不引入与 \`chrome.storage.local\` 并列的全新持久化后端|共享 sync job store|hydrate 既有任务' .github/plans/2026-03-07-webclipper-sync-feedback-implementation-plan.md`
- Resolution evidence: `已更新 plan 中 Non-goals、Approach 与 Task 1 files/step 描述，使其与当前实现一致。`

## Fix log

- 已修复 F-01：将 `sync already in progress` 从字符串约定提升为 `sync_already_running` 结构化错误码，并补 route/controller 回归测试。
- 已修复 F-02：同步更新 implementation plan，明确本轮通过共享 sync job store 持久化 Notion / Obsidian 状态。

## Validation log

- `npm --prefix Extensions/WebClipper run compile`
  - Pass
- `npm --prefix Extensions/WebClipper run test -- tests/smoke/conversations-sync-feedback.test.ts tests/smoke/background-router-notion-sync.test.ts tests/smoke/background-router-obsidian-sync.test.ts`
  - Pass
- `rg -n '不引入与 \`chrome.storage.local\` 并列的全新持久化后端|共享 sync job store|hydrate 既有任务' .github/plans/2026-03-07-webclipper-sync-feedback-implementation-plan.md`
  - Pass
- `npm --prefix Extensions/WebClipper run test`
  - Pass
- `npm --prefix Extensions/WebClipper run build`
  - Pass

## Final status and residual risks

- 当前 findings 2 条，均已解决。
- popup / app 现在都会从后台持久化 job snapshot 恢复 running/terminal sync feedback，并在用户 dismiss 或 success 自动消失时同步清理后台状态。
- 残余风险：前置配置型失败（例如未连接 Notion）仍属于本地即时错误，不会像后台 job 一样跨刷新恢复；当前这是有意保留的边界，因为这类失败没有对应后台 job 快照。
