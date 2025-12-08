import Foundation
import SwiftData

// MARK: - Dedao Model Container Factory

/// Dedao ModelContainer 工厂
/// 负责创建和管理 Dedao 专用的 ModelContainer
enum DedaoModelContainerFactory {
    /// 创建 Dedao 专用的 ModelContainer
    static func createContainer() throws -> ModelContainer {
        let schema = Schema([
            CachedDedaoBook.self,
            CachedDedaoHighlight.self,
            DedaoSyncState.self
        ])
        
        // 使用独立的存储文件，避免与其他 ModelContainer 冲突
        let storeURL = URL.applicationSupportDirectory
            .appendingPathComponent("SyncNos", isDirectory: true)
            .appendingPathComponent("dedao.store")
        
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

// MARK: - Dedao Cache Service

/// Dedao 本地数据存储服务实现
/// 使用 @ModelActor 在后台线程执行所有数据库操作，不阻塞主线程
@ModelActor
actor DedaoCacheService: DedaoCacheServiceProtocol {
    // 注意：@ModelActor 宏会自动生成 modelExecutor、modelContainer 和 init(modelContainer:)
    // 不能添加额外的存储属性，否则会导致初始化器冲突
    
    // 使用全局 logger 而不是存储属性
    private var logger: LoggerServiceProtocol {
        DIContainer.shared.loggerService
    }
    
    // MARK: - 书籍操作
    
    /// 获取所有书籍
    func getAllBooks() throws -> [DedaoBookListItem] {
        let descriptor = FetchDescriptor<CachedDedaoBook>(
            sortBy: [SortDescriptor(\.title, order: .forward)]
        )
        let books = try modelContext.fetch(descriptor)
        logger.debug("[DedaoCache] Fetched \(books.count) books from local storage")
        return books.map { DedaoBookListItem(from: $0) }
    }
    
    /// 获取指定书籍
    func getBook(bookId: String) throws -> CachedDedaoBook? {
        let targetBookId = bookId
        let predicate = #Predicate<CachedDedaoBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        return try modelContext.fetch(descriptor).first
    }
    
    /// 保存书籍列表
    func saveBooks(_ ebooks: [DedaoEbook]) throws {
        for ebook in ebooks {
            let targetBookId = ebook.effectiveId
            let predicate = #Predicate<CachedDedaoBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            let existing = try modelContext.fetch(descriptor).first
            
            if let existing {
                existing.title = ebook.title
                existing.author = ebook.author ?? ""
                existing.cover = ebook.icon
                existing.lastFetchedAt = Date()
            } else {
                let newBook = CachedDedaoBook(from: ebook)
                newBook.lastFetchedAt = Date()
                modelContext.insert(newBook)
            }
        }
        
        try modelContext.save()
        logger.info("[DedaoCache] Saved \(ebooks.count) books to local storage")
    }
    
    /// 删除书籍
    func deleteBooks(ids: [String]) throws {
        for bookId in ids {
            let targetBookId = bookId
            let predicate = #Predicate<CachedDedaoBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let book = try modelContext.fetch(descriptor).first {
                modelContext.delete(book)
            }
        }
        
        try modelContext.save()
        logger.info("[DedaoCache] Deleted \(ids.count) books from local storage")
    }
    
    /// 更新书籍的高亮数量
    func updateBookHighlightCount(bookId: String, count: Int) throws {
        let targetBookId = bookId
        let predicate = #Predicate<CachedDedaoBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let book = try modelContext.fetch(descriptor).first {
            book.highlightCount = count
            try modelContext.save()
        }
    }
    
    // MARK: - 高亮操作
    
