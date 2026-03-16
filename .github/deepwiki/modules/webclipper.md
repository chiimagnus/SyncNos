# 模块：WebClipper

## 职责
- 从支持 AI 站点采集对话、从普通网页抓正文，并把结果先写入本地浏览器数据库。
- 提供 popup / app / inpage 三类用户入口，让用户进行保存、导出、备份、Notion 同步、Obsidian 同步与设置管理。
- 通过 MV3 的 background + content + popup + app 分层，保持“采集、持久化、同步、展示”边界清晰。

## 关键文件

| 路径 | 作用 | 为什么重要 |
| --- | --- | --- |
| `src/entrypoints/background.ts` | 后台 service worker 入口 | 注册 router、handlers、OAuth listener、sync orchestrators |
| `src/entrypoints/content.ts` | 内容脚本入口 | 组装 collectors registry、inpage UI、runtime observer |
| `src/bootstrap/content.ts` | inpage runtime gating | 决定 `inpage_display_mode`（兼容旧 `inpage_supported_only`）与支持站点如何影响 UI 启动 |
| `src/bootstrap/current-page-capture.ts` | 当前页抓取服务 | 统一判断当前标签页可否抓取，并区分 chat / article 两条手动抓取路径 |
| `src/bootstrap/content-controller.ts` | 自动 / 手动保存控制器 | 单击保存、双击开 popup、article fetch、Google AI Studio 手动保存都在这里 |
| `src/integrations/chatwith/chatwith-settings.ts` | Chat with AI 配置与模板渲染 | 管理 prompt 模板、平台列表、最大字符数和复制载荷 |
| `src/integrations/chatwith/chatwith-detail-header-actions.ts` | Chat with AI 详情头动作解析 | 决定哪些平台按钮出现、复制什么 payload、何时跳转 |
| `src/integrations/detail-header-action-types.ts` | 详情头动作槽位契约 | 定义 `open / chat-with / tools` 三类槽位，约束 popup / app 的动作分发 |
| `src/i18n/index.ts` | 扩展内 UI 文案入口 | 按 `navigator.language` 在英文 / 中文翻译表间切换 |
| `src/collectors/` | 站点采集适配器 | 新 AI 站点通常从这里扩展 |
| `src/conversations/data/storage-idb.ts` | 本地会话数据层 | 承载 IndexedDB 事实源 |
| `src/conversations/background/handlers.ts` | 会话消息与图片回填路由 | 控制 `SYNC_CONVERSATION_MESSAGES` 的图片内联与 `BACKFILL_CONVERSATION_IMAGES` 消息处理 |
| `src/conversations/background/image-backfill-job.ts` | 历史消息图片补全任务 | 复扫 conversation 消息并按 diff 增量回写 `contentMarkdown` |
| `src/platform/idb/schema.ts` | DB schema 与迁移 | 处理 NotionAI stable key migration |
| `src/sync/notion/notion-sync-orchestrator.ts` | Notion 同步编排 | 控制 DB / page / cursor / rebuild |
| `src/sync/obsidian/obsidian-sync-orchestrator.ts` | Obsidian 同步编排 | 控制 append / rebuild / rename / fallback |
| `src/ui/settings/SettingsScene.tsx` | 设置页总入口 | 管理 Notion、Notion AI、Obsidian、Backup、Chat with AI、Insight、Inpage、About |
| `src/ui/settings/hooks/useSettingsSceneController.ts` | 设置页状态控制器 | 统一管理存储读写、连接状态、备份动作，并按需懒加载 Insight |
| `src/ui/settings/sections/insight-stats.ts` | Insight 聚合引擎 | 从 IndexedDB 的 `conversations` + `messages` 现算本地 clip 统计 |
| `src/ui/settings/sections/InsightSection.tsx` | Insight 状态容器 | 管理 loading / error / empty / populated 四类状态 |
| `src/ui/settings/sections/InsightPanel.tsx` | Insight 统计视图 | 用 `recharts` 渲染来源分布、文章域名分布与 Top 3 conversation |
| `src/ui/shared/hooks/useThemeMode.ts` | 主题模式应用 | 把 `ui_theme_mode` 转成 `data-theme` 覆盖，驱动 popup / app 同步换肤 |
| `src/ui/shared/SelectMenu.tsx` | 共享下拉菜单组件 | 统一选项菜单键盘行为，并在 `adaptiveMaxHeight` 打开时按可裁剪容器动态计算高度 |
| `src/ui/conversations/ConversationListPane.tsx` | 列表筛选、批量动作与来源持久化 | 控制 `source filter`、today/total 统计、导出/同步/删除菜单 |
| `src/ui/conversations/DetailNavigationHeader.tsx` | 窄屏详情头动作容器 | 让 popup / app 窄屏 detail header 与主详情页共用同一套动作槽位策略 |
| `src/ui/conversations/pending-open.ts` | 窄屏待打开会话桥接 | 让 Insight / 列表 / 路由在 narrow 模式下也能准确落到 detail |

