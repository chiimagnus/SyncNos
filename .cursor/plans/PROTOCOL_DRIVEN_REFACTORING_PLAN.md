# 协议驱动数据源 UI 配置重构计划（破坏性重构版）

> **目标**: 采用**协议驱动设计**，将每个数据源封装为独立的"UI 配置类"，实现"添加新数据源只需新增一个文件"的目标。**破坏性重构**：允许删除/重命名现有结构，不需要向后兼容。

## 现状分析

### 当前问题

1. **两个功能重叠的枚举**: `ContentSource`（UI 层）和 `SyncSource`（同步层）定义了相同的数据源
2. **switch 语句分散**: 34+ 处使用数据源相关的 switch 语句
3. **5 个独立的选择状态变量**: `selectedBookIds`, `selectedLinkIds`, `selectedWeReadBookIds`, `selectedDedaoBookIds`, `selectedChatsContactIds`
4. **重复的菜单配置**: `ViewCommands.swift` 和 `MainListView+FilterMenus.swift` 中有几乎相同的筛选菜单代码
5. **添加新数据源需修改 15+ 个文件**

### Switch 语句热点分析

| 文件 | switch 数量 | 场景 |
|------|------------|------|
| `MainListView+SyncRefresh.swift` | 4 | 同步/刷新/导航/选择 |
| `MainListView+DetailViews.swift` | 1 | Detail 视图切换 |
| `MainListView+FilterMenus.swift` | 5 (隐式) | 每个数据源的筛选菜单 |
| `MainListView+KeyboardMonitor.swift` | 1 | 单选检查 |
| `MainListView.swift` | 3 | 筛选菜单/启用检查/工具栏 |
| `ViewCommands.swift` | 3 | 筛选菜单/启用检查/颜色主题 |
| `SwipeableDataSourceContainer.swift` | 1 | ListView 切换 |

---

## 重构方案

### 核心设计：协议驱动的数据源 UI 配置

```
┌─────────────────────────────────────────────────────────────────┐
│                   DataSourceUIProvider 协议                      │
│  - source: ContentSource                                         │
│  - displayName, icon, accentColor                               │
│  - filterNotification, highlightColorTheme                       │
│  - sortKeys, hasFilterMenu, supportsSync                         │
│  - enabledStorageKey (for @AppStorage)                          │
│  - makeListView(), makeDetailView(), makeFilterMenu()           │
└─────────────────────────────────────────────────────────────────┘
              ▲         ▲         ▲         ▲         ▲
              │         │         │         │         │
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│AppleBooks│ │GoodLinks │ │ WeRead   │ │  Dedao   │ │  Chats   │
│UIProvider│ │UIProvider│ │UIProvider│ │UIProvider│ │UIProvider│
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### 架构变更

1. **统一枚举**: 删除 `SyncSource`，保留并扩展 `ContentSource`
2. **统一选择状态**: 用 `SelectionState` 类替代 5 个独立变量
3. **协议驱动 UI**: 每个数据源实现 `DataSourceUIProvider` 协议
4. **注册表模式**: `DataSourceRegistry` 管理所有数据源配置

---

## 优先级任务列表

### P1: 统一通知名称定义 ✅ 已完成

**已创建**: `Models/Core/NotificationNames.swift`

---

### P2: 统一 ContentSource 和 SyncSource ⏱️ 约 30 分钟

**目标**: 删除 `SyncSource` 枚举，统一使用 `ContentSource`

**当前状态**:
- `SyncSource` 在 `Models/Sync/SyncQueueModels.swift` 中定义
- `ContentSource` 在 `Models/Core/Models.swift` 中定义
- 两者有相同的 case 和部分相同的属性（displayName, iconName, brandColor）

**变更**:

1. **删除 `SyncSource` 枚举**（在 `SyncQueueModels.swift` 中）
2. **扩展 `ContentSource`**，添加 `SyncSource` 的属性：
   - `brandBackgroundOpacity: Double`
3. **更新 `SyncQueueTask`**，使用 `ContentSource` 替代 `SyncSource`
4. **全局替换**: `SyncSource` → `ContentSource`

**受影响文件**:
- `Models/Sync/SyncQueueModels.swift` - 删除 SyncSource，修改 SyncQueueTask
- `Services/SyncScheduling/SyncQueueStore.swift` - 更新类型引用
- `Views/Components/Controls/SyncQueueView.swift` - 更新类型引用
- `ViewModels/Sync/SyncQueueViewModel.swift` - 更新类型引用
- 所有使用 `SyncSource` 的文件

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P3: 创建 DataSourceUIProvider 协议 ⏱️ 约 1 小时

**目标**: 定义数据源 UI 配置的统一接口

**新建文件**: `Models/Core/DataSourceUIProvider.swift`

```swift
import SwiftUI

