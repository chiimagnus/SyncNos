import Foundation
import SQLite3

// MARK: - GoodLinks Connection Service

final class GoodLinksConnectionService: Sendable {
    private let logger = DIContainer.shared.loggerService

    func defaultDatabasePath() -> String {
        // 使用用户的真实 home 目录，而不是沙盒容器路径
        // FileManager.default.homeDirectoryForCurrentUser 在沙盒应用中会返回应用容器路径
        let realHomeDirectory: String
        if let pw = getpwuid(getuid()), let home = pw.pointee.pw_dir {
            realHomeDirectory = String(cString: home)
        } else {
            // Fallback to environment variable
            realHomeDirectory = ProcessInfo.processInfo.environment["HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.path
        }
        return "\(realHomeDirectory)/Library/Group Containers/group.com.ngocluu.goodlinks/Data/data.sqlite"
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
