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
        var children: [[String: Any]] = []
        
        // 添加 "Article" 标题
        children.append([
            "object": "block",
            "heading_2": [
                "rich_text": [["text": ["content": "Article"]]]
            ]
        ])
        
        // 优先使用 articleBlocks（富内容），否则回退到 articleText（纯文本）
        if let blocks = articleBlocks, !blocks.isEmpty {
            // 使用富内容 blocks（包含图片和样式）
            children.append(contentsOf: blocks)
        } else if let contentText = articleText,
                  !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // 回退到纯文本段落
            let helperMethods = NotionHelperMethods()
            let paragraphs = helperMethods.buildParagraphBlocks(from: contentText)
            children.append(contentsOf: paragraphs)
        }
        
        return children
    }
}

// MARK: - Factory

extension GoodLinksNotionAdapter {
    
    /// 创建适配器并预加载内容
    @MainActor
    static func create(
        link: GoodLinksLinkRow,
        dbPath: String,
        databaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        urlFetcher: GoodLinksURLFetcherProtocol = DIContainer.shared.goodLinksURLFetcher,
        htmlConverter: NotionHTMLToBlocksConverterProtocol = DIContainer.shared.notionHTMLToBlocksConverter
    ) async throws -> GoodLinksNotionAdapter {
        let result: ArticleFetchResult?
        do {
            result = try await urlFetcher.fetchArticle(url: link.url)
        } catch URLFetchError.contentNotFound {
            result = nil
        }
        
        // 尝试转换 HTML 为 Notion blocks
        var articleBlocks: [[String: Any]]? = nil
        if let fetchResult = result,
           !fetchResult.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let baseURL = URL(string: link.url) {
            do {
                articleBlocks = try await htmlConverter.convertArticleHTMLToBlocks(
                    html: fetchResult.content,
                    baseURL: baseURL
                )
            } catch {
                // 转换失败时记录日志，但不影响同步（降级为纯文本）
                DIContainer.shared.loggerService.warning(
                    "[GoodLinksNotionAdapter] HTML to blocks conversion failed for url=\(link.url): \(error.localizedDescription)"
                )
            }
        }
        
        return GoodLinksNotionAdapter(
            link: link,
            dbPath: dbPath,
            articleText: result?.textContent,
            articleBlocks: articleBlocks,
            databaseService: databaseService
        )
    }
}
