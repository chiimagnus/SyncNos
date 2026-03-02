# WebClipper 脚手架迁移（WXT + 扩展内 Web App）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 在不回归现有能力的前提下，把 `Extensions/WebClipper/` 迁移到 WXT 脚手架，并落地 `chrome-extension://<id>/app.html` 扩展内 SPA，使“新增页面/新标签页”像做 Web App 一样可扩展。

**Non-goals（非目标）:**
- 不在迁移期改动采集规则、去重策略、同步策略、inpage 交互约束（只做“等价迁移”与必要适配）
- 不在迁移期做权限精简（先对齐现状权限；精简作为迁移完成后的独立议题）
- 不新增新站点 collector / 新同步目标（除非为了验证架构闭环必须）

**Approach（方案）:**
- 采用 Strangler Fig 渐进式重构：WXT 先接管构建与入口；background/content 初期可通过“legacy 适配层”保持行为；UI 先引入扩展内 `app`，popup 变快捷入口；随后按业务域逐段替换 legacy（conversations → sync → backup/export → inpage/collectors）。
- 目录结构按“业务分域”组织（domains/integrations/ui/platform），避免纯技术分层导致未来扩展改动分散。
- 每个 P1/P2/P3 里每个 Task 都必须能验证；每完成一个优先级分组跑一次最小回归。

**Acceptance（验收）:**
- 构建与开发
  - `npm --prefix Extensions/WebClipper run dev` 可启动开发模式并可加载扩展
  - `npm --prefix Extensions/WebClipper run build` 可产出 Chrome/Edge 可加载产物
  - `npm --prefix Extensions/WebClipper run build:firefox`（或等价命令）可产出 Firefox 可加载产物（具体命令由 Task 02/03 Spike 固化）
- 扩展内 Web App
  - popup 内按钮可打开 `app.html`，并能切换 `/`、`/sync`、`/settings`、`/debug` 路由（HashRouter）
- 核心能力不回归（最小冒烟）
  - 自动采集保存仍可工作（至少 ChatGPT/Claude 任一站点）
  - “Fetch Current Page” 能抓取文章并入库
  - 导出 Markdown（Single/Multi）可下载
  - Notion OAuth 回调能落 token 状态（不要求完整 sync 全量验证在早期完成，但 OAuth 链路必须通）
  - Obsidian Test Connection 与同步入口不崩（最少保证消息路由与 job 状态可读）

---

## 现状索引（执行中常用对照）

- 现有 manifest/权限：`Extensions/WebClipper/manifest.json`
- 现有构建链：`Extensions/WebClipper/scripts/build.mjs`、`Extensions/WebClipper/scripts/check.mjs`、`Extensions/WebClipper/scripts/package-amo-source.mjs`
- 入口：
  - background：`Extensions/WebClipper/src/bootstrap/background.js`
  - content：`Extensions/WebClipper/src/bootstrap/content.js`
  - popup：`Extensions/WebClipper/src/ui/popup/popup.html`
- 共享协议：`Extensions/WebClipper/src/protocols/message-contracts.js`
- 背景路由：`Extensions/WebClipper/src/bootstrap/background-router.js`
- IndexedDB：`Extensions/WebClipper/src/storage/schema.js`、`Extensions/WebClipper/src/bootstrap/background-storage.js`
- inpage：`Extensions/WebClipper/src/bootstrap/content-controller.js`、`Extensions/WebClipper/src/ui/inpage/inpage-button.js`

---

## P1（最高优先级）：Spike + WXT 接管构建（保证“不回归的可执行地基”）

### Task 01: 锁定包管理器与命令形态（避免迁移期工作流分裂）

**Files:**
- Modify: `Extensions/WebClipper/package.json`
- (可能) Modify: `Extensions/WebClipper/package-lock.json`

