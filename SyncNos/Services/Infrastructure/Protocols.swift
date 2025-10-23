import Foundation
import Combine
import SQLite3
import StoreKit

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

// MARK: - Log Entry
struct LogEntry: Identifiable, Equatable {
    let id: UUID
    let timestamp: Date
    let level: LogLevel
    let message: String
    let file: String
    let function: String
    let line: Int
}

// MARK: - Logger Service Protocol
protocol LoggerServiceProtocol {
    var currentLevel: LogLevel { get set }

    /// Publisher that emits each new `LogEntry`.
    var logPublisher: AnyPublisher<LogEntry, Never> { get }

    /// Returns all stored logs (used for initial population / filtering).
    func getAllLogs() -> [LogEntry]

    func log(_ level: LogLevel, message: String, file: String, function: String, line: Int)

    func verbose(_ message: String, file: String, function: String, line: Int)
    func debug(_ message: String, file: String, function: String, line: Int)
    func info(_ message: String, file: String, function: String, line: Int)
    func warning(_ message: String, file: String, function: String, line: Int)
    func error(_ message: String, file: String, function: String, line: Int)

    /// Clear in-memory stored logs.
    func clearLogs()

    /// Export stored logs to the provided file URL.
    func exportLogs(to url: URL) throws
}

// MARK: - Logger Extension with Default Parameters
extension LoggerServiceProtocol {
    func verbose(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.verbose, message: message, file: file, function: function, line: line)
    }

    func debug(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.debug, message: message, file: file, function: function, line: line)
    }

    func info(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.info, message: message, file: file, function: function, line: line)
    }

    func warning(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.warning, message: message, file: file, function: function, line: line)
    }

    func error(_ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        log(.error, message: message, file: file, function: function, line: line)
    }
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
    // High-level helper: create a read-only session that manages connection lifecycle
    func makeReadOnlySession(dbPath: String) throws -> DatabaseReadOnlySessionProtocol
    // New methods for filtering and sorting
    func fetchHighlightStatsByAsset(db: OpaquePointer) throws -> [AssetHighlightStats]
    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int, since: Date?, order: HighlightOrder?, noteFilter: NoteFilter?, styles: [Int]?) throws -> [HighlightRow]
}

// MARK: - Database Read-Only Session Protocol
/// 以会话形式封装数据库连接，避免在 ViewModel 中直接持有 SQLite 句柄
protocol DatabaseReadOnlySessionProtocol: AnyObject {
    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?) throws -> [HighlightRow]
    func fetchHighlightCountsByAsset() throws -> [AssetHighlightCount]
    func fetchBooks(assetIds: [String]) throws -> [BookRow]
    func close()
    // New methods for filtering and sorting
    func fetchHighlightStatsByAsset() throws -> [AssetHighlightStats]
    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?, order: HighlightOrder?, noteFilter: NoteFilter?, styles: [Int]?) throws -> [HighlightRow]
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
    // Generic mapping for future sources (e.g., WeRead/DeDao/GetBiji)
    func databaseIdForSource(_ sourceKey: String) -> String?
    func setDatabaseId(_ id: String?, forSource sourceKey: String)
    // Sync mode: "single" (方案1：单库+每本书一个页面) 或 "perBook" (方案2：每本书一个库+每条高亮为一条目)
    var syncMode: String? { get set }
    // Per-book database id mapping helpers
    func databaseIdForBook(assetId: String) -> String?
    func setDatabaseId(_ id: String?, forBook assetId: String)
}

