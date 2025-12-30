# DetailView 内存释放优化方案 (Plan A)

> 目标：优化 DetailView 的内存管理，确保切换书籍/对话时能够及时释放内存，同时不影响 Notion 同步功能。

## 📊 现状分析

### 已有良好实践（可复用）

| 数据源 | 实现亮点 |
|--------|----------|
| **Chats** | ✅ `unloadMessages(for:)` + `unloadAllMessages(except:)` 模式 |
| **Chats** | ✅ `paginationLoadTokens` 防串台机制 |
| **Chats** | ✅ `.onDisappear` 中调用 `unloadAllMessages` 激进释放 |
| **AppleBooks** | ✅ `currentLoadId` 防串台 + `closeSession()` 关闭数据库会话 |
| **AppleBooks** | ✅ `resetAndLoadFirstPage` 中 `removeAll(keepingCapacity: false)` |
| **WeRead/Dedao** | ✅ 切换书籍时检查 `currentBookId` 避免重复加载 |
| **GoodLinks** | ✅ `clear()` 方法取消任务 + 释放数据 |

### 需要改进的问题

| 问题 | 影响数据源 | 优先级 |
|------|------------|--------|
| DetailViewModel 无统一 `clear()` / `release()` 方法 | AppleBooks, WeRead, Dedao | P1 |
| WeRead/Dedao 切换书籍时不清空旧数据（仅跳过重复加载） | WeRead, Dedao | P1 |
| DetailView `.onDisappear` 未调用 ViewModel 释放方法 | AppleBooks, WeRead, Dedao | P1 |
| GoodLinks 全文内容 (`content`) 可能很大，折叠时仍常驻 | GoodLinks | P2 |
| 部分 ViewModel 缺少后台任务取消逻辑 | WeRead, Dedao | P2 |
| `layoutWidthDebounceTask` 在 `onDisappear` 中取消，但 ViewModel 任务未取消 | All | P2 |
| 重复的 Notification 订阅代码 | AppleBooks, GoodLinks, WeRead, Dedao | P3 |
| 重复的筛选/排序逻辑代码 | AppleBooks, GoodLinks, WeRead, Dedao | P3 |

---

## 🚀 优化计划

### P1: 统一 DetailViewModel 清理方法（最高优先级）

**目标**：确保每个 DetailViewModel 都有 `clear()` 方法，并在以下时机调用：
1. 切换到新书籍/对话时
2. DetailView `onDisappear` 时

**改动清单**：

#### 1.1 AppleBooksDetailViewModel - 添加 `clear()` 方法

```swift
// 在 AppleBooksDetailViewModel 中添加：
func clear() {
    // 取消正在进行的加载任务
    currentLoadTask?.cancel()
    currentLoadTask = nil
    currentLoadId = UUID()  // 失效旧加载
    
    // 关闭数据库会话
    closeSession()
    
    // 释放数据（不保留容量）
    highlights.removeAll(keepingCapacity: false)
    currentAssetId = nil
    currentOffset = 0
    expectedTotalCount = 0
    isLoadingPage = false
    
    // 清空同步状态
    syncProgressText = nil
    syncMessage = nil
    isSyncing = false
}
```

#### 1.2 WeReadDetailViewModel - 添加 `clear()` 方法

```swift
// 在 WeReadDetailViewModel 中添加：
func clear() {
    currentBookId = nil
    
    // 释放数据（不保留容量）
    allHighlights.removeAll(keepingCapacity: false)
    filteredHighlights.removeAll(keepingCapacity: false)
    visibleHighlights.removeAll(keepingCapacity: false)
    currentPageCount = 0
    
    // 重置状态
    isLoading = false
    isLoadingMore = false
    isBackgroundSyncing = false
    
    // 清空同步状态
    syncProgressText = nil
    syncMessage = nil
    isSyncing = false
}
```

#### 1.3 DedaoDetailViewModel - 添加 `clear()` 方法

