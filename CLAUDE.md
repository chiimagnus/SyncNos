# CLAUDE.md

## 项目概述

**SyncNos** 是一个 SwiftUI macOS 应用程序，用于将 Apple Books、GoodLinks、WeRead、Dedao（得到）和微信聊天 OCR 中的读书高亮和笔记同步到 Notion 数据库。已发布至 [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888)。

### 核心功能
- ✅ **完整数据提取**：从 SQLite 数据库中提取 Apple Books 高亮/笔记（支持时间戳、颜色标签）
- ✅ **智能分页**：大量数据的分页处理，确保性能优化，支持增量加载
- ✅ **GoodLinks 同步**：文章内容、标签和高亮笔记的完整同步
- ✅ **WeRead 集成**：微信读书完整支持，包括 Cookie 自动刷新和透明认证
- ✅ **Dedao 集成**：得到电子书完整支持，包括 WebView 登录和令牌桶限流防反爬
- ✅ **Chats OCR 集成**：微信聊天截图 OCR 识别，支持智能消息方向判断、本地存储加密和解析统计日志
- ✅ **Notion 数据库同步**，支持两种策略：
  - **单一数据库模式**：所有内容在一个 Notion 数据库中
  - **每本书独立模式**：每本书/文章有独立的数据库
- ✅ **同步队列管理**：实时同步进度显示，任务排队和状态跟踪
- ✅ **高亮颜色管理**：支持 Apple Books、GoodLinks 和 WeRead 的颜色标签同步
- ✅ **智能增量自动同步**：每 5 分钟检查一次，只同步有变更的内容，支持按来源独立启用/禁用
- ✅ **Apple Sign In 认证**：通过 FastAPI 后端安全认证，支持 OAuth 授权
- ✅ **应用内购买系统**：30天试用期，统一付费墙界面，调试工具支持
- ✅ **国际化支持**：16 种语言（英、中、丹麦、荷兰、芬兰、法、德、印尼、日、韩、巴西葡、俄、西、瑞典、泰、越南）
- ✅ **空状态视图**：优雅的占位页面提示
- ✅ **模块化设置**：分类明确的设置界面和语言切换
- ✅ **模块化菜单命令**：菜单命令系统完全模块化
- ✅ **增量同步**：基于时间戳的增量同步机制
- ✅ **菜单栏视图**：新增 MenuBarView 和 MenuBarViewModel，提供快捷访问功能
- ✅ **窗口标题优化**：隐藏主窗口标题，优化界面显示
- ✅ **日志级别颜色编码**：UI 中不同日志级别的颜色区分
- ✅ **统一同步引擎**：通过 `NotionSyncEngine` + 适配器模式实现可扩展的同步架构

## 架构

### SwiftUI 应用结构

应用遵循 **MVVM 架构**，具有严格关注点分离：