**Step 1: 实现**
- 迁移期默认继续使用 `npm`（沿用现有 `package-lock.json`），不要引入 `pnpm-lock.yaml`。
- 在 `package.json` 里新增/预留 WXT 相关 scripts（先占位，后续 Task 填实；Firefox 构建脚本统一命名为 `build:firefox`）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper install`
- Expected: 依赖安装成功，无 lockfile 冲突

---

### Task 02: WXT 入口/产物约定 Spike（先确认，再写死路径）

**Files:**
- Create (临时、可删除): `Extensions/WebClipper/.tmp-wxt-spike/`（目录）

**Step 1: 实现**
- 在 `Extensions/WebClipper/` 下用 WXT 初始化一个临时项目（不要直接覆盖现目录）：
  - 目标：确认 WXT 对以下点的“实际约定”：
    1) background/content/popup/app 的入口文件放在哪里、命名是什么
    2) unlisted page（`app.html`）如何声明与如何被打包
    3) Firefox 构建命令形态与产物结构
- 记录结论到本计划的 “不确定项结论” 小节（见 Task 03）。

**Step 2: 验证**
- Run: 在临时项目内执行 `dev/build`（按 WXT init 给的命令）
- Expected: 能在 Chrome 加载临时扩展并打开其页面

**Step 3: 清理**
- 删除 `.tmp-wxt-spike/`（不进入最终代码库）

---

### Task 03: 固化 WXT 入口约定与产物路径（把 Spike 结果写进计划与代码）

**Files:**
- Modify: `.github/plans/2026-03-01-WebClipper脚手架迁移-implementation-plan.md`（在本文内固化“入口约定/命令”结论）

**Step 1: 实现**
- 用 Task 02 的结果补齐：
  - app 页面入口：`entrypoints/app/index.html`（产物 `app.html`，不自动写入 manifest）
  - popup 入口：`entrypoints/popup/index.html`（产物 `popup.html`）
  - background/content：`entrypoints/background.ts`、`entrypoints/content.ts`（content 产物位于 `content-scripts/`）
  - Firefox build：`wxt build -b firefox --mv3`（产物 `.output/firefox-mv3/`）

**Step 2: 验证**
- Expected: 文档中不再出现 `entrypoints/app.html` 与 `entrypoints/app/main.tsx` 这类自相矛盾表述

**WXT 入口约定（定稿）**
- app：`Extensions/WebClipper/entrypoints/app/index.html` → `app.html`
- popup：`Extensions/WebClipper/entrypoints/popup/index.html` → `popup.html`
- background：`Extensions/WebClipper/entrypoints/background.ts` → `background.js`
- content：`Extensions/WebClipper/entrypoints/content.ts` → `content-scripts/content.js`
- Firefox build：`wxt build -b firefox --mv3` → `.output/firefox-mv3/`

---

### Task 04: 在 `Extensions/WebClipper/` 内 in-place 引入 WXT（先不迁业务，只让脚手架跑起来）

**Files:**
- Create: `Extensions/WebClipper/wxt.config.ts`
- Modify: `Extensions/WebClipper/package.json`

**Step 1: 实现**
- 安装 WXT 与 React 模块（按 Task 02 的实际模板选择依赖）。
- 新增 scripts（以 WXT 为准）：`dev`、`build`（含 firefox）、`test`（继续 Vitest）。
- 确保 TypeScript 能编译（`tsconfig.json`/类型依赖等以 WXT 模板为准）；TS 严格选项可先分阶段开启，但至少要保证 `npm run build` 能稳定通过。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run dev`
- Expected: 能进入 WXT dev 模式

---

### Task 05: WXT manifest 对齐“现状权限/host 权限”（迁移期不精简）

**Files:**
- Modify: `Extensions/WebClipper/wxt.config.ts`

**Step 1: 实现**
- 在 `wxt.config.ts` 中把权限对齐到现状（来源：`Extensions/WebClipper/manifest.json`）：
  - `permissions`: `storage`, `downloads`, `tabs`, `webNavigation`, `activeTab`, `scripting`
  - `host_permissions`: 迁移期保持现状（含 `http://*/*` 与 `https://*/*`，以及 Notion/OAuth/Obsidian 必需 host）
- 明确写下注释：迁移完成后再讨论权限精简与 optional host 权限策略。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: manifest 生成成功，权限字段存在且符合预期

---

### Task 06: 建立 app（扩展内 Web App）最小可用壳（仅路由 + 4 页面空壳）

