# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**SyncNos** 是一个 SwiftUI macOS 应用程序，用于将 Apple Books、GoodLinks 和 WeRead 中的读书高亮和笔记同步到 Notion 数据库。已发布至 [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888)。

### 核心功能
- ✅ **完整数据提取**：从 SQLite 数据库中提取 Apple Books 高亮/笔记（支持时间戳、颜色标签）
- ✅ **智能分页**：大量数据的分页处理，确保性能优化，支持增量加载
- ✅ **GoodLinks 同步**：文章内容、标签和高亮笔记的完整同步
- ✅ **WeRead 集成**：微信读书完整支持，包括 Cookie 自动刷新和透明认证
- ✅ **Notion 数据库同步**，支持两种策略：
  - **单一数据库模式**：所有内容在一个 Notion 数据库中
  - **每本书独立模式**：每本书/文章有独立的数据库
- ✅ **同步队列管理**：实时同步进度显示，任务排队和状态跟踪
- ✅ **高亮颜色管理**：支持 Apple Books、GoodLinks 和 WeRead 的颜色标签同步
- ✅ **自动后台同步**：可配置时间间隔，支持按来源独立启用/禁用
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

## 架构

### SwiftUI 应用结构

应用遵循 **MVVM 架构**，具有严格关注点分离：

