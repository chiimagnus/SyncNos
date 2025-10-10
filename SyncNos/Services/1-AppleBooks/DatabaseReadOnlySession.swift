import Foundation
import SQLite3

// MARK: - Database Read-Only Session
final class DatabaseReadOnlySession: DatabaseReadOnlySessionProtocol {
    private let connectionService = DatabaseConnectionService()
    private let queryService = DatabaseQueryService()
    private let logger = DIContainer.shared.loggerService
    private var handle: OpaquePointer?

    init(dbPath: String) throws {
        self.handle = try connectionService.openReadOnlyDatabase(dbPath: dbPath)
    }

    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?) throws -> [HighlightRow] {
        return try fetchHighlightPage(assetId: assetId, limit: limit, offset: offset, since: since, order: nil, noteFilter: nil, styles: nil)
    }

    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?, order: HighlightOrder?, noteFilter: NoteFilter?, styles: [Int]?) throws -> [HighlightRow] {
        guard let db = handle else {
            let error = "Database session is closed"
            logger.error("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
        }
        return try queryService.fetchHighlightPage(db: db, assetId: assetId, limit: limit, offset: offset, since: since, order: order, noteFilter: noteFilter, styles: styles)
    }

    func fetchHighlightCountsByAsset() throws -> [AssetHighlightCount] {
        guard let db = handle else {
            let error = "Database session is closed"
            logger.error("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
        }
        return try queryService.fetchHighlightCountsByAsset(db: db)
    }

    func fetchHighlightStatsByAsset() throws -> [AssetHighlightStats] {
        guard let db = handle else {
            let error = "Database session is closed"
            logger.error("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
        }
        return try queryService.fetchHighlightStatsByAsset(db: db)
    }

    func fetchBooks(assetIds: [String]) throws -> [BookRow] {
        guard let db = handle else {
            let error = "Database session is closed"
            logger.error("Error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
        }
        return try queryService.fetchBooks(db: db, assetIds: assetIds)
    }

    func close() {
        if let h = handle {
            connectionService.close(h)
            handle = nil
            logger.debug("Closed database session")
        }
    }

    deinit {
        close()
    }
}
