# SyncNos 项目规范与架构指南

> 本文件是 `SyncNos/`（macOS App 主工程）的开发规范与架构约定，已融合仓库的通用开发规范；若与通用规范冲突，以本文件为准。

## 项目概述

**SyncNos** 是一个 SwiftUI macOS 应用程序，用于将 Apple Books、GoodLinks、WeRead、Dedao（得到）和微信聊天 OCR 中的读书高亮和笔记同步到 Notion 数据库。已发布至 [Mac App Store](https://apps.apple.com/app/syncnos/id6755133888)。

> 备注：本仓库还包含独立浏览器扩展 `WebClipper`（`Extensions/WebClipper/`）。扩展开发约定见 `Extensions/WebClipper/AGENTS.md`。

### 核心功能

- ✅ **完整数据提取**：从 SQLite 数据库中提取 Apple Books 高亮/笔记（支持时间戳、颜色标签）
- ✅ **智能分页**：大量数据分页处理，支持增量加载与性能优化
- ✅ **GoodLinks 同步**：文章内容、标签和高亮笔记的完整同步
- ✅ **WeRead 集成**：Cookie 自动刷新与透明认证
- ✅ **Dedao 集成**：WebView 登录与令牌桶限流防反爬
- ✅ **Chats OCR 集成**：截图 OCR、消息方向判断、本地存储加密与解析统计日志
- ✅ **Notion 数据库同步**（单库/每本书独立库两种策略）
- ✅ **同步队列管理**：进度显示、任务排队、状态跟踪
- ✅ **智能增量自动同步**：每 5 分钟检查一次，仅同步变更内容
- ✅ **国际化支持**：16 种语言

---

## 核心技术栈

- **架构模式**：MVVM (Model-View-ViewModel)
- **编程范式**：Protocol-Oriented Programming（面向协议编程）
- **UI 框架**：SwiftUI（macOS 14.0+）
- **状态管理**：Observation（`@Observable` / `@Bindable`）
- **并发**：Swift Concurrency（优先）；仅在需要 Publisher 管道时才引入 Combine
- **数据持久化**：SwiftData
- **语言版本**：Swift 6.0+

### 平台支持

- **当前主目标**：macOS 14.0+
- **通用规范可选目标**：iOS 17.0+、iPadOS 17.0+、visionOS 2.0+（仅当代码被抽到可复用模块/跨平台目标时启用）

---

## 设计原则（必须遵守）

### 核心原则

- **组合优于继承**：通过依赖注入组织能力
- **接口优于单例**：优先依赖协议，便于测试与替换实现
- **显式优于隐式**：依赖、状态与数据流可追踪
- **协议驱动**：用协议扩展能力，避免散落的 switch

### 简洁原则

- **KISS**：能用简单方案就不用复杂方案
- **YAGNI**：不为“未来可能需要”过早设计
- **DRY + WET**：重复 2–3 次再考虑抽象

### 职责分离

- **SRP**：一个类型/函数只做一件事
- **DIP**：上层依赖抽象，下层提供实现
- **SoC**：UI / 状态 / 数据访问 / 同步解耦

---

## 分层与目录（当前仓库现状）

### 主工程（Xcode Project）

- `SyncNos/Models/`：数据模型（DTO、缓存模型、SwiftData `@Model`）
- `SyncNos/Services/`：基础设施与业务服务（数据源、同步目标、队列/调度、鉴权等）
- `SyncNos/ViewModels/`：MVVM ViewModel（UI 状态桥接与业务编排）
- `SyncNos/Views/`：SwiftUI 视图（展示与交互）

### SwiftPM Packages（按需引入）

- `Packages/`：可复用模块（例如 `Packages/MenuBarDockKit`）

> 说明：通用规范中“SwiftPM 逻辑层 + Xcode UI 层”的拆分是推荐形态；本仓库当前未把所有 Models/Services 完整下沉到 SwiftPM。新增可复用的纯逻辑模块时优先放入 `Packages/`，并保持依赖方向单向（不反向 import UI）。

### 依赖方向（必须保持单向）

`Views → ViewModels → Services → Models`

### 推荐的 SwiftPM 逻辑层拆分（规划/新增模块遵循）

- 目标：让 Models/Services 可测试、可复用、可跨平台；UI 层只做绑定与呈现
- 若新增 `Packages/AppCore`（示例命名）：建议拆成两个 targets
  - `Models`：纯数据结构，零业务逻辑，除 Foundation 外尽量不依赖其它框架
  - `Services`：业务能力与基础设施实现，依赖 `Models`
- ViewModel 仍留在 Xcode 工程（需要 SwiftUI/Observation，属于 UI 绑定层）

---

## MVVM 职责边界

- **Model**：纯数据结构/持久化模型，不含业务流程；禁止引用 SwiftUI / Observation / Combine
- **Service**：网络、存储、解析、同步等基础设施与可复用业务能力；必须协议化以支持 mock
- **ViewModel**：业务编排、状态管理、数据转换；禁止做 UI 细节、禁止 `static let shared`
- **View**：纯 UI 展示与交互；禁止直接访问数据库/网络/Notion，同步入口只触发 ViewModel

---

## 状态管理与 ViewModel 规范（目标规范 + 渐进迁移）

### 目标规范（新代码默认）

- **统一使用 `@Observable`**（macOS 14.0+），并优先配合 Swift Concurrency
- **实例化策略**：
  - ✅ 按需创建：`@State`
  - ✅ 依赖注入：`.environment(_:)` + `@Environment(Type.self)`
  - ✅ 父子共享：父视图创建，通过 `@Bindable` 传递
- **禁止**：
  - ❌ ViewModel 单例：`static let shared`
  - ❌ 使用 `@StateObject` / `@ObservedObject` / `.environmentObject()`（仅用于遗留 `ObservableObject` 代码）

### 渐进迁移（面对现存 `ObservableObject`）

- 现存 ViewModel 若为 `ObservableObject`：在同一功能域内不要混用 `ObservableObject` 与 `@Observable`
- 仅做小修时保持原有写法；涉及大改/重构时，再评估是否迁移到 `@Observable`
- 遗留 Combine 代码继续维护时：确保 cancellables 生命周期与 ViewModel 生命周期一致，避免内存泄漏/重复订阅

---

## 依赖注入

- 依赖应以**协议类型**注入到 ViewModel/Service 构造器，便于测试与替换实现
- `DIContainer` 是组装依赖的组合根（Composition Root）；尽量避免在业务实现内部到处直取 `DIContainer.shared`

当前常用依赖入口（示例）：

```swift
DIContainer.shared.notionClient
DIContainer.shared.notionSyncEngine
DIContainer.shared.databaseService
DIContainer.shared.autoSyncService
DIContainer.shared.syncTimestampStore

DIContainer.shared.weReadAPIService
DIContainer.shared.weReadCacheService

DIContainer.shared.dedaoAPIService
DIContainer.shared.dedaoCacheService

DIContainer.shared.siteLoginsStore
DIContainer.shared.chatsCacheService
DIContainer.shared.chatOCRParser

DIContainer.shared.ocrAPIService
DIContainer.shared.ocrConfigStore
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

1. 在 `SyncNos/Services/DataSources-From/` 创建数据读取服务
2. 在 `SyncNos/Services/DataSources-To/Notion/Sync/Adapters/` 创建 Notion 适配器，实现 `NotionSyncSourceProtocol`
3. 在 ViewModel 中调用 `NotionSyncEngine.sync(source: ...)`

**不需要**修改 `NotionSyncEngine` 或 `NotionClient`。

---

## 协议驱动开发（Protocol-Oriented Programming）

### 原则

1. **面向协议而非实现**：优先定义协议，再实现具体类型
2. **消除 switch 语句**：用协议替代类型判断
3. **可扩展性**：添加新类型只需实现协议，不改现有代码

### 示例

```swift
protocol DataSourceUIProvider {
    var source: ContentSource { get }
    var displayName: String { get }
    var filterChangedNotification: Notification.Name { get }
    var hasFilterMenu: Bool { get }
}

struct AppleBooksUIProvider: DataSourceUIProvider {
    let source: ContentSource = .appleBooks
    let displayName = "Apple Books"
    let filterChangedNotification: Notification.Name = .appleBooksFilterChanged
    let hasFilterMenu = true
}
```

---

## 通知与事件管理

### 统一通知名称定义

所有通知名称必须在 `SyncNos/Models/Core/NotificationNames.swift` 中统一定义：

```swift
extension Notification.Name {
    static let refreshBooksRequested = Notification.Name("RefreshBooksRequested")
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
}
```

### 唯一入口原则

当多个操作触发相同的副作用时，应该统一到一个入口点，而不是在每个触发点分别处理。

---

## ViewModel 实例化策略

### 推荐方式（新代码）

1. **按需创建**：`@State` + `@Observable`
2. **依赖注入**：`.environment(_:)` + `@Environment(Type.self)`
3. **父子共享**：父视图创建，通过 `@Bindable` 传递

### 禁止方式

- ❌ 使用 `static let shared` 单例模式创建 ViewModel
- ❌ 在 ViewModel 中创建全局状态

### 示例（新代码）

```swift
@Observable
@MainActor
final class ItemViewModel {
    var items: [Item] = []
}

struct ItemView: View {
    @State private var viewModel = ItemViewModel()

    var body: some View {
        DetailView(viewModel: viewModel)
    }
}

struct DetailView: View {
    @Bindable var viewModel: ItemViewModel
    var body: some View { /* ... */ }
}
```

---

## DetailView 内存释放与生命周期规范

> 背景：Detail（右侧详情）往往持有最大的数据，容易因为“非生命周期绑定的异步任务”导致对象无法及时释放。

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
- ❌ 在 View 中直接访问数据库/网络/Notion
- ❌ 在多个地方发送相同类型的通知

### 代码实现

- ❌ 手动计算屏幕尺寸和比例
- ❌ 使用固定像素值布局
- ❌ 复杂的 GeometryReader 嵌套

---

## 性能优化

### 状态更新

- 让状态更新“更少、更明确”：避免在频繁变化的路径上绑定大对象/大数组
- 输入类交互（搜索框等）需要节流/防抖时：优先用 Swift Concurrency 实现；仅在已有 Publisher 管道时用 Combine

### 速率限制与并发控制

- **Notion API**：读取 8 RPS，写入 3 RPS（在 `NotionSyncConfig` 中可配置）
- **全局并发控制**：`ConcurrencyLimiter` 控制全局操作并发数
- **重试逻辑**：自动指数退避（429 和 409 错误）

---

## 测试与调试

### 单元测试（推荐）

- 框架：Swift Testing（优先）/ XCTest
- 覆盖：数据转换、状态变化、边界条件（空数据、重复数据、异常数据）
- 通过协议 + 依赖注入 + mock 隔离外部依赖（Notion / SQLite / WebView / OCR 等）

### 调试与日志

- 使用 `os.Logger`，并设置清晰的 subsystem 与 category，便于过滤定位