/// 数据源 UI 配置协议
/// 每个数据源（Apple Books、GoodLinks 等）实现此协议以提供 UI 相关配置
protocol DataSourceUIProvider {
    
    // MARK: - 基础属性
    
    /// 数据源标识符
    var source: ContentSource { get }
    
    /// 显示名称
    var displayName: String { get }
    
    /// SF Symbol 图标名称
    var iconName: String { get }
    
    /// 品牌强调色
    var accentColor: Color { get }
    
    // MARK: - 通知配置
    
    /// 筛选变更通知名称
    var filterChangedNotification: Notification.Name { get }
    
    // MARK: - 功能配置
    
    /// 是否有筛选菜单
    var hasFilterMenu: Bool { get }
    
    /// 是否支持高亮颜色筛选
    var supportsHighlightColors: Bool { get }
    
    /// 是否支持同步到 Notion
    var supportsSync: Bool { get }
    
    /// 高亮颜色主题
    var highlightColorTheme: HighlightColorTheme? { get }
    
    // MARK: - 排序配置
    
    /// 可用的排序键类型（返回 any 以支持不同枚举）
    var sortKeyType: any SortKeyType.Type { get }
    
    /// 菜单标题（如 "Books", "Articles"）
    var menuTitle: LocalizedStringKey { get }
}

/// 排序键协议
protocol SortKeyType: CaseIterable, Hashable, RawRepresentable where RawValue == String {
    var displayName: String { get }
}

extension BookListSortKey: SortKeyType {}
extension GoodLinksSortKey: SortKeyType {}

/// 空排序键（用于不支持排序的数据源如 Chats）
enum NoSortKey: String, SortKeyType, CaseIterable {
    var displayName: String { "" }
}
```

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P4: 实现各数据源的 UIProvider ⏱️ 约 1.5 小时

**目标**: 为每个数据源创建 UIProvider 实现

**新建目录**: `Models/DataSourceProviders/`

**新建文件**:
- `Models/DataSourceProviders/AppleBooksUIProvider.swift`
- `Models/DataSourceProviders/GoodLinksUIProvider.swift`
- `Models/DataSourceProviders/WeReadUIProvider.swift`
- `Models/DataSourceProviders/DedaoUIProvider.swift`
- `Models/DataSourceProviders/ChatsUIProvider.swift`

**示例** (`AppleBooksUIProvider.swift`):

```swift
import SwiftUI

struct AppleBooksUIProvider: DataSourceUIProvider {
    let source: ContentSource = .appleBooks
    let displayName = "Apple Books"
    let iconName = "book"
    var accentColor: Color { Color("BrandAppleBooks") }
    
    let filterChangedNotification: Notification.Name = .appleBooksFilterChanged
    
    let hasFilterMenu = true
    let supportsHighlightColors = true
    let supportsSync = true
    let highlightColorTheme: HighlightColorTheme? = .appleBooks
    
    var sortKeyType: any SortKeyType.Type { BookListSortKey.self }
    let menuTitle: LocalizedStringKey = "Books"
}
```

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P5: 创建 DataSourceRegistry ⏱️ 约 30 分钟

**目标**: 创建注册表，集中管理所有数据源配置

**新建文件**: `Models/Core/DataSourceRegistry.swift`

```swift
import SwiftUI

/// 数据源注册表
/// 集中管理所有数据源的 UI 配置，消除 switch 语句
@MainActor
final class DataSourceRegistry {
    
    static let shared = DataSourceRegistry()
    
    /// 所有注册的数据源配置（按 ContentSource 索引）
    private var providers: [ContentSource: any DataSourceUIProvider] = [:]
    
