import Foundation
import SwiftData

// MARK: - Dedao Cache Service

/// Dedao 本地数据存储服务实现
/// 使用 SwiftData 持久化书籍和高亮数据
final class DedaoCacheService: DedaoCacheServiceProtocol {
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
    func getAllBooks() async throws -> [CachedDedaoBook] {
        let context = modelContainer.mainContext
        let descriptor = FetchDescriptor<CachedDedaoBook>(
            sortBy: [SortDescriptor(\.title, order: .forward)]
        )
        let books = try context.fetch(descriptor)
        logger.debug("[DedaoCache] Fetched \(books.count) books from local storage")
        return books
    }
    
    @MainActor
    func getBook(bookId: String) async throws -> CachedDedaoBook? {
        let context = modelContainer.mainContext
        let targetBookId = bookId
        let predicate = #Predicate<CachedDedaoBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        let results = try context.fetch(descriptor)
        return results.first
    }
    
    @MainActor
    func saveBooks(_ ebooks: [DedaoEbook]) async throws {
        let context = modelContainer.mainContext
        
        for ebook in ebooks {
            // 检查是否已存在
            let targetBookId = ebook.effectiveId
            let predicate = #Predicate<CachedDedaoBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            let existing = try context.fetch(descriptor).first
            
            if let existing {
                // 更新现有记录
                existing.title = ebook.title
                existing.author = ebook.author ?? ""
                existing.cover = ebook.icon
                existing.lastFetchedAt = Date()
            } else {
                // 创建新记录
                let newBook = CachedDedaoBook(from: ebook)
                newBook.lastFetchedAt = Date()
                context.insert(newBook)
            }
        }
        
        try context.save()
        logger.info("[DedaoCache] Saved \(ebooks.count) books to local storage")
    }
    
    @MainActor
    func deleteBooks(ids: [String]) async throws {
        let context = modelContainer.mainContext
        
        for bookId in ids {
            let targetBookId = bookId
            let predicate = #Predicate<CachedDedaoBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let book = try context.fetch(descriptor).first {
                context.delete(book)
            }
        }
        
