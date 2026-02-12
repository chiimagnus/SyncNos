# Plan Audit: WebClipper Implementation Plan (2026-02-12)

Target plan: `.github/plans/2026-02-12-webclipper-implementation-plan.md`

Repo scope: `Extensions/WebClipper/` + related docs under `.github/docs/`.

This report follows the `plan-task-auditor` workflow: findings are logged first; fixes (if any) must happen only after this report exists.

## TODO Board (24 Tasks)

- [x] Task 1: 创建插件工程骨架（按能力分包） (Implemented)
- [x] Task 1A: 初始化自动化验证能力（npm scripts） (Implemented)
- [x] Task 2: 实现统一数据模型与 IndexedDB 表结构 (Implemented)
- [x] Task 3: 搭建 background 消息路由与 CRUD 接口 (Implemented)
- [x] Task 4: 迁移并收敛 core 层（增量比对与去重） (Implemented; see F-08)
- [x] Task 5: 接入 ChatGPT 适配器与页面按钮 (Implemented)
- [ ] Task 6: 接入 NotionAI 适配器（三形态 + 黄色警告） (Partial; see F-02, F-06)
- [x] Task 7: 完成 popup 列表、多选、全选、导出（JSON+Markdown） (Implemented)
- [x] Task 8: 删除与清空能力 (Implemented)
- [x] Task 9: P1 回归验证 (Implemented in doc)
- [ ] Task 10: OAuth 数据结构与设置页入口 (Partial; see F-01)
- [ ] Task 11: OAuth 回调桥接与 token 持久化 (Partial; see F-01)
- [x] Task 12: Parent Page 列表与选择 (Implemented)
- [x] Task 13: 按来源 ensure 数据库（ChatGPT / NotionAI） (Implemented)
- [x] Task 14: 会话同步服务（覆盖同页） (Implemented)
- [x] Task 15: 批量同步执行器与失败清单 (Implemented)
- [ ] Task 16: P2 回归验证 (Partial; see F-04)
- [x] Task 17: 建立平台注册表与适配器模板 (Implemented; see F-07)
- [x] Task 18: 批次 A 平台接入（Claude / Gemini） (Implemented)
- [x] Task 19: 批次 B/C 平台接入（DeepSeek/Kimi/Doubao/Yuanbao） (Implemented)
- [ ] Task 20A: 网页文章 fetch 扩展骨架 (Partial; see F-03, F-05)
- [ ] Task 21: P3 回归验证与平台启用清单 (Missing/Partial; see F-04)
- [ ] Task 22: 权限最小化与隐私文档 (Partial; see F-09)
- [x] Task 23: Safari 转换预演与差异清单 (Implemented)

## Task-to-File Map

- Task 1: 创建插件工程骨架（按能力分包）
  - `Extensions/WebClipper/manifest.json`
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/collectors/runtime-observer.js`
  - `Extensions/WebClipper/src/storage/incremental-updater.js`
  - `Extensions/WebClipper/src/shared/normalize.js`
  - `Extensions/WebClipper/src/collectors/chatgpt-collector.js`
  - `Extensions/WebClipper/src/collectors/notionai-collector.js`
  - `Extensions/WebClipper/src/bootstrap/content.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
  - `Extensions/WebClipper/src/ui/popup/popup.html`
  - `Extensions/WebClipper/src/ui/inpage/inpage.css`
  - `Extensions/WebClipper/src/ui/popup/popup.css`
  - `Extensions/WebClipper/icons/`
  - `Resource/demo/js`
- Task 1A: 初始化自动化验证能力（npm scripts）
  - `Extensions/WebClipper/package.json`
  - `Extensions/WebClipper/vitest.config.ts`
  - `Extensions/WebClipper/tests/smoke/schema.test.ts`
  - `Extensions/WebClipper/scripts/build.mjs`