    /// 获取指定书籍的高亮
    func getHighlights(bookId: String) throws -> [DedaoEbookNote] {
        let targetBookId = bookId
        let predicate = #Predicate<CachedDedaoHighlight> { highlight in
            highlight.bookId == targetBookId
        }
        let descriptor = FetchDescriptor<CachedDedaoHighlight>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        let highlights = try modelContext.fetch(descriptor)
        logger.debug("[DedaoCache] Fetched \(highlights.count) highlights for bookId=\(targetBookId)")
        return highlights.map { DedaoEbookNote(from: $0) }
    }
    
    /// 保存高亮列表
    func saveHighlights(_ notes: [DedaoEbookNote], bookId: String) throws {
        let targetBookId = bookId
        
        // 获取关联的书籍
        let bookPredicate = #Predicate<CachedDedaoBook> { book in
            book.bookId == targetBookId
        }
        var bookDescriptor = FetchDescriptor<CachedDedaoBook>(predicate: bookPredicate)
        bookDescriptor.fetchLimit = 1
        let book = try modelContext.fetch(bookDescriptor).first
        
        // 先删除该书的所有旧高亮（完全替换策略）
        let highlightPredicate = #Predicate<CachedDedaoHighlight> { highlight in
            highlight.bookId == targetBookId
        }
        let highlightDescriptor = FetchDescriptor<CachedDedaoHighlight>(predicate: highlightPredicate)
        let existingHighlights = try modelContext.fetch(highlightDescriptor)
        let existingCount = existingHighlights.count
        for highlight in existingHighlights {
            modelContext.delete(highlight)
        }
        
        // 插入新数据
        for note in notes {
            let newHighlight = CachedDedaoHighlight(from: note)
            newHighlight.bookId = targetBookId
            newHighlight.book = book
            modelContext.insert(newHighlight)
        }
        
        try modelContext.save()
        logger.info("[DedaoCache] Replaced \(existingCount) → \(notes.count) highlights for bookId=\(targetBookId)")
    }
    
    /// 删除高亮
    func deleteHighlights(ids: [String]) throws {
        for highlightId in ids {
            let targetHighlightId = highlightId
            let predicate = #Predicate<CachedDedaoHighlight> { highlight in
                highlight.highlightId == targetHighlightId
            }
            var descriptor = FetchDescriptor<CachedDedaoHighlight>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let highlight = try modelContext.fetch(descriptor).first {
                modelContext.delete(highlight)
            }
        }
        
        try modelContext.save()
        logger.info("[DedaoCache] Deleted \(ids.count) highlights from local storage")
    }
    
    // MARK: - 同步状态
    
    /// 获取同步状态
    func getSyncState() throws -> DedaoSyncStateSnapshot {
        let targetId = "global"
        let predicate = #Predicate<DedaoSyncState> { state in
            state.id == targetId
        }
        var descriptor = FetchDescriptor<DedaoSyncState>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let existing = try modelContext.fetch(descriptor).first {
            return DedaoSyncStateSnapshot(from: existing)
        }
        
        // 创建默认同步状态
        let newState = DedaoSyncState()
        modelContext.insert(newState)
        try modelContext.save()
        return DedaoSyncStateSnapshot(from: newState)
    }
    
    /// 更新同步状态
    func updateSyncState(lastFullSyncAt: Date?, lastIncrementalSyncAt: Date?) throws {
        let targetId = "global"
        let predicate = #Predicate<DedaoSyncState> { state in
            state.id == targetId
        }
        var descriptor = FetchDescriptor<DedaoSyncState>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        let state: DedaoSyncState
        if let existing = try modelContext.fetch(descriptor).first {
            state = existing
        } else {
            state = DedaoSyncState()
            modelContext.insert(state)
        }
        
        if let date = lastFullSyncAt {
            state.lastFullSyncAt = date
        }
        if let date = lastIncrementalSyncAt {
            state.lastIncrementalSyncAt = date
        }
        
        try modelContext.save()
    }
    
    // MARK: - 清理
    
    /// 清除所有数据
    func clearAllData() throws {
        // 删除所有高亮
        let highlightDescriptor = FetchDescriptor<CachedDedaoHighlight>()
        let highlights = try modelContext.fetch(highlightDescriptor)
        for highlight in highlights {
            modelContext.delete(highlight)
        }
        
        // 删除所有书籍
        let bookDescriptor = FetchDescriptor<CachedDedaoBook>()
        let books = try modelContext.fetch(bookDescriptor)
        for book in books {
            modelContext.delete(book)
        }
        
        // 删除同步状态
        let stateDescriptor = FetchDescriptor<DedaoSyncState>()
        let states = try modelContext.fetch(stateDescriptor)
        for state in states {
            modelContext.delete(state)
        }
        
        try modelContext.save()
        logger.info("[DedaoCache] Cleared all local data")
    }
    
    // MARK: - 统计
    
    /// 获取数据统计
    func getDataStats() throws -> DedaoDataStats {
        let bookDescriptor = FetchDescriptor<CachedDedaoBook>()
        let books = try modelContext.fetch(bookDescriptor)
        
        let highlightDescriptor = FetchDescriptor<CachedDedaoHighlight>()
        let highlights = try modelContext.fetch(highlightDescriptor)
        
        let targetId = "global"
        let predicate = #Predicate<DedaoSyncState> { state in
            state.id == targetId
        }
        var stateDescriptor = FetchDescriptor<DedaoSyncState>(predicate: predicate)
        stateDescriptor.fetchLimit = 1
        let state = try modelContext.fetch(stateDescriptor).first
        
        return DedaoDataStats(
            bookCount: books.count,
            highlightCount: highlights.count,
            lastSyncAt: state?.lastIncrementalSyncAt ?? state?.lastFullSyncAt
        )
    }
    
    // MARK: - 智能增量同步
    
    /// 获取指定书籍的最新高亮修改时间（用于智能增量同步判断）
    func getMaxHighlightUpdatedAt(bookId: String) throws -> Date? {
        let targetBookId = bookId
        let predicate = #Predicate<CachedDedaoHighlight> { highlight in
            highlight.bookId == targetBookId
        }
        let descriptor = FetchDescriptor<CachedDedaoHighlight>(predicate: predicate)
        let highlights = try modelContext.fetch(descriptor)
        
        // 返回所有高亮中最新的 updatedAt
        return highlights.compactMap { $0.updatedAt }.max()
    }
    
    /// 批量获取所有书籍的最新高亮修改时间（用于智能增量同步判断）
    func getAllBooksMaxHighlightUpdatedAt() throws -> [String: Date] {
        let descriptor = FetchDescriptor<CachedDedaoHighlight>()
        let highlights = try modelContext.fetch(descriptor)
        
        // 按 bookId 分组，找出每本书的最新 updatedAt
        var result: [String: Date] = [:]
        for highlight in highlights {
            guard let updatedAt = highlight.updatedAt else { continue }
            if let existing = result[highlight.bookId] {
                if updatedAt > existing {
                    result[highlight.bookId] = updatedAt
                }
            } else {
                result[highlight.bookId] = updatedAt
            }
        }
        
        logger.debug("[DedaoCache] Calculated maxHighlightUpdatedAt for \(result.count) books")
        return result
    }
}
