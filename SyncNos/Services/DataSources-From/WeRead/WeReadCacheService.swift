import Foundation
import SwiftData

// MARK: - WeRead Model Container Factory

/// WeRead ModelContainer 工厂
/// 负责创建和管理 WeRead 专用的 ModelContainer
enum WeReadModelContainerFactory {
    /// 创建 WeRead 专用的 ModelContainer
    static func createContainer() throws -> ModelContainer {
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
        
        return try ModelContainer(
            for: schema,
            configurations: [modelConfiguration]
        )
    }
}

// MARK: - WeRead Cache Service

/// WeRead 本地数据存储服务实现
/// 使用 @ModelActor 在后台线程执行所有数据库操作，不阻塞主线程
@ModelActor
actor WeReadCacheService: WeReadCacheServiceProtocol {
    // 注意：@ModelActor 宏会自动生成 modelExecutor、modelContainer 和 init(modelContainer:)
    // 不能添加额外的存储属性，否则会导致初始化器冲突
    
    // 使用全局 logger 而不是存储属性
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }
    
    // MARK: - 书籍操作
    
    /// 获取所有书籍
    func getAllBooks() throws -> [WeReadBookListItem] {
        let descriptor = FetchDescriptor<CachedWeReadBook>(
            sortBy: [SortDescriptor(\.title, order: .forward)]
        )
        let books = try modelContext.fetch(descriptor)
        logger.debug("[WeReadCache] Fetched \(books.count) books from local storage")
        return books.map { WeReadBookListItem(from: $0) }
    }
    
    /// 获取指定书籍
    func getBook(bookId: String) throws -> CachedWeReadBook? {
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }
    
    /// 保存书籍列表
    func saveBooks(_ notebooks: [WeReadNotebook]) throws {
        for notebook in notebooks {
            let targetBookId = notebook.bookId
            let predicate = #Predicate<CachedWeReadBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            let existing = try modelContext.fetch(descriptor).first
            
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
                modelContext.insert(newBook)
            }
        }
        
        try modelContext.save()
        logger.info("[WeReadCache] Saved \(notebooks.count) books to local storage")
    }
    
    /// 删除书籍
    func deleteBooks(ids: [String]) throws {
        for bookId in ids {
            let targetBookId = bookId
            let predicate = #Predicate<CachedWeReadBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let book = try modelContext.fetch(descriptor).first {
                modelContext.delete(book)
            }
        }
        
        try modelContext.save()
        logger.info("[WeReadCache] Deleted \(ids.count) books from local storage")
    }
    
    /// 更新书籍的高亮数量
    func updateBookHighlightCount(bookId: String, count: Int) throws {
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let book = try modelContext.fetch(descriptor).first {
            book.highlightCount = count
            try modelContext.save()
        }
    }
    
    // MARK: - 高亮操作
    
    /// 获取指定书籍的高亮
    func getHighlights(bookId: String) throws -> [WeReadBookmark] {
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadHighlight> { highlight in
            highlight.bookId == targetBookId
        }
        let descriptor = FetchDescriptor<CachedWeReadHighlight>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        let highlights = try modelContext.fetch(descriptor)
        logger.debug("[WeReadCache] Fetched \(highlights.count) highlights for bookId=\(targetBookId)")
        return highlights.map { WeReadBookmark(from: $0) }
    }
    
    /// 保存高亮列表
    func saveHighlights(_ bookmarks: [WeReadBookmark], bookId: String) throws {
        let targetBookId = bookId
        
        // 获取关联的书籍
        let bookPredicate = #Predicate<CachedWeReadBook> { book in
            book.bookId == targetBookId
        }
        var bookDescriptor = FetchDescriptor<CachedWeReadBook>(predicate: bookPredicate)
        bookDescriptor.fetchLimit = 1
        let book = try modelContext.fetch(bookDescriptor).first
        
        for bookmark in bookmarks {
            // 检查是否已存在
            let targetHighlightId = bookmark.highlightId
            let predicate = #Predicate<CachedWeReadHighlight> { highlight in
                highlight.highlightId == targetHighlightId
            }
            var descriptor = FetchDescriptor<CachedWeReadHighlight>(predicate: predicate)
            descriptor.fetchLimit = 1
            let existing = try modelContext.fetch(descriptor).first
            
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
                modelContext.insert(newHighlight)
            }
        }
        
        try modelContext.save()
        logger.info("[WeReadCache] Saved \(bookmarks.count) highlights for bookId=\(targetBookId)")
    }
    
    /// 删除高亮
    func deleteHighlights(ids: [String]) throws {
        for highlightId in ids {
            let targetHighlightId = highlightId
            let predicate = #Predicate<CachedWeReadHighlight> { highlight in
                highlight.highlightId == targetHighlightId
            }
            var descriptor = FetchDescriptor<CachedWeReadHighlight>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let highlight = try modelContext.fetch(descriptor).first {
                modelContext.delete(highlight)
            }
        }
        
        try modelContext.save()
        logger.info("[WeReadCache] Deleted \(ids.count) highlights from local storage")
    }
    
    // MARK: - 同步状态
    
    /// 获取同步状态
    func getSyncState() throws -> WeReadSyncStateSnapshot {
        let targetId = "global"
        let predicate = #Predicate<WeReadSyncState> { state in
            state.id == targetId
        }
        var descriptor = FetchDescriptor<WeReadSyncState>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let existing = try modelContext.fetch(descriptor).first {
            return WeReadSyncStateSnapshot(from: existing)
        }
        
        // 创建默认同步状态
        let newState = WeReadSyncState()
        modelContext.insert(newState)
        try modelContext.save()
        return WeReadSyncStateSnapshot(from: newState)
    }
    
    /// 更新同步状态
    func updateSyncState(notebookSyncKey: Int?, lastSyncAt: Date?) throws {
        let targetId = "global"
        let predicate = #Predicate<WeReadSyncState> { state in
            state.id == targetId
        }
        var descriptor = FetchDescriptor<WeReadSyncState>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        let state: WeReadSyncState
        if let existing = try modelContext.fetch(descriptor).first {
            state = existing
        } else {
            state = WeReadSyncState()
            modelContext.insert(state)
        }
        
        if let key = notebookSyncKey {
            state.notebookSyncKey = key
        }
        if let date = lastSyncAt {
            state.lastIncrementalSyncAt = date
        }
        
        try modelContext.save()
    }
    
    /// 获取书籍的 SyncKey
    func getBookSyncKey(bookId: String) throws -> Int? {
        let book = try getBook(bookId: bookId)
        return book?.bookmarksSyncKey
    }
    
    /// 更新书籍的 SyncKey
    func updateBookSyncKey(bookId: String, syncKey: Int) throws {
        let targetBookId = bookId
        let predicate = #Predicate<CachedWeReadBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedWeReadBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let book = try modelContext.fetch(descriptor).first {
            book.bookmarksSyncKey = syncKey
            try modelContext.save()
        }
    }
    
    // MARK: - 清理
    
    /// 清除所有缓存
    func clearAllCache() throws {
        // 删除所有高亮
        let highlightDescriptor = FetchDescriptor<CachedWeReadHighlight>()
        let highlights = try modelContext.fetch(highlightDescriptor)
        for highlight in highlights {
            modelContext.delete(highlight)
        }
        
        // 删除所有书籍
        let bookDescriptor = FetchDescriptor<CachedWeReadBook>()
        let books = try modelContext.fetch(bookDescriptor)
        for book in books {
            modelContext.delete(book)
        }
        
        // 删除同步状态
        let stateDescriptor = FetchDescriptor<WeReadSyncState>()
        let states = try modelContext.fetch(stateDescriptor)
        for state in states {
            modelContext.delete(state)
        }
        
        try modelContext.save()
        logger.info("[WeReadCache] Cleared all local data")
    }
    
    // MARK: - 统计
    
    /// 获取缓存统计
    func getCacheStats() throws -> WeReadCacheStats {
        let bookDescriptor = FetchDescriptor<CachedWeReadBook>()
        let books = try modelContext.fetch(bookDescriptor)
        
        let highlightDescriptor = FetchDescriptor<CachedWeReadHighlight>()
        let highlights = try modelContext.fetch(highlightDescriptor)
        
        let targetId = "global"
        let predicate = #Predicate<WeReadSyncState> { state in
            state.id == targetId
        }
        var stateDescriptor = FetchDescriptor<WeReadSyncState>(predicate: predicate)
        stateDescriptor.fetchLimit = 1
        let state = try modelContext.fetch(stateDescriptor).first
        
        return WeReadCacheStats(
            bookCount: books.count,
            highlightCount: highlights.count,
            lastSyncAt: state?.lastIncrementalSyncAt ?? state?.lastFullSyncAt
        )
    }
}

// MARK: - Cache Stats

/// 缓存统计信息
struct WeReadCacheStats: Sendable {
    let bookCount: Int
    let highlightCount: Int
    let lastSyncAt: Date?
}