- Task 2: 实现统一数据模型与 IndexedDB 表结构
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/storage/schema.js`
- Task 3: 搭建 background 消息路由与 CRUD 接口
  - `Extensions/WebClipper/src/bootstrap/background.js`
- Task 4: 迁移并收敛 core 层（增量比对与去重）
  - `Extensions/WebClipper/src/collectors/runtime-observer.js`
  - `Extensions/WebClipper/src/storage/incremental-updater.js`
  - `Extensions/WebClipper/src/shared/normalize.js`
  - `Resource/demo/js/core/base.js`
- Task 5: 接入 ChatGPT 适配器与页面按钮
  - `Extensions/WebClipper/src/collectors/chatgpt-collector.js`
  - `Extensions/WebClipper/src/bootstrap/content.js`
  - `Extensions/WebClipper/src/ui/inpage/inpage.css`
  - `Resource/demo/js/adapters/chatgpt.js`
- Task 6: 接入 NotionAI 适配器（三形态 + 黄色警告）
  - `Extensions/WebClipper/src/collectors/notionai-collector.js`
  - `Extensions/WebClipper/src/bootstrap/content.js`
  - `Extensions/WebClipper/src/bootstrap/background.js`
- Task 7: 完成 popup 列表、多选、全选、导出（JSON+Markdown）
  - `Extensions/WebClipper/src/ui/popup/popup.html`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
  - `Extensions/WebClipper/src/ui/popup/popup.css`
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Resource/demo/js/popup.js`
- Task 8: 删除与清空能力
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
- Task 9: P1 回归验证
  - `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`
- Task 10: OAuth 数据结构与设置页入口
  - `Extensions/WebClipper/src/sync/notion/oauth-config.js`
  - `Extensions/WebClipper/src/sync/notion/oauth-client.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
  - `Extensions/WebClipper/src/ui/popup/popup.html`
- Task 11: OAuth 回调桥接与 token 持久化
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/sync/notion/token-store.js`
- Task 12: Parent Page 列表与选择
  - `Extensions/WebClipper/src/sync/notion/notion-api.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
  - `Extensions/WebClipper/src/ui/popup/popup.html`
- Task 13: 按来源 ensure 数据库（ChatGPT / NotionAI）
  - `Extensions/WebClipper/src/sync/notion/notion-db-manager.js`
  - `Extensions/WebClipper/src/bootstrap/background.js`
- Task 14: 会话同步服务（覆盖同页）
  - `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
- Task 15: 批量同步执行器与失败清单
  - `Extensions/WebClipper/src/bootstrap/background.js`
  - `Extensions/WebClipper/src/ui/popup/popup.js`
- Task 16: P2 回归验证
  - `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`
- Task 17: 建立平台注册表与适配器模板
  - `Extensions/WebClipper/src/collectors/registry.js`
  - `Extensions/WebClipper/src/collectors/collector-contract.js`
  - `Extensions/WebClipper/src/bootstrap/content.js`
- Task 18: 批次 A 平台接入（Claude / Gemini）
  - `Extensions/WebClipper/src/collectors/claude-collector.js`
  - `Extensions/WebClipper/src/collectors/gemini-collector.js`
  - `Extensions/WebClipper/manifest.json`
  - `Resource/demo/js/adapters/claude.js`
- Task 19: 批次 B/C 平台接入（DeepSeek/Kimi/Doubao/Yuanbao）
  - `Extensions/WebClipper/src/collectors/deepseek-collector.js`
  - `Extensions/WebClipper/src/collectors/kimi-collector.js`
  - `Extensions/WebClipper/src/collectors/doubao-collector.js`
  - `Extensions/WebClipper/src/collectors/yuanbao-collector.js`
  - `Extensions/WebClipper/manifest.json`
- Task 20A: 网页文章 fetch 扩展骨架
  - `Extensions/WebClipper/src/collectors/article-fetcher.js`
  - `Extensions/WebClipper/src/export/article-markdown.js`
  - `Extensions/WebClipper/src/collectors/collector-contract.js`
  - `Extensions/WebClipper/src/bootstrap/content.js`
- Task 21: P3 回归验证与平台启用清单
  - `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md`
  - `.github/docs/Chrome插件-平台兼容性矩阵.md`
- Task 22: 权限最小化与隐私文档
  - `Extensions/WebClipper/manifest.json`
  - `Extensions/WebClipper/PRIVACY.md`
  - `Extensions/WebClipper/PERMISSIONS.md`
- Task 23: Safari 转换预演与差异清单
  - `.github/docs/Chrome到Safari迁移差异清单.md`

## Findings (Open First)

## Finding F-01

