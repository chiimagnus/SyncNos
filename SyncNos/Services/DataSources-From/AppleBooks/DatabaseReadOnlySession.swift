import Foundation
import SQLite3

// MARK: - Database Read-Only Session
/// 线程安全的只读数据库会话
/// 使用串行队列确保数据库访问的线程安全性，防止快速切换时的竞态条件
final class DatabaseReadOnlySession: DatabaseReadOnlySessionProtocol {
    private let connectionService = DatabaseConnectionService()
    private let queryService = DatabaseQueryService()
    private let logger = DIContainer.shared.loggerService
    private var handle: OpaquePointer?
    
    /// 串行队列，确保所有数据库操作按顺序执行
    private let accessQueue = DispatchQueue(label: "com.syncnos.database.session", qos: .userInitiated)
    
    /// 标记会话是否已关闭
    private var isClosed = false

    init(dbPath: String) throws {
        self.handle = try connectionService.openReadOnlyDatabase(dbPath: dbPath)
    }

    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?) throws -> [HighlightRow] {
        return try fetchHighlightPage(assetId: assetId, limit: limit, offset: offset, since: since, sortField: nil, ascending: nil, noteFilter: nil, styles: nil)
    }

    func fetchHighlightPage(assetId: String, limit: Int, offset: Int, since: Date?, sortField: HighlightSortField?, ascending: Bool?, noteFilter: Bool?, styles: [Int]?) throws -> [HighlightRow] {
        try accessQueue.sync {
            guard !isClosed, let db = handle else {
                // 使用 debug 级别，因为快速切换时 session 被关闭是预期行为
                let error = "Database session is closed"
                logger.debug("Session closed during query (expected during fast switching): \(error)")
                throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
            }
            return try queryService.fetchHighlightPage(db: db, assetId: assetId, limit: limit, offset: offset, since: since, sortField: sortField, ascending: ascending, noteFilter: noteFilter, styles: styles)
        }
    }

    func fetchHighlightCountsByAsset() throws -> [AssetHighlightCount] {
        try accessQueue.sync {
            guard !isClosed, let db = handle else {
                let error = "Database session is closed"
                logger.debug("Session closed during query (expected during fast switching): \(error)")
                throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
            }
            return try queryService.fetchHighlightCountsByAsset(db: db)
        }
    }

    func fetchHighlightStatsByAsset() throws -> [AssetHighlightStats] {
        try accessQueue.sync {
            guard !isClosed, let db = handle else {
                let error = "Database session is closed"
                logger.debug("Session closed during query (expected during fast switching): \(error)")
                throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
            }
            return try queryService.fetchHighlightStatsByAsset(db: db)
        }
    }

    func fetchBooks(assetIds: [String]) throws -> [BookRow] {
        try accessQueue.sync {
            guard !isClosed, let db = handle else {
                let error = "Database session is closed"
                logger.debug("Session closed during query (expected during fast switching): \(error)")
                throw NSError(domain: "SyncBookNotes", code: 11, userInfo: [NSLocalizedDescriptionKey: error])
            }
            return try queryService.fetchBooks(db: db, assetIds: assetIds)
        }
    }

    func close() {
        accessQueue.sync {
            guard !isClosed else { return }
            isClosed = true
            if let h = handle {
                connectionService.close(h)
                handle = nil
                logger.debug("Closed database session")
            }
        }
    }

    deinit {
        // 在 deinit 中不能使用 sync（可能导致死锁），直接关闭
        if !isClosed, let h = handle {
            connectionService.close(h)
        }
    }
}

// MARK: - Sendable Conformance
extension DatabaseReadOnlySession: @unchecked Sendable {}
