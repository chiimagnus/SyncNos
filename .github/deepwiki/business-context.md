# 业务语境

macOS/ 历史资料已归档；本页仅保留 WebClipper 的业务语义与本地事实源说明。

## 产品定位
SyncNos 仓库不是单一应用，而是一套围绕“知识沉淀”展开的 WebClipper 业务系统；浏览器扩展负责把 AI 对话与网页文章先保存为本地事实，再按需导出或同步到 Notion / Obsidian。

| 产品线 | 主要用户 | 解决的问题 | 用户可见结果 |
| --- | --- | --- | --- |
| WebClipper | 想保存 AI 对话、网页长文、备份本地知识资产的浏览器用户 | 页面内容稍纵即逝、各站点格式不同、需要本地优先再决定是否同步 | 本地会话列表、Markdown / Zip、Notion 页面、Obsidian 笔记 |

## 核心产物

| 产物 | 生产方 | 对用户的意义 | 关键约束 |
| --- | --- | --- | --- |
| Notion Parent Page 下的数据库 / 页面 | WebClipper | 统一承载 AI chats、web articles | 没授权或没选 Parent Page 时必须阻止写入 |
| WebClipper 本地会话库 | WebClipper | 让采集、导出、备份、二次同步都基于同一份本地事实 | 先落 IndexedDB，再派生到任何外部目标 |
| WebClipper Insight 仪表盘 | WebClipper | 把“数据库里的行数”转成用户可见的累计成果、来源结构和最长对话 | 只读、本地计算、不得依赖网络或新增 schema |
| Chat with AI 详情头动作 | WebClipper | 把文章 / 对话内容变成可复制 prompt，并一键跳转到用户启用的 AI 平台 | 先复制到剪贴板，再打开外部站点；不在后台自动发起模型调用 |
| WebClipper 文章评论 / 注释线程 | WebClipper | 给 article detail 和 inpage comments panel 提供本地 threaded comments | 本地注释层，不进入 Notion / Obsidian 同步，但会跟随 Zip v2 备份 / 导入保留 |
| Markdown / Zip / Obsidian | WebClipper | 支持离线保存、迁移、个人知识库接入 | 备份排除 Notion OAuth token 等敏感键 |

## 核心用户旅程

### 旅程 1：AI 对话先变成扩展本地事实，再决定是否同步
1. 用户打开 ChatGPT、Claude、Gemini、Google AI Studio、DeepSeek、Kimi、豆包、元宝、Poe、Notion AI、z.ai 等页面。
2. content script 通过 collector 识别站点，把页面 DOM 统一成 `conversation + messages` 结构。
3. background 把会话写入 IndexedDB；popup / app 读取同一份本地会话数据。
4. 之后用户可以选择继续同步到 Notion、写入 Obsidian、导出 Markdown / Zip，或做备份 / 恢复。

### 旅程 2：普通网页先抓正文，再进入和 AI 对话并列的 article 流程
1. 用户在普通 `http(s)` 页面触发当前页抓取。
2. 扩展向页面注入 `readability.js`，尝试抽取标题、作者、发布时间、正文和 markdown 文本。
3. 抓取结果被保存为 `sourceType = article` 的本地会话，并写入单条 `article_body` 消息。
4. 后续 Notion / Obsidian / 备份 / 导出都把 article 当作与 chat 并列的一种会话类型处理；用户也可以在 article detail 或 inpage comments panel 里留下本地注释线程，这些评论不参与 Notion / Obsidian 同步，但会随 Zip v2 备份 / 导入保留。

### 旅程 4：用户在 Settings 里查看自己的本地积累到底有多大
1. 用户可以直接进入 WebClipper 的 `Settings → Insight`，也可以从会话列表底部 `today/total` 统计点击跳转到该分区。
2. 设置控制器仅在第一次进入该 section 时调用 `getInsightStats()`，从 IndexedDB 的 `conversations` 与 `messages` 现算本地统计。
3. 仪表盘把结果展示为总 clips、AI Conversations、Web Articles、来源分布、文章域名分布和 Top 3 longest conversations。
4. 这个视图是**只读的**：它帮助用户“看见积累”，但不会写回新缓存、不会发网络请求，也不会改变 Notion / Obsidian 的同步状态。

### 旅程 5：用户从详情页把本地内容带去别的 AI 平台继续聊
1. 用户在 popup / app 的 conversation detail 中打开某条 article 或 chat。
2. detail header 会按槽位解析动作：Notion / Obsidian 属于 `Open in`，`Chat with AI` 属于 `chat-with`，chat 还可能出现 `cache-images` 工具动作。
3. `Chat with AI` 触发时，扩展先把 conversation/article 渲染成模板化 payload，按 `maxChars` 截断后写入剪贴板。
4. 完成复制后再跳转到目标 AI 平台首页，例如 `ChatGPT`；因此它是“复制 + 跳转”的本地辅助流，而不是后台帮用户提交 prompt。
5. 当用户触发 `cache-images` 时，扩展会在本地回填历史消息中的图片内容，并刷新 detail，但不会自动发起 Notion / Obsidian 同步。

