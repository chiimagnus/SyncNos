import Foundation
import SQLite3

// MARK: - GoodLinks Connection Service

final class GoodLinksConnectionService {
    private let logger = DIContainer.shared.loggerService

    func defaultDatabasePath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/Group Containers/group.com.ngocluu.goodlinks/Data/data.sqlite"
    }

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
            let error = "Failed to open GoodLinks SQLite at \(dbPath) (rc=\(rc))"
            logger.error("GoodLinks DB error: \(error)")
            throw NSError(domain: "SyncNos.GoodLinks", code: 1001, userInfo: [NSLocalizedDescriptionKey: error])
        }
        logger.info("Opened GoodLinks DB: \(dbPath)")
        return handle
    }

    func close(_ db: OpaquePointer?) {
        if let d = db { sqlite3_close(d) }
    }
}