```
SyncNos/
├── SyncNosApp.swift              # 应用入口
├── AppDelegate.swift             # 应用生命周期管理
├── Views/                        # SwiftUI 视图（UI 层）
│   ├── RootView.swift            # 根视图：管理 Onboarding/PayWall/MainListView 切换
│   ├── MainListView.swift        # 主列表视图
│   ├── Components/               # 可复用 UI 组件
│   │   ├── Cards/                # 卡片组件
│   │   │   ├── ArticleContentCardView.swift
│   │   │   ├── HighlightCardView.swift
│   │   │   ├── InfoHeaderCardView.swift
│   │   │   └── WaterfallLayout.swift # 瀑布流布局
│   │   ├── Controls/             # 控制组件
│   │   │   ├── DataSourceIndicatorBar.swift
│   │   │   ├── FilterSortBar.swift   # 统一筛选排序栏
│   │   │   ├── SwipeableDataSourceContainer.swift
│   │   │   └── SyncQueueView.swift   # 同步队列管理视图
│   │   ├── Keyboard/             # 键盘相关组件
│   │   │   ├── EnclosingScrollViewReader.swift
│   │   │   ├── FirstResponderProxyView.swift
│   │   │   └── WindowReader.swift
│   │   ├── Main/                 # 主界面组件
│   │   └── Theme/                # 主题组件
│   │       └── AppTheme.swift    # 应用主题和样式
│   ├── AppleBooks/
│   │   ├── AppleBooksListView.swift
│   │   └── AppleBooksDetailView.swift
│   ├── GoodLinks/
│   │   ├── GoodLinksListView.swift
│   │   └── GoodLinksDetailView.swift
│   ├── WeRead/
│   │   ├── WeReadListView.swift
│   │   └── WeReadDetailView.swift
│   ├── Dedao/
│   │   ├── DedaoListView.swift
│   │   └── DedaoDetailView.swift
│   ├── Chats/              # 微信聊天 OCR 视图
│   │   ├── ChatListView.swift
│   │   ├── ChatDetailView.swift
│   │   ├── ChatNotifications.swift
│   │   └── Components/
│   │       ├── ChatsMessageBubble.swift
│   │       ├── ChatsSystemMessageRow.swift
│   │       ├── ChatsMessageContextMenu.swift
│   │       └── ChatExportDocument.swift
│   └── Settings/
│       ├── General/
│       │   ├── AboutView.swift
│       │   ├── AppleAccountView.swift
│       │   ├── IAPView.swift
│       │   ├── LanguageView.swift
│       │   ├── LogWindow.swift
│       │   ├── MenuBarView.swift     # 菜单栏视图
│       │   ├── OnboardingComponents.swift
│       │   ├── PayWallView.swift
│       │   ├── SettingsView.swift
│       │   ├── TextSizeSettingsView.swift
│       │   └── VisualEffectBackground.swift
│       ├── SyncFrom/
│       │   ├── AppleBooksSettingsView.swift
│       │   ├── GoodLinksSettingsView.swift
│       │   ├── WeReadSettingsView.swift
│       │   ├── WeReadLoginView.swift
│       │   ├── DedaoSettingsView.swift
│       │   ├── DedaoLoginView.swift
│       │   └── OCRSettingsView.swift
│       ├── SyncTo/
│       │   └── NotionIntegrationView.swift
│       └── Commands/
│           ├── AppCommands.swift
│           ├── EditCommands.swift
│           ├── FileCommands.swift
│           ├── HelpCommands.swift
│           ├── SelectionCommands.swift
│           └── ViewCommands.swift
├── ViewModels/                   # ObservableObject 视图模型
│   ├── AppleBooks/
│   │   ├── AppleBooksViewModel.swift         # 使用 NotionSyncEngine + Adapter
│   │   ├── AppleBooksDetailViewModel.swift   # 使用 NotionSyncEngine + Adapter
│   │   └── AppleBooksSettingsViewModel.swift
│   ├── GoodLinks/
│   │   ├── GoodLinksViewModel.swift          # 使用 NotionSyncEngine + Adapter
│   │   ├── GoodLinksDetailViewModel.swift    # 使用 NotionSyncEngine + Adapter
│   │   └── GoodLinksSettingsViewModel.swift
│   ├── WeRead/
│   │   ├── WeReadViewModel.swift             # 使用 NotionSyncEngine + Adapter
│   │   ├── WeReadDetailViewModel.swift       # 使用 NotionSyncEngine + Adapter
│   │   ├── WeReadLoginViewModel.swift
│   │   └── WeReadSettingsViewModel.swift
│   ├── Dedao/
│   │   ├── DedaoViewModel.swift              # 使用 NotionSyncEngine + Adapter
│   │   ├── DedaoDetailViewModel.swift        # 使用 NotionSyncEngine + Adapter
│   │   ├── DedaoLoginViewModel.swift
│   │   └── DedaoSettingsViewModel.swift
│   ├── Chats/
│   │   └── ChatsViewModel.swift         # 微信聊天 OCR 视图模型
│   ├── Account/
│   │   ├── AccountViewModel.swift
│   │   ├── AppleSignInViewModel.swift
│   │   ├── IAPViewModel.swift
│   │   └── PayWallViewModel.swift
│   ├── MenuBar/
│   │   └── MenuBarViewModel.swift
│   ├── Notion/
│   │   └── NotionIntegrationViewModel.swift
│   ├── Onboarding/
│   │   └── OnboardingViewModel.swift
│   ├── Settings/
│   │   └── LoginItemViewModel.swift
│   ├── Sidebar/
│   │   └── DataSourceSwitchViewModel.swift
│   ├── Sync/
│   │   └── SyncQueueViewModel.swift
│   └── LogViewModel.swift
├── Models/                       # 数据模型
│   ├── Core/                     # 核心通用模型
│   │   ├── Models.swift          # BookRow, Highlight, HighlightRow 等
│   │   ├── UnifiedHighlight.swift # 统一高亮模型（用于 SyncEngine）
│   │   └── HighlightColorScheme.swift # 高亮颜色管理
│   ├── Account/                  # 账户相关模型
│   │   ├── AccountModels.swift   # 认证令牌、登录方法、账户配置
│   │   └── IAPDebugModels.swift  # IAP 调试模型
│   ├── Sync/                     # 同步相关模型
│   │   ├── SyncQueueModels.swift # 同步队列任务模型
│   │   └── SyncedHighlightRecord.swift # 已同步高亮记录（本地 UUID 记录）
│   ├── WeRead/                   # 微信读书模型
│   │   ├── WeReadModels.swift    # API DTO 模型
│   │   └── WeReadCacheModels.swift # SwiftData 缓存模型
│   ├── Dedao/                    # 得到模型
│   │   ├── DedaoModels.swift     # API DTO 模型
│   │   └── DedaoCacheModels.swift # SwiftData 缓存模型
│   └── Chats/               # 微信聊天模型
│       ├── ChatModels.swift    # 微信聊天数据模型
│       └── ChatsCacheModels.swift # SwiftData 缓存模型
└── Services/                     # 业务逻辑和数据访问
    ├── Auth/                     # 认证服务
    │   ├── AuthService.swift     # Apple Sign In 认证
    │   └── IAPService.swift      # 应用内购买
    ├── Core/                     # 核心服务
    │   ├── ConcurrencyLimiter.swift
    │   ├── DIContainer.swift     # 依赖注入容器
    │   ├── EnvironmentDetector.swift
    │   ├── FontScaleManager.swift
    │   ├── LoggerService.swift
    │   ├── KeychainHelper.swift
    │   ├── LoginItemService.swift
    │   └── Protocols.swift       # 服务协议定义
    ├── DataSources-From/         # 数据源（从...获取）
    │   ├── AppleBooks/           # Apple Books SQLite 访问
    │   │   ├── AppleBooksPicker.swift
    │   │   ├── BookFilterService.swift
    │   │   ├── BookmarkStore.swift
    │   │   ├── DatabaseConnectionService.swift
    │   │   ├── DatabaseQueryService.swift
    │   │   ├── DatabaseReadOnlySession.swift
    │   │   └── DatabaseService.swift
    │   ├── GoodLinks/            # GoodLinks 数据库访问
    │   │   ├── GoodLinksConnectionService.swift
    │   │   ├── GoodLinksModels.swift
    │   │   ├── GoodLinksProtocols.swift
    │   │   ├── GoodLinksQueryService.swift
    │   │   ├── GoodLinksService.swift
    │   │   └── GoodLinksTagParser.swift
    │   ├── WeRead/               # 微信读书集成
    │   │   ├── WeReadAPIService.swift          # API 客户端
    │   │   ├── WeReadAuthService.swift         # Cookie 认证服务
    │   │   ├── WeReadCookieRefreshService.swift # Cookie 自动刷新
    │   │   ├── CookieRefreshCoordinator.swift  # 刷新协调器（Actor）
    │   │   ├── WeReadCacheService.swift        # SwiftData 本地缓存
    │   │   ├── WeReadIncrementalSyncService.swift # 增量同步服务
    │   │   └── WeReadRequestLimiter.swift      # 请求限流器
    │   ├── Dedao/                # 得到电子书集成
    │   │   ├── DedaoAPIService.swift           # API 客户端（令牌桶限流）
    │   │   ├── DedaoAuthService.swift          # Cookie 认证服务
    │   │   ├── DedaoRequestLimiter.swift       # 请求限流器
    │   │   └── DedaoCacheService.swift         # SwiftData 本地缓存
    │   ├── Chats/           # 微信聊天 OCR 集成
    │   │   ├── ChatOCRParser.swift           # OCR 结果解析器（含解析统计）
    │   │   ├── ChatsCacheService.swift       # SwiftData 本地缓存服务
    │   │   ├── ChatExporter.swift            # 聊天记录导出（JSON/Markdown）
    │   │   └── ChatImporter.swift            # 聊天记录导入
    │   └── OCR/                  # OCR 服务（Apple Vision）
    │       ├── VisionOCRService.swift          # Apple Vision OCR（原生，离线）
    │       ├── OCRConfigStore.swift            # OCR 配置存储
    │       └── OCRModels.swift                 # OCR 数据模型和协议
    ├── DataSources-To/           # 同步目标（同步到...）
    │   ├── Notion/               # Notion 集成（重构后）
    │   │   ├── Configuration/    # 配置管理
    │   │   │   ├── NotionConfigStore.swift
    │   │   │   ├── NotionSyncConfig.swift
    │   │   │   ├── NotionConfig.swift
    │   │   │   └── NotionOAuthConfig.swift
    │   │   ├── Core/             # 核心 API 交互
    │   │   │   ├── NotionService.swift         # 主服务（已合并 NotionServiceCore）
    │   │   │   ├── NotionRequestHelper.swift   # HTTP 请求辅助
    │   │   │   ├── NotionHelperMethods.swift   # 辅助方法
    │   │   │   ├── NotionRateLimiter.swift     # 速率限制
    │   │   │   └── NotionOAuthService.swift    # OAuth 服务
    │   │   ├── Operations/       # API 操作模块
    │   │   │   ├── NotionDatabaseOperations.swift
    │   │   │   ├── NotionPageOperations.swift
    │   │   │   ├── NotionHighlightOperations.swift
    │   │   │   └── NotionQueryOperations.swift
    │   │   └── SyncEngine/       # 统一同步引擎（新架构）
    │   │       ├── NotionSyncEngine.swift           # 核心同步引擎
    │   │       ├── NotionSyncSourceProtocol.swift   # 数据源适配器协议
    │   │       ├── SyncTimestampStore.swift         # 同步时间戳存储
    │   │       └── Adapters/                        # 数据源适配器
    │   │           ├── AppleBooksNotionAdapter.swift
    │   │           ├── GoodLinksNotionAdapter.swift
    │   │           ├── WeReadNotionAdapter.swift
    │   │           └── DedaoNotionAdapter.swift
    │   ├── Lark/                 # 飞书（目录预留）
    │   └── Obsidian/             # Obsidian（目录预留）
    └── SyncScheduling/           # 通用同步调度（与同步目标无关）
        ├── AutoSyncService.swift           # 自动同步调度器
        ├── AutoSyncSourceProvider.swift    # 自动同步协议
        ├── AppleBooksAutoSyncProvider.swift # Apple Books 自动同步
        ├── GoodLinksAutoSyncProvider.swift  # GoodLinks 自动同步
        ├── WeReadAutoSyncProvider.swift     # WeRead 自动同步
        ├── DedaoAutoSyncProvider.swift      # Dedao 自动同步
        ├── SyncActivityMonitor.swift       # 同步活动监控
        ├── SyncedHighlightStore.swift      # 已同步高亮记录存储
        └── SyncQueueStore.swift            # 同步队列存储
```

