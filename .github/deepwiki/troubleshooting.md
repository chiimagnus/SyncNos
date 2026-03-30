# 故障排查

## 症状索引

| 症状 | 可能范围 | 首查位置 | 快速判断 |
| --- | --- | --- | --- |
| App 里同步入口不可用或一开始就失败 | Notion 授权 / Parent Page / paywall 门控 | `RootView.swift`, `IAPService.swift`, `NotionSyncEngine.swift` | 先确认 onboarding 已完成、paywall 状态正确、Notion 已配置 |
| Apple Books / GoodLinks 没读到内容 | 目录授权 / 来源库 | `macOS/SyncNos/AGENTS.md`, 来源服务 | 先确认 macOS 目录权限和来源数据库路径 |
| WeRead / Dedao 登录态失效 | Keychain Cookie / SiteLogins | `SiteLoginsStore.swift` | 看 cookieHeader 是否还能匹配目标域名 |
| 聊天 OCR 历史数据异常 | Chats 存储升级 | `ChatCacheService.swift` | 是否经历过 `chats_v3_minimal.store` 的破坏性升级 |
| WebClipper 页面内按钮没出现 | content script / `inpage_display_mode` / 不支持页面 | `content.ts`, `src/services/bootstrap/content.ts` | 开关切换后要刷新页面；支持站点与普通页面逻辑不同 |
| WebClipper `$ mention` 没反应（不出候选或无法插入） | item-mention / settings / 站点门控 | `content-controller.ts`, `src/services/integrations/item-mention/**` | 先确认 `ai_chat_dollar_mention_enabled` 与站点 `features.dollarMention` |
| WebClipper 底部 `source/site` 筛选下拉出现多余滚动条或被裁切 | `SelectMenu` 自适应高度 / 容器裁剪边界 | `ConversationListPane.tsx`, `SelectMenu.tsx` | 检查 `adaptiveMaxHeight`、`side` 与 `findNearestClippingRect()` 是否生效 |
| Chat 会话图片一直是外链 / 缓存图片按钮无效 | `ai_chat_cache_images_enabled` / detail tools / backfill job | `src/viewmodels/settings/useSettingsSceneController.ts`, `conversations-context.tsx`, `image-backfill-job.ts` | 先确认是 chat 会话，再看开关、路由消息和回填计数 |
| Google AI Studio 自动保存不完整 | collector 虚拟化渲染 | `googleaistudio-collector.ts`, `content-controller.ts` | 该来源更依赖手动保存 |
| 网页文章抓取失败 | `Readability` / 页面正文不足 | `article-fetch.ts` | 常见报错是 `No article content detected` |
| 升级扩展后没有自动跳设置页 | `onInstalled` 行为策略 | `background.ts` | 当前仅首次安装自动打开 About，更新不会自动弹页 |
| 列表底部统计点击无响应 | popup/app 路由桥接 | `ConversationListPane.tsx`, `PopupShell.tsx`, `AppShell.tsx` | 需确认 `onOpenInsightsSection` 已绑定且目标为 `section=aboutyou` |
| Notion Parent Page 下拉刷新失败 / 空列表 | Notion 连接 / 429 / background handlers | `settings-background-handlers.ts`, `notion-parent-pages.ts` | 先确认 Notion 已连接；若提示 `Retry in about Xs.` 多半是 Notion API 429 限流，等待后重试 |
| Obsidian `Test` 失败或 `Failed to fetch` | Local REST API 设置 | `LocalRestAPI.zh.md`, `SettingsScene` | 重点核对 `http://127.0.0.1:27123`、Insecure HTTP、API Key |
| 发布 workflow 报版本不匹配 | tag / manifest version | `wxt.config.ts`, release workflows | 校对 `manifest.version == tag 去掉 v` |

## 先做哪几步
1. **先判断产品线**：桌面窗口、OCR、来源登录、IAP、NotionSyncEngine 走 App 线；浏览器页面、popup、export、backup、Obsidian、商店打包走 WebClipper 线。
2. **先判断是配置问题还是代码问题**：这个仓库很多“没反应”其实是权限、Parent Page、页面刷新、API Key、tag 版本不一致，而不是逻辑 bug。
3. **先找本地事实源**：App 先查 UserDefaults / Keychain / SwiftData；扩展先查 IndexedDB、`chrome.storage.local`、popup 设置和 workflow 日志。

