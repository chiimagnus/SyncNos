# WebClipper Sync 模块化重构审计报告（Round 2）

- 审计方法：`plan-task-auditor`
- 计划文件：`.github/plans/2026-02-23-webclipper-sync-modularization-implementation-plan.md`
- 仓库根目录：`/Users/chii_magnus/Github_OpenSource/SyncNos`
- 审计范围：`Extensions/WebClipper`（仅 WebClipper）
- 阶段约束：先只读审计并落盘 findings，再进入修复

## TODO board（N=11）

1. Task 1 审计：消息契约集中化
2. Task 2 审计：剪贴板能力提取
3. Task 3 审计：会话文档构造器提取
4. Task 4 审计：Notion 同步状态映射提取
5. Task 5 审计：Obsidian 后台服务提取
6. Task 6 审计：Notion Job Store 提取
7. Task 7 审计：Notion Orchestrator 提取
8. Task 8 审计：Markdown Blocks 模块拆分
9. Task 9 审计：页面属性构建 DRY
10. Task 10 审计：图片上传升级逻辑拆分
11. Task 11 审计：全量回归与交付

## Task-to-file map

- Task 1: `Extensions/WebClipper/src/shared/message-contracts.js`, `Extensions/WebClipper/src/ui/popup/popup.js`, `Extensions/WebClipper/src/ui/popup/popup-notion.js`, `Extensions/WebClipper/src/bootstrap/background-router.js`, `Extensions/WebClipper/src/ui/popup/popup.html`
- Task 2: `Extensions/WebClipper/src/ui/popup/popup-clipboard.js`, `Extensions/WebClipper/src/ui/popup/popup.js`, `Extensions/WebClipper/src/ui/popup/popup-list.js`, `Extensions/WebClipper/src/ui/popup/popup-core.js`, `Extensions/WebClipper/src/ui/popup/popup.html`
- Task 3: `Extensions/WebClipper/src/ui/popup/popup-conversation-docs.js`, `Extensions/WebClipper/src/ui/popup/popup-export.js`, `Extensions/WebClipper/src/ui/popup/popup.js`, `Extensions/WebClipper/src/ui/popup/popup.html`, `Extensions/WebClipper/tests/smoke/popup-conversation-docs.test.ts`
- Task 4: `Extensions/WebClipper/src/ui/popup/popup-notion-sync-state.js`, `Extensions/WebClipper/src/ui/popup/popup.js`, `Extensions/WebClipper/src/ui/popup/popup-list.js`, `Extensions/WebClipper/src/ui/popup/popup.html`, `Extensions/WebClipper/tests/smoke/popup-notion-sync-state.test.ts`
- Task 5: `Extensions/WebClipper/src/sync/obsidian/obsidian-url-service.js`, `Extensions/WebClipper/src/bootstrap/background-router.js`, `Extensions/WebClipper/src/bootstrap/background.js`, `Extensions/WebClipper/tests/smoke/background-router-obsidian-open.test.ts`
- Task 6: `Extensions/WebClipper/src/sync/notion/notion-sync-job-store.js`, `Extensions/WebClipper/src/bootstrap/background-router.js`, `Extensions/WebClipper/src/bootstrap/background.js`, `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Task 7: `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.js`, `Extensions/WebClipper/src/bootstrap/background-router.js`, `Extensions/WebClipper/src/bootstrap/background.js`, `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`
- Task 8: `Extensions/WebClipper/src/sync/notion/notion-markdown-blocks.js`, `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`, `Extensions/WebClipper/src/bootstrap/background.js`, `Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`
- Task 9: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`, `Extensions/WebClipper/tests/smoke/notion-sync-service.test.ts`
- Task 10: `Extensions/WebClipper/src/sync/notion/notion-image-upload-upgrader.js`, `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`, `Extensions/WebClipper/src/sync/notion/notion-files-api.js`, `Extensions/WebClipper/src/bootstrap/background.js`, `Extensions/WebClipper/tests/smoke/notion-sync-service-image-upload.test.ts`, `Extensions/WebClipper/tests/smoke/notion-files-api.test.ts`
- Task 11: `Extensions/WebClipper/tests/smoke/*.test.ts`, `Extensions/WebClipper/tests/storage/*.test.ts`

## Findings（Open first）

## Finding F-01

- Task: `Task 1: 提取 runtime 消息类型与结果结构契约`
- Severity: `Low`
- Status: `Resolved`
- Location: `Extensions/WebClipper/src/ui/popup/popup-notion.js:209`
- Summary: Notion 连接按钮点击逻辑仍有一处硬编码消息类型字符串（`"getNotionAuthStatus"`），未复用共享契约常量。
- Risk: 当前功能不受影响，但后续若统一修改消息类型，Popup 内该路径会产生静默漂移，违背 Task1 的集中化目标。
- Expected fix: 将该调用改为 `notionTypes.GET_AUTH_STATUS`，与同文件其他 Notion 消息保持一致。
- Validation: `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-notion-sync.test.ts`
- Resolution evidence: `Extensions/WebClipper/src/ui/popup/popup-notion.js:209` 已改为 `send(notionTypes.GET_AUTH_STATUS)`；目标测试与全量测试均通过。

## Finding F-02

- Task: `Task 11: 全量回归验证（自动化 + 最小手工）`
- Severity: `Low`
- Status: `Deferred`
- Location: `.github/plans/2026-02-23-webclipper-sync-modularization-implementation-plan.md`
- Summary: 计划中的浏览器手工冒烟（popup 实际点击与重开恢复）在当前 CLI 审计环境不可直接执行。
- Risk: 自动化通过后仍存在极小概率的 UI 交互回归未被捕获。
- Expected fix: 由具备浏览器扩展运行环境的执行者补做三步手工冒烟并记录结果。
- Validation: `n/a (manual browser smoke required)`
- Resolution evidence: `Deferred by environment`

## Fix log

- F-01（Resolved）：`Extensions/WebClipper/src/ui/popup/popup-notion.js:209` 将硬编码 `getNotionAuthStatus` 改为共享契约 `notionTypes.GET_AUTH_STATUS`。

## Validation log（当前阶段）

- `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-obsidian-open.test.ts tests/smoke/background-router-notion-sync.test.ts tests/smoke/notion-sync-service.test.ts tests/smoke/notion-sync-service-image-upload.test.ts tests/smoke/notion-sync-service-markdown.test.ts tests/smoke/popup-conversation-docs.test.ts tests/smoke/popup-notion-sync-state.test.ts` -> PASS（27 tests）
- `npm --prefix Extensions/WebClipper run test -- tests/smoke/background-router-notion-sync.test.ts` -> PASS（5 tests）
- `npm --prefix Extensions/WebClipper run test` -> PASS（18 files, 70 tests）
- `npm --prefix Extensions/WebClipper run check` -> PASS（`[check] ok`）

## Final status and residual risks

- 当前状态：本轮 `plan-task-auditor` 已完成（审计 -> 落盘 -> 修复 -> 验证闭环完成）。
- 残余风险：F-02（手工冒烟待执行）。