### 同步架构（重构后）

#### 核心设计模式：SyncEngine + Adapter

```
┌─────────────────────────────────────────────────────────────────┐
│                        ViewModel                                 │
│  (AppleBooksViewModel / GoodLinksViewModel / WeReadViewModel)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NotionSyncEngine                              │
│  - sync(source: NotionSyncSourceProtocol)                       │
│  - 统一处理：确保数据库、确保页面、增量/全量同步、更新时间戳       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              NotionSyncSourceProtocol (Adapter)                  │
│  - AppleBooksNotionAdapter                                       │
│  - GoodLinksNotionAdapter                                        │
│  - WeReadNotionAdapter                                           │
│  - 职责：将数据源转换为 UnifiedHighlight                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NotionService                               │
│  - 底层 Notion API 交互                                          │
│  - 数据库/页面/块 CRUD 操作                                       │
└─────────────────────────────────────────────────────────────────┘
```

#### 添加新数据源（如 Dedao、Logseq）

只需要：
1. 在 `DataSources-From/` 创建数据读取服务
2. 在 `SyncEngine/Adapters/` 创建适配器，实现 `NotionSyncSourceProtocol`
3. 在 ViewModel 中使用 `syncEngine.sync(source: adapter, ...)`

**不需要**修改 `NotionSyncEngine` 或 `NotionService`。

