import Foundation
import SwiftData

// MARK: - WeRead Cache Service

/// WeRead 本地缓存服务实现
/// 使用 SwiftData 持久化书籍和高亮数据
final class WeReadCacheService: WeReadCacheServiceProtocol {
    private let modelContainer: ModelContainer
    private let logger: LoggerServiceProtocol
    
    // MARK: - 初始化
    
    /// 非隔离初始化器，允许在任何上下文中创建实例
    nonisolated init(
        modelContainer: ModelContainer,
        logger: LoggerServiceProtocol
    ) {
        self.modelContainer = modelContainer
        self.logger = logger
    }
    
    // MARK: - 书籍操作
    
    @MainActor
    func getAllBooks() async throws -> [CachedWeReadBook] {
        let context = modelContainer.mainContext
        let descriptor = FetchDescriptor<CachedWeReadBook>(
            sortBy: [SortDescriptor(\.title, order: .forward)]
        )
        let books = try context.fetch(descriptor)
        logger.debug("[WeReadCache] Fetched \(books.count) books from cache")
        return books
    }
    
    @MainActor
    func getBook(bookId: String) async throws -> CachedWeReadBook? {
        let context = modelContainer.mainContext
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        let results = try context.fetch(descriptor)
        return results.first
    }
    
    @MainActor
    func saveBooks(_ notebooks: [WeReadNotebook]) async throws {
        let context = modelContainer.mainContext
        
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
        logger.info("[WeReadCache] Saved \(notebooks.count) books to cache")
    }
    
    @MainActor
    func deleteBooks(ids: [String]) async throws {
        let context = modelContainer.mainContext
        
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
        logger.info("[WeReadCache] Deleted \(ids.count) books from cache")
    }
    
    @MainActor
    func updateBookHighlightCount(bookId: String, count: Int) async throws {
        let context = modelContainer.mainContext
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let book = try context.fetch(descriptor).first {
            book.highlightCount = count
            try context.save()
        }
    }
    
    // MARK: - 高亮操作
    
    @MainActor
    func getHighlights(bookId: String) async throws -> [CachedWeReadHighlight] {
        let context = modelContainer.mainContext
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadHighlight> { highlight in
            highlight.bookId == targetBookId
        }
        let descriptor = FetchDescriptor<CachedWeReadHighlight>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        let highlights = try context.fetch(descriptor)
        logger.debug("[WeReadCache] Fetched \(highlights.count) highlights for bookId=\(bookId)")
        return highlights
    }
    
    @MainActor
    func saveHighlights(_ bookmarks: [WeReadBookmark], bookId: String) async throws {
        let context = modelContainer.mainContext
        
        // 获取关联的书籍
        let targetBookId = bookId
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
        logger.info("[WeReadCache] Saved \(bookmarks.count) highlights for bookId=\(bookId)")
    }
    
    @MainActor
    func deleteHighlights(ids: [String]) async throws {
        let context = modelContainer.mainContext
        
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
        logger.info("[WeReadCache] Deleted \(ids.count) highlights from cache")
    }
    
    // MARK: - 同步状态
    
    @MainActor
    func getSyncState() async throws -> WeReadSyncState {
        let context = modelContainer.mainContext
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
    }
    
    @MainActor
    func updateSyncState(notebookSyncKey: Int?, lastSyncAt: Date?) async throws {
        let context = modelContainer.mainContext
        let state = try await getSyncState()
        
        if let key = notebookSyncKey {
            state.notebookSyncKey = key
        }
        if let date = lastSyncAt {
            state.lastIncrementalSyncAt = date
        }
        
        try context.save()
    }
    
    @MainActor
    func getBookSyncKey(bookId: String) async throws -> Int? {
        let book = try await getBook(bookId: bookId)
        return book?.bookmarksSyncKey
    }
    
    @MainActor
    func updateBookSyncKey(bookId: String, syncKey: Int) async throws {
        let context = modelContainer.mainContext
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let book = try context.fetch(descriptor).first {
            book.bookmarksSyncKey = syncKey
            try context.save()
        }
    }
    
    // MARK: - 清理
    
    @MainActor
    func clearAllCache() async throws {
        let context = modelContainer.mainContext
        
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
    }
    
    // MARK: - 统计
    
    @MainActor
    func getCacheStats() async throws -> WeReadCacheStats {
        let context = modelContainer.mainContext
        
        let bookDescriptor = FetchDescriptor<CachedWeReadBook>()
        let books = try context.fetch(bookDescriptor)
        
        let highlightDescriptor = FetchDescriptor<CachedWeReadHighlight>()
        let highlights = try context.fetch(highlightDescriptor)
        
        let state = try await getSyncState()
        
        return WeReadCacheStats(
            bookCount: books.count,
            highlightCount: highlights.count,
            lastSyncAt: state.lastIncrementalSyncAt ?? state.lastFullSyncAt
        )
    }
}

// MARK: - Cache Stats

/// 缓存统计信息
struct WeReadCacheStats {
    let bookCount: Int
    let highlightCount: Int
    let lastSyncAt: Date?
}
