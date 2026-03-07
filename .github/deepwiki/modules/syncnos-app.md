# 模块：SyncNos App

## 职责
- 把 Apple Books、GoodLinks、WeRead、Dedao 与聊天 OCR 等来源整理为统一的 Notion 输出。
- 维护桌面端的 onboarding / paywall / main list 门控、菜单栏 / Dock 行为、全局搜索、自动同步与本地安全存储。
- 通过 MVVM + Protocol-Oriented Programming 保持 `Views → ViewModels → Services → Models` 的单向依赖。

## 关键文件

| 路径 | 作用 | 为什么重要 |
| --- | --- | --- |
| `SyncNos/SyncNosApp.swift` | App 主入口与启动期预热 | 决定 IAP、自动同步、缓存服务和窗口结构 |
| `SyncNos/AppDelegate.swift` | 生命周期与菜单栏 / Dock 行为 | 控制同步中退出、Dock reopen、URL scheme 兜底 |
| `SyncNos/Views/RootView.swift` | onboarding / paywall / main list 门控 | 决定用户进入主流程前的顺序 |
| `SyncNos/Services/Core/DIContainer.swift` | 依赖装配根 | App 所有 service / viewmodel 的注入中心 |
| `SyncNos/Services/DataSources-To/Notion/Sync/NotionSyncEngine.swift` | 统一 Notion 同步引擎 | 真正决定数据库 / 页面 / block 写入策略 |
| `SyncNos/Services/SyncScheduling/AutoSyncService.swift` | 自动同步调度 | 定时与通知触发的同步入口 |
| `SyncNos/Services/Auth/IAPService.swift` | 试用期 / 购买 / 恢复购买 | 支撑 paywall 逻辑 |
| `SyncNos/Services/SiteLogins/SiteLoginsStore.swift` | 统一站点登录态 Keychain 存储 | 决定 WeRead / Dedao / GoodLinks 等站点会话 |
| `SyncNos/ViewModels/Search/GlobalSearchViewModel.swift` | 全局搜索 | 体现结果流式聚合与选择保持策略 |

## 运行时结构

| 层 / 区域 | 主要目录 | 核心职责 | 代表实现 |
| --- | --- | --- | --- |
| Views | `SyncNos/Views/` | 渲染主窗口、设置、日志、列表、搜索 UI | `RootView`, `SettingsView` |
| ViewModels | `SyncNos/ViewModels/` | 管理引导、付费墙、搜索等业务状态 | `OnboardingViewModel`, `PayWallViewModel`, `GlobalSearchViewModel` |
| Services | `SyncNos/Services/` | 读取来源、缓存、鉴权、搜索、同步、调度 | `NotionSyncEngine`, `AutoSyncService`, cache services |
| Models | `SyncNos/Models/` | DTO、缓存模型、通知名 | `NotificationNames.swift` |
| Packages | `Packages/` | 可复用的 macOS 能力 | `MenuBarDockKit` |

## 启动与门控

| 阶段 | 入口 | 关键动作 | 结果 |
| --- | --- | --- | --- |
| App 初始化 | `SyncNosApp.init()` | 启动事务监听、刷新购买状态、预热 `syncActivityMonitor` / `syncQueueStore` / WeRead cache / synced highlight store | App 拥有稳定启动基线 |
| 自动同步启动判断 | `SyncNosApp.init()` | 读取 `autoSync.appleBooks`, `autoSync.goodLinks`, `autoSync.weRead` | 如任一为真则启动 `AutoSyncService` |
| 根门控 | `RootView` | 按 `hasCompletedOnboarding` 与 IAP 状态选择 `OnboardingView` / `PayWallView` / `MainListView` | 避免主界面副作用过早发生 |
| AppKit 生命周期 | `AppDelegate` | 处理菜单栏图标、同步中退出保护、Dock reopen、URL callback | 桌面 UX 与生命周期边界稳定 |

- `RootView` 的 paywall 优先级是：**已购买 → 年订阅过期 → 试用过期 → 试用提醒 → 首次欢迎**。
- `OnboardingViewModel` 当前步骤为：`welcome` → `connectNotion` → `enableSources` → `touchMe`。
- `OnboardingViewModel` 在初始化时会同时检查 Notion OAuth 状态和 WeRead cookie 是否存在。

## 同步与数据源结构

| 子系统 | 主要实现 | 关键点 |
| --- | --- | --- |
| 来源读取 | `Services/DataSources-From/` | 每个来源负责把原始内容转成统一同步输入 |
| 同步引擎 | `NotionSyncEngine` | 根据策略选择 singleDatabase / perBookDatabase |
| 同步适配器契约 | `NotionSyncSourceProtocol` | 新数据源通过适配器接入，而不是直接改引擎 |
| 自动同步 | `AutoSyncService` | 默认 5 分钟轮询，provider map 包含 Apple Books / GoodLinks / WeRead / Dedao / Chats |
| 同步参数 | `NotionSyncConfig` | `batchConcurrency=3`, `readRPS=8`, `writeRPS=3`, `appendBatchSize=50`, `timeout=120s` |