- Task: `Task 10: OAuth 数据结构与设置页入口` / `Task 11: OAuth 回调桥接与 token 持久化`
- Severity: `High`
- Status: `Open`
- Location: `Extensions/WebClipper/src/ui/popup/popup.js:259`
- Summary: Notion OAuth `client_secret` is collected via popup input and stored in `chrome.storage.local` in cleartext.
- Risk: Any extension or local attacker with access to the profile can extract the secret; also a browser extension cannot realistically keep a client secret confidential. This violates the plan wording “token 本地安全存储” and creates a long-term security liability.
- Expected fix: Remove the need to store/use `client_secret` in the extension (preferred), or clearly mark this as a dev-only workflow and move token exchange to a backend (or another mechanism that does not embed a secret in the extension).
- Validation: `npm --prefix Extensions/WebClipper run check` and manual OAuth happy-path after redesign.
- Resolution evidence: (pending)

Related evidence:
- Secret persisted: `Extensions/WebClipper/src/ui/popup/popup.js:265`
- Token exchange requires secret: `Extensions/WebClipper/src/bootstrap/background.js:451`
- Client config storage: `Extensions/WebClipper/src/sync/notion/oauth-config.js:19`

## Finding F-02

- Task: `Task 6: 接入 NotionAI 适配器（三形态 + 黄色警告）`
- Severity: `High`
- Status: `Open`
- Location: `Extensions/WebClipper/src/collectors/notionai-collector.js:4`
- Summary: The NotionAI collector activates on every `notion.so` page (`matches()` only checks domain; `isNotionAiPage()` always true), so it can capture regular Notion page content as “assistant” messages when no NotionAI chat is present.
- Risk: Unexpected data capture (privacy risk), wrong data quality, and fails acceptance “不混入主页笔记”。User already observed homepage note content being saved in side panel / floating window scenarios.
- Expected fix: Tighten activation so the collector only becomes active when a NotionAI chat is actually present (DOM-based signal), and ensure “no chat UI” returns `null` early without scanning `div[data-block-id]` across the page.
- Validation: Manual on a normal Notion page with no NotionAI chat open: no in-page Save button, no new conversation created; manual on three NotionAI shapes: capture still works.
- Resolution evidence: (pending)

## Finding F-03

- Task: `Task 20A: 网页文章 fetch 扩展骨架`
- Severity: `Medium`
- Status: `Open`
- Location: `Extensions/WebClipper/src/bootstrap/background.js:68`
- Summary: Article metadata extracted by the fetcher (`author`, `publishedAt`, `description`) is not persisted because `upsertConversation()` only stores a fixed subset of fields (no author/publishedAt/description).
- Risk: Exported article markdown loses metadata and any future sync field mapping cannot use it without a schema migration.
- Expected fix: Extend the conversation record schema to persist article metadata (and bump `DB_VERSION` with migration), or store metadata in a dedicated article table keyed by conversationId.
- Validation: Add/update unit test around schema + manual: fetch an article, export MD, verify metadata lines are present.
- Resolution evidence: (pending)

Related evidence:
- Extractor produces metadata: `Extensions/WebClipper/src/collectors/article-fetcher.js:42`
- Markdown formatter expects metadata: `Extensions/WebClipper/src/export/article-markdown.js:9`

## Finding F-04

- Task: `Task 16: P2 回归验证` / `Task 21: P3 回归验证与平台启用清单`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/docs/Chrome插件-ChatGPT-NotionAI-MVP-需求汇总.md:200`
- Summary: P2 regression section is present but not filled; P3 required compatibility matrix doc is missing.
- Risk: Plan acceptance requires docs as “single source of truth” for validation. Missing/unfinished docs make it easy to regress without noticing.
- Expected fix: Fill P2 regression record with concrete steps/outcomes; add `.github/docs/Chrome插件-平台兼容性矩阵.md` and keep it consistent with manifest + collectors.
- Validation: `rg -n \"平台兼容性矩阵\" .github/docs -S` shows the matrix doc exists; doc sections updated.
- Resolution evidence: (pending)

## Finding F-05

