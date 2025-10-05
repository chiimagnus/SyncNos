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
                    let props = DIContainer.shared.notionAppleBooksHelper.buildHighlightProperties(bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h, clearEmpty: false)
                    let children = DIContainer.shared.notionAppleBooksHelper.buildHighlightChildren(bookId: book.bookId, highlight: h)
                    _ = try await notionService.createPage(in: databaseId, properties: props, children: children)
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
                    if let existingPageId = try await notionService.findPageIdByPropertyEquals(databaseId: databaseId, propertyName: NotionAppleBooksFields.uuid, value: h.uuid) {
                        let props = DIContainer.shared.notionAppleBooksHelper.buildHighlightProperties(bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h, clearEmpty: true)
                        try await notionService.updatePageProperties(pageId: existingPageId, properties: props)
                        let children = DIContainer.shared.notionAppleBooksHelper.buildHighlightChildren(bookId: book.bookId, highlight: h)
                        try await notionService.setPageChildren(pageId: existingPageId, children: children)
                    } else {
                        let props = DIContainer.shared.notionAppleBooksHelper.buildHighlightProperties(bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h, clearEmpty: false)
                        let children = DIContainer.shared.notionAppleBooksHelper.buildHighlightChildren(bookId: book.bookId, highlight: h)
                        _ = try await notionService.createPage(in: databaseId, properties: props, children: children)
                    }
                } catch {
                    if self.isDatabaseMissingError(error) {
                        let perBook = DIContainer.shared.notionAppleBooksHelper.perBookDatabaseProperties(bookTitle: book.bookTitle, author: book.authorName, assetId: book.bookId)
                        let newDb = try await notionService.createDatabase(title: perBook.title, properties: perBook.properties)
                        databaseId = newDb.id; config.setDatabaseId(databaseId, forBook: book.bookId)
                        let props = DIContainer.shared.notionAppleBooksHelper.buildHighlightProperties(bookId: book.bookId, bookTitle: book.bookTitle, author: book.authorName, highlight: h, clearEmpty: false)
                        let children = DIContainer.shared.notionAppleBooksHelper.buildHighlightChildren(bookId: book.bookId, highlight: h)
                        _ = try await notionService.createPage(in: databaseId, properties: props, children: children)
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
        let perBook = DIContainer.shared.notionAppleBooksHelper.perBookDatabaseProperties(bookTitle: book.bookTitle, author: book.authorName, assetId: book.bookId)
        let db = try await notionService.createDatabase(title: perBook.title, properties: perBook.properties)
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