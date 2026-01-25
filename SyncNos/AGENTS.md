# SyncNos 项目规范与架构指南

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
- ✅ **智能增量自动同步**：每 5 分钟检查一次，只同步有变更的内容
- ✅ **国际化支持**：16 种语言

---

## 架构规范

### 核心技术栈
- **架构模式**: MVVM (Model-View-ViewModel)
- **编程范式**: Protocol-Oriented Programming (POP，协议驱动开发)
- **UI框架**: SwiftUI (macOS 14+)
- **响应式编程**: Combine
- **数据持久化**: SwiftData
- **语言版本**: Swift 5.9+ / Swift 6.0+

## MVVM 架构规范

### 1. Models (数据模型)
- 纯数据结构，不包含业务逻辑
- 使用 `@Model` 宏用于 SwiftData
- 只包含属性和简单的数据处理方法
- 不直接引用 SwiftUI 或 Combine

### 2. ViewModels (视图模型)
- 处理业务逻辑，管理状态
- 二选一：使用 `ObservableObject` + `@Published`，或使用 `@Observable`；不要混用
- **禁止使用单例模式** (`shared` 静态实例)
- 使用 Combine 进行响应式数据流处理
- 调用 Service 执行业务操作

### 3. Views (视图)
- 纯 UI 展示，不包含业务逻辑
- 绑定策略：`ObservableObject` 用 `@StateObject/@ObservedObject`
- 组件化、可复用、条件渲染（加载/错误/空数据）

### 4. Services (服务层)
- 网络请求、数据存储等基础设施逻辑
- 通过 `DIContainer.shared` 访问
- 所有服务实现协议以支持测试

---

## 依赖注入

服务通过 `DIContainer.shared` 管理：

```swift
// 核心服务
DIContainer.shared.notionClient
DIContainer.shared.notionSyncEngine      // 统一同步引擎
DIContainer.shared.databaseService
DIContainer.shared.autoSyncService
DIContainer.shared.syncTimestampStore

// WeRead 服务
DIContainer.shared.weReadAPIService
DIContainer.shared.weReadCacheService

// Dedao 服务
DIContainer.shared.dedaoAPIService
DIContainer.shared.dedaoCacheService

// Site Logins（Cookie 登录统一存储：domain → cookieHeader）
DIContainer.shared.siteLoginsStore

// Chats 服务
DIContainer.shared.chatsCacheService
DIContainer.shared.chatOCRParser

// OCR 服务
DIContainer.shared.ocrAPIService        // Apple Vision OCR（原生，离线）
DIContainer.shared.ocrConfigStore       // 配置存储
```

---

## 同步架构

### 核心设计模式：SyncEngine + Adapter

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
│  - DedaoNotionAdapter                                            │
│  - 职责：将数据源转换为 UnifiedHighlight                          │
└─────────────────────────────────────────────────────────────────┘
```

### 添加新数据源

只需要：
1. 在 `DataSources-From/` 创建数据读取服务
2. 在 `SyncEngine/Adapters/` 创建适配器，实现 `NotionSyncSourceProtocol`
3. 在 ViewModel 中使用 `syncEngine.sync(source: adapter, ...)`

**不需要**修改 `NotionSyncEngine` 或 `NotionClient`。

---

## 协议驱动开发 (Protocol-Oriented Programming)

### 设计原则

1. **面向协议而非实现**: 优先定义协议，然后实现具体类型
2. **消除 switch 语句**: 当需要根据类型执行不同逻辑时，使用协议代替 switch
3. **可扩展性**: 添加新类型只需实现协议，不需要修改现有代码

### 示例

```swift
// ✅ 正确：使用协议定义统一接口
protocol DataSourceUIProvider {
    var source: ContentSource { get }
    var displayName: String { get }
    var filterChangedNotification: Notification.Name { get }
    var hasFilterMenu: Bool { get }
}