## 改变行为的业务规则

| 规则 | 生效位置 | 为什么重要 | 行为后果 |
| --- | --- | --- | --- |
| **先授权再写入** | WebClipper 的 Notion 流程 | 没有 Parent Page 或 token 时，所有“看起来成功”的写入都会变成假象 | 所有写入都应显式报错而不是静默跳过 |
| **WebClipper 本地优先** | 扩展数据层 | Notion / Obsidian / 导出都不是事实源，事实源是本地 IndexedDB | 删除、迁移、备份和重建都先围绕本地会话库发生 |
| **Insight 只读，不成为新事实源** | WebClipper Settings | 统计页如果写回缓存或引入额外 schema，会把“观察数据”变成“业务状态” | `Settings → Insight` 每次只读聚合 `conversations` / `messages`，失败时显示错误或空态 |
| **Chat with AI 是“复制 + 跳转”，不是后台代聊** | detail header + settings | 这样才能保持用户对 prompt 与目标平台的控制权，也避免扩展暗中持有额外会话状态 | 没有 detail messages、平台未启用或 URL 无效时，动作直接不出现 |
| **图片缓存是“可选增强”，不是采集成功前提** | `ai_chat_cache_images_enabled` + detail tools | 用户希望“离线可读”时可开启，但不应因图片链路失败影响文本采集 | 实时采集里的图片内联失败不会阻断保存；历史会话可手动触发 `cache-images` 回填 |
| **主题仅跟随系统** | `prefers-color-scheme` + `tokens.css` | 避免维护额外的主题切换状态与 UI；所有 UI 统一随系统暗色设置 | popup / app / inpage 全部只依赖 CSS 媒体查询，不再有 `data-theme` 手动覆盖 |
| **升级不应打断当前会话** | `background.ts` 的 `onInstalled` 行为 | 扩展升级后自动弹设置页会打断正在进行的阅读/对话流程 | 当前仅首次安装自动打开 About；更新保持静默 |
| **敏感信息尽量不出本机** | WebClipper 备份 | 站点 Cookie、加密密钥、Notion OAuth token 都不能随意进备份或明文落盘 | 备份显式排除 `notion_oauth_token*` 与 `notion_oauth_client_secret` |
| **采集站点 ≠ UI 一定显示** | WebClipper inpage 逻辑 | 扩展虽然对所有 `http(s)` 注入 content script，但 inpage 按钮是否启动还受 `inpage_display_mode` 控制 | 切换该设置后必须刷新或新开页面；旧 `inpage_supported_only` 只做兼容回读 |
| **并非所有站点都适合自动增量采集** | Google AI Studio collector | 虚拟列表会导致自动采集只看到可见消息 | 该来源保留“手动保存优先”的策略 |

## 仓库级术语

| 术语 | 业务含义 | 技术落点 |
| --- | --- | --- |
| Parent Page | 用户在 Notion 中选定的上级页面，所有数据库 / 页面都挂在其下 | WebClipper 的 Notion 设置与同步器 |
| 条目（Item） | 一个可同步对象，例如书、文章、会话 | WebClipper 的 conversation |
| 内容片段 | 条目里的高亮、笔记、消息或正文 | WebClipper 的 messages |
| Chat / Article kind | WebClipper 里两类会话 | `conversation-kinds.ts` 决定 Notion DB、Obsidian folder 与重建规则 |
| Cursor | 表示上次同步到了哪里 | WebClipper 用 `lastSyncedMessageKey` / `lastSyncedSequence` |
| 本地事实源 | 当前最可信的本地状态 | WebClipper 是 IndexedDB + `chrome.storage.local` |

## 应该继续读哪里

