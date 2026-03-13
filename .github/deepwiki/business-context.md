# 业务语境

## 产品定位
SyncNos 仓库不是单一应用，而是一套围绕“知识沉淀”展开的双产品线系统：桌面端负责把阅读高亮、在线阅读登录态和聊天 OCR 结果同步到 Notion；浏览器扩展负责把 AI 对话与网页文章先保存为本地事实，再按需导出或同步到 Notion / Obsidian。

| 产品线 | 主要用户 | 解决的问题 | 用户可见结果 |
| --- | --- | --- | --- |
| SyncNos App | 使用 Apple Books、GoodLinks、微信读书、得到、聊天截图整理知识的 macOS 用户 | 多来源阅读内容分散、同步规则不一致、需要一个统一的 Notion 输出面 | Notion 数据库 / 页面、桌面列表、搜索结果、同步进度 |
| WebClipper | 想保存 AI 对话、网页长文、备份本地知识资产的浏览器用户 | 页面内容稍纵即逝、各站点格式不同、需要本地优先再决定是否同步 | 本地会话列表、Markdown / Zip、Notion 页面、Obsidian 笔记 |

## 核心产物

| 产物 | 生产方 | 对用户的意义 | 关键约束 |
| --- | --- | --- | --- |
| Notion Parent Page 下的数据库 / 页面 | App + WebClipper | 统一承载阅读条目、AI chats、web articles | 没授权或没选 Parent Page 时必须阻止写入 |
| App 本地缓存与状态 | SyncNos App | 支撑增量同步、搜索、登录态、IAP 状态 | 敏感数据优先留在本地 Keychain / 加密存储 |
| WebClipper 本地会话库 | WebClipper | 让采集、导出、备份、二次同步都基于同一份本地事实 | 先落 IndexedDB，再派生到任何外部目标 |
| WebClipper Insight 仪表盘 | WebClipper | 把“数据库里的行数”转成用户可见的累计成果、来源结构和最长对话 | 只读、本地计算、不得依赖网络或新增 schema |
| Chat with AI 详情头动作 | WebClipper | 把文章 / 对话内容变成可复制 prompt，并一键跳转到用户启用的 AI 平台 | 先复制到剪贴板，再打开外部站点；不在后台自动发起模型调用 |
| Markdown / Zip / Obsidian | WebClipper | 支持离线保存、迁移、个人知识库接入 | 备份排除 Notion OAuth token 等敏感键 |

## 核心用户旅程

### 旅程 1：阅读高亮进入 Notion
1. 用户在 App 中完成 Notion OAuth、选择 Parent Page，并至少启用一个数据源。
2. App 按数据源读取 Apple Books / GoodLinks 数据库，或使用站点登录态读取 WeRead / Dedao，或从聊天截图做 OCR。
3. ViewModel 调用 `NotionSyncEngine`，由各来源适配器通过 `NotionSyncSourceProtocol` 交给统一同步引擎。
4. 最终结果不是“原样复制来源”，而是被整理为稳定的数据库 / 页面 / 内容块结构，并记录本地同步状态与映射。

### 旅程 2：AI 对话先变成扩展本地事实，再决定是否同步
1. 用户打开 ChatGPT、Claude、Gemini、Google AI Studio、DeepSeek、Kimi、豆包、元宝、Poe、Notion AI、z.ai 等页面。
2. content script 通过 collector 识别站点，把页面 DOM 统一成 `conversation + messages` 结构。
3. background 把会话写入 IndexedDB；popup / app 读取同一份本地会话数据。
4. 之后用户可以选择继续同步到 Notion、写入 Obsidian、导出 Markdown / Zip，或做备份 / 恢复。

### 旅程 3：普通网页先抓正文，再进入和 AI 对话并列的 article 流程
1. 用户在普通 `http(s)` 页面触发当前页抓取。
2. 扩展向页面注入 `readability.js`，尝试抽取标题、作者、发布时间、正文和 markdown 文本。
3. 抓取结果被保存为 `sourceType = article` 的本地会话，并写入单条 `article_body` 消息。
4. 后续 Notion / Obsidian / 备份 / 导出都把 article 当作与 chat 并列的一种会话类型处理。

### 旅程 4：用户在 Settings 里查看自己的本地积累到底有多大
1. 用户可以直接进入 WebClipper 的 `Settings → Insight`，也可以从会话列表底部 `today/total` 统计点击跳转到该分区。
2. 设置控制器仅在第一次进入该 section 时调用 `getInsightStats()`，从 IndexedDB 的 `conversations` 与 `messages` 现算本地统计。
3. 仪表盘把结果展示为总 clips、AI Conversations、Web Articles、来源分布、文章域名分布和 Top 3 longest conversations。
4. 这个视图是**只读的**：它帮助用户“看见积累”，但不会写回新缓存、不会发网络请求，也不会改变 Notion / Obsidian 的同步状态。

