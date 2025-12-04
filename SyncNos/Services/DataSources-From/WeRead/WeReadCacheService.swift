import Foundation
import SwiftData

// MARK: - WeRead Cache Error

/// WeRead 缓存服务错误
enum WeReadCacheError: LocalizedError {
    case modelContainerNotAvailable
    case modelContainerCreationFailed(Error)
    
    var errorDescription: String? {
        switch self {
        case .modelContainerNotAvailable:
            return "WeRead cache storage is not available"
        case .modelContainerCreationFailed(let error):
            return "Failed to create WeRead cache storage: \(error.localizedDescription)"
        }
    }
}

// MARK: - WeRead Cache Service

/// WeRead 本地缓存服务实现
/// 使用 SwiftData 持久化书籍和高亮数据
/// 与 Apple Books 的 DatabaseService 设计一致：初始化不会失败，方法调用时处理错误
final class WeReadCacheService: WeReadCacheServiceProtocol {
    private var _modelContainer: ModelContainer?
    private var containerCreationError: Error?
    private let logger: LoggerServiceProtocol
    
    // MARK: - 初始化
    
    /// 非隔离初始化器，允许在任何上下文中创建实例
    /// 初始化永远不会失败，ModelContainer 会在首次使用时惰性创建
    nonisolated init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger
    }
    
    // MARK: - Private Helpers
    
    /// 获取或创建 ModelContainer（惰性初始化）
    private func getModelContainer() throws -> ModelContainer {
        // 如果之前创建失败，直接抛出错误
        if let error = containerCreationError {
            throw WeReadCacheError.modelContainerCreationFailed(error)
        }
        
        // 如果已经创建成功，直接返回
        if let container = _modelContainer {
            return container
        }
        
        // 首次创建
        do {
            let schema = Schema([
                CachedWeReadBook.self,
                CachedWeReadHighlight.self,
                WeReadSyncState.self
            ])
            
            // 使用独立的存储文件，避免与其他 ModelContainer 冲突
            let storeURL = URL.applicationSupportDirectory
                .appendingPathComponent("SyncNos", isDirectory: true)
                .appendingPathComponent("weread.store")
            
            // 确保目录存在
            let directory = storeURL.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            
            let modelConfiguration = ModelConfiguration(
                schema: schema,
                url: storeURL,
                allowsSave: true
            )
            
            let container = try ModelContainer(
                for: schema,
                configurations: [modelConfiguration]
            )
            
            _modelContainer = container
            logger.info("[WeReadCache] ModelContainer created successfully")
            return container
        } catch {
            containerCreationError = error
            logger.error("[WeReadCache] Failed to create ModelContainer: \(error.localizedDescription)")
            throw WeReadCacheError.modelContainerCreationFailed(error)
        }
    }
    
    // MARK: - 书籍操作
    
    /// 获取所有书籍（在后台线程执行）
    func getAllBooks() async throws -> [CachedWeReadBook] {
        let container = try getModelContainer()
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            let descriptor = FetchDescriptor<CachedWeReadBook>(
                sortBy: [SortDescriptor(\.title, order: .forward)]
            )
            return try context.fetch(descriptor)
        }.value
    }
    
    /// 获取指定书籍（在后台线程执行）
    func getBook(bookId: String) async throws -> CachedWeReadBook? {
        let container = try getModelContainer()
        let targetBookId = bookId
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            let predicate = #Predicate<CachedWeReadBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            let results = try context.fetch(descriptor)
            return results.first
        }.value
    }
    
    /// 保存书籍列表（在后台线程执行）
    func saveBooks(_ notebooks: [WeReadNotebook]) async throws {
        let container = try getModelContainer()
        let logger = self.logger
        let notebookCount = notebooks.count
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
            for notebook in notebooks {
                // 检查是否已存在 - 先获取 bookId 到本地变量
                let targetBookId = notebook.bookId
                let predicate = #Predicate<CachedWeReadBook> { book in
                    book.bookId == targetBookId
                }
                var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
                descriptor.fetchLimit = 1
                let existing = try context.fetch(descriptor).first
                
                if let existing {
                    // 更新现有记录
                    existing.title = notebook.title
                    existing.author = notebook.author ?? ""
                    existing.cover = notebook.cover
                    existing.category = notebook.category
                    existing.updatedAt = notebook.updatedTimestamp.map { Date(timeIntervalSince1970: $0) }
                    existing.lastFetchedAt = Date()
                } else {
                    // 创建新记录
                    let newBook = CachedWeReadBook(from: notebook)
                    newBook.lastFetchedAt = Date()
                    context.insert(newBook)
                }
            }
            
            try context.save()
            logger.info("[WeReadCache] Saved \(notebookCount) books to cache")
        }.value
    }
    
    /// 删除书籍（在后台线程执行）
    func deleteBooks(ids: [String]) async throws {
        let container = try getModelContainer()
        let logger = self.logger
        let idCount = ids.count
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
            for bookId in ids {
                let targetBookId = bookId
                let predicate = #Predicate<CachedWeReadBook> { book in
                    book.bookId == targetBookId
                }
                var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
                descriptor.fetchLimit = 1
                
                if let book = try context.fetch(descriptor).first {
                    context.delete(book)
                }
            }
            
            try context.save()
            logger.info("[WeReadCache] Deleted \(idCount) books from cache")
        }.value
    }
    
    /// 更新书籍的高亮数量（在后台线程执行）
    func updateBookHighlightCount(bookId: String, count: Int) async throws {
        let container = try getModelContainer()
        let targetBookId = bookId
        let targetCount = count
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            let predicate = #Predicate<CachedWeReadBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let book = try context.fetch(descriptor).first {
                book.highlightCount = targetCount
                try context.save()
            }
        }.value
    }
    
    // MARK: - 高亮操作
    
    /// 获取指定书籍的高亮（在后台线程执行）
    func getHighlights(bookId: String) async throws -> [CachedWeReadHighlight] {
        let container = try getModelContainer()
        let targetBookId = bookId
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            let predicate = #Predicate<CachedWeReadHighlight> { highlight in
                highlight.bookId == targetBookId
            }
            let descriptor = FetchDescriptor<CachedWeReadHighlight>(
                predicate: predicate,
                sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
            )
            return try context.fetch(descriptor)
        }.value
    }
    
    /// 保存高亮列表（在后台线程执行）
    func saveHighlights(_ bookmarks: [WeReadBookmark], bookId: String) async throws {
        let container = try getModelContainer()
        let targetBookId = bookId
        let logger = self.logger
        let bookmarkCount = bookmarks.count
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
            // 获取关联的书籍
            let bookPredicate = #Predicate<CachedWeReadBook> { book in
                book.bookId == targetBookId
            }
            var bookDescriptor = FetchDescriptor<CachedWeReadBook>(predicate: bookPredicate)
            bookDescriptor.fetchLimit = 1
            let book = try context.fetch(bookDescriptor).first
            
            for bookmark in bookmarks {
                // 检查是否已存在
                let targetHighlightId = bookmark.highlightId
                let predicate = #Predicate<CachedWeReadHighlight> { highlight in
                    highlight.highlightId == targetHighlightId
                }
                var descriptor = FetchDescriptor<CachedWeReadHighlight>(predicate: predicate)
                descriptor.fetchLimit = 1
                let existing = try context.fetch(descriptor).first
                
                if let existing {
                    // 更新现有记录
                    existing.text = bookmark.text
                    existing.note = bookmark.note
                    existing.chapterTitle = bookmark.chapterTitle
                    existing.colorIndex = bookmark.colorIndex
                    existing.range = bookmark.range
                    existing.reviewContents = bookmark.reviewContents
                } else {
                    // 创建新记录
                    let newHighlight = CachedWeReadHighlight(from: bookmark)
                    newHighlight.book = book
                    context.insert(newHighlight)
                }
            }
            
            try context.save()
            logger.info("[WeReadCache] Saved \(bookmarkCount) highlights for bookId=\(targetBookId)")
        }.value
    }
    
    /// 删除高亮（在后台线程执行）
    func deleteHighlights(ids: [String]) async throws {
        let container = try getModelContainer()
        let logger = self.logger
        let idCount = ids.count
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
            for highlightId in ids {
                let targetHighlightId = highlightId
                let predicate = #Predicate<CachedWeReadHighlight> { highlight in
                    highlight.highlightId == targetHighlightId
                }
                var descriptor = FetchDescriptor<CachedWeReadHighlight>(predicate: predicate)
                descriptor.fetchLimit = 1
                
                if let highlight = try context.fetch(descriptor).first {
                    context.delete(highlight)
                }
            }
            
            try context.save()
            logger.info("[WeReadCache] Deleted \(idCount) highlights from cache")
        }.value
    }
    
    // MARK: - 同步状态
    
    /// 获取同步状态（在后台线程执行）
    func getSyncState() async throws -> WeReadSyncState {
        let container = try getModelContainer()
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            let targetId = "global"
            let predicate = #Predicate<WeReadSyncState> { state in
                state.id == targetId
            }
            var descriptor = FetchDescriptor<WeReadSyncState>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let existing = try context.fetch(descriptor).first {
                return existing
            }
            
            // 创建默认同步状态
            let newState = WeReadSyncState()
            context.insert(newState)
            try context.save()
            return newState
        }.value
    }
    
    /// 更新同步状态（在后台线程执行）
    func updateSyncState(notebookSyncKey: Int?, lastSyncAt: Date?) async throws {
        let container = try getModelContainer()
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            let targetId = "global"
            let predicate = #Predicate<WeReadSyncState> { state in
                state.id == targetId
            }
            var descriptor = FetchDescriptor<WeReadSyncState>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            let state: WeReadSyncState
            if let existing = try context.fetch(descriptor).first {
                state = existing
            } else {
                state = WeReadSyncState()
                context.insert(state)
            }
            
            if let key = notebookSyncKey {
                state.notebookSyncKey = key
            }
            if let date = lastSyncAt {
                state.lastIncrementalSyncAt = date
            }
            
            try context.save()
        }.value
    }
    
    /// 获取书籍的 SyncKey（在后台线程执行）
    func getBookSyncKey(bookId: String) async throws -> Int? {
        let book = try await getBook(bookId: bookId)
        return book?.bookmarksSyncKey
    }
    
    /// 更新书籍的 SyncKey（在后台线程执行）
    func updateBookSyncKey(bookId: String, syncKey: Int) async throws {
        let container = try getModelContainer()
        let targetBookId = bookId
        let targetSyncKey = syncKey
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            let predicate = #Predicate<CachedWeReadBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let book = try context.fetch(descriptor).first {
                book.bookmarksSyncKey = targetSyncKey
                try context.save()
            }
        }.value
    }
    
    // MARK: - 清理
    
    /// 清除所有缓存（在后台线程执行）
    func clearAllCache() async throws {
        let container = try getModelContainer()
        let logger = self.logger
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
            // 删除所有高亮
            let highlightDescriptor = FetchDescriptor<CachedWeReadHighlight>()
            let highlights = try context.fetch(highlightDescriptor)
            for highlight in highlights {
                context.delete(highlight)
            }
            
            // 删除所有书籍
            let bookDescriptor = FetchDescriptor<CachedWeReadBook>()
            let books = try context.fetch(bookDescriptor)
            for book in books {
                context.delete(book)
            }
            
            // 删除同步状态
            let stateDescriptor = FetchDescriptor<WeReadSyncState>()
            let states = try context.fetch(stateDescriptor)
            for state in states {
                context.delete(state)
            }
            
            try context.save()
            logger.info("[WeReadCache] Cleared all cache data")
        }.value
    }
    
    // MARK: - 统计
    
    /// 获取缓存统计（在后台线程执行）
    func getCacheStats() async throws -> WeReadCacheStats {
        let container = try getModelContainer()
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            
            let bookDescriptor = FetchDescriptor<CachedWeReadBook>()
            let books = try context.fetch(bookDescriptor)
            
            let highlightDescriptor = FetchDescriptor<CachedWeReadHighlight>()
            let highlights = try context.fetch(highlightDescriptor)
            
            let targetId = "global"
            let predicate = #Predicate<WeReadSyncState> { state in
                state.id == targetId
            }
            var stateDescriptor = FetchDescriptor<WeReadSyncState>(predicate: predicate)
            stateDescriptor.fetchLimit = 1
            let state = try context.fetch(stateDescriptor).first
            
            return WeReadCacheStats(
                bookCount: books.count,
                highlightCount: highlights.count,
                lastSyncAt: state?.lastIncrementalSyncAt ?? state?.lastFullSyncAt
            )
        }.value
    }
}

// MARK: - Cache Stats

/// 缓存统计信息
struct WeReadCacheStats {
    let bookCount: Int
    let highlightCount: Int
    let lastSyncAt: Date?
}
