import Foundation

/// WeRead 数据源适配器
final class WeReadNotionAdapter: NotionSyncSourceProtocol {
    
    // MARK: - Dependencies
    
    private let apiService: WeReadAPIServiceProtocol
    
    // MARK: - State
    
    private let book: WeReadBookListItem
    
    // MARK: - Initialization
    
    init(
        book: WeReadBookListItem,
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService
    ) {
        self.book = book
        self.apiService = apiService
    }
    
    // MARK: - NotionSyncSourceProtocol
    
    var sourceKey: String { "weRead" }
    
    var databaseTitle: String { "SyncNos-WeRead" }
    
    var highlightSource: HighlightSource { .weRead }
    
    var syncItem: UnifiedSyncItem {
        UnifiedSyncItem(from: book)
    }
    
    var additionalPropertyDefinitions: [String: Any] {
        [
            "Author": ["rich_text": [:]],
            "WeRead Book ID": ["rich_text": [:]],
            "Category": ["rich_text": [:]]
        ]
    }
    
    var supportedStrategies: [NotionSyncStrategy] {
        [.singleDatabase]
    }
    
    var currentStrategy: NotionSyncStrategy {
        .singleDatabase
    }
    
    func fetchHighlights() async throws -> [UnifiedHighlight] {
        // 从 WeRead API 拉取合并后的高亮（已包含关联的想法）
        let mergedBookmarks = try await apiService.fetchMergedHighlights(bookId: book.bookId)
        return mergedBookmarks.map { UnifiedHighlight(from: $0) }
    }
    
    func additionalPageProperties() -> [String: Any] {
        var properties: [String: Any] = [:]
        
        // Author
        if !book.author.isEmpty {
            properties["Author"] = ["rich_text": [["text": ["content": book.author]]]]
        }
        
        // WeRead Book ID
        properties["WeRead Book ID"] = ["rich_text": [["text": ["content": book.bookId]]]]
        
        return properties
    }
}

// MARK: - Factory

extension WeReadNotionAdapter {
    
    /// 创建适配器
    static func create(
        book: WeReadBookListItem,
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService
    ) -> WeReadNotionAdapter {
        WeReadNotionAdapter(book: book, apiService: apiService)
    }
}

