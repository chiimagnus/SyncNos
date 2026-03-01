# WebClipper 脚手架迁移方案 — 审查报告（2026-03-01）

- 目标方案文件：`.github/plans/WebClipper脚手架迁移方案.md`
- 仓库根目录：`/Users/chii_magnus/Github_OpenSource/SyncNos`
- 审查范围：仅审查与标注（read-only），不修改代码、不执行迁移

> 结论先行：这份方案的“方向”是对的（把扩展 UI 升级为扩展内 Web App + Router），但当前版本存在若干**会直接导致功能回归/无法构建**的硬问题（权限、host 权限、入口文件约定、Firefox 打包假设），以及你提到的**目录树偏技术分层而非业务分域**的问题。建议先修订计划再开工。

---

## TODO board（27 tasks）

### Phase 0：搭骨架

- [ ] Task 01：`npx wxt@latest init WebClipper-v2 --template react`
- [ ] Task 02：安装依赖：`pnpm add react-router-dom zustand`
- [ ] Task 03：安装 dev 依赖：`pnpm add -D tailwindcss @tailwindcss/vite`
- [ ] Task 04：配置 `wxt.config.ts`
- [ ] Task 05：创建 `app.html` + `entrypoints/app/main.tsx`（unlisted SPA 入口）
- [ ] Task 06：跑通 `pnpm dev`，确认 popup 和 app.html 都能打开

### Phase 1：平移业务逻辑到 lib/

- [ ] Task 07：`src/protocols/message-contracts.js` → `lib/protocols/message-contracts.ts`
- [ ] Task 08：`src/storage/schema.js` → `lib/storage/schema.ts`
- [ ] Task 09：`src/bootstrap/background-storage.js` → `lib/storage/background-storage.ts`
- [ ] Task 10：`src/bootstrap/background-router.js` → `lib/messaging/bridge.ts`
- [ ] Task 11：`src/collectors/registry.js` + `runtime-observer.js` → `lib/collectors/`
- [ ] Task 12：`src/storage/incremental-updater.js` → `lib/storage/incremental-updater.ts`
- [ ] Task 13：不改逻辑，只加 TS 类型 + ESM import/export

### Phase 2：重写 popup UI

- [ ] Task 14：`entrypoints/popup/App.tsx`：React 组件化
- [ ] Task 15：保留核心功能：当前页采集状态、快速保存、打开 app.html 按钮
- [ ] Task 16：通过 `browser.runtime.sendMessage` 和 background 通信

### Phase 3：搭 app.html SPA 路由页面

- [ ] Task 17：`AppShell`：侧边栏导航 + 顶栏
- [ ] Task 18：`/`（Conversations）：对话列表，从 IndexedDB 读取
- [ ] Task 19：`/sync`（SyncJobs）：同步任务状态、进度、重试
- [ ] Task 20：`/settings`：配置项（Notion token、Parent Page 等）
- [ ] Task 21：`/debug`：日志查看、IndexedDB 浏览

### Phase 4：迁移 content script

- [ ] Task 22：`entrypoints/content.ts`：WXT 自动打包为 IIFE
- [ ] Task 23：迁移 `inpage-button.js` → 用 `createShadowRootUi` 隔离样式
- [ ] Task 24：迁移 `content-controller.js` 逻辑

### Phase 5：多浏览器构建验证

- [ ] Task 25：`pnpm build` → Chrome 产物
- [ ] Task 26：`pnpm build --browser firefox` → Firefox 产物
- [ ] Task 27：删除旧 `scripts/build.mjs`、`check.mjs`；更新 `Extensions/WebClipper/AGENTS.md`

---

## Task-to-file map（现状 → 目标）

### 入口与构建

- Manifest/权限现状：`Extensions/WebClipper/manifest.json`
- 自研构建/打包：`Extensions/WebClipper/scripts/build.mjs`、`Extensions/WebClipper/scripts/check.mjs`、`Extensions/WebClipper/scripts/package-amo-source.mjs`
- 背景入口：`Extensions/WebClipper/src/bootstrap/background.js`
- Content 入口：`Extensions/WebClipper/src/bootstrap/content.js`
- Popup 入口：`Extensions/WebClipper/src/ui/popup/popup.html` + `Extensions/WebClipper/src/ui/popup/*.js`