## 运行时结构

| 运行时 | 主要职责 | 关键依赖 | 代表文件 |
| --- | --- | --- | --- |
| background | 消息路由、同步 job、设置处理、OAuth 监听 | router、sync orchestrators、settings handlers | `background.ts` |
| content | 页面观察、collector 识别、inpage UI、自动 / 手动保存 | collectors registry、runtime observer、incremental updater | `content.ts`, `content-controller.ts` |
| popup | 轻量会话 / 设置入口 | React 组件、ConversationsProvider | `src/entrypoints/popup/` |
| app | 扩展完整页面 UI | React Router、ConversationsScene、SettingsScene | `src/entrypoints/app/` |
| conversations | 本地事实源与 CRUD | IndexedDB、background handlers | `storage-idb.ts` |
| sync | Notion / Obsidian / backup 编排层 | `conversation-kinds.ts`, settings stores | `src/sync/` |

## 支持的采集面

| 类型 | 当前覆盖 | 关键特点 |
| --- | --- | --- |
| AI 对话站点 | ChatGPT、Claude、Gemini、Google AI Studio、DeepSeek、Kimi、豆包、元宝、Poe、Notion AI、z.ai | 通过 collectors registry 统一注册 |
| 普通网页文章 | 任意 `http(s)` 页面 | 手动抓取时注入 `readability.js` 提取正文 |
| inpage 交互 | 支持站点默认启用；非支持站点受 `inpage_display_mode` 控制（兼容旧键） | 单击保存、双击开 popup、多击彩蛋提示 |
| Popup 当前页抓取 | `usePopupCurrentPageCapture.ts` + `current-page-capture.ts` | 先判断当前页可抓取，再用统一按钮触发 chat / article 抓取 |

- `content.ts` 在所有 `http(s)` 页面注入，但 **支持站点始终优先启动 controller**；非支持站点则在读取 `inpage_display_mode`（以及兼容旧 `inpage_supported_only`）后决定是否启动。
- `inpage-button-shadow.ts` 的点击结算窗口是 `400ms`：单击触发保存，双击尝试打开 popup，多击只触发彩蛋动画与提示。
- Google AI Studio 由于虚拟化渲染，自动保存常常不完整；collector 与 controller 已经显式把它改为“手动保存优先”。
- popup 里的 “Current Page / Fetch Current Page” 不是盲抓：`current-page-capture.ts` 会先解析当前 collector，支持页走 chat snapshot，普通网页走 article fetch，不支持页则返回显式不可抓取原因。

## 本地数据与同步结构