### 依赖注入

服务通过 `DIContainer.shared` 管理：

```swift
// 访问服务
DIContainer.shared.notionService
DIContainer.shared.notionSyncEngine      // 统一同步引擎
DIContainer.shared.databaseService
DIContainer.shared.autoSyncService
DIContainer.shared.syncTimestampStore

// WeRead 服务
DIContainer.shared.weReadAuthService
DIContainer.shared.weReadAPIService
DIContainer.shared.weReadCacheService

// Dedao 服务
DIContainer.shared.dedaoAuthService
DIContainer.shared.dedaoAPIService
DIContainer.shared.dedaoCacheService

// Chats 服务
DIContainer.shared.chatsCacheService
DIContainer.shared.chatOCRParser

// OCR 服务
DIContainer.shared.ocrAPIService        // Apple Vision OCR（原生，离线）
DIContainer.shared.ocrConfigStore       // 配置存储
```

### 关键服务层

**1. Apple Books 数据访问** (Services/DataSources-From/AppleBooks/)
- `DatabaseService`: SQLite 连接和查询管理
- `DatabaseReadOnlySession`: 只读数据库会话，支持分页
- `BookFilterService`: 书籍过滤逻辑
- `BookmarkStore`: macOS 书签持久化
- `AppleBooksPicker`: 数据库选择和访问管理