### 协议与消息

- 共享 message types：`Extensions/WebClipper/src/protocols/message-contracts.js`
- 背景消息路由/事件订阅：`Extensions/WebClipper/src/bootstrap/background-router.js`
- popup ⇄ background（sendMessage）：`Extensions/WebClipper/src/shared/runtime-client.js`
- popup 事件订阅 Port：`Extensions/WebClipper/src/bootstrap/background-events-hub.js`

### 数据与采集

- IndexedDB schema + migration：`Extensions/WebClipper/src/storage/schema.js`
- 后台存储 API：`Extensions/WebClipper/src/bootstrap/background-storage.js`
- 增量 diff：`Extensions/WebClipper/src/storage/incremental-updater.js`
- Collector registry：`Extensions/WebClipper/src/collectors/registry.js`
- DOM observer：`Extensions/WebClipper/src/collectors/runtime-observer.js`

### inpage UI

- inpage button：`Extensions/WebClipper/src/ui/inpage/inpage-button.js`
- inpage controller：`Extensions/WebClipper/src/bootstrap/content-controller.js`
- inpage tip：`Extensions/WebClipper/src/ui/inpage/inpage-tip.js`

---

## Findings（Open）

## Finding F-01

- Task: `Task 04: 配置 wxt.config.ts`
- Severity: `High`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:关键配置/wxt.config.ts`
- Summary: 方案中的 `permissions` 严重缺失（当前扩展依赖 `downloads`/`webNavigation`/`scripting` 等）。
- Risk: 导出下载不可用、Notion OAuth 回调无法处理、文章抓取（`chrome.scripting.executeScript`）不可用，直接功能回归。
- Expected fix: 在计划里把“权限清单来源”写死：对照 `Extensions/WebClipper/manifest.json` 与实际调用点，列出迁移后必须保留的 permissions/host_permissions，并注明哪些可选、哪些必须。
- Validation: 构建后在 Chrome/Firefox 手动回归：导出、OAuth、Fetch Current Page、自动采集与保存。
- Resolution evidence: N/A

## Finding F-02

- Task: `Task 04: 配置 wxt.config.ts`
- Severity: `High`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:关键配置/wxt.config.ts`
- Summary: 仅使用 `optional_host_permissions` 会与现有“静态 content_scripts + 广泛网页采集能力”冲突。
- Risk: 未授予 host 权限时，content scripts 可能无法匹配/注入；同时 web/article fetch、Notion API、OAuth proxy 等访问也会受限，导致“看似能打开 UI 但采集/同步不可用”的隐性故障。
- Expected fix: 在计划里明确两条路径二选一并写出验收：
  - 路径 1（更稳）：保留必要 `host_permissions`（最小集合），不依赖 optional；
  - 路径 2（更复杂）：改为 runtime request optional host 权限 + 没权限时的 UI 引导与降级（并解释 content script 如何按需注入）。
- Validation: 在“未授予额外权限”的干净环境下，验证注入与抓取路径；授权后验证恢复。
- Resolution evidence: N/A

## Finding F-03

- Task: `Task 05: 创建 app.html + entrypoints/app/main.tsx`
- Severity: `High`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:WXT 项目结构 + 迁移步骤 Phase 0`
- Summary: entrypoints 路径自相矛盾：结构里同时出现 `entrypoints/app.html` + `entrypoints/app/main.tsx`，但后文又写 `entrypoints/app/main.tsx`（且示例 HTML `src="./app/main.tsx"`）。
- Risk: 实施时会卡在 WXT 的实际约定与构建入口（找不到文件/不被识别/资源路径不对）。
- Expected fix: 先把“WXT 对 unlisted page 的入口约定”查证并固定为单一规范（例如统一为 `entrypoints/app/index.html` + `entrypoints/app/main.tsx` 或其它）。
- Validation: `pnpm dev` 能打开 `chrome-extension://<id>/app.html` 且路由可用。
- Resolution evidence: N/A

