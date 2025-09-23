import Foundation
import SQLite3

// MARK: - Logger Level
enum LogLevel: Int, CaseIterable, Comparable {
    case verbose = 0
    case debug = 1
    case info = 2
    case warning = 3
    case error = 4

    static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        return lhs.rawValue < rhs.rawValue
    }

    var description: String {
        switch self {
        case .verbose: return "VERBOSE"
        case .debug: return "DEBUG"
        case .info: return "INFO"
        case .warning: return "WARNING"
        case .error: return "ERROR"
        }
    }
}

// MARK: - Logger Service Protocol
protocol LoggerServiceProtocol {
    var currentLevel: LogLevel { get set }

    func log(_ level: LogLevel, message: String, file: String, function: String, line: Int)

    func verbose(_ message: String, file: String, function: String, line: Int)
    func debug(_ message: String, file: String, function: String, line: Int)
    func info(_ message: String, file: String, function: String, line: Int)
    func warning(_ message: String, file: String, function: String, line: Int)
    func error(_ message: String, file: String, function: String, line: Int)
}

// MARK: - Database Service Protocol
protocol DatabaseServiceProtocol {
    func canOpenReadOnly(dbPath: String) -> Bool
    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer
    func close(_ db: OpaquePointer?)
    func fetchAnnotations(db: OpaquePointer) throws -> [HighlightRow]
    func fetchBooks(db: OpaquePointer, assetIds: [String]) throws -> [BookRow]
    func fetchHighlightCountsByAsset(db: OpaquePointer) throws -> [AssetHighlightCount]
    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int) throws -> [HighlightRow]
    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int, since: Date?) throws -> [HighlightRow]
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
    func collectExistingUUIDToBlockIdMapping(fromPageId pageId: String) async throws -> [String: String]
    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws
    func updatePageHighlightCount(pageId: String, count: Int) async throws
    func appendBlocks(pageId: String, children: [[String: Any]]) async throws
    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws
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