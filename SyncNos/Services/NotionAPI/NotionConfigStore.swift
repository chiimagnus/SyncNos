import Foundation

final class NotionConfigStore: NotionConfigStoreProtocol {
    static let shared = NotionConfigStore()
    
    private let userDefaults = UserDefaults.standard
    private let keyKey = "NOTION_KEY"
    private let pageIdKey = "NOTION_PAGE_ID"
    private let syncDbIdKey = "SYNC_DATABASE_ID"
    
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
    
    var syncDatabaseId: String? {
        get { userDefaults.string(forKey: syncDbIdKey) }
        set {
            if let value = newValue, !value.isEmpty {
                userDefaults.set(value, forKey: syncDbIdKey)
            } else {
                userDefaults.removeObject(forKey: syncDbIdKey)
            }
        }
    }
}