        try context.save()
        logger.info("[DedaoCache] Deleted \(ids.count) books from local storage")
    }
    
    @MainActor
    func updateBookHighlightCount(bookId: String, count: Int) async throws {
        let context = modelContainer.mainContext
        let targetBookId = bookId
        let predicate = #Predicate<CachedDedaoBook> { book in
            book.bookId == targetBookId
        }
        var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let book = try context.fetch(descriptor).first {
            book.highlightCount = count
            try context.save()
        }
    }
    
    // MARK: - 高亮操作
    
    @MainActor
    func getHighlights(bookId: String) async throws -> [CachedDedaoHighlight] {
        let context = modelContainer.mainContext
        let targetBookId = bookId
        let predicate = #Predicate<CachedDedaoHighlight> { highlight in
            highlight.bookId == targetBookId
        }
        let descriptor = FetchDescriptor<CachedDedaoHighlight>(
            predicate: predicate,
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        let highlights = try context.fetch(descriptor)
        logger.debug("[DedaoCache] Fetched \(highlights.count) highlights for bookId=\(bookId)")
        return highlights
    }
    
    @MainActor
    func saveHighlights(_ notes: [DedaoEbookNote], bookId: String) async throws {
        let context = modelContainer.mainContext
        
        // 获取关联的书籍
        let targetBookId = bookId
        let bookPredicate = #Predicate<CachedDedaoBook> { book in
            book.bookId == targetBookId
        }
        var bookDescriptor = FetchDescriptor<CachedDedaoBook>(predicate: bookPredicate)
        bookDescriptor.fetchLimit = 1
        let book = try context.fetch(bookDescriptor).first
        
        for note in notes {
            // 检查是否已存在
            let targetHighlightId = note.noteIdStr
            let predicate = #Predicate<CachedDedaoHighlight> { highlight in
                highlight.highlightId == targetHighlightId
            }
            var descriptor = FetchDescriptor<CachedDedaoHighlight>(predicate: predicate)
            descriptor.fetchLimit = 1
            let existing = try context.fetch(descriptor).first
            
            if let existing {
                // 更新现有记录
                existing.text = note.noteLine
                existing.note = note.note.isEmpty ? nil : note.note
                existing.chapterTitle = note.extra.title  // 可选
                existing.bookSection = note.extra.bookSection  // 可选
                existing.updatedAt = Date(timeIntervalSince1970: TimeInterval(note.updateTime))
            } else {
                // 创建新记录
                let newHighlight = CachedDedaoHighlight(from: note)
                newHighlight.bookId = bookId
                newHighlight.book = book
                context.insert(newHighlight)
            }
        }
        
        try context.save()
        logger.info("[DedaoCache] Saved \(notes.count) highlights for bookId=\(bookId)")
    }
    
    @MainActor
    func deleteHighlights(ids: [String]) async throws {
        let context = modelContainer.mainContext
        
        for highlightId in ids {
            let targetHighlightId = highlightId
            let predicate = #Predicate<CachedDedaoHighlight> { highlight in
                highlight.highlightId == targetHighlightId
            }
            var descriptor = FetchDescriptor<CachedDedaoHighlight>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let highlight = try context.fetch(descriptor).first {
                context.delete(highlight)
            }
        }
        
        try context.save()
        logger.info("[DedaoCache] Deleted \(ids.count) highlights from local storage")
    }
    
    // MARK: - 同步状态
    
    @MainActor
    func getSyncState() async throws -> DedaoSyncState {
        let context = modelContainer.mainContext
        let targetId = "global"
        let predicate = #Predicate<DedaoSyncState> { state in
            state.id == targetId
        }
        var descriptor = FetchDescriptor<DedaoSyncState>(predicate: predicate)
        descriptor.fetchLimit = 1
        
        if let existing = try context.fetch(descriptor).first {
            return existing
        }
        
        // 创建默认同步状态
        let newState = DedaoSyncState()
        context.insert(newState)
        try context.save()
        return newState
    }
    
    @MainActor
    func updateSyncState(lastFullSyncAt: Date?, lastIncrementalSyncAt: Date?) async throws {
        let context = modelContainer.mainContext
        let state = try await getSyncState()
        
        if let date = lastFullSyncAt {
            state.lastFullSyncAt = date
        }
        if let date = lastIncrementalSyncAt {
            state.lastIncrementalSyncAt = date
        }
        
        try context.save()
    }
    
    // MARK: - 清理
    
    @MainActor
    func clearAllData() async throws {
        let context = modelContainer.mainContext
        
        // 删除所有高亮
        let highlightDescriptor = FetchDescriptor<CachedDedaoHighlight>()
        let highlights = try context.fetch(highlightDescriptor)
        for highlight in highlights {
            context.delete(highlight)
        }
        
        // 删除所有书籍
        let bookDescriptor = FetchDescriptor<CachedDedaoBook>()
        let books = try context.fetch(bookDescriptor)
        for book in books {
            context.delete(book)
        }
        
        // 删除同步状态
        let stateDescriptor = FetchDescriptor<DedaoSyncState>()
        let states = try context.fetch(stateDescriptor)
        for state in states {
            context.delete(state)
        }
        
        try context.save()
        logger.info("[DedaoCache] Cleared all local data")
    }
    
    // MARK: - 统计
    
    @MainActor
    func getDataStats() async throws -> DedaoDataStats {
        let context = modelContainer.mainContext
        
        let bookDescriptor = FetchDescriptor<CachedDedaoBook>()
        let books = try context.fetch(bookDescriptor)
        
        let highlightDescriptor = FetchDescriptor<CachedDedaoHighlight>()
        let highlights = try context.fetch(highlightDescriptor)
        
        let state = try await getSyncState()
        
        return DedaoDataStats(
            bookCount: books.count,
            highlightCount: highlights.count,
            lastSyncAt: state.lastIncrementalSyncAt ?? state.lastFullSyncAt
        )
    }
}