| 问题类型 | 先看页面 | 典型信号 |
| --- | --- | --- |
| 授权 / 配置 | [configuration.md](configuration.md) | 缺 Parent Page、API Key、manifest version、URL scheme 等 |
| 数据落点 / 本地库 | [storage.md](storage.md) | 会话、缓存、Keychain、备份、迁移问题 |
| 同步 / 数据链路 | [data-flow.md](data-flow.md) | append / rebuild、cursor、mapping、来源读取问题 |
| 打包 / 发布 | [release.md](release.md) | tag、渠道参数、产物命名、AMO / CWS 上传失败 |

## SyncNos App：常见问题

### 1. 启动后不是主列表，而是引导或付费墙
- 这通常不是 bug，而是 `RootView` 的门控设计：未完成 onboarding 时先显示 `OnboardingView`；已完成 onboarding 但试用 / 购买状态触发时，再显示 `PayWallView`。
- 排查顺序：`hasCompletedOnboarding` → `IAPService.hasPurchased` / `hasEverPurchasedAnnual` / `isProUnlocked` / `hasShownWelcome` → 当前展示模式。

### 2. 来源有内容但 App 读不到
- Apple Books / GoodLinks：先查目录授权与来源库路径。
- WeRead / Dedao：先查 `SiteLoginsStore` 是否还能读到对应域名的 cookieHeader；这个 store 是延迟加载的，不会在启动时就自动报错。
- Chats / OCR：先确认是不是经历过 v3 minimal 升级；旧 OCR 原始 JSON 本来就不会继续保留。

### 3. 关闭 App 时被拦住
- 这通常是 `AppDelegate.applicationShouldTerminate` 的保护逻辑：`syncActivityMonitor.isSyncing` 为真时，系统要求用户确认是否强退。
- 真正要查的是“为什么同步长期没结束”，而不是绕过弹窗本身。

## WebClipper：常见问题

### 1. inpage 按钮不显示或设置没生效
- content script 会对所有 `http(s)` 页面注入，但是否真正启动 controller 还受 `SUPPORTED_HOST_SUFFIXES` 与 `inpage_display_mode`（兼容旧 `inpage_supported_only`）控制。
- 如果用户刚切换了设置，当前页面不会热更新；必须刷新或新开页面。
- 双击保存按钮会尝试打开页面内评论侧边栏（inpage comments panel）；若打开失败，UI 会退回提示“请点击工具栏图标进行评论”。

### 2. `$ mention` 不生效 / 候选为空 / 插入失败
- 先确认 `Settings → General` 的 `ai_chat_dollar_mention_enabled` 已开启；关闭时不会注入 `$ mention` 交互。
- 先确认当前站点在 `SUPPORTED_AI_CHAT_SITES` 中启用了 `features.dollarMention`（并非所有已支持采集的 AI 站点都提供 `$ mention`）。
- 候选来自本地会话库：如果本地还没有保存过任何 conversation，候选为空是预期行为；先手动保存一次再试。
- 如果候选有但插入失败：插入会从本地取 conversation detail 并构建 Markdown；若该 conversation detail 为空（例如采集不完整或库中只有列表索引没有详情），插入会失败——需要重新采集/保存该会话或先确认详情页能正常打开。
- 如果切换开关后当前页仍无变化：`ai_chat_dollar_mention_enabled` 通常可在当前标签页热更新启停，但前提是该页面已启动 content controller；若当前页面因 `inpage_display_mode=off` 未启动 controller，仍需刷新或重新进入支持站点。

### 3. Google AI Studio 会话保存不完整
- 这不是随机故障，而是 collector 已知约束：Google AI Studio 使用虚拟化列表，自动 observer 常常只看到当前可见 turns。
- 扩展已经在 `content-controller.ts` 中把它排除出自动增量保存，改为手动保存时先 `prepareManualCapture()` 再抓完整历史。

### 4. article 抓取失败或抓到空正文
- article fetch 会先等待 DOM 稳定，再尝试 `Readability`，失败后再走 fallback extract。
- 典型错误是 `No article content detected`；优先检查页面是否真的有足够正文、是否是 heavily client-side 内容、是否只抓到了壳层容器。

