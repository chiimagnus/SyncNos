---
description: 当需要实现 SwiftData 后台数据服务时读取这个 cursor rule
globs:
  - "**/*CacheService*.swift"
  - "**/*DataService*.swift"
  - "**/SwiftData/**/*.swift"
alwaysApply: false
---

# @ModelActor SwiftData 后台服务实现规范

## 概述

`@ModelActor` 是 SwiftData 框架提供的宏，用于在后台线程安全地执行数据库操作。本规范定义了在 SyncNos 项目中实现 SwiftData 后台服务的标准模式。

## 核心原则

### 1. 使用 @ModelActor 而非 Task.detached

```swift
// ❌ 不推荐：手动管理后台线程
func getAllBooks() async throws -> [Book] {
    return try await Task.detached {
        let context = ModelContext(container)
        return try context.fetch(FetchDescriptor<Book>())
    }.value
}

// ✅ 推荐：使用 @ModelActor
@ModelActor
actor CacheService {
    func getAllBooks() throws -> [BookDTO] {
        let books = try modelContext.fetch(FetchDescriptor<Book>())
        return books.map { BookDTO(from: $0) }
    }
}
```

### 2. 返回 Sendable 类型

`@Model` 对象不是 `Sendable`，必须转换为 DTO：

```swift
// ❌ 错误：返回 @Model 对象
func getAllBooks() throws -> [CachedBook]

// ✅ 正确：返回 Sendable DTO
func getAllBooks() throws -> [BookListItem]
```

### 3. 不能有存储属性

```swift
// ❌ 错误：存储属性会与生成的初始化器冲突
@ModelActor
actor Service {
    private let logger: Logger  // 编译错误
}

// ✅ 正确：使用计算属性
@ModelActor
actor Service {
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }
}
```

## 标准实现模式

### 文件结构

```
Services/DataSources-From/{Source}/
├── {Source}CacheService.swift     # @ModelActor 实现
├── {Source}CacheModels.swift      # SwiftData @Model 定义
└── {Source}Models.swift           # Sendable DTO 定义
```

### 1. ModelContainer 工厂

```swift
enum {Source}ModelContainerFactory {
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            Cached{Source}Book.self,
            Cached{Source}Highlight.self,
            {Source}SyncState.self
        ])
        
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("{source}.store")
        
        // 确保目录存在
        let directory = storeURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        
        let modelConfiguration = ModelConfiguration(
            schema: schema,
            url: storeURL,
            allowsSave: true
        )
        
        return try ModelContainer(for: schema, configurations: [modelConfiguration])
    }
}
```

### 2. @ModelActor 服务

```swift
@ModelActor
actor {Source}CacheService: {Source}CacheServiceProtocol {
    // 使用计算属性访问外部依赖
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }
    
    // MARK: - 读取操作
    
    func getAllBooks() throws -> [{Source}BookListItem] {
        let descriptor = FetchDescriptor<Cached{Source}Book>(
            sortBy: [SortDescriptor(\.title, order: .forward)]
        )
        let books = try modelContext.fetch(descriptor)
        logger.debug("[{Source}Cache] Fetched \(books.count) books")
        return books.map { {Source}BookListItem(from: $0) }
    }
    
    func getBook(bookId: String) throws -> Cached{Source}Book? {
        let targetBookId = bookId
        let predicate = #Predicate<Cached{Source}Book> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<Cached{Source}Book>(predicate: predicate)
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }
    
    // MARK: - 写入操作
    
    func saveBooks(_ items: [{Source}DTO]) throws {
        for item in items {
            let targetId = item.id
            let predicate = #Predicate<Cached{Source}Book> { book in
                book.bookId == targetId
            }
            var descriptor = FetchDescriptor<Cached{Source}Book>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let existing = try modelContext.fetch(descriptor).first {
                // 更新
                existing.title = item.title
                existing.lastFetchedAt = Date()
            } else {
                // 插入
                let newBook = Cached{Source}Book(from: item)
                newBook.lastFetchedAt = Date()
                modelContext.insert(newBook)
            }
        }
        
        try modelContext.save()
        logger.info("[{Source}Cache] Saved \(items.count) books")
    }
    
    // MARK: - 删除操作
    
    func deleteBooks(ids: [String]) throws {
        for bookId in ids {
            let targetBookId = bookId
            let predicate = #Predicate<Cached{Source}Book> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<Cached{Source}Book>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let book = try modelContext.fetch(descriptor).first {
                modelContext.delete(book)
            }
        }
        
        try modelContext.save()
        logger.info("[{Source}Cache] Deleted \(ids.count) books")
    }
    
    // MARK: - 清理
    
    func clearAllData() throws {
        let descriptor = FetchDescriptor<Cached{Source}Book>()
        let books = try modelContext.fetch(descriptor)
        for book in books {
            modelContext.delete(book)
        }
        
        try modelContext.save()
        logger.info("[{Source}Cache] Cleared all data")
    }
}
```

### 3. 协议定义

```swift
// Protocols.swift
protocol {Source}CacheServiceProtocol: Actor {
    // 读取操作 - 返回 Sendable DTO
    func getAllBooks() throws -> [{Source}BookListItem]
    func getBook(bookId: String) throws -> Cached{Source}Book?
    func getHighlights(bookId: String) throws -> [{Source}HighlightDTO]
    
    // 写入操作
    func saveBooks(_ items: [{Source}DTO]) throws
    func saveHighlights(_ items: [{Source}HighlightDTO], bookId: String) throws
    
    // 删除操作
    func deleteBooks(ids: [String]) throws
    func deleteHighlights(ids: [String]) throws
    
    // 同步状态
    func getSyncState() throws -> {Source}SyncStateSnapshot
    func updateSyncState(lastSyncAt: Date?) throws
    
    // 清理
    func clearAllData() throws
}
```