```
SyncNos/
├── SyncNosApp.swift              # 应用入口
├── AppDelegate.swift            # 应用生命周期管理（移至根目录）
├── Views/                        # SwiftUI 视图（UI 层）
│   ├── Components/               # 可复用 UI 组件
│   │   ├── AppTheme.swift        # 应用主题和样式
│   │   ├── ArticleContentCardView.swift
│   │   ├── FiltetSortBar.swift   # 统一筛选排序栏（布局优化）
│   │   ├── HighlightCardView.swift
│   │   ├── InfoHeaderCardView.swift # 信息头部卡片（显示选中数量）
│   │   ├── LiveResizeObserver.swift # 实时大小观察器
│   │   ├── MainListView.swift    # 主列表视图（支持排序筛选）
│   │   ├── MenuBarView.swift     # 菜单栏视图（新增）
│   │   ├── SyncQueueView.swift   # 同步队列管理视图
│   │   └── WaterfallLayout.swift # 瀑布流布局
│   ├── AppleBooks/
│   │   ├── AppleBooksListView.swift
│   │   └── AppleBooksDetailView.swift
│   ├── GoodLinks/
│   │   ├── GoodLinksListView.swift
│   │   └── GoodLinksDetailView.swift
│   ├── WeRead/                   # 微信读书视图
│   │   ├── WeReadListView.swift       # 支持排序筛选和通知刷新
│   │   ├── WeReadDetailView.swift     # 支持多个评论和高亮显示
│   └── Settting/                 # 设置视图（重构）
│       ├── General/
│       │   ├── AboutView.swift           # 关于页面
│       │   ├── AppleAccountView.swift    # Apple 账户
│       │   ├── IAPViews/               # 应用内购买视图目录
│       │   │   ├── PayWallView.swift      # 统一付费墙界面
│       │   │   └── IAPView.swift         # 传统IAP界面
│       │   ├── LanguageView.swift        # 语言设置（新增）
│       │   ├── LogWindow.swift           # 日志窗口
│       │   ├── SettingsView.swift        # 主设置页面
│       │   ├── UserGuideView.swift       # 用户指南
│       │   └── VisualEffectBackground.swift # 视觉效果背景
│       ├── Sync/
│       │   ├── AppleBooksSettingsView.swift     # Apple Books 设置
│       │   ├── GoodLinksSettingsView.swift      # GoodLinks 设置
│       │   └── NotionIntegrationView.swift      # Notion 集成设置
│       └── Commands/                  # 菜单命令（模块化）
│           ├── AppCommands.swift      # 应用命令
│           ├── EditCommands.swift     # 编辑命令
│           ├── FileCommands.swift     # 文件命令
│           ├── HelpCommands.swift     # 帮助命令
│           ├── SelectionCommands.swift # 选择命令
│           └── ViewCommands.swift     # 视图命令
├── ViewModels/                   # ObservableObject 视图模型
│   ├── AppleBooks/
│   │   ├── AppleBooksViewModel.swift         # 列表管理，支持分页和增量加载
│   │   ├── AppleBooksDetailViewModel.swift   # 详情页分页
│   │   └── AppleBooksSettingsViewModel.swift # 设置管理
│   ├── GoodLinks/
│   │   ├── GoodLinksViewModel.swift          # 统一视图模型，支持分页和增量加载
│   │   └── GoodLinksSettingsViewModel.swift  # 设置管理
│   ├── WeRead/                              # 微信读书视图模型
│   │   ├── WeReadViewModel.swift             # 主列表视图模型
│   │   ├── WeReadDetailViewModel.swift       # 详情页视图模型
│   │   ├── WeReadLoginViewModel.swift        # 登录认证视图模型
│   │   └── WeReadSettingsViewModel.swift     # 设置管理视图模型
│   ├── Account/
│   │   ├── AccountViewModel.swift            # 账户管理
│   │   ├── AppleSignInViewModel.swift        # Apple 登录
│   │   └── IAPViewModel.swift                # 应用内购买
│   ├── MenuBar/
│   │   └── MenuBarViewModel.swift            # 菜单栏视图模型（新增）
│   ├── Notion/
│   │   └── NotionIntegrationViewModel.swift  # Notion 配置，支持 OAuth 授权
│   ├── Settings/
│   │   └── LoginItemViewModel.swift           # 登录项视图模型（新增）
│   ├── Sync/
│   │   └── SyncQueueViewModel.swift          # 同步队列管理，显示任务总数
│   └── LogViewModel.swift
├── Models/                       # 数据模型
│   ├── Models.swift              # BookRow, Highlight 等核心模型
│   ├── AccountModels.swift       # 账户相关模型
│   ├── HighlightColorScheme.swift # 高亮颜色管理
│   ├── SyncQueueModels.swift     # 同步队列模型
│   └── WeReadModels.swift        # 微信读书数据模型
└── Services/                     # 业务逻辑和数据访问（重构）
    ├── Auth/                     # 认证服务
    │   ├── AuthService.swift     # Apple Sign In 认证
    │   └── IAPService.swift      # 应用内购买（支持试用期管理）
    ├── Core/                     # 核心服务
    │   ├── ConcurrencyLimiter.swift      # 并发控制
    │    ├── DIContainer.swift            # 中心服务容器
    │   ├── LoggerService.swift           # 统一日志记录（支持颜色编码）
    │   ├── KeychainHelper.swift         # 安全凭证存储（从Auth移入）
    │   └── Protocols.swift               # 服务协议定义
    ├── DataSources-From/         # 数据源（从...获取）
    │   ├── AppleBooks/           # Apple Books SQLite 访问
    │   │   ├── AppleBooksPicker.swift         # 数据库选择器
    │   │   ├── BookFilterService.swift        # 书籍过滤
    │   │   ├── BookmarkStore.swift            # 书签持久化
    │   │   ├── DatabaseConnectionService.swift # 数据库连接
    │   │   ├── DatabaseQueryService.swift     # 查询服务
    │   │   ├── DatabaseReadOnlySession.swift  # 只读会话
    │   │   └── DatabaseService.swift          # 数据库服务
    │   ├── GoodLinks/            # GoodLinks 数据库访问
    │   │   ├── GoodLinksConnectionService.swift # 连接服务
    │   │   ├── GoodLinksModels.swift           # 数据模型
    │   │   ├── GoodLinksProtocols.swift        # 协议定义
    │   │   ├── GoodLinksQueryService.swift     # 查询服务
    │   │   ├── GoodLinksService.swift          # 核心服务
    │   │   └── GoodLinksTagParser.swift        # 标签解析
    │   └── WeRead/               # 微信读书集成
    │       ├── WeReadAPIService.swift           # API 客户端，基于 Cookie 认证，支持自动刷新
    │       ├── WeReadAuthService.swift          # Cookie 认证服务
    │       ├── WeReadCookieRefreshService.swift # Cookie 自动刷新服务
    │       ├── CookieRefreshCoordinator.swift   # 刷新协调器（Actor）
    │       └── WeReadSyncService.swift          # 同步服务协调器
    ├── DataSources-To/           # 同步目标（同步到...）
    │   ├── Lark/                 # 飞书（目录预留）
    │   ├── Notion/               # Notion 集成
    │   │   ├── Configuration/    # 配置管理
    │   │   │   ├── NotionConfigStore.swift     # 配置存储
    │   │   │   └── NotionSyncConfig.swift      # 同步配置
    │   │   ├── Core/             # 核心服务
    │   │   │   ├── NotionConfig.swift.example # 配置文件示例（新增）
    │   │   │   ├── NotionHelperMethods.swift   # 辅助方法
    │   │   │   ├── NotionOAuthConfig.swift     # OAuth 配置（新增）
    │   │   │   ├── NotionOAuthService.swift    # OAuth 服务（新增）
    │   │   │   ├── NotionRateLimiter.swift     # 速率限制
    │   │   │   ├── NotionRequestHelper.swift   # 请求辅助，支持搜索端点
    │   │   │   ├── NotionService.swift         # 主服务，分页逻辑优化
    │   │   │   └── NotionServiceCore.swift     # 核心实现
    │   │   ├── FromAppleBooks/   # Apple Books 同步策略
    │   │   │   ├── AppleBooksSyncService.swift      # 同步服务
    │   │   │   ├── AppleBooksSyncServiceProtocol.swift # 服务协议
    │   │   │   ├── AppleBooksSyncStrategyPerBook.swift # 每书独立数据库
    │   │   │   ├── AppleBooksSyncStrategyProtocol.swift # 策略协议
    │   │   │   ├── AppleBooksSyncStrategySingleDB.swift # 单一数据库
    │   │   │   └── SyncTimestampStore.swift          # 同步时间戳存储
    │   │   ├── FromGoodLinks/    # GoodLinks 同步策略
    │   │   │   └── GoodLinksSyncService.swift        # 同步服务
    │   │   └── Operations/       # CRUD 操作
    │   │       ├── NotionDatabaseOperations.swift    # 数据库操作
    │   │       ├── NotionHighlightOperations.swift   # 高亮操作
    │   │       ├── NotionPageOperations.swift        # 页面操作
    │   │       └── NotionQueryOperations.swift       # 查询操作
    │   └── Obsidian/             # Obsidian（目录预留）
    ├── Infrastructure/           # 基础服务（遗留）
    └── Sync/                     # 同步相关服务
        ├── AutoSyncService.swift       # 自动同步（按来源独立控制）
        ├── SyncActivityMonitor.swift   # 活动监控（退出拦截）
        └── SyncQueueStore.swift        # 队列存储
```