```swift
// 在 DedaoDetailViewModel 中添加：
func clear() {
    currentBookId = nil
    
    // 释放数据（不保留容量）
    allHighlights.removeAll(keepingCapacity: false)
    filteredHighlights.removeAll(keepingCapacity: false)
    visibleHighlights.removeAll(keepingCapacity: false)
    currentPageCount = 0
    
    // 重置状态
    isLoading = false
    isLoadingMore = false
    isBackgroundSyncing = false
    
    // 清空同步状态
    syncProgressText = nil
    syncMessage = nil
    isSyncing = false
}
```

#### 1.4 DetailView 调用 `clear()` 的时机

在各 DetailView 中：

```swift
// AppleBooksDetailView
.task(id: selectedBookId) {
    viewModel.clear()  // 新增：切换前先清理
    guard let id = selectedBookId, ... else { return }
    await viewModel.resetAndLoadFirstPage(...)
}
.onDisappear {
    viewModel.clear()  // 新增：退出时清理
    layoutWidthDebounceTask?.cancel()
}

// WeReadDetailView
.task(id: selectedBookId) {
    detailViewModel.clear()  // 新增
    guard let id = selectedBookId, ... else { return }
    await detailViewModel.loadHighlights(for: ...)
}
.onDisappear {
    detailViewModel.clear()  // 新增
    layoutWidthDebounceTask?.cancel()
}

// DedaoDetailView
.task(id: selectedBookId) {
    detailViewModel.clear()  // 新增（在 loadHighlights 之前）
    guard let id = selectedBookId, ... else { return }
    await detailViewModel.loadHighlights(for: ...)
}
// cleanupOnDisappear() 中添加 detailViewModel.clear()
```

---

### P2: 后台任务取消与防串台保护

**目标**：确保后台任务在切换书籍时被正确取消，旧任务结果不会回写到新状态。

#### 2.1 WeReadDetailViewModel - 添加任务取消逻辑

```swift
// 添加任务引用
private var backgroundSyncTask: Task<Void, Never>?
private var currentLoadToken: UUID = UUID()

// 修改 loadHighlights
func loadHighlights(for bookId: String) async {
    // 生成新 token，使旧任务失效
    let loadToken = UUID()
    currentLoadToken = loadToken
    
    // 取消正在进行的后台同步
    backgroundSyncTask?.cancel()
    backgroundSyncTask = nil
    
    guard !Task.isCancelled else { return }
    
    // 如果是新书籍，清空旧数据
    if currentBookId != bookId {
        clear()
    }
    
    currentBookId = bookId
    isLoading = true
    
    // ... 加载逻辑 ...
    
    // 每次 await 后检查 token
    guard !Task.isCancelled, currentLoadToken == loadToken else { return }
}

// 修改 clear() 添加任务取消
func clear() {
    backgroundSyncTask?.cancel()
    backgroundSyncTask = nil
    currentLoadToken = UUID()  // 失效旧加载
    // ... 其他清理逻辑 ...
}
```

#### 2.2 DedaoDetailViewModel - 添加任务取消逻辑

同 WeReadDetailViewModel 模式。

---

### P3: 删除冗余代码，统一模式

**目标**：减少重复代码，提高可维护性。

#### 3.1 统一 Notification 订阅模式

各 DetailViewModel 中的 `HighlightSortChanged` 和 `HighlightFilterChanged` 订阅代码几乎相同，可提取为：

```swift
// 在 Services/Core/Protocols.swift 或新文件中添加
protocol HighlightFilterObservable: AnyObject {
    var sortField: HighlightSortField { get set }
    var isAscending: Bool { get set }
    var noteFilter: NoteFilter { get set }
    var selectedStyles: Set<Int> { get set }
    
    func reloadAfterFilterChange() async
}

extension HighlightFilterObservable {
    func setupHighlightNotificationSubscriptions(store: inout Set<AnyCancellable>) {
        NotificationCenter.default.publisher(for: Notification.Name("HighlightSortChanged"))
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let keyRaw = userInfo["sortKey"] as? String,
                   let k = HighlightSortField(rawValue: keyRaw) {
                    self.sortField = k
                }
                if let asc = userInfo["sortAscending"] as? Bool {
                    self.isAscending = asc
                }
                Task { await self.reloadAfterFilterChange() }
            }
            .store(in: &store)
        
        NotificationCenter.default.publisher(for: Notification.Name("HighlightFilterChanged"))
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let hasNotes = userInfo["hasNotes"] as? Bool {
                    self.noteFilter = hasNotes
                }
                if let styles = userInfo["selectedStyles"] as? [Int] {
                    self.selectedStyles = Set(styles)
                }
                Task { await self.reloadAfterFilterChange() }
            }
            .store(in: &store)
    }
}
```

