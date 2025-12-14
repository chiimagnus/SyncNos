import Foundation

/// 统一同步引擎
/// 处理所有数据源到 Notion 的通用同步逻辑
final class NotionSyncEngine {
    
    // MARK: - Dependencies
    
    private let notionService: NotionServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let logger: LoggerServiceProtocol
    private let timestampStore: SyncTimestampStoreProtocol
    private let helperMethods: NotionHelperMethods
    
    // MARK: - Initialization
    
    init(
        notionService: NotionServiceProtocol = DIContainer.shared.notionService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        timestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.notionService = notionService
        self.notionConfig = notionConfig
        self.logger = logger
        self.timestampStore = timestampStore
        self.helperMethods = NotionHelperMethods()
    }
    
    // MARK: - Public API
    
    /// 智能同步（根据上次同步时间自动选择全量/增量）
    func syncSmart(
        source: NotionSyncSourceProtocol,
        progress: @escaping (String) -> Void
    ) async throws {
        let item = source.syncItem
        let itemLabel = formatItemLabel(item)
        logger.info("[SmartSync] Starting sync for \(source.sourceKey): \(itemLabel)")

        let lastSync = timestampStore.getLastSyncTime(for: item.itemId)
        let incremental = lastSync != nil

        do {
            try await sync(source: source, incremental: incremental, progress: progress)
            logger.info("[SmartSync] Successfully completed sync for \(source.sourceKey): \(itemLabel)")
        } catch {
            logger.error("[SmartSync] Failed sync for \(source.sourceKey): \(itemLabel) - \(error.localizedDescription)")
            throw error
        }
    }
    
    /// 格式化书籍/文章标签用于日志显示
    private func formatItemLabel(_ item: UnifiedSyncItem) -> String {
        if item.author.isEmpty {
            return "《\(item.title)》"
        } else {
            return "《\(item.title)》(\(item.author))"
        }
    }
    
    /// 同步数据源到 Notion
    /// - Parameters:
    ///   - source: 数据源适配器
    ///   - incremental: 是否增量同步
    ///   - progress: 进度回调
    func sync(
        source: NotionSyncSourceProtocol,
        incremental: Bool,
        progress: @escaping (String) -> Void
    ) async throws {
        // 根据策略选择同步方式
        switch source.currentStrategy {
        case .singleDatabase:
            try await syncSingleDatabase(source: source, incremental: incremental, progress: progress)
        case .perBookDatabase:
            guard let perBookSource = source as? NotionPerBookSyncSourceProtocol else {
                throw NSError(
                    domain: "NotionSyncEngine",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Source does not support per-book database strategy"]
                )
            }
            try await syncPerBookDatabase(source: perBookSource, incremental: incremental, progress: progress)
        }
    }
    
    // MARK: - Single Database Strategy
    
    /// 单一数据库模式同步
    private func syncSingleDatabase(
        source: NotionSyncSourceProtocol,
        incremental: Bool,
        progress: @escaping (String) -> Void
    ) async throws {
        let item = source.syncItem
        let itemLabel = formatItemLabel(item)

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

        // 2. 确保数据库存在
        do {
            let databaseId = try await ensureDatabaseExists(
                title: source.databaseTitle,
                parentPageId: parentPageId,
                sourceKey: source.sourceKey
            )
            logger.debug("[SmartSync] Using database \(databaseId) for \(source.sourceKey)")
        } catch {
            logger.error("[SmartSync] Failed to ensure database exists for \(source.sourceKey): \(error.localizedDescription)")
            throw error
        }

        let databaseId = try await ensureDatabaseExists(
            title: source.databaseTitle,
            parentPageId: parentPageId,
            sourceKey: source.sourceKey
        )

        // 3. 确保数据库属性
        do {
            var propertyDefinitions = basePropertyDefinitions
            propertyDefinitions.merge(source.additionalPropertyDefinitions) { _, new in new }
            try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: propertyDefinitions)
        } catch {
            logger.error("[SmartSync] Failed to ensure database properties for \(source.sourceKey): \(error.localizedDescription)")
            throw error
        }

        // 4. 确保页面存在
        let ensured: (id: String, created: Bool)
        do {
            ensured = try await notionService.ensureBookPageInDatabase(
                databaseId: databaseId,
                bookTitle: item.title,
                author: item.author,
                assetId: item.itemId,
                urlString: item.url,
                header: item.source == .goodLinks ? nil : "Highlights"
            )
        } catch {
            logger.error("[SmartSync] Failed to ensure page for \(source.sourceKey): \(itemLabel) - \(error.localizedDescription)")
            throw error
        }

