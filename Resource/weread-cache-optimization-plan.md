# WeRead 本地缓存优化方案

## 一、现状分析

### 1.1 当前架构

```
WeRead API → WeReadAPIService → WeReadViewModel → UI
                                    ↓
                              (内存中的数据)
```

**核心问题：**
1. **无本地持久化**：所有数据仅存在于内存，关闭应用后丢失
2. **每次都全量拉取**：打开应用或切换页面时，必须重新从 API 获取所有数据
3. **无增量同步机制**：WeRead API 支持 `synckey` 增量同步，但当前未利用
4. **重度用户性能问题**：300 本书 × 1000 条高亮 = 30 万条数据，每次启动都要拉取

### 1.2 当前数据流

```
1. WeReadViewModel.loadBooks()
   └── apiService.fetchNotebooks()          // 拉取书籍列表
       └── 对每本书 fetchBookmarks(bookId)   // 拉取高亮数量
   
2. WeReadDetailViewModel.loadHighlights(bookId)
   └── apiService.fetchMergedHighlights()   // 拉取高亮+想法
       ├── fetchBookmarks(bookId)
       └── fetchReviews(bookId)
```

### 1.3 API 响应结构分析（来自日志）

```json
// /api/user/notebook 响应
{
  "synckey": 1763747972,    // ← 可用于增量同步
  "totalBookCount": 2,
  "books": [...]
}

// /web/book/bookmarklist 响应
{
  "synckey": 1234567890,    // ← 可用于增量同步
  "updated": [...],         // 新增/更新的高亮
  "removed": [...]          // 已删除的高亮ID
}
```

---

## 二、优化目标

### 2.1 核心目标
1. **本地缓存**：使用 SwiftData 持久化书籍列表和高亮数据
2. **增量同步**：利用 `synckey` 只拉取变更数据
3. **离线访问**：无网络时可查看已缓存的数据
4. **性能优化**：重度用户（300 书/30 万高亮）场景下，启动时间 < 3 秒

### 2.2 性能指标
| 场景 | 当前 | 目标 |
|------|------|------|
| 首次启动（300书） | ~60s | < 30s（后台拉取） |
| 再次启动（有缓存） | ~60s | < 1s |
| 增量同步（10 条新高亮） | ~60s | < 2s |
| 详情页加载（1000高亮） | ~3s | < 0.5s |

---

## 三、技术方案

### 3.1 数据模型设计（SwiftData）

```swift
// Models/WeRead/WeReadCacheModels.swift

import SwiftData

/// 缓存的书籍元数据
@Model
final class CachedWeReadBook {
    @Attribute(.unique) var bookId: String
    var title: String
    var author: String
    var cover: String?
    var category: String?
    var highlightCount: Int
    var reviewCount: Int
    var createdAt: Date?
    var updatedAt: Date?
    
    // 同步元数据
    var lastFetchedAt: Date?
    var bookmarksSyncKey: Int?  // 用于高亮增量同步
    
    // 关系
    @Relationship(deleteRule: .cascade, inverse: \CachedWeReadHighlight.book)
    var highlights: [CachedWeReadHighlight]?
    
    init(bookId: String, title: String, author: String) {
        self.bookId = bookId
        self.title = title
        self.author = author
        self.highlightCount = 0
        self.reviewCount = 0
    }
}

/// 缓存的高亮/笔记
@Model
final class CachedWeReadHighlight {
    @Attribute(.unique) var highlightId: String
    var bookId: String
    var text: String
    var note: String?
    var chapterTitle: String?
    var colorIndex: Int?
    var createdAt: Date?
    var range: String?
    
    // 关联的想法内容（JSON 数组）
    var reviewContentsJSON: String?
    
    // 关系
    var book: CachedWeReadBook?
    
    // 计算属性
    var reviewContents: [String] {
        get {
            guard let json = reviewContentsJSON,
                  let data = json.data(using: .utf8),
                  let array = try? JSONDecoder().decode([String].self, from: data) else {
                return []
            }
            return array
        }
        set {
            if let data = try? JSONEncoder().encode(newValue),
               let json = String(data: data, encoding: .utf8) {
                reviewContentsJSON = json
            }
        }
    }
    
    init(highlightId: String, bookId: String, text: String) {
        self.highlightId = highlightId
        self.bookId = bookId
        self.text = text
    }
}

/// 全局同步状态
@Model
final class WeReadSyncState {
    @Attribute(.unique) var id: String = "global"
    var notebookSyncKey: Int?
    var lastFullSyncAt: Date?
    var lastIncrementalSyncAt: Date?
    
    init() {}
}
```

