import Foundation
import Combine
import SQLite3
import StoreKit

// MARK: - Logger Level
enum LogLevel: Int, CaseIterable, Comparable {
    case debug = 0
    case info = 1
    case warning = 2
    case error = 3

    static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        return lhs.rawValue < rhs.rawValue
    }

    var description: String {
        switch self {
        case .debug: return "DEBUG"
        case .info: return "INFO"
        case .warning: return "WARNING"
        case .error: return "ERROR"
        }
    }

    var color: NSColor {
        switch self {
        case .debug: return .blue
        case .info: return .gray
        case .warning: return .systemYellow
        case .error: return .systemRed
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
protocol LoggerServiceProtocol: Sendable {
    var currentLevel: LogLevel { get set }

    /// Publisher that emits each new `LogEntry`.
    var logPublisher: AnyPublisher<LogEntry, Never> { get }

    /// Returns all stored logs (used for initial population / filtering).
    func getAllLogs() -> [LogEntry]

    func log(_ level: LogLevel, message: String, file: String, function: String, line: Int)

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
protocol DatabaseServiceProtocol: Sendable {
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
    func fetchHighlightPage(db: OpaquePointer, assetId: String, limit: Int, offset: Int, since: Date?, sortField: HighlightSortField?, ascending: Bool?, noteFilter: Bool?, styles: [Int]?) throws -> [HighlightRow]
}

// MARK: - Database Read-Only Session Protocol
/// 以会话形式封装数据库连接，避免在 ViewModel 中直接持有 SQLite 句柄
protocol DatabaseReadOnlySessionProtocol: AnyObject, Sendable {
    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?) throws -> [HighlightRow]
    func fetchHighlightCountsByAsset() throws -> [AssetHighlightCount]
    func fetchBooks(assetIds: [String]) throws -> [BookRow]
    func close()
    // New methods for filtering and sorting
    func fetchHighlightStatsByAsset() throws -> [AssetHighlightStats]
    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?, sortField: HighlightSortField?, ascending: Bool?, noteFilter: Bool?, styles: [Int]?) throws -> [HighlightRow]
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
    // OAuth token (优先使用，如果存在则替代 notionKey)
    var notionOAuthToken: String? { get set }
    var notionWorkspaceId: String? { get set }
    var notionWorkspaceName: String? { get set }
    // 获取有效的认证 token（优先 OAuth token，否则使用 API key）
    var effectiveToken: String? { get }
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
    func collectExistingUUIDMapWithToken(fromPageId pageId: String) async throws -> [String: (blockId: String, token: String?)]
    func appendHighlightBullets(pageId: String, bookId: String, highlights: [HighlightRow]) async throws
    func updatePageHighlightCount(pageId: String, count: Int) async throws
    func appendBlocks(pageId: String, children: [[String: Any]]) async throws
    func updateBlockContent(blockId: String, highlight: HighlightRow, bookId: String, source: String) async throws
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
    // Discovery helpers
    /// 列出当前 token 可访问、且可作为数据库父级的 Notion 页面（过滤掉 database item）
    func listAccessibleParentPages(searchQuery: String?) async throws -> [NotionPageSummary]
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

/// 用于页面选择器的轻量信息
struct NotionPageSummary: Identifiable, Decodable {
    let id: String
    let title: String
    let iconEmoji: String?
}

// MARK: - In-App Purchase Service Protocol
protocol IAPServiceProtocol: AnyObject {
    var isProUnlocked: Bool { get }
    var hasPurchased: Bool { get }
    var hasPurchasedAnnual: Bool { get }
    var hasPurchasedLifetime: Bool { get }
    var purchaseType: PurchaseType { get }
    var hasEverPurchasedAnnual: Bool { get }
    var isInTrialPeriod: Bool { get }
    var trialDaysRemaining: Int { get }
    var hasShownWelcome: Bool { get }
    func fetchProducts() async throws -> [Product]
    func purchase(product: Product) async throws -> Bool
    func restorePurchases() async -> Bool
    func refreshPurchasedStatus() async -> Bool
    func startObservingTransactions()
    func shouldShowTrialReminder() -> Bool
    func markReminderShown()
    func markWelcomeShown()
    func getAnnualSubscriptionExpirationDate() async -> Date?
    func getPurchaseDate() async -> Date?
    
    // Debug functions (development environment only)
    /// Resets all IAP purchase data and trial period information. Only available in development environment.
    func resetAllPurchaseData() throws
    
    /// Returns comprehensive debug information about current IAP state
    func getDebugInfo() -> IAPDebugInfo
    
    /// Simulates a specific purchase or trial state for testing. Only available in development environment.
    /// - Parameter state: The state to simulate
    func simulatePurchaseState(_ state: SimulatedPurchaseState) throws
}

// MARK: - Login Item Service Protocol
protocol LoginItemServiceProtocol: AnyObject {
    /// Returns true when the main app is set to open at login (macOS 13+)
    func isRegistered() -> Bool

    /// Enable or disable "Open at Login" for the main app. Throws on failure.
    func setEnabled(_ enabled: Bool) throws
}

// MARK: - GoodLinks Protocol Bridge (exposed to app layer)
protocol GoodLinksDatabaseServiceExposed: AnyObject, Sendable {
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
    // New per-source immediate triggers (public API)
    func triggerAppleBooksNow()
    func triggerGoodLinksNow()
    func triggerWeReadNow()
    func triggerDedaoNow()
}

// MARK: - Sync Timestamp Store Protocol
/// 抽象同步时间戳存取，避免直接依赖具体实现与单例
protocol SyncTimestampStoreProtocol: AnyObject {
    func getLastSyncTime(for bookId: String) -> Date?
    func setLastSyncTime(for bookId: String, to date: Date)
}

// MARK: - WeRead Auth & Data Protocols

/// 管理 WeRead 认证 Cookie 的服务协议
protocol WeReadAuthServiceProtocol: AnyObject {
    /// 当前是否已登录（依据是否存在可用 Cookie）
    var isLoggedIn: Bool { get }
    /// 已持久化的 Cookie Header（`Cookie: ...` 的值部分）
    var cookieHeader: String? { get }

    /// 更新并持久化新的 Cookie Header
    func updateCookieHeader(_ header: String)
    /// 清除本地存储的 Cookie 与登录状态（包括 WebKit cookies）
    func clearCookies() async
}

/// WeRead API 服务协议
protocol WeReadAPIServiceProtocol: AnyObject {
    /// 获取当前用户的 Notebook 列表（每个元素代表一本书/文章）
    func fetchNotebooks() async throws -> [WeReadNotebook]
    /// 获取单本书的详细信息
    func fetchBookInfo(bookId: String) async throws -> WeReadBookInfo
    /// 获取单本书的所有高亮
    func fetchBookmarks(bookId: String) async throws -> [WeReadBookmark]
    /// 获取单本书的个人想法/书评
    func fetchReviews(bookId: String) async throws -> [WeReadReview]
    /// 获取书籍的高亮并与想法合并（基于 range 字段）
    func fetchMergedHighlights(bookId: String) async throws -> [WeReadBookmark]
    
    // MARK: - 增量同步 API
    
    /// 增量获取 Notebook 列表（使用 synckey）
    /// - Parameter syncKey: 上次同步的 synckey，传 0 表示全量获取
    /// - Returns: 增量响应，包含新的 synckey、更新的书籍和删除的书籍 ID
    func fetchNotebooksIncremental(syncKey: Int) async throws -> NotebooksIncrementalResponse
    
    /// 增量获取单本书的高亮（使用 synckey）
    /// - Parameters:
    ///   - bookId: 书籍 ID
    ///   - syncKey: 上次同步的 synckey，传 0 表示全量获取
    /// - Returns: 增量响应，包含新的 synckey、更新的高亮和删除的高亮 ID
    func fetchBookmarksIncremental(bookId: String, syncKey: Int) async throws -> BookmarksIncrementalResponse
}

/// WeRead 本地缓存服务协议
/// 所有方法内部使用独立的 ModelContext 在后台线程执行，调用方无需关心线程问题
protocol WeReadCacheServiceProtocol: AnyObject {
    // MARK: - 书籍操作
    
    /// 获取所有缓存的书籍
    func getAllBooks() async throws -> [CachedWeReadBook]
    
    /// 获取指定书籍
    func getBook(bookId: String) async throws -> CachedWeReadBook?
    
    /// 保存书籍列表到缓存
    func saveBooks(_ notebooks: [WeReadNotebook]) async throws
    
    /// 删除指定书籍
    func deleteBooks(ids: [String]) async throws
    
    /// 更新书籍的高亮数量
    func updateBookHighlightCount(bookId: String, count: Int) async throws
    
    // MARK: - 高亮操作
    
    /// 获取指定书籍的所有高亮
    func getHighlights(bookId: String) async throws -> [CachedWeReadHighlight]
    
    /// 保存高亮列表到缓存
    func saveHighlights(_ bookmarks: [WeReadBookmark], bookId: String) async throws
    
    /// 删除指定高亮
    func deleteHighlights(ids: [String]) async throws
    
    // MARK: - 同步状态
    
    /// 获取全局同步状态
    func getSyncState() async throws -> WeReadSyncState
    
    /// 更新全局同步状态
    func updateSyncState(notebookSyncKey: Int?, lastSyncAt: Date?) async throws
    
    /// 获取指定书籍的高亮 synckey
    func getBookSyncKey(bookId: String) async throws -> Int?
    
    /// 更新指定书籍的高亮 synckey
    func updateBookSyncKey(bookId: String, syncKey: Int) async throws
    
    // MARK: - 清理
    
    /// 清除所有缓存数据
    func clearAllCache() async throws
    
    // MARK: - 统计
    
    /// 获取缓存统计信息
    func getCacheStats() async throws -> WeReadCacheStats
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

// MARK: - Sync Activity Monitor Protocol
/// 汇总应用范围内的同步活动，用于退出拦截提示等场景。
protocol SyncActivityMonitorProtocol: AnyObject {
    var isSyncing: Bool { get }
}

// MARK: - Sync Queue Store Protocol
protocol SyncQueueStoreProtocol: AnyObject {
    /// 当前任务的快照（线程安全读取）
    var snapshot: [SyncQueueTask] { get }
    /// 任务流（主线程交付）
    var tasksPublisher: AnyPublisher<[SyncQueueTask], Never> { get }
}

// MARK: - Dedao Auth & Data Protocols

/// 管理 Dedao 认证 Cookie 的服务协议
protocol DedaoAuthServiceProtocol: AnyObject {
    /// 当前是否已登录（依据是否存在可用 Cookie）
    var isLoggedIn: Bool { get }
    /// 已持久化的 Cookie Header（`Cookie: ...` 的值部分）
    var cookieHeader: String? { get }
    
    /// 更新并持久化新的 Cookie Header
    func updateCookieHeader(_ header: String)
    /// 清除本地存储的 Cookie 与登录状态（包括 WebKit cookies）
    func clearCookies() async
}

/// Dedao API 服务协议
protocol DedaoAPIServiceProtocol: AnyObject {
    /// 获取用户书架中的电子书列表
    /// - Parameter page: 页码，从 1 开始
    /// - Returns: 电子书列表
    func fetchEbooks(page: Int) async throws -> [DedaoEbook]
    
    /// 获取所有电子书（自动分页）
    /// - Returns: 所有电子书
    func fetchAllEbooks() async throws -> [DedaoEbook]
    
    /// 获取指定电子书的笔记列表
    /// - Parameters:
    ///   - ebookEnid: 电子书的 enid
    ///   - bookTitle: 书名（可选，用于日志记录）
    /// - Returns: 笔记列表
    func fetchEbookNotes(ebookEnid: String, bookTitle: String?) async throws -> [DedaoEbookNote]
    
    /// 获取用户信息
    /// - Returns: 用户信息
    func fetchUserInfo() async throws -> DedaoUserInfo
    
    /// 生成二维码用于扫码登录
    /// - Returns: 二维码响应
    func generateQRCode() async throws -> DedaoQRCodeResponse
    
    /// 检查二维码登录状态
    /// - Parameter qrCodeString: 二维码字符串
    /// - Returns: 登录检查响应
    func checkQRCodeLogin(qrCodeString: String) async throws -> DedaoCheckLoginResponse
}

/// Dedao 本地数据存储服务协议
/// 使用 @ModelActor 在后台线程执行所有数据库操作，不阻塞主线程
/// 注意：由于使用 Actor，所有方法调用都是异步的
protocol DedaoCacheServiceProtocol: Actor {
    // MARK: - 书籍操作
    
    /// 获取所有本地存储的书籍（返回 Sendable DTO）
    func getAllBooks() throws -> [DedaoBookListItem]
    
    /// 获取指定书籍
    func getBook(bookId: String) throws -> CachedDedaoBook?
    
    /// 保存书籍列表
    func saveBooks(_ ebooks: [DedaoEbook]) throws
    
    /// 删除指定书籍
    func deleteBooks(ids: [String]) throws
    
    /// 更新书籍的高亮数量
    func updateBookHighlightCount(bookId: String, count: Int) throws
    
    // MARK: - 高亮操作
    
    /// 获取指定书籍的所有高亮（返回 Sendable DTO）
    func getHighlights(bookId: String) throws -> [DedaoEbookNote]
    
    /// 保存高亮列表
    func saveHighlights(_ notes: [DedaoEbookNote], bookId: String) throws
    
    /// 删除指定高亮
    func deleteHighlights(ids: [String]) throws
    
    // MARK: - 同步状态
    
    /// 获取全局同步状态（返回 Sendable 快照）
    func getSyncState() throws -> DedaoSyncStateSnapshot
    
    /// 更新同步状态
    func updateSyncState(lastFullSyncAt: Date?, lastIncrementalSyncAt: Date?) throws
    
    // MARK: - 清理
    
    /// 清除所有本地数据
    func clearAllData() throws
    
    // MARK: - 统计
    
    /// 获取本地数据统计信息
    func getDataStats() throws -> DedaoDataStats
}

/// Dedao 本地数据统计
struct DedaoDataStats {
    let bookCount: Int
    let highlightCount: Int
    let lastSyncAt: Date?
}