### 依赖注入

服务通过 `DIContainer.shared` 管理（Services/Core/DIContainer.swift:5）：

```swift
// 访问服务
DIContainer.shared.notionService
DIContainer.shared.databaseService
DIContainer.shared.appleBooksSyncService
DIContainer.shared.autoSyncService
```

### 关键服务层

**1. Apple Books 数据访问** (Services/DataSources-From/AppleBooks/)
- `DatabaseService`: SQLite 连接和查询管理
- `DatabaseReadOnlySession`: 只读数据库会话，支持分页
- `BookFilterService`: 书籍过滤逻辑
- `BookmarkStore`: macOS 书签持久化
- `AppleBooksPicker`: 数据库选择和访问管理
- `DatabaseConnectionService`: 数据库连接管理
- `DatabaseQueryService`: 查询服务封装

**2. Notion API 集成** (Services/DataSources-To/Notion/)
- `NotionService`: 主要协调器（Services/DataSources-To/Notion/Core/NotionService.swift:1），分页逻辑优化
- `NotionServiceCore`: 配置和 HTTP 客户端
- 配置管理：
  - `NotionConfigStore`: Notion 配置存储
  - `NotionSyncConfig`: 同步配置管理
  - `NotionOAuthConfig`: OAuth 配置管理（新增）
