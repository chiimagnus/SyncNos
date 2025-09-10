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
    
    // MARK: - Filter Methods
    func matches(book: BookRow, filters: Filters) -> Bool {
        return filterService.matches(book: book, filters: filters)
    }
}