- Task: `Task 20A: 网页文章 fetch 扩展骨架`
- Severity: `Medium`
- Status: `Open`
- Location: `Extensions/WebClipper/src/bootstrap/background.js:539`
- Summary: Task 20A plan expects wiring via `collector-contract.js` and `content.js`, but the implementation uses background `chrome.scripting.executeScript` injection + optional host permissions; `collector-contract.js` is unchanged for article support.
- Risk: Plan drift: future contributors will follow the plan and implement in the wrong place; contract/registry-based extensibility is undermined.
- Expected fix: Either update the plan to match the chosen implementation, or refactor article capture to align with registry/contract approach (while keeping optional-permission model).
- Validation: `npm --prefix Extensions/WebClipper run check` and manual fetch on an arbitrary article site still works.
- Resolution evidence: (pending)

## Finding F-06

- Task: `Task 6: 接入 NotionAI 适配器（三形态 + 黄色警告）`
- Severity: `Medium`
- Status: `Open`
- Location: `Extensions/WebClipper/src/bootstrap/content.js:133`
- Summary: NotionAI in-page button is attached near the top-left of the detected window rect, not “会话名称右侧” as specified.
- Risk: UI mismatch from requirement; can overlap UI elements or appear detached from the actual chat header.
- Expected fix: Improve anchor detection in `notionai-collector.js` to locate the header/title region, and position the button relative to that element rather than a coarse window rect.
- Validation: Manual verify in all three NotionAI shapes that the button sits next to the session title.
- Resolution evidence: (pending)

## Finding F-07

- Task: `Task 17: 建立平台注册表与适配器模板`
- Severity: `Low`
- Status: `Open`
- Location: `Extensions/WebClipper/src/collectors/collector-contract.js:4`
- Summary: Collector contract only asserts `matches()` and `capture()`. Plan mentions a richer adapter template (URL validation, sourceType, conversation key extraction, message element identification, etc.).
- Risk: As more platforms are added, inconsistent collector APIs may creep in; content/bootstrap may need ad-hoc checks.
- Expected fix: Either simplify the plan wording to match the minimal contract, or expand the contract (and tests) to lock down the expected collector surface (at least `getRoot`/`getAnchorRect` where used).
- Validation: `node --check Extensions/WebClipper/src/collectors/collector-contract.js` and unit tests for contract checks.
- Resolution evidence: (pending)

## Finding F-08

- Task: `Task 4: 迁移并收敛 core 层（增量比对与去重）`
- Severity: `Low`
- Status: `Open`
- Location: `Extensions/WebClipper/src/storage/incremental-updater.js:32`
- Summary: Incremental updater computes `diff` (added/updated/removed) but downstream only uses `changed`; the diff is not used for any logging/telemetry or correctness checks.
- Risk: Not a functional bug now, but it weakens the “能区分新增/更新/删除” acceptance signal and reduces debuggability.
- Expected fix: Either use `diff` (e.g., basic debug counters) or remove it to avoid misleading intent.
- Validation: `npm --prefix Extensions/WebClipper run test`.
- Resolution evidence: (pending)

## Finding F-09

- Task: `Task 22: 权限最小化与隐私文档`
- Severity: `Low`
- Status: `Open`
- Location: `Extensions/WebClipper/manifest.json:12`
- Summary: Permissions are not yet minimized (always-on `tabs`, `webNavigation`, `scripting`; wide `host_permissions` for many platforms), while Task 22’s goal is to “收敛到最小 host permissions”.
- Risk: Higher install friction and broader attack surface; mismatched expectations if the project intends least-privilege by default.
- Expected fix: Decide default-enabled platforms and permission model, then minimize `host_permissions` and consider moving some capabilities behind `optional_host_permissions` + runtime requests.
- Validation: `npm --prefix Extensions/WebClipper run check` and manual smoke on the enabled platforms after tightening.
- Resolution evidence: (pending)

## Fix Log

(intentionally empty in audit phase)

## Validation Log (Baseline)

- `npm --prefix Extensions/WebClipper run check`: PASS
- `npm --prefix Extensions/WebClipper run test`: PASS (4 tests)
- `npm --prefix Extensions/WebClipper run build`: PASS (dist created)

Note: `vitest` output includes a Vite CJS deprecation warning; not a blocker but may need a dependency update later.

## Current Status / Residual Risks

- The core MV3 extension scaffolding, storage pipeline, export, and Notion sync flows are in place.
- Highest risk items to address next:
  - NotionAI collector over-captures on regular Notion pages (F-02).
  - Notion OAuth secret handling cannot be made truly safe inside an extension as implemented (F-01).