### 旅程 5：用户从详情页把本地内容带去别的 AI 平台继续聊
1. 用户在 popup / app 的 conversation detail 中打开某条 article 或 chat。
2. detail header 会先解析现有目标：Notion / Obsidian 属于“Open in”，而 `Chat with AI` 会根据设置里启用的平台生成一个或多个动作。
3. 动作触发时，扩展先把 conversation/article 渲染成模板化 payload，按 `maxChars` 截断后写入剪贴板。
4. 完成复制后再跳转到目标 AI 平台首页，例如 `ChatGPT`；因此它是“复制 + 跳转”的本地辅助流，而不是后台帮用户提交 prompt。

## 改变行为的业务规则

| 规则 | 生效位置 | 为什么重要 | 行为后果 |
| --- | --- | --- | --- |
| **先授权再写入** | App 与 WebClipper 的 Notion 流程 | 没有 Parent Page 或 token 时，所有“看起来成功”的写入都会变成假象 | 两条产品线都应显式报错而不是静默跳过 |
| **App 根界面先过门控** | `RootView` | App 在主列表之前会先检查 onboarding 与 paywall，避免主界面副作用（如文件夹授权弹窗）先发生 | 用户看到的顺序是 Onboarding → PayWall → MainListView |
| **WebClipper 本地优先** | 扩展数据层 | Notion / Obsidian / 导出都不是事实源，事实源是本地 IndexedDB | 删除、迁移、备份和重建都先围绕本地会话库发生 |
| **Insight 只读，不成为新事实源** | WebClipper Settings | 统计页如果写回缓存或引入额外 schema，会把“观察数据”变成“业务状态” | `Settings → Insight` 每次只读聚合 `conversations` / `messages`，失败时显示错误或空态 |
| **Chat with AI 是“复制 + 跳转”，不是后台代聊** | detail header + settings | 这样才能保持用户对 prompt 与目标平台的控制权，也避免扩展暗中持有额外会话状态 | 没有 detail messages、平台未启用或 URL 无效时，动作直接不出现 |
| **主题默认跟随系统，但允许手动覆盖** | `ui_theme_mode` + `useThemeMode()` | 现在 WebClipper 不再只依赖 `prefers-color-scheme`；用户可以在 Settings 里强制 light / dark | popup 与 app 会监听 `chrome.storage.local` 变化并应用 `data-theme` 覆盖 |
| **升级不应打断当前会话** | `background.ts` 的 `onInstalled` 行为 | 扩展升级后自动弹设置页会打断正在进行的阅读/对话流程 | 当前仅首次安装自动打开 About；更新保持静默 |
| **敏感信息尽量不出本机** | App Keychain、扩展备份 | 站点 Cookie、加密密钥、Notion OAuth token 都不能随意进备份或明文落盘 | 备份显式排除 `notion_oauth_token*` 与 `notion_oauth_client_secret` |
| **采集站点 ≠ UI 一定显示** | WebClipper inpage 逻辑 | 扩展虽然对所有 `http(s)` 注入 content script，但 inpage 按钮是否启动还受 `inpage_display_mode` 控制 | 切换该设置后必须刷新或新开页面；旧 `inpage_supported_only` 只做兼容回读 |
| **并非所有站点都适合自动增量采集** | Google AI Studio collector | 虚拟列表会导致自动采集只看到可见消息 | 该来源保留“手动保存优先”的策略 |

## 仓库级术语

| 术语 | 业务含义 | 技术落点 |
| --- | --- | --- |
| Parent Page | 用户在 Notion 中选定的上级页面，所有数据库 / 页面都挂在其下 | App 的 `NotionConfigStore` 与扩展的 `notion_parent_page_id` |
| 条目（Item） | 一个可同步对象，例如书、文章、会话 | App 的 `UnifiedSyncItem`；扩展的 conversation |
| 内容片段 | 条目里的高亮、笔记、消息或正文 | App 的 `UnifiedHighlight`；扩展的 messages |
| Chat / Article kind | WebClipper 里两类会话 | `conversation-kinds.ts` 决定 Notion DB、Obsidian folder 与重建规则 |
| Cursor | 表示上次同步到了哪里 | App 用同步时间戳；扩展用 `lastSyncedMessageKey` / `lastSyncedSequence` |
| 本地事实源 | 当前最可信的本地状态 | App 是 SwiftData / UserDefaults / Keychain 组合；扩展是 IndexedDB + `chrome.storage.local` |

