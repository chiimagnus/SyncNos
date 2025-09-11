import Foundation

// MARK: - NotionSyncService

final class NotionSyncService {
    enum SyncError: Error {
        case configurationMissing
        case databaseNotSet
        case tokenMissing
    }

    private let databaseService: DatabaseServiceProtocol
    private let configStore: NotionConfigStore

    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         configStore: NotionConfigStore = .shared) {
        self.databaseService = databaseService
        self.configStore = configStore
    }

    // MARK: - Public
    /// Sync a single book's highlights into Notion. Creates the book page if missing, appends highlights.
    func syncBook(annotationDbPath: String, book: BookListItem, progress: ((Int, Int) -> Void)? = nil) async throws {
        guard let token = try configStore.loadToken(), !token.isEmpty else { throw SyncError.tokenMissing }
        guard let databaseId = configStore.loadDatabaseId(), !databaseId.isEmpty else { throw SyncError.databaseNotSet }
        let apiVersion = configStore.loadAPIVersion()

        let notion = NotionService(configuration: .init(apiToken: token, apiVersion: apiVersion))

        AppLogger.shared.info("Start syncBook for \(book.bookTitle) (id=\(book.bookId)) db=\(databaseId)")

        // Find or create the page for this book using Book ID as a stable key
        let propertyKey = "Book ID"
        let existingId = try await notion.queryDatabaseForPageId(databaseId: databaseId, propertyName: propertyKey, equals: book.bookId)
        AppLogger.shared.debug("Existing page id for bookId=\(book.bookId): \(existingId ?? "<nil>")")
        let pageId: String
        if let pid = existingId {
            pageId = pid
            // Update last synced and counts
            try await notion.updatePageProperties(pageId: pageId, properties: [
                "Last Synced": ["date": ["start": ISO8601DateFormatter().string(from: Date())]],
                "Highlight Count": ["number": book.highlightCount]
            ])
        } else {
            pageId = try await notion.createBookPage(databaseId: databaseId,
                                                     title: book.bookTitle,
                                                     author: book.authorName,
                                                     bookId: book.bookId,
                                                     ibooksURL: book.ibooksURL,
                                                     highlightCount: book.highlightCount)
        }

        // Stream highlights by pages and append as blocks in chunks to respect API limits
        let db = try databaseService.openReadOnlyDatabase(dbPath: annotationDbPath)
        defer { databaseService.close(db) }

        AppLogger.shared.debug("Opened annotation DB at \(annotationDbPath) for reading")

        let pageSize = 100
        var offset = 0
        var appended = 0
        let total = book.highlightCount

        while offset < total {
            let rows = try databaseService.fetchHighlightPage(db: db, assetId: book.bookId, limit: pageSize, offset: offset)
            AppLogger.shared.debug("Fetched \(rows.count) highlight rows (offset=\(offset), pageSize=\(pageSize)) for bookId=\(book.bookId)")
            if rows.isEmpty { break }

            // Build blocks
            var blocks: [[String: Any]] = []
            for r in rows {
                let deepLink: String
                if let loc = r.location, !loc.isEmpty {
                    deepLink = "ibooks://assetid/\(book.bookId)#\(loc)"
                } else {
                    deepLink = "ibooks://assetid/\(book.bookId)"
                }
                let block = NotionService.buildHighlightToggle(text: r.text,
                                                                note: r.note,
                                                                created: r.dateAdded,
                                                                modified: r.modified,
                                                                deepLink: deepLink,
                                                                uuid: r.uuid,
                                                                style: r.style,
                                                                location: r.location)
                blocks.append(block)
            }

            // Notion API limit: up to 100 children per request
            let chunkSize = 90
            var idx = 0
            while idx < blocks.count {
                let end = min(idx + chunkSize, blocks.count)
                let chunk = Array(blocks[idx..<end])
                try await notion.appendBlocks(pageId: pageId, blocks: chunk)
                AppLogger.shared.debug("Uploaded chunk \(idx)-\(end) for bookId=\(book.bookId) to page=\(pageId)")
                idx = end
            }

            offset += rows.count
            appended += rows.count
            AppLogger.shared.info("Progress for \(book.bookTitle): \(appended)/\(total)")
            progress?(appended, total)
        }
        AppLogger.shared.info("Finished syncing book \(book.bookTitle) (appended=\(appended))")
    }

    /// Sync all listed books. Caller is responsible for providing books list and db path.
    func syncAll(annotationDbPath: String, books: [BookListItem], progressPerBook: ((BookListItem, Int, Int) -> Void)? = nil) async throws {
        for book in books {
            try await syncBook(annotationDbPath: annotationDbPath, book: book) { done, total in
                progressPerBook?(book, done, total)
            }
        }
    }
}