**2. Notion 同步引擎** (Services/DataSources-To/Notion/SyncEngine/)
- `NotionSyncEngine`: 统一同步引擎，处理所有数据源到 Notion 的同步
  - 支持 SingleDB 和 PerBook 两种同步模式
  - 增量同步：基于时间戳检测变化
  - 全量同步：完整重建
- `NotionSyncSourceProtocol`: 数据源适配器协议
- `SyncTimestampStore`: 同步时间戳持久化
- **适配器**：
  - `AppleBooksNotionAdapter`: Apple Books → Notion
  - `GoodLinksNotionAdapter`: GoodLinks → Notion
  - `WeReadNotionAdapter`: WeRead → Notion
  - `DedaoNotionAdapter`: Dedao → Notion

**3. Notion API 集成** (Services/DataSources-To/Notion/Core/)
- `NotionService`: 主要协调器，封装所有 Notion API 操作
- `NotionRequestHelper`: HTTP 请求辅助，支持速率限制和重试
- `NotionRateLimiter`: API 速率限制
- `NotionHelperMethods`: 辅助方法（构建块、格式化等）
- `NotionOAuthService`: OAuth 认证服务

**4. Notion 操作模块** (Services/DataSources-To/Notion/Operations/)
- `NotionDatabaseOperations`: 数据库创建和属性管理
- `NotionPageOperations`: 页面 CRUD 操作
- `NotionHighlightOperations`: 高亮格式化和同步
- `NotionQueryOperations`: 查询现有数据

**5. GoodLinks 集成** (Services/DataSources-From/GoodLinks/)
- `GoodLinksService`: 数据库查询和同步协调器
- `GoodLinksQueryService`: 文章和高亮查询
- `GoodLinksTagParser`: 标签提取和解析

**6. WeRead 集成** (Services/DataSources-From/WeRead/)
- `WeReadAPIService`: 微信读书 API 客户端
  - 自动检测会话过期（errCode -2012 或 HTTP 401）
  - 透明的 Cookie 自动刷新机制
- `WeReadAuthService`: Cookie 认证服务
- `WeReadCookieRefreshService`: Cookie 自动刷新
- `CookieRefreshCoordinator`: 刷新协调器（Actor）
- `WeReadCacheService`: SwiftData 本地缓存服务（`@ModelActor`）
  - 使用 `@ModelActor` 在后台线程执行数据库操作
  - 缓存书籍列表和高亮数据
  - 支持离线访问和快速启动
  - 记录增量同步状态
- `WeReadIncrementalSyncService`: 增量同步服务
  - 基于 syncKey 的增量同步机制
  - 减少 API 调用次数