## 应该继续读哪里

| 如果你接下来想做什么 | 下一页 | 为什么 |
| --- | --- | --- |
| 先搞清仓库目录、入口和主要产物 | [overview.md](overview.md) | 它回答“仓库里分别有什么”和“应该从哪进”。 |
| 先看系统边界、消息契约和依赖方向 | [architecture.md](architecture.md) | 它回答“这些运行时如何连起来”。 |
| 先看输入如何变成输出 | [data-flow.md](data-flow.md) | 它回答“哪些是事实源，哪些是派生产物”。 |
| 要改 App 的启动、同步、缓存、IAP 或搜索 | [modules/syncnos-app.md](modules/syncnos-app.md) | 它覆盖 `SyncNosApp`、`RootView`、`DIContainer`、`NotionSyncEngine` 等核心结构。 |
| 要改扩展的采集、同步、设置或备份 | [modules/webclipper.md](modules/webclipper.md) | 它覆盖 background/content/popup/app、collectors、IndexedDB、sync orchestrators。 |
| 要改扩展的本地统计、Settings Insight 或分布图 | [modules/webclipper.md](modules/webclipper.md), [storage.md](storage.md), [testing.md](testing.md) | 这些页面一起回答“统计从哪来、限制是什么、改完怎么验证”。 |
| 要改扩展的主题模式、Settings 分组或会话详情 `Chat with AI` | [modules/webclipper.md](modules/webclipper.md), [configuration.md](configuration.md) | 这些页面一起覆盖设置键、UI 路由、detail header 动作与共享状态。 |
| 要查为什么配置没生效或发布失败 | [configuration.md](configuration.md), [release.md](release.md), [troubleshooting.md](troubleshooting.md) | 这些页面最接近真实错误发生点。 |

## 业务上最容易误判的点
- **App 和扩展虽然都能写 Notion，但它们不是一套 UI / 一套存储 / 一套调度逻辑。** App 主要围绕桌面状态、来源授权、SwiftData 和 IAP；扩展围绕 MV3 runtime、本地会话、popup/app UI 与多目标导出。
- **WebClipper 的“同步”不是采集本身。** 采集先把内容落进本地库，同步只是本地库派生出的后续动作。
- **Insight 里的 clip 数量代表本地 IndexedDB 会话数，而不是 Notion 里已经存在的页面数。** 如果用户删了本地会话、没同步某些会话，或 Notion 侧做了手工变更，两边数字本来就可能不同。
- **`Chat with AI` 不是“扩展替你把 prompt 发到目标模型”。** 它只负责在本地把 payload 组装好、复制到剪贴板并打开目标网站；后续提交仍由用户在目标站点完成。
- **“能抓到内容”和“能稳定增量同步”不是一个问题。** 例如 Google AI Studio 因虚拟化列表而更依赖手动保存；article 会话则由 `updatedAt` 决定是否重建目标内容。

## 来源引用（Source References）
- `README.md`
- `AGENTS.md`
- `macOS/SyncNos/SyncNosApp.swift`
- `macOS/SyncNos/Views/RootView.swift`
- `macOS/SyncNos/ViewModels/Settings/OnboardingViewModel.swift`
- `macOS/SyncNos/Services/DataSources-To/Notion/Sync/NotionSyncSourceProtocol.swift`
- `webclipper/src/collectors/register-all.ts`
- `webclipper/src/collectors/web/article-fetch.ts`
- `webclipper/src/protocols/conversation-kinds.ts`
- `webclipper/src/bootstrap/content-controller.ts`
- `webclipper/src/ui/settings/SettingsScene.tsx`
- `webclipper/src/ui/settings/hooks/useSettingsSceneController.ts`
- `webclipper/src/ui/settings/sections/InsightSection.tsx`
- `webclipper/src/ui/settings/sections/InsightPanel.tsx`
- `webclipper/src/ui/settings/sections/insight-stats.ts`
- `webclipper/src/integrations/chatwith/chatwith-settings.ts`
- `webclipper/src/integrations/chatwith/chatwith-detail-header-actions.ts`
- `webclipper/src/ui/shared/hooks/useThemeMode.ts`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/popup/PopupShell.tsx`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/ui/conversations/ConversationsScene.tsx`
- `webclipper/src/sync/backup/backup-utils.ts`