- 核心服务：
  - `NotionRequestHelper`: HTTP 请求辅助，支持搜索端点
  - `NotionRateLimiter`: API 速率限制
  - `NotionHelperMethods`: 辅助方法和工具
  - `NotionOAuthService`: OAuth 认证服务（新增）
- 操作模块：
  - `NotionDatabaseOperations`: 数据库创建和属性管理
  - `NotionPageOperations`: 页面 CRUD 操作
  - `NotionHighlightOperations`: 高亮格式化和同步
  - `NotionQueryOperations`: 查询现有数据
- 同步策略：
  - `AppleBooksSyncStrategySingleDB`: 单一数据库模式
  - `AppleBooksSyncStrategyPerBook`: 每本书独立数据库模式
  - `GoodLinksSyncService`: GoodLinks 同步服务

**3. GoodLinks 集成** (Services/DataSources-From/GoodLinks/)
- `GoodLinksService`: 数据库查询和同步协调器
- `GoodLinksQueryService`: 文章和高亮查询
- `GoodLinksTagParser`: 标签提取和解析
- `GoodLinksConnectionService`: 数据库连接管理
- `GoodLinksModels`: 数据模型定义
- `GoodLinksProtocols`: 服务协议

**4. WeRead 集成** (Services/DataSources-From/WeRead/)
- `WeReadAPIService`: 微信读书 API 客户端，基于 Cookie 认证与 URLSession
  - 自动检测会话过期（errCode -2012 或 HTTP 401）
  - 透明的 Cookie 自动刷新机制
  - 刷新成功后自动重试原始请求
- `WeReadAuthService`: Cookie 认证服务，管理 Cookie 在 Keychain 中的存储
- `WeReadCookieRefreshService`: Cookie 自动刷新服务
  - 使用隐藏 WebView 静默刷新 Cookie
  - 15 秒超时保护
  - Cookie 验证（检查 wr_vid 和 wr_skey）
- `CookieRefreshCoordinator`: 刷新协调器（Actor）
  - 确保并发请求只触发一次刷新
  - 多个等待请求共享刷新结果
  - 线程安全的并发控制
- `WeReadSyncService`: 同步服务协调器，处理与 Notion 的同步逻辑
- 支持功能：
  - 基于Cookie的Web API认证（自动检测会话过期errCode -2012或HTTP 401）
  - 透明的 Cookie 自动刷新机制（刷新成功后自动重试原始请求）
  - 书籍信息、高亮、笔记的完整提取
  - 自动 Cookie 刷新，减少手动登录频率（15秒超时保护）
  - Actor-based 并发控制（CookieRefreshCoordinator确保线程安全）
  - 简化数据流：移除SwiftData，采用 API → DTO → UI 模型直接流程
  - 与 Notion 数据库的无缝集成

**6. 核心服务** (Services/Core/)
- `DIContainer`: 中心服务容器和依赖注入
- `LoggerService`: 统一日志记录，支持多级别日志
- `ConcurrencyLimiter`: 全局并发控制和速率限制
- `LoginItemService`: 登录项管理服务（新增）
- `Protocols`: 所有服务协议定义

**7. 认证与购买** (Services/Auth/)
- `AuthService`: Apple Sign In 集成
- `IAPService`: 应用内购买服务
- `KeychainHelper`: 安全凭证存储

**8. 同步管理** (Services/Sync/)
- `AutoSyncService`: 后台同步调度（支持按来源独立同步）
- `SyncActivityMonitor`: 统一同步活动监控（退出拦截）
- `SyncQueueStore`: 同步队列存储（任务排队和状态管理）

**9. 扩展数据源（尚未实现）**
- **Get**
- **Dedao**
- **Logseq**
- **Lark**
- **Obsidian**
- etc...

### 主应用入口

