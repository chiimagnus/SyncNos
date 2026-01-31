import Foundation

// MARK: - GoodLinks List Order Builder

/// 统一的 GoodLinks 列表排序器（仅排序，不做过滤）。
///
/// 用途：
/// - ListView 展示排序（由 ViewModel 负责筛选后再排序）
/// - 自动预取/后台任务按用户查看顺序从上到下处理
enum GoodLinksListOrderBuilder {
    // MARK: - UserDefaults Keys

    enum UserDefaultsKeys {
        static let sortKey = "goodlinks_sort_key"
        static let sortAscending = "goodlinks_sort_ascending"
    }

    // MARK: - Preferences

    struct Preferences: Equatable {
        let sortKey: GoodLinksSortKey
        let sortAscending: Bool

        static func load(from userDefaults: UserDefaults = .standard) -> Preferences {
            let key: GoodLinksSortKey
            if let raw = userDefaults.string(forKey: UserDefaultsKeys.sortKey),
               let k = GoodLinksSortKey(rawValue: raw) {
                key = k
            } else {
                key = .modified
            }

            let asc = userDefaults.object(forKey: UserDefaultsKeys.sortAscending) as? Bool ?? false
            return Preferences(sortKey: key, sortAscending: asc)
        }
    }

    static func sortedLinks(
        _ links: [GoodLinksLinkRow],
        sortKey: GoodLinksSortKey,
        sortAscending: Bool,
        syncTimestampStore: SyncTimestampStoreProtocol
    ) -> [GoodLinksLinkRow] {
        var arr = links

        // 预取 lastSync 映射
        var lastSyncCache: [String: Date?] = [:]
        if sortKey == .lastSync {
            lastSyncCache = Dictionary(uniqueKeysWithValues: arr.map { ($0.id, syncTimestampStore.getLastSyncTime(for: $0.id)) })
        }

        arr.sort { a, b in
            switch sortKey {
            case .title:
                let t1 = (a.title?.isEmpty == false ? a.title! : a.url)
                let t2 = (b.title?.isEmpty == false ? b.title! : b.url)
                let cmp = t1.localizedCaseInsensitiveCompare(t2)
                return sortAscending ? (cmp == .orderedAscending) : (cmp == .orderedDescending)
            case .highlightCount:
                let c1 = a.highlightTotal ?? 0
                let c2 = b.highlightTotal ?? 0
                if c1 == c2 { return false }
                return sortAscending ? (c1 < c2) : (c1 > c2)
            case .added:
                if a.addedAt == b.addedAt { return false }
                return sortAscending ? (a.addedAt < b.addedAt) : (a.addedAt > b.addedAt)
            case .modified:
                if a.modifiedAt == b.modifiedAt { return false }
                return sortAscending ? (a.modifiedAt < b.modifiedAt) : (a.modifiedAt > b.modifiedAt)
            case .lastSync:
                let t1 = lastSyncCache[a.id] ?? nil
                let t2 = lastSyncCache[b.id] ?? nil
                if t1 == nil && t2 == nil { return false }
                if t1 == nil { return sortAscending }
                if t2 == nil { return !sortAscending }
                if t1! == t2! { return false }
                return sortAscending ? (t1! < t2!) : (t1! > t2!)
            }
        }

        return arr
    }
}
