# 协议驱动数据源 UI 配置重构计划

> **目标**: 将分散在多个文件中的数据源 UI 配置（通知名称、菜单配置、排序选项等）统一为协议驱动的设计，实现"添加新数据源只需修改一个地方"的目标。

## 现状分析

### 当前问题

1. **通知名称分散定义**: 157 处使用 `Notification.Name(...)`，分布在 44 个文件中
2. **switch/if-else 链**: 34 处使用数据源相关的 switch 语句
3. **重复的菜单配置**: `ViewCommands.swift` 和 `MainListView+FilterMenus.swift` 中有重复的筛选菜单代码
4. **添加新数据源需修改多个文件**: 目前添加新数据源需要在 10+ 个位置添加 case

### 受影响的核心文件

| 文件 | switch/if-else 数量 | 主要用途 |
|------|---------------------|---------|
| `Views/Commands/ViewCommands.swift` | 10 | 菜单命令筛选菜单 |
| `Views/Components/Main/MainListView+SyncRefresh.swift` | 5 | 同步/刷新/导航逻辑 |
| `Views/Components/Main/MainListView+DetailViews.swift` | 1 | Detail 视图切换 |
| `Views/Components/Main/MainListView+FilterMenus.swift` | 5 | 工具栏筛选菜单 |
| `Views/Components/Controls/SwipeableDataSourceContainer.swift` | 2 | ListView 切换、SelectionCommands |
| `Models/Core/Models.swift` | 5 | ContentSource 枚举属性 |
| `Models/Core/HighlightColorScheme.swift` | 2 | 颜色主题 |

---

## 重构方案

### 核心设计

1. **保留 `ContentSource` 枚举**: 作为数据源标识符，不删除
2. **扩展 `ContentSource`**: 添加 UI 相关配置属性
3. **新建 `Notification.Name` 扩展**: 统一定义所有通知名称
4. **新建 `DataSourceUIConfig` 协议**: 定义数据源 UI 配置的统一接口（可选，P3）

### 架构兼容性

✅ **完全符合现有 MVVM 架构**:
- 配置属性属于 **Model 层** 的扩展
- 不改变 View/ViewModel 的职责边界
- 与现有的 `NotionSyncSourceProtocol` 适配器模式类似

---

## 优先级任务列表

### P1: 统一通知名称定义 ⏱️ 约 30 分钟

**目标**: 创建类型安全的通知名称定义，消除字符串硬编码

**新建文件**:
- `Models/Core/NotificationNames.swift`

**内容**:
```swift
// MARK: - 数据源筛选变更通知
extension Notification.Name {
    // Apple Books
    static let appleBooksFilterChanged = Notification.Name("AppleBooksFilterChanged")
    
    // GoodLinks
    static let goodLinksFilterChanged = Notification.Name("GoodLinksFilterChanged")
    
    // WeRead
    static let weReadFilterChanged = Notification.Name("WeReadFilterChanged")
    
    // Dedao
    static let dedaoFilterChanged = Notification.Name("DedaoFilterChanged")
    
    // Chats
    static let chatsFilterChanged = Notification.Name("ChatsFilterChanged")
    
    // MARK: - 高亮排序/筛选
    static let highlightSortChanged = Notification.Name("HighlightSortChanged")
    static let highlightFilterChanged = Notification.Name("HighlightFilterChanged")
    
    // MARK: - 同步状态
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
    static let syncProgressUpdated = Notification.Name("SyncProgressUpdated")
    
    // MARK: - 全局操作
    static let syncQueueTaskSelected = Notification.Name("SyncQueueTaskSelected")
    static let syncSelectedToNotionRequested = Notification.Name("SyncSelectedToNotionRequested")
    static let fullResyncSelectedRequested = Notification.Name("FullResyncSelectedRequested")
    static let refreshBooksRequested = Notification.Name("RefreshBooksRequested")
    static let showNotionConfigAlert = Notification.Name("ShowNotionConfigAlert")
    static let showSessionExpiredAlert = Notification.Name("ShowSessionExpiredAlert")
    static let navigateToNotionSettings = Notification.Name("NavigateToNotionSettings")
}

// MARK: - ContentSource 通知扩展
extension ContentSource {
    /// 该数据源的筛选变更通知名称
    var filterChangedNotification: Notification.Name {
        switch self {
        case .appleBooks: return .appleBooksFilterChanged
        case .goodLinks: return .goodLinksFilterChanged
        case .weRead: return .weReadFilterChanged
        case .dedao: return .dedaoFilterChanged
        case .chats: return .chatsFilterChanged
        }
    }
}
```