**7. Dedao 集成** (Services/DataSources-From/Dedao/)
- `DedaoAPIService`: 得到 API 客户端
  - 令牌桶限流器防止触发反爬
  - 自动重试机制
  - 支持二维码扫码登录
- `DedaoAuthService`: Cookie 认证服务
- `DedaoRequestLimiter`: 请求限流器（令牌桶算法）
- `DedaoCacheService`: SwiftData 本地缓存服务（`@ModelActor`）
  - 使用 `@ModelActor` 在后台线程执行数据库操作
  - 缓存书籍列表和高亮数据
  - 支持离线访问

**8. 微信聊天 OCR 集成** (Services/DataSources-From/Chats/)
- `ChatOCRParser`: OCR 结果解析器
  - 使用 k-means 聚类判断消息方向（我/对方）
  - 两阶段系统/时间戳检测（纯几何规则）
  - `ChatParseStatistics` 结构体记录解析统计
  - `parseWithStatistics()` 方法输出详细调试日志
- `ChatsCacheService`: SwiftData 本地缓存服务（`@ModelActor`）
  - 缓存对话和消息数据
  - 支持离线访问和快速启动
  - 本地存储加密（AES-256-GCM）
- `ChatExporter`: 导出对话为 JSON/Markdown 格式
- `ChatImporter`: 从 JSON/Markdown 导入对话

**9. OCR 服务** (Services/DataSources-From/OCR/)
- `VisionOCRService`: Apple Vision OCR（原生，离线）
  - 使用 `VNRecognizeTextRequest` 进行文本识别
  - 支持 30 种语言（来自 `supportedRecognitionLanguages()` 运行时查询）
  - 自动翻转 Y 坐标以匹配图像坐标系（原点左上角）
  - 根据 `OCRConfigStore` 动态配置语言参数
- `OCRConfigStore`: OCR 语言配置存储
  - `OCRLanguage`：30 种官方支持语言的定义（东亚、西欧、东欧、北欧、东南亚、中东）
  - `selectedLanguageCodes`：用户选择的语言代码列表（空数组 = 自动检测）
  - 配置持久化到 `UserDefaults`
- `OCRModels`: 数据模型（`OCRResult`、`OCRBlock`）和协议定义
- `OCRModels`: OCR 请求/响应数据模型

**10. 通用同步调度** (Services/SyncScheduling/)
- `AutoSyncService`: 后台同步调度器（每 5 分钟触发智能增量同步）
- `AutoSyncSourceProvider`: 自动同步协议
- `AppleBooksAutoSyncProvider`: Apple Books 智能增量同步（基于 `maxModifiedDate`）
- `GoodLinksAutoSyncProvider`: GoodLinks 智能增量同步（基于 `modifiedAt`）
- `WeReadAutoSyncProvider`: WeRead 智能增量同步（基于 `updatedAt`）
- `DedaoAutoSyncProvider`: Dedao 智能增量同步（基于本地缓存 `maxHighlightUpdatedAt`）
- `SyncActivityMonitor`: 统一同步活动监控（退出拦截）
- `SyncedHighlightStore`: 已同步高亮记录存储（本地 UUID → blockId 映射）
- `SyncQueueStore`: 同步队列存储（任务排队和状态管理）

**11. 核心服务** (Services/Core/)
- `DIContainer`: 中心服务容器和依赖注入
- `LoggerService`: 统一日志记录
- `ConcurrencyLimiter`: 全局并发控制
- `EncryptionService`: 本地数据加密服务（AES-256-GCM + Keychain）
- `Protocols`: 所有服务协议定义

**12. 认证与购买** (Services/Auth/)
- `AuthService`: Apple Sign In 集成
- `IAPService`: 应用内购买服务
- `KeychainHelper`: 安全凭证存储

### 数据模型

**核心模型**（Models/Core/）：
- `HighlightRow`: 带关联书籍 ID 的高亮（用于内部处理）
- `UnifiedHighlight`: 统一高亮模型（用于 SyncEngine，跨数据源通用）
- `BookListItem`: 书籍元数据
- `HighlightColorScheme`: 高亮颜色方案管理

