# Services 层规范

本目录包含 SyncNos 的所有服务层代码，负责数据访问、网络请求、同步调度等基础设施逻辑。

---

## @ModelActor SwiftData 后台服务实现规范

### 概述

`@ModelActor` 是 SwiftData 框架提供的宏，用于在后台线程安全地执行数据库操作。

### 核心原则

#### 1. 使用 @ModelActor 而非 Task.detached

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

#### 2. 返回 Sendable 类型

`@Model` 对象不是 `Sendable`，必须转换为 DTO：

```swift
// ❌ 错误：返回 @Model 对象
func getAllBooks() throws -> [CachedBook]

// ✅ 正确：返回 Sendable DTO
func getAllBooks() throws -> [BookListItem]
```

#### 3. 不能有存储属性

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

---

### 标准实现模式

#### 文件结构

```
Services/DataSources-From/{Source}/
├── {Source}CacheService.swift     # @ModelActor 实现
├── {Source}CacheModels.swift      # SwiftData @Model 定义
└── {Source}Models.swift           # Sendable DTO 定义
```

#### ModelContainer 工厂

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

#### @ModelActor 服务

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
                existing.title = item.title
                existing.lastFetchedAt = Date()
            } else {
                let newBook = Cached{Source}Book(from: item)
                modelContext.insert(newBook)
            }
        }
        
        try modelContext.save()
    }
}
```

---

### ViewModel 调用模式

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

---

### 查询优化

#### 使用 #Predicate

```swift
let targetBookId = bookId
let predicate = #Predicate<CachedBook> { book in
    book.bookId == targetBookId
}
```

#### 限制结果数量

```swift
var descriptor = FetchDescriptor<CachedBook>(predicate: predicate)
descriptor.fetchLimit = 1  // 只需要一条记录
```

---

### 禁止事项

1. ❌ 在 @ModelActor 中使用存储属性
2. ❌ 返回 @Model 对象（非 Sendable）
3. ❌ 在 @MainActor 上下文中直接操作 modelContext
4. ❌ 使用 Task.detached 手动管理后台线程
5. ❌ 忘记调用 modelContext.save()

---

### 参考实现

| 服务 | 文件路径 |
|------|----------|
| Dedao | `Services/DataSources-From/Dedao/DedaoCacheService.swift` |
| WeRead | `Services/DataSources-From/WeRead/WeReadCacheService.swift` |
| Chats | `Services/DataSources-From/Chats/ChatsCacheService.swift` |

---

### 参考资料

- [ModelActor Protocol](https://developer.apple.com/documentation/swiftdata/modelactor/)
- [SwiftData Framework](https://developer.apple.com/documentation/swiftdata/)
- WWDC 2023: [Dive deeper into SwiftData](https://developer.apple.com/videos/play/wwdc2023/10196/)
