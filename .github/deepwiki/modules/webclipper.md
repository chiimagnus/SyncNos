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
| `src/bootstrap/content.ts` | inpage runtime gating | 决定 `inpage_supported_only` 与支持站点如何影响 UI 启动 |
| `src/bootstrap/content-controller.ts` | 自动 / 手动保存控制器 | 单击保存、双击开 popup、article fetch、Google AI Studio 手动保存都在这里 |
| `src/collectors/` | 站点采集适配器 | 新 AI 站点通常从这里扩展 |
| `src/conversations/data/storage-idb.ts` | 本地会话数据层 | 承载 IndexedDB 事实源 |
| `src/platform/idb/schema.ts` | DB schema 与迁移 | 处理 NotionAI stable key migration |
| `src/sync/notion/notion-sync-orchestrator.ts` | Notion 同步编排 | 控制 DB / page / cursor / rebuild |
| `src/sync/obsidian/obsidian-sync-orchestrator.ts` | Obsidian 同步编排 | 控制 append / rebuild / rename / fallback |
| `src/ui/settings/SettingsScene.tsx` | 设置页总入口 | 管理 Notion、Notion AI、Obsidian、Backup、Inpage、About |

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
| inpage 交互 | 支持站点默认启用；非支持站点受 `inpage_supported_only` 控制 | 单击保存、双击开 popup、多击彩蛋提示 |

- `content.ts` 在所有 `http(s)` 页面注入，但 **支持站点始终优先启动 controller**；非支持站点则在读取 `inpage_supported_only` 后决定是否启动。
- `inpage-button-shadow.ts` 的点击结算窗口是 `400ms`：单击触发保存，双击尝试打开 popup，多击只触发彩蛋动画与提示。
- Google AI Studio 由于虚拟化渲染，自动保存常常不完整；collector 与 controller 已经显式把它改为“手动保存优先”。

## 本地数据与同步结构

| 区域 | 主要实现 | 关键点 |
| --- | --- | --- |
| 本地会话库 | `storage-idb.ts` | `upsertConversation()` / `syncConversationMessages()` 负责 conversation + message 快照更新 |
| Schema 与迁移 | `schema.ts` | `DB_NAME='webclipper'`, `DB_VERSION=3`，并处理 NotionAI stable key migration |
| 会话种类 | `conversation-kinds.ts` | `chat` 与 `article` 决定 Notion DB、Obsidian folder 与重建规则 |
| Notion 同步 | `notion-sync-orchestrator.ts` | 需要 token + `notion_parent_page_id`，cursor 命中 append，否则 rebuild |
| Obsidian 同步 | `obsidian-sync-orchestrator.ts` | 支持 `incremental_append`、`full_rebuild`、rename；PATCH 失败回退 `full_rebuild_fallback` |
| 备份导入导出 | `backup/export.ts`, `backup/import.ts`, `backup-utils.ts` | Zip v2、敏感键排除、merge import |

- article 会话通过 `sourceType='article'` 标记，并保存单条 `article_body` 正文消息。
- Notion orchestrator 会按 kind 选择 `SyncNos-AI Chats` 或 `SyncNos-Web Articles` 数据库，并在数据库缓存失效时尝试恢复一次。
- Obsidian orchestrator 在 patch 失败时不是直接报错，而是尽量回退全量重建，优先保证文件最终可恢复到正确状态。

## 设置与 UI 入口

| UI 区域 | 主要实现 | 说明 |
| --- | --- | --- |
| 会话列表 / 详情 | `ConversationsScene.tsx`, `ConversationDetailPane.tsx`, `conversations-context.tsx` | popup 与 app 共享同一套会话读取与选择逻辑 |
| 设置页 | `SettingsScene.tsx` | 真实设置中枢，整合 Notion OAuth、Notion AI、Obsidian、Backup、Inpage、About |
| Markdown 渲染 | `ui/shared/markdown.ts`, `ChatMessageBubble.tsx` | 统一消息气泡与导出文本显示 |
| popup 打开 | `ui-background-handlers.ts` | 双击 inpage 按钮时尝试 `openPopup()`，失败则回退提示 |

- Settings controller 会负责读取 / 保存 `notion_parent_page_id`, `notion_parent_page_title`, `notion_ai_preferred_model_index`, 以及 Obsidian 连接参数。
- `ConversationsProvider` 是 popup 与 app 的共享数据入口；大多数 UI bug 都可以沿着 provider → storage → background handler 这条链排查。

## 修改热点与扩展点
- **新增支持站点**：先改 `collectors/` 和 `register-all.ts`，不要把站点判断散落到 popup 或 background。
- **改 inpage 体验**：先看 `content-controller.ts`, `bootstrap/content.ts`, `inpage-button-shadow.ts`, `inpage-tip-shadow.ts`。
- **改会话结构 / 本地持久化**：先看 `storage-idb.ts`, `schema.ts`, `tests/storage/*`。
- **改 Notion / Obsidian 行为**：先看各 orchestrator，再看 `conversation-kinds.ts` 和 settings store。
- **改 article 抓取**：先看 `article-fetch.ts` 与 background handlers，确认保存后的 `sourceType` 和 message 结构没有变。

## 测试与调试抓手

| 场景 | 抓手 | 说明 |
| --- | --- | --- |
| TypeScript 契约回归 | `npm --prefix Extensions/WebClipper run compile` | 最先发现消息类型、collector 输出或 UI 调用问题 |
| 会话 / mapping 迁移异常 | `schema.ts`, `schema-migration.test.ts` | 升级问题先看迁移逻辑 |
| cursor / append / rebuild 异常 | `notion-sync-cursor.test.ts`, Notion / Obsidian orchestrators | 先判断是 mapping 问题还是目标系统问题 |
| inpage 行为异常 | `bootstrap/content.ts`, `content-controller.ts`, `inpage-button-shadow.ts` | 看 gating、点击动作和 runtime invalidation |
| article 抓取失败 | `article-fetch.ts`, `article-fetch-background-handlers.ts` | 看 `Readability` 与 fallback extract |

## 来源引用（Source References）
- `Extensions/WebClipper/wxt.config.ts`
- `Extensions/WebClipper/package.json`
- `Extensions/WebClipper/src/entrypoints/background.ts`
- `Extensions/WebClipper/src/entrypoints/content.ts`
- `Extensions/WebClipper/src/bootstrap/content.ts`
- `Extensions/WebClipper/src/bootstrap/content-controller.ts`
- `Extensions/WebClipper/src/collectors/register-all.ts`
- `Extensions/WebClipper/src/collectors/googleaistudio/googleaistudio-collector.ts`
- `Extensions/WebClipper/src/collectors/web/article-fetch.ts`
- `Extensions/WebClipper/src/collectors/web/article-fetch-background-handlers.ts`
- `Extensions/WebClipper/src/platform/idb/schema.ts`
- `Extensions/WebClipper/src/conversations/data/storage-idb.ts`
- `Extensions/WebClipper/src/platform/messaging/message-contracts.ts`
- `Extensions/WebClipper/src/platform/messaging/ui-background-handlers.ts`
- `Extensions/WebClipper/src/protocols/conversation-kinds.ts`
- `Extensions/WebClipper/src/sync/notion/notion-sync-orchestrator.ts`
- `Extensions/WebClipper/src/sync/obsidian/obsidian-sync-orchestrator.ts`
- `Extensions/WebClipper/src/ui/settings/SettingsScene.tsx`