### 3.2 缓存服务设计

```swift
// Services/DataSources-From/WeRead/WeReadCacheService.swift

import SwiftData

/// WeRead 本地缓存服务协议
protocol WeReadCacheServiceProtocol: AnyObject {
    // 书籍操作
    func getAllBooks() async throws -> [CachedWeReadBook]
    func getBook(bookId: String) async throws -> CachedWeReadBook?
    func saveBooks(_ books: [WeReadNotebook]) async throws
    func updateBookHighlightCount(bookId: String, count: Int) async throws
    
    // 高亮操作
    func getHighlights(bookId: String) async throws -> [CachedWeReadHighlight]
    func saveHighlights(_ highlights: [WeReadBookmark], bookId: String) async throws
    func deleteHighlights(ids: [String]) async throws
    
    // 同步状态
    func getSyncState() async throws -> WeReadSyncState
    func updateSyncState(notebookSyncKey: Int?, lastSyncAt: Date?) async throws
    func getBookSyncKey(bookId: String) async throws -> Int?
    func updateBookSyncKey(bookId: String, syncKey: Int) async throws
    
    // 清理
    func clearAllCache() async throws
}

/// WeRead 本地缓存服务实现
@MainActor
final class WeReadCacheService: WeReadCacheServiceProtocol {
    private let modelContainer: ModelContainer
    private let logger: LoggerServiceProtocol
    
    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) throws {
        let schema = Schema([
            CachedWeReadBook.self,
            CachedWeReadHighlight.self,
            WeReadSyncState.self
        ])
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false,
            allowsSave: true
        )
        self.modelContainer = try ModelContainer(
            for: schema,
            configurations: [modelConfiguration]
        )
        self.logger = logger
    }
    
    // ... 实现方法
}
```

### 3.3 增量同步策略

```swift
// Services/DataSources-From/WeRead/WeReadIncrementalSyncService.swift

/// WeRead 增量同步服务
final class WeReadIncrementalSyncService {
    private let apiService: WeReadAPIServiceProtocol
    private let cacheService: WeReadCacheServiceProtocol
    private let logger: LoggerServiceProtocol
    
    /// 同步书籍列表（增量）
    func syncNotebooks() async throws -> SyncResult {
        // 1. 获取本地 synckey
        let state = try await cacheService.getSyncState()
        let localSyncKey = state.notebookSyncKey ?? 0
        
        // 2. 调用 API（带 synckey）
        let response = try await apiService.fetchNotebooksIncremental(syncKey: localSyncKey)
        
        // 3. 如果 synckey 相同，无需更新
        if response.syncKey == localSyncKey && response.updated.isEmpty {
            logger.info("[WeRead] Notebooks up to date, no changes")
            return .noChanges
        }
        
        // 4. 保存新增/更新的书籍
        if !response.updated.isEmpty {
            try await cacheService.saveBooks(response.updated)
        }
        
        // 5. 删除已移除的书籍
        if let removed = response.removed, !removed.isEmpty {
            try await cacheService.deleteBooks(ids: removed)
        }
        
        // 6. 更新 synckey
        try await cacheService.updateSyncState(
            notebookSyncKey: response.syncKey,
            lastSyncAt: Date()
        )
        
        return .updated(added: response.updated.count, removed: response.removed?.count ?? 0)
    }
    
    /// 同步单本书的高亮（增量）
    func syncHighlights(bookId: String) async throws -> SyncResult {
        // 1. 获取本地 synckey
        let localSyncKey = try await cacheService.getBookSyncKey(bookId: bookId) ?? 0
        
        // 2. 调用 API（带 synckey）
        let response = try await apiService.fetchBookmarksIncremental(
            bookId: bookId,
            syncKey: localSyncKey
        )
        
        // 3. 如果 synckey 相同，无需更新
        if response.syncKey == localSyncKey && response.updated.isEmpty {
            logger.info("[WeRead] Highlights for \(bookId) up to date")
            return .noChanges
        }
        
        // 4. 保存新增/更新的高亮
        if !response.updated.isEmpty {
            try await cacheService.saveHighlights(response.updated, bookId: bookId)
        }
        
        // 5. 删除已移除的高亮
        if let removed = response.removed, !removed.isEmpty {
            try await cacheService.deleteHighlights(ids: removed)
        }
        
        // 6. 更新 synckey
        try await cacheService.updateBookSyncKey(bookId: bookId, syncKey: response.syncKey)
        
        return .updated(added: response.updated.count, removed: response.removed?.count ?? 0)
    }
}

enum SyncResult {
    case noChanges
    case updated(added: Int, removed: Int)
}
```