**SyncNosApp.swift:1** 使用 `@main` 和 `@NSApplicationDelegateAdaptor(AppDelegate.self)` 模式：
1. Apple Books 数据库访问的书签恢复（BookmarkStore）
2. IAP 交易监控（IAPService）
3. 自动同步服务启动（如果启用，按来源独立控制）
4. 同步活动监控初始化（Infrastructure/SyncActivityMonitor，用于退出拦截）
5. 同步队列存储初始化（SyncQueueStore，用于状态管理）

**Infrastructure/AppDelegate.swift:1** 应用生命周期管理：
- 使用 `@NSApplicationDelegateAdaptor` 适配器模式
- 同步活动监控：在应用退出时检查是否有同步任务进行
- 退出确认对话框：防止同步中断

应用窗口：
- **MainListView**: 书籍/文章选择和同步（支持排序筛选）
- **WeReadListView**: 微信读书书籍列表和管理
- **WeReadDetailView**: 微信读书详情和高亮管理
- **SettingsView**: Notion 配置、同步选项、语言设置
- **UserGuideView**: 帮助文档
- **LogWindow**: 同步操作日志
- **CommandMenu**: 模块化菜单命令系统（新增）

## 开发模式

### 视图模型 (ObservableObject + Combine)

视图模型使用响应式模式，配备 `@Published` 属性和 Combine 操作符：

**ViewModels/AppleBooks/AppleBooksViewModel.swift:5**
```swift
class AppleBookViewModel: ObservableObject {
    @Published var books: [BookListItem] = []
    @Published var isLoading = false

    private var cancellables = Set<AnyCancellable>()

    init() {
        // 使用 Combine 进行响应式数据处理
        $books
            .map { /* 过滤/转换 */ }
            .assign(to: &$filteredBooks)
    }
}
```

### 服务协议

所有服务都实现协议以支持测试：

**Services/Core/Protocols.swift:1**
```swift
protocol DatabaseServiceProtocol {
    func canOpenReadOnly(dbPath: String) -> Bool
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow]
    // ... 其他方法
}
```

### 并发处理
- **Swift**: 使用 `async/await` 进行服务操作
- **SQLite**: 同步调用封装在 `DatabaseReadOnlySession` 中
- **Notion API**: 使用 `ConcurrencyLimiter` 进行速率限制
- **基于 Actor 的锁**: `NotionSourceEnsureLock` 防止并发数据库创建

### 数据模型

**核心模型**（Models/Models.swift:1）：
- `Highlight`: 带 UUID、文本、笔记和时间戳的单个高亮
- `BookListItem`: 不包含完整高亮加载的书籍元数据
- `BookRow`: 简单书籍信息
- `HighlightRow`: 带关联书籍 ID 的高亮
- `AssetHighlightStats`: 每个资源的聚合统计

**同步队列模型**（Models/SyncQueueModels.swift:1）：
- `SyncSource`: 同步来源（appleBooks, goodLinks）
- `SyncTaskState`: 同步任务状态（queued, running, succeeded, failed）
- `SyncQueueTask`: 同步任务实体，包含 ID、状态、进度等信息

**高亮颜色模型**（Models/HighlightColorScheme.swift:1）：
- `HighlightColorDefinition`: 高亮颜色定义（索引、Notion 名称、显示名称）
- `HighlightColorScheme`: 高亮颜色方案管理
  - Apple Books: 6 种颜色（orange, green, blue, yellow, pink, purple）
  - GoodLinks: 6 种颜色（yellow, green, blue, red, purple, mint）

**账户模型**（Models/AccountModels.swift:1）：
- Apple Sign In 认证相关模型
- IAP 交易模型

**WeRead 模型**（Models/WeReadModels.swift:1）：
- `WeReadBookListItem`: UI 列表展示模型
- `WeReadNotebook`: 书籍列表响应模型（API DTO）
- `WeReadBookInfo`: 书籍详细信息模型（API DTO）
- `WeReadBookmark`: 书签/高亮数据模型（API DTO）
- `WeReadReview`: 笔记/评论模型（API DTO）
- `WeReadHighlightResponse`: 高亮响应模型（API DTO）
- 数据流：API → DTO → UI 模型，无本地持久化

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
- **Notion API**: 3 请求/秒（在 `NotionSyncConfig` 中可配置）
- **全局并发控制**: `ConcurrencyLimiter` 控制全局操作并发数
- **批处理操作**: 可配置的并发限制
- **重试逻辑**: 自动指数退避
- **同步队列**: 基于 `SyncQueueStore` 的任务队列管理
- **活动监控**: `SyncActivityMonitor` 统一监控所有同步活动

