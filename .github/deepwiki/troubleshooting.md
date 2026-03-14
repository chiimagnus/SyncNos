# 故障排查

## 症状索引

| 症状 | 可能范围 | 首查位置 | 快速判断 |
| --- | --- | --- | --- |
| App 里同步入口不可用或一开始就失败 | Notion 授权 / Parent Page / paywall 门控 | `RootView.swift`, `IAPService.swift`, `NotionSyncEngine.swift` | 先确认 onboarding 已完成、paywall 状态正确、Notion 已配置 |
| Apple Books / GoodLinks 没读到内容 | 目录授权 / 来源库 | `macOS/SyncNos/AGENTS.md`, 来源服务 | 先确认 macOS 目录权限和来源数据库路径 |
| WeRead / Dedao 登录态失效 | Keychain Cookie / SiteLogins | `SiteLoginsStore.swift` | 看 cookieHeader 是否还能匹配目标域名 |
| 聊天 OCR 历史数据异常 | Chats 存储升级 | `ChatCacheService.swift` | 是否经历过 `chats_v3_minimal.store` 的破坏性升级 |
| WebClipper 页面内按钮没出现 | content script / `inpage_display_mode` / 不支持页面 | `content.ts`, `bootstrap/content.ts` | 开关切换后要刷新页面；支持站点与普通页面逻辑不同 |
| WebClipper 底部 `source/site` 筛选下拉出现多余滚动条或被裁切 | `SelectMenu` 自适应高度 / 容器裁剪边界 | `ConversationListPane.tsx`, `SelectMenu.tsx` | 检查 `adaptiveMaxHeight`、`side` 与 `findNearestClippingRect()` 是否生效 |
| Google AI Studio 自动保存不完整 | collector 虚拟化渲染 | `googleaistudio-collector.ts`, `content-controller.ts` | 该来源更依赖手动保存 |
| 网页文章抓取失败 | `Readability` / 页面正文不足 | `article-fetch.ts` | 常见报错是 `No article content detected` |
| 升级扩展后没有自动跳设置页 | `onInstalled` 行为策略 | `background.ts` | 当前仅首次安装自动打开 About，更新不会自动弹页 |
| 列表底部统计点击无响应 | popup/app 路由桥接 | `ConversationListPane.tsx`, `PopupShell.tsx`, `AppShell.tsx` | 需确认 `onOpenInsightsSection` 已绑定且目标为 `section=insight` |
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
- 双击保存按钮会尝试 `openPopup()`；若浏览器不支持，UI 会退回提示“点击工具栏图标打开 panel”。

### 2. Google AI Studio 会话保存不完整
- 这不是随机故障，而是 collector 已知约束：Google AI Studio 使用虚拟化列表，自动 observer 常常只看到当前可见 turns。
- 扩展已经在 `content-controller.ts` 中把它排除出自动增量保存，改为手动保存时先 `prepareManualCapture()` 再抓完整历史。

### 3. article 抓取失败或抓到空正文
- article fetch 会先等待 DOM 稳定，再尝试 `Readability`，失败后再走 fallback extract。
- 典型错误是 `No article content detected`；优先检查页面是否真的有足够正文、是否是 heavily client-side 内容、是否只抓到了壳层容器。

### 4. 会话能看到，但同步到 Notion / Obsidian 失败
- Notion：先查是否已连接 Notion、是否已选择 `notion_parent_page_id`、当前 kind 对应的 DB / page spec 是否存在、cursor 是否可用。
- Obsidian：重点检查 `apiBaseUrl`, `authHeaderName`, API Key、目标目录，以及 PATCH 失败后是否已自动回退 full rebuild。
- 备份导入：Zip v2 是 merge import；“导入后旧记录还在”通常是设计行为，不是导入失败。

### 5. source/site 筛选菜单高度异常（太矮、滚动条过多或被裁切）
- 会话列表底部的 `sourceFilterSelect` / `siteFilterSelect` 现在启用 `adaptiveMaxHeight`，不再使用固定 `maxHeight=320`。
- `SelectMenu` 展开时会调用 `findNearestClippingRect()` 查找最近 overflow 裁剪容器，再结合 `side='top'|'bottom'` 计算可用高度；在 popup 底部区域、窄视口或字体缩放变化时，菜单高度动态变化是预期行为。
- 如果出现明显裁切，先排查调用方是否误把 `adaptiveMaxHeight` 去掉，或 `MenuPopover` 的 `panelMaxHeight` 被覆盖。

## 构建与发布问题