| 区域 | 主要实现 | 关键点 |
| --- | --- | --- |
| 本地会话库 | `storage-idb.ts` | `upsertConversation()` / `syncConversationMessages()` 负责 conversation + message 快照更新 |
| Schema 与迁移 | `schema.ts` | `DB_NAME='webclipper'`, `DB_VERSION=6`，处理 NotionAI stable key、legacy article canonical key 迁移与 legacy 字段清理 |
| 会话种类 | `conversation-kinds.ts` | `chat` 与 `article` 决定 Notion DB、Obsidian folder 与重建规则 |
| Notion 同步 | `notion-sync-orchestrator.ts` | 需要 token + `notion_parent_page_id`，cursor 命中 append，否则 rebuild |
| Obsidian 同步 | `obsidian-sync-orchestrator.ts` | 支持 `incremental_append`、`full_rebuild`、rename；PATCH 失败回退 `full_rebuild_fallback` |
| 备份导入导出 | `backup/export.ts`, `backup/import.ts`, `backup-utils.ts` | Zip v2、敏感键排除、merge import |

- article 会话通过 `sourceType='article'` 标记，并保存单条 `article_body` 正文消息。
- Notion orchestrator 会按 kind 选择 `SyncNos-AI Chats` 或 `SyncNos-Web Articles` 数据库，并在数据库缓存失效时尝试恢复一次。
- Obsidian orchestrator 在 patch 失败时不是直接报错，而是尽量回退全量重建，优先保证文件最终可恢复到正确状态。
- `schema.ts` 的升级链路采用 `oldVersion < 2 / < 4 / < 6` 分段处理：分别覆盖 NotionAI key 归一、article canonical 归并与 `conversations.description` 旧字段清理。

## 设置与 UI 入口

| UI 区域 | 主要实现 | 说明 |
| --- | --- | --- |
| 会话列表 / 详情 | `ConversationsScene.tsx`, `ConversationDetailPane.tsx`, `DetailNavigationHeader.tsx`, `conversations-context.tsx`, `src/integrations/detail-header-actions.ts` | popup 与 app 共享同一套会话读取、选择与 detail header 动作解析逻辑（含窄屏头部） |
| 设置页 | `SettingsScene.tsx`, `SettingsSidebarNav.tsx`, `types.ts` | 真实设置中枢，按 `Features / Data / About` 分组组织 `General`、`Chat with AI`、`Backup`、`Notion`、`Obsidian`、`Insight`、`About` |
| Markdown 渲染 | `ui/shared/markdown.ts`, `ChatMessageBubble.tsx` | 统一消息气泡与导出文本显示 |
| Chat with AI | `ChatWithAiSection.tsx`, `chatwith-settings.ts`, `chatwith-detail-header-actions.ts` | 管理 prompt 模板、平台列表、最大字符数，并把 article / conversation 渲染为可复制载荷，再从 detail header 触发复制 + 跳转 |
| 详情工具动作 | `conversations-context.tsx`, `DetailHeaderActionBar.tsx`, `DetailNavigationHeader.tsx`, `image-backfill-job.ts` | chat detail 可显示 `cache-images`；触发后回填图片并刷新详情 |
| Insight | `InsightSection.tsx`, `InsightPanel.tsx`, `insight-stats.ts` | 只读统计本地会话库，展示总 clips、chat/article 概览、来源分布、Top 3 最长对话与文章域名分布 |
| i18n | `i18n/index.ts`, `i18n/locales/*.ts` | UI 文案自动根据浏览器语言在 `en` / `zh` 间切换 |
| popup 打开 | `ui-background-handlers.ts` | 双击 inpage 按钮时尝试 `openPopup()`，失败则回退提示 |