## Cursor 规则

### .cursor/rules/SwiftUI响应式布局+MVVM架构+Combine响应式编程.mdc

**架构指南**：包含严格的 MVVM + SwiftUI + Combine 架构规范

**应该做的：**
- 使用 MVVM 搭配 ObservableObject + @Published 或 @Observable
- 保持视图纯函数性（无业务逻辑）
- 使用 Combine 进行响应式数据流
- 遵循文件结构：Views/、ViewModels/、Models/、Services/
- 通过 DIContainer 使用依赖注入
- 使用 `@StateObject` 管理长期存在的视图模型
- 为 ObservableObject 实现 `@Published` 属性

**不应该做的：**
- 为视图模型使用单例模式
- 混用 ObservableObject 与 @Observable
- 在视图中放置业务逻辑
- 在视图间共享视图模型实例
- 使用手动状态管理
- 在视图 body 中执行重型计算
- 使用 `static let shared` 实例

**ViewModel 实例化：**
- 按视图创建：`@StateObject private var viewModel = ViewModel()`
- 依赖注入：`.environmentObject(viewModel)`
- 避免在视图间共享 ViewModel 实例

### .cursor/rules/syncnos-localization.mdc

**本地化指南**：提供 i18n 本地化工作的详细指导

**核心内容**：
- ✅ **多语言支持**：
```markdown
- English (en) - 主要开发语言
- Chinese, Simplified (zh-Hans) - 简体中文
- Danish (da) - 丹麦语
- Dutch (nl) - 荷兰语
- Finnish (fi) - 芬兰语
- French (fr) - 法语
- German (de) - 德语
- Indonesian (id) - 印尼语
- Japanese (ja) - 日语
- Korean (ko) - 韩语
- Portuguese (Brazil) (pt-BR) - 巴西葡萄牙语
- Russian (ru) - 俄语
- Spanish (Spain) (es-ES) - 西班牙语
- Swedish (sv) - 瑞典语
- Thai (th) - 泰语
- Vietnamese (vi) - 越南语
```
- **字符串目录管理**：
  - 主目录：`Localizable.xcstrings`（已包含16种语言完整翻译）
- **新增功能**：
  - **语言设置页面**：`Views/Settting/General/LanguageView.swift` - 用户可直接在应用内切换语言
  - **动态语言切换**：无需重启应用，实时更新界面语言
- **使用规范**：
  - SwiftUI：`Text("Articles")`
  - 传统 API：`NSLocalizedString("Articles", comment: "")`

**导出/导入**：Product → Export/Import Localizations

## 配置文件

### Xcode 项目
- **SyncNos.xcodeproj/project.pbxproj**: Xcode 项目设置
- **SyncNos/SyncNos.entitlements**: 应用沙盒和功能权限（Apple Sign In）
- **Infrastructure/AppDelegate.swift**: 应用生命周期管理

### 资源文件
- **Resource/Localizable.xcstrings**: 主翻译文件（16种语言完整支持）
- **Resource/SyncNos.storekit**: 应用内购买配置
- **Resource/ChangeLog.md**: 版本更新日志（中英双语）
- **Resource/ChangeLog.cn.md**: 中文更新日志
- **Resource/PRIVACY_POLICY.md**: 隐私政策

### 后端服务
- **Backend/requirements.txt**: Python 依赖（FastAPI Apple Sign In 后端）
- **Backend/.env**: Apple 凭证（不在 git 中，已加入.ignore）

### 构建配置
- **buildServer.json**: 构建服务器配置
- **README.md**: 中文项目说明
- **README_EN.md**: 英文项目说明

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

# 构建并运行（需要在 Xcode 中设置默认方案）
xcodebuild -scheme SyncNos -configuration Debug run