### 3.4 API 服务扩展

```swift
// 扩展 WeReadAPIServiceProtocol
protocol WeReadAPIServiceProtocol: AnyObject {
    // 现有方法...
    
    // 新增：增量同步方法
    func fetchNotebooksIncremental(syncKey: Int) async throws -> NotebooksIncrementalResponse
    func fetchBookmarksIncremental(bookId: String, syncKey: Int) async throws -> BookmarksIncrementalResponse
}

// 响应模型
struct NotebooksIncrementalResponse {
    let syncKey: Int
    let updated: [WeReadNotebook]
    let removed: [String]?
}

struct BookmarksIncrementalResponse {
    let syncKey: Int
    let updated: [WeReadBookmark]
    let removed: [String]?
}
```

### 3.5 ViewModel 改造

```swift
// ViewModels/WeRead/WeReadViewModel.swift

@MainActor
final class WeReadViewModel: ObservableObject {
    @Published var books: [WeReadBookListItem] = []
    @Published var isLoading: Bool = false
    @Published var isSyncing: Bool = false  // 后台增量同步中
    @Published var lastSyncAt: Date?
    
    private let cacheService: WeReadCacheServiceProtocol
    private let syncService: WeReadIncrementalSyncService
    private let apiService: WeReadAPIServiceProtocol
    
    /// 加载书籍（优先从缓存，后台增量同步）
    func loadBooks() async {
        isLoading = true
        
        // 1. 先从缓存加载（快速显示）
        do {
            let cachedBooks = try await cacheService.getAllBooks()
            if !cachedBooks.isEmpty {
                books = cachedBooks.map { WeReadBookListItem(from: $0) }
                isLoading = false
                logger.info("[WeRead] Loaded \(cachedBooks.count) books from cache")
            }
        } catch {
            logger.warning("[WeRead] Cache load failed: \(error)")
        }
        
        // 2. 后台增量同步
        isSyncing = true
        do {
            let result = try await syncService.syncNotebooks()
            
            switch result {
            case .noChanges:
                logger.info("[WeRead] No changes from server")
            case .updated(let added, let removed):
                logger.info("[WeRead] Synced: +\(added) -\(removed) books")
                // 重新从缓存加载更新后的数据
                let updatedBooks = try await cacheService.getAllBooks()
                books = updatedBooks.map { WeReadBookListItem(from: $0) }
            }
            
            lastSyncAt = Date()
        } catch {
            // 如果是首次加载且缓存为空，需要全量拉取
            if books.isEmpty {
                await fullFetch()
            } else {
                logger.error("[WeRead] Incremental sync failed: \(error)")
            }
        }
        
        isSyncing = false
        isLoading = false
    }
    
    /// 全量拉取（首次使用或缓存损坏时）
    private func fullFetch() async {
        do {
            let notebooks = try await apiService.fetchNotebooks()
            try await cacheService.saveBooks(notebooks)
            
            // 并发获取高亮数量
            await withTaskGroup(of: Void.self) { group in
                for notebook in notebooks {
                    group.addTask { [weak self] in
                        guard let self else { return }
                        do {
                            let bookmarks = try await self.apiService.fetchBookmarks(bookId: notebook.bookId)
                            try await self.cacheService.saveHighlights(bookmarks, bookId: notebook.bookId)
                            try await self.cacheService.updateBookHighlightCount(
                                bookId: notebook.bookId,
                                count: bookmarks.count
                            )
                        } catch {
                            self.logger.warning("[WeRead] Failed to fetch highlights for \(notebook.bookId)")
                        }
                    }
                }
            }
            
            let cachedBooks = try await cacheService.getAllBooks()
            books = cachedBooks.map { WeReadBookListItem(from: $0) }
        } catch {
            logger.error("[WeRead] Full fetch failed: \(error)")
            errorMessage = error.localizedDescription
        }
    }
}
```

