import Foundation

/// Apple Books 数据源适配器
/// 支持 SingleDB 和 PerBook 两种同步策略
final class AppleBooksNotionAdapter: NotionSyncSourceProtocol, NotionPerBookSyncSourceProtocol {
    
    // MARK: - Dependencies
    
    private let databaseService: DatabaseServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let helperMethods: NotionHelperMethods
    
    // MARK: - State
    
    private let book: BookListItem
    private let dbPath: String?
    private let strategy: NotionSyncStrategy
    
    // MARK: - Initialization
    
    init(
        book: BookListItem,
        dbPath: String?,
        strategy: NotionSyncStrategy = .singleDatabase,
        databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.book = book
        self.dbPath = dbPath
        self.strategy = strategy
        self.databaseService = databaseService
        self.notionConfig = notionConfig
        self.helperMethods = NotionHelperMethods()
    }
    
    // MARK: - NotionSyncSourceProtocol
    
    var sourceKey: String { "appleBooks" }
    
    var databaseTitle: String { "SyncNos-AppleBooks" }
    
    var highlightSource: HighlightSource { .appleBooks }
    
    var syncItem: UnifiedSyncItem {
        UnifiedSyncItem(from: book)
    }
    
    var additionalPropertyDefinitions: [String: Any] {
        [:] // Apple Books 不需要额外属性
    }
    
    var supportedStrategies: [NotionSyncStrategy] {
        [.singleDatabase, .perBookDatabase]
    }
    
    var currentStrategy: NotionSyncStrategy {
        strategy
    }
    
    func fetchHighlights() async throws -> [UnifiedHighlight] {
        guard let path = dbPath else {
            return []
        }
        
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }
        
        var highlights: [UnifiedHighlight] = []
        let pageSize = NotionSyncConfig.appleBooksSingleDBPageSize
        var offset = 0
        
        while true {
            let page = try databaseService.fetchHighlightPage(
                db: handle,
                assetId: book.bookId,
                limit: pageSize,
                offset: offset
            )
            if page.isEmpty { break }
            
            highlights.append(contentsOf: page.map { UnifiedHighlight(from: $0) })
            offset += pageSize
        }
        
        return highlights
    }
    
    func additionalPageProperties() -> [String: Any] {
        [:] // Apple Books 不需要额外页面属性
    }
    
    // MARK: - NotionPerBookSyncSourceProtocol
    
    var perBookPropertyDefinitions: [String: Any] {
        [
            "Text": ["title": [:]],
            "UUID": ["rich_text": [:]],
            "Note": ["rich_text": [:]],
            "Style": ["rich_text": [:]],
            "Added At": ["date": [:]],
            "Modified At": ["date": [:]],
            "Location": ["rich_text": [:]],
            "Book ID": ["rich_text": [:]],
            "Book Title": ["rich_text": [:]],
            "Author": ["rich_text": [:]],
            "Link": ["url": [:]]
        ]
    }
    
    func buildHighlightProperties(for highlight: UnifiedHighlight) -> [String: Any] {
        let highlightRow = highlight.toHighlightRow(assetId: book.bookId)
        return helperMethods.buildHighlightProperties(
            bookId: book.bookId,
            bookTitle: book.bookTitle,
            author: book.authorName,
            highlight: highlightRow,
            source: sourceKey
        )
    }
    
    func buildHighlightChildren(for highlight: UnifiedHighlight) -> [[String: Any]] {
        let highlightRow = highlight.toHighlightRow(assetId: book.bookId)
        return helperMethods.buildPerBookPageChildren(
            for: highlightRow,
            bookId: book.bookId,
            source: sourceKey
        )
    }
}

// MARK: - Factory

extension AppleBooksNotionAdapter {
    
    /// 根据配置创建适配器
    static func create(
        book: BookListItem,
        dbPath: String?,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) -> AppleBooksNotionAdapter {
        let mode = notionConfig.syncMode ?? "single"
        let strategy: NotionSyncStrategy = mode == "perBook" ? .perBookDatabase : .singleDatabase
        
        return AppleBooksNotionAdapter(
            book: book,
            dbPath: dbPath,
            strategy: strategy,
            notionConfig: notionConfig
        )
    }
}