**Files:**
- Create: `Extensions/WebClipper/entrypoints/app/index.html`
- Create: `Extensions/WebClipper/entrypoints/app/main.tsx`
- Create: `Extensions/WebClipper/src/ui/app/AppShell.tsx`
- Create: `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`
- Create: `Extensions/WebClipper/src/ui/app/routes/SyncJobs.tsx`
- Create: `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`
- Create: `Extensions/WebClipper/src/ui/app/routes/Debug.tsx`

**Step 1: 实现**
- 用 HashRouter 建路由：
  - `/` → Conversations
  - `/sync` → SyncJobs
  - `/settings` → Settings
  - `/debug` → Debug
- 每个页面先渲染静态标题 + “coming soon”，不要接业务。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run dev`
- Expected: 能打开 `chrome-extension://<id>/app.html#/settings` 等路由，切换不 404

---

### Task 07: popup 加“打开完整界面”按钮（先把入口打通）

**Files:**
- Modify/Create: `Extensions/WebClipper/entrypoints/popup/...`
- Modify/Create: `Extensions/WebClipper/src/ui/popup/...`

**Step 1: 实现**
- popup 保持轻量：新增按钮 “Open App”，点击后：
  - `browser.runtime.getURL('app.html#/')`
  - `browser.tabs.create({ url })`
  - `window.close()`

**Step 2: 验证**
- 手测：打开 popup → 点击按钮 → 新标签页打开 app 并落到 Conversations 页面

---

### Task 08: background/content 先用 legacy 适配层跑通（让现有功能尽快“在 WXT 下能跑”）

**Files:**
- Create: `Extensions/WebClipper/src/legacy/README.md`（只写“迁移期约定/不可在此加新功能”）
- Create: `Extensions/WebClipper/src/legacy/background-entry.js`（或 .ts，按 WXT 支持）
- Create: `Extensions/WebClipper/src/legacy/content-entry.js`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/entrypoints/content.ts`

**Step 1: 实现**
- 目标：在 WXT 入口里“最大程度复用旧代码”，优先选择以下最小侵入方案之一（由 Task 02/03 的 WXT 约定决定）：
  1) **优先**：把旧入口封装成可 ESM `import` 的模块（迁移到 `src/legacy/`，只做“导出/初始化”所需的最小改动），然后由 WXT entrypoint 直接 `import` 并调用
  2) **备选**：若 Spike 证明 background 是 classic worker 且允许 `importScripts`，再考虑把 legacy 作为静态资源拷贝到产物中并 `importScripts(...)`（否则不要走这条路，避免 module worker 不兼容）
- 只要能让旧的 message router 与 storage 初始化起来即可（先不追求全覆盖）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run dev`
- 手测：
  - popup/app 能 `sendMessage` 到 background 并得到响应（先加一个最小 `ping` 消息即可）

---

### Task 09: Firefox 最小闭环（临时加载 + 打开 popup/app）

**Files:**
- Modify: `Extensions/WebClipper/wxt.config.ts`（如需 browser_specific_settings）

**Step 1: 实现**
- 产出 Firefox build（命令以 Task 03 固化为准）。
- 用 Firefox “临时扩展”加载产物并验证 popup/app 打开。

**Step 2: 验证**
- Expected: Firefox 可加载、popup 打开不报错、能打开 app 页面

---

## P2：平台层与协议收敛（为后续业务域替换打基础）

### Task 10: 建立 platform/runtime（统一 sendMessage + Port）

**Files:**
- Create: `Extensions/WebClipper/src/platform/runtime/runtime.ts`
- Create: `Extensions/WebClipper/src/platform/runtime/ports.ts`

**Step 1: 实现**
- 抽象出：
  - `sendMessage(type, payload)`
  - `connectPort(name)`（popup events keep-alive 用）
- 要求：不记录敏感信息；错误返回结构化 error。

**Step 2: 验证**
- 手测：app 页面里调用 `sendMessage` 能得到 background 响应

---

### Task 11: 把 message-contracts 迁到 TS（作为唯一消息 type 来源）

**Files:**
- Create: `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`
- (后续) Delete/Deprecate: `Extensions/WebClipper/src/protocols/message-contracts.js`（先不删，先双写对齐）