### 3.6 详情页 ViewModel 改造

```swift
// ViewModels/WeRead/WeReadDetailViewModel.swift

@MainActor
final class WeReadDetailViewModel: ObservableObject {
    @Published var highlights: [WeReadHighlightDisplay] = []
    @Published var isLoading: Bool = false
    @Published var isSyncing: Bool = false
    
    private let cacheService: WeReadCacheServiceProtocol
    private let syncService: WeReadIncrementalSyncService
    
    /// 加载高亮（优先缓存，后台增量同步）
    func loadHighlights(for bookId: String) async {
        currentBookId = bookId
        isLoading = true
        
        // 1. 先从缓存加载
        do {
            let cached = try await cacheService.getHighlights(bookId: bookId)
            if !cached.isEmpty {
                allBookmarks = cached.map { WeReadBookmark(from: $0) }
                applyFiltersAndSort()
                isLoading = false
                logger.info("[WeRead] Loaded \(cached.count) highlights from cache")
            }
        } catch {
            logger.warning("[WeRead] Cache load failed: \(error)")
        }
        
        // 2. 后台增量同步
        isSyncing = true
        do {
            let result = try await syncService.syncHighlights(bookId: bookId)
            
            if case .updated = result {
                // 重新从缓存加载
                let updated = try await cacheService.getHighlights(bookId: bookId)
                allBookmarks = updated.map { WeReadBookmark(from: $0) }
                applyFiltersAndSort()
            }
        } catch {
            if highlights.isEmpty {
                // 首次加载，需要全量拉取
                await fullFetchHighlights(bookId: bookId)
            } else {
                logger.error("[WeRead] Incremental sync failed: \(error)")
            }
        }
        
        isSyncing = false
        isLoading = false
    }
}
```

---

## 四、架构图

### 4.1 新架构

