import Foundation

/// Dedao 数据源适配器
/// 将得到电子书笔记同步到 Notion
final class DedaoNotionAdapter: NotionSyncSourceProtocol {
    
    // MARK: - Dependencies
    
    private let apiService: DedaoAPIServiceProtocol
    private let cacheService: DedaoCacheServiceProtocol
    
    // MARK: - State
    
    private let book: DedaoBookListItem
    
    /// 是否优先使用本地缓存
    private let preferCache: Bool
    
    // MARK: - Initialization
    
    init(
        book: DedaoBookListItem,
        apiService: DedaoAPIServiceProtocol,
        cacheService: DedaoCacheServiceProtocol,
        preferCache: Bool = false
    ) {
        self.book = book
        self.apiService = apiService
        self.cacheService = cacheService
        self.preferCache = preferCache
    }
    
    // MARK: - NotionSyncSourceProtocol
    
    var sourceKey: String { "dedao" }
    
    var databaseTitle: String { "SyncNos-Dedao" }
    
    var highlightSource: HighlightSource { .dedao }
    
    var syncItem: UnifiedSyncItem {
        UnifiedSyncItem(from: book)
    }
    
    var additionalPropertyDefinitions: [String: Any] {
        [
            "Author": ["rich_text": [:]],
            "Dedao Book ID": ["rich_text": [:]]
        ]
    }
    
    var supportedStrategies: [NotionSyncStrategy] {
        [.singleDatabase]
    }
    
    var currentStrategy: NotionSyncStrategy {
        .singleDatabase
    }
    
    func fetchHighlights() async throws -> [UnifiedHighlight] {
        if preferCache {
            // 优先使用本地缓存
            let cachedHighlights = try await cacheService.getHighlights(bookId: book.bookId)
            
            if !cachedHighlights.isEmpty {
                return cachedHighlights.map { UnifiedHighlight(from: $0) }
            }
        }
        
        // 从 API 获取
        let notes = try await apiService.fetchEbookNotes(ebookEnid: book.bookId)
        
        // 保存到本地缓存（忽略错误）
        do {
            try await cacheService.saveHighlights(notes, bookId: book.bookId)
        } catch {
            // 缓存失败不影响同步
        }
        
        return notes.map { UnifiedHighlight(from: $0) }
    }
    
    func additionalPageProperties() -> [String: Any] {
        var properties: [String: Any] = [:]
        
        // Author
        if !book.author.isEmpty {
            properties["Author"] = ["rich_text": [["text": ["content": book.author]]]]
        }
        
        // Dedao Book ID
        properties["Dedao Book ID"] = ["rich_text": [["text": ["content": book.bookId]]]]
        
        return properties
    }
}

// MARK: - Factory

extension DedaoNotionAdapter {
    
    /// 创建适配器（使用 DIContainer）
    @MainActor
    static func create(
        book: DedaoBookListItem,
        preferCache: Bool = false
    ) -> DedaoNotionAdapter {
        DedaoNotionAdapter(
            book: book,
            apiService: DIContainer.shared.dedaoAPIService,
            cacheService: DIContainer.shared.dedaoCacheService,
            preferCache: preferCache
        )
    }
}


