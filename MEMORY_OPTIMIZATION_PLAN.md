# SyncNos 内存优化计划 (Plan A)

## 目录

1. [问题分析](#问题分析)
2. [优先级总览](#优先级总览)
3. [P1 - 关键修复](#p1---关键修复)
4. [P2 - 重要改进](#p2---重要改进)
5. [P3 - 优化增强](#p3---优化增强)
6. [实施步骤](#实施步骤)

---

## 问题分析

### 当前架构内存管理问题

通过对 SyncNos 代码库的全面分析，发现以下内存管理问题：

#### 1. DetailViewModel 生命周期问题

**问题描述**：
- `AppleBooksDetailView`、`GoodLinksDetailView`、`WeReadDetailView`、`DedaoDetailView` 使用 `@StateObject` 创建 DetailViewModel
- 当用户切换书籍/文章时，旧的 ViewModel 数据没有被清理，导致内存累积
- 只有 `GoodLinksDetailViewModel` 实现了 `clear()` 方法

**影响范围**：
- `AppleBooksDetailViewModel` - 缺少数据清理
- `WeReadDetailViewModel` - 有 `allBookmarks` 但无清理
- `DedaoDetailViewModel` - 有 `allNotes` 但无清理
- `ChatViewModel` - 有 `conversations` 和 `paginationStates`，部分实现

#### 2. Combine 订阅未正确清理

**问题描述**：
- 大部分 ViewModel 使用 `cancellables: Set<AnyCancellable>` 存储订阅
- 但没有在适当时机（如 `deinit`）调用取消操作
- NotificationCenter 订阅可能导致循环引用

**影响范围**：
- 所有使用 Combine 的 ViewModel

#### 3. 分页数据累积

**问题描述**：
- 切换书籍时，之前加载的分页数据没有完全释放
- `AppleBooksDetailViewModel` 的 `session` 只在切换书籍时关闭，但 `highlights` 数组持续累积

**影响范围**：
- `AppleBooksDetailViewModel.highlights`
- `GoodLinksDetailViewModel.allFilteredHighlights` + `visibleHighlights`
- `WeReadDetailViewModel.filteredHighlights` + `visibleHighlights`
- `DedaoDetailViewModel.filteredHighlights` + `visibleHighlights`
- `ChatViewModel.paginationStates`

#### 4. Task 取消不完整

**问题描述**：
- 异步任务（`Task`）在视图销毁时可能仍在运行
- 只有 `AppleBooksDetailViewModel` 实现了 `currentLoadTask` 取消机制

**影响范围**：
- 所有发起网络请求或长时间运行任务的 ViewModel

#### 5. 大型数据结构持有

**问题描述**：
- `ChatViewModel.conversations: [UUID: ChatConversation]` 可能持有大量消息数据
- 书籍列表 ViewModel 持有完整的 `books` 和 `displayBooks` 副本

---

## 优先级总览

| 优先级 | 类别 | 影响程度 | 实现复杂度 |
|--------|------|----------|------------|
| **P1** | DetailViewModel 数据清理 | 高 | 低 |
| **P1** | 数据库 Session 关闭 | 高 | 低 |
| **P2** | Task 取消机制 | 中 | 中 |
| **P2** | 切换数据源时清理 | 中 | 中 |
| **P3** | 分页优化（滑动窗口） | 低 | 高 |
| **P3** | 缓存淘汰策略 | 低 | 高 |

---

## P1 - 关键修复

### P1.1 为所有 DetailViewModel 添加 `clear()` 方法

**目标**：确保切换书籍时释放旧数据

#### AppleBooksDetailViewModel

```swift
// 添加 clear() 方法
func clear() {
    currentLoadTask?.cancel()
    currentLoadTask = nil
    closeSession()
    highlights = []
    currentAssetId = nil
    currentOffset = 0
    expectedTotalCount = 0
    errorMessage = nil
    syncMessage = nil
    syncProgressText = nil
}
```

**修改位置**：`ViewModels/AppleBooks/AppleBooksDetailViewModel.swift`

#### WeReadDetailViewModel

```swift
// 添加/完善 clear() 方法
func clear() {
    currentBookId = nil
    allBookmarks = []
    filteredHighlights = []
    visibleHighlights = []
    currentPageCount = 0
    isLoading = false
    isLoadingMore = false
    isBackgroundSyncing = false
    syncProgressText = nil
    syncMessage = nil
}
```

**修改位置**：`ViewModels/WeRead/WeReadDetailViewModel.swift`

#### DedaoDetailViewModel

```swift
// 添加 clear() 方法
func clear() {
    currentBookId = nil
    allNotes = []
    filteredHighlights = []
    visibleHighlights = []
    currentPageCount = 0
    isLoading = false
    isLoadingMore = false
    isBackgroundSyncing = false
    syncProgressText = nil
    syncMessage = nil
}
```

**修改位置**：`ViewModels/Dedao/DedaoDetailViewModel.swift`

### P1.2 在 DetailView 切换时调用 clear()

**目标**：在 `onChange(of: selectedBookId)` 时清理旧数据

#### AppleBooksDetailView

```swift
.onChange(of: selectedBookId) { _, newId in
    // 先清理旧数据
    viewModel.clear()
    // 再加载新数据
    if let book = selectedBook {
        Task {
            await viewModel.resetAndLoadFirstPage(...)
        }
    }
}
```

#### WeReadDetailView

```swift
.onChange(of: selectedBookId) { _, _ in
    // 先清理旧数据
    detailViewModel.clear()
    // 再加载新数据
    if let book = selectedBook {
        Task {
            await detailViewModel.loadHighlights(for: book.bookId)
        }
    }
}
```

#### DedaoDetailView

```swift
.onChange(of: selectedBookId) { _, newId in
    // 先清理旧数据
    detailViewModel.clear()
    // 再加载新数据
    if let id = newId {
        Task {
            await detailViewModel.loadHighlights(for: id)
        }
    }
}
```

### P1.3 确保数据库 Session 正确关闭

**目标**：防止数据库连接泄漏

#### AppleBooksDetailViewModel

已有 `closeSession()` 和 `deinit` 处理，需确保 `clear()` 调用时也关闭：

```swift
func clear() {
    currentLoadTask?.cancel()
    currentLoadTask = nil
    closeSession()  // 确保关闭 session
    // ...
}
```

---

## P2 - 重要改进

### P2.1 为所有 ViewModel 添加 Task 取消机制

**目标**：在切换或销毁时取消正在进行的异步任务

#### WeReadDetailViewModel

```swift
// 添加任务引用
private var currentLoadTask: Task<Void, Never>?
private var currentSyncTask: Task<Void, Never>?

// 在 loadHighlights 中使用
func loadHighlights(for bookId: String) async {
    // 取消之前的加载任务
    currentLoadTask?.cancel()
    
    currentLoadTask = Task {
        // ... 加载逻辑
    }
    
    await currentLoadTask?.value
}

// 在 clear() 中取消
func clear() {
    currentLoadTask?.cancel()
    currentLoadTask = nil
    currentSyncTask?.cancel()
    currentSyncTask = nil
    // ...
}
```

#### DedaoDetailViewModel

同上模式。

### P2.2 切换数据源时清理其他数据源的数据

**目标**：在 MainListView 切换数据源时，清理不可见数据源的 DetailViewModel 数据

```swift
// MainListView.swift
.onChange(of: contentSourceRawValue) { oldValue, newValue in
    // 清除选择
    selectedBookIds.removeAll()
    selectedLinkIds.removeAll()
    selectedWeReadBookIds.removeAll()
    selectedDedaoBookIds.removeAll()
    keyboardNavigationTarget = .list
    currentDetailScrollView = nil
    
    // 注意：由于 DetailViewModel 是在 DetailView 中作为 @StateObject 创建的，
    // 当视图不显示时会自动释放。但为了更激进的内存释放，
    // 可以考虑将 DetailViewModel 提升到 MainListView 级别统一管理。
}
```

### P2.3 在 MainListView 中统一管理 DetailViewModel（可选重构）

**目标**：将 DetailViewModel 生命周期提升到父视图管理

这是一个较大的重构，可以使内存管理更集中：

```swift
struct MainListView: View {
    // 现有 StateObject
    @StateObject var appleBooksVM = AppleBooksViewModel()
    // ...
    
    // 新增：统一管理 DetailViewModel
    @StateObject var appleBooksDetailVM = AppleBooksDetailViewModel()
    @StateObject var goodLinksDetailVM = GoodLinksDetailViewModel()
    @StateObject var weReadDetailVM = WeReadDetailViewModel()
    @StateObject var dedaoDetailVM = DedaoDetailViewModel()
    
    // 切换数据源时清理
    .onChange(of: contentSourceRawValue) { oldValue, newValue in
        // 清理旧数据源的 DetailViewModel
        switch ContentSource(rawValue: oldValue) {
        case .appleBooks:
            appleBooksDetailVM.clear()
        case .goodLinks:
            goodLinksDetailVM.clear()
        case .weRead:
            weReadDetailVM.clear()
        case .dedao:
            dedaoDetailVM.clear()
        default:
            break
        }
        // ...
    }
}
```

---

## P3 - 优化增强

### P3.1 分页数据滑动窗口

**目标**：只保留当前可见范围附近的数据，释放远离视口的数据

```swift
// 滑动窗口配置
struct PaginationWindowConfig {
    static let windowSize = 200  // 保留的最大条目数
    static let preloadThreshold = 20  // 预加载阈值
}

// 在加载更多时检查并修剪
func trimDataIfNeeded() {
    if visibleHighlights.count > PaginationWindowConfig.windowSize {
        // 移除最早加载的数据
        let trimCount = visibleHighlights.count - PaginationWindowConfig.windowSize
        visibleHighlights.removeFirst(trimCount)
    }
}
```

### P3.2 ChatViewModel 对话数据缓存淘汰

**目标**：限制内存中保留的对话消息数量

```swift
// ChatViewModel.swift
private let maxCachedConversations = 5  // 最多缓存 5 个对话的消息

func loadMessages(for contactId: UUID, reset: Bool) async {
    // 加载新对话时，检查是否需要淘汰旧对话
    if paginationStates.count > maxCachedConversations {
        evictOldestConversation()
    }
    // ...
}

private func evictOldestConversation() {
    // 找到最久未访问的对话并清除其消息
    // 保留 conversations 的元数据，只清除 paginationStates
}
```

### P3.3 列表 ViewModel 大数据优化

**目标**：优化 `books` 和 `displayBooks` 的内存使用

```swift
// 考虑使用 lazy 计算或分片存储
// 当前实现已经有 visibleBooks 分页机制，可以进一步优化 displayBooks 的生成
```

---

## 实施步骤

### 阶段 1：P1 实施（关键修复）

1. **Step 1.1**: 为 `AppleBooksDetailViewModel` 添加 `clear()` 方法
2. **Step 1.2**: 为 `WeReadDetailViewModel` 添加 `clear()` 方法
3. **Step 1.3**: 为 `DedaoDetailViewModel` 添加 `clear()` 方法
4. **Step 1.4**: 在各 DetailView 的 `onChange(of: selectedBookId)` 中调用 `clear()`
5. **Step 1.5**: 验证构建成功

### 阶段 2：P2 实施（重要改进）

1. **Step 2.1**: 为 `WeReadDetailViewModel` 添加 Task 取消机制
2. **Step 2.2**: 为 `DedaoDetailViewModel` 添加 Task 取消机制
3. **Step 2.3**: 验证构建成功

### 阶段 3：P3 实施（优化增强）

1. **Step 3.1**: 实现 ChatViewModel 对话缓存淘汰
2. **Step 3.2**: 验证构建成功

---

## 验证方法

### 内存监控

1. 使用 Xcode Instruments 的 Allocations 工具
2. 监控切换书籍/数据源时的内存变化
3. 确认旧数据被正确释放

### 功能测试

1. 切换书籍后，确认新数据正确加载
2. 切换数据源后，返回原数据源，确认数据可重新加载
3. 同步功能正常工作

---

## 风险评估

| 变更 | 风险等级 | 缓解措施 |
|------|----------|----------|
| 添加 clear() 方法 | 低 | 方法简单，只清理数据 |
| 修改 onChange 调用 | 低 | 只是添加 clear() 调用 |
| Task 取消机制 | 中 | 需要仔细处理取消后的状态 |
| 数据源切换清理 | 中 | 确保返回时能正确重新加载 |
| 分页滑动窗口 | 高 | 需要处理用户快速滚动场景 |

---

## 总结

本计划采用渐进式优化策略：

1. **P1（关键修复）**：最小改动，最大收益，低风险
2. **P2（重要改进）**：中等改动，提升稳定性
3. **P3（优化增强）**：可选实施，进一步优化

预计 P1 完成后可解决 70% 的内存问题，P2 完成后可达到 90% 的优化效果。

---

## 实施状态

### ✅ 已完成

#### P1 - 关键修复
- [x] `AppleBooksDetailViewModel` - 添加 `clear()` 方法，关闭 session 并释放数据
- [x] `WeReadDetailViewModel` - 添加 `clear()` 方法，释放 allBookmarks 和状态
- [x] `DedaoDetailViewModel` - 添加 `clear()` 方法，释放 allNotes 和状态
- [x] `GoodLinksDetailViewModel` - 增强 `clear()` 方法，包含 loading/syncing 状态重置
- [x] 所有 DetailView 在切换书籍时调用 `clear()` 或 `resetAndLoadFirstPage()`

#### P2 - 重要改进
- [x] `WeReadDetailViewModel` - 添加 `currentLoadTask` 管理异步任务
- [x] `DedaoDetailViewModel` - 添加 `currentLoadTask` 管理异步任务
- [x] 在 `loadHighlights` 方法中取消之前的任务
- [x] 在 `performBackgroundSync` 和 `fullFetchFromAPI` 中添加 `Task.isCancelled` 检查
- [x] 后台同步任务在切换书籍时可正确取消

#### P3 - 优化增强
- [x] `ChatViewModel` - 添加 `maxCachedConversations` 配置（默认 5 个）
- [x] 实现 LRU 缓存淘汰策略
- [x] 跟踪对话访问时间 (`conversationAccessTime`)
- [x] 在加载新对话时自动淘汰最久未访问的对话消息

### 🔄 未实施（可选）

#### P2.3 - 统一 DetailViewModel 管理
- [ ] 将 DetailViewModel 提升到 MainListView 统一管理（较大重构，暂缓）

#### P3.1 - 分页数据滑动窗口
- [ ] 实现滑动窗口限制分页数据量（复杂度高，暂缓）

#### P3.3 - 列表 ViewModel 优化
- [ ] 优化 `books` 和 `displayBooks` 内存使用（低优先级）

---

## 更新日志

- **2024-XX-XX**: 初始实施 P1、P2、P3 核心功能
- 添加 `clear()` 方法到所有 DetailViewModel
- 添加 Task 取消机制
- 添加 ChatViewModel LRU 缓存淘汰