    private init() {
        register(AppleBooksUIProvider())
        register(GoodLinksUIProvider())
        register(WeReadUIProvider())
        register(DedaoUIProvider())
        register(ChatsUIProvider())
    }
    
    /// 注册数据源配置
    func register(_ provider: any DataSourceUIProvider) {
        providers[provider.source] = provider
    }
    
    /// 获取数据源配置
    func provider(for source: ContentSource) -> (any DataSourceUIProvider)? {
        providers[source]
    }
    
    /// 获取所有已注册的数据源
    var allSources: [ContentSource] {
        Array(providers.keys).sorted { $0.rawValue < $1.rawValue }
    }
}

// MARK: - ContentSource 扩展（代理到 Registry）

extension ContentSource {
    /// 获取该数据源的 UI 配置
    var uiProvider: (any DataSourceUIProvider)? {
        DataSourceRegistry.shared.provider(for: self)
    }
    
    /// 筛选变更通知（从 uiProvider 获取，提供默认值）
    var filterChangedNotification: Notification.Name {
        uiProvider?.filterChangedNotification ?? Notification.Name("UnknownFilterChanged")
    }
    
    /// 高亮颜色主题（从 uiProvider 获取）
    var highlightColorTheme: HighlightColorTheme? {
        uiProvider?.highlightColorTheme
    }
}
```

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P6: 统一选择状态管理 ⏱️ 约 1 小时

**目标**: 用 `SelectionState` 类替代 5 个独立的选择变量

**新建文件**: `Models/Core/SelectionState.swift`

```swift
import SwiftUI

/// 统一选择状态管理器
/// 替代 MainListView 中的 5 个独立 @State 变量
@Observable
final class SelectionState {
    
    /// 每个数据源的选择状态
    private var selections: [ContentSource: Set<String>] = [:]
    
    /// 获取指定数据源的选择
    func selection(for source: ContentSource) -> Set<String> {
        selections[source] ?? []
    }
    
    /// 获取指定数据源选择的 Binding
    func selectionBinding(for source: ContentSource) -> Binding<Set<String>> {
        Binding(
            get: { self.selections[source] ?? [] },
            set: { self.selections[source] = $0 }
        )
    }
    
    /// 设置指定数据源的选择
    func setSelection(for source: ContentSource, ids: Set<String>) {
        selections[source] = ids
    }
    
    /// 清除所有选择
    func clearAll() {
        selections.removeAll()
    }
    
    /// 清除指定数据源的选择
    func clear(for source: ContentSource) {
        selections[source] = []
    }
    
    /// 当前数据源是否有单选
    func hasSingleSelection(for source: ContentSource) -> Bool {
        selection(for: source).count == 1
    }
    
    /// 获取当前数据源的选中数量
    func selectionCount(for source: ContentSource) -> Int {
        selection(for: source).count
    }
}
```

**修改文件**:
- `MainListView.swift` - 替换 5 个 @State 为 `@State var selectionState = SelectionState()`
- `MainListView+SyncRefresh.swift` - 使用 `selectionState.selection(for:)`
- `MainListView+DetailViews.swift` - 使用 `selectionState.selectionBinding(for:)`
- `SwipeableDataSourceContainer.swift` - 接收 `SelectionState` 而非 5 个 Binding

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P7: 重构 Switch 语句为协议调用 ⏱️ 约 2 小时

**目标**: 使用 `DataSourceRegistry` 和 `SelectionState` 消除大部分 switch 语句

**重构示例**:

**Before** (`MainListView+SyncRefresh.swift`):
```swift
func syncSelectedForCurrentSource() {
    switch contentSource {
    case .appleBooks:
        appleBooksVM.batchSync(bookIds: selectedBookIds, concurrency: ...)
    case .goodLinks:
        goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: ...)
    // ... 5 个 case
    }
}
```

**After**:
```swift
func syncSelectedForCurrentSource() {
    let selectedIds = selectionState.selection(for: contentSource)
    viewModel(for: contentSource)?.batchSync(ids: selectedIds, concurrency: ...)
}