| 如果你接下来想做什么 | 下一页 | 为什么 |
| --- | --- | --- |
| 先搞清仓库目录、入口和主要产物 | [overview.md](overview.md) | 它回答“仓库里分别有什么”和“应该从哪进”。 |
| 先看系统边界、消息契约和依赖方向 | [architecture.md](architecture.md) | 它回答“这些运行时如何连起来”。 |
| 先看输入如何变成输出 | [data-flow.md](data-flow.md) | 它回答“哪些是事实源，哪些是派生产物”。 |
| 要改扩展的采集、同步、设置或备份 | [modules/webclipper.md](modules/webclipper.md) | 它覆盖 background/content/popup/app、collectors、IndexedDB、sync orchestrators。 |
| 要改扩展的本地统计、Settings Insight 或分布图 | [modules/webclipper.md](modules/webclipper.md), [storage.md](storage.md), [testing.md](testing.md) | 这些页面一起回答“统计从哪来、限制是什么、改完怎么验证”。 |
| 要改扩展的主题模式、Settings 分组、`ai_chat_cache_images_enabled` 或会话详情动作 | [modules/webclipper.md](modules/webclipper.md), [configuration.md](configuration.md), [data-flow.md](data-flow.md) | 这些页面一起覆盖设置键、UI 路由、detail header 三槽位动作、图片回填链路与共享状态。 |
| 要查为什么配置没生效或发布失败 | [configuration.md](configuration.md), [release.md](release.md), [troubleshooting.md](troubleshooting.md) | 这些页面最接近真实错误发生点。 |

## 业务上最容易误判的点
- **WebClipper 的写入链路虽然同时涉及采集、同步与导出，但它们不是一套 UI / 一套存储 / 一套调度逻辑。** 扩展围绕 MV3 runtime、本地会话、popup/app UI 与多目标导出。
- **WebClipper 的“同步”不是采集本身。** 采集先把内容落进本地库，同步只是本地库派生出的后续动作；文章评论则是本地注释层，随 Zip v2 备份 / 导入保留，但仍不进入 Notion / Obsidian 同步。
- **Insight 里的 clip 数量代表本地 IndexedDB 会话数，而不是 Notion 里已经存在的页面数。** 如果用户删了本地会话、没同步某些会话，或 Notion 侧做了手工变更，两边数字本来就可能不同。
- **`Chat with AI` 不是“扩展替你把 prompt 发到目标模型”。** 它只负责在本地把 payload 组装好、复制到剪贴板并打开目标网站；后续提交仍由用户在目标站点完成。
- **`cache-images` 不是“打开开关就自动补齐全部历史图片”。** `ai_chat_cache_images_enabled` 主要影响后续采集；历史会话要在 detail 里手动触发工具动作回填。
- **`$` mention 不是“去云端搜索/引用外部知识库”。** 它只在 ChatGPT/Notion AI 的输入框里从本地 conversations 过滤候选并插入同源 Markdown；`Tab/Enter` 插入，`Esc` 关闭保留文本。
- **“能抓到内容”和“能稳定增量同步”不是一个问题。** 例如 Google AI Studio 因虚拟化列表而更依赖手动保存；article 会话则由 `updatedAt` 决定是否重建目标内容。

## 来源引用（Source References）
- `README.md`
- `AGENTS.md`
- `webclipper/src/collectors/register-all.ts`
- `webclipper/src/collectors/web/article-fetch.ts`
- `webclipper/src/services/protocols/conversation-kinds.ts`
- `webclipper/src/services/bootstrap/content-controller.ts`
- `webclipper/src/services/comments/background/handlers.ts`
- `webclipper/src/services/comments/client/repo.ts`
- `webclipper/src/services/comments/data/storage-idb.ts`
- `webclipper/src/ui/conversations/ArticleCommentsSection.tsx`
- `webclipper/src/services/comments/threaded-comments-panel.ts`
- `webclipper/src/ui/inpage/inpage-comments-panel-shadow.ts`
- `webclipper/src/services/sync/backup/export.ts`
- `webclipper/src/services/sync/backup/import.ts`
- `webclipper/src/services/sync/backup/backup-utils.ts`
- `webclipper/src/services/bootstrap/inpage-comments-panel-content-handlers.ts`
- `webclipper/src/services/comments/sidebar/comment-sidebar-session.ts`
- `webclipper/src/ui/settings/SettingsScene.tsx`
- `webclipper/src/viewmodels/settings/useSettingsSceneController.ts`
- `webclipper/src/ui/conversations/conversations-context.tsx`
- `webclipper/src/ui/conversations/DetailHeaderActionBar.tsx`
- `webclipper/src/ui/conversations/DetailNavigationHeader.tsx`
- `webclipper/src/services/conversations/background/handlers.ts`
- `webclipper/src/services/conversations/background/image-backfill-job.ts`
- `webclipper/src/platform/messaging/message-contracts.ts`
- `webclipper/src/ui/settings/sections/InsightSection.tsx`
- `webclipper/src/ui/settings/sections/InsightPanel.tsx`
- `webclipper/src/viewmodels/settings/insight-stats.ts`
- `webclipper/src/services/integrations/chatwith/chatwith-settings.ts`
- `webclipper/src/services/integrations/chatwith/chatwith-detail-header-actions.ts`
- `webclipper/src/ui/styles/tokens.css`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/popup/PopupShell.tsx`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/ui/conversations/ConversationsScene.tsx`