- Settings controller 会负责读取 / 保存 `notion_parent_page_id`, `notion_parent_page_title`, `notion_ai_preferred_model_index`, `ai_chat_cache_images_enabled`，以及 Obsidian 连接参数。
- `General` 分区现在承接了原来分散的“外观 + inpage + 自动保存”设置：主题模式使用 `ui_theme_mode`（`system / light / dark`），并由 `useThemeMode()` 把结果应用到 popup / app 根节点。
- `ai_chat_cache_images_enabled` 是 `General` 分区里的独立开关：默认 `false`，仅影响 `sourceType='chat'` 的图片内联；article 会话不会显示该工具动作。
- Chat with AI 配置是新的一级设置分区，默认持久化 `chat_with_prompt_template_v1`, `chat_with_ai_platforms_v1`, `chat_with_max_chars_v1`，支持自定义平台、模板变量和截断长度。
- detail header 的 `Chat with AI` 动作并不固定只有一个：只要某个平台在设置中 `enabled = true` 且当前 detail 有可用 messages，就会生成对应 `Chat with <platform>` 按钮；触发时先复制 payload，再打开平台首页。
- detail header 的动作槽位由 `detail-header-action-types.ts` 统一定义为 `open / chat-with / tools`；`ConversationDetailPane` 与 `DetailNavigationHeader` 都按同一槽位拆分渲染。
- `conversations-context.tsx` 会为非 article 会话注入 `cache-images` 工具动作：点击后调用 `backfillConversationImages()`，后台复扫消息并在成功后刷新当前 detail，同时反馈 `updatedMessages / downloadedCount / fromCacheCount`。
- `useSettingsSceneController.ts` 只在 `activeSection === 'insight'` 且尚未加载过时调用 `getInsightStats()`；统计失败只回到设置页内的错误态，不会额外写缓存或发网络请求。
- `SettingsScene.tsx` 会为 Insight 分区放宽 detail 宽度到 `1120px`，因为这一页需要容纳双栏图表与排行布局。
- `ConversationsProvider` 是 popup 与 app 的共享数据入口；大多数 UI bug 都可以沿着 provider → storage → background handler 这条链排查。
- `ConversationListPane.tsx` 会把来源筛选写入 `localStorage`（`webclipper_conversations_source_filter_key`），因此“为什么列表下次打开还停在 ChatGPT 过滤条件”是预期行为，不是脏状态。
- `ConversationListPane.tsx` 的 `source/site` 筛选已启用 `SelectMenu` 的 `adaptiveMaxHeight`：`SelectMenu` 会通过 `findNearestClippingRect()` 查找最近 overflow 裁剪容器，再按 `side='top'|'bottom'` 计算可用高度（最小 `80px`），所以 popup 底部条里的菜单高度会随可视区域动态变化。
- `ConversationListPane.tsx` 底部 `today / total` 统计在提供 `onOpenInsightsSection` 回调时会变成可点击入口：popup 会跳 `'/settings?section=insight'`，app 会在 HashRouter 内导航到同一路由。
- `ConversationsScene.tsx` 在窄屏下采用 list/detail 双路由；如果某个入口（例如 Insight Top conversations）需要直接开 detail，会通过 `pending-open.ts` 把目标会话先写入 `sessionStorage`，再在 scene 初始化时消费。
- detail header 的单槽位动作由 `DetailHeaderActionBar.tsx` 统一处理：槽位内单动作直出按钮、多动作自动折叠菜单；popup/app 的窄屏头部也沿用同一规则，不再出现“列表详情页和窄屏 header 行为不一致”。
- `Open in Obsidian` 的文件打开只走 Local REST API `POST /open/{filename}`；当 API 因 App 未启动不可达时，只用 `obsidian://open` 拉起桌面 App，随后再重试 REST API。
- 文案国际化是运行时自动行为，不依赖用户手动切换设置：`i18n/index.ts` 只看 `navigator.language`，当前显式支持英文与中文两套 locale。
- `background.ts` 现在只在首次安装时自动打开 About 分区（`/settings?section=about`）；扩展更新后不再自动弹出设置页。