| 症状 | 首查位置 | 说明 |
| --- | --- | --- |
| `manifest version mismatch` | `wxt.config.ts`, `webclipper-amo-publish.yml`, `webclipper-cws-publish.yml` | 商店 workflow 用 `manifest.version` 而不是 `package.json` version |
| `npm run build` 通过但 `npm run check` 失败 | `package.json`, `.github/scripts/webclipper/check-dist.mjs` | `check` 比 `build` 额外校验 dist 完整性 |
| Firefox AMO 校验报 background / gecko 问题 | `package-release-assets.mjs` | 检查 Firefox manifest patch 是否生效 |
| 发布 workflow 报 secrets 缺失 | 对应 workflow / publish 脚本 | 检查 AMO / CWS secrets 是否存在 |

## 恢复动作

| 操作 | 适用场景 | 备注 |
| --- | --- | --- |
| 重新授权 Notion / 重新选择 Parent Page | App / 扩展 Notion 同步入口被阻止 | 先解决“没有写入落点” |
| 重新登录 WeRead / Dedao / GoodLinks | Cookie Header 失效 | `SiteLoginsStore` 会把新 cookie 写回统一 store |
| 刷新页面 / 新开页面 | inpage 设置刚修改 | 当前实现不做热更新 |
| 手动保存 Google AI Studio | 自动保存不完整 | 让 collector 先滚动并缓存完整 turns |
| 重跑 `compile → test → build`（必要时再 `build:firefox`, `check`） | 扩展构建 / 发布问题 | 先分离类型、逻辑、产物问题 |
| 回看 `storage.md` 确认事实源 | 备份 / mapping / 迁移问题 | 避免把外部产物误当本地事实源 |

## 调试入口

| 入口 / 文件 | 适用问题 | 为什么先看这里 |
| --- | --- | --- |
| `macOS/SyncNos/Views/RootView.swift` | onboarding / paywall / 主界面切换 | 根门控都在这里 |
| `macOS/SyncNos/AppDelegate.swift` | 菜单栏、同步中退出、URL callback | 生命周期级问题集中在这里 |
| `macOS/SyncNos/Services/SiteLogins/SiteLoginsStore.swift` | 登录态与 cookie | 统一域名存储与 legacy migration 都在这里 |
| `macOS/SyncNos/Services/Auth/IAPService.swift` | 试用期、欢迎态、购买缓存 | paywall 逻辑底层事实源 |
| `webclipper/src/bootstrap/content.ts` | inpage gating、支持站点判断 | 为什么按钮出现 / 不出现最先看这里 |
| `webclipper/src/bootstrap/content-controller.ts` | 单击 / 双击 / 手动保存 / article fetch | 页面交互实际入口 |
| `webclipper/src/ui/shared/SelectMenu.tsx` | 下拉菜单高度、键盘导航、裁剪容器计算 | source/site 过滤菜单异常优先看这里 |
| `webclipper/src/platform/idb/schema.ts` | 升级后数据异常 | IndexedDB 版本迁移都在这里 |
| `webclipper/tests/storage/schema-migration.test.ts` | 迁移行为核对 | 最能确认“这是预期迁移还是新 bug” |
| `.github/workflows/webclipper-*.yml` | 发布失败 | 版本校验、secrets、构建顺序的真实来源 |

## 来源引用（Source References）
- `macOS/SyncNos/Views/RootView.swift`
- `macOS/SyncNos/AppDelegate.swift`
- `macOS/SyncNos/Services/Auth/IAPService.swift`
- `macOS/SyncNos/Services/SiteLogins/SiteLoginsStore.swift`
- `macOS/SyncNos/Services/DataSources-From/Chats/ChatCacheService.swift`
- `webclipper/src/bootstrap/content.ts`
- `webclipper/src/bootstrap/content-controller.ts`
- `webclipper/src/entrypoints/background.ts`
- `webclipper/src/ui/popup/PopupShell.tsx`
- `webclipper/src/ui/app/AppShell.tsx`
- `webclipper/src/ui/conversations/ConversationListPane.tsx`
- `webclipper/src/ui/shared/SelectMenu.tsx`
- `webclipper/src/collectors/googleaistudio/googleaistudio-collector.ts`
- `webclipper/src/collectors/web/article-fetch.ts`
- `webclipper/src/platform/idb/schema.ts`
- `webclipper/tests/storage/schema-migration.test.ts`
- `.github/workflows/webclipper-release.yml`
- `.github/workflows/webclipper-amo-publish.yml`
- `.github/workflows/webclipper-cws-publish.yml`