// 需要统一 ViewModel 的 batchSync 接口
protocol BatchSyncable {
    func batchSync(ids: Set<String>, concurrency: Int)
}
```

**受影响文件**:
- `MainListView+SyncRefresh.swift` - 4 处 switch
- `MainListView+DetailViews.swift` - 1 处 switch
- `MainListView.swift` - 2 处 switch
- `SwipeableDataSourceContainer.swift` - 1 处 switch
- `ViewCommands.swift` - 2 处 switch

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

### P8: 重构 FilterMenus 为通用组件 ⏱️ 约 1.5 小时

**目标**: 创建通用的筛选菜单组件，消除重复代码

**新建文件**: `Views/Components/Controls/DataSourceFilterMenu.swift`

```swift
import SwiftUI

/// 通用数据源筛选菜单
/// 根据 DataSourceUIProvider 动态生成排序和筛选选项
struct DataSourceFilterMenu<SortKey: SortKeyType>: View {
    let provider: any DataSourceUIProvider
    @Binding var sortKey: SortKey
    @Binding var sortAscending: Bool
    var additionalFilters: (() -> AnyView)? = nil
    
    var body: some View {
        Menu(provider.menuTitle) {
            Section("Sort") {
                ForEach(Array(SortKey.allCases), id: \.self) { key in
                    Button {
                        sortKey = key
                        NotificationCenter.default.post(
                            name: provider.filterChangedNotification,
                            object: nil,
                            userInfo: ["sortKey": key.rawValue]
                        )
                    } label: {
                        if sortKey == key {
                            Label(key.displayName, systemImage: "checkmark")
                        } else {
                            Text(key.displayName)
                        }
                    }
                }
                
                Divider()
                
                Button {
                    sortAscending.toggle()
                    NotificationCenter.default.post(
                        name: provider.filterChangedNotification,
                        object: nil,
                        userInfo: ["sortAscending": sortAscending]
                    )
                } label: {
                    Label("Ascending", systemImage: sortAscending ? "checkmark" : "xmark")
                }
            }
            
            if let filters = additionalFilters {
                Section("Filter") {
                    filters()
                }
            }
        }
    }
}
```

**重构**:
- `ViewCommands.swift` - 使用 `DataSourceFilterMenu`
- `MainListView+FilterMenus.swift` - 使用 `DataSourceFilterMenu`

**验证**: `xcodebuild -scheme SyncNos -configuration Debug build`

---

## 实施顺序

```
P1 ✅ (已完成)
    ↓
P2 (统一枚举) → 验证
    ↓
P3 (协议定义) → 验证
    ↓
P4 (实现 Providers) → 验证
    ↓
P5 (Registry) → 验证
    ↓
P6 (SelectionState) → 验证
    ↓
P7 (重构 Switch) → 验证
    ↓
P8 (通用 FilterMenu) → 验证
```

---

## 破坏性变更清单

| 变更项 | 描述 | 影响 |
|--------|------|------|
| 删除 `SyncSource` | 统一使用 `ContentSource` | 所有使用 `SyncSource` 的文件 |
| 删除 5 个选择变量 | 统一为 `SelectionState` | `MainListView` 及其扩展 |
| 新增 `DataSourceUIProvider` | 协议驱动设计 | 新增文件，不破坏现有 |
| 新增 `DataSourceRegistry` | 注册表模式 | 新增文件 |
| 新增 `SelectionState` | 统一选择状态 | 替换现有变量 |

---

## 预期收益

完成后:
- ✅ **添加新数据源只需 1 个文件**: 新建 `XxxUIProvider.swift` 并注册
- ✅ **消除 80%+ 的 switch 语句**: 使用协议和注册表
- ✅ **统一选择状态管理**: 1 个类替代 5 个变量
- ✅ **类型安全**: 编译期检查，避免运行时错误
- ✅ **更好的可测试性**: 协议支持 Mock

---

## 风险评估

| 优先级 | 风险 | 影响范围 | 回滚难度 |
|--------|------|---------|---------|
| P2 | 中 | 全局类型替换 | 中等（Git 回滚） |
| P3-P5 | 低 | 新增文件 | 简单（删除文件） |
| P6 | 高 | MainListView 核心状态 | 复杂 |
| P7-P8 | 中 | UI 层重构 | 中等 |

---

**文档版本**: 2.0（破坏性重构版）  
**更新时间**: 2026-01-02  
**作者**: AI Assistant
