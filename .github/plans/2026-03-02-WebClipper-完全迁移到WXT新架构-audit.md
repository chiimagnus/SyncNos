# WebClipper 完全迁移到 WXT 新架构 - 审计报告（plan-task-auditor）

- 审计方式：`plan-task-auditor`
- 目标计划：`.github/plans/2026-03-02-WebClipper-完全迁移到WXT新架构-implementation-plan.md`
- 仓库根目录：`/Users/chii_magnus/Github_OpenSource/SyncNos`
- 范围：`Extensions/WebClipper/`

## TODO board (N=19)

1. Task1 baseline docs alignment - Completed
2. Task2 TS idb schema module - Completed
3. Task3 domains use TS openDb - Completed
4. Task4 migrate schema upgrades to TS - Completed
5. Task5 remove legacy schema injection - Completed
6. Task6 add TS events hub - Completed
7. Task7 remove legacy events hub - Completed
8. Task8 TS notion token handlers - Completed
9. Task9 TS obsidian settings store - Completed
10. Task10 notion sync TS wrapper - Completed
11. Task11 obsidian sync TS wrapper - Completed
12. Task12 TS runtime client content - Completed
13. Task12b deglobalize content bootstrap - Completed
14. Task13 remove legacy content entry - Completed
15. Task14 remove legacy background entry - Completed
16. Task15 remove legacy background router - Completed
17. Task16 collectors core to TS - Completed
18. Task17 site collectors to TS - Completed
19. Task18/19 protocols+export deglobalize - Completed with residual risk

## Task-to-file map

- Task1: `Extensions/WebClipper/AGENTS.md`
- Task2-5: `Extensions/WebClipper/src/platform/idb/schema.ts`, `Extensions/WebClipper/src/domains/backup/idb.ts`, `Extensions/WebClipper/src/domains/conversations/storage-idb.ts`, `Extensions/WebClipper/src/storage/schema.js`
- Task6-7: `Extensions/WebClipper/src/platform/events/hub.ts`, `Extensions/WebClipper/src/platform/messaging/background-router.ts`, `Extensions/WebClipper/src/domains/conversations/background-handlers.ts`, `Extensions/WebClipper/src/integrations/web-article/background-handlers.ts`
- Task8-9: `Extensions/WebClipper/src/domains/settings/background-handlers.ts`, `Extensions/WebClipper/src/integrations/notion/token-store.ts`, `Extensions/WebClipper/src/integrations/obsidian/settings-store.ts`
- Task10-11: `Extensions/WebClipper/src/domains/sync/background-handlers.ts`, `Extensions/WebClipper/src/integrations/notion/sync/orchestrator.ts`, `Extensions/WebClipper/src/integrations/obsidian/sync/orchestrator.ts`
- Task12-12b: `Extensions/WebClipper/src/platform/runtime/client.ts`, `Extensions/WebClipper/src/bootstrap/content.ts`, `Extensions/WebClipper/src/bootstrap/content-controller.ts`, `Extensions/WebClipper/entrypoints/content.ts`
- Task13: `Extensions/WebClipper/entrypoints/content.ts`, `Extensions/WebClipper/src/legacy/content-entry.ts`
- Task14-15: `Extensions/WebClipper/entrypoints/background.ts`, `Extensions/WebClipper/src/bootstrap/background.ts`, `Extensions/WebClipper/src/bootstrap/background-router.js`, `Extensions/WebClipper/src/legacy/background-entry.ts`, `Extensions/WebClipper/tests/smoke/background-router-*.test.ts`
- Task16-17: `Extensions/WebClipper/src/collectors/*`, `Extensions/WebClipper/tests/collectors/*`
- Task18: `Extensions/WebClipper/src/protocols/*.ts`, `Extensions/WebClipper/src/protocols/bootstrap.ts`
- Task19: `Extensions/WebClipper/src/export/bootstrap.ts`, `Extensions/WebClipper/src/domains/conversations/background-storage.ts`, `Extensions/WebClipper/src/export/notion/token-store.js`, `Extensions/WebClipper/src/bootstrap/background-storage.js`

## Findings (Open first)

## Finding F-01

- Task: `Acceptance / Task14`
- Severity: `High`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/legacy/README.md:1`
- Summary: `src/legacy/` 目录仍有遗留文件，未满足计划验收“`src/legacy/*` 清零”。
- Risk: 迁移状态与验收条件不一致，后续维护者会误判“仍保留 legacy 入口”。
- Expected fix: 删除 `Extensions/WebClipper/src/legacy/README.md`，并确认 `src/legacy/` 不再含运行时代码/文档残留。
- Validation: `rg --files Extensions/WebClipper/src/legacy`
- Resolution evidence: `Deleted Extensions/WebClipper/src/legacy/README.md; \`rg --files Extensions/WebClipper/src/legacy\` returns empty`

## Finding F-02

- Task: `Task1 docs baseline`
- Severity: `Medium`
- Status: `Resolved`
- Location: `Extensions/WebClipper/AGENTS.md:69`
- Summary: 文档仍引用已删除的 `src/bootstrap/background-router.js`。
- Risk: 后续开发按文档排障会定位到不存在路径，造成错误操作和重复问题排查。
- Expected fix: 更新 AGENTS 模块入口索引，替换为当前 TS router / bootstrap 实际路径，并删除已过时描述。
- Validation: `rg "background-router\.js|legacy/background-entry|legacy/content-entry" Extensions/WebClipper/AGENTS.md`
- Resolution evidence: `Updated Extensions/WebClipper/AGENTS.md module index to TS router/bootstrap paths; stale path grep returns empty`

## Finding F-03

- Task: `Acceptance / Task18-19`
- Severity: `High`
- Status: `Deferred`
- Location: `Extensions/WebClipper/src/bootstrap/background.ts:3`
- Summary: 运行时仍广泛依赖 `globalThis.WebClipper` 注入链路；当前扫描在 `src/` 中仍有 57 处相关引用。
- Risk: 仍存在全局顺序依赖（load-order coupling），不满足“去全局运行时 API”验收口径，且扩展新入口（new tab/web app）时容易出现隐性回归。
- Expected fix: 按域继续将 `src/export/*`, `src/collectors/*`, `src/ui/inpage/*`, `src/shared/*` 的 IIFE 全局 API 改为显式模块依赖，并从 `entrypoints/background.ts`/`entrypoints/content.ts` 中移除全局桥接。
- Validation: `rg "globalThis\.WebClipper|WebClipper\." Extensions/WebClipper/src -n | wc -l`
- Resolution evidence: `Current scan remains 57 references; requires multi-domain refactor beyond this batch`

## Fix log

- F-01: 删除 `Extensions/WebClipper/src/legacy/README.md`，清空 `src/legacy/` 目录。
- F-02: 更新 `Extensions/WebClipper/AGENTS.md` 的模块入口索引，移除已删除路径并同步当前 TS 路由/初始化入口。
- F-03: 标记为 Deferred（需继续推进 Export/Collectors/Inpage 全域去全局）。

## Validation log (current snapshot)

- `npm --prefix Extensions/WebClipper run compile` => PASS
- `npm --prefix Extensions/WebClipper run test --silent` => PASS (46 files / 177 tests)
- `npm --prefix Extensions/WebClipper run build` => PASS

## Final status and residual risks

- 当前实现已完成计划任务提交并修复 F-01/F-02，但与“全量去全局”最终验收仍有差距（F-03 Deferred）。
- 下一步需要按域继续拆分 `src/export/*`, `src/collectors/*`, `src/ui/inpage/*` 的 IIFE 全局依赖，再执行一次完整审计收口。