**修改文件** (替换字符串为常量):
- `ViewCommands.swift`
- `MainListView+FilterMenus.swift`
- `AppleBooksViewModel.swift`
- `GoodLinksViewModel.swift`
- `WeReadViewModel.swift`
- `DedaoViewModel.swift`
- `MainListView.swift`
- 其他使用通知的文件

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P2: 扩展 ContentSource 枚举属性 ⏱️ 约 45 分钟

**目标**: 将菜单配置、排序键类型等 UI 相关属性集中到 `ContentSource` 枚举

**修改文件**:
- `Models/Core/Models.swift` (扩展 ContentSource)

**添加属性**:
```swift
extension ContentSource {
    // MARK: - Menu Configuration
    
    /// 菜单标题（"Books" / "Articles" / "Chats"）
    var menuTitle: LocalizedStringResource {
        switch self {
        case .appleBooks: return "Books"
        case .goodLinks: return "Articles"
        case .weRead: return "Books"
        case .dedao: return "Books"
        case .chats: return "Chats"
        }
    }
    
    /// 该数据源可用的排序键
    var availableBookListSortKeys: [BookListSortKey] {
        switch self {
        case .appleBooks:
            return BookListSortKey.allCases
        case .goodLinks:
            return [] // GoodLinks 使用 GoodLinksSortKey
        case .weRead, .dedao:
            return [.title, .highlightCount, .lastSync]
        case .chats:
            return [] // Chats 不支持排序
        }
    }
    
    /// 是否有筛选菜单
    var hasFilterMenu: Bool {
        switch self {
        case .chats: return false
        default: return true
        }
    }
    
    /// 是否支持高亮颜色筛选
    var supportsHighlightColors: Bool {
        switch self {
        case .chats: return false
        default: return true
        }
    }
    
    /// 高亮颜色主题
    var highlightColorTheme: HighlightColorTheme {
        switch self {
        case .appleBooks: return .appleBooks
        case .goodLinks: return .goodLinks
        case .weRead: return .weRead
        case .dedao: return .dedao
        case .chats: return .appleBooks // Fallback
        }
    }
}
```

**重构 ViewCommands.swift**:
- 使用 `currentSource.menuTitle` 替代硬编码的 "Books" / "Articles"
- 使用 `currentSource.availableBookListSortKeys` 替代重复的数组定义

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P3: 创建 DataSourceUIConfig 协议（可选）⏱️ 约 1 小时

**目标**: 如果 P2 后 ContentSource 扩展变得太长，可以将 UI 配置提取为独立的协议和结构体

**新建文件**:
- `Models/Core/DataSourceUIConfig.swift`

**设计**:
```swift
/// 数据源 UI 配置协议
protocol DataSourceUIConfigProvider {
    var source: ContentSource { get }
    var menuTitle: LocalizedStringResource { get }
    var filterNotification: Notification.Name { get }
    var supportsFilterMenu: Bool { get }
    var availableSortKeys: [any SortKeyProtocol] { get }
}

/// 排序键协议（统一 BookListSortKey 和 GoodLinksSortKey）
protocol SortKeyProtocol: CaseIterable, Hashable, RawRepresentable where RawValue == String {
    var displayName: LocalizedStringResource { get }
}

extension BookListSortKey: SortKeyProtocol {}
extension GoodLinksSortKey: SortKeyProtocol {}

/// 各数据源配置
struct AppleBooksUIConfig: DataSourceUIConfigProvider { ... }
struct GoodLinksUIConfig: DataSourceUIConfigProvider { ... }
struct WeReadUIConfig: DataSourceUIConfigProvider { ... }
struct DedaoUIConfig: DataSourceUIConfigProvider { ... }
struct ChatsUIConfig: DataSourceUIConfigProvider { ... }
```

