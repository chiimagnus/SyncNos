# WebClipper 脚手架迁移审查报告（2026-03-02）

- Scope: `Extensions/WebClipper/`（MV3，WXT + 扩展内 Web App）
- Plans reviewed:
  - `.github/plans/2026-03-01-WebClipper脚手架迁移-implementation-plan.md`

---

## TODO board（23 tasks）

> 说明：这里的 “Done/Partial/Todo” 是审查结论，不等同于 implementation plan 文件中的标记状态。

- T01 包管理与脚本：Partial（WXT scripts 已加入，但 `dev/build` 仍指向 legacy build 链）
- T02 WXT 入口 Spike：Done（已完成验证；`.tmp-wxt-spike/` 已被 `.gitignore` 忽略）
- T03 固化 WXT 约定到方案：Done（入口约定已在 implementation plan 内固化）
- T04 in-place 引入 WXT：Partial（WXT 可 build，但默认 `npm run dev/build` 未切到 WXT）
- T05 manifest 权限对齐：Partial（权限对齐；但 WAR 可能缺失导致 inpage icon 回归风险）
- T06 app 壳与路由：Done
- T07 popup 打开 app：Done
- T08 legacy 适配层：Done（背景/内容脚本均为 static imports）
- T09 Firefox 最小闭环：Done（`.output/firefox-mv3/` 产物存在）
- T10 platform runtime/ports：Done
- T11 消息协议 TS 化：Done（TS contracts 与 legacy 对齐）
- T12 background 路由分层：Partial（已有 platform router + conversations handlers；sync/settings 等仍依赖 legacy fallback）
- T13 Conversations 读模型：Done
- T14 SyncJobs 状态页：Done
- T15 Settings 敏感字段：Done（不回显 token）
- T16 Conversations 写入替换：Done（IDB 优先 + legacy fallback）
- T17 Article Fetch 替换：Done
- T18 Notion OAuth 替换：Done
- T19 Backup/Import 替换：Done
- T20 Inpage 迁移：Done（Shadow DOM 版本存在）
- T21 删除旧构建脚本：Todo（仍依赖 `scripts/build.mjs` / `scripts/check.mjs`）
- T22 AMO source package：Partial（脚本仍打包 legacy build 链；未包含 WXT 关键文件）
- T23 更新 WebClipper AGENTS：Todo（文档与新命令/结构存在漂移）

---

## 执行清单（下一步怎么做）

> 你的问题“新插件能否融合之前 popup 面板？”：可以，推荐把旧 popup 的全部能力逐步迁入 `app.html`（popup 只保留快捷入口），以便未来自然扩展到更多路由/页面。

### P1（地基：WXT 接管 + 可加载）

- 统一工作流：把 `npm run dev/build/build:firefox` 切到 WXT（当前仍指向 legacy build 链）
- 补齐 manifest：`web_accessible_resources`（至少包含 `icons/icon-128.png`）
- 明确 Firefox / AMO source：source package 必须包含 WXT 关键文件（`wxt.config.ts` / `entrypoints/*`）

### P2（平台层：可观测、可渐进替换）

- background router：把 sync/settings 的 message types 也迁出薄 handler（允许委托 legacy store/orchestrator），缩小 fallback 范围

### P3（功能融合：旧 popup → app）

- Conversations：多选/全选、Delete、Export（Single/Multi Markdown）、Sync（Notion/Obsidian）
- Settings：Notion OAuth + Parent Page、Obsidian Settings/Paths + Test Connection、Fetch Current Page、Inpage Visibility
- About：可最后迁入

---

## Task-to-file map（简表）