> **决策**：此优化可选，P3 优先级。如果时间有限，可先完成 P1 和 P2。

#### 3.2 删除未使用的兼容代码

在 `WeReadDetailViewModel` 中：

```swift
// 这个 extension 可以删除，因为 visibleHighlights 已经是分页后的数据
// MARK: - Legacy Compatibility
extension WeReadDetailViewModel {
    /// 兼容旧代码：返回所有高亮（不推荐使用，应使用 visibleHighlights）
    var highlights: [WeReadHighlightDisplay] {
        visibleHighlights
    }
}
```

---

## ✅ 验证清单

### 每个 P 完成后验证：

1. **编译成功**：`xcodebuild -scheme SyncNos -configuration Debug build`
2. **切换书籍**：观察内存是否下降
3. **Notion 同步**：确保同步功能正常工作
4. **退出 DetailView**：观察内存是否释放

### 具体测试场景：

- [ ] Apple Books: 选中书籍 A → 选中书籍 B → 确认 A 的高亮数据已释放
- [ ] GoodLinks: 选中文章 A → 选中文章 B → 确认 A 的全文内容已释放
- [ ] WeRead: 选中书籍 A → 选中书籍 B → 确认 A 的高亮数据已释放
- [ ] Dedao: 选中书籍 A → 选中书籍 B → 确认 A 的高亮数据已释放
- [ ] Chats: 选中对话 A → 选中对话 B → 确认 A 的消息已释放（已有实现）
- [ ] 所有数据源：同步到 Notion 功能正常

---

## 📋 实施顺序

1. **P1.1**: AppleBooksDetailViewModel 添加 `clear()` + View 调用
2. **P1.2**: WeReadDetailViewModel 添加 `clear()` + View 调用
3. **P1.3**: DedaoDetailViewModel 添加 `clear()` + View 调用
4. **P1.4**: GoodLinksDetailViewModel 验证现有 `clear()` 实现
5. **Build 验证**: 确保编译通过
6. **P2.1**: WeReadDetailViewModel 添加任务取消逻辑
7. **P2.2**: DedaoDetailViewModel 添加任务取消逻辑
8. **Build 验证**: 确保编译通过
9. **P3.1**: 删除冗余兼容代码（可选）
10. **最终验证**: 全面测试

---

## 🔒 安全边界

**不修改**：
- Notion 同步引擎 (`NotionSyncEngine`)
- Notion 适配器 (`*NotionAdapter`)
- 列表 ViewModel (`AppleBooksViewModel`, `GoodLinksViewModel` 等)
- 缓存服务 (`*CacheService`)

**只修改**：
- DetailViewModel 类
- DetailView 文件

---

## 📝 附注

### 关于 GoodLinks 全文内容

GoodLinks 的 `content` 字段可能包含非常大的文章全文。当前实现在切换文章时会通过 `clear()` 释放。如果未来需要进一步优化，可以考虑：

1. 折叠全文时释放内容，展开时重新加载
2. 使用 lazy loading 模式，仅在展开时加载全文

这些属于 P2 或更低优先级的优化。

### 关于 Chats

Chats 数据源已经实现了完善的内存释放机制：
- `unloadMessages(for:)` 卸载指定对话的消息
- `unloadAllMessages(except:)` 卸载所有消息（可保留一个）
- `paginationLoadTokens` 防止串台

其他数据源可参考 Chats 的实现模式。
