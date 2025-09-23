import Foundation

final class SyncTimestampStore {
    static let shared = SyncTimestampStore()

    private let userDefaults = UserDefaults.standard
    private let lastSyncKeyPrefix = "LAST_SYNC_TIMESTAMP_"

    private init() {}

    /// 获取指定书籍的上次同步时间
    /// - Parameter bookId: 书籍ID
    /// - Returns: 上次同步的日期，如果没有则返回nil
    func getLastSyncTime(for bookId: String) -> Date? {
        let key = lastSyncKeyPrefix + bookId
        let date = userDefaults.object(forKey: key) as? Date
        print("DEBUG: 获取同步时间戳 for 书籍ID: \(bookId) = \(date?.description ?? "nil")")
        return date
    }

    /// 设置指定书籍的上次同步时间
    /// - Parameters:
    ///   - bookId: 书籍ID
    ///   - date: 同步日期
    func setLastSyncTime(for bookId: String, to date: Date) {
        let key = lastSyncKeyPrefix + bookId
        userDefaults.set(date, forKey: key)
        print("DEBUG: 设置同步时间戳 for 书籍ID: \(bookId) = \(date)")
    }

    /// 清除指定书籍的同步时间
    /// - Parameter bookId: 书籍ID
    func clearLastSyncTime(for bookId: String) {
        let key = lastSyncKeyPrefix + bookId
        userDefaults.removeObject(forKey: key)
    }

    /// 清除所有书籍的同步时间
    func clearAllSyncTimes() {
        let defaults = userDefaults.dictionaryRepresentation()
        for key in defaults.keys where key.hasPrefix(lastSyncKeyPrefix) {
            userDefaults.removeObject(forKey: key)
        }
    }
}