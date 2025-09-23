import Foundation
import SQLite3

class BookDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    @Published var syncMessage: String?
    @Published var syncProgressText: String?
    @Published var isSyncing: Bool = false

    var canLoadMore: Bool { expectedTotalCount > highlights.count }

    private let databaseService: DatabaseServiceProtocol
    private let notionService: NotionServiceProtocol
    private let logger = DIContainer.shared.loggerService
    private var dbHandle: OpaquePointer?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = 50
    private var expectedTotalCount = 0

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService) {
        self.databaseService = databaseService
        self.notionService = notionService
    }
    
    deinit {
        closeHandle()
    }
    
    func resetAndLoadFirstPage(dbPath: String?, assetId: String, expectedTotalCount: Int) {
        errorMessage = nil
        closeHandle()
        highlights = []
        currentOffset = 0
        currentAssetId = assetId
        self.expectedTotalCount = expectedTotalCount
        
        if let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        loadNextPage(dbPath: dbPath, assetId: assetId)
    }
    
    func loadNextPage(dbPath: String?, assetId: String) {
        if isLoadingPage { return }
        if highlights.count >= expectedTotalCount { return }
        
        if currentAssetId == nil {
            currentAssetId = assetId
        }
        if dbHandle == nil, let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        guard let handle = dbHandle, let asset = currentAssetId else { return }
        
        isLoadingPage = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let rows = try self.databaseService.fetchHighlightPage(db: handle, assetId: asset, limit: self.pageSize, offset: self.currentOffset)
                let page = rows.map { r in
                    Highlight(uuid: r.uuid, text: r.text, note: r.note, style: r.style, dateAdded: r.dateAdded, modified: r.modified, location: r.location)
                }
                DispatchQueue.main.async {
                    self.highlights.append(contentsOf: page)
                    self.currentOffset += page.count
                    self.isLoadingPage = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    self.isLoadingPage = false
                }
            }
        }
    }
    
    private func closeHandle() {
        if let handle = dbHandle {
            databaseService.close(handle)
            dbHandle = nil
        }
    }

    private func getLatestHighlightCount(dbPath: String?, assetId: String) async throws -> Int {
        guard let path = dbPath else { return 0 }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }

        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        let count = counts.first { $0.assetId == assetId }?.count ?? 0
        logger.verbose("DEBUG: 获取到最新的高亮数量: \(count) for assetId: \(assetId)")
        return count
    }
    
    // MARK: - Notion Sync
    func syncToNotion(book: BookListItem, dbPath: String?, incremental: Bool = false) {
        syncMessage = nil
        syncProgressText = nil
        isSyncing = true
        Task {
            do {
                try await performSync(book: book, dbPath: dbPath, incremental: incremental)
                await MainActor.run {
                    self.syncMessage = incremental ? "增量同步完成" : "全量同步完成"
                    self.syncProgressText = nil
                    self.isSyncing = false
                }
            } catch {
                await MainActor.run {
                    self.syncMessage = error.localizedDescription
                    self.syncProgressText = nil
                    self.isSyncing = false
                }
            }
        }
    }

    private func performSync(book: BookListItem, dbPath: String?, incremental: Bool = false) async throws {
        guard let parentPageId = DIContainer.shared.notionConfigStore.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "Please set NOTION_PAGE_ID in Notion Integration view."])
        }
        // Ensure database exists (prefer stored syncDatabaseId; otherwise find/create and store it)
        let dbTitle = "syncnote"
        let databaseId: String
        if let saved = DIContainer.shared.notionConfigStore.syncDatabaseId {
            databaseId = saved
        } else if let found = try await notionService.findDatabaseId(title: dbTitle, parentPageId: parentPageId) {
            databaseId = found
            DIContainer.shared.notionConfigStore.syncDatabaseId = found
        } else {
            let created = try await notionService.createDatabase(title: dbTitle)
            databaseId = created.id
            DIContainer.shared.notionConfigStore.syncDatabaseId = created.id
        }
        // Ensure book page exists (by Asset ID)
        let pageId: String
        if let existing = try await notionService.findPageIdByAssetId(databaseId: databaseId, assetId: book.bookId) {
            pageId = existing
        } else {
            let created = try await notionService.createBookPage(databaseId: databaseId,
                                                                 bookTitle: book.bookTitle,
                                                                 author: book.authorName,
                                                                 assetId: book.bookId,
                                                                 urlString: book.ibooksURL,
                                                                 header: "Highlights")
            pageId = created.id
        }

        // For incremental sync, we only fetch highlights modified since last sync
        var sinceDate: Date? = nil
        if incremental {
            sinceDate = SyncTimestampStore.shared.getLastSyncTime(for: book.bookId)
            logger.debug("DEBUG: 增量同步 - 书籍ID: \(book.bookId), 上次同步时间: \(sinceDate?.description ?? "从未")")
            await MainActor.run {
                self.syncProgressText = "执行增量同步，上次同步时间: \(sinceDate?.description ?? "从未")"
            }
        } else {
            logger.debug("DEBUG: 全量同步 - 书籍ID: \(book.bookId)")
        }

        // Collect existing UUIDs to avoid duplicates (only for full sync)
        var existingUUIDs: Set<String> = []
        if !incremental {
            existingUUIDs = try await notionService.collectExistingUUIDs(fromPageId: pageId)
            logger.debug("DEBUG: 全量同步 - 收集到 \(existingUUIDs.count) 个已存在的UUID")
        }

        // Fetch highlights for this book in batches
        guard let path = dbPath else { return }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer {
            databaseService.close(handle)
            logger.debug("DEBUG: 关闭数据库连接")
        }
        var offset = 0
        var newRows: [HighlightRow] = []
        var batchCount = 0

        if incremental {
            // For incremental sync, we need to check if highlights already exist in Notion
            let existingUUIDToBlockIdMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
            logger.debug("DEBUG: 增量同步 - 收集到 \(existingUUIDToBlockIdMap.count) 个已存在的UUID到块ID映射")
            logger.debug("DEBUG: 现有的UUID列表: \(Array(existingUUIDToBlockIdMap.keys))")

            // Separate highlights into new and existing ones
            var newHighlights: [HighlightRow] = []
            var existingHighlights: [(blockId: String, highlight: HighlightRow)] = []

            while true {
                let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: self.pageSize, offset: offset, since: sinceDate)
                logger.debug("DEBUG: 增量同步批次 \(batchCount + 1) - 获取到 \(page.count) 条高亮 (offset: \(offset))")

                for highlight in page {
                    logger.verbose("DEBUG: 检查高亮 UUID: \(highlight.uuid)")
                    if let blockId = existingUUIDToBlockIdMap[highlight.uuid] {
                        // This highlight already exists in Notion, we need to update it
                        existingHighlights.append((blockId: blockId, highlight: highlight))
                        logger.debug("DEBUG: 发现已存在的高亮需要更新 UUID: \(highlight.uuid), Block ID: \(blockId)")
                    } else {
                        // This is a new highlight
                        newHighlights.append(highlight)
                        logger.debug("DEBUG: 发现新的高亮 UUID: \(highlight.uuid)")
                    }
                }

                if page.isEmpty || page.count < self.pageSize {
                    logger.debug("DEBUG: 增量同步获取完成，总共 \(batchCount + 1) 个批次")
                    break
                }
                offset += self.pageSize
                batchCount += 1
            }

            // Update existing highlights
            var updatedCount = 0
            for (blockId, highlight) in existingHighlights {
                try await notionService.updateBlockContent(blockId: blockId, highlight: highlight, bookId: book.bookId)
                updatedCount += 1
                logger.debug("DEBUG: 更新了高亮 UUID: \(highlight.uuid)")
            }

            // Add new highlights
            if !newHighlights.isEmpty {
                let appendCount = newHighlights.count
                logger.debug("DEBUG: 准备添加 \(appendCount) 条新高亮到Notion")
                await MainActor.run { self.syncProgressText = "正在添加 \(appendCount) 条新高亮..." }
                try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: newHighlights)
                logger.debug("DEBUG: 成功添加 \(appendCount) 条新高亮到Notion")
            }

            // Report results
            let totalProcessed = existingHighlights.count + newHighlights.count
            logger.info("DEBUG: 增量同步完成 - 更新了 \(updatedCount) 条高亮，添加了 \(newHighlights.count) 条新高亮，总共处理了 \(totalProcessed) 条高亮")

            // Update last sync time for incremental sync
            if incremental {
                let syncTime = Date()
                SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: syncTime)
                logger.debug("DEBUG: 更新同步时间戳 for 书籍ID: \(book.bookId) to \(syncTime)")
            }

            // Get the latest highlight count from the database
            let latestHighlightCount = try await getLatestHighlightCount(dbPath: dbPath, assetId: book.bookId)

            // Skip the general newRows processing since we've already handled everything
            await MainActor.run { self.syncProgressText = "正在更新数量..." }
            try await notionService.updatePageHighlightCount(pageId: pageId, count: latestHighlightCount)
            await MainActor.run { self.syncProgressText = "增量同步完成" }
            return
        } else {
            // Full sync logic (existing behavior)
            while true {
                let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: self.pageSize, offset: offset)
                let fresh = page.filter { !existingUUIDs.contains($0.uuid) }
                newRows.append(contentsOf: fresh)
                logger.debug("DEBUG: 全量同步批次 \(batchCount + 1) - 获取到 \(page.count) 条高亮，其中 \(fresh.count) 条是新的 (offset: \(offset))")

                let fetchedCount = newRows.count
                await MainActor.run {
                    self.syncProgressText = "已获取 \(fetchedCount) 条高亮..."
                }
                if page.isEmpty || page.count < self.pageSize {
                    logger.debug("DEBUG: 全量同步获取完成，总共 \(batchCount + 1) 个批次，\(fetchedCount) 条高亮")
                    break
                }
                offset += self.pageSize
                batchCount += 1
            }
        }

        if !newRows.isEmpty {
            // Show progress while appending
            let appendCount = newRows.count
            logger.debug("DEBUG: 准备添加 \(appendCount) 条高亮到Notion")
            await MainActor.run { self.syncProgressText = "正在添加 \(appendCount) 条高亮..." }
            let rowsToAppend = newRows
            try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: rowsToAppend)
            logger.debug("DEBUG: 成功添加 \(appendCount) 条高亮到Notion")

            // Update last sync time for incremental sync
            if incremental {
                let syncTime = Date()
                SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: syncTime)
                logger.debug("DEBUG: 更新同步时间戳 for 书籍ID: \(book.bookId) to \(syncTime)")
            }
        } else {
            logger.debug("DEBUG: 没有新的高亮需要同步")
        }
        await MainActor.run { self.syncProgressText = "正在更新数量..." }
        try await notionService.updatePageHighlightCount(pageId: pageId, count: book.highlightCount)
        await MainActor.run { self.syncProgressText = "同步完成" }
    }
}