// MARK: - Notion Service Protocol
protocol NotionServiceProtocol: AnyObject {
    func createDatabase(title: String) async throws -> NotionDatabase
    // Extended sync helpers
    func findDatabaseId(title: String, parentPageId: String) async throws -> String?
    func findPageIdByAssetId(databaseId: String, assetId: String) async throws -> String?
    func createBookPage(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> NotionPage
    /// Ensure a page exists in a database for the given asset; returns (pageId, created)
    func ensureBookPageInDatabase(databaseId: String, bookTitle: String, author: String, assetId: String, urlString: String?, header: String?) async throws -> (id: String, created: Bool)
    func collectExistingUUIDs(fromPageId pageId: String) async throws -> Set<String>
    func collectExistingUUIDToBlockIdMapping(fromPageId pageId: String) async throws -> [String: String]
    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws
    func updatePageHighlightCount(pageId: String, count: Int) async throws
    func appendBlocks(pageId: String, children: [[String: Any]]) async throws
    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String) async throws
    // Generic property/schema helpers
    func ensureDatabaseProperties(databaseId: String, definitions: [String: Any]) async throws
    func updatePageProperties(pageId: String, properties: [String: Any]) async throws
    /// Replace all page children with the provided blocks
    func setPageChildren(pageId: String, children: [[String: Any]]) async throws
    func appendChildren(pageId: String, children: [[String: Any]], batchSize: Int) async throws
    // Per-book database mode (方案2)
    func databaseExists(databaseId: String) async -> Bool
    func createPerBookHighlightDatabase(bookTitle: String, author: String, assetId: String) async throws -> NotionDatabase
    func createHighlightItem(inDatabaseId databaseId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws -> NotionPage
    func findHighlightItemPageIdByUUID(databaseId: String, uuid: String) async throws -> String?
    func updateHighlightItem(pageId: String, bookId: String, bookTitle: String, author: String, highlight: HighlightRow) async throws
    // Helpers added for consolidated DB management
    func ensureDatabaseIdForSource(title: String, parentPageId: String, sourceKey: String) async throws -> String
    func ensurePerBookDatabase(bookTitle: String, author: String, assetId: String) async throws -> (id: String, recreated: Bool)
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

// MARK: - In-App Purchase Service Protocol
protocol IAPServiceProtocol: AnyObject {
    var isProUnlocked: Bool { get }
    func fetchProducts() async throws -> [Product]
    func purchase(product: Product) async throws -> Bool
    func restorePurchases() async -> Bool
    func startObservingTransactions()
}

// MARK: - GoodLinks Protocol Bridge (exposed to app layer)
protocol GoodLinksDatabaseServiceExposed: AnyObject {
    func defaultDatabasePath() -> String
    func canOpenReadOnly(dbPath: String) -> Bool
    func makeReadOnlySession(dbPath: String) throws -> GoodLinksReadOnlySessionProtocol

    // Convenience helpers that encapsulate session lifecycle so ViewModels
    // don't need to manage security-scoped bookmarks or SQLite handles.
    func resolveDatabasePath() -> String
    func fetchRecentLinks(dbPath: String, limit: Int) throws -> [GoodLinksLinkRow]
    func fetchHighlightsForLink(dbPath: String, linkId: String, limit: Int, offset: Int) throws -> [GoodLinksHighlightRow]
    func fetchContent(dbPath: String, linkId: String) throws -> GoodLinksContentRow?
}

// MARK: - Auto Sync Service Protocol
protocol AutoSyncServiceProtocol: AnyObject {
    var isRunning: Bool { get }
    func start()
    func stop()
    func triggerSyncNow()
}

// MARK: - Sync Timestamp Store Protocol
/// 抽象同步时间戳存取，避免直接依赖具体实现与单例
protocol SyncTimestampStoreProtocol: AnyObject {
    func getLastSyncTime(for bookId: String) -> Date?
    func setLastSyncTime(for bookId: String, to date: Date)
}

// MARK: - Auth Service Protocol
protocol AuthServiceProtocol: AnyObject {
    func loginWithApple(authorizationCode: String, nonce: String?) async throws -> AuthTokens
    func refresh(refreshToken: String) async throws -> AuthTokens
    func logout(refreshToken: String) async throws
    func fetchProfile(accessToken: String) async throws -> AccountProfile
    func fetchLoginMethods(accessToken: String) async throws -> [LoginMethod]
    func deleteAccount(accessToken: String) async throws
}