## 修改热点与扩展点
- **新增支持站点**：先改 `collectors/` 和 `register-all.ts`，不要把站点判断散落到 popup 或 background。
- **改 inpage 体验**：先看 `content-controller.ts`, `bootstrap/content.ts`, `inpage-button-shadow.ts`, `inpage-tip-shadow.ts`。
- **改会话结构 / 本地持久化**：先看 `storage-idb.ts`, `schema.ts`, `tests/storage/*`。
- **改 Insight 统计 / 排行 / 图表**：先看 `insight-stats.ts`, `InsightSection.tsx`, `InsightPanel.tsx`, `useSettingsSceneController.ts`；这里决定 Top N、Other 分桶、空态 / 错误态和图表布局。
- **改列表筛选下拉 / 菜单裁切**：先看 `ConversationListPane.tsx`, `SelectMenu.tsx`, `MenuPopover.tsx`；不要再回退固定 `maxHeight`，否则容易在底部条或窄窗口出现无谓滚动条。
- **改主题模式 / Settings 分组**：先看 `types.ts`, `SettingsScene.tsx`, `useSettingsSceneController.ts`, `useThemeMode.ts`, `src/ui/styles/tokens.css`；不要只改某个按钮样式而忽略状态来源。
- **改 detail header 动作分发**：先看 `src/integrations/detail-header-action-types.ts`, `src/integrations/detail-header-actions.ts`, `conversations-context.tsx`, `DetailHeaderActionBar.tsx`, `DetailNavigationHeader.tsx`, `ConversationDetailPane.tsx`；不要在 popup / app JSX 里各自拼动作规则。
- **改图片缓存补全流程（cache-images）**：先看 `conversations-context.tsx`, `conversations/client/repo.ts`, `conversations/background/handlers.ts`, `image-backfill-job.ts`；确认仅 chat 会话显示动作，并核对回填后 detail 刷新与计数反馈。
- **改 Notion / Obsidian 行为**：先看各 orchestrator，再看 `conversation-kinds.ts` 和 settings store。
- **改 article 抓取**：先看 `article-fetch.ts` 与 background handlers，确认保存后的 `sourceType` 和 message 结构没有变。

## 测试与调试抓手

| 场景 | 抓手 | 说明 |
| --- | --- | --- |
| TypeScript 契约回归 | `npm --prefix webclipper run compile` | 最先发现消息类型、collector 输出或 UI 调用问题 |
| 会话 / mapping 迁移异常 | `schema.ts`, `schema-migration.test.ts` | 升级问题先看迁移逻辑 |
| cursor / append / rebuild 异常 | `notion-sync-cursor.test.ts`, Notion / Obsidian orchestrators | 先判断是 mapping 问题还是目标系统问题 |
| 当前页抓取异常 | `current-page-capture.ts`, `background-router-current-page-capture.test.ts`, `usePopupCurrentPageCapture.ts` | 看 capture state 判定、消息转发与按钮状态 |
| inpage 行为异常 | `bootstrap/content.ts`, `content-controller.ts`, `inpage-button-shadow.ts` | 看 gating、点击动作和 runtime invalidation |
| source/site 筛选下拉异常（高度、滚动、裁切） | `ConversationListPane.tsx`, `SelectMenu.tsx`, `MenuPopover.tsx` | 看 `adaptiveMaxHeight`、`findNearestClippingRect()` 与 `side` 设置是否一致 |
| article 抓取失败 | `article-fetch.ts`, `article-fetch-background-handlers.ts` | 看 `Readability` 与 fallback extract |
| Chat with AI / 打开目标异常 | `chatwith-settings.ts`, `chatwith-detail-header-actions.ts`, `detail-header-actions.test.ts`, `app-detail-header-actions.test.ts` | 看模板变量、平台设置、槽位动作分发与 clipboard + 跳转行为 |
| 详情工具动作异常（cache-images） | `conversations-context.tsx`, `conversations/background/handlers.ts`, `image-backfill-job.ts` | 看动作显隐（仅 chat）、`BACKFILL_CONVERSATION_IMAGES` 路由与回填计数是否一致 |
| Insight 统计异常 | `insight-stats.ts`, `InsightSection.tsx`, `InsightPanel.tsx`, `insight-stats.test.ts`, `settings-sections.test.ts` | 先区分是 IndexedDB 读失败、聚合规则偏差、还是 Settings 导航 / 图表布局回归 |

