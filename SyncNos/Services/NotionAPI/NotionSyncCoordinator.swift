import Foundation
import SQLite3

// MARK: - Protocol
protocol NotionSyncCoordinatorProtocol: AnyObject {
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws
    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws
}

// MARK: - Implementation
final class NotionSyncCoordinator: NotionSyncCoordinatorProtocol {
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

    // MARK: - Public API
    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        let mode = config.syncMode ?? "single"
        if mode == "perBook" {
            try await syncSmartPerBook(book: book, dbPath: dbPath, progress: progress)
        } else {
            try await syncSmartSingleDB(book: book, dbPath: dbPath, progress: progress)
        }
    }

    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        let mode = config.syncMode ?? "single"
        if mode == "perBook" {
            try await syncPerBook(book: book, dbPath: dbPath, incremental: incremental, progress: progress)
        } else {
            try await syncSingleDB(book: book, dbPath: dbPath, incremental: incremental, progress: progress)
        }
    }

    // MARK: - Single DB (方案1)
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

    private func syncSingleDB(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        guard let parentPageId = config.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "请先在 Notion Integration 视图设置 NOTION_PAGE_ID。"]) }

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

    private func syncSmartSingleDB(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        guard let parentPageId = config.notionPageId else {
            throw NSError(domain: "NotionSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "请先在 Notion Integration 视图设置 NOTION_PAGE_ID。"]) }
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

    // MARK: - Per-book database (方案2)
    private func ensurePerBookDatabaseId(book: BookListItem) async throws -> (id: String, recreated: Bool) {
        if let saved = config.databaseIdForBook(assetId: book.bookId) {
            if await notionService.databaseExists(databaseId: saved) { return (saved, false) }
            config.setDatabaseId(nil, forBook: book.bookId)
        }
        let db = try await notionService.createPerBookHighlightDatabase(bookTitle: book.bookTitle, author: book.authorName, assetId: book.bookId)
        config.setDatabaseId(db.id, forBook: book.bookId)
        return (db.id, true)
    }

    private func syncPerBook(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        let ensured = try await ensurePerBookDatabaseId(book: book)
        var databaseId = ensured.id

        guard let path = dbPath else { return }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }

        let since = incremental ? SyncTimestampStore.shared.getLastSyncTime(for: book.bookId) : nil
        if ensured.recreated {
            progress("检测到数据库被重建，执行全量同步...")
            var offset = 0
            var batch = 0
            while true {
                let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset)
                if page.isEmpty { break }
                progress("方案2：全量批次 \(batch + 1)，条数：\(page.count)")
                for h in page {
                    _ = try await notionService.createHighlightItem(inDatabaseId: databaseId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
                }
                offset += pageSize
                batch += 1
            }
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
            return
        }

        var offset = 0
        var batch = 0
        while true {
            let page: [HighlightRow]
            if let since { page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset, since: since) }
            else { page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset) }
            if page.isEmpty { break }
            progress("方案2：处理第 \(batch + 1) 批...")
            for h in page {
                do {
                    if let existingPageId = try await notionService.findHighlightItemPageIdByUUID(databaseId: databaseId, uuid: h.uuid) {
                        do {
                            try await notionService.updateHighlightItem(pageId: existingPageId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
                        } catch {
                            if self.isDatabaseMissingError(error) {
                                let newDb = try await notionService.createPerBookHighlightDatabase(bookTitle: book.bookTitle, author: book.authorName, assetId: book.bookId)
                                databaseId = newDb.id; config.setDatabaseId(databaseId, forBook: book.bookId)
                                _ = try await notionService.createHighlightItem(inDatabaseId: databaseId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
                            } else { throw error }
                        }
                    } else {
                        do {
                            _ = try await notionService.createHighlightItem(inDatabaseId: databaseId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
                        } catch {
                            if self.isDatabaseMissingError(error) {
                                let newDb = try await notionService.createPerBookHighlightDatabase(bookTitle: book.bookTitle, author: book.authorName, assetId: book.bookId)
                                databaseId = newDb.id; config.setDatabaseId(databaseId, forBook: book.bookId)
                                _ = try await notionService.createHighlightItem(inDatabaseId: databaseId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
                            } else { throw error }
                        }
                    }
                } catch {
                    if self.isDatabaseMissingError(error) {
                        let newDb = try await notionService.createPerBookHighlightDatabase(bookTitle: book.bookTitle, author: book.authorName, assetId: book.bookId)
                        databaseId = newDb.id; config.setDatabaseId(databaseId, forBook: book.bookId)
                        _ = try await notionService.createHighlightItem(inDatabaseId: databaseId, bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h)
                    } else { throw error }
                }
            }
            offset += pageSize
            batch += 1
        }

        if incremental {
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
        }
    }

    private func syncSmartPerBook(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        let last = SyncTimestampStore.shared.getLastSyncTime(for: book.bookId)
        progress(last == nil ? "方案2：首次同步（全量）" : "方案2：增量同步")
        try await syncPerBook(book: book, dbPath: dbPath, incremental: last != nil, progress: progress)
        if last == nil {
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
        }
    }

    // MARK: - Helpers
    private func isDatabaseMissingError(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == "NotionService" {
            return ns.code == 404 || ns.code == 400 || ns.code == 410
        }
        return false
    }

    private func getLatestHighlightCount(dbPath: String?, assetId: String) async throws -> Int {
        guard let path = dbPath else { return 0 }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }
        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        return counts.first { $0.assetId == assetId }?.count ?? 0
    }
}