## Finding F-04

- Task: `Task 10: background-router.js → lib/messaging/bridge.ts`
- Severity: `High`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:Phase 1`
- Summary: 把 “路由 + 事件 Port keep-alive + job abort + OAuth init” 统称为 “messaging wrapper” 过于粗糙，容易遗漏当前背景启动时序与副作用。
- Risk: popup 打开后 SW 仍可能冷启动；Notion/Obsidian job 状态轮询与事件刷新退化；OAuth listener 不工作；多实例冲突处理丢失。
- Expected fix: 在计划中拆分 background 职责清单（初始化顺序 + 必须保留的 side effects），并逐条映射到新模块的函数名/文件。
- Validation: popup 打开/关闭时 job 状态更新稳定；OAuth 回调能落库；多实例不会互相踩。
- Resolution evidence: N/A

## Finding F-05

- Task: `Task 27: 删除旧 scripts/build.mjs、check.mjs`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:Phase 5`
- Summary: 直接删除会丢失当前仓库里“AMO source package”与多目标产物校验的可复现流程（`scripts/package-amo-source.mjs` 也未纳入迁移清单）。
- Risk: Firefox 上架/审核流程可能断裂；产物一致性难自证。
- Expected fix: 计划里补一条：WXT 迁移后如何生成 AMO source zip、如何复现 XPI，并保留/替换现有 `package-amo-source` 能力。
- Validation: 生成的 source 包可在 reviewer 环境复现构建并产出同等 XPI。
- Resolution evidence: N/A

## Finding F-06

- Task: `Task 23: inpage-button → createShadowRootUi`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:Phase 4`
- Summary: 方案未映射现有 inpage 交互硬约束（单例气泡、400ms combo 结算、双击打开 popup 不可用时提示等，详见 `Extensions/WebClipper/AGENTS.md`）。
- Risk: UI 行为回归且难发现（尤其是“单击保存/双击打开/多击彩蛋”的边界与节流）。
- Expected fix: 在计划里把 inpage 约束列为验收清单，并明确 Shadow DOM 迁移后 CSS/资源（icon、tokens）如何加载与隔离。
- Validation: 在任一支持站点手测：单击保存、双击打开、3/5/7 连击彩蛋、错误提示覆盖逻辑。
- Resolution evidence: N/A

## Finding F-07

- Task: `Task 02/03/06/25/26: pnpm 工作流`
- Severity: `Low`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:Phase 0/5`
- Summary: 当前 WebClipper 使用 `npm` + `package-lock.json`（`Extensions/WebClipper/package.json`），方案切换到 `pnpm` 需要明确仓库策略（是否允许新增 lockfile、CI 是否支持）。
- Risk: 团队/CI/发布流程不一致导致“我这能跑你那不能跑”。
- Expected fix: 在计划开头加一句决策：继续 `npm` 还是切 `pnpm`；若切，写清 lockfile 迁移与 CI 更新点。
- Validation: 在干净环境从 0 安装依赖并能 `dev/build/test`。
- Resolution evidence: N/A

## Finding F-08