### 4. Sendable DTO 定义

```swift
// {Source}CacheModels.swift 或 {Source}Models.swift

/// Sendable 同步状态快照
struct {Source}SyncStateSnapshot: Sendable {
    let id: String
    let lastFullSyncAt: Date?
    let lastIncrementalSyncAt: Date?
    
    init(from state: {Source}SyncState) {
        self.id = state.id
        self.lastFullSyncAt = state.lastFullSyncAt
        self.lastIncrementalSyncAt = state.lastIncrementalSyncAt
    }
}

/// Sendable UI 列表模型
struct {Source}BookListItem: Identifiable, Sendable {
    let id: String
    let title: String
    let author: String
    let highlightCount: Int
    
    init(from cached: Cached{Source}Book) {
        self.id = cached.bookId
        self.title = cached.title
        self.author = cached.author
        self.highlightCount = cached.highlightCount
    }
}
```

### 5. DIContainer 注册

```swift
// DIContainer.swift
var {source}CacheService: {Source}CacheServiceProtocol {
    if _{source}CacheService == nil {
        do {
            let container = try {Source}ModelContainerFactory.createContainer()
            _{source}CacheService = {Source}CacheService(modelContainer: container)
            loggerService.info("[DIContainer] {Source} ModelContainer created")
        } catch {
            loggerService.error("[DIContainer] Failed to create {Source} ModelContainer: \(error)")
            fatalError("Failed to create {Source} ModelContainer")
        }
    }
    return _{source}CacheService!
}
```

## ViewModel 调用模式

```swift
@MainActor
class {Source}ViewModel: ObservableObject {
    private let cacheService: {Source}CacheServiceProtocol
    
    @Published var books: [{Source}BookListItem] = []
    @Published var isLoading = false
    
    func loadBooks() async {
        isLoading = true
        do {
            // await 调用 actor 方法
            books = try await cacheService.getAllBooks()
        } catch {
            logger.error("Failed to load books: \(error)")
        }
        isLoading = false
    }
}
```

## 查询优化

### 使用 #Predicate

```swift
let targetBookId = bookId
let predicate = #Predicate<CachedBook> { book in
    book.bookId == targetBookId
}
```

### 限制结果数量

```swift
var descriptor = FetchDescriptor<CachedBook>(predicate: predicate)
descriptor.fetchLimit = 1  // 只需要一条记录
```

### 排序

```swift
let descriptor = FetchDescriptor<CachedBook>(
    sortBy: [SortDescriptor(\.title, order: .forward)]
)
```

## 禁止事项

1. ❌ 在 @ModelActor 中使用存储属性
2. ❌ 返回 @Model 对象（非 Sendable）
3. ❌ 在 @MainActor 上下文中直接操作 modelContext
4. ❌ 使用 Task.detached 手动管理后台线程
5. ❌ 忘记调用 modelContext.save()

## 参考实现

### 已实现的 CacheService

| 服务 | 文件路径 |
|------|----------|
| Dedao | `SyncNos/Services/DataSources-From/Dedao/DedaoCacheService.swift` |
| WeRead | `SyncNos/Services/DataSources-From/WeRead/WeReadCacheService.swift` |

### 相关文件

| 类型 | Dedao | WeRead |
|------|-------|--------|
| @Model 定义 | `SyncNos/Models/DedaoCacheModels.swift` | `SyncNos/Models/WeReadCacheModels.swift` |
| Sendable DTO | `SyncNos/Models/DedaoModels.swift` | `SyncNos/Models/WeReadModels.swift` |
| 协议定义 | `SyncNos/Services/Core/Protocols.swift` | 同左 |
| DIContainer | `SyncNos/Services/Core/DIContainer.swift` | 同左 |

## 参考资料

### Apple 官方文档

- [ModelActor Protocol](https://developer.apple.com/documentation/swiftdata/modelactor/) - `@ModelActor` 协议定义
- [ModelActor() Macro](https://developer.apple.com/documentation/swiftdata/modelactor()/) - `@ModelActor` 宏说明
- [SwiftData Framework](https://developer.apple.com/documentation/swiftdata/) - SwiftData 框架文档
- [ModelContainer](https://developer.apple.com/documentation/swiftdata/modelcontainer/) - 模型容器
- [ModelContext](https://developer.apple.com/documentation/swiftdata/modelcontext/) - 模型上下文

### WWDC 视频

| 年份 | 视频 | 说明 |
|------|------|------|
| 2023 | [Meet SwiftData](https://developer.apple.com/videos/play/wwdc2023/10187/) | SwiftData 入门 |
| 2023 | [Build an app with SwiftData](https://developer.apple.com/videos/play/wwdc2023/10154/) | 使用 SwiftData 构建应用 |
| 2023 | [Dive deeper into SwiftData](https://developer.apple.com/videos/play/wwdc2023/10196/) | 深入 SwiftData（ModelContainer、ModelContext、并发） |
| 2023 | [Model your schema with SwiftData](https://developer.apple.com/videos/play/wwdc2023/10195/) | Schema 建模 |
| 2024 | [What's new in SwiftData](https://developer.apple.com/videos/play/wwdc2024/10137/) | SwiftData 新特性（#Unique、#Index、PreviewModifier） |
| 2024 | [Create a custom data store with SwiftData](https://developer.apple.com/videos/play/wwdc2024/10138/) | 自定义数据存储 |
| 2024 | [Track model changes with SwiftData history](https://developer.apple.com/videos/play/wwdc2024/10075/) | 数据变更追踪 |
