import Foundation

final class NotionConfigStore: NotionConfigStoreProtocol {
    static let shared = NotionConfigStore()
    
    private let userDefaults = UserDefaults.standard
    private let keyKey = "NOTION_KEY"
    private let pageIdKey = "NOTION_PAGE_ID"
    // 说明：以下 UserDefaults 键用于持久化 Notion 配置与缓存的数据库映射
    // - NOTION_SYNC_MODE：同步模式（"single" | "perBook"），默认 "single"
    // - PER_BOOK_DB_ID_{assetId}：每本书独立数据库的 id 映射
    // - PER_SOURCE_DB_ID_{sourceKey}：按来源（appleBooks/goodLinks ...）的单库 id 映射
    private let syncModeKey = "NOTION_SYNC_MODE"
    private let perBookDbPrefix = "PER_BOOK_DB_ID_" // + assetId
    private let perSourceDbPrefix = "PER_SOURCE_DB_ID_" // + sourceKey
    // Explicit per-source keys for well-known sources to avoid accidental cross-source reuse
    private let appleBooksSourceKey = "appleBooks"
    private let goodLinksSourceKey = "goodLinks"
    
    private init() {}
    
    var notionKey: String? {
        get { userDefaults.string(forKey: keyKey) }
        set {
            if let value = newValue, !value.isEmpty {
                userDefaults.set(value, forKey: keyKey)
            } else {
                userDefaults.removeObject(forKey: keyKey)
            }
        }
    }
    
    var notionPageId: String? {
        get { userDefaults.string(forKey: pageIdKey) }
        set {
            if let value = newValue, !value.isEmpty {
                userDefaults.set(value, forKey: pageIdKey)
            } else {
                userDefaults.removeObject(forKey: pageIdKey)
            }
        }
    }
    
    var isConfigured: Bool {
        return (notionKey?.isEmpty == false) && (notionPageId?.isEmpty == false)
    }
    

    // MARK: - Split single-database ids per source - now only via generic mapping

    // MARK: - Sync Mode
    var syncMode: String? {
        get {
            // default to "single" for backward compatibility
            return userDefaults.string(forKey: syncModeKey) ?? "single"
        }
        set {
            if let value = newValue, !value.isEmpty {
                userDefaults.set(value, forKey: syncModeKey)
            } else {
                userDefaults.removeObject(forKey: syncModeKey)
            }
        }
    }

    // MARK: - Per-book database mapping
    func databaseIdForBook(assetId: String) -> String? {
        let key = perBookDbPrefix + assetId
        return userDefaults.string(forKey: key)
    }

    func setDatabaseId(_ id: String?, forBook assetId: String) {
        let key = perBookDbPrefix + assetId
        if let id, !id.isEmpty {
            userDefaults.set(id, forKey: key)
        } else {
            userDefaults.removeObject(forKey: key)
        }
    }

    // MARK: - Per-source single database mapping (generic)
    func databaseIdForSource(_ sourceKey: String) -> String? {
        let key = perSourceDbPrefix + sourceKey
        return userDefaults.string(forKey: key)
    }

    func setDatabaseId(_ id: String?, forSource sourceKey: String) {
        let key = perSourceDbPrefix + sourceKey
        if let id, !id.isEmpty {
            userDefaults.set(id, forKey: key)
        } else {
            userDefaults.removeObject(forKey: key)
        }
    }

    // MARK: - Convenience typed accessors for AppleBooks / GoodLinks
    func appleBooksDatabaseId() -> String? {
        return databaseIdForSource(appleBooksSourceKey)
    }

    func setAppleBooksDatabaseId(_ id: String?) {
        setDatabaseId(id, forSource: appleBooksSourceKey)
    }

    func goodLinksDatabaseId() -> String? {
        return databaseIdForSource(goodLinksSourceKey)
    }

    func setGoodLinksDatabaseId(_ id: String?) {
        setDatabaseId(id, forSource: goodLinksSourceKey)
    }

    // per-page mapping removed
}
