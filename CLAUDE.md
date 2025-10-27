# CLAUDE.md

本文档为 Claude Code (claude.ai/code) 在此代码库中工作提供指导。

## 项目概述

**SyncNos** 是一个 SwiftUI macOS 应用程序，用于将 Apple Books 和 GoodLinks 中的读书高亮和笔记同步到 Notion 数据库。它包含一个 Python FastAPI 后端用于 Apple Sign In 认证。

### 核心功能
- 从 SQLite 数据库中提取 Apple Books 高亮/笔记
- 同步 GoodLinks 文章标签和高亮
- Notion 数据库同步，支持两种策略：
  - **单一数据库模式**：所有内容在一个 Notion 数据库中
  - **每本书独立模式**：每本书/文章有独立的数据库
- 自动后台同步，可配置时间间隔
- 通过 FastAPI 后端实现 Apple Sign In 认证

## 构建与开发命令

### macOS 应用 (Xcode)

```bash
# 在 Xcode 中打开
open SyncNos.xcodeproj

# 构建 Debug 配置
xcodebuild -scheme SyncNos -configuration Debug build

# 构建 Release 配置
xcodebuild -scheme SyncNos -configuration Release build

# 清理构建文件夹
rm -rf ~/Library/Developer/Xcode/DerivedData/SyncNos-*

# 清理并重建
rm -rf ~/Library/Developer/Xcode/DerivedData/SyncNos-* && xcodebuild -scheme SyncNos -configuration Debug build

# 运行应用
open build/Debug/SyncNos.app
```

**环境要求：**
- macOS 13.0+
- Xcode 15.0+
- Swift 5.0+

### Python 后端 (FastAPI)

```bash
cd Backend/

# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境
# 编辑 .env 文件，设置 Apple 凭证

# 运行开发服务器
uvicorn app.main:app --reload --port 8000

# 访问 API 文档
# http://127.0.0.1:8000/docs
```

**后端环境变量** (Backend/.env):
```bash
APPLE_TEAM_ID=YOUR_TEAM_ID
APPLE_KEY_ID=YOUR_KEY_ID
APPLE_CLIENT_ID=com.example.app.services
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
APP_JWT_SECRET=your_jwt_secret
```

## 架构

### SwiftUI 应用结构

应用遵循 **MVVM 架构**，具有严格关注点分离：