**Step 1: 实现**
- 把现有常量集合（CORE/NOTION/OBSIDIAN/ARTICLE/UI）迁移到 TS，并导出类型（`as const` + union）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: TS 编译通过

---

### Task 12: 背景路由拆成“平台路由骨架 + 业务 handler”（避免一次搬漏副作用）

**Files:**
- Create: `Extensions/WebClipper/src/platform/messaging/background-router.ts`
- Create: `Extensions/WebClipper/src/domains/conversations/background-handlers.ts`（先只放 Conversations 相关）
- Create: `Extensions/WebClipper/src/domains/sync/background-handlers.ts`（先只放 job status 相关）
- Modify: `Extensions/WebClipper/entrypoints/background.ts`

**Step 1: 实现**
- 把 “注册 onMessage listener、port keep-alive、instance id、多实例 job abort” 作为 platform 层骨架；
- 每个 message type 的处理转到 domains 的 handler（先薄包装调用 legacy/旧模块也可）。

**Step 2: 验证**
- 手测：popup 列表刷新（GET_CONVERSATIONS）仍可走通（哪怕内部仍调用 legacy）

---

## P3：扩展内 Web App 接入真实数据（先读后写，优先低风险域）

### Task 13: conversations read model（从 IndexedDB 读取列表/详情）

**Files:**
- Create: `Extensions/WebClipper/src/domains/conversations/repo.ts`
- Create: `Extensions/WebClipper/src/domains/conversations/models.ts`
- Modify: `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`

**Step 1: 实现**
- 先通过 background 消息读（复用现有 `GET_CONVERSATIONS` / `GET_CONVERSATION_DETAIL`）：
  - app 不直接碰 IndexedDB（先保持“background 为后端”）

**Step 2: 验证**
- 手测：Conversations 页面能显示列表；点击可加载详情（messages）

---

### Task 14: sync job status 页面（先读 Notion/Obsidian job 状态）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/app/routes/SyncJobs.tsx`

**Step 1: 实现**
- 通过 background 消息读取：
  - Notion：`GET_SYNC_JOB_STATUS`
  - Obsidian：`GET_SYNC_STATUS`
- UI 先展示：status/running、done/total、错误摘要（不展示 token）。

**Step 2: 验证**
- 手测：打开 SyncJobs 页面能看到状态（无 job 时显示 Idle）

---

### Task 15: settings 页面（敏感字段策略：不回显，只显示状态与清除）

**Files:**
- Create: `Extensions/WebClipper/src/domains/settings/sensitive.ts`
- Modify: `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`

**Step 1: 实现**
- 对 Notion token / Obsidian apiKey 等：
  - 只显示 “已配置/未配置”
  - 提供 “Clear” 动作（调用 background handler 清理对应 storage keys）
  - 不回显原值，不打印日志

**Step 2: 验证**
- 手测：Settings 页不显示 token 明文；点击 Clear 后状态更新

---

## P3.5：融合旧 popup → 扩展内 Web App（让 app.html 成为“完整面板”）

> 目标：把旧 popup 面板的核心能力逐步迁入 `app.html`，popup 保持“打开 app”的轻量入口。

### Task 24: App Conversations 支持多选 + Delete（对齐旧 popup）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`

**Step 1: 实现**
- 列表支持多选/全选。
- 增加 “Delete selected” 操作（调用 `deleteConversations` message）。

**Step 2: 验证**
- 手测：删除后列表刷新；详情区不崩。

---

### Task 25: App 导出 Markdown（Single/Multi）并下载 Zip（对齐旧 popup）

**Files:**
- Create: `Extensions/WebClipper/src/domains/conversations/markdown.ts`
- Modify: `Extensions/WebClipper/src/ui/app/routes/Conversations.tsx`

**Step 1: 实现**
- 复刻旧 popup 的 markdown 规则：
  - chat：按 role 分段
  - article：输出 article markdown（标题/元信息/正文）
- 支持 Single/Multi 导出为 Zip 并下载。

**Step 2: 验证**
- 手测：导出 zip 可下载；内容可读且不为空。

---

### Task 26: App Notion OAuth + Parent Page（不回显 token）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`

