import Foundation

final class NotionConfigStore: NotionConfigStoreProtocol {
    static let shared = NotionConfigStore()
    
    private let userDefaults = UserDefaults.standard
    private let keyKey = "NOTION_KEY"
    private let pageIdKey = "NOTION_PAGE_ID"
    // 说明：以下 UserDefaults 键用于持久化 Notion 配置与缓存的数据库映射
    // - NOTION_SYNC_MODE：同步模式（"single" | "perBook"），默认 "single"
    // - PER_BOOK_DATA_SOURCE_ID_{assetId}：每本书独立 data_source_id 映射（2025-09-03+）
    // - PER_SOURCE_DATA_SOURCE_ID_{sourceKey}：按来源（appleBooks/goodLinks ...）的单库 data_source_id 映射（2025-09-03+）
    private let syncModeKey = "NOTION_SYNC_MODE"
    private let perBookDbPrefix = "PER_BOOK_DATA_SOURCE_ID_" // + assetId
    private let perSourceDbPrefix = "PER_SOURCE_DATA_SOURCE_ID_" // + sourceKey
    private let perPageDbPrefix = "PER_PAGE_DATA_SOURCE_ID_" // + pageId
    
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

    // MARK: - Per-page database mapping
    func databaseIdForPage(_ pageId: String) -> String? {
        let key = perPageDbPrefix + pageId
        return userDefaults.string(forKey: key)
    }

    func setDatabaseId(_ id: String?, forPage pageId: String) {
        let key = perPageDbPrefix + pageId
        if let id, !id.isEmpty {
            userDefaults.set(id, forKey: key)
        } else {
            userDefaults.removeObject(forKey: key)
        }
    }

    // MARK: - One-time migration from database_id → data_source_id (2025-09-03)
    /// 读取历史保存的 DB 映射（PER_BOOK_DB_ID_/PER_SOURCE_DB_ID_/PER_PAGE_DB_ID_），
    /// 通过 GET /v1/databases/{database_id} 发现 data_sources[0].id，
    /// 并写入新的 data_source 键（PER_*_DATA_SOURCE_ID_），最后移除旧键。
    ///
    /// 幂等：多次调用不会重复迁移同一条目；发现失败将移除旧键，避免阻塞启动。
    func migrateDatabaseIdsToDataSourceIds(using helper: NotionRequestHelper) async {
        let logger = DIContainer.shared.loggerService
        let defaults = userDefaults.dictionaryRepresentation()

        // 旧前缀
        let oldPerBookPrefix = "PER_BOOK_DB_ID_"
        let oldPerSourcePrefix = "PER_SOURCE_DB_ID_"
        let oldPerPagePrefix = "PER_PAGE_DB_ID_"

        // 逐项处理：book/source/page
        await migrateGroup(oldPrefix: oldPerBookPrefix, newPrefix: perBookDbPrefix, helper: helper, logger: logger)
        await migrateGroup(oldPrefix: oldPerSourcePrefix, newPrefix: perSourceDbPrefix, helper: helper, logger: logger)
        await migrateGroup(oldPrefix: oldPerPagePrefix, newPrefix: perPageDbPrefix, helper: helper, logger: logger)

        // 记录总览
        let remainingOld = defaults.keys.filter { key in
            key.hasPrefix(oldPerBookPrefix) || key.hasPrefix(oldPerSourcePrefix) || key.hasPrefix(oldPerPagePrefix)
        }
        if !remainingOld.isEmpty {
            logger.warning("Migration notice: some old DB-ID keys remain (might be cleared already in this run): \(remainingOld.count)")
        }
    }

    /// 将某一前缀组从旧键迁移到新键
    private func migrateGroup(oldPrefix: String, newPrefix: String, helper: NotionRequestHelper, logger: LoggerServiceProtocol) async {
        let snapshot = userDefaults.dictionaryRepresentation()
        for (key, value) in snapshot where key.hasPrefix(oldPrefix) {
            guard let databaseId = value as? String, !databaseId.isEmpty else {
                userDefaults.removeObject(forKey: key)
                continue
            }
            // 新键若已存在，直接删除旧键并跳过
            let suffix = String(key.dropFirst(oldPrefix.count))
            let newKey = newPrefix + suffix
            if let existing = userDefaults.string(forKey: newKey), !existing.isEmpty {
                userDefaults.removeObject(forKey: key)
                logger.debug("Migration skip (already migrated): \(key) -> \(newKey)")
                continue
            }

            do {
                let dataSourceId = try await helper.getPrimaryDataSourceId(forDatabaseId: databaseId)
                userDefaults.set(dataSourceId, forKey: newKey)
                userDefaults.removeObject(forKey: key)
                logger.debug("Migrated DB → DS: \(key) [\(databaseId)] -> \(newKey) [\(dataSourceId)]")
            } catch {
                // 解析失败：删除旧映射，避免后续逻辑仍然尝试使用失效的 database_id
                userDefaults.removeObject(forKey: key)
                logger.warning("Migration failed for key=\(key), dbId=\(databaseId): \(error.localizedDescription). Old key removed.")
            }
        }
    }
}
