import Foundation

final class NotionConfigStore: NotionConfigStoreProtocol {
    static let shared = NotionConfigStore()
    
    private let userDefaults = UserDefaults.standard
    private let keyKey = "NOTION_KEY"
    private let pageIdKey = "NOTION_PAGE_ID"
    private let appleBooksDbIdKey = "APPLE_BOOKS_DATABASE_ID"
    private let goodLinksDbIdKey = "GOODLINKS_DATABASE_ID"
    private let syncModeKey = "NOTION_SYNC_MODE" // "single" | "perBook"
    private let perBookDbPrefix = "PER_BOOK_DB_ID_" // + assetId
    private let perSourceDbPrefix = "PER_SOURCE_DB_ID_" // + sourceKey
    
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
    

    // MARK: - Split single-database ids per source
    var appleBooksDatabaseId: String? {
        get { userDefaults.string(forKey: appleBooksDbIdKey) }
        set {
            if let value = newValue, !value.isEmpty {
                userDefaults.set(value, forKey: appleBooksDbIdKey)
            } else {
                userDefaults.removeObject(forKey: appleBooksDbIdKey)
            }
        }
    }

    var goodLinksDatabaseId: String? {
        get { userDefaults.string(forKey: goodLinksDbIdKey) }
        set {
            if let value = newValue, !value.isEmpty {
                userDefaults.set(value, forKey: goodLinksDbIdKey)
            } else {
                userDefaults.removeObject(forKey: goodLinksDbIdKey)
            }
        }
    }

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
}