**Step 1: 实现**
- “Connect/Disconnect” 与旧 popup 行为等价（pending state + 打开授权页 + polling 状态）。
- Parent Page 下拉列表可加载与保存（写入 `notion_parent_page_id`）。

**Step 2: 验证**
- 手测：OAuth 回调后 connected；Parent Page 能保存并被后续 sync 使用。

---

### Task 27: App Obsidian Settings/Paths + Test Connection（apiKey 不回显）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`

**Step 1: 实现**
- baseUrl/authHeader/chatFolder/articleFolder 可编辑保存。
- apiKey 输入支持保存，但不回显（显示 configured/not configured）。
- Test Connection 触发 `obsidianTestConnection` 并展示结果摘要。

**Step 2: 验证**
- 手测：保存后刷新仍保持；Test 能返回 ok/err。

---

### Task 28: App Article Fetch + Inpage Visibility（即时生效）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/app/routes/Settings.tsx`

**Step 1: 实现**
- Fetch Current Page（调用 `fetchActiveTabArticle`，tabId 取当前活动 tab）。
- Inpage toggle 写入 `inpage_supported_only` 并调用 `applyInpageVisibility`。

**Step 2: 验证**
- 手测：Fetch 后 Conversations 出现 article；toggle 切换无需刷新即生效。

---

## P4：逐段替换 legacy（按业务域 strangling，完成一个删一个）

> 每个域替换时：先补单测（数据转换/状态变化/边界条件），再替换调用点，最后删 legacy 子模块。

### Task 16: conversations 写入链路替换（upsert + sync messages）

**Files:**
- Create: `Extensions/WebClipper/src/domains/conversations/write.ts`
- Modify: `Extensions/WebClipper/src/platform/messaging/background-router.ts`
- (后续) Modify/Delete: `Extensions/WebClipper/src/legacy/...`（按实际落点）

**Step 1: 实现**
- 先保留消息协议不变（UPSERT_CONVERSATION / SYNC_CONVERSATION_MESSAGES）。
- 内部实现从 legacy 逐步替换为 TS 模块（可先复制现有 IndexedDB 实现，再改 import/export）。

**Step 2: 验证**
- 手测：自动保存后 app 列表能刷新出新会话（或更新 capturedAt）

---

### Task 17: article fetch 链路替换（scripting 注入 + readability）

**Status:** ✅ Done（2026-03-02）

**Files:**
- Create: `Extensions/WebClipper/src/integrations/web-article/article-fetch.ts`
- Create: `Extensions/WebClipper/src/integrations/web-article/background-handlers.ts`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Modify: `Extensions/WebClipper/wxt.config.ts`

**Step 1: 实现**
- 迁移 `article-fetch-service.js` 逻辑到 TS，并保持动态注入 `readability.js` 的机制。
  - 迁移期保留注入路径不变：`src/collectors/web/readability.js`
  - WXT 构建时显式把该文件复制进最终产物（通过 `build:publicAssets` hook），以满足 `chrome.scripting.executeScript({ files: [...] })`

**Step 2: 验证**
- 手测：在普通网页点击 Fetch Current Page → 生成 kind=article 的 conversation/messages
  - 构建校验：`npm --prefix Extensions/WebClipper run build:wxt` 后产物应包含 `.output/chrome-mv3/src/collectors/web/readability.js`

---

### Task 18: Notion OAuth 链路替换（webNavigation 回调 + token store）

**Status:** ✅ Done（2026-03-02）

**Files:**
- Create: `Extensions/WebClipper/src/integrations/notion/oauth.ts`
- Create: `Extensions/WebClipper/src/integrations/notion/token-store.ts`
- Modify: `Extensions/WebClipper/entrypoints/background.ts`
- Create: `Extensions/WebClipper/src/platform/storage/local.ts`
- Create: `Extensions/WebClipper/tests/integrations/notion-oauth.test.ts`

**Step 1: 实现**
- 保持现状约束：token 存 `storage.local`；移除/不使用 client secret；失败写 `notion_oauth_last_error`。

**Step 2: 验证**
- 手测：走一遍 OAuth 授权 → 回调 tab 自动关闭 → 状态变为 connected

---