```
┌─────────────────────────────────────────────────────────────────┐
│                           UI Layer                               │
│  ┌─────────────────┐    ┌─────────────────────────────────────┐ │
│  │ WeReadListView  │    │ WeReadDetailView                    │ │
│  └────────┬────────┘    └──────────────┬──────────────────────┘ │
└───────────┼────────────────────────────┼────────────────────────┘
            │                            │
            ▼                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                        ViewModel Layer                            │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐  │
│  │ WeReadViewModel     │    │ WeReadDetailViewModel           │  │
│  │ - books (Published) │    │ - highlights (Published)        │  │
│  │ - isSyncing         │    │ - isSyncing                     │  │
│  └──────────┬──────────┘    └──────────────┬──────────────────┘  │
└─────────────┼──────────────────────────────┼─────────────────────┘
              │                              │
              ▼                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                        Service Layer                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              WeReadIncrementalSyncService                    │ │
│  │  - syncNotebooks() → 增量同步书籍                            │ │
│  │  - syncHighlights(bookId) → 增量同步高亮                     │ │
│  └──────────────────────┬──────────────────────────────────────┘ │
│                         │                                        │
│         ┌───────────────┴───────────────┐                       │
│         ▼                               ▼                       │
│  ┌──────────────────┐           ┌──────────────────┐           │
│  │ WeReadAPIService │           │ WeReadCacheService│           │
│  │ (网络请求)        │           │ (SwiftData)       │           │
│  └──────────────────┘           └──────────────────┘           │
└───────────────────────────────────────────────────────────────────┘
              │                               │
              ▼                               ▼
┌───────────────────────┐         ┌───────────────────────────────┐
│   WeRead Web API      │         │   Local SwiftData Store       │
│   (weread.qq.com)     │         │   - CachedWeReadBook          │
│                       │         │   - CachedWeReadHighlight     │
│                       │         │   - WeReadSyncState           │
└───────────────────────┘         └───────────────────────────────┘
```

### 4.2 数据流

```
首次启动:
1. loadBooks() 
   → 缓存为空，显示 loading
   → 全量 API 拉取
   → 保存到 SwiftData
   → 更新 UI

再次启动:
1. loadBooks()
   → 从缓存加载，立即显示 (< 1s)
   → 后台增量同步 (synckey)
   → 有变更则更新缓存和 UI
   → 无变更则静默完成

详情页:
1. loadHighlights(bookId)
   → 从缓存加载，立即显示
   → 后台增量同步该书高亮
   → 有变更则更新
```

---

## 五、实施计划

### Phase 1: 基础缓存层（2-3天）
1. 创建 SwiftData 模型
2. 实现 `WeReadCacheService`
3. 添加单元测试

### Phase 2: 增量同步（2-3天）
1. 扩展 API 服务支持 synckey
2. 实现 `WeReadIncrementalSyncService`
3. 处理边界情况（synckey 失效等）

### Phase 3: ViewModel 改造（1-2天）
1. 改造 `WeReadViewModel`
2. 改造 `WeReadDetailViewModel`
3. 添加同步状态 UI 指示

### Phase 4: 优化与测试（1-2天）
1. 性能测试（大数据量）
2. 离线模式测试
3. 错误恢复测试
4. 缓存清理功能

---

## 六、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| synckey 机制不稳定 | 数据不一致 | 定期全量同步校验 |
| SwiftData 性能问题 | 大数据量卡顿 | 分页查询 + 索引优化 |
| 缓存占用过大 | 存储空间 | 提供清理功能 + 限制缓存大小 |
| API 变更 | 解析失败 | 版本检测 + 降级策略 |

---

## 七、文件变更清单

### 新增文件
```
SyncNos/
├── Models/
│   └── WeRead/
│       └── WeReadCacheModels.swift          # SwiftData 模型
├── Services/
│   └── DataSources-From/
│       └── WeRead/
│           ├── WeReadCacheService.swift     # 缓存服务
│           └── WeReadIncrementalSyncService.swift  # 增量同步
```

### 修改文件
```
SyncNos/
├── Services/
│   └── DataSources-From/
│       └── WeRead/
│           └── WeReadAPIService.swift       # 添加增量 API
├── ViewModels/
│   └── WeRead/
│       ├── WeReadViewModel.swift            # 改造加载逻辑
│       └── WeReadDetailViewModel.swift      # 改造加载逻辑
├── Services/
│   └── Core/
│       ├── DIContainer.swift                # 注册新服务
│       └── Protocols.swift                  # 添加新协议
└── SyncNosApp.swift                         # 初始化 SwiftData
```

---

## 八、参考资料

1. [SwiftData 官方文档](https://developer.apple.com/documentation/swiftdata)
2. [WeRead API 逆向分析](https://github.com/zhaohongxuan/obsidian-weread-plugin)
3. 项目现有实现：`WeReadAPIService.swift`、`WeReadModels.swift`

