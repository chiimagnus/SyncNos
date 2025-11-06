import Foundation
import SQLite3

// MARK: - Database Connection Service
/// 专门处理数据库连接的类，遵循单一职责原则
final class DatabaseConnectionService: Sendable {
    private let logger = DIContainer.shared.loggerService

    // Bridge C macro SQLITE_TRANSIENT for Swift
    private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    // MARK: - SQLite Connection Methods
    func canOpenReadOnly(dbPath: String) -> Bool {
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
        if rc == SQLITE_OK {
            sqlite3_close(db)
            return true
        }
        return false
    }

    func openReadOnlyDatabase(dbPath: String) throws -> OpaquePointer {
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
        guard rc == SQLITE_OK, let handle = db else {
            let error = "Failed to open SQLite database at \(dbPath) (rc=\(rc))"
            logger.error("Database error: \(error)")
            throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
        }
        logger.info("Successfully opened database: \(dbPath)")
        return handle
    }

    func finalize(_ stmt: OpaquePointer?) {
        if let s = stmt {
            sqlite3_finalize(s)
        }
    }

    func close(_ db: OpaquePointer?) {
        if let d = db {
            sqlite3_close(d)
        }
    }
}