import Foundation

protocol GoodLinksSyncServiceProtocol: AnyObject {
    func syncHighlights(for link: GoodLinksLinkRow, dbPath: String, pageSize: Int, progress: @escaping (String) -> Void) async throws
}

/// GoodLinks 同步服务实现（Facade）
/// 使用统一同步引擎处理同步逻辑，但保留 GoodLinks 特有的文章内容处理
final class GoodLinksSyncService: GoodLinksSyncServiceProtocol {
    
    // MARK: - Dependencies
    
    private let syncEngine: NotionSyncEngine
    private let notionService: NotionServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let databaseService: GoodLinksDatabaseServiceExposed
    private let logger: LoggerServiceProtocol
    private let timestampStore: SyncTimestampStoreProtocol
    private let helperMethods: NotionHelperMethods
    
    // MARK: - Initialization
    
    init(
        syncEngine: NotionSyncEngine = NotionSyncEngine(),
        notionService: NotionServiceProtocol = DIContainer.shared.notionService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        databaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        timestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.syncEngine = syncEngine
        self.notionService = notionService
        self.notionConfig = notionConfig
        self.databaseService = databaseService
        self.logger = logger
        self.timestampStore = timestampStore
        self.helperMethods = NotionHelperMethods()
    }
    
    // MARK: - GoodLinksSyncServiceProtocol
    
    func syncHighlights(
        for link: GoodLinksLinkRow,
        dbPath: String,
        pageSize: Int = NotionSyncConfig.goodLinksPageSize,
        progress: @escaping (String) -> Void
    ) async throws {
        // GoodLinks 需要特殊处理：首次创建页面时需要添加文章内容
        // 因此这里使用混合方式：部分使用引擎，部分自定义处理
        
        // 1. 校验 Notion 配置
        guard let parentPageId = notionConfig.notionPageId else {
            throw NSError(
                domain: "NotionSync",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please set NOTION_PAGE_ID in Notion Integration view first.", comment: "")]
            )
        }
        guard let token = notionConfig.effectiveToken, !token.isEmpty else {
            throw NSError(
                domain: "NotionSync",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please authorize Notion first.", comment: "")]
            )
        }
        
        // 2. 创建适配器
        let adapter = try GoodLinksNotionAdapter.create(
            link: link,
            dbPath: dbPath,
            databaseService: databaseService
        )
        
        // 3. 确保数据库存在
        let databaseId = try await ensureDatabaseExists(
            title: adapter.databaseTitle,
            parentPageId: parentPageId,
            sourceKey: adapter.sourceKey
        )
        
        // 4. 确保数据库属性
        var propertyDefinitions: [String: Any] = ["Last Sync Time": ["date": [:]]]
        propertyDefinitions.merge(adapter.additionalPropertyDefinitions) { _, new in new }
        try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: propertyDefinitions)
        
        // 5. 确保页面存在
        let item = adapter.syncItem
        let ensured = try await notionService.ensureBookPageInDatabase(
            databaseId: databaseId,
            bookTitle: item.title,
            author: item.author,
            assetId: item.itemId,
            urlString: item.url,
            header: nil
        )
        let pageId = ensured.id
        let created = ensured.created
        
        // 6. 更新额外页面属性
        let additionalProps = adapter.additionalPageProperties()
        if !additionalProps.isEmpty {
            try await notionService.updatePageProperties(pageId: pageId, properties: additionalProps)
        }
        
        // 7. 获取高亮数据
        progress(NSLocalizedString("Fetching highlights...", comment: ""))
        let highlights = try await adapter.fetchHighlights()
        
        // 8. 首次创建页面：添加文章内容 + 高亮
        if created {
            try await handleNewPage(
                pageId: pageId,
                highlights: highlights,
                adapter: adapter,
                item: item,
                progress: progress
            )
        } else {
            // 9. 已存在的页面：增量更新
            try await handleExistingPage(
                pageId: pageId,
                highlights: highlights,
                adapter: adapter,
                item: item,
                progress: progress
            )
        }
        
