import Foundation

/// SharedDefaults 提供对 App Group UserDefaults 的封装，并支持从标准 defaults 的一次性迁移。
final class SharedDefaults {
    static let shared = SharedDefaults()

    /// 主共享 suite 名称（与 Xcode entitlement 中的 App Group 保持一致）
    static let suiteName = "group.com.chiimagnus.macOS"

    let defaults: UserDefaults

    private init() {
        if let d = UserDefaults(suiteName: Self.suiteName) {
            defaults = d
        } else {
            // 兜底到 standard，避免在 unit test / CI 环境崩溃
            defaults = .standard
        }
    }

    // MARK: - Convenience helpers
    func data(forKey key: String) -> Data? {
        return defaults.data(forKey: key)
    }

    func set(_ data: Data, forKey key: String) {
        defaults.set(data, forKey: key)
    }

    func string(forKey key: String) -> String? {
        return defaults.string(forKey: key)
    }

    func set(_ value: String?, forKey key: String) {
        if let v = value { defaults.set(v, forKey: key) } else { defaults.removeObject(forKey: key) }
    }

    func bool(forKey key: String) -> Bool {
        return defaults.bool(forKey: key)
    }

    func set(_ value: Bool, forKey key: String) {
        defaults.set(value, forKey: key)
    }

    // MARK: - Migration (one-time)
    /// 从 UserDefaults.standard 迁移若干关键键值到 App Group（仅当目标不存在时才迁移）
    func migrateIfNeeded() {
        let keysToMigrateStrings = [
            // Auto Sync flags
            "autoSync.appleBooks", "autoSync.goodLinks", "autoSyncEnabled",
            // Notion config
            "NOTION_KEY", "NOTION_PAGE_ID", "NOTION_SYNC_MODE",
            // Bookmarks
            "SelectedBooksFolderBookmark", "SelectedGoodLinksFolderBookmark"
        ]

        let std = UserDefaults.standard
        for k in keysToMigrateStrings {
            // If suite already has a value, skip
            if defaults.object(forKey: k) != nil { continue }
            if let data = std.data(forKey: k) {
                defaults.set(data, forKey: k)
                continue
            }
            if let s = std.string(forKey: k) {
                defaults.set(s, forKey: k)
                continue
            }
            // For bools, only migrate if key exists in standard
            if std.object(forKey: k) != nil {
                let b = std.bool(forKey: k)
                defaults.set(b, forKey: k)
            }
        }
    }
}


