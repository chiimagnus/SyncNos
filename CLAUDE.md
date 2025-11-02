# CLAUDE.md

本文档为 Claude Code (claude.ai/code) 在此代码库中工作提供指导。

## 项目概述

**SyncNos** 是一个 SwiftUI macOS 应用程序，用于将 Apple Books 和 GoodLinks 中的读书高亮和笔记同步到 Notion 数据库。当前版本：**v0.5.10**，已发布至 [Mac App Store](https://apps.apple.com/app/syncnos/id6752426176)。

### 核心功能
- ✅ **完整数据提取**：从 SQLite 数据库中提取 Apple Books 高亮/笔记（支持时间戳、颜色标签）
- ✅ **智能分页**：大量数据的分页处理，确保性能优化
- ✅ **GoodLinks 同步**：文章内容、标签和高亮笔记的完整同步
- ✅ **Notion 数据库同步**，支持两种策略：
  - **单一数据库模式**：所有内容在一个 Notion 数据库中
  - **每本书独立模式**：每本书/文章有独立的数据库
- ✅ **同步队列管理**：实时同步进度显示，任务排队和状态跟踪
- ✅ **高亮颜色管理**：支持 Apple Books 和 GoodLinks 的颜色标签同步
- ✅ **自动后台同步**：可配置时间间隔，支持按来源独立启用/禁用
- ✅ **Apple Sign In 认证**：通过 FastAPI 后端安全认证
- ✅ **国际化支持**：9 种语言（中、英、法、德、日、韩、巴西葡、俄、西）

## 架构

### SwiftUI 应用结构

应用遵循 **MVVM 架构**，具有严格关注点分离：

```
SyncNos/
├── SyncNosApp.swift              # 应用入口
├── Views/                        # SwiftUI 视图（UI 层）
│   ├── Components/               # 可复用 UI 组件
│   │   ├── AppTheme.swift        # 应用主题和样式
│   │   ├── EmptyStateView.swift  # 空状态占位视图
│   │   ├── FiltetSortBar.swift   # 统一筛选排序栏
│   │   ├── HighlightCardView.swift
│   │   ├── InfoHeaderCardView.swift # 信息头部卡片（显示选中数量）
│   │   ├── LiveResizeObserver.swift # 实时大小观察器
│   │   ├── ArticleContentCardView.swift
│   │   ├── SyncQueueView.swift   # 同步队列管理视图
│   │   ├── WaterfallLayout.swift # 瀑布流布局
│   │   └── MainListView.swift    # 主列表视图（支持排序筛选）
│   ├── AppleBooks/
│   │   ├── AppleBooksListView.swift
│   │   └── AppleBooksDetailView.swift
│   ├── GoodLinks/
│   │   ├── GoodLinksListView.swift
│   │   └── GoodLinksDetailView.swift
│   └── Settting/
│       ├── General/
│       └── Sync/
├── ViewModels/                   # ObservableObject 视图模型
│   ├── AppleBooks/
│   │   ├── AppleBooksViewModel.swift        # 列表管理
│   │   ├── AppleBooksDetailViewModel.swift  # 详情页分页
│   │   └── AppleBooksSettingsViewModel.swift
│   ├── GoodLinks/
│   │   ├── GoodLinksViewModel.swift         # 统一视图模型
│   │   └── GoodLinksSettingsViewModel.swift
│   ├── Account/
│   │   ├── AccountViewModel.swift           # 账户管理
│   │   ├── AppleSignInViewModel.swift       # Apple 登录
│   │   └── IAPViewModel.swift               # 应用内购买
│   ├── Notion/
│   │   └── NotionIntegrationViewModel.swift # Notion 配置
│   ├── Sync/
│   │   └── SyncQueueViewModel.swift         # 同步队列管理
│   └── LogViewModel.swift
├── Models/                       # 数据模型
│   ├── Models.swift              # BookRow, Highlight 等核心模型
│   ├── AccountModels.swift       # 账户相关模型
│   ├── HighlightColorScheme.swift # 高亮颜色管理
│   └── SyncQueueModels.swift     # 同步队列模型
└── Services/                     # 业务逻辑和数据访问
    ├── 0-NotionAPI/              # Notion 集成
    │   ├── Core/                 # NotionService, HTTP 客户端
    │   ├── Operations/           # CRUD 操作
    │   └── 1-AppleBooksSyncToNotion/  # 同步策略
    ├── 1-AppleBooks/             # Apple Books SQLite 访问
    │   ├── DatabaseService.swift
    │   ├── DatabaseReadOnlySession.swift
    │   └── BookmarkStore.swift
    ├── 2-GoodLinks/              # GoodLinks 数据库访问
    │   ├── GoodLinksService.swift
    │   └── GoodLinksQueryService.swift
    ├── Infrastructure/           # 依赖注入、日志、认证等
    │   ├── DIContainer.swift     # 中心服务容器
    │   ├── LoggerService.swift
    │   ├── AutoSyncService.swift # 支持按来源的独立同步
    │   ├── SyncActivityMonitor.swift    # 同步活动监控
    │   ├── SyncQueueStore.swift         # 同步队列存储
    │   ├── AuthService.swift     # Apple Sign In 认证
    │   ├── KeychainHelper.swift  # 安全凭证存储
    │   └── Protocols.swift       # 服务协议定义
    └── IAP/                      # 应用内购买
```

### 依赖注入

服务通过 `DIContainer.shared` 管理（Services/Infrastructure/DIContainer.swift:4）：

```swift
// 访问服务
DIContainer.shared.notionService
DIContainer.shared.databaseService
DIContainer.shared.appleBooksSyncService
DIContainer.shared.autoSyncService
```

### 关键服务层

**1. Apple Books 数据访问** (Services/1-AppleBooks/)
- `DatabaseService`: SQLite 连接和查询管理
- `DatabaseReadOnlySession`: 只读数据库会话，支持分页
- `BookFilterService`: 书籍过滤逻辑
- `BookmarkStore`: macOS 书签持久化

**2. Notion API 集成** (Services/0-NotionAPI/)
- `NotionService`: 主要协调器（Services/0-NotionAPI/Core/NotionService.swift:23）
- `NotionServiceCore`: 配置和 HTTP 客户端
- 操作模块：
  - `NotionDatabaseOperations`: 数据库创建和属性管理
  - `NotionPageOperations`: 页面 CRUD 操作
  - `NotionHighlightOperations`: 高亮格式化和同步
  - `NotionQueryOperations`: 查询现有数据
- 同步策略：
  - `AppleBooksSyncStrategySingleDB`: 单一数据库模式
  - `AppleBooksSyncStrategyPerBook`: 每本书独立数据库模式

**3. GoodLinks 集成** (Services/2-GoodLinks/)
- `GoodLinksService`: 数据库查询和同步协调器
- `GoodLinksQueryService`: 文章和高亮查询
- `GoodLinksTagParser`: 标签提取和解析

**4. 基础设施** (Services/Infrastructure/)
- `AutoSyncService`: 后台同步调度（支持按来源独立同步）
- `SyncActivityMonitor`: 统一同步活动监控（退出拦截）
- `SyncQueueStore`: 同步队列存储（任务排队和状态管理）
- `LoggerService`: 统一日志记录
- `AuthService`: Apple Sign In 集成
- `ConcurrencyLimiter`: API 调用速率限制
- `KeychainHelper`: 安全凭证存储
- `DIContainer`: 中心服务容器和依赖注入
- `Protocols`: 所有服务协议定义

### 主应用入口

**SyncNosApp.swift:1** 使用 `@main` 和 `@NSApplicationDelegateAdaptor(AppDelegate.self)` 模式：
1. Apple Books 数据库访问的书签恢复
2. IAP 交易监控
3. 自动同步服务启动（如果启用，按来源独立控制）
4. 同步活动监控初始化（用于退出拦截）
5. 同步队列存储初始化（用于状态管理）

**AppDelegate.swift:4** 应用生命周期管理：
- 使用 `@NSApplicationDelegateAdaptor` 适配器模式
- 同步活动监控：在应用退出时检查是否有同步任务进行
- 退出确认对话框：防止同步中断

应用窗口：
- MainListView: 书籍/文章选择和同步（支持排序筛选）
- Settings: Notion 配置、同步选项
- UserGuide: 帮助文档
- Logs: 同步操作日志

## 开发模式

### 视图模型 (ObservableObject + Combine)

视图模型使用响应式模式，配备 `@Published` 属性和 Combine 操作符：

**ViewModels/AppleBooks/AppleBookViewModel.swift:5**
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

**Services/Infrastructure/Protocols.swift:1**
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

### 国际化 (i18n)
- ✅ **多语言支持**: 9 种语言（英、中、法、德、日、韩、巴西葡、俄、西）
- ✅ **字符串管理**:
  - 主文件: `Localizable.xcstrings` (262KB)
  - 辅助文件: `Localizable-2.xcstrings` (6KB)
- ✅ **用户切换**: 用户可以在设置中切换语言
- ✅ **使用方式**:
  - SwiftUI: `Text("Articles")` 或 `Text(String(localized: "Sync", table: "Localizable-2"))`
  - 传统 API: `NSLocalizedString("Articles", comment: "")`
- ✅ **最佳实践**: 英文键名、驼峰命名、正确处理格式化字符串和复数

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
- ✅ **多语言支持**：9种语言（英、中、法、德、日、韩、巴西葡、俄、西）
- **字符串目录管理**：
  - 主目录：`Localizable.xcstrings`（262KB，已包含9种语言完整翻译）
  - 辅助目录：`Localizable-2.xcstrings`（6KB，包含退出确认等特定功能字符串）
- **使用规范**：
  - SwiftUI：`Text("Articles")` 或 `Text(String(localized: "Sync", table: "Localizable-2"))`
  - 传统 API：`NSLocalizedString("Articles", comment: "")`
- **最佳实践**：
  - 英文键名、驼峰命名
  - 添加注释说明
  - 正确处理格式化字符串和复数
- **字符串分类**：
  - 基础 UI 组件（保留在主目录）
  - 同步相关进度消息
  - 设置相关配置选项
  - 错误消息和帮助文本
  - 退出确认对话框（Localizable-2）

**导出/导入**：Product → Export/Import Localizations

## 配置文件

### Xcode 项目
- **SyncNos.xcodeproj/project.pbxproj**: Xcode 项目设置（版本 v0.5.10）
- **SyncNos/SyncNos.entitlements**: 应用沙盒和功能权限
- **SyncNos/Infrastructure/AppDelegate.swift**: 应用生命周期管理

### 资源文件
- **Resource/Localizable.xcstrings**: 主翻译文件（262KB，9种语言）
- **Resource/Localizable-2.xcstrings**: 辅助翻译文件（6KB）
- **Resource/SyncNos.storekit**: 应用内购买配置
- **Resource/ChangeLog.md**: 版本更新日志
- **Resource/PRIVACY_POLICY.md**: 隐私政策

### 后端服务
- **Backend/requirements.txt**: Python 依赖
- **Backend/.env**: Apple 凭证（不在 git 中，已加入.ignore）

### 构建配置
- **buildServer.json**: 构建服务器配置
