import Foundation
import SQLite3

// MARK: - Database Service Protocol
protocol DatabaseServiceProtocol {
    func canOpenReadOnly(dbPath: String) -> Bool
    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer
    func close(_ db: OpaquePointer?)
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow]
    func fetchBooks(db: OpaquePointer, assetIds: [String]) throws -> [BookRow]
    func matches(book: BookRow, filters: Filters) -> Bool
}

// MARK: - Bookmark Store Protocol
protocol BookmarkStoreProtocol {
    func save(folderURL: URL)
    func restore() -> URL?
    func startAccessing(url: URL) -> Bool
    func stopAccessingIfNeeded()
}