**账户模型**（Models/Account/）：
- `AccountModels`: 认证令牌、登录方法、账户配置
- `IAPDebugModels`: IAP 购买类型、调试信息、错误类型

**同步模型**（Models/Sync/）：
- `SyncQueueTask`: 同步任务实体
- `SyncedHighlightRecord`: 已同步高亮记录（本地 UUID → blockId 映射）

**WeRead 模型**（Models/WeRead/）：
- `WeReadBookListItem`: UI 列表展示模型
- `WeReadNotebook`: 书籍列表响应模型（API DTO）
- `WeReadBookInfo`: 书籍详细信息模型
- `WeReadBookmark`: 书签/高亮数据模型
- `CachedWeReadBook`: SwiftData 缓存的书籍
- `CachedWeReadHighlight`: SwiftData 缓存的高亮
- `WeReadSyncState`: 同步状态（syncKey、lastSyncAt）

**Dedao 模型**（Models/Dedao/）：
- `DedaoEbook`: 电子书 API DTO（支持 enid 和 id 双重标识）
- `DedaoEbookNote`: 电子书笔记（兼容标准格式和混合格式两种 API 响应）
- `DedaoBookListItem`: UI 列表展示模型
- `DedaoUserInfo`: 用户信息模型
- `DedaoQRCodeResponse`: 二维码登录响应
- `CachedDedaoBook`: SwiftData 缓存的书籍
- `CachedDedaoHighlight`: SwiftData 缓存的高亮
- `DedaoSyncState`: 全局同步状态

**Chats 模型**（Models/Chats/）：
- `ChatContact`: 联系人/对话模型（用于 UI 显示）
- `ChatMessage`: 聊天消息模型（包含消息类型、方向、发送者昵称）
- `ChatScreenshot`: 截图模型（包含原始图片和解析结果）
- `ChatConversation`: 对话模型（联系人 + 截图列表）
- `ChatBookListItem`: UI 列表展示模型（用于 MainListView 兼容）
- `CachedChatConversationV2`: SwiftData 缓存的对话（加密存储）
  - `nameEncrypted: Data`（原 `name: String`）
- `CachedChatMessageV2`: SwiftData 缓存的消息（加密存储）
  - `contentEncrypted: Data`（原 `content: String`）
  - `senderNameEncrypted: Data?`（原 `senderName: String?`）
- `CachedChatScreenshotMeta`: SwiftData 缓存的截图元数据

## 开发模式

### 视图模型使用同步引擎

```swift
// AppleBooksViewModel.swift
class AppleBooksViewModel: ObservableObject {
    private let syncEngine: NotionSyncEngine
    
    func syncBook(_ book: BookListItem) async throws {
        let adapter = AppleBooksNotionAdapter(
            book: book,
            databaseService: databaseService,
            syncMode: .singleDatabase
        )
        try await syncEngine.sync(source: adapter, incremental: true) { progress in
            self.syncProgress = progress
        }
    }
}
```

### 添加新数据源适配器

```swift
// 1. 创建适配器
struct DedaoNotionAdapter: NotionSyncSourceProtocol {
    var sourceName: String { "dedao" }
    var itemId: String { book.id }
    var itemTitle: String { book.title }
    var syncMode: NotionSyncMode { .singleDatabase }
    
    func fetchHighlights() async throws -> [UnifiedHighlight] {
        // 从 Dedao 获取高亮并转换为 UnifiedHighlight
    }
}

// 2. 在 ViewModel 中使用
let adapter = DedaoNotionAdapter(book: book)
try await syncEngine.sync(source: adapter, incremental: true, progress: ...)
```

### 服务协议

所有服务都实现协议以支持测试：

```swift
protocol NotionServiceProtocol {
    func ensureBookPageInDatabase(...) async throws -> (id: String, created: Bool)
    func appendChildren(pageId: String, children: [[String: Any]], batchSize: Int) async throws
    // ...
}
```

### 并发处理
- **Swift**: 使用 `async/await` 进行服务操作
- **SQLite**: 同步调用封装在 `DatabaseReadOnlySession` 中
- **Notion API**: 使用 `NotionRateLimiter` 进行速率限制
- **基于 Actor 的锁**: `NotionSourceEnsureLock` 防止并发数据库创建

