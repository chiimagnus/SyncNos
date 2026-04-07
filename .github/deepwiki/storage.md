# 存储

macOS/ 历史资料已归档；本页仅保留 WebClipper 的本地事实源、备份和迁移说明。

## 存储总览
SyncNos 的“存储”不是一个数据库，而是多层事实源并存：**WebClipper 侧**用 IndexedDB + `chrome.storage.local` + Zip v2 备份维护本地会话与设置；**Notion / Obsidian / 导出文件**则是派生产物，而不是所有场景下的事实源。

| 存储面 | 产品线 | 介质 | 保存内容 | 主要入口 |
| --- | --- | --- | --- | --- |
| IndexedDB | WebClipper | 浏览器本地数据库 | conversations、messages、sync_mappings、image_cache、article_comments、list pagination indexes | `src/platform/idb/schema.ts`, `src/services/conversations/data/storage-idb.ts`, `src/services/comments/data/storage-idb.ts` |
| `chrome.storage.local` | WebClipper | 本地 KV | Notion / Obsidian / `inpage_display_mode` / `ai_chat_auto_save_enabled` / `ai_chat_cache_images_enabled` / `web_article_cache_images_enabled` / `anti_hotlink_rules_v1` / `markdown_reading_profile_v1` / Chat with AI 等运行设置（不缓存 Insight 统计结果） | `src/viewmodels/settings/useSettingsSceneController.ts`、settings stores |
| `localStorage` | WebClipper | 本地 Web Storage | 设置页当前 section、会话来源筛选、App sidebar UI 偏好 | `types.ts`, `ConversationListPane.tsx`, `AppShell.tsx` |
| `sessionStorage` | WebClipper | 本地 Web Storage | 窄屏 list/detail 路由中的待打开 conversation payload（id，或 id+source/key） | `pending-open.ts` |
| Zip v2 备份 | WebClipper | 本地压缩包 | conversations CSV、分源 JSON、storage-local.json、image-cache、article-comments、manifest | `src/services/sync/backup/export.ts`, `src/services/sync/backup/import.ts` |
| 外部结果 | WebClipper | Notion / Obsidian / 文件系统 | 页面、数据库、Markdown、vault 文件 | sync orchestrators / export |

## WebClipper：IndexedDB 与 `chrome.storage.local`

| 存储层 | 名称 / 版本 | 结构 | 作用 |
| --- | --- | --- | --- |
| IndexedDB | `webclipper`, `DB_VERSION = 8` | `conversations`, `messages`, `sync_mappings`, `image_cache`, `article_comments` | 扩展侧事实源（`image_cache` 仅作本地图片缓存，不改变会话主事实源；`article_comments` 供 article 详情评论线程使用；v8 额外回填列表分页 / 筛选索引） |
| `conversations` | object store | `sourceType`, `source`, `conversationKey`, `title`, `url`, `lastCapturedAt`, `notionPageId` 等 | 列表、详情、同步入口 |
| `messages` | object store | `conversationId`, `messageKey`, `contentText`, `contentMarkdown`, `sequence`, `updatedAt` | 生成 Markdown / blocks / note 内容 |
| `sync_mappings` | object store | `notionPageId`, `lastSyncedMessageKey`, `lastSyncedSequence`, `lastSyncedAt`, `updatedAt` | 决定是否能增量同步 |
| `image_cache` | object store | `conversationId + url` 唯一索引、`opfsPath` 等元数据 | 本地图片缓存读取与回填加速 |
| `article_comments` | object store | `canonicalUrl`, `conversationId`, `parentId`, `authorName?`, `quoteText`, `commentText`, `locator?`, `createdAt`, `updatedAt` | article 详情页的本地评论线程、回复与删除（`locator` 为可选的选区锚点信息） |
| `chrome.storage.local` | KV | `inpage_display_mode`, `ai_chat_auto_save_enabled`, `ai_chat_cache_images_enabled`, `web_article_cache_images_enabled`, `notion_parent_page_id`, `notion_parent_page_title`, `chat_with_*`, Obsidian settings, Notion AI 偏好等 | 保存非敏感运行设置 |

