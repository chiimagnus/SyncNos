# SyncNos WebClipper（浏览器扩展）Agent 指南

[SyncNos WebClipper](https://github.com/chiimagnus/SyncNos) 是本仓库中的一个独立浏览器扩展（基于 WebExtensions / MV3）。它会从支持的网站抓取 AI 聊天对话并保存到浏览器本地数据库，支持导出（Markdown）、添加到 Obsidian、本地数据库备份/恢复（备份导出为 Zip v2；导入支持 Zip v2 + legacy JSON，且为合并导入），以及手动同步到 Notion。

## 阅读入口（先读）

- 仓库级业务入口：[`../.github/deepwiki/business-context.md`](../.github/deepwiki/business-context.md)
- WebClipper 模块页：[`../.github/deepwiki/modules/webclipper.md`](../.github/deepwiki/modules/webclipper.md)
- WebClipper 文章评论 / 注释线程：[`../.github/deepwiki/modules/comments.md`](../.github/deepwiki/modules/comments.md)
- UI 设计系统（tokens/surface/focus ring）：[`src/ui/AGENTS.md`](src/ui/AGENTS.md)（真源）+ [`src/ui/example.html`](src/ui/example.html)（示例）
- 涉及运行时边界、消息流、存储、发布或排障时，再读：[`../.github/deepwiki/architecture.md`](../.github/deepwiki/architecture.md)、[`../.github/deepwiki/data-flow.md`](../.github/deepwiki/data-flow.md)、[`../.github/deepwiki/storage.md`](../.github/deepwiki/storage.md)、[`../.github/deepwiki/release.md`](../.github/deepwiki/release.md)、[`../.github/deepwiki/troubleshooting.md`](../.github/deepwiki/troubleshooting.md)

## 作用范围

- 目标目录：`webclipper/`
- 平台：
  - Chrome / Chromium（开发时通过“加载已解压的扩展程序”）
  - Edge（Chromium，支持加载 Chrome 产物 / Edge 产物）
  - Chrome Web Store：https://chromewebstore.google.com/detail/syncnos-webclipper/hmgjflllphdffeocddjjcfllifhejpok
  - Firefox（已上架 AMO：https://addons.mozilla.org/firefox/addon/syncnos-webclipper/；开发可用临时扩展）
- 支持的网站（content scripts）：ChatGPT、Claude、Gemini、Google AI Studio、DeepSeek、Kimi、豆包、元宝、Poe、NotionAI、z.ai
- 数据：本地存储（IndexedDB + `chrome.storage.local`）；网络请求主要是手动同步时的 Notion OAuth + Notion API

## 关键约束

- 修改应聚焦在：采集 -> 本地持久化 -> 导出/Obsidian/备份/导入 -> 手动 Notion 同步。
- 权限保持最小且明确；避免添加 `*://*/*` 或无关的 Chrome API。
- 除 `chrome.storage.local` 外，不要记录或持久化任何密钥（Notion OAuth client secret 由用户提供）。
- 备份 Zip v2 结构固定为 `manifest.json + sources/conversations.csv + sources/... + config/storage-local.json + assets/image-cache/index.json + assets/image-cache/blobs/*`（用于备份已缓存的图片附件）。
- 备份 `chrome.storage.local` 默认采用“全量非敏感键”策略；敏感键（`notion_oauth_token*`、`notion_oauth_client_secret`）必须排除。
- 备份导入入口统一在 `Settings -> Data -> Backup`（含 Firefox popup）。
- 优先本地优先体验：自动采集只保存本地；Notion 同步由用户触发，且可能覆盖目标页面内容。
- 对话删除必须显式二次确认，避免误删。
- 版本号、DB schema 版本、迁移链路等事实以 `wxt.config.ts`、`schema.ts` 和 workflow 为准；文档优先保留稳定边界，避免多处写死临时版本信息。
- 外观主题使用 `ui_theme_mode`（`system / light / dark`）持久化到 `chrome.storage.local`；popup 与 app 统一通过 `src/ui/shared/hooks/useThemeMode.ts` 应用 `data-theme` 覆盖，禁止在单个页面里偷偷做另一套主题切换状态。
- inpage 错误/加载提示使用锚定 icon 的单例气泡：新消息覆盖旧消息并重播动画，默认展示时长 `1.8s`。
- inpage icon 交互约束：`400ms` 窗口结算后，`count===1` 才执行保存；“恰好双击”才尝试打开 popup；`3/5/7` 连击触发彩蛋动画与台词；若 `openPopup` 不可用则提示用户点击工具栏图标。
- inpage 显示范围设置：`inpage_display_mode`（`chrome.storage.local`）。
  - 默认值 `all`：所有 `http(s)` 页面显示 inpage 按钮。
  - `supported`：仅在已支持 AI 站点 + Notion 页面显示 inpage 按钮（普通网页隐藏）。
  - `off`：所有站点隐藏 inpage 按钮（全局关闭）。
  - 兼容：当 `inpage_display_mode` 不存在时，回退读取旧键 `inpage_supported_only`（`true -> supported`，否则 `all`）。
  - 切换后对**新打开/刷新**的页面生效（当前实现仅在 content script 启动时读取配置）。
  - 该设置只影响 inpage 按钮显示，不影响 popup/app 中 `Fetch Current Page` 能力。
- AI 聊天自动保存开关：`ai_chat_auto_save_enabled`（`chrome.storage.local`，默认 `true`）。
  - 关闭后：不再对支持的 AI 聊天站点执行自动保存（仍可手动点击 inpage 按钮保存）。
  - 切换后对**新打开/刷新**的页面生效。
- AI 对话图片缓存开关：`ai_chat_cache_images_enabled`（`chrome.storage.local`，默认 `false`，beta）。
  - 开启后：对 `sourceType='chat'` 的后续采集尝试内联图片，失败不阻塞保存主链路。
  - 历史会话不会自动补齐；需在 detail header 手动触发 `cache-images` 工具动作回填。
  - `article` 会话不显示该工具动作。
- 文章评论 / 注释线程是 local-first 的 article 补充层：它只依赖 canonical URL 与 conversationId，不进入 Notion / Obsidian / Zip v2。
- 文章评论 / 注释线程现在由 `comments/sidebar/comment-sidebar-session.ts` 统一 open / close / quote / focus / busy 语义；不要再假定存在锚点定位消息或 `inpage-comments-locate-content-handlers.ts`。
- 安装后引导策略：`src/entrypoints/background.ts` 仅在 `details.reason === 'install'` 时自动打开 `Settings -> About`；扩展更新后不再自动弹出设置页。
- 浏览器右键菜单快捷入口：页面右键 -> `SyncNos WebClipper`，可一键“保存当前页面/AI 对话”，并快速切换 inpage 显示范围与 AI 自动保存开关。
- Settings section 分组真源在 `src/ui/settings/types.ts`：
  - `Features`: `general`, `chat_with`
  - `Data`: `backup`, `notion`, `obsidian`
  - `About`: `insight`, `about`
- `Chat with AI` 不只是设置页配置：detail header 会根据启用的平台动态显示 `Chat with <platform>` 动作；动作会先复制 payload，再跳转到目标站点。
- detail header 现在有 `open / chat-with / tools` 三个槽位：其中 `tools` 槽位可承载 `cache-images`（仅 chat 可见），popup/app 窄屏头部与主详情页共用同一套槽位分发规则。
- 会话列表底部 `today/total` 统计在 popup/app 中可作为 Insight 快捷入口：通过 `onOpenInsightsSection` 跳到 `Settings?section=insight`。
- 会话列表底部 `source/site` 筛选菜单统一使用 `SelectMenu` 的 `adaptiveMaxHeight`；菜单展开时会按最近可裁剪容器动态计算可用高度，避免固定 `maxHeight` 导致的多余滚动条或裁切。

## 工程开发规范（建议）
以下规范用于保持 WebClipper 可维护、可扩展、可调试，并减少“看起来点了但其实没生效”的隐性故障。

### 通用原则
- **SOLID（适配到本项目的 JS 架构）**
  - **S（单一职责）**：UI（popup）、数据层（IndexedDB/storage）、抓取（collectors）、同步（notion sync）分离；避免“一个模块既抓又存又同步又渲染”。
  - **O（开闭原则）**：新增平台优先通过新增 `collector` + 注册表扩展完成，避免在多处 `switch/if` 扩散。
    - Google AI Studio 等虚拟列表站点需优先在 collector 层补齐 DOM 兼容，不要把站点特化逻辑散落到 popup/background。
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

### 模块入口索引（2026-03，WXT 新架构）

- **WXT Background 入口**：`src/entrypoints/background.ts`
- **WXT Content 入口**：`src/entrypoints/content.ts`
- **WXT Popup 入口**：`src/entrypoints/popup/*`
- **WXT App 入口**：`src/entrypoints/app/*`
- **消息协议（前后端共享）**：`src/platform/messaging/message-contracts.ts`
  - 统一 `CORE_MESSAGE_TYPES` / `NOTION_MESSAGE_TYPES` / `OBSIDIAN_MESSAGE_TYPES` / `UI_MESSAGE_TYPES`，禁止在 popup/background 中散落硬编码 type 字符串。
- **WebExtensions API 封装层**：`src/platform/webext/`
  - `tabs.ts` / `scripting.ts` / `web-navigation.ts` 统一封装 `chrome.*` 与 `browser.*` 差异；业务模块优先调用封装函数，避免散落全局 API 访问。
- **兼容层已移除**：`src/runtime-context.ts` + `src/export/bootstrap.ts` 已删除；禁止依赖 `globalThis.WebClipper` 的隐式注入。
- **后台初始化与路由（当前）**：`src/entrypoints/background.ts` + `src/bootstrap/background-services.ts` + `src/platform/messaging/background-router.ts`
  - `src/entrypoints/background.ts` 负责创建 services、注册各类 handlers，并启动 router。
- **本地内容库（conversations/messages）**：`src/conversations/`
  - 按职责拆分：`domain/`（类型/纯函数）+ `data/`（IndexedDB）+ `background/`（handlers/storage）+ `client/`（UI 调用）+ `content/`（增量 diff）
- **Notion 同步模块**：`src/sync/notion/`
  - 编排入口：`src/sync/notion/notion-sync-orchestrator.ts`（由 `src/sync/background-handlers.ts` 路由触发）。
- **Obsidian 模块**：Local REST API Sync（平台主导）
  - 已重构为 Local REST API 平台主导同步：
  - popup：`src/ui/popup/tabs/SettingsTab.tsx`（配置与连通性测试）+ `src/ui/popup/tabs/ChatsTab.tsx`（触发同步）
  - background：`src/sync/obsidian/obsidian-sync-orchestrator.ts`。
- **Web Article Fetch（手动抓取当前页）**：`src/collectors/web/article-fetch.ts` + `src/collectors/web/article-fetch-background-handlers.ts`
  - background 侧通过 `scriptingExecuteScript`（`src/platform/webext/scripting.ts`）注入 `src/vendor/readability.js` 并抽取正文，写入本地 conversations/messages（kind=article）。
- **文章评论 / 注释线程**：`src/comments/` + `src/ui/conversations/ArticleCommentsSection.tsx`
  - `article_comments` 是 article detail 与 inpage comments panel 的本地线程，不进入 Notion / Obsidian / Zip v2；改它时先看 storage、background handler 和 shadow panel。
- **UI：消息气泡与 Markdown 渲染（共享）**：`src/ui/shared/ChatMessageBubble.tsx` + `src/ui/shared/markdown.ts`
  - popup 与 app 共用同一套 bubble + renderer，避免“同一条消息在两处渲染不一致”。
- **UI：主题模式（共享）**：`src/ui/shared/hooks/useThemeMode.ts`
  - popup 与 app 都通过同一个 hook 监听 `ui_theme_mode`，并把 `light / dark / system` 应用到根节点 `data-theme`；token 真源在 `src/ui/styles/tokens.css`。
- **会话详情头部动作（共享协议）**：`src/integrations/detail-header-actions.ts` + `src/integrations/detail-header-action-types.ts` + `src/ui/conversations/DetailHeaderActionBar.tsx`
  - popup 与 app 的主详情页、窄屏 `DetailNavigationHeader` 都应消费同一套 action resolver，并按 `open / chat-with / tools` 槽位分发。
  - 槽位内规则：单动作直出按钮，多动作显示菜单；不要在 popup/app 各自写一套“按钮数量判断”逻辑。
  - `Chat with AI` 会根据设置里启用的平台动态生成一个或多个动作；每个动作都会把当前 detail 内容拼成 prompt 写入剪贴板，再跳转到对应平台（当前仍不做 DOM 自动注入与发送）。
  - `cache-images` 由 `conversations-context.tsx` 注入到 `tools` 槽位，触发后调用 `BACKFILL_CONVERSATION_IMAGES` 回填历史消息图片并刷新 detail。
  - `Open in Obsidian` 的文件打开只能走 Obsidian Local REST API 的 `POST /open/{filename}`；`obsidian://open` 只允许用于拉起桌面 App，再回到 REST API 完成目标文件打开。
- **会话列表 UI-only 状态**：`src/ui/conversations/ConversationListPane.tsx` + `src/ui/conversations/pending-open.ts`
  - 来源/站点筛选是 UI-only 状态，保存在 conversations context（`src/ui/conversations/conversations-context.tsx`），并持久化到 `localStorage`：
    - source：`webclipper_conversations_source_filter_key`（backward compat：`webclipper_app_source_filter_key`）
    - site：`webclipper_conversations_site_filter_key`（`all` 时清理 key）
  - `sourceFilterSelect` / `siteFilterSelect` 使用 `SelectMenu` 的 `adaptiveMaxHeight`，由 `findNearestClippingRect()` + `side` 计算动态 `panelMaxHeight`，不再硬编码 `320px`。
  - deep link contract：`/?loc=<base64url(source||conversationKey)>`（codec：`src/shared/conversation-loc.ts`；`source` 统一小写；base64url 无 padding）。
  - app 中会话选中态与 URL 双向同步：`src/ui/app/AppShell.tsx` 在根路由下用 `replace` 维持 `?loc=` 与 active 会话一致（便于直接复制地址栏）。
  - external jump（“定位必达”）统一入口：`openConversationExternalById(conversationId)`（`src/ui/conversations/conversations-context.tsx`）
    - 持久覆盖筛选：source=`all`、site=`all`（不恢复旧筛选）
    - 触发 list/sidebar 一次性定位滚动：context 设置 `pendingListLocateId`，`ConversationListPane` 消费并对目标行 `scrollIntoView({ block: 'nearest' })`（找不到时允许一次 rAF 重试，随后消费避免卡死）
    - list 行点击不会触发该滚动（仅 external jump 才会）
  - `loc` 无效/找不到会话时：回退到默认会话/空态，不 crash、不白屏。
  - 窄屏下从 Insight / notice 等入口“跳详情”时，目标 `conversationId` 通过 `sessionStorage` (`webclipper_pending_open_conversation_id`) 做一次性桥接（`openConversation(...)` + `ConversationsScene` 消费）。
  - 底部统计组件在有 `onOpenInsightsSection` 回调时可点击跳转到 Insight 分区；若无回调则回退为纯展示态。
- **Inpage 显示范围设置**：`src/entrypoints/content.ts` + `src/bootstrap/content.ts`
  - settings 写入：`src/ui/settings/hooks/useSettingsSceneController.ts`（保存 `inpage_display_mode` / `ai_chat_auto_save_enabled` / `ai_chat_cache_images_enabled` 到 `chrome.storage.local`，并兼容旧 `inpage_supported_only`）。
  - content script 统一匹配所有 `http(s)` 页面，在运行时读取 `inpage_display_mode`（及旧 `inpage_supported_only`）决定是否启动 inpage controller（避免依赖动态注册 content scripts 的浏览器兼容差异）。
  - `inpage_display_mode` / `ai_chat_auto_save_enabled` 仍以页面启动时读取为主，切换后通常要刷新页面；`ai_chat_cache_images_enabled` 在 background 消息处理时读取，主要影响后续采集与手动 backfill，不要求重开当前页面。

Phase 3（JS→TS）收口状态：
- `src` 运行时代码已收敛为 TS 主实现（入口文件也已迁入 `src/entrypoints/`）。
- runtime JS allowlist 仅保留第三方脚本资产：`public/src/vendor/readability.js`（产物路径仍为 `src/vendor/readability.js`）。

### Obsidian 约束

- 默认目录按 kind 分流：
  - chat：`SyncNos-AIChats/`
  - article：`SyncNos-WebArticles/`
- 目录可配置：popup `Settings -> Obsidian Paths` 可分别设置 Chat 与 Web article 的 vault-relative 文件夹。
- 文件名格式：`<source>-<title>-<stableId10>.md`，其中 `stableId10` 基于 `source + conversationKey` 的稳定 hash（用于唯一性与定位旧文件）。
- 当 `title` 变化导致文件名变化时：同步会在 Obsidian 侧自动“重命名”（写入新文件并删除旧文件）。
- 同步策略（平台主导）：
  - 每次同步都全量重建（PUT 覆盖整个 `.md` 文件，包括 frontmatter 与正文）
  - 正文结构：
    - chat：`# Conversations` + `## {seq} {role}`
    - article：`## Article` + `## Comments`
- 本期仅支持 Obsidian Local REST API 的 HTTP insecure 模式（默认 `http://127.0.0.1:27123`）；不支持 `https://127.0.0.1:27124` 自签名证书模式。
  - popup 配置项默认自动保存（`blur` 保存；`Enter` 可立即保存）。

### 测试与回归

- 涉及以下改动时优先补 `vitest`（`webclipper/tests`）：
  - Notion 同步（blocks 生成、分页/批量、错误分支）
  - OAuth 状态机（pending/error/connected）
  - IndexedDB schema/migration、备份导入合并规则
  - Collector 解析规则（结构变化、空态、异常 DOM）
- 对 `SelectMenu` / 列表筛选改动，至少补 popup + app 手工冒烟：确认底部条中的菜单高度会按可视区域自适应，空间充足时不出现无谓滚动条，空间不足时不被裁切。

## Quick Start

- 安装依赖：`npm --prefix webclipper install`
- 本地开发（WXT / Chrome）：`npm --prefix webclipper run dev`
  - 在 `chrome://extensions` 加载 `webclipper/.output/chrome-mv3/`
  - 若你使用 Arc（或其他 Chromium 但未安装 Chrome）：可设置 `WXT_CHROME_BINARY` 指向浏览器可执行文件；本项目在 macOS 下也会在未发现 Chrome 时自动尝试使用 `/Applications/Arc.app/Contents/MacOS/Arc`
- 构建（WXT / Chrome）：`npm --prefix webclipper run build`
- 构建（WXT / Firefox）：`npm --prefix webclipper run build:firefox`

## 命令

- 静态检查（先 build，再校验产物 manifest/icons）：`npm --prefix webclipper run check`
- 单元测试（Vitest）：`npm --prefix webclipper run test`
- TypeScript 编译检查：`npm --prefix webclipper run compile`
- 构建（WXT / Chrome）：`npm --prefix webclipper run build`
- 构建（WXT / Firefox）：`npm --prefix webclipper run build:firefox`
- 发布打包（CI 专用，GitHub Actions 直接调用）：`.github/scripts/webclipper/package-release-assets.mjs`
- AMO Source 包（CI 专用）：`.github/scripts/webclipper/package-amo-source.mjs`
- AMO 发布（CI 专用）：`.github/scripts/webclipper/publish-amo.mjs`

## Firefox / AMO

- AMO（商店页）：https://addons.mozilla.org/firefox/addon/syncnos-webclipper/

### 本地加载（Firefox 临时扩展）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 “Load Temporary Add-on…”
3. 选择 `webclipper/.output/firefox-mv3/manifest.json`
   - 本地开发仅使用 WXT 产物；发布产物由 CI 生成。

### AMO 发布产物

- 提交包（AMO Add-on）：`SyncNos-WebClipper-firefox.xpi`
- 源码包（AMO Source code）：`SyncNos-WebClipper-amo-source.zip`

### AMO Source Package（Reviewer 复现构建说明）

- 源码包应包含可读源码（不转译/拼接/压缩），并能复现提交的 `.xpi`
- 环境要求（已在本仓库验证）：
  - OS: macOS / Linux / Windows
  - Node.js: `20.x`（CI 默认）
  - `zip` 命令：macOS 自带；Ubuntu/Debian 可用 `sudo apt-get install zip`
- 构建步骤：
  1. `npm --prefix webclipper install`
  2. `node .github/scripts/webclipper/package-release-assets.mjs --target=firefox --zip --zip-name=SyncNos-WebClipper-firefox.xpi`
  3. `node .github/scripts/webclipper/package-amo-source.mjs`

## Chrome 开发

- 打开 `chrome://extensions`
- 启用开发者模式
- 加载已解压扩展：`webclipper/.output/chrome-mv3/`

## Edge 开发

- 打开 `edge://extensions`
- 启用开发人员模式
- 加载已解压扩展：`webclipper/.output/chrome-mv3/`
