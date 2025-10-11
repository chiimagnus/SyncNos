import Foundation

final class NotionConfigStore: NotionConfigStoreProtocol {
    static let shared = NotionConfigStore()
    
    private let userDefaults = UserDefaults.standard
    private let keyKey = "NOTION_KEY"
    private let pageIdKey = "NOTION_PAGE_ID"
    // 说明：以下 UserDefaults 键用于持久化 Notion 配置与缓存的 data_source 映射
    // - NOTION_SYNC_MODE：同步模式（"single" | "perBook"），默认 "single"
    // - PER_BOOK_DATA_SOURCE_ID_{assetId}：每本书独立 data_source id 映射（迁移自 PER_BOOK_DB_ID_）
    // - PER_SOURCE_DATA_SOURCE_ID_{sourceKey}：按来源（appleBooks/goodLinks ...）的单库 data_source id 映射（迁移自 PER_SOURCE_DB_ID_）
    private let syncModeKey = "NOTION_SYNC_MODE"
    private let perBookDataSourcePrefix = "PER_BOOK_DATA_SOURCE_ID_" // + assetId
    private let perSourceDataSourcePrefix = "PER_SOURCE_DATA_SOURCE_ID_" // + sourceKey
    private let perPageDataSourcePrefix = "PER_PAGE_DATA_SOURCE_ID_" // + pageId
    
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
    func dataSourceIdForBook(assetId: String) -> String? {
        let key = perBookDataSourcePrefix + assetId
        return userDefaults.string(forKey: key)
    }

    func setDataSourceId(_ id: String?, forBook assetId: String) {
        let key = perBookDataSourcePrefix + assetId
        if let id, !id.isEmpty {
            userDefaults.set(id, forKey: key)
        } else {
            userDefaults.removeObject(forKey: key)
        }
    }

    // MARK: - Per-source single database mapping (generic)
    func dataSourceIdForSource(_ sourceKey: String) -> String? {
        let key = perSourceDataSourcePrefix + sourceKey
        return userDefaults.string(forKey: key)
    }

    func setDataSourceId(_ id: String?, forSource sourceKey: String) {
        let key = perSourceDataSourcePrefix + sourceKey
        if let id, !id.isEmpty {
            userDefaults.set(id, forKey: key)
        } else {
            userDefaults.removeObject(forKey: key)
        }
    }

    // MARK: - Per-page database mapping
    func dataSourceIdForPage(_ pageId: String) -> String? {
        let key = perPageDataSourcePrefix + pageId
        return userDefaults.string(forKey: key)
    }

    func setDataSourceId(_ id: String?, forPage pageId: String) {
        let key = perPageDataSourcePrefix + pageId
        if let id, !id.isEmpty {
            userDefaults.set(id, forKey: key)
        } else {
            userDefaults.removeObject(forKey: key)
        }
    }

    // MARK: - Backwards-compatible wrappers (keep protocol conformance)
    func databaseIdForSource(_ sourceKey: String) -> String? { return dataSourceIdForSource(sourceKey) }
    func setDatabaseId(_ id: String?, forSource sourceKey: String) { setDataSourceId(id, forSource: sourceKey) }
    func databaseIdForPage(_ pageId: String) -> String? { return dataSourceIdForPage(pageId) }
    func setDatabaseId(_ id: String?, forPage pageId: String) { setDataSourceId(id, forPage: pageId) }
    func databaseIdForBook(assetId: String) -> String? { return dataSourceIdForBook(assetId) }
    func setDatabaseId(_ id: String?, forBook assetId: String) { setDataSourceId(id, forBook: assetId) }

    // MARK: - Migration
    /// Migrate existing stored database ids (old keys) to data_source ids by
    /// discovering the primary data_source for each stored database id and
    /// replacing the stored value. This is safe to call multiple times (idempotent).
    func migrateDatabaseIdsToDataSourceIds(requestHelper: NotionRequestHelper) async {
        // Migrate per-source mappings
        do {
            // Collect all keys for per-source old prefix
            for (k, v) in userDefaults.dictionaryRepresentation() {
                if k.hasPrefix("PER_SOURCE_DB_ID_") {
                    guard let dbId = v as? String else { continue }
                    let sourceKey = String(k.dropFirst("PER_SOURCE_DB_ID_".count))
                    do {
                        let ds = try await requestHelper.getPrimaryDataSourceId(forDatabaseId: dbId)
                        setDataSourceId(ds, forSource: sourceKey)
                        userDefaults.removeObject(forKey: k)
                        logger.info("Migrated per-source database \(dbId) -> data_source \(ds) for source \(sourceKey)")
                    } catch {
                        // On failure remove the old mapping to avoid blocking future operations
                        userDefaults.removeObject(forKey: k)
                        logger.warning("Failed to migrate per-source mapping for key \(k): \(error.localizedDescription). Old key removed.")
                    }
                }
            }
        } catch {
            logger.warning("Unexpected error during per-source migration: \(error)")
        }

        // Migrate per-book mappings
        for (k, v) in userDefaults.dictionaryRepresentation() {
            if k.hasPrefix("PER_BOOK_DB_ID_") {
                guard let dbId = v as? String else { continue }
                let assetId = String(k.dropFirst("PER_BOOK_DB_ID_".count))
                do {
                    let ds = try await requestHelper.getPrimaryDataSourceId(forDatabaseId: dbId)
                    setDataSourceId(ds, forBook: assetId)
                    userDefaults.removeObject(forKey: k)
                    logger.info("Migrated per-book database \(dbId) -> data_source \(ds) for book \(assetId)")
                } catch {
                    userDefaults.removeObject(forKey: k)
                    logger.warning("Failed to migrate per-book mapping for key \(k): \(error.localizedDescription). Old key removed.")
                }
            }
        }

        // Migrate per-page mappings
        for (k, v) in userDefaults.dictionaryRepresentation() {
            if k.hasPrefix("PER_PAGE_DB_ID_") {
                guard let dbId = v as? String else { continue }
                let pageId = String(k.dropFirst("PER_PAGE_DB_ID_".count))
                do {
                    let ds = try await requestHelper.getPrimaryDataSourceId(forDatabaseId: dbId)
                    setDataSourceId(ds, forPage: pageId)
                    userDefaults.removeObject(forKey: k)
                    logger.info("Migrated per-page database \(dbId) -> data_source \(ds) for page \(pageId)")
                } catch {
                    userDefaults.removeObject(forKey: k)
                    logger.warning("Failed to migrate per-page mapping for key \(k): \(error.localizedDescription). Old key removed.")
                }
            }
        }
    }
}
