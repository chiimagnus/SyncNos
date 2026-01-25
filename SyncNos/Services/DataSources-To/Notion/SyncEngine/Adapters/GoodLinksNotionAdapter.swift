import Foundation

/// GoodLinks 数据源适配器
final class GoodLinksNotionAdapter: NotionSyncSourceProtocol {
    
    // MARK: - Dependencies
    
    private let databaseService: GoodLinksDatabaseServiceExposed
    
    // MARK: - State
    
    private let link: GoodLinksLinkRow
    private let dbPath: String
    private let articleText: String?
    private let articleBlocks: [[String: Any]]?
    
    // MARK: - Initialization
    
    init(
        link: GoodLinksLinkRow,
        dbPath: String,
        articleText: String? = nil,
        articleBlocks: [[String: Any]]? = nil,
        databaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService
    ) {
        self.link = link
        self.dbPath = dbPath
        self.articleText = articleText
        self.articleBlocks = articleBlocks
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
    
    // MARK: - Header Content Hook
    
    /// 首次创建页面时的头部内容
    /// GoodLinks 需要在高亮之前添加 "Article" 标题和文章内容
    func headerContentForNewPage() -> [[String: Any]] {
        let helperMethods = NotionHelperMethods()
        var children: [[String: Any]] = []
        
        // 添加 "Article" 标题
        children.append([
            "object": "block",
            "heading_2": [
                "rich_text": [["text": ["content": "Article"]]]
            ]
        ])
        
        // 添加文章内容（如果有）
        if let blocks = articleBlocks, !blocks.isEmpty {
            children.append(contentsOf: blocks)
        } else if let contentText = articleText,
                  !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // 兼容降级：转换失败时仍回退到纯文本段落
            children.append(contentsOf: helperMethods.buildParagraphBlocks(from: contentText))
        }
        
        return children
    }
}

// MARK: - Factory

extension GoodLinksNotionAdapter {
    
    /// 创建适配器并预加载内容
    static func create(
        link: GoodLinksLinkRow,
        dbPath: String,
        databaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        urlFetcher: WebArticleFetcherProtocol = DIContainer.shared.webArticleFetcher,
        htmlToBlocksConverter: NotionHTMLToBlocksConverterProtocol = DIContainer.shared.notionHTMLToBlocksConverter
    ) async throws -> GoodLinksNotionAdapter {
        let logger = DIContainer.shared.loggerService

        let result: ArticleFetchResult?
        do {
            result = try await urlFetcher.fetchArticle(url: link.url)
        } catch URLFetchError.contentNotFound {
            result = nil
        }

        var blocks: [[String: Any]]?
        if let result, let baseURL = URL(string: link.url) {
            do {
                let converted = try await htmlToBlocksConverter.convertArticleHTMLToBlocks(
                    html: result.content,
                    baseURL: baseURL
                )
                blocks = converted.isEmpty ? nil : converted
            } catch {
                logger.warning("[GoodLinks] Failed to convert HTML to Notion blocks for \(link.url): \(error.localizedDescription)")
                blocks = nil
            }
        }
        
        return GoodLinksNotionAdapter(
            link: link,
            dbPath: dbPath,
            articleText: result?.textContent,
            articleBlocks: blocks,
            databaseService: databaseService
        )
    }
}