# 归档导出（Distribution）
xcodebuild -scheme SyncNos -configuration Release archive \
  -archivePath ./build/SyncNos.xcarchive

# 导出 IPA/App（需要配置 ExportOptions.plist）
xcodebuild -exportArchive \
  -archivePath ./build/SyncNos.xcarchive \
  -exportPath ./build \
  -exportOptionsPlist ExportOptions.plist
```

### 代码检查

```bash
# Swift 编译检查
swiftc -typecheck SyncNos/SyncNosApp.swift

# Swift 格式检查（需要 swiftformat）
swiftformat --dryrun SyncNos/

# 依赖更新
swift package resolve
swift package update
```

### 后端服务（FastAPI Apple Sign In）

```bash
cd Backend

# 安装依赖
pip install -r requirements.txt

# 运行开发服务器
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 运行测试
pytest
```

## 开发工作流

### 1. 环境准备
- **macOS 14.0+**
- **Xcode 15.0+**
- **Swift 5.0+**
- **Python 3.9+** (用于后端 FastAPI 服务)

### 2. 日常开发
```bash
# 1. 拉取最新代码
git pull origin main

# 2. 打开 Xcode 项目
open SyncNos.xcodeproj

# 3. 在 Xcode 中选择目标设备并运行 (Cmd+R)

# 4. 完成之后记得扫尾：验证代码无问题，能够成功build。

### 3. 添加新功能流程
1. 在 `Models/` 中定义数据模型
2. 在 `Services/` 中实现业务逻辑
3. 在 `ViewModels/` 中创建视图模型
4. 在 `Views/` 中实现 UI
5. 添加本地化字符串
6. 测试功能
7. 更新文档

### 4. 关键开发注意事项
- **严格遵循 MVVM 架构**：Views 纯 UI，ViewModels 处理业务逻辑，Models 仅数据结构
- **使用依赖注入**：通过 `DIContainer.shared` 访问服务
- **遵循服务协议**：所有服务实现协议以支持测试
- **避免业务逻辑在视图中**：保持 SwiftUI 视图的纯函数性
- **本地化优先**：新功能开发时同时考虑多语言支持

## 最新重要更新（基于最近提交记录）

### WeRead 集成重大改进
- **Cookie 自动刷新机制**：`0318632` - 实现了 `CookieRefreshCoordinator` (Actor) 和 `WeReadCookieRefreshService`
- **透明认证流程**：`f67eb78` - 简化登录UI，移除手动cookie输入
- **WebKit Cookie 清除**：`91284ad` - 在认证服务中集成 Cookie 清除功能
- **数据流简化**：`9d37af0` - 移除 SwiftData 持久化，采用 API → DTO → UI 模型的直接流程

### IAP 系统重构
- **30天试用期**：`067ee6c` - 实现试用期管理和到期检查
- **统一付费墙**：`aa53827` - 整合为 `PayWallView`，替代分散的IAP界面
- **调试工具整合**：`d9e000b` - 将调试功能集中到主 `IAPViewModel`
- **购买类型跟踪**：`fba3d0b` - 支持不同购买类型的识别和管理

### 架构优化
- **KeychainHelper 重定位**：`a0503cf` - 从 Auth 移至 Core 服务，提高复用性
- **AppDelegate 重定位**：`f8e00fc` - 移至根目录，简化项目结构
- **部署目标升级**：`7a3c58b` - 从 macOS 13.0 升级到 14.0，支持最新特性

### UI/UX 改进
- **日志颜色编码**：`37fa63b` - 为不同日志级别添加颜色区分
- **动态语言切换**：`363f276` - 实现无需重启的实时语言切换
- **时间戳显示优化**：`3511c5a` - 统一跨视图的最后同步时间显示

### WeRead API 增强
- **自动会话过期检测**：识别 errCode -2012 和 HTTP 401
- **透明重试机制**：刷新成功后自动重试原始请求
- **并发刷新控制**：确保多个并发请求只触发一次刷新
- **15秒超时保护**：Cookie 刷新操作的安全超时机制