- Task: `Task 17-21: app.html 的页面职责`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:Phase 3`
- Summary: “/settings 放 Notion token、Parent Page 等”与当前安全/隐私约束需要再细化：哪些配置可在 UI 展示、哪些只显示状态不回显、哪些需要脱敏。
- Risk: UI 无意中把 token/API key 回显或写入日志；合规与用户信任风险。
- Expected fix: 为 settings 页补“敏感字段展示策略”（不回显/只显示是否已配置/提供清除按钮）。
- Validation: 打开 devtools 日志不出现 token；UI 不可复制/不可见（除非用户显式操作）。
- Resolution evidence: N/A

## Finding F-09

- Task: `Task 07-13: lib/ 平移`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:Phase 1`
- Summary: 当前业务代码大量依赖 “脚本加载顺序 + 共享全局 NS”，平移到 ESM/TS 后需要一个明确的初始化入口（谁 import 谁、哪些需要先注册）。
- Risk: collector 注册顺序、contract/assert、normalize 模块等出现 “undefined but silently ignored”，导致采集不工作但不报错。
- Expected fix: 计划里补“初始化顺序图”与一个 `initCore()`（集中 import/注册），并把“禁止吞错”作为迁移期规则（至少在 dev 模式）。
- Validation: 启动后 registry 非空；content/controller 能 pickActive；自动保存可运行。
- Resolution evidence: N/A

## Finding F-10

- Task: `Task 01: 新建 WebClipper-v2`
- Severity: `Low`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:Phase 0`
- Summary: 在 `Extensions/` 下新建 `WebClipper-v2` 会带来“同时维护两套扩展”的成本；而且现有构建/发布脚本默认指向 `Extensions/WebClipper/`。
- Risk: 迁移期产物、文档、CI、商店发布容易混乱。
- Expected fix: 计划里明确迁移策略：in-place 迁移（推荐）或双目录并行；若并行，定义切换点与删除旧目录的时机。
- Validation: 产物路径一致、文档与命令不歧义。
- Resolution evidence: N/A

## Finding F-11

- Task: `Task 07-21: 目录树按业务逻辑组织`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:WXT 项目结构`
- Summary: 当前结构以技术分层（protocols/storage/collectors/messaging/stores）为主，不利于“按业务能力扩展新页面/新功能”（你反馈的痛点成立）。
- Risk: 新增一项能力（例如“批量规则/标签/检索/队列”）会横跨多个技术目录，修改分散，review 成本高。
- Expected fix: 计划里把 `lib/` 调整为“业务分域 + 平台适配”更清晰的结构（示例）：
  - `src/domains/conversations/*`（模型、repo、selectors）
  - `src/domains/sync/*`（jobs、状态机、重试策略）
  - `src/integrations/notion/*`、`src/integrations/obsidian/*`、`src/integrations/web-article/*`
  - `src/platform/browser/*`（runtime messaging、storage wrapper、permissions）
  - `src/ui/app/*`、`src/ui/popup/*`、`src/ui/inpage/*`
  entrypoints 只做薄 glue：调用 domains/integrations。
- Validation: 任意一个新页面只需要接入 domains 的 read model 与 actions，不必跨层到处 import。
- Resolution evidence: N/A

## Finding F-12

- Task: `Task 26: Firefox 构建假设`
- Severity: `Medium`
- Status: `Open`
- Location: `.github/plans/WebClipper脚手架迁移方案.md:技术选型/WXT 理由`
- Summary: 方案把“Firefox MV2 fallback 自动处理”当作确定能力，但当前仓库已有一套明确的 Firefox 兼容策略（`scripts/build.mjs`），迁移前需要验证 WXT 是否能覆盖这些具体需求（background.scripts、gecko settings、source package 要求）。
- Risk: Firefox 产物可构建但不可上架/不可运行，或 reviewer 无法复现。
- Expected fix: 在计划里加一条“Firefox 验收矩阵”：manifest 字段、background 形式、gecko id/min version、打包与 source。
- Validation: 本地临时加载 + AMO 校验（至少跑 `about:debugging` 临时扩展流程与基础功能）。
- Resolution evidence: N/A

---

## Fix log

（本次为审查阶段，不做修复。）

## Validation log

（本次为审查阶段，不跑 `dev/build/test`；待修订方案并进入实施阶段再补全。）

---

## Final status & residual risks

- 这份方案可以作为“方向稿”，但建议先修订以下三块再进入实施：
  1) 权限/host 权限与内容脚本注入策略（否则必回归）
  2) WXT 入口文件约定与 Firefox 交付链（否则易卡死）
  3) 目录结构按业务分域重排（否则达不到你要的“好扩展”）