// ✅ 正确：为每个数据源实现协议
struct AppleBooksUIProvider: DataSourceUIProvider {
    let source: ContentSource = .appleBooks
    let displayName = "Apple Books"
    let filterChangedNotification: Notification.Name = .appleBooksFilterChanged
    let hasFilterMenu = true
}
```

```swift
// ❌ 错误：在多处使用 switch 根据类型执行不同逻辑
switch source {
case .appleBooks: // 处理 AppleBooks
case .goodLinks: // 处理 GoodLinks
// 每添加新类型都需要修改所有 switch
}

// ✅ 正确：通过协议统一处理
func process(_ provider: DataSourceUIProvider) {
    let name = provider.displayName
    NotificationCenter.default.post(name: provider.filterChangedNotification, object: nil)
}
```

---

## 通知与事件管理

### 统一通知名称定义

所有通知名称必须在 `Models/Core/NotificationNames.swift` 中统一定义：

```swift
// ✅ 正确：在 NotificationNames.swift 中统一定义
extension Notification.Name {
    static let refreshBooksRequested = Notification.Name("RefreshBooksRequested")
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
}

// ❌ 错误：在各处硬编码通知名称
NotificationCenter.default.post(name: Notification.Name("RefreshBooksRequested"), object: nil)
```

### 唯一入口原则

当多个操作触发相同的副作用时，应该**统一到一个入口点**，而不是在每个触发点分别处理。

---

## ViewModel 实例化策略

### 推荐方式
1. **按需创建**：每个视图创建独立的 ViewModel 实例
2. **依赖注入**：通过 `.environmentObject()` 传递 ViewModel

### 禁止方式
- ❌ 使用 `static let shared` 单例模式创建 ViewModel
- ❌ 在 ViewModel 中创建全局状态

### 正确示例
```swift
// ✅ 正确：按需创建（ObservableObject）
@StateObject private var viewModel = ItemViewModel()

// ✅ 正确：依赖注入（ObservableObject）
.environmentObject(viewModel)

// ✅ 正确：响应式 ViewModel（ObservableObject + Combine）
class ItemViewModel: ObservableObject {
    @Published var items: [Item] = []
    private var cancellables = Set<AnyCancellable>()

    init() {
        $items
            .map { items in items.map { DisplayItem(from: $0) } }
            .assign(to: &$filteredItems)
    }
}
```

---

## DetailView 内存释放与生命周期规范

> 背景：Detail（右侧详情）往往持有最大的数据，容易因为"非生命周期绑定的异步任务"导致对象无法及时释放。

- **生命周期绑定加载**：优先使用 `.task(id: selectionId)`
- **切换/退出时强制释放**：
  - 取消任务（或让结果可被丢弃）
  - 关闭数据会话（例如 SQLite read-only session）
  - 大数组使用 `removeAll(keepingCapacity: false)`
- **防串台**：对分页/长任务使用 token 或 id 校验

---

## 禁止事项

### 架构层面
- ❌ 在 View 中直接处理业务逻辑
- ❌ 在 Model 中包含业务逻辑
- ❌ 使用 `static let shared` 单例模式创建 ViewModel
- ❌ 在 ViewModel 中直接操作 UI
- ❌ 在 View 中直接访问数据库
- ❌ 在多个地方发送相同类型的通知

### 代码实现
- ❌ 手动计算屏幕尺寸和比例
- ❌ 使用固定像素值布局
- ❌ 复杂的 GeometryReader 嵌套
- ❌ 忽略内存管理 (忘记调用 store(in:))

---

## 性能优化

### 响应式数据流
- 合理使用 `@Published` 避免不必要的更新
- 使用 `removeDuplicates()` 减少重复计算
- 使用 `debounce()` 优化用户输入响应

### 速率限制与并发控制
- **Notion API**: 读取 8 RPS，写入 3 RPS（在 `NotionSyncConfig` 中可配置）
- **全局并发控制**: `ConcurrencyLimiter` 控制全局操作并发数
- **重试逻辑**: 自动指数退避（429 和 409 错误）
