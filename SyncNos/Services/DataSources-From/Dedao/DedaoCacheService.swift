import Foundation
import SwiftData

// MARK: - Dedao Cache Error

/// Dedao 缓存服务错误
enum DedaoCacheError: LocalizedError {
    case modelContainerNotAvailable
    case modelContainerCreationFailed(Error)
    
    var errorDescription: String? {
        switch self {
        case .modelContainerNotAvailable:
            return "Dedao cache storage is not available"
        case .modelContainerCreationFailed(let error):
            return "Failed to create Dedao cache storage: \(error.localizedDescription)"
        }
    }
}

// MARK: - Dedao Cache Service

/// Dedao 本地数据存储服务实现
/// 使用 SwiftData 持久化书籍和高亮数据
/// 与 Apple Books 的 DatabaseService 设计一致：初始化不会失败，方法调用时处理错误
final class DedaoCacheService: DedaoCacheServiceProtocol {
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
            throw DedaoCacheError.modelContainerCreationFailed(error)
        }
        
        // 如果已经创建成功，直接返回
        if let container = _modelContainer {
            return container
        }
        
        // 首次创建
        do {
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
            
            let container = try ModelContainer(
                for: schema,
                configurations: [modelConfiguration]
            )
            
            _modelContainer = container
            logger.info("[DedaoCache] ModelContainer created successfully")
            return container
        } catch {
            containerCreationError = error
            logger.error("[DedaoCache] Failed to create ModelContainer: \(error.localizedDescription)")
            throw DedaoCacheError.modelContainerCreationFailed(error)
        }
    }
    
    // MARK: - 书籍操作
    
    /// 获取所有书籍（在后台线程执行）
    func getAllBooks() async throws -> [CachedDedaoBook] {
        let container = try getModelContainer()
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            let descriptor = FetchDescriptor<CachedDedaoBook>(
                sortBy: [SortDescriptor(\.title, order: .forward)]
            )
            return try context.fetch(descriptor)
        }.value
    }
    
    /// 获取指定书籍（在后台线程执行）
    func getBook(bookId: String) async throws -> CachedDedaoBook? {
        let container = try getModelContainer()
        let targetBookId = bookId
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            let predicate = #Predicate<CachedDedaoBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            let results = try context.fetch(descriptor)
            return results.first
        }.value
    }
    
    /// 保存书籍列表（在后台线程执行）
    func saveBooks(_ ebooks: [DedaoEbook]) async throws {
        let container = try getModelContainer()
        let logger = self.logger
        let ebookCount = ebooks.count
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
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
            logger.info("[DedaoCache] Saved \(ebookCount) books to local storage")
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
            logger.info("[DedaoCache] Deleted \(idCount) books from local storage")
        }.value
    }
    
    /// 更新书籍的高亮数量（在后台线程执行）
    func updateBookHighlightCount(bookId: String, count: Int) async throws {
        let container = try getModelContainer()
        let targetBookId = bookId
        let targetCount = count
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            let predicate = #Predicate<CachedDedaoBook> { book in
                book.bookId == targetBookId
            }
            var descriptor = FetchDescriptor<CachedDedaoBook>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            if let book = try context.fetch(descriptor).first {
                book.highlightCount = targetCount
                try context.save()
            }
        }.value
    }
    
    // MARK: - 高亮操作
    
    /// 获取指定书籍的高亮（在后台线程执行）
    func getHighlights(bookId: String) async throws -> [CachedDedaoHighlight] {
        let container = try getModelContainer()
        let targetBookId = bookId
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            let predicate = #Predicate<CachedDedaoHighlight> { highlight in
                highlight.bookId == targetBookId
            }
            let descriptor = FetchDescriptor<CachedDedaoHighlight>(
                predicate: predicate,
                sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
            )
            return try context.fetch(descriptor)
        }.value
    }
    
    /// 保存高亮列表（在后台线程执行）
    func saveHighlights(_ notes: [DedaoEbookNote], bookId: String) async throws {
        let container = try getModelContainer()
        let targetBookId = bookId
        let logger = self.logger
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
            // 获取关联的书籍
            let bookPredicate = #Predicate<CachedDedaoBook> { book in
                book.bookId == targetBookId
            }
            var bookDescriptor = FetchDescriptor<CachedDedaoBook>(predicate: bookPredicate)
            bookDescriptor.fetchLimit = 1
            let book = try context.fetch(bookDescriptor).first
            
            // ⚠️ 先删除该书的所有旧高亮（完全替换策略，避免残留错误数据）
            let highlightPredicate = #Predicate<CachedDedaoHighlight> { highlight in
                highlight.bookId == targetBookId
            }
            let highlightDescriptor = FetchDescriptor<CachedDedaoHighlight>(predicate: highlightPredicate)
            let existingHighlights = try context.fetch(highlightDescriptor)
            let existingCount = existingHighlights.count
            for highlight in existingHighlights {
                context.delete(highlight)
            }
            
            // 插入新数据
            for note in notes {
                let newHighlight = CachedDedaoHighlight(from: note)
                newHighlight.bookId = targetBookId
                newHighlight.book = book
                context.insert(newHighlight)
            }
            
            try context.save()
            logger.info("[DedaoCache] Replaced \(existingCount) → \(notes.count) highlights for bookId=\(targetBookId)")
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
            logger.info("[DedaoCache] Deleted \(idCount) highlights from local storage")
        }.value
    }
    
    // MARK: - 同步状态
    
    /// 获取同步状态（在后台线程执行）
    func getSyncState() async throws -> DedaoSyncState {
        let container = try getModelContainer()
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
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
        }.value
    }
    
    /// 更新同步状态（在后台线程执行）
    func updateSyncState(lastFullSyncAt: Date?, lastIncrementalSyncAt: Date?) async throws {
        let container = try getModelContainer()
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            let targetId = "global"
            let predicate = #Predicate<DedaoSyncState> { state in
                state.id == targetId
            }
            var descriptor = FetchDescriptor<DedaoSyncState>(predicate: predicate)
            descriptor.fetchLimit = 1
            
            let state: DedaoSyncState
            if let existing = try context.fetch(descriptor).first {
                state = existing
            } else {
                state = DedaoSyncState()
                context.insert(state)
            }
            
            if let date = lastFullSyncAt {
                state.lastFullSyncAt = date
            }
            if let date = lastIncrementalSyncAt {
                state.lastIncrementalSyncAt = date
            }
            
            try context.save()
        }.value
    }
    
    // MARK: - 清理
    
    /// 清除所有数据（在后台线程执行）
    func clearAllData() async throws {
        let container = try getModelContainer()
        let logger = self.logger
        
        try await Task.detached(priority: .utility) {
            let context = ModelContext(container)
            
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
        }.value
    }
    
    // MARK: - 统计
    
    /// 获取数据统计（在后台线程执行）
    func getDataStats() async throws -> DedaoDataStats {
        let container = try getModelContainer()
        
        return try await Task.detached(priority: .userInitiated) {
            let context = ModelContext(container)
            
            let bookDescriptor = FetchDescriptor<CachedDedaoBook>()
            let books = try context.fetch(bookDescriptor)
            
            let highlightDescriptor = FetchDescriptor<CachedDedaoHighlight>()
            let highlights = try context.fetch(highlightDescriptor)
            
            let targetId = "global"
            let predicate = #Predicate<DedaoSyncState> { state in
                state.id == targetId
            }
            var stateDescriptor = FetchDescriptor<DedaoSyncState>(predicate: predicate)
            stateDescriptor.fetchLimit = 1
            let state = try context.fetch(stateDescriptor).first
            
            return DedaoDataStats(
                bookCount: books.count,
                highlightCount: highlights.count,
                lastSyncAt: state?.lastIncrementalSyncAt ?? state?.lastFullSyncAt
            )
        }.value
    }
}
