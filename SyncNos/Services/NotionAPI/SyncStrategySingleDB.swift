import Foundation
import SQLite3

/// Implementation for the single database synchronization strategy (方案1)
/// Uses one database with pages for each book
final class SyncStrategySingleDB: SyncStrategyProtocol {
    private let databaseService: DatabaseServiceProtocol
    private let notionService: NotionServiceProtocol
    private let config: NotionConfigStoreProtocol
    private let logger = DIContainer.shared.loggerService
    private let pageSize = 50

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         config: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.databaseService = databaseService
        self.notionService = notionService
        self.config = config
    }

    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        guard let parentPageId = config.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "请先在 Notion Integration 视图设置 NOTION_PAGE_ID。"])
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
        if incremental { progress("执行增量同步，上次同步时间: \(since?.description ?? "从未")") }

        // Full: build existing set
        var existingUUIDs: Set<String> = []
        if !incremental {
            existingUUIDs = try await notionService.collectExistingUUIDs(fromPageId: pageId)
            logger.debug("DEBUG: 全量同步 - 收集到 \(existingUUIDs.count) 个已存在的UUID")
        }

        var offset = 0
        var batchCount = 0
        var newRows: [HighlightRow] = []

        if incremental {
            let existingMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
            logger.debug("DEBUG: 增量同步 - 映射: \(existingMap.count)")
            var toUpdate: [(String, HighlightRow)] = []
            var toAppend: [HighlightRow] = []

            while true {
                let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset, since: since)
                logger.debug("DEBUG: 增量同步批次 \(batchCount + 1) - 获取到 \(page.count) 条高亮 (offset: \(offset))")
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
                progress("正在更新 \(toUpdate.count) 条已存在高亮...")
                for (blockId, h) in toUpdate { try await notionService.updateBlockContent(blockId: blockId, highlight: h, bookId: book.bookId) }
            }
            if !toAppend.isEmpty {
                progress("正在添加 \(toAppend.count) 条新高亮...")
                try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: toAppend)
            }

            // Count & timestamp
            let latest = try await getLatestHighlightCount(dbPath: dbPath, assetId: book.bookId)
            progress("正在更新数量...")
            try await notionService.updatePageHighlightCount(pageId: pageId, count: latest)
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
            return
        }

        // Full path
        while true {
            let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset)
            let fresh = page.filter { !existingUUIDs.contains($0.uuid) }
            newRows.append(contentsOf: fresh)
            progress("已获取 \(newRows.count) 条高亮...")
            if page.isEmpty || page.count < pageSize { break }
            offset += pageSize
            batchCount += 1
        }
        if !newRows.isEmpty {
            progress("正在添加 \(newRows.count) 条高亮...")
            try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: newRows)
        }
        progress("正在更新数量...")
        try await notionService.updatePageHighlightCount(pageId: pageId, count: book.highlightCount)
    }

    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        guard let parentPageId = config.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "请先在 Notion Integration 视图设置 NOTION_PAGE_ID。"])
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
                progress("正在添加第 \(batch + 1) 批，条数：\(page.count)")
                try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: page)
                offset += pageSize
                batch += 1
            }
            let latest = try await getLatestHighlightCount(dbPath: dbPath, assetId: book.bookId)
            progress("正在更新数量...")
            try await notionService.updatePageHighlightCount(pageId: pageId, count: latest)
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
            return
        }

        // existing page → scan & update/append
        let existingMap = try await notionService.collectExistingUUIDToBlockIdMapping(fromPageId: pageId)
        let last = SyncTimestampStore.shared.getLastSyncTime(for: book.bookId)
        progress("正在扫描本地高亮...")
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
            progress("正在更新 \(toUpdate.count) 条已存在高亮...")
            for (blockId, h) in toUpdate { try await notionService.updateBlockContent(blockId: blockId, highlight: h, bookId: book.bookId) }
        }
        if !toAppend.isEmpty {
            progress("正在追加 \(toAppend.count) 条新高亮...")
            try await notionService.appendHighlightBullets(pageId: pageId, bookId: book.bookId, highlights: toAppend)
        }
        let latest = try await getLatestHighlightCount(dbPath: dbPath, assetId: book.bookId)
        progress("正在更新数量...")
        try await notionService.updatePageHighlightCount(pageId: pageId, count: latest)
        let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
    }

    // MARK: - Helpers

    private func ensureSingleDatabaseId(parentPageId: String) async throws -> String {
        let title = "syncnos"
        if let saved = config.syncDatabaseId {
            if await notionService.databaseExists(databaseId: saved) { return saved }
            config.syncDatabaseId = nil
        }
        if let found = try await notionService.findDatabaseId(title: title, parentPageId: parentPageId) {
            config.syncDatabaseId = found
            return found
        }
        let created = try await notionService.createDatabase(title: title)
        config.syncDatabaseId = created.id
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