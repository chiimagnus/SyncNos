import Foundation
import SQLite3

/// Implementation for the per-book database synchronization strategy (方案2)
/// Uses separate databases for each book with highlight entries
final class SyncStrategyPerBook: SyncStrategyProtocol {
    private let databaseService: DatabaseServiceProtocol
    private let notionService: NotionServiceProtocol
    private let config: NotionConfigStoreProtocol
    private let pageSize = 50

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         config: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.databaseService = databaseService
        self.notionService = notionService
        self.config = config
    }

    func sync(book: BookListItem, dbPath: String?, incremental: Bool, progress: @escaping (String) -> Void) async throws {
        let ensured = try await ensurePerBookDatabaseId(book: book)
        var databaseId = ensured.id

        guard let path = dbPath else { return }
        let handle = try databaseService.openReadOnlyDatabase(dbPath: path)
        defer { databaseService.close(handle) }

        let since = incremental ? SyncTimestampStore.shared.getLastSyncTime(for: book.bookId) : nil
        if ensured.recreated {
            progress(NSLocalizedString("Detected database recreation, performing full sync...", comment: ""))
            var offset = 0
            var batch = 0
            while true {
                let page = try databaseService.fetchHighlightPage(db: handle, assetId: book.bookId, limit: pageSize, offset: offset)
                if page.isEmpty { break }
                progress(String(format: NSLocalizedString("Plan 2: Full batch %d, count: %lld", comment: ""), batch + 1, page.count))
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
            progress(String(format: NSLocalizedString("Plan 2: Processing batch %d...", comment: ""), batch + 1))
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

    func syncSmart(book: BookListItem, dbPath: String?, progress: @escaping (String) -> Void) async throws {
        let last = SyncTimestampStore.shared.getLastSyncTime(for: book.bookId)
        progress(last == nil ? NSLocalizedString("Plan 2: Initial sync (full)", comment: "") : NSLocalizedString("Plan 2: Incremental sync", comment: ""))
        try await sync(book: book, dbPath: dbPath, incremental: last != nil, progress: progress)
        if last == nil {
            let t = Date(); SyncTimestampStore.shared.setLastSyncTime(for: book.bookId, to: t)
        }
    }

    // MARK: - Helpers

    private func ensurePerBookDatabaseId(book: BookListItem) async throws -> (id: String, recreated: Bool) {
        if let saved = config.databaseIdForBook(assetId: book.bookId) {
            if await notionService.databaseExists(databaseId: saved) { return (saved, false) }
            config.setDatabaseId(nil, forBook: book.bookId)
        }
        let db = try await notionService.createPerBookHighlightDatabase(bookTitle: book.bookTitle, author: book.authorName, assetId: book.bookId)
        config.setDatabaseId(db.id, forBook: book.bookId)
        return (db.id, true)
    }

    private func isDatabaseMissingError(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == "NotionService" {
            return ns.code == 404 || ns.code == 400 || ns.code == 410
        }
        return false
    }
}