import Foundation

/// 统一同步引擎
/// 处理所有数据源到 Notion 的通用同步逻辑
final class NotionSyncEngine {
    
    // MARK: - Dependencies
    
    private let notionService: NotionServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private let logger: LoggerServiceProtocol
    private let timestampStore: SyncTimestampStoreProtocol
    private let syncedHighlightStore: SyncedHighlightStoreProtocol
    private let helperMethods: NotionHelperMethods
    
    // MARK: - Initialization
    
    init(
        notionService: NotionServiceProtocol = DIContainer.shared.notionService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        timestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        syncedHighlightStore: SyncedHighlightStoreProtocol = DIContainer.shared.syncedHighlightStore
    ) {
        self.notionService = notionService
        self.notionConfig = notionConfig
        self.logger = logger
        self.timestampStore = timestampStore
        self.syncedHighlightStore = syncedHighlightStore
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
            // 获取完成后立即显示数量
            progress(String(format: NSLocalizedString("Fetched %lld highlights, preparing...", comment: ""), highlights.count))
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
    /// 同时保存已同步的 UUID 和 block IDs 到本地记录
    private func appendAllHighlights(
        pageId: String,
        highlights: [UnifiedHighlight],
        item: UnifiedSyncItem,
        source: NotionSyncSourceProtocol,
        progress: @escaping (String) -> Void
    ) async throws {
        let total = highlights.count
        progress(String(format: NSLocalizedString("Adding %lld highlights...", comment: ""), total))
        
        var headerChildren: [[String: Any]] = []
        var highlightChildren: [[String: Any]] = []
        var highlightMeta: [(uuid: String, contentHash: String)] = []
        
        // GoodLinks 特殊处理：添加 Highlights 标题
        if item.source == .goodLinks {
            headerChildren.append([
                "object": "block",
                "heading_2": [
                    "rich_text": [["text": ["content": "Highlights"]]]
                ]
            ])
        }
        
        // 构建高亮块并记录元数据
        for h in highlights {
            let highlightRow = h.toHighlightRow(assetId: item.itemId)
            let block = helperMethods.buildBulletedListItemBlock(
                for: highlightRow,
                bookId: item.itemId,
                maxTextLength: NotionSyncConfig.maxTextLengthPrimary,
                source: source.sourceKey
            )
            highlightChildren.append(block)
            
            // 记录 uuid 和 contentHash
            let contentHash = helperMethods.computeModifiedToken(for: highlightRow, source: source.sourceKey)
            highlightMeta.append((uuid: h.uuid, contentHash: contentHash))
        }
        
        // 先追加 header（如果有）
        if !headerChildren.isEmpty {
            try await notionService.appendBlocks(pageId: pageId, children: headerChildren)
        }
        
        // 逐批追加高亮并获取 block IDs
        let batchSize = NotionSyncConfig.defaultAppendBatchSize
        var appended = 0
        var index = 0
        var newRecords: [(uuid: String, notionBlockId: String, contentHash: String)] = []
        
        while index < highlightChildren.count {
            let end = min(index + batchSize, highlightChildren.count)
            let slice = Array(highlightChildren[index..<end])
            let metaSlice = Array(highlightMeta[index..<end])
            
            // 追加并获取 block IDs
            let blockIds = try await notionService.appendBlocksAndGetIds(pageId: pageId, children: slice)
            
            // 记录 UUID -> blockId 映射
            for (meta, blockId) in zip(metaSlice, blockIds) {
                newRecords.append((uuid: meta.uuid, notionBlockId: blockId, contentHash: meta.contentHash))
            }
            
            appended += slice.count
            let percent = Int(Double(appended) / Double(total) * 100)
            progress(String(format: NSLocalizedString("Syncing... %d/%d (%d%%)", comment: ""), appended, total, percent))
            
            index = end
        }
        
        // 保存到本地记录
        if !newRecords.isEmpty {
            do {
                try await syncedHighlightStore.saveRecords(newRecords, sourceKey: source.sourceKey, bookId: item.itemId)
                logger.debug("[SyncEngine] Saved \(newRecords.count) synced highlight records for \(source.sourceKey):\(item.itemId)")
            } catch {
                // 保存失败不应该阻止同步完成，只记录警告
                logger.warning("[SyncEngine] Failed to save synced highlight records: \(error.localizedDescription)")
            }
        }
    }
    
    /// 同步已存在的页面（增量更新）
    /// 优先使用本地记录避免遍历 Notion children
    private func syncExistingPage(
        pageId: String,
        highlights: [UnifiedHighlight],
        item: UnifiedSyncItem,
        source: NotionSyncSourceProtocol,
        incremental: Bool,
        progress: @escaping (String) -> Void
    ) async throws {
        // 尝试从本地获取已同步记录
        progress(NSLocalizedString("Loading local sync records...", comment: ""))
        let localRecords = try await syncedHighlightStore.getRecords(sourceKey: source.sourceKey, bookId: item.itemId)
        
        // 判断是否可以使用本地记录
        let useLocalRecords = !localRecords.isEmpty
        
        var existingMap: [String: (blockId: String, contentHash: String?)] = [:]
        
        if useLocalRecords {
            // 使用本地记录（快速路径）
            progress(String(format: NSLocalizedString("Using %lld local sync records...", comment: ""), localRecords.count))
            for record in localRecords {
                existingMap[record.uuid] = (blockId: record.notionBlockId, contentHash: record.contentHash)
            }
            logger.debug("[SyncEngine] Using local records: \(localRecords.count) for \(source.sourceKey):\(item.itemId)")
        } else {
            // 回退到 Notion 查询（首次同步或本地记录为空）
            progress(NSLocalizedString("Collecting existing highlights from Notion...", comment: ""))
            let existingMapWithToken = try await notionService.collectExistingUUIDMapWithToken(fromPageId: pageId) { fetchedCount in
                progress(String(format: NSLocalizedString("Collecting from Notion... %lld found", comment: ""), fetchedCount))
            }
            for (uuid, value) in existingMapWithToken {
                existingMap[uuid] = (blockId: value.blockId, contentHash: value.token)
            }
            logger.debug("[SyncEngine] Collected from Notion: \(existingMapWithToken.count) for \(source.sourceKey):\(item.itemId)")
        }
        
        let lastSync = incremental ? timestampStore.getLastSyncTime(for: item.itemId) : nil
        
        progress(String(format: NSLocalizedString("Found %lld existing highlights, comparing...", comment: ""), existingMap.count))
        
        var toUpdate: [(blockId: String, highlight: HighlightRow, uuid: String, newContentHash: String)] = []
        var toAppend: [(highlight: HighlightRow, uuid: String, contentHash: String)] = []
        
        for h in highlights {
            let highlightRow = h.toHighlightRow(assetId: item.itemId)
            let localContentHash = helperMethods.computeModifiedToken(for: highlightRow, source: source.sourceKey)
            
            if let existing = existingMap[h.uuid] {
                // 检查是否需要更新
                if let last = lastSync, let modified = h.dateModified, modified < last {
                    continue
                }
                if let remoteHash = existing.contentHash, remoteHash == localContentHash {
                    // 相同，跳过
                    continue
                }
                toUpdate.append((blockId: existing.blockId, highlight: highlightRow, uuid: h.uuid, newContentHash: localContentHash))
            } else {
                toAppend.append((highlight: highlightRow, uuid: h.uuid, contentHash: localContentHash))
            }
        }
        
        // 计算总操作数
        let totalOperations = toUpdate.count + toAppend.count
        var completed = 0
        
        // 执行更新
        if !toUpdate.isEmpty {
            progress(String(format: NSLocalizedString("Updating %lld existing highlights...", comment: ""), toUpdate.count))
            for updateItem in toUpdate {
                try await notionService.updateBlockContent(
                    blockId: updateItem.blockId,
                    highlight: updateItem.highlight,
                    bookId: item.itemId,
                    source: source.sourceKey
                )
                
                // 更新本地记录的 contentHash
                if useLocalRecords {
                    do {
                        try await syncedHighlightStore.updateContentHash(
                            sourceKey: source.sourceKey,
                            bookId: item.itemId,
                            uuid: updateItem.uuid,
                            newContentHash: updateItem.newContentHash
                        )
                    } catch {
                        logger.warning("[SyncEngine] Failed to update local record: \(error.localizedDescription)")
                    }
                }
                
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
            for appendItem in toAppend {
                let block = helperMethods.buildBulletedListItemBlock(
                    for: appendItem.highlight,
                    bookId: item.itemId,
                    maxTextLength: NotionSyncConfig.maxTextLengthPrimary,
                    source: source.sourceKey
                )
                children.append(block)
            }
            
            // 逐批追加并获取 block IDs
            let batchSize = NotionSyncConfig.defaultAppendBatchSize
            var index = 0
            var newRecords: [(uuid: String, notionBlockId: String, contentHash: String)] = []
            
            while index < children.count {
                let end = min(index + batchSize, children.count)
                let slice = Array(children[index..<end])
                let metaSlice = Array(toAppend[index..<end])
                
                // 追加并获取 block IDs
                let blockIds = try await notionService.appendBlocksAndGetIds(pageId: pageId, children: slice)
                
                // 记录 UUID -> blockId 映射
                for (meta, blockId) in zip(metaSlice, blockIds) {
                    newRecords.append((uuid: meta.uuid, notionBlockId: blockId, contentHash: meta.contentHash))
                }
                
                completed += slice.count
                let percent = Int(Double(completed) / Double(totalOperations) * 100)
                progress(String(format: NSLocalizedString("Syncing... %d/%d (%d%%)", comment: ""), completed, totalOperations, percent))
                
                index = end
            }
            
            // 保存新追加的记录到本地
            if !newRecords.isEmpty {
                do {
                    try await syncedHighlightStore.saveRecords(newRecords, sourceKey: source.sourceKey, bookId: item.itemId)
                    logger.debug("[SyncEngine] Saved \(newRecords.count) new synced highlight records for \(source.sourceKey):\(item.itemId)")
                } catch {
                    logger.warning("[SyncEngine] Failed to save synced highlight records: \(error.localizedDescription)")
                }
            }
        }
        
        // 如果是从 Notion 回退查询的，需要初始化本地记录
        if !useLocalRecords && !existingMap.isEmpty {
            // 保存从 Notion 获取的现有记录到本地
            var existingRecords: [(uuid: String, notionBlockId: String, contentHash: String)] = []
            for (uuid, value) in existingMap {
                existingRecords.append((uuid: uuid, notionBlockId: value.blockId, contentHash: value.contentHash ?? ""))
            }
            do {
                try await syncedHighlightStore.saveRecords(existingRecords, sourceKey: source.sourceKey, bookId: item.itemId)
                logger.info("[SyncEngine] Initialized local records from Notion: \(existingRecords.count) for \(source.sourceKey):\(item.itemId)")
            } catch {
                logger.warning("[SyncEngine] Failed to initialize local records: \(error.localizedDescription)")
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

