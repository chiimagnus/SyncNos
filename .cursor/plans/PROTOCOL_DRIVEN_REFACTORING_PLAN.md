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

**完成内容**:
- 定义了 42+ 个统一的通知名称常量
- 更新了 40+ 个文件，替换所有硬编码的 `Notification.Name("...")`
- 删除了 `Views/Chats/ChatNotifications.swift`（已合并到 NotificationNames.swift）
- 更新了相关文档（键盘导航技术文档、添加新数据源完整指南）

---

### P2: 统一 ContentSource 和 SyncSource ✅ 已完成

**目标**: 删除 `SyncSource` 枚举，统一使用 `ContentSource`

**完成内容**:
- ✅ 在 `ContentSource` 中添加了 `brandBackgroundOpacity`、`iconName`、`brandColor` 属性
- ✅ 删除了 `SyncSource` 枚举（原 `typealias SyncSource = ContentSource` 过渡方案已移除）
- ✅ 更新了 `SyncQueueTask` 使用 `ContentSource`
- ✅ 更新了所有 AutoSyncProvider 使用 `ContentSource`
- ✅ 更新了 `AutoSyncService` 中的 providers 字典类型

**受影响文件**:
- `Models/Sync/SyncQueueModels.swift` - 删除 SyncSource typealias，修改 SyncQueueTask
- `Models/Core/Models.swift` - 添加 brandBackgroundOpacity、iconName、brandColor
- `Services/SyncScheduling/AutoSyncService.swift` - 更新类型引用
- `Services/SyncScheduling/*AutoSyncProvider.swift` - 更新类型引用
- `Views/Components/Controls/SyncQueueView.swift` - 更新类型引用

---

### P3: 创建 DataSourceUIProvider 协议 ✅ 已完成

**目标**: 定义数据源 UI 配置的统一接口

**完成内容**:
- ✅ 创建了 `Models/Core/DataSourceUIProvider.swift`
- ✅ 定义了 `DataSourceUIProvider` 协议（source, displayName, iconName, accentColor, filterChangedNotification, hasFilterMenu, supportsHighlightColors, supportsSync, highlightSource, menuTitle）
- ✅ 定义了 `SortKeyType` 协议并扩展到 `BookListSortKey` 和 `GoodLinksSortKey`
- ✅ 创建了 `NoSortKey` 空排序键

---

### P4: 实现各数据源的 UIProvider ✅ 已完成

**目标**: 为每个数据源创建 UIProvider 实现

**完成内容**:
- ✅ 创建了 `Models/DataSourceProviders/` 目录
- ✅ `AppleBooksUIProvider.swift` - Apple Books UI 配置
- ✅ `GoodLinksUIProvider.swift` - GoodLinks UI 配置
- ✅ `WeReadUIProvider.swift` - 微信读书 UI 配置
- ✅ `DedaoUIProvider.swift` - 得到 UI 配置
- ✅ `ChatsUIProvider.swift` - 对话截图 UI 配置

---

### P5: 创建 DataSourceRegistry ✅ 已完成

**目标**: 创建注册表，集中管理所有数据源配置

**完成内容**:
- ✅ 创建了 `Models/Core/DataSourceRegistry.swift`
- ✅ 实现了单例注册表 `DataSourceRegistry.shared`
- ✅ 注册了所有 5 个 UIProvider
- ✅ 添加了 `ContentSource.uiProvider` 扩展

---

### P6: 统一选择状态管理 ✅ 已完成

**目标**: 用 `SelectionState` 类替代 5 个独立的选择变量

**完成内容**:
- ✅ 创建了 `Models/Core/SelectionState.swift`
- ✅ 实现了 `@Observable` 的 `SelectionState` 类
- ✅ 提供了 `selection(for:)`, `selectionBinding(for:)`, `setSelection(for:ids:)` 等方法
- ✅ 提供了辅助方法：`hasSingleSelection`, `selectionCount`, `singleSelectedId`, `hasSelection`

**✅ 集成工作已完成（P6-Integration）**:

已完成以下文件的重构：
- ✅ `MainListView.swift` - 替换 5 个 @State 为 `@State var selectionState = SelectionState()`
- ✅ `MainListView+SyncRefresh.swift` - 使用 `selectionState.selection(for:)`
- ✅ `MainListView+DetailViews.swift` - 使用 `selectionState.selectionBinding(for:)` 和相关方法
- ✅ `MainListView+KeyboardMonitor.swift` - 使用 `selectionState.hasSingleSelection(for:)`（从 12 行 switch 简化为 1 行）
- ✅ `SwipeableDataSourceContainer.swift` - 接收 `SelectionState` 替代 5 个 Binding

**重构收益**:
- 减少了约 50 行重复的选择状态代码
- 消除了 3 处数据源相关的 switch 语句
- 统一的选择状态 API，便于后续扩展

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
P2 ✅ (已完成 - 统一枚举)
    ↓
P3 ✅ (已完成 - 协议定义)
    ↓
P4 ✅ (已完成 - 实现 Providers)
    ↓
P5 ✅ (已完成 - Registry)
    ↓
P6 ✅ (已完成 - SelectionState 类及集成)
    ↓
P7 ⏳ (待完成 - 重构 Switch)
    ↓
P8 ⏳ (待完成 - 通用 FilterMenu)
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

**文档版本**: 2.1  
**更新时间**: 2026-01-02  
**作者**: AI Assistant

---

## 变更日志

### 2026-01-02 (v2.1)
- ✅ 完成 P2: 删除 `SyncSource` 枚举，统一到 `ContentSource`
- ✅ 完成 P3: 创建 `DataSourceUIProvider` 协议
- ✅ 完成 P4: 实现 5 个 UIProvider（AppleBooks, GoodLinks, WeRead, Dedao, Chats）
- ✅ 完成 P5: 创建 `DataSourceRegistry` 注册表
- ✅ 完成 P6: 创建 `SelectionState` 类并集成到 MainListView
  - 替换 `MainListView` 中 5 个独立的选择状态变量为统一的 `SelectionState`
  - 更新 `MainListView+SyncRefresh.swift`、`MainListView+DetailViews.swift`、`MainListView+KeyboardMonitor.swift`
  - 更新 `SwipeableDataSourceContainer.swift` 接收 `SelectionState` 替代 5 个 Binding

### 新增文件
- `Models/Core/DataSourceUIProvider.swift`
- `Models/Core/DataSourceRegistry.swift`
- `Models/Core/SelectionState.swift`
- `Models/DataSourceProviders/AppleBooksUIProvider.swift`
- `Models/DataSourceProviders/GoodLinksUIProvider.swift`
- `Models/DataSourceProviders/WeReadUIProvider.swift`
- `Models/DataSourceProviders/DedaoUIProvider.swift`
- `Models/DataSourceProviders/ChatsUIProvider.swift`

### 修改文件（P6-Integration）
- `Views/Components/Main/MainListView.swift`
- `Views/Components/Main/MainListView+SyncRefresh.swift`
- `Views/Components/Main/MainListView+DetailViews.swift`
- `Views/Components/Main/MainListView+KeyboardMonitor.swift`
- `Views/Components/Controls/SwipeableDataSourceContainer.swift`