        let pageId = ensured.id
        let created = ensured.created

        // 5. 更新额外页面属性
        let additionalProps = source.additionalPageProperties()
        if !additionalProps.isEmpty {
            do {
                try await notionService.updatePageProperties(pageId: pageId, properties: additionalProps)
            } catch {
                logger.error("[SmartSync] Failed to update page properties for \(source.sourceKey): \(itemLabel) - \(error.localizedDescription)")
                throw error
            }
        }

        // 6. 获取高亮数据
        progress(NSLocalizedString("Fetching highlights...", comment: ""))
        let highlights: [UnifiedHighlight]
        do {
            highlights = try await source.fetchHighlights()
            logger.debug("[SmartSync] Fetched \(highlights.count) highlights for \(source.sourceKey): \(itemLabel)")
        } catch {
            logger.error("[SmartSync] Failed to fetch highlights for \(source.sourceKey): \(itemLabel) - \(error.localizedDescription)")
            throw error
        }

        // 7. 执行同步（如果有高亮）
        if !highlights.isEmpty {
            if created {
                // 新创建的页面：直接追加所有高亮
                do {
                    try await appendAllHighlights(
                        pageId: pageId,
                        highlights: highlights,
                        item: item,
                        source: source,
                        progress: progress
                    )
                    logger.debug("[SmartSync] Appended \(highlights.count) highlights to new page for \(source.sourceKey): \(itemLabel)")
                } catch {
                    logger.error("[SmartSync] Failed to append highlights to new page for \(source.sourceKey): \(itemLabel) - \(error.localizedDescription)")
                    throw error
                }
            } else {
                // 已存在的页面：增量更新
                do {
                    try await syncExistingPage(
                        pageId: pageId,
                        highlights: highlights,
                        item: item,
                        source: source,
                        incremental: incremental,
                        progress: progress
                    )
                    logger.debug("[SmartSync] Updated existing page with \(highlights.count) highlights for \(source.sourceKey): \(itemLabel)")
                } catch {
                    logger.error("[SmartSync] Failed to sync existing page for \(source.sourceKey): \(itemLabel) - \(error.localizedDescription)")
                    throw error
                }
            }
        } else {
            progress(NSLocalizedString("No highlights to sync.", comment: ""))
            logger.debug("[SmartSync] No highlights to sync for \(source.sourceKey): \(itemLabel)")
        }