- `storage-idb.ts` 的 `syncConversationMessages()` 采用快照式同步：存在的消息 upsert，不再出现的消息从本地删除。
- `deleteConversationsByIds()` 会一并删除 conversation、messages 和 `sync_mappings`，防止 UI 已删但 Notion mapping 仍残留。
- `article_comments` 是独立的本地注释层：它会跟随 article 详情页和 inpage comments panel 使用，并会在 article 同步时进入 Notion / Obsidian 评论区段，同时随 Zip v2 备份 / 导入一起保留。
- `anti_hotlink_rules_v1` 由 `anti-hotlink-rules-store.ts` 维护，文章抓取与图片下载代理会据此决定是否给特定 CDN 补 Referer；规则读取失败不会阻断抓取主链路。
- `markdown_reading_profile_v1` 只影响 popup / app 详情页的 markdown 渲染样式，不会改变会话数据本身。
- `$` mention（在 ChatGPT/Notion AI 输入框插入本地 item）只读扫描 `conversations` 做候选过滤；插入文本复用现有 “Copy full markdown” 的同源格式化链路，且当前不做截断。
- `schema.ts` 的 v2 迁移专门处理 NotionAI thread，把 legacy conversation key 重写为 stable key，并同步迁移 mapping。
- `schema.ts` 的 v4 迁移会归并 legacy article conversations，把 URL 规范化为 canonical key，减少当前页抓取、article 导入与历史数据升级后的重复会话。
- `schema.ts` 的 v6 迁移会清理 `conversations.description` 旧字段，避免历史冗余字段继续扩散到新记录。
- `schema.ts` 的 v7 会把 `article_comments` 作为新 store 纳入 schema，并补齐 `by_canonicalUrl_createdAt` 与 `by_conversationId_createdAt` 索引。
- `ai_chat_cache_images_enabled` / `web_article_cache_images_enabled` 打开后，background 会分别在 chat/article 消息写入时尝试图片内联；对历史消息的补齐由 detail tools 的 `cache-images`（`BACKFILL_CONVERSATION_IMAGES`）触发。

## WebClipper：UI-only 状态存储

并不是所有 WebClipper 状态都值得进入 `chrome.storage.local`。当前代码明确把“跨 popup / app 共享的运行设置”与“纯 UI 导航 / 临时桥接状态”拆开：前者进 `chrome.storage.local`，后者留在 Web Storage。

| 键 | 介质 | 生产方 | 含义 |
| --- | --- | --- | --- |
| `webclipper_settings_active_section` | `localStorage` | `src/viewmodels/settings/types.ts` | 记住用户上次停留的设置 section |
| `webclipper_conversations_source_filter_key` | `localStorage` | `ConversationListPane.tsx` | 记住会话列表来源筛选（如 `all / chatgpt / claude`） |
| `webclipper_conversations_site_filter_key` | `localStorage` | `ConversationListPane.tsx` | `source=web` 时记住站点筛选（如 `all / domain:sspai.com`） |
| `webclipper_app_source_filter_key` | `localStorage` | 旧版本兼容回读 | 旧的来源筛选键，当前只做 backward compatibility |
| `webclipper_pending_open_conversation_id` | `sessionStorage` | `pending-open.ts` | 窄屏下从排行 / 列表导航到 detail 的一次性桥接 payload（`conversationId`，可附带 `source + conversationKey`） |
| `SIDEBAR_COLLAPSED_KEY`, `SIDEBAR_WIDTH_KEY` | `localStorage` | `AppShell.tsx` | 扩展完整 app 页面左侧 sidebar 的折叠与宽度偏好 |

- `pending-open.ts` 的值是一次性消费：`consumePendingOpenConversation()`（或兼容 API `consumePendingOpenConversationId()`）读出后会立刻删除，避免下一次错误复用旧目标。
- `localStorage` 中的来源筛选不影响 IndexedDB 数据，只影响当前列表视图如何过滤显示。

