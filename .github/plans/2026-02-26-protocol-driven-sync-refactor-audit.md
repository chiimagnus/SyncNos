# Audit Report: Protocol-Driven Sync Refactor (2026-02-26)

- Plan: `.github/plans/2026-02-26-protocol-driven-sync-refactor-implementation-plan.md`
- Repo root: `/Users/chii_magnus/Github_OpenSource/SyncNos`
- Scope: `Extensions/WebClipper/` (MV3 extension)
- Auditor workflow: `plan-task-auditor` (findings-first, then fix+validate)

## TODO Board (7 Tasks)

- [x] Task 1: 引入 Conversation Kind 协议与 Registry（含运行时加载顺序）
- [x] Task 2: 重构 Notion DB Manager 为“dbSpec 驱动”
- [x] Task 3: Notion Sync Service 支持 kind/pageSpec 驱动的页面属性（chat 有 AI，article 无 AI）
- [x] Task 4: Notion Sync Orchestrator 按 kind 路由 dbId + kind 驱动同步策略（破坏性重构）
- [x] Task 5: 断连清理与备份 allowlist 支持多 dbSpec.storageKey
- [x] Task 6: Obsidian 导出改为 kind 驱动 folder（需要同时改 popup.js 调用点）
- [x] Task 7: 清理散落的 sourceType 判断（把分流逻辑全部收口到 kind）

## Task-To-File Map

- Task 1:
  - `Extensions/WebClipper/src/shared/conversation-kind-contract.js`
  - `Extensions/WebClipper/src/shared/conversation-kinds.js`
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/ui/popup/popup.html`
  - `Extensions/WebClipper/tests/smoke/conversation-kinds.test.ts`
- Task 2:
  - `Extensions/WebClipper/src/sync/notion/notion-db-manager.js`
  - `Extensions/WebClipper/tests/smoke/notion-db-manager.test.ts`
- Task 3:
  - `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
  - `Extensions/WebClipper/tests/smoke/notion-sync-service.test.ts`
- Task 4:
  - `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.js`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
  - `Extensions/WebClipper/tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`
- Task 5:
  - `Extensions/WebClipper/src/bootstrap/background-router.js`
  - `Extensions/WebClipper/src/storage/backup-utils.js`
  - `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
  - `Extensions/WebClipper/tests/smoke/backup-utils.test.ts`
- Task 6:
  - `Extensions/WebClipper/src/ui/popup/popup-obsidian.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
  - `Extensions/WebClipper/tests/smoke/popup-obsidian.test.ts`
- Task 7:
  - `Extensions/WebClipper/src/ui/popup/popup-core.js`

## Findings (Open First)

## Finding F-01

- Task: `Task 2: 重构 Notion DB Manager 为“dbSpec 驱动”`
- Severity: `Medium`
- Status: `Open`
- Location: `Extensions/WebClipper/src/sync/notion/notion-db-manager.js:92`
- Summary: `ensureDatabaseSchema()` 只检查 “属性是否存在”，不检查 “属性类型是否正确”（例如 AI 已存在但不是 multi_select），可能导致数据库 schema 不符合预期而后续 sync 报错。
- Risk: `已有 Notion DB 被手动改坏字段类型时，新的 best-effort 修复不生效，导致同步失败或写入异常。`
- Expected fix: `对关键属性（chat 的 AI）增加类型校验；类型不匹配时尝试 patch（或至少返回 false 触发上层处理）。`
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-db-manager.test.ts`
- Resolution evidence: `TBD`

## Finding F-02

- Task: `Task 6: Obsidian 导出改为 kind 驱动 folder（需要同时改 popup.js 调用点）`
- Severity: `Low`
- Status: `Open`
- Location: `Extensions/WebClipper/src/ui/popup/popup-obsidian.js:5`
- Summary: `popup-obsidian.js` 在模块初始化时缓存了 `const kinds = NS.conversationKinds || null`；若未来调整 popup 脚本加载顺序，可能导致 folder 路由回退到默认值而不易察觉。
- Risk: `运行时依赖 load order 的隐式耦合增加；未来扩展更多 kind 时更容易踩坑。`
- Expected fix: `在 `folderForConversation()` 内按调用时读取 `globalThis.WebClipper.conversationKinds`，避免模块级缓存。`
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/popup-obsidian.test.ts`
- Resolution evidence: `TBD`

## Finding F-03

- Task: `Task 4: Notion Sync Orchestrator 按 kind 路由 dbId + kind 驱动同步策略（破坏性重构）`
- Severity: `Low`
- Status: `Open`
- Location: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.js:116`
- Summary: `clearCachedDatabaseId()` 的 fallback 分支仍引用 `notionDbManager.DB_STORAGE_KEY`（已不再导出），虽然不会影响现有路径，但属于死代码/漂移点。
- Risk: `后续维护者误以为该字段仍存在；未来重构时造成错误假设。`
- Expected fix: `改为读取 `DEFAULT_DB_STORAGE_KEY`（若存在）或仅使用传入的 `storageKey` + hardcoded fallback。`
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/notion-sync-orchestrator-kind-routing.test.ts`
- Resolution evidence: `TBD`

## Fix Log

- (Pending) Fix findings in severity order: F-01 -> F-02 -> F-03

## Validation Log

- (Pending) After fixes:
  - `npm --prefix Extensions/WebClipper run test`
  - `npm --prefix Extensions/WebClipper run check`

## Final Status And Residual Risks

- Status: `Audit completed; fixes pending.`
- Residual risks: `None recorded yet (pending fix phase).`

