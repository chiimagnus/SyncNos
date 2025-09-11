import Foundation
import SQLite3

// MARK: - Database Service Protocol
protocol DatabaseServiceProtocol {
    func canOpenReadOnly(dbPath: String) -> Bool
    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer
    func close(_ db: OpaquePointer?)
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow]
    func fetchBooks(db: OpaquePointer, assetIds: [String]) throws -> [BookRow]
    func fetchHighlightCountsByAsset(db: OpaquePointer) throws -> [AssetHighlightCount]
    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int) throws -> [HighlightRow]
    func matches(book: BookRow, filters: Filters) -> Bool
}

// MARK: - Bookmark Store Protocol
protocol BookmarkStoreProtocol {
    func save(folderURL: URL)
    func restore() -> URL?
    func startAccessing(url: URL) -> Bool
    func stopAccessingIfNeeded()
}

// MARK: - Notion Config Store Protocol
protocol NotionConfigStoreProtocol: AnyObject {
    var notionKey: String? { get set }
    var notionPageId: String? { get set }
    var isConfigured: Bool { get }
    var syncDatabaseId: String? { get set }
}

// MARK: - Notion Service Protocol
protocol NotionServiceProtocol: AnyObject {
    func createDatabase(title: String) async throws -> NotionDatabase
    func createPage(databaseId: String, pageTitle: String, header: String?) async throws -> NotionPage
    func appendParagraph(pageId: String, content: String) async throws -> NotionAppendResult
    // Extended sync helpers
    func findDatabaseId(title: String, parentPageId: String) async throws -> String?
    func findPageIdByAssetId(databaseId: String, assetId: String) async throws -> String?
    func createBookPage(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> NotionPage
    func collectExistingUUIDs(fromPageId pageId: String) async throws -> Set<String>
    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws
    func updatePageHighlightCount(pageId: String, count: Int) async throws
    func appendBlocks(pageId: String, children: [[String: Any]]) async throws
}

// MARK: - Notion Models (lightweight decodables for responses)
struct NotionDatabase: Decodable {
    let id: String
    let url: String?
}

struct NotionPage: Decodable {
    let id: String
    let url: String?
}

struct NotionAppendResult: Decodable {
    struct ResultItem: Decodable {
        let id: String
    }
    let results: [ResultItem]
}