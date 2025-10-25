import Foundation

final class SyncTimestampStore: SyncTimestampStoreProtocol {
    static let shared = SyncTimestampStore()
    private let logger = DIContainer.shared.loggerService

    private let userDefaults = UserDefaults.standard
    private let lastSyncKeyPrefix = "LAST_SYNC_TIMESTAMP_"

    private init() {}

    /// 获取指定书籍的上次同步时间
    /// - Parameter bookId: 书籍ID
    /// - Returns: 上次同步的日期，如果没有则返回nil
    func getLastSyncTime(for bookId: String) -> Date? {
        let key = lastSyncKeyPrefix + bookId
        // 降低日志噪声：此方法在排序/列表渲染时高频调用，不打印逐条日志
        return userDefaults.object(forKey: key) as? Date
    }

    /// 设置指定书籍的上次同步时间
    /// - Parameters:
    ///   - bookId: 书籍ID
    ///   - date: 同步日期
    func setLastSyncTime(for bookId: String, to date: Date) {
        let key = lastSyncKeyPrefix + bookId
        userDefaults.set(date, forKey: key)
        // 如需详细排查时可打开：
        // logger.debug("Set last sync time for id=\(bookId) = \(date)")
    }

    // /// 清除指定书籍的同步时间
    // /// - Parameter bookId: 书籍ID
    // func clearLastSyncTime(for bookId: String) {
    //     let key = lastSyncKeyPrefix + bookId
    //     userDefaults.removeObject(forKey: key)
    // }

    // /// 清除所有书籍的同步时间
    // func clearAllSyncTimes() {
    //     let defaults = userDefaults.dictionaryRepresentation()
    //     for key in defaults.keys where key.hasPrefix(lastSyncKeyPrefix) {
    //         userDefaults.removeObject(forKey: key)
    //     }
    // }
}