        // 8. 更新计数和时间戳（无论是否有高亮都要更新）
        do {
            try await updateCountAndTimestamp(pageId: pageId, count: highlights.count, itemId: item.itemId)
            logger.debug("[SmartSync] Updated count and timestamp for \(source.sourceKey): \(itemLabel)")
        } catch {
            logger.error("[SmartSync] Failed to update count and timestamp for \(source.sourceKey): \(itemLabel) - \(error.localizedDescription)")
            throw error
        }
    }
    
    // MARK: - Per-Book Database Strategy
    
    /// 每本书独立数据库模式同步
    private func syncPerBookDatabase(
        source: NotionPerBookSyncSourceProtocol,
        incremental: Bool,
        progress: @escaping (String) -> Void
    ) async throws {
        let item = source.syncItem
        
        // 1. 确保数据库存在
        let ensured = try await notionService.ensurePerBookDatabase(
            bookTitle: item.title,
            author: item.author,
            assetId: item.itemId
        )
        var databaseId = ensured.id
        let recreated = ensured.recreated
        
        // 2. 获取高亮数据
        progress(NSLocalizedString("Fetching highlights...", comment: ""))
        let highlights = try await source.fetchHighlights()
        
        // 3. 如果没有高亮，只更新时间戳
        guard !highlights.isEmpty else {
            progress(NSLocalizedString("No highlights to sync.", comment: ""))
            timestampStore.setLastSyncTime(for: item.itemId, to: Date())
            return
        }
        
        // 4. 如果数据库是新创建的，执行全量同步
        if recreated {
            progress(NSLocalizedString("Detected database recreation, performing full sync...", comment: ""))
            try await fullSyncPerBook(
                databaseId: databaseId,
                highlights: highlights,
                item: item,
                source: source,
                progress: progress
            )
            timestampStore.setLastSyncTime(for: item.itemId, to: Date())
            return
        }
        
        // 4. 增量同步
        _ = incremental ? timestampStore.getLastSyncTime(for: item.itemId) : nil
        var batch = 0
        let pageSize = NotionSyncConfig.appleBooksPerBookPageSize
        
        for startIndex in stride(from: 0, to: highlights.count, by: pageSize) {
            let endIndex = min(startIndex + pageSize, highlights.count)
            let slice = Array(highlights[startIndex..<endIndex])
            
            progress(String(format: NSLocalizedString("Plan 2: Processing batch %d...", comment: ""), batch + 1))
            
            for h in slice {
                let highlightRow = h.toHighlightRow(assetId: item.itemId)
                
                do {
                    if let existingPageId = try await notionService.findHighlightItemPageIdByUUID(databaseId: databaseId, uuid: h.uuid) {
                        // 更新现有条目
                        do {
                            try await notionService.updateHighlightItem(
                                pageId: existingPageId,
                                bookId: item.itemId,
                                bookTitle: item.title,
                                author: item.author,
                                highlight: highlightRow
                            )
                        } catch {
                            if NotionRequestHelper.isDatabaseMissingError(error) {
                                let newEnsured = try await notionService.ensurePerBookDatabase(
                                    bookTitle: item.title,
                                    author: item.author,
                                    assetId: item.itemId
                                )
                                databaseId = newEnsured.id
                                _ = try await notionService.createHighlightItem(
                                    inDatabaseId: databaseId,
                                    bookId: item.itemId,
                                    bookTitle: item.title,
                                    author: item.author,
                                    highlight: highlightRow
                                )
                            } else {
                                throw error
                            }
                        }
                    } else {
                        // 创建新条目
                        do {
                            _ = try await notionService.createHighlightItem(
                                inDatabaseId: databaseId,
                                bookId: item.itemId,
                                bookTitle: item.title,
                                author: item.author,
                                highlight: highlightRow
                            )
                        } catch {
                            if NotionRequestHelper.isDatabaseMissingError(error) {
                                let newEnsured = try await notionService.ensurePerBookDatabase(
                                    bookTitle: item.title,
                                    author: item.author,
                                    assetId: item.itemId
                                )
                                databaseId = newEnsured.id
                                _ = try await notionService.createHighlightItem(
                                    inDatabaseId: databaseId,
                                    bookId: item.itemId,
                                    bookTitle: item.title,
                                    author: item.author,
                                    highlight: highlightRow
                                )
                            } else {
                                throw error
                            }
                        }
                    }
                } catch {
                    if NotionRequestHelper.isDatabaseMissingError(error) {
                        let newEnsured = try await notionService.ensurePerBookDatabase(
                            bookTitle: item.title,
                            author: item.author,
                            assetId: item.itemId
                        )
                        databaseId = newEnsured.id
                        _ = try await notionService.createHighlightItem(
                            inDatabaseId: databaseId,
                            bookId: item.itemId,
                            bookTitle: item.title,
                            author: item.author,
                            highlight: highlightRow
                        )
                    } else {
                        throw error
                    }
                }
            }
            batch += 1
        }
        
        if incremental {
            timestampStore.setLastSyncTime(for: item.itemId, to: Date())
        }
    }
    
    // MARK: - Private Helpers
    
    /// 基础数据库属性定义
    private var basePropertyDefinitions: [String: Any] {
        [
            "Last Sync Time": ["date": [:]]
        ]
    }
    
    /// 确保数据库存在
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
    
    /// 追加所有高亮（新页面）
    private func appendAllHighlights(
        pageId: String,
        highlights: [UnifiedHighlight],
        item: UnifiedSyncItem,
        source: NotionSyncSourceProtocol,
        progress: @escaping (String) -> Void
    ) async throws {
        let total = highlights.count
        progress(String(format: NSLocalizedString("Adding %lld highlights...", comment: ""), total))
        
        var children: [[String: Any]] = []
        
        // GoodLinks 特殊处理：添加 Highlights 标题
        if item.source == .goodLinks {
            children.append([
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": "Highlights"]]]
                ]
            ])
        }
        
        // 构建高亮块
        for h in highlights {
            let highlightRow = h.toHighlightRow(assetId: item.itemId)
            let block = helperMethods.buildBulletedListItemBlock(
                for: highlightRow,
                bookId: item.itemId,
                maxTextLength: NotionSyncConfig.maxTextLengthPrimary,
                source: source.sourceKey
            )
            children.append(block)
        }
        
        // 逐批追加并报告进度
        let batchSize = NotionSyncConfig.defaultAppendBatchSize
        var appended = 0
        var index = 0
        
        while index < children.count {
            let end = min(index + batchSize, children.count)
            let slice = Array(children[index..<end])
            
            try await notionService.appendBlocks(pageId: pageId, children: slice)
            
            appended += slice.count
            let percent = Int(Double(appended) / Double(total) * 100)
            progress(String(format: NSLocalizedString("Syncing... %d/%d (%d%%)", comment: ""), appended, total, percent))
            
            index = end
        }
    }
    
    /// 同步已存在的页面（增量更新）
    private func syncExistingPage(
        pageId: String,
        highlights: [UnifiedHighlight],
        item: UnifiedSyncItem,
        source: NotionSyncSourceProtocol,
        incremental: Bool,
        progress: @escaping (String) -> Void
    ) async throws {
        // 收集现有 UUID 映射
        let existingMapWithToken = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId)
        let lastSync = incremental ? timestampStore.getLastSyncTime(for: item.itemId) : nil
        
        progress(NSLocalizedString("Scanning local highlights...", comment: ""))
        
        var toUpdate: [(String, HighlightRow)] = []
        var toAppend: [HighlightRow] = []
        
        for h in highlights {
            let highlightRow = h.toHighlightRow(assetId: item.itemId)
            
            if let existing = existingMapWithToken[h.uuid] {
                // 检查是否需要更新
                if let last = lastSync, let modified = h.dateModified, modified < last {
                    continue
                }
                let localToken = helperMethods.computeModifiedToken(for: highlightRow, source: source.sourceKey)
                if let remoteToken = existing.token, remoteToken == localToken {
                    // 相同，跳过
                    continue
                }
                toUpdate.append((existing.blockId, highlightRow))
            } else {
                toAppend.append(highlightRow)
            }
        }
        
        // 计算总操作数
        let totalOperations = toUpdate.count + toAppend.count
        var completed = 0
        
        // 执行更新
        if !toUpdate.isEmpty {
            progress(String(format: NSLocalizedString("Updating %lld existing highlights...", comment: ""), toUpdate.count))
            for (blockId, h) in toUpdate {
                try await notionService.updateBlockContent(
                    blockId: blockId,
                    highlight: h,
                    bookId: item.itemId,
                    source: source.sourceKey
                )
                completed += 1
                if completed % 10 == 0 || completed == toUpdate.count {
                    let percent = Int(Double(completed) / Double(totalOperations) * 100)
                    progress(String(format: NSLocalizedString("Updating... %d/%d (%d%%)", comment: ""), completed, totalOperations, percent))
                }
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
                    source: source.sourceKey
                )
                children.append(block)
            }
            
            // 逐批追加并报告进度
            let batchSize = NotionSyncConfig.defaultAppendBatchSize
            var index = 0
            while index < children.count {
                let end = min(index + batchSize, children.count)
                let slice = Array(children[index..<end])
                
                try await notionService.appendBlocks(pageId: pageId, children: slice)
                
                completed += slice.count
                let percent = Int(Double(completed) / Double(totalOperations) * 100)
                progress(String(format: NSLocalizedString("Syncing... %d/%d (%d%%)", comment: ""), completed, totalOperations, percent))
                
                index = end
            }
        }
    }
    
    /// 全量同步（perBook 模式）
    private func fullSyncPerBook(
        databaseId: String,
        highlights: [UnifiedHighlight],
        item: UnifiedSyncItem,
        source: NotionPerBookSyncSourceProtocol,
        progress: @escaping (String) -> Void
    ) async throws {
        let pageSize = NotionSyncConfig.appleBooksPerBookPageSize
        var batch = 0
        
        for startIndex in stride(from: 0, to: highlights.count, by: pageSize) {
            let endIndex = min(startIndex + pageSize, highlights.count)
            let slice = Array(highlights[startIndex..<endIndex])
            
            progress(String(format: NSLocalizedString("Plan 2: Full batch %d, count: %lld", comment: ""), batch + 1, slice.count))
            
            for h in slice {
                let highlightRow = h.toHighlightRow(assetId: item.itemId)
                _ = try await notionService.createHighlightItem(
                    inDatabaseId: databaseId,
                    bookId: item.itemId,
                    bookTitle: item.title,
                    author: item.author,
                    highlight: highlightRow
                )
            }
            batch += 1
        }
    }
    
    /// 更新计数和时间戳
    private func updateCountAndTimestamp(
        pageId: String,
        count: Int,
        itemId: String
    ) async throws {
        try await notionService.updatePageHighlightCount(pageId: pageId, count: count)
        
        let nowString = notionSystemTimeZoneIsoDateFormatter.string(from: Date())
        try await notionService.updatePageProperties(pageId: pageId, properties: [
            "Last Sync Time": ["date": ["start": nowString]]
        ])
        
        timestampStore.setLastSyncTime(for: itemId, to: Date())
    }
}