**注意**: 这个优先级较低，因为 P2 可能已经足够满足需求。只有当 ContentSource 扩展变得难以维护时才需要实现。

---

### P4: 重构选择状态管理 ⏱️ 约 1.5 小时

**目标**: 将分散的 `selectedBookIds`, `selectedLinkIds` 等统一为字典结构

**当前问题**:
```swift
// 目前有 5 个独立的选择状态变量
@State var selectedBookIds: Set<String> = []
@State var selectedLinkIds: Set<String> = []
@State var selectedWeReadBookIds: Set<String> = []
@State var selectedDedaoBookIds: Set<String> = []
@State var selectedChatsContactIds: Set<String> = []
```

**重构为**:
```swift
/// 统一选择状态管理器
@Observable
class SelectionState {
    var selections: [ContentSource: Set<String>] = [:]
    
    func selection(for source: ContentSource) -> Set<String> {
        selections[source] ?? []
    }
    
    mutating func setSelection(for source: ContentSource, ids: Set<String>) {
        selections[source] = ids
    }
    
    func clearAll() {
        selections.removeAll()
    }
    
    func clear(for source: ContentSource) {
        selections[source] = []
    }
}
```

**受影响文件**:
- `MainListView.swift`
- `MainListView+SyncRefresh.swift`
- `MainListView+DetailViews.swift`
- `SwipeableDataSourceContainer.swift`

**注意**: 这个重构改动较大，需要仔细测试。建议在完成 P1、P2 后再进行。

---

### P5: 重构 ViewModel 排序/筛选接口 ⏱️ 约 2 小时

**目标**: 统一 ViewModel 的排序/筛选接口，减少 FilterMenus 中的重复代码

**当前问题**:
- 每个 ViewModel 有不同的排序属性名称和类型
- `AppleBooksViewModel.sortKey: BookListSortKey`
- `GoodLinksViewModel.sortKey: GoodLinksSortKey`
- 筛选菜单需要为每个数据源写独立的代码

**解决方案**: 定义 `FilterableListViewModel` 协议
```swift
protocol FilterableListViewModel: ObservableObject {
    associatedtype SortKey: SortKeyProtocol
    var sortKey: SortKey { get set }
    var sortAscending: Bool { get set }
    var filterNotification: Notification.Name { get }
}

extension AppleBooksViewModel: FilterableListViewModel {
    var filterNotification: Notification.Name { .appleBooksFilterChanged }
}
```

**注意**: 这个重构涉及 ViewModel 层，改动较大。建议作为后续优化。

---

## 实施顺序

```
P1 (通知名称) → 验证 → P2 (ContentSource 扩展) → 验证 → [可选 P3/P4/P5]
```

每完成一个优先级后必须运行:
```bash
xcodebuild -scheme SyncNos -configuration Debug build
```

---

## 风险评估

| 优先级 | 风险 | 影响范围 | 回滚难度 |
|--------|------|---------|---------|
| P1 | 低 | 仅替换字符串常量 | 简单 |
| P2 | 低 | 新增扩展属性 | 简单 |
| P3 | 中 | 新增协议和结构体 | 简单（可删除） |
| P4 | 高 | 改变状态管理方式 | 复杂 |
| P5 | 高 | 改变 ViewModel 接口 | 复杂 |

---

## 预期收益

完成 P1 + P2 后:
- ✅ 类型安全的通知名称（自动补全，避免拼写错误）
- ✅ 集中管理数据源 UI 配置
- ✅ 添加新数据源只需在 2-3 个地方添加代码（枚举 case + 扩展属性）
- ✅ 减少约 50% 的 switch case 重复代码

完成 P4 + P5 后:
- ✅ 统一的选择状态管理
- ✅ 统一的 ViewModel 筛选接口
- ✅ 添加新数据源只需在 1 个地方添加代码（新的 UIConfig）

---

**文档版本**: 1.0  
**创建时间**: 2026-01-02  
**作者**: AI Assistant