### 5. 会话能看到，但同步到 Notion / Obsidian 失败
- Notion：先查是否已连接 Notion、是否已选择 `notion_parent_page_id`、当前 kind 对应的 DB / page spec 是否存在、cursor 是否可用。
- Obsidian：重点检查 `apiBaseUrl`, `authHeaderName`, API Key、目标目录，以及 PATCH 失败后是否已自动回退 full rebuild。
- 备份导入：Zip v2 是 merge import；“导入后旧记录还在”通常是设计行为，不是导入失败。

### 6. Notion Parent Page 下拉为空 / 加载失败 / 提示 Retry
- Parent Page 列表由 background handlers 拉取：如果 Notion 未连接，会直接提示未连接；如果已连接但列表为空，可能是账号权限或 Notion 侧搜索结果为空。
- 如果提示类似 `Retry in about 12s.`，通常是 Notion API 429 限流：等待提示的秒数后再次点击刷新即可。
- 如果 UI 里显示了“已保存的 Parent Page”但下拉列表不含更多候选，这是 `resolvedSaved` 的兜底行为：目的是不让旧选择直接丢失；要获得更多候选，需要等搜索结果恢复或确保该 workspace 下确实存在可用 parent pages。

### 7. source/site 筛选菜单高度异常（太矮、滚动条过多或被裁切）
- 会话列表底部的 `sourceFilterSelect` / `siteFilterSelect` 现在启用 `adaptiveMaxHeight`，不再使用固定 `maxHeight=320`。
- `SelectMenu` 展开时会调用 `findNearestClippingRect()` 查找最近 overflow 裁剪容器，再结合 `side='top'|'bottom'` 计算可用高度；在 popup 底部区域、窄视口或字体缩放变化时，菜单高度动态变化是预期行为。
- 如果出现明显裁切，先排查调用方是否误把 `adaptiveMaxHeight` 去掉，或 `MenuPopover` 的 `panelMaxHeight` 被覆盖。

### 8. Chat 会话图片缓存没有按预期生效
- 先确认你操作的是 **chat** 会话：article 不会显示 `cache-images` 工具动作，这是设计行为。
- `ai_chat_cache_images_enabled` 主要影响后续采集写入；如果是历史会话，需要在 detail header 手动触发 `cache-images` 才会回填。
- 触发后若提示 `updatedMessages = 0`，通常代表消息里没有可下载图片链接，或链接已失效。
- 如果点击后直接报错，优先检查 `BACKFILL_CONVERSATION_IMAGES` 消息路由是否注册、`conversationId` 是否有效，以及 background 是否成功广播 `conversationsChanged`。

## 构建与发布问题

