import Foundation

/// GoodLinks 数据源适配器
final class GoodLinksNotionAdapter: NotionSyncSourceProtocol {
    
    // MARK: - Dependencies
    
    private let databaseService: GoodLinksDatabaseServiceExposed
    
    // MARK: - State
    
    private let link: GoodLinksLinkRow
    private let dbPath: String
    private let contentRow: GoodLinksContentRow?
    
    // MARK: - Initialization
    
    init(
        link: GoodLinksLinkRow,
        dbPath: String,
        contentRow: GoodLinksContentRow? = nil,
        databaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService
    ) {
        self.link = link
        self.dbPath = dbPath
        self.contentRow = contentRow
        self.databaseService = databaseService
    }
    
    // MARK: - NotionSyncSourceProtocol
    
    var sourceKey: String { "goodLinks" }
    
    var databaseTitle: String { "SyncNos-GoodLinks" }
    
    var highlightSource: HighlightSource { .goodLinks }
    
    var syncItem: UnifiedSyncItem {
        UnifiedSyncItem(from: link)
    }
    
    var additionalPropertyDefinitions: [String: Any] {
        [
            "Tags": ["multi_select": [:]],
            "Summary": ["rich_text": [:]],
            "Starred": ["checkbox": [:]],
            "Added At": ["date": [:]],
            "Modified At": ["date": [:]]
        ]
    }
    
    var supportedStrategies: [NotionSyncStrategy] {
        [.singleDatabase]
    }
    
    var currentStrategy: NotionSyncStrategy {
        .singleDatabase
    }
    
    func fetchHighlights() async throws -> [UnifiedHighlight] {
        let session = try databaseService.makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }
        
        var highlights: [UnifiedHighlight] = []
        let pageSize = NotionSyncConfig.goodLinksPageSize
        var offset = 0
        
        while true {
            let page = try session.fetchHighlightsForLink(linkId: link.id, limit: pageSize, offset: offset)
            if page.isEmpty { break }
            
            highlights.append(contentsOf: page.map { UnifiedHighlight(from: $0, linkId: link.id) })
            offset += pageSize
        }
        
        return highlights
    }
    
    func additionalPageProperties() -> [String: Any] {
        var properties: [String: Any] = [:]
        
        // Tags
        if let tags = link.tags, !tags.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let tagNames = GoodLinksTagParser.parseTagsString(tags)
            if !tagNames.isEmpty {
                properties["Tags"] = [
                    "multi_select": tagNames.map { ["name": $0] }
                ]
            }
        }
        
        // Summary
        if let summary = link.summary, !summary.isEmpty {
            properties["Summary"] = ["rich_text": [["text": ["content": summary]]]]
        }
        
        // Starred
        properties["Starred"] = ["checkbox": link.starred]
        
        // Added At
        if link.addedAt > 0 {
            let start = notionSystemTimeZoneDateFormatter.string(from: Date(timeIntervalSince1970: link.addedAt))
            properties["Added At"] = ["date": ["start": start]]
        }
        
        // Modified At
        if link.modifiedAt > 0 {
            let start = notionSystemTimeZoneDateFormatter.string(from: Date(timeIntervalSince1970: link.modifiedAt))
            properties["Modified At"] = ["date": ["start": start]]
        }
        
        return properties
    }
    
    // MARK: - GoodLinks Specific
    
    /// 获取文章内容（用于首次创建页面时添加）
    func getArticleContent() -> String? {
        contentRow?.content
    }
}

// MARK: - Factory

extension GoodLinksNotionAdapter {
    
    /// 创建适配器并预加载内容
    static func create(
        link: GoodLinksLinkRow,
        dbPath: String,
        databaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService
    ) throws -> GoodLinksNotionAdapter {
        // 预加载内容
        let contentRow = try databaseService.fetchContent(dbPath: dbPath, linkId: link.id)
        
        return GoodLinksNotionAdapter(
            link: link,
            dbPath: dbPath,
            contentRow: contentRow,
            databaseService: databaseService
        )
    }
}