```
SyncNos/
├── SyncNosApp.swift              # 应用入口
├── Views/                        # SwiftUI 视图（UI 层）
│   ├── Components/               # 可复用 UI 组件
│   │   ├── FilterBar.swift       # 统一筛选排序栏
│   │   ├── HighlightCardView.swift
│   │   ├── InfoHeaderCardView.swift
│   │   ├── ArticleContentCardView.swift
│   │   ├── WaterfallLayout.swift # 瀑布流布局
│   │   └── MainListView.swift
│   ├── AppleBooks/
│   │   ├── AppleBooksListView.swift
│   │   └── AppleBookDetailView.swift
│   ├── GoodLinks/
│   │   ├── GoodLinksListView.swift
│   │   └── GoodLinksDetailView.swift
│   └── Settting/
│       ├── General/
│       └── Sync/
├── ViewModels/                   # ObservableObject 视图模型
│   ├── AppleBooks/
│   │   ├── AppleBookViewModel.swift         # 列表管理
│   │   ├── AppleBookDetailViewModel.swift   # 详情页分页
│   │   └── AppleBooksSettingsViewModel.swift
│   ├── GoodLinks/
│   │   ├── GoodLinksViewModel.swift         # 统一视图模型
│   │   └── GoodLinksSettingsViewModel.swift
│   ├── Account/
│   ├── Notion/
│   └── LogViewModel.swift
├── Models/                       # 数据模型
│   └── Models.swift              # BookRow, Highlight 等
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
    │   ├── AutoSyncService.swift
    │   └── ConcurrencyLimiter.swift
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
- `AutoSyncService`: 后台同步调度
- `LoggerService`: 统一日志记录
- `AuthService`: Apple Sign In 集成
- `ConcurrencyLimiter`: API 调用速率限制
- `KeychainHelper`: 安全凭证存储

### 主应用入口

**SyncNosApp.swift:5** 初始化：
1. Apple Books 数据库访问的书签恢复
2. IAP 交易监控
3. 自动同步服务启动（如果启用）

应用窗口：
- MainListView: 书籍/文章选择和同步
- Settings: Notion 配置、同步选项
- UserGuide: 帮助文档
- Logs: 同步操作日志

### Python 后端结构

```
Backend/
├── app/
│   ├── main.py                   # FastAPI 应用入口
│   ├── api/                      # 路由处理器
│   ├── core/                     # 核心配置和安全
│   ├── services/                 # 业务逻辑
│   ├── models/                   # 数据模型
│   └── security/                 # JWT 和 Apple 认证
├── requirements.txt
└── .env                          # 环境配置（不在 git 中）
```

后端处理 Apple Sign In OAuth 流程和 macOS 应用的 JWT 令牌颁发。

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

关键模型（Models/Models.swift:18）：
- `Highlight`: 带 UUID、文本、笔记和时间戳的单个高亮
- `BookListItem`: 不包含完整高亮加载的书籍元数据
- `BookRow`: 简单书籍信息
- `HighlightRow`: 带关联书籍 ID 的高亮
- `AssetHighlightStats`: 每个资源的聚合统计

### FilterBar 组件

**Views/Components/FilterBar.swift** - 统一筛选排序组件：

功能特性：
- 笔记筛选（全部/有笔记/无笔记）
- 颜色筛选（Apple Books: 橙色/绿色/蓝色/黄色/粉色/紫色；GoodLinks: 黄色/绿色/蓝色/红色/紫色/薄荷色）
- 排序字段和方向（创建时间/修改时间，升序/降序）
- 一键重置功能
- 通过 UserDefaults 持久化状态

在详情视图中的使用：
```swift
FilterBar(
    noteFilter: $viewModel.highlightNoteFilter,
    selectedStyles: $viewModel.highlightSelectedStyles,
    colorTheme: .appleBooks,  // 或 .goodLinks
    sortField: viewModel.highlightSortField,
    isAscending: viewModel.highlightIsAscending,
    onSortFieldChanged: { field in
        viewModel.highlightSortField = field
    },
    onAscendingChanged: { ascending in
        viewModel.highlightIsAscending = ascending
    }
) {
    viewModel.resetHighlightFilters()
}
```

### ViewModel 架构差异

**Apple Books**（两个 ViewModel）：
- `AppleBookViewModel`: 列表管理、批量同步
- `AppleBookDetailViewModel`: 详情页面分页加载（每页 500 条高亮）、数据库会话管理

**GoodLinks**（一个 ViewModel）：
- `GoodLinksViewModel`: 统一管理 - 列表、高亮存储（`highlightsByLinkId`）、详情筛选排序
- 更简单的架构，因为 GoodLinks 高亮数量较少

这种差异是**有意的、合理的**：
- Apple Books: 复杂数据 → 需要专用的详情 ViewModel
- GoodLinks: 简单数据 → 统一 ViewModel 更高效

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

### 速率限制
- Notion API: 3 请求/秒（在 `NotionSyncConfig` 中可配置）
- 批处理操作：可配置的并发限制
- 重试逻辑：自动指数退避

### 国际化
- 支持中文（zh-Hans）和英文（en）
- 用户可以在设置中切换语言
- UI 字符串使用 `LocalizedStringResource`

## Cursor 规则

**.cursor/rules/SwiftUI响应式布局+MVVM架构+Combine响应式编程.mdc:1** 包含严格的架构指南：

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

## 配置文件

- **SyncNos.xcodeproj/project.pbxproj**: Xcode 项目设置
- **SyncNos/SyncNos.entitlements**: 应用沙盒和功能
- **Backend/requirements.txt**: Python 依赖
- **Backend/.env**: Apple 凭证（不在 git 中，已加入.ignore）
- **buildServer.json**: 构建服务器配置
- **Resource/Localizable.xcstrings**: 翻译文件（中文/英文）

## 快速参考

### 常用开发任务

**构建和运行：**
```bash
# Debug 构建
xcodebuild -scheme SyncNos -configuration Debug build

# 清理构建
rm -rf ~/Library/Developer/Xcode/DerivedData/SyncNos-*

# 在 Xcode 中打开
open SyncNos.xcodeproj
```

**FilterBar 集成：**
- 导入：`import SwiftUI`
- 添加到视图：放在详情视图的 VStack 中
- 绑定属性：笔记筛选、选中样式、排序字段
- 提供回调：onSortFieldChanged、onAscendingChanged、onResetFilters
- 选择主题：`.appleBooks` 或 `.goodLinks`

**服务访问：**
```swift
// 从 DI 容器获取服务
let service = DIContainer.shared.goodLinksService
let notionService = DIContainer.shared.notionService

// 创建只读会话
let session = try service.makeReadOnlySession(dbPath: dbPath)
```

**数据库路径：**
- Apple Books: `~/Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books/*.sqlite`
- GoodLinks: 使用 `service.resolveDatabasePath()`