- `NotionSyncEngine.EnsureCache` 会去重同一 database / properties 的并发 ensure，避免高并发下重复创建或频繁冲突。
- `AutoSyncService` 既支持定时轮询，也会在 Apple Books / GoodLinks 目录选择、WeRead 登录成功、手动刷新等通知后触发一次同步。

## 本地存储与状态

| 类型 | 实现 | 说明 |
| --- | --- | --- |
| 阅读缓存 | `weread.store`, `dedao.store` 等 SwiftData store | 承载来源缓存与同步辅助状态 |
| 聊天缓存 | `chats_v3_minimal.store` | 破坏性升级后不再保留 OCR 原始 JSON |
| 网页缓存 | `web_article_cache.store` | 用 `contentVersion = 5` 控制抽取策略升级后的失效 |
| 已同步映射 | `synced-highlights.store` | 避免每次都遍历 Notion children |
| 登录态 | `SiteLoginsStore` + Keychain | 统一保存域名 → cookieHeader，并迁移旧 key |
| IAP / 试用期 | `IAPService` | UserDefaults + Keychain 双写，30 天试用期 |

## 搜索、窗口与 UI 基础设施

| 能力 | 主要实现 | 特点 |
| --- | --- | --- |
| 全局搜索 | `GlobalSearchViewModel` | `280ms` debounce、流式接收结果、在排序刷新时尽量保持 selection 稳定 |
| 菜单栏 / Dock | `AppDelegate`, `MenuBarDockKit` | 菜单栏 icon 显示模式、Dock reopen、无窗口时的 Dock 策略 |
| 键盘与焦点 | `RootView` focused scene values + 专项文档 | 用场景值控制窗口级快捷键上下文 |
| 字体缩放 | `.applyFontScale()` 与 `SyncNos.FontScaleLevel` | 所有主视图都应接入统一字体策略 |

## 修改热点与扩展点
- **新增阅读来源**：优先在 `DataSources-From/` 增加读取服务，并通过 `NotionSyncSourceProtocol` 接入 `NotionSyncEngine`。
- **改主流程门控**：优先看 `RootView.swift`, `OnboardingViewModel.swift`, `IAPService.swift`, `PayWallViewModel.swift`。
- **改同步可靠性**：优先看 `NotionSyncEngine.swift`, `NotionSyncConfig.swift`, `AutoSyncService.swift`。
- **改登录态 / 站点会话**：优先看 `SiteLoginsStore.swift`，而不是直接向各来源散落 Cookie 存储。
- **改窗口 / 菜单栏 / Dock**：优先看 `AppDelegate.swift` 与 `Packages/MenuBarDockKit/`。

## 测试与调试抓手

| 场景 | 抓手 | 说明 |
| --- | --- | --- |
| 构建失败 | `xcodebuild -scheme SyncNos -configuration Debug build` | App 改动后的基本验证 |
| paywall / onboarding 异常 | `RootView.swift`, `IAPService.swift`, `PayWallViewModel.swift` | 先查状态优先级，再查 UI |
| 自动同步不触发 | `SyncNosApp.swift`, `AutoSyncService.swift` | 看启动时的三个开关和通知触发链 |
| 登录态异常 | `SiteLoginsStore.swift` | 看 domain 匹配、Keychain migration、WebKit cookies 清理 |
| 搜索体验回归 | `GlobalSearchViewModel.swift` | 看 debounce、streaming 结果排序、selection 保持 |

## 来源引用（Source References）
- `SyncNos/SyncNosApp.swift`
- `SyncNos/AppDelegate.swift`
- `SyncNos/Views/RootView.swift`
- `SyncNos/Services/Core/DIContainer.swift`
- `SyncNos/Services/SyncScheduling/AutoSyncService.swift`
- `SyncNos/Services/DataSources-To/Notion/Sync/NotionSyncEngine.swift`
- `SyncNos/Services/DataSources-To/Notion/Sync/NotionSyncSourceProtocol.swift`
- `SyncNos/Services/DataSources-To/Notion/Config/NotionSyncConfig.swift`
- `SyncNos/Services/Auth/IAPService.swift`
- `SyncNos/Services/SiteLogins/SiteLoginsStore.swift`
- `SyncNos/Services/DataSources-From/Chats/ChatCacheService.swift`
- `SyncNos/Services/WebArticle/WebArticleCacheService.swift`
- `SyncNos/ViewModels/Search/GlobalSearchViewModel.swift`
- `SyncNos/ViewModels/Settings/OnboardingViewModel.swift`
- `SyncNos/ViewModels/Account/PayWallViewModel.swift`
- `.github/docs/键盘导航与焦点管理技术文档（全项目）.md`
