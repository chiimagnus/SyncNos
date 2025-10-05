import Foundation
import SQLite3

/// Implementation for the single database synchronization strategy (方案1)
/// Uses one database with pages for each book
final class SyncStrategySingleDB: SyncStrategyProtocol {
    private let databaseService: DatabaseServiceProtocol
    private let notionService: NotionServiceProtocol
    private let config: NotionConfigStoreProtocol
    private let logger = DIContainer.shared.loggerService
    private let pageSize = 100

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         config: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.databaseService = databaseService
        self.notionService = notionService
        self.config = config
    }

    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        guard let parentPageId = config.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please set NOTION_PAGE_ID in Notion Integration view first.", comment: "")])
        }

        let databaseId = try await ensureSingleDatabaseId(parentPageId: parentPageId)

        // Ensure book page exists by Asset ID
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

        // Prepare DB
        guard let path = dbPath else { return }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }

        // Incremental window
        let since: Date? = incremental ? SyncTimestampStore.shared.getLastSyncTime(for: book.bookId) : nil
        if incremental { progress(String(format: NSLocalizedString("Performing incremental sync, last sync time: %@", comment: ""), since?.description ?? "从未")) }

        // Full: build existing set
        var existingUUIDs: Set<String> = []
        if !incremental {
            existingUUIDs = try await notionService.collectExistingUUIDs(fromPageId: pageId)
            logger.debug(String(format: NSLocalizedString("DEBUG: Full sync - collected %lld existing UUIDs", comment: ""), existingUUIDs.count))
        }

        var offset = 0
        var batchCount = 0
        var newRows: [HighlightRow] = []

        if incremental {
            let existingMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
            logger.debug(String(format: NSLocalizedString("DEBUG: Incremental sync - mapping: %lld", comment: ""), existingMap.count))
            var toUpdate: [(String, HighlightRow)] = []
            var toAppend: [HighlightRow] = []

            while true {
                let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset, since: since)
                logger.debug(String(format: NSLocalizedString("DEBUG: Incremental sync batch %d - fetched %lld highlights (offset: %lld)", comment: ""), batchCount + 1, page.count, offset))
                if page.isEmpty { break }
                for h in page {
                    if let blockId = existingMap[h.uuid] {
                        if let last = since, let modified = h.modified, modified < last { continue }
                        toUpdate.append((blockId, h))
                    } else {
                        toAppend.append(h)
                    }
                }
                offset += pageSize
                batchCount += 1
            }

            // Apply
            if !toUpdate.isEmpty {
                progress(String(format: NSLocalizedString("Updating %lld existing highlights...", comment: ""), toUpdate.count))
                for (blockId, h) in toUpdate { try await notionService.updateBlockContent(blockId: blockId, highlight: h, bookId: book.bookId) }
            }
            if !toAppend.isEmpty {
                progress(String(format: NSLocalizedString("Adding %lld new highlights...", comment: ""), toAppend.count))
                try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: toAppend)
            }

            // Count & timestamp
            let latest = try await getLatestHighlightCount(dbPath: dbPath, assetId: book.bookId)
            progress(NSLocalizedString("Updating count...", comment: ""))
            try await notionService.updatePageHighlightCount(pageId: pageId, count: latest)
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
            return
        }

        // Full path
        while true {
            let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset)
            let fresh = page.filter { !existingUUIDs.contains($0.uuid) }
            newRows.append(contentsOf: fresh)
            progress(String(format: NSLocalizedString("Fetched %lld highlights...", comment: ""), newRows.count))
            if page.isEmpty || page.count < pageSize { break }
            offset += pageSize
            batchCount += 1
        }
        if !newRows.isEmpty {
            progress(String(format: NSLocalizedString("Adding %lld highlights...", comment: ""), newRows.count))
            try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: newRows)
        }
        progress(NSLocalizedString("Updating count...", comment: ""))
        try await notionService.updatePageHighlightCount(pageId: pageId, count: book.highlightCount)
    }

    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        guard let parentPageId = config.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("Please set NOTION_PAGE_ID in Notion Integration view first.", comment: "")])
        }
        let databaseId = try await ensureSingleDatabaseId(parentPageId: parentPageId)

        // Ensure page
        let pageId: String
        let created: Bool
        if let ex = try await notionService.findPageIdByAssetId(databaseId: databaseId, assetId: book.bookId) {
            pageId = ex; created = false
        } else {
            let p = try await notionService.createBookPage(databaseId: databaseId,
                                                            bookTitle: book.bookTitle,
                                                            author: book.authorName,
                                                            assetId: book.bookId,
                                                            urlString: book.ibooksURL,
                                                            header: "Highlights")
            pageId = p.id; created = true
        }

        guard let path = dbPath else { return }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }

        if created {
            var offset = 0
            var batch = 0
            while true {
                let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset)
                if page.isEmpty { break }
                progress(String(format: NSLocalizedString("Plan 1: Adding batch %d, count: %lld", comment: ""), batch + 1, page.count))
                try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: page)
                offset += pageSize
                batch += 1
            }
            let latest = try await getLatestHighlightCount(dbPath: dbPath, assetId: book.bookId)
            progress(NSLocalizedString("Updating count...", comment: ""))
            try await notionService.updatePageHighlightCount(pageId: pageId, count: latest)
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
            return
        }

        // existing page → scan & update/append
        let existingMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
        let last = SyncTimestampStore.shared.getLastSyncTime(for: book.bookId)
        progress(NSLocalizedString("Scanning local highlights...", comment: ""))
        var toAppend: [HighlightRow] = []
        var toUpdate: [(String, HighlightRow)] = []
        var offset = 0
        var batch = 0
        while true {
            let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset)
            if page.isEmpty { break }
            for h in page {
                if let blockId = existingMap[h.uuid] {
                    if let last, let modified = h.modified, modified < last { continue }
                    toUpdate.append((blockId, h))
                } else {
                    toAppend.append(h)
                }
            }
            offset += pageSize
            batch += 1
        }
        if !toUpdate.isEmpty {
            progress(String(format: NSLocalizedString("Updating %lld existing highlights...", comment: ""), toUpdate.count))
            for (blockId, h) in toUpdate { try await notionService.updateBlockContent(blockId: blockId, highlight: h, bookId: book.bookId) }
        }
        if !toAppend.isEmpty {
            progress(String(format: NSLocalizedString("Appending %lld new highlights...", comment: ""), toAppend.count))
            try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: toAppend)
        }
        let latest = try await getLatestHighlightCount(dbPath: dbPath, assetId: book.bookId)
        progress(NSLocalizedString("Updating count...", comment: ""))
        try await notionService.updatePageHighlightCount(pageId: pageId, count: latest)
        let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
    }

    // MARK: - Helpers

    private func ensureSingleDatabaseId(parentPageId: String) async throws -> String {
        // Apple Books 专用库名 / source key provided by helper
        let desiredTitle = DIContainer.shared.notionAppleBooksHelper.singleDBTitle

        // 优先使用 per-source 存储
        let sourceKey = DIContainer.shared.notionAppleBooksHelper.sourceKey
        if let saved = config.databaseIdForSource(sourceKey) {
            if await notionService.databaseExists(databaseId: saved) { return saved }
            config.setDatabaseId(nil, forSource: sourceKey)
        }

        // 如果根据标题能搜索到，直接采用并保存
        if let found = try await notionService.findDatabaseId(title: desiredTitle, parentPageId: parentPageId) {
            config.setDatabaseId(found, forSource: sourceKey)
            return found
        }

        // 创建新的 AppleBooks 数据库
        let created = try await notionService.createDatabase(title: desiredTitle)
        config.setDatabaseId(created.id, forSource: sourceKey)
        return created.id
    }

    private func getLatestHighlightCount(dbPath: String?, assetId: String) async throws -> Int {
        guard let path = dbPath else { return 0 }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }
        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        return counts.first { $0.assetId == assetId }?.count ?? 0
    }
}