- T01: `Extensions/WebClipper/package.json`
- T02: `Extensions/WebClipper/.tmp-wxt-spike/`（ignored）
- T03: `.github/plans/2026-03-01-WebClipper脚手架迁移-implementation-plan.md`
- T04-T05: `Extensions/WebClipper/wxt.config.ts`、`Extensions/WebClipper/entrypoints/*`
- T06: `Extensions/WebClipper/entrypoints/app/*`、`Extensions/WebClipper/src/ui/app/*`
- T07: `Extensions/WebClipper/entrypoints/popup/*`
- T08: `Extensions/WebClipper/src/legacy/*`
- T09: `Extensions/WebClipper/.output/firefox-mv3/manifest.json`（产物验证）
- T10: `Extensions/WebClipper/src/platform/runtime/*`
- T11: `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`
- T12: `Extensions/WebClipper/src/platform/messaging/background-router.ts`、`Extensions/WebClipper/entrypoints/background.ts`
- T13-T16: `Extensions/WebClipper/src/domains/conversations/*`、`Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
- T14: `Extensions/WebClipper/src/domains/sync/repo.ts`、`Extensions/WebClipper/src/ui/app/routes/SyncJobs.tsx`
- T15: `Extensions/WebClipper/src/domains/settings/sensitive.ts`、`Extensions/WebClipper/src/ui/app/routes/Settings.tsx`
- T17: `Extensions/WebClipper/src/integrations/web-article/*`
- T18: `Extensions/WebClipper/src/integrations/notion/*`、`Extensions/WebClipper/tests/integrations/notion-oauth.test.ts`
- T19: `Extensions/WebClipper/src/domains/backup/*`、`Extensions/WebClipper/tests/domains/*`
- T20: `Extensions/WebClipper/src/ui/inpage/*`
- T21: `Extensions/WebClipper/scripts/build.mjs`、`Extensions/WebClipper/scripts/check.mjs`
- T22: `Extensions/WebClipper/scripts/package-amo-source.mjs`
- T23: `Extensions/WebClipper/AGENTS.md`

---

## Findings（Open）

## Finding F-02

- Task: `Task 04: in-place 引入 WXT`
- Severity: `High`
- Status: `Open`
- Location: `Extensions/WebClipper/package.json:8`
- Summary: 计划与验收口径要求 `npm run dev/build` 走 WXT，但当前默认 `build` 仍指向 legacy `scripts/build.mjs`；WXT 命令存在但以 `dev:wxt/build:wxt` 暴露。
- Risk: 开发/构建工作流分裂，加载的产物与实际改动不一致，容易出现“改了但没生效”的隐性故障。
- Expected fix: 将 `dev/build/build:firefox` 统一切换到 WXT，并把 legacy 打包链改为显式 `legacy:*`（或在 P6 再删）。
- Validation: `npm --prefix Extensions/WebClipper run dev` / `npm --prefix Extensions/WebClipper run build`
- Resolution evidence: （待补）

## Finding F-03

- Task: `Task 05: WXT manifest 对齐“现状权限/host 权限”`
- Severity: `High`
- Status: `Open`
- Location: `Extensions/WebClipper/wxt.config.ts:25`
- Summary: WXT 生成的 manifest 当前缺少 `web_accessible_resources`，但 inpage 代码通过 `runtime.getURL('icons/icon-128.png')` 在页面中加载图片（页面上下文通常要求 WAR）。
- Risk: inpage icon 在部分浏览器/场景下无法展示，属于明显 UI 回归且会影响交互提示。
- Expected fix: 在 WXT manifest 中补齐 `web_accessible_resources`（至少 `icons/icon-128.png`），并保持 matches 与现状一致。
- Validation: `cat Extensions/WebClipper/.output/chrome-mv3/manifest.json | jq '.web_accessible_resources'`
- Resolution evidence: （待补）

## Finding F-04

- Task: `全局（用户需求）`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/plans/2026-03-01-WebClipper脚手架迁移-implementation-plan.md:1`
- Summary: 当前实施计划未明确“把旧 popup 面板功能迁移/融合到新 app”的路线（功能拆分、路由落点、渐进替换顺序、验收点）。
- Risk: 迁移后的 app 与旧 popup 功能分裂，无法达成“新标签页扩展更方便”的目标；也会阻塞后续重构收尾。
- Expected fix: 在 plan 中新增一个优先级分组（建议 P3.5 或 P4 前置）覆盖：Chats actions（delete/export/sync）、Settings（Notion/Obsidian/ArticleFetch/Inpage）、About 等功能迁移。
- Validation: 手测：`app.html` 能覆盖旧 popup 的核心功能闭环。
- Resolution evidence: （待补）

## Finding F-05

- Task: `Task 22: AMO source package`
- Severity: `Medium`
- Status: `Open`
- Location: `Extensions/WebClipper/scripts/package-amo-source.mjs:33`
- Summary: AMO source package 当前未包含 `wxt.config.ts` / `entrypoints/*` 等 WXT 构建关键文件，偏向 legacy build 复现口径。
- Risk: Firefox 上架审核可能无法按当前实际构建链复现 `.xpi`；后续切换到 WXT 后会产生合规风险。
- Expected fix: 在 source package 中纳入 WXT 关键文件，并在文档中写明复现构建命令。
- Validation: `npm --prefix Extensions/WebClipper run package:amo-source`（产物包含 WXT 文件清单）
- Resolution evidence: （待补）

## Finding F-06

- Task: `Task 12: background 路由分层`
- Severity: `Medium`
- Status: `Open`
- Location: `Extensions/WebClipper/entrypoints/background.ts:1`
- Summary: 目前 platform router 只覆盖 conversations/article；sync/settings 等仍走 legacy fallback，且计划中预期的 `src/domains/sync/background-handlers.ts` 尚未建立。
- Risk: 迁移期长期依赖 fallback 会导致“哪些消息已迁移”不透明，增加回归定位成本。
- Expected fix: 增加 sync/settings 的薄 handler（可先委托 legacy orchestrator/store），逐步缩小 fallback 范围，并在 Debug 页可观测。
- Validation: 手测 app 路由页面不再出现 `unknown message type`。
- Resolution evidence: （待补）

## Finding F-07

- Task: `Task 23: 更新 WebClipper AGENTS`
- Severity: `Medium`
- Status: `Open`
- Location: `Extensions/WebClipper/AGENTS.md:1`
- Summary: WebClipper 开发命令与产物路径说明仍以 legacy `dist*` 为主，未反映 WXT 的 `dev/build` 与 `.output/*` 产物。
- Risk: 新同学/未来自己按文档操作会加载错误产物，导致调试与发布流程混乱。
- Expected fix: 按现状更新入口索引与命令，并明确迁移期 legacy 与 WXT 的边界。
- Validation: 按 AGENTS.md 从 0 到 1 能启动 dev 并加载扩展。
- Resolution evidence: （待补）

---

## Fix log

- （待补）

## Validation log

- （待补）

## Final status & residual risks

- （待补）