## 来源引用（Source References）
- `webclipper/wxt.config.ts`
- `webclipper/package.json`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/entrypoints/content.ts`
- `webclipper/src/bootstrap/content.ts`
- `webclipper/src/bootstrap/current-page-capture.ts`
- `webclipper/src/bootstrap/content-controller.ts`
- `webclipper/src/collectors/register-all.ts`
- `webclipper/src/collectors/gemini/gemini-collector.ts`
- `webclipper/src/collectors/kimi/kimi-collector.ts`
- `webclipper/src/collectors/zai/zai-collector.ts`
- `webclipper/src/collectors/googleaistudio/googleaistudio-collector.ts`
- `webclipper/src/collectors/web/article-fetch.ts`
- `webclipper/src/collectors/web/article-fetch-background-handlers.ts`
- `webclipper/src/platform/idb/schema.ts`
- `webclipper/src/conversations/data/storage-idb.ts`
- `webclipper/src/conversations/background/handlers.ts`
- `webclipper/src/conversations/background/image-backfill-job.ts`
- `webclipper/src/conversations/client/repo.ts`
- `webclipper/src/i18n/index.ts`
- `webclipper/src/integrations/chatwith/chatwith-settings.ts`
- `webclipper/src/integrations/chatwith/chatwith-detail-header-actions.ts`
- `webclipper/src/integrations/detail-header-actions.ts`
- `webclipper/src/integrations/detail-header-action-types.ts`
- `webclipper/src/platform/messaging/message-contracts.ts`
- `webclipper/src/platform/messaging/ui-background-handlers.ts`
- `webclipper/src/protocols/conversation-kinds.ts`
- `webclipper/src/sync/notion/notion-sync-orchestrator.ts`
- `webclipper/src/sync/obsidian/obsidian-sync-orchestrator.ts`
- `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- `webclipper/src/ui/settings/SettingsScene.tsx`
- `webclipper/src/ui/settings/SettingsSidebarNav.tsx`
- `webclipper/src/ui/settings/types.ts`
- `webclipper/src/ui/settings/sections/ChatWithAiSection.tsx`
- `webclipper/src/ui/settings/sections/InsightSection.tsx`
- `webclipper/src/ui/settings/sections/InsightPanel.tsx`
- `webclipper/src/ui/settings/sections/insight-stats.ts`
- `webclipper/src/ui/shared/hooks/useThemeMode.ts`
- `webclipper/src/ui/shared/MenuPopover.tsx`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/ui/app/conversations/CapturedListSidebar.tsx`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/conversations/ConversationsScene.tsx`
- `webclipper/src/ui/conversations/ConversationDetailPane.tsx`
- `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`
- `webclipper/src/ui/conversations/DetailNavigationHeader.tsx`
- `webclipper/src/ui/conversations/pending-open.ts`
- `webclipper/src/ui/popup/PopupShell.tsx`
- `webclipper/src/ui/popup/usePopupCurrentPageCapture.ts`
- `webclipper/tests/smoke/background-router-current-page-capture.test.ts`
- `webclipper/tests/collectors/gemini-collector.test.ts`
- `webclipper/tests/collectors/kimi-collector.test.ts`
- `webclipper/tests/collectors/zai-collector.test.ts`
- `webclipper/tests/smoke/detail-header-actions.test.ts`
- `webclipper/tests/smoke/app-detail-header-actions.test.ts`
- `webclipper/tests/storage/insight-stats.test.ts`
- `webclipper/tests/unit/settings-sections.test.ts`
