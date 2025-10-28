import Foundation
import SQLite3

// MARK: - DatabaseService

class DatabaseService: DatabaseServiceProtocol {
    private let connectionService = DatabaseConnectionService()
    private let queryService = DatabaseQueryService()
    private let filterService = BookFilterService()
    
    // MARK: - Connection Methods
    func canOpenReadOnly(dbPath: String) -> Bool {
        return connectionService.canOpenReadOnly(dbPath: dbPath)
    }
    
    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer {
        return try connectionService.openReadOnlyDatabase(dbPath: dbPath)
    }
    
    func close(_ db: OpaquePointer?) {
        connectionService.close(db)
    }
    
    // MARK: - Query Methods
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow] {
        return try queryService.fetchAnnotations(db: db)
    }

    func fetchBooks(db: OpaquePointer, assetIds: [String]) throws -> [BookRow] {
        return try queryService.fetchBooks(db: db, assetIds: assetIds)
    }

    // Pagination and aggregation
    func fetchHighlightCountsByAsset(db: OpaquePointer) throws -> [AssetHighlightCount] {
        return try queryService.fetchHighlightCountsByAsset(db: db)
    }

    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int) throws -> [HighlightRow] {
        return try queryService.fetchHighlightPage(db: db, assetId: assetId, limit: limit, offset: offset)
    }

    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int, since: Date?) throws -> [HighlightRow] {
        return try queryService.fetchHighlightPage(db: db, assetId: assetId, limit: limit, offset: offset, since: since)
    }

    // New methods for filtering and sorting
    func fetchHighlightStatsByAsset(db: OpaquePointer) throws -> [AssetHighlightStats] {
        return try queryService.fetchHighlightStatsByAsset(db: db)
    }

    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int, since: Date?, sortField: HighlightSortField?, ascending: Bool?, noteFilter: Bool?, styles: [Int]?) throws -> [HighlightRow] {
        return try queryService.fetchHighlightPage(db: db, assetId: assetId, limit: limit, offset: offset, since: since, sortField: sortField, ascending: ascending, noteFilter: noteFilter, styles: styles)
    }
    
    // MARK: - Filter Methods
    func matches(book: BookRow, filters: Filters) -> Bool {
        return filterService.matches(book: book, filters: filters)
    }

    // MARK: - Session Factory
    func makeReadOnlySession(dbPath: String) throws -> DatabaseReadOnlySessionProtocol {
        return try DatabaseReadOnlySession(dbPath: dbPath)
    }
}

// MARK: - Sendable Conformance
extension DatabaseService: @unchecked Sendable {}