        // 10. 更新计数和时间戳
        try await notionService.updatePageHighlightCount(pageId: pageId, count: highlights.count)
        let nowString = notionSystemTimeZoneIsoDateFormatter.string(from: Date())
        try await notionService.updatePageProperties(pageId: pageId, properties: [
            "Last Sync Time": ["date": ["start": nowString]]
        ])
        timestampStore.setLastSyncTime(for: item.itemId, to: Date())
    }
    
    // MARK: - Private Helpers
    
    private func ensureDatabaseExists(
        title: String,
        parentPageId: String,
        sourceKey: String
    ) async throws -> String {
        if let persisted = notionConfig.databaseIdForSource(sourceKey) {
            if await notionService.databaseExists(databaseId: persisted) {
                return persisted
            }
            notionConfig.setDatabaseId(nil, forSource: sourceKey)
        }
        return try await notionService.ensureDatabaseIdForSource(
            title: title,
            parentPageId: parentPageId,
            sourceKey: sourceKey
        )
    }
    
    private func handleNewPage(
        pageId: String,
        highlights: [UnifiedHighlight],
        adapter: GoodLinksNotionAdapter,
        item: UnifiedSyncItem,
        progress: @escaping (String) -> Void
    ) async throws {
        // Phase 1: Article + content
        var headerChildren: [[String: Any]] = []
        headerChildren.append([
            "object": "block",
            "heading_2": [
                "rich_text": [["text": ["content": "Article"]]]
            ]
        ])
        
        if let contentText = adapter.getArticleContent(),
           !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let articleBlocks = helperMethods.buildParagraphBlocks(from: contentText)
            headerChildren.append(contentsOf: articleBlocks)
        }
        
        try await notionService.appendChildren(
            pageId: pageId,
            children: headerChildren,
            batchSize: NotionSyncConfig.defaultAppendBatchSize
        )
        
        // Phase 2: Highlights header + append all highlights
        if !highlights.isEmpty {
            progress(String(format: NSLocalizedString("Adding %lld highlights...", comment: ""), highlights.count))
            
            var children: [[String: Any]] = [[
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": "Highlights"]]]
                ]
            ]]
            
            for h in highlights {
                let highlightRow = h.toHighlightRow(assetId: item.itemId)
                let block = helperMethods.buildBulletedListItemBlock(
                    for: highlightRow,
                    bookId: item.itemId,
                    maxTextLength: NotionSyncConfig.maxTextLengthPrimary,
                    source: adapter.sourceKey
                )
                children.append(block)
            }
            
            try await notionService.appendChildren(
                pageId: pageId,
                children: children,
                batchSize: NotionSyncConfig.defaultAppendBatchSize
            )
        }
    }
    
    private func handleExistingPage(
        pageId: String,
        highlights: [UnifiedHighlight],
        adapter: GoodLinksNotionAdapter,
        item: UnifiedSyncItem,
        progress: @escaping (String) -> Void
    ) async throws {
        // 收集现有 UUID 映射
        let existingMapWithToken = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId)
        
        var toUpdate: [(String, HighlightRow)] = []
        var toAppend: [HighlightRow] = []
        
        for h in highlights {
            let highlightRow = h.toHighlightRow(assetId: item.itemId)
            
            if let existing = existingMapWithToken[h.uuid] {
                let localToken = helperMethods.computeModifiedToken(for: highlightRow, source: adapter.sourceKey)
                if let remoteToken = existing.token, remoteToken == localToken {
                    continue
                }
                toUpdate.append((existing.blockId, highlightRow))
            } else {
                toAppend.append(highlightRow)
            }
        }
        
        // 执行更新
        if !toUpdate.isEmpty {
            progress(String(format: NSLocalizedString("Updating %lld existing highlights...", comment: ""), toUpdate.count))
            for (blockId, h) in toUpdate {
                try await notionService.updateBlockContent(
                    blockId: blockId,
                    highlight: h,
                    bookId: item.itemId,
                    source: adapter.sourceKey
                )
            }
        }
        
        // 追加新高亮
        if !toAppend.isEmpty {
            progress(String(format: NSLocalizedString("Appending %lld new highlights...", comment: ""), toAppend.count))
            var children: [[String: Any]] = []
            for h in toAppend {
                let block = helperMethods.buildBulletedListItemBlock(
                    for: h,
                    bookId: item.itemId,
                    maxTextLength: NotionSyncConfig.maxTextLengthPrimary,
                    source: adapter.sourceKey
                )
                children.append(block)
            }
            try await notionService.appendChildren(
                pageId: pageId,
                children: children,
                batchSize: NotionSyncConfig.defaultAppendBatchSize
            )
        }
    }
}