## WebClipper：Insight 统计视图的数据来源

Insight 面板不是新的持久化层，而是对现有本地会话库的**只读聚合视图**。用户进入 `Settings → Insight` 时，控制器会调用 `getInsightStats()`，在同一只读 transaction 中读取 `conversations` 与 `messages`，聚合完成后显式关闭 `db`。

| 指标 | 读取源 | 聚合规则 | UI 去向 |
| --- | --- | --- | --- |
| `totalClips` | `conversations` | 只统计识别出的 `chat + article` 数量；忽略其他 `sourceType` | 顶部 Total Clips 卡片 |
| `chatCount` | `conversations` | `sourceType === 'chat'` 的 conversation 数 | `AI Conversations` 卡片 |
| `articleCount` | `conversations` | `sourceType === 'article'` 的 conversation 数 | `Web Articles` 卡片 |
| `chatSourceDistribution` | `conversations.source` | 按平台名分组，排序后保留 Top 4，其余折叠为 `Other` | 左侧来源分布条形图 |
| `totalMessages` | `messages` + chat conversations | 只累计 chat conversation 的消息数 | Top 3 longest conversations 右侧计数 |
| `topConversations` | `conversations + messages` | 按 `messageCount desc`、`conversationId desc` 排序后取 Top 3 | 最长对话排行 |
| `articleDomainDistribution` | `conversations.url` | 从 `url` 提取 hostname，排序后保留 Top 8，其余折叠为 `Other` | 右侧文章域名分布条形图 |

- `INSIGHT_CHAT_SOURCE_LIMIT = 4`、`INSIGHT_ARTICLE_DOMAIN_LIMIT = 8`、`INSIGHT_TOP_CONVERSATION_LIMIT = 3` 都定义在 `insight-stats.ts`。
- URL 解析失败时进入 `Unknown` 域名桶；空标题通过 `formatConversationTitle()` 规范化为 untitled fallback。
- Insight 不读 `sync_mappings`，也不关心是否已经同步到 Notion / Obsidian；它只反映**当前本地 IndexedDB** 的事实状态。
- 统计不依赖 `createdAt` 或网络时间线；它只基于现有 conversation / message 快照做结构化汇总。

## 备份、导出与外部落点

| 产物 | 位置 / 目标 | 生成方 | 说明 |
| --- | --- | --- | --- |
| Zip v2 备份 | 用户本地 zip 文件 | WebClipper | 固定包含 `manifest.json`, `config/storage-local.json`, `sources/conversations.csv`, `sources/*.json`, `assets/image-cache/index.json`, `assets/image-cache/blobs/*`, `assets/article-comments/index.json` |
| Markdown 导出 | 用户本地文件系统 | WebClipper | 从本地会话派生，支持单文件 / 多文件 |
| Obsidian 笔记 | 本地 vault | WebClipper | chat 与 article 默认写到不同目录 |
| Notion 页面 / 数据库 | 用户 Parent Page | WebClipper | 最终交付物，不替代本地事实源 |

- `backup-utils.ts` 会排除 `notion_oauth_token_v1`、`notion_oauth_client_secret`，并排除任何以 `notion_oauth_token` 开头的键。
- `import.ts` 是“merge import”，不是暴力覆盖：它会尽量保留本地已有 mapping / cursor / 非空字段，只在缺失时补充导入值。
- `localStorage` / `sessionStorage` 里的 UI-only 状态不进入 Zip v2 备份；备份仍以 `chrome.storage.local` 的非敏感键和 IndexedDB 事实数据为主。
- 当前 Zip v2 备份覆盖 `conversations`、`messages`、`sync_mappings`、`image_cache`（已缓存的图片附件）、`article_comments`（文章评论线程）以及 `storage-local`（非敏感键）；恢复时会一并保留文章评论线程。

## 迁移与演进

