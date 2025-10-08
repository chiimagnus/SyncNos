import Foundation

final class SyncTimestampStore {
    static let shared = SyncTimestampStore()
    private let logger = DIContainer.shared.loggerService

    private let userDefaults = UserDefaults.standard
    private let lastSyncKeyPrefix = "LAST_SYNC_TIMESTAMP_"
    private let mappingKeyPrefix = "HIGHLIGHT_UUID_MAPPING_"

    private init() {}

    /// 获取指定书籍的上次同步时间
    /// - Parameter bookId: 书籍ID
    /// - Returns: 上次同步的日期，如果没有则返回nil
    func getLastSyncTime(for bookId: String) -> Date? {
        let key = lastSyncKeyPrefix + bookId
        let date = userDefaults.object(forKey: key) as? Date
        logger.debug("DEBUG: 获取同步时间戳 for 书籍ID: \(bookId) = \(date?.description ?? "nil")")
        return date
    }

    /// 设置指定书籍的上次同步时间
    /// - Parameters:
    ///   - bookId: 书籍ID
    ///   - date: 同步日期
    func setLastSyncTime(for bookId: String, to date: Date) {
        let key = lastSyncKeyPrefix + bookId
        userDefaults.set(date, forKey: key)
        logger.debug("DEBUG: 设置同步时间戳 for 书籍ID: \(bookId) = \(date)")
    }

    // MARK: - Highlight UUID -> Notion block mapping
    func setMapping(for uuid: String, parentBlockId: String, childrenCount: Int, lastSyncedHash: String?) {
        let key = mappingKeyPrefix + uuid
        var dict: [String: Any] = [
            "parentBlockId": parentBlockId,
            "childrenCount": childrenCount
        ]
        if let h = lastSyncedHash { dict["lastSyncedHash"] = h }
        userDefaults.set(dict, forKey: key)
        logger.debug("DEBUG: 保存 UUID 映射 \(uuid) -> \(parentBlockId) children:\(childrenCount)")
    }

    func getMapping(for uuid: String) -> (parentBlockId: String, childrenCount: Int, lastSyncedHash: String?)? {
        let key = mappingKeyPrefix + uuid
        guard let dict = userDefaults.dictionary(forKey: key) else { return nil }
        if let parent = dict["parentBlockId"] as? String, let count = dict["childrenCount"] as? Int {
            let hash = dict["lastSyncedHash"] as? String
            return (parentBlockId: parent, childrenCount: count, lastSyncedHash: hash)
        }
        return nil
    }

    /// Lightweight migration helper: 将从 Notion 页面收集到的 uuid->blockId 映射导入本地 store
    func importMappings(_ mappings: [String: String]) {
        for (uuid, blockId) in mappings {
            // store with unknown childrenCount (-1) and no hash
            setMapping(for: uuid, parentBlockId: blockId, childrenCount: -1, lastSyncedHash: nil)
        }
        logger.debug("DEBUG: 导入 \(mappings.count) 个远程 UUID 映射到本地 store")
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