| 症状 | 首查位置 | 说明 |
| --- | --- | --- |
| `manifest version mismatch` | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml`, `webclipper-edge-publish.yml` | 商店 workflow 用 `manifest.version` 而不是 `package.json` version |
| `npm run build` 通过但 `npm run check` 失败 | `package.json`, `.github/scripts/webclipper/check-dist.mjs` | `check` 比 `build` 额外校验 dist 完整性 |
| Firefox AMO 校验报 background / gecko 问题 | `package-release-assets.mjs` | 检查 Firefox manifest patch 是否生效 |
| 发布 workflow 报 secrets 缺失 | 对应 workflow / publish 脚本 | 检查 AMO / CWS secrets 是否存在 |

## 恢复动作

| 操作 | 适用场景 | 备注 |
| --- | --- | --- |
| 重新授权 Notion / 重新选择 Parent Page | App / 扩展 Notion 同步入口被阻止 | 先解决“没有写入落点” |
| 重新登录 WeRead / Dedao / GoodLinks | Cookie Header 失效 | `SiteLoginsStore` 会把新 cookie 写回统一 store |
| 刷新页面 / 新开页面 | inpage 设置刚修改 | 多数 inpage 相关设置当前实现不做热更新（例外：`ai_chat_dollar_mention_enabled` 通常可热更新） |
| 手动保存 Google AI Studio | 自动保存不完整 | 让 collector 先滚动并缓存完整 turns |
| 在 chat detail 手动触发 `cache-images` | 历史消息图片仍是外链 | 只对 chat 生效；完成后应看到更新计数并自动刷新 detail |
| 重跑 `compile → test → build`（必要时再 `build:firefox`, `check`） | 扩展构建 / 发布问题 | 先分离类型、逻辑、产物问题 |
| 回看 `storage.md` 确认事实源 | 备份 / mapping / 迁移问题 | 避免把外部产物误当本地事实源 |

## 调试入口

| 入口 / 文件 | 适用问题 | 为什么先看这里 |
| --- | --- | --- |
| `macOS/SyncNos/Views/RootView.swift` | onboarding / paywall / 主界面切换 | 根门控都在这里 |
| `macOS/SyncNos/AppDelegate.swift` | 菜单栏、同步中退出、URL callback | 生命周期级问题集中在这里 |
| `macOS/SyncNos/Services/SiteLogins/SiteLoginsStore.swift` | 登录态与 cookie | 统一域名存储与 legacy migration 都在这里 |
| `macOS/SyncNos/Services/Auth/IAPService.swift` | 试用期、欢迎态、购买缓存 | paywall 逻辑底层事实源 |
| `webclipper/src/services/bootstrap/content.ts` | inpage gating、支持站点判断 | 为什么按钮出现 / 不出现最先看这里 |
| `webclipper/src/services/bootstrap/content-controller.ts` | 单击 / 双击 / 手动保存 / article fetch | 页面交互实际入口 |
| `webclipper/src/services/integrations/item-mention/**` | `$ mention` 候选 / 插入异常 | 站点门控、候选搜索、插入 markdown 的实现都在这里 |
| `webclipper/src/ui/shared/SelectMenu.tsx` | 下拉菜单高度、键盘导航、裁剪容器计算 | source/site 过滤菜单异常优先看这里 |
| `webclipper/src/ui/conversations/conversations-context.tsx` | detail tools 动作显隐与回调 | `cache-images` 是否被注入、是否触发 refresh 的第一现场 |
| `webclipper/src/services/conversations/background/handlers.ts` | 消息路由与图片内联开关 | 看 `ai_chat_cache_images_enabled` 读取与 `BACKFILL_CONVERSATION_IMAGES` 注册 |
| `webclipper/src/services/conversations/background/image-backfill-job.ts` | 历史消息图片回填 | 看 `updatedMessages / downloadedCount / fromCacheCount` 的真实来源 |
| `webclipper/src/platform/idb/schema.ts` | 升级后数据异常 | IndexedDB 版本迁移都在这里 |
| `webclipper/tests/storage/schema-migration.test.ts` | 迁移行为核对 | 最能确认“这是预期迁移还是新 bug” |
| `.github/workflows/webclipper-*.yml` | 发布失败 | 版本校验、secrets、构建顺序的真实来源 |

## 来源引用（Source References）
- `macOS/SyncNos/Views/RootView.swift`
- `macOS/SyncNos/AppDelegate.swift`
- `macOS/SyncNos/Services/Auth/IAPService.swift`
- `macOS/SyncNos/Services/SiteLogins/SiteLoginsStore.swift`
- `macOS/SyncNos/Services/DataSources-From/Chats/ChatCacheService.swift`
- `webclipper/src/services/bootstrap/content.ts`
- `webclipper/src/services/bootstrap/content-controller.ts`
- `webclipper/src/services/integrations/item-mention/background-handlers.ts`
- `webclipper/src/services/integrations/item-mention/mention-contract.ts`
- `webclipper/src/services/integrations/item-mention/mention-search.ts`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/ui/popup/PopupShell.tsx`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/conversations/conversations-context.tsx`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `webclipper/src/services/conversations/background/handlers.ts`
- `webclipper/src/services/conversations/background/image-backfill-job.ts`
- `webclipper/src/platform/messaging/message-contracts.ts`
- `webclipper/src/collectors/googleaistudio/googleaistudio-collector.ts`
- `webclipper/src/collectors/web/article-fetch.ts`
- `webclipper/src/platform/idb/schema.ts`
- `webclipper/tests/storage/schema-migration.test.ts`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`

## 更新记录（Update Notes）
- 2026-03-30：同步 Settings 统计入口 deep-link（`section=aboutyou`）与新增 Notion Parent Page 列表刷新（含 429 retry 提示）的故障排查条目。
- 2026-03-29：同步 inpage 双击行为为“打开页面内评论侧边栏（inpage comments panel）”，并新增 `$ mention` 的常见故障排查条目。