## 重要说明

### Apple Books 数据库访问
- 从 `~/Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books/*.sqlite` 读取
- 使用 macOS 安全范围书签进行持久访问
- **只读** 连接以避免损坏源数据库

### 同步策略

**单一数据库**（默认）：
- 一个 Notion 数据库包含所有书籍/文章
- 书籍页面创建为子页面
- 高亮作为项目符号添加

**每本书独立数据库**：
- 每本书/文章创建新的 Notion 数据库
- 每个高亮成为数据库项目
- 更好的组织但需要更多 Notion 数据库

### 速率限制与并发控制
- **Notion API**: 读取 8 RPS，写入 3 RPS（在 `NotionSyncConfig` 中可配置）
- **全局并发控制**: `ConcurrencyLimiter` 控制全局操作并发数
- **重试逻辑**: 自动指数退避（429 和 409 错误）
- **同步队列**: 基于 `SyncQueueStore` 的任务队列管理
- **活动监控**: `SyncActivityMonitor` 统一监控所有同步活动

### DetailView 内存释放与生命周期规范（重要）

> 背景：Detail（右侧详情）往往持有最大的数据（全文/高亮大数组/聊天消息），并且最容易因为“非生命周期绑定的异步任务”导致对象无法及时释放。

- **生命周期绑定加载**：Detail 的数据加载必须绑定 SwiftUI 生命周期，优先使用 `.task(id: selectionId)`；如必须使用 `Task { ... }`，必须由 ViewModel 持有任务句柄并可取消，且需要“过期结果丢弃”防串台。
- **切换/退出时强制释放**：selection 变化或退出 Detail 时必须做到：
  - 取消任务（或让结果可被丢弃）
  - 关闭数据会话（例如 SQLite read-only session）
  - 大数组使用 `removeAll(keepingCapacity: false)`（避免保留 capacity 导致“看似清空但内存不降”）
- **防串台（旧任务回写新状态）**：对分页/长任务使用 token 或 id 校验（例如 `currentLoadId`、`paginationLoadTokens`），确保旧任务完成后不会覆盖新 selection 的状态。
- **重内容按需加载**：对 GoodLinks 全文等“可能极大”的内容，采用“展开才加载 / 折叠或离开即释放”的策略，避免折叠态仍常驻大字符串。
- **Chats 约束**：对话列表只保存 metadata；消息在 Detail 中分页懒加载，并在切换对话/离开 Detail 时卸载已加载消息以释放内存。

- **参考执行清单**：`.cursor/plans/MemoryReleasePlan_A.md`（Detail 内存释放 Plan A，随代码演进持续更新）

## 开发工作流

### 添加新数据源流程
1. 在 `Services/DataSources-From/` 创建数据读取服务
2. 在 `Models/` 添加数据模型（如需要）
3. 在 `SyncEngine/Adapters/` 创建适配器，实现 `NotionSyncSourceProtocol`
4. 在 `ViewModels/` 创建视图模型，使用 `NotionSyncEngine`
5. 在 `Views/` 实现 UI
6. （可选）在 `Services/Sync/` 添加 AutoSyncProvider
7. 添加本地化字符串
8. 更新 CLAUDE.md 文档

### 关键开发注意事项
- **严格遵循 MVVM 架构**：Views 纯 UI，ViewModels 处理业务逻辑，Models 仅数据结构
- **使用依赖注入**：通过 `DIContainer.shared` 访问服务
- **使用 SyncEngine**：新数据源同步应通过适配器模式接入 `NotionSyncEngine`
- **遵循服务协议**：所有服务实现协议以支持测试
- **本地化优先**：新功能开发时同时考虑多语言支持

## 常用开发命令

### 构建和运行

```bash
# 使用 Xcode 打开项目
open SyncNos.xcodeproj

# 使用命令行构建（Debug）
xcodebuild -scheme SyncNos -configuration Debug build

# 使用命令行构建（Release）
xcodebuild -scheme SyncNos -configuration Release build

# 清理构建目录
xcodebuild -scheme SyncNos clean
```

### 代码检查

```bash
# Swift 格式检查（需要 swiftformat）
swiftformat --dryrun SyncNos/

# 依赖更新
swift package resolve
swift package update
```