### Task 19: backup/export 域替换（Zip v2 + legacy JSON import）

**Status:** ✅ Done（2026-03-02）

**Files:**
- Create: `Extensions/WebClipper/src/domains/backup/...`
- Modify: `Extensions/WebClipper/src/platform/messaging/background-router.ts`
  - 已新增：
    - `Extensions/WebClipper/src/domains/backup/backup-utils.ts`
    - `Extensions/WebClipper/src/domains/backup/zip-utils.ts`
    - `Extensions/WebClipper/tests/domains/backup-utils.test.ts`
    - `Extensions/WebClipper/tests/domains/backup-zip-utils.test.ts`
    - `Extensions/WebClipper/src/domains/backup/idb.ts`
    - `Extensions/WebClipper/src/domains/backup/export.ts`
    - `Extensions/WebClipper/src/domains/backup/import.ts`
    - `Extensions/WebClipper/tests/domains/backup-service.test.ts`
  - App 入口（用于手测）：
    - `Extensions/WebClipper/src/ui/app/routes/Backup.tsx`
    - `Extensions/WebClipper/src/ui/app/AppShell.tsx`

**Step 1: 实现**
- 迁移 `zip-utils`、导出/导入合并规则到 domains。

**Step 2: 验证**
- 手测：导出 zip 成功；导入 zip/legacy JSON 成功且去重不爆炸

---

## P5：最后迁移 inpage（最容易回归，单独验收）

### Task 20: inpage UI Shadow DOM 化（保持交互约束）

**Status:** ✅ Done（2026-03-02）

**Files:**
- Create: `Extensions/WebClipper/src/ui/inpage/...`
- Modify: `Extensions/WebClipper/entrypoints/content.ts`

**Step 1: 实现**
- 用 Shadow DOM 隔离样式；加载 icon 资源使用 runtime.getURL（保持现状）。
- 严格保留约束：
  - 单例 tip 覆盖
  - 400ms combo 结算；count==1 才保存；恰好双击才 open popup；3/5/7 彩蛋
  - `inpage_supported_only` 即时生效

**Step 2: 验证**
- 手测：单击保存/双击打开/多击彩蛋/错误提示/切换开关即时生效

---

## P6：收尾（替换发布链、清理 legacy、补齐文档）

### Task 21: 删除旧构建脚本（在 WXT 全覆盖后再删）

**Files:**
- Delete: `Extensions/WebClipper/scripts/build.mjs`
- Delete: `Extensions/WebClipper/scripts/check.mjs`

**Step 1: 实现**
- 前置：WXT build 已覆盖所有目标产物与校验（Chrome/Edge/Firefox）。
- 删除后把等价校验接入到新 scripts（例如 lint/typecheck/build）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: 不依赖旧脚本仍可构建

---

### Task 22: 保留/重建 AMO source package 能力（Firefox 上架必需）

**Files:**
- Modify/Create: `Extensions/WebClipper/scripts/package-amo-source.mjs`（或替代脚本）
- Modify: `Extensions/WebClipper/package.json`

**Step 1: 实现**
- 让 “source package” 能包含 reviewer 需要的可读源码，并能复现 XPI 构建（对齐现有 `package-amo-source` 目标）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run package:amo-source`（或新命令）
- Expected: 生成 zip，且文档说明可复现构建

---

### Task 23: 更新 WebClipper AGENTS.md（反映新结构与命令）

**Files:**
- Modify: `Extensions/WebClipper/AGENTS.md`

**Step 1: 实现**
- 更新入口索引、命令、目录结构（只写事实，不写愿景）。

**Step 2: 验证**
- Expected: 新同学按 AGENTS.md 能 dev/build/firefox 临时加载

---

## 不确定项（必须在 P1 完成前定稿）

- WXT unlisted page（app）的入口文件约定与打包路径（由 Task 02/03 固化）
- WXT Firefox 构建产物能否满足 AMO 审核的“source package 可复现”要求（由 Task 09/22 验证）
- legacy 适配方式选型（importScripts 静态文件 vs legacy 复制到新目录）：以“最少改动 + 能尽快在 WXT 下跑通”为准（由 Task 08 Spike 决策）