| 场景 | 位置 | 变化 | 影响 |
| --- | --- | --- | --- |
| NotionAI stable key migration | `schema.ts`, `schema-migration.test.ts` | `oldVersion < 2` 时统一 conversation key 与 canonical URL | 避免旧 threadId / URL 导致重复会话 |
| Legacy article canonicalization | `schema.ts` | `oldVersion < 4` 时按 canonical URL / key 归并 article conversations 与 mapping | 避免当前页抓取、article 导入与历史数据升级后出现重复记录 |
| Legacy conversation 字段清理 | `schema.ts` | `oldVersion < 6` 时删除 `conversations.description` | 减少历史冗余字段在 UI / 导出链路中的歧义 |
| Article comments store | `schema.ts`, `src/services/comments/data/storage-idb.ts` | `article_comments` 由 v7 引入并在当前 schema 中持续保留；v8 继续补齐 list pagination / filter 索引 | 文章评论线程、回复、删除、列表分页 |
| List pagination indexes | `schema.ts`, `src/services/conversations/data/storage-idb.ts` | `oldVersion < 8` 时回填 `listSourceKey` / `listSiteKey` 并补齐 `by_lastCapturedAt_id` 等索引 | 会话列表分页、来源筛选、站点筛选 |
| Mapping 跟随 stable key | `schema-migration.test.ts` | `sync_mappings` 一起迁移 | 保持增量同步连续性 |

## 常见风险与排查点

| 风险 | 位置 | 现象 | 首查入口 |
| --- | --- | --- | --- |
| IndexedDB 迁移异常 | WebClipper | 升级后会话重复、mapping 丢失 | `schema.ts`, `schema-migration.test.ts` |
| 旧版或被裁剪的备份不含文章评论 | WebClipper | `article_comments` 消失或只剩文章正文 | `src/services/comments/data/storage-idb.ts`, `src/services/sync/backup/export.ts`, `src/services/sync/backup/import.ts` |
| 备份导出泄露敏感信息 | WebClipper | backup 包出现 token | `backup-utils.ts` |
| 删除会话后仍保留旧 mapping | WebClipper | 本地删了但同步逻辑仍误判已关联 | `storage-idb.ts` |

## 示例片段
### 片段 1：WebClipper 的本地数据库名称与版本是固定契约
```ts
export const DB_NAME = 'webclipper';
export const DB_VERSION = 8;
```

## 来源引用（Source References）
- `webclipper/src/platform/idb/schema.ts`
- `webclipper/src/services/conversations/data/storage-idb.ts`
- `webclipper/src/viewmodels/settings/useSettingsSceneController.ts`
- `webclipper/src/viewmodels/settings/insight-stats.ts`
- `webclipper/src/services/integrations/chatwith/chatwith-settings.ts`
- `webclipper/src/services/conversations/background/handlers.ts`
- `webclipper/src/services/conversations/background/image-backfill-job.ts`
- `webclipper/src/services/comments/background/handlers.ts`
- `webclipper/src/services/comments/client/repo.ts`
- `webclipper/src/services/comments/data/storage-idb.ts`
- `webclipper/src/viewmodels/conversations/conversations-context.tsx`
- `webclipper/src/ui/conversations/ArticleCommentsSection.tsx`
- `webclipper/src/services/comments/threaded-comments-panel.ts`
- `webclipper/src/ui/inpage/inpage-comments-panel-shadow.ts`
- `webclipper/src/platform/messaging/message-contracts.ts`
- `webclipper/src/viewmodels/settings/types.ts`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/conversations/pending-open.ts`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/services/sync/backup/export.ts`
- `webclipper/src/services/sync/backup/import.ts`
- `webclipper/src/services/sync/backup/backup-utils.ts`
- `webclipper/src/ui/settings/sections/BackupSection.tsx`
- `webclipper/tests/domains/backup-article-comments.test.ts`
- `webclipper/tests/storage/schema-migration.test.ts`
- `webclipper/tests/storage/article-comments-idb.test.ts`
- `webclipper/tests/storage/insight-stats.test.ts`
