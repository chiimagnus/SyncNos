# SyncNos WebClipper（浏览器扩展）Agent 指南

[SyncNos WebClipper](https://github.com/chiimagnus/SyncNos) 是本仓库中的一个独立浏览器扩展（基于 WebExtensions / MV3）。它会从支持的网站抓取 AI 聊天对话并保存到浏览器本地数据库，支持导出（Markdown）、添加到 Obsidian、本地数据库备份/恢复（备份导出为 Zip v2；导入支持 Zip v2 + legacy JSON，且为合并导入），以及手动同步到 Notion。

## 作用范围

- 目标目录：`Extensions/WebClipper/`
- 平台：
  - Chrome / Chromium（开发时通过“加载已解压的扩展程序”）
  - Edge（Chromium，支持加载 Chrome 产物 / Edge 产物）
  - Chrome Web Store：https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok
  - Firefox（已上架 AMO：https://addons.mozilla.org/firefox/addon/syncnos-webclipper/；开发可用临时扩展）
- 支持的网站（content scripts）：ChatGPT、Claude、Gemini、DeepSeek、Kimi、豆包、元宝、Poe、NotionAI、z.ai
- 数据：本地存储（IndexedDB + `chrome.storage.local`）；网络请求主要是手动同步时的 Notion OAuth + Notion API

## 关键约束

- 修改应聚焦在：采集 -> 本地持久化 -> 导出/Obsidian/备份/导入 -> 手动 Notion 同步。
- 权限保持最小且明确；避免添加 `*://*/*` 或无关的 Chrome API。
- 除 `chrome.storage.local` 外，不要记录或持久化任何密钥（Notion OAuth client secret 由用户提供）。
- 优先本地优先体验：自动采集只保存本地；Notion 同步由用户触发，且可能覆盖目标页面内容。
- inpage 错误/加载提示使用锚定 icon 的单例气泡：新消息覆盖旧消息并重播动画，默认展示时长 `1.8s`。
- inpage icon 交互约束：`400ms` 窗口结算后，`count===1` 才执行保存；“恰好双击”才尝试打开 popup；`3/5/7` 连击触发彩蛋动画与台词；若 `openPopup` 不可用则提示用户点击工具栏图标。
- inpage 显示范围开关：`inpage_supported_only`（`chrome.storage.local`）。
  - 默认值 `false`：所有 `http(s)` 页面显示 inpage 按钮。
  - 值为 `true`：仅在已支持 AI 站点 + Notion 页面显示 inpage 按钮（普通网页隐藏）。
  - 切换后应立即生效（当前页面无需刷新）。
  - 该开关只影响 inpage 按钮显示，不影响 popup 中 `Fetch Current Page` 能力。

## 工程开发规范（建议）
以下规范用于保持 WebClipper 可维护、可扩展、可调试，并减少“看起来点了但其实没生效”的隐性故障。

### 通用原则
- **SOLID（适配到本项目的 JS 架构）**
  - **S（单一职责）**：UI（popup）、数据层（IndexedDB/storage）、抓取（collectors）、同步（notion sync）分离；避免“一个模块既抓又存又同步又渲染”。
  - **O（开闭原则）**：新增平台优先通过新增 `collector` + 注册表扩展完成，避免在多处 `switch/if` 扩散。
  - **I（接口隔离）**：以最小能力的“contract/shape”交互（例如 collector 只暴露 `matches/capture`），避免把内部实现细节泄露到调用方。
  - **D（依赖倒置）**：业务逻辑依赖抽象（例如 `notionApi.notionFetch` / `tokenStore`），在测试里可替换 mock。
- **DRY**：重复逻辑抽成共享函数（`popup-core`、`collector-utils`、`notion-api`）；但不要为了抽象而抽象。
- **KISS**：优先可读性与可调试性，避免过度封装、过度动态化。
- **YAGNI**：不为“可能用到”提前引入权限、存储字段、复杂配置项。

### 可观测性与错误处理
- **不要静默吞错**：除非能证明是“可忽略且不影响主流程”的错误，否则必须：
  - 返回结构化错误（`{ ok: false, error: { message, extra } }`），或
  - 在 UI 侧给出明确提示（例如 `alert`/状态文本），并避免无限弹窗。
- **关键路径必须可诊断**：Notion OAuth、Parent Page 选择、同步入口、数据库创建/复用、页面创建/更新、写入 blocks 都应在失败时提供明确错误上下文。
- **避免记录敏感信息**：日志中不要输出 access token、cookie、完整页面内容；必要时只输出摘要/长度/计数。

### 状态与持久化

- **持久化要“显式且一致”**：任何后台流程依赖的配置值（例如 Notion parent page id）都必须在 UI 层确保写入存储；不要依赖“用户碰巧触发了 change”。
- **迁移优先、破坏性操作谨慎**：IndexedDB schema 变更需要迁移策略；备份/导入需兼容旧版本字段与去重规则（导出仅 Zip v2，导入兼容 Zip v2 + legacy JSON）。

### MV3 / WebExtensions 实务

- **Popup 只负责触发与展示**：长任务放后台 Service Worker 执行，popup 通过 message 获取进度/结果。
- **节流与速率限制**：对 Notion 写入必须做 pacing/批量；批量同步要能部分失败不影响其它项。
- **权限变更需要理由**：新增 `permissions/host_permissions` 前先给出“为何需要、替代方案为何不行、风险与范围控制”。

### 模块入口索引（2026-03，WXT 迁移中）

- **WXT Background 入口**：`entrypoints/background.ts`
- **WXT Content 入口**：`entrypoints/content.ts`
- **WXT Popup 入口**：`entrypoints/popup/*`
- **WXT App 入口**：`entrypoints/app/*`
- **消息协议（前后端共享，迁移中）**：`src/protocols/message-contracts.js`
  - 统一 `CORE_MESSAGE_TYPES` / `NOTION_MESSAGE_TYPES` / `OBSIDIAN_MESSAGE_TYPES` / `UI_MESSAGE_TYPES`，禁止在 popup/background 中散落硬编码 type 字符串。
- **后台路由（迁移中）**：`src/bootstrap/background-router.js`
  - 路由 Obsidian Local REST API 同步、Notion 同步任务状态、会话 CRUD 等消息；目标是迁到 TS router 并移除该 legacy 文件。
- **Notion 同步模块**：`src/export/notion/`
  - 重点入口：`notion-sync-orchestrator.js`（编排）、`notion-sync-job-store.js`（任务状态）、`notion-sync-service.js`（写入主流程）、`notion-markdown-blocks.js`（Markdown -> blocks）。
- **Obsidian 模块**：Local REST API Sync（平台主导）
  - 已重构为 Local REST API 平台主导同步：
  - popup：`entrypoints/popup/tabs/SettingsTab.tsx`（配置与连通性测试）+ `entrypoints/popup/tabs/ChatsTab.tsx`（触发同步）
  - background：`src/export/obsidian/obsidian-sync-orchestrator.js`（编排）+ `src/export/obsidian/obsidian-local-rest-client.js`（HTTP client）+ `src/export/obsidian/obsidian-markdown-writer.js`（写入）+ `src/export/obsidian/obsidian-settings-store.js`（配置存储）
- **Web Article Fetch（手动抓取当前页）**：`src/collectors/web/article-fetch-service.js`
  - background 侧通过 `chrome.scripting.executeScript` 注入 `readability.js` 并抽取正文，写入本地 conversations/messages（kind=article）。
- **Inpage 显示范围设置**：`entrypoints/popup/tabs/SettingsTab.tsx` + `src/bootstrap/content-controller.js`
  - popup 负责写入 `inpage_supported_only` 并触发后台 apply。
  - background 通过动态注册/反注册普通网页 content script 来实现“仅支持站点显示”（真正不注入普通网页）：
    - `src/bootstrap/background-inpage-web-visibility.js`
  - 为了“无需刷新立即生效”，已注入的普通网页 tab 会收到一条消息并 stop/cleanup inpage controller（见 `src/bootstrap/content.js`）。

当前 legacy 残留业务域（按优先级迁移）：
- Storage（`src/storage/*` 的 schema/IIFE 注入）
- Events（`src/bootstrap/background-events-hub.js`）
- Sync（`src/export/notion/*`、`src/export/obsidian/*` 的全局依赖）
- Collectors（`src/collectors/*` 的全局注册）
- Inpage（`src/bootstrap/content*.js` + `src/ui/inpage/*` 的全局读写）

### Obsidian 约束

- 默认目录按 kind 分流：
  - chat：`SyncNos-AIChats/`
  - article：`SyncNos-WebArticles/`
- 目录可配置：popup `Settings -> Obsidian Paths` 可分别设置 Chat 与 Web article 的 vault-relative 文件夹。
- 文件路径由 `source + conversationKey` 生成稳定 hash（避免标题改名导致找不到旧文件；文件名不依赖标题）。
- 同步策略（平台主导）：
  - Obsidian 端不存在文件：全量重建（PUT）
  - Obsidian 端存在文件且 frontmatter 兼容：增量追加（PATCH 追加到 heading `SyncNos::Messages`），并 PATCH frontmatter 更新游标
  - 若检测到冲突或 PATCH 失败：自动回退全量重建（PUT）
- 本期仅支持 Obsidian Local REST API 的 HTTP insecure 模式（默认 `http://127.0.0.1:27123`）；不支持 `https://127.0.0.1:27124` 自签名证书模式。
  - popup 配置项默认自动保存（`blur` 保存；`Enter` 可立即保存）。

### 测试与回归

- 涉及以下改动时优先补 `vitest`（`Extensions/WebClipper/tests`）：
  - Notion 同步（blocks 生成、分页/批量、错误分支）
  - OAuth 状态机（pending/error/connected）
  - IndexedDB schema/migration、备份导入合并规则
  - Collector 解析规则（结构变化、空态、异常 DOM）

## Quick Start

- 安装依赖：`npm --prefix Extensions/WebClipper install`
- 本地开发（WXT / Chrome）：`npm --prefix Extensions/WebClipper run dev`
  - 在 `chrome://extensions` 加载 `Extensions/WebClipper/.output/chrome-mv3/`
- 构建（WXT / Chrome）：`npm --prefix Extensions/WebClipper run build`
- 构建（WXT / Firefox）：`npm --prefix Extensions/WebClipper run build:firefox`

## 命令

- 静态检查（先 build，再校验产物 manifest/icons）：`npm --prefix Extensions/WebClipper run check`
- 单元测试（Vitest）：`npm --prefix Extensions/WebClipper run test`
- TypeScript 编译检查：`npm --prefix Extensions/WebClipper run compile`
- 构建（WXT / Chrome）：`npm --prefix Extensions/WebClipper run build`
- 构建（WXT / Firefox）：`npm --prefix Extensions/WebClipper run build:firefox`
- （产物打包到 `dist*`，用于发布/上传；脚本名保留 legacy 前缀）构建（Chrome dist）：`npm --prefix Extensions/WebClipper run legacy:build`
- （产物打包到 `dist*`，用于发布/上传；脚本名保留 legacy 前缀）构建（Edge zip）：`npm --prefix Extensions/WebClipper run legacy:build:edge`
- （产物打包到 `dist*`，用于发布/上传；脚本名保留 legacy 前缀）构建（Firefox `.xpi`）：`npm --prefix Extensions/WebClipper run legacy:build:firefox`
- 校验 Edge dist 产物（先 `legacy:build:edge`）：`npm --prefix Extensions/WebClipper run check:dist:edge`
- 校验 Firefox dist 产物（先 `legacy:build:firefox`）：`npm --prefix Extensions/WebClipper run check:dist:firefox`
- 生成 AMO 源码包（Source code 上传）：`npm --prefix Extensions/WebClipper run package:amo-source`

## Firefox / AMO

- AMO（商店页）：https://addons.mozilla.org/firefox/addon/syncnos-webclipper/

### 本地加载（Firefox 临时扩展）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 “Load Temporary Add-on…”
3. 选择 `Extensions/WebClipper/.output/firefox-mv3/manifest.json`
   - 如果你需要验证“发布/上传产物”的目录结构：先跑 `npm --prefix Extensions/WebClipper run legacy:build:firefox`，再选择 `Extensions/WebClipper/dist-firefox/manifest.json`

### AMO 发布产物

- 提交包（AMO Add-on）：`SyncNos-WebClipper-firefox.xpi`
- 源码包（AMO Source code）：`SyncNos-WebClipper-amo-source.zip`

### AMO Source Package（Reviewer 复现构建说明）

- 源码包应包含可读源码（不转译/拼接/压缩），并能复现提交的 `.xpi`
- 环境要求（已在本仓库验证）：
  - OS: macOS / Linux / Windows
  - Node.js: `v25.1.0`
  - npm: `11.6.2`
  - `zip` 命令：macOS 自带；Ubuntu/Debian 可用 `sudo apt-get install zip`
- 构建步骤：
  1. `npm --prefix Extensions/WebClipper install`
  2. `npm --prefix Extensions/WebClipper run build:firefox`
  - 如需 `.xpi`：用 `npm --prefix Extensions/WebClipper run legacy:build:firefox`

## Chrome 开发

- 打开 `chrome://extensions`
- 启用开发者模式
- 加载已解压扩展：`Extensions/WebClipper/.output/chrome-mv3/`

## Edge 开发

- 打开 `edge://extensions`
- 启用开发人员模式
- 加载已解压扩展：`Extensions/WebClipper/.output/chrome-mv3/`
