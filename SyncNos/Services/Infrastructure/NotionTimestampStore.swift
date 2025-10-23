import Foundation

final class NotionTimestampStore: SyncTimestampStoreProtocol {
    private let notionService: NotionServiceProtocol
    private let config: NotionConfigStoreProtocol
    private let logger: LoggerServiceProtocol

    private let cacheQueue = DispatchQueue(label: "timestamp.cache.queue", qos: .utility)
    private var lastSyncCache: [String: Date] = [:]

    init(notionService: NotionServiceProtocol = DIContainer.shared.notionService,
         config: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
         logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.notionService = notionService
        self.config = config
        self.logger = logger
    }

    func cachedLastSync(for id: String) -> Date? {
        cacheQueue.sync { lastSyncCache[id] }
    }

    func prefetch(for ids: [String], source: String) async {
        guard !ids.isEmpty else { return }
        let isPerBook = (source == "appleBooks") && ((config.syncMode ?? "single") == "perBook")
        do {
            if !isPerBook {
                // Single database per source (appleBooks/goodLinks)
                guard let parentPageId = config.notionPageId else { return }
                let title = (source == "appleBooks") ? "SyncNos-AppleBooks" : "SyncNos-GoodLinks"
                let dbId = try await notionService.ensureDatabaseIdForSource(title: title, parentPageId: parentPageId, sourceKey: source)
                try await ensureLastSyncProperty(databaseId: dbId)
                for id in ids {
                    if let pageId = try await notionService.findPageIdByAssetId(databaseId: dbId, assetId: id) {
                        if let date = try await notionService.fetchPageDateProperty(pageId: pageId, name: "Last Sync Time") {
                            cacheQueue.async { self.lastSyncCache[id] = date }
                        }
                    }
                }
            } else {
                // Per-book database (Apple Books perBook mode)
                for id in ids {
                    if let dbId = config.databaseIdForBook(assetId: id) {
                        try await ensureLastSyncProperty(databaseId: dbId)
                        if let metaId = try await notionService.findHighlightItemPageIdByUUID(databaseId: dbId, uuid: "SYNC_META") {
                            if let date = try await notionService.fetchPageDateProperty(pageId: metaId, name: "Last Sync Time") {
                                cacheQueue.async { self.lastSyncCache[id] = date }
                            }
                        }
                    }
                }
            }
        } catch {
            logger.debug("prefetch last sync failed: \(error.localizedDescription)")
        }
    }

    func getLastSyncTime(for id: String, source: String) async -> Date? {
        if let c = cachedLastSync(for: id) { return c }
        let isPerBook = (source == "appleBooks") && ((config.syncMode ?? "single") == "perBook")
        do {
            if !isPerBook {
                guard let parentPageId = config.notionPageId else { return nil }
                let title = (source == "appleBooks") ? "SyncNos-AppleBooks" : "SyncNos-GoodLinks"
                let dbId = try await notionService.ensureDatabaseIdForSource(title: title, parentPageId: parentPageId, sourceKey: source)
                try await ensureLastSyncProperty(databaseId: dbId)
                if let pageId = try await notionService.findPageIdByAssetId(databaseId: dbId, assetId: id) {
                    let date = try await notionService.fetchPageDateProperty(pageId: pageId, name: "Last Sync Time")
                    if let d = date { cacheQueue.async { self.lastSyncCache[id] = d } }
                    return date
                }
                return nil
            } else {
                if let dbId = config.databaseIdForBook(assetId: id) {
                    try await ensureLastSyncProperty(databaseId: dbId)
                    if let metaId = try await notionService.findHighlightItemPageIdByUUID(databaseId: dbId, uuid: "SYNC_META") {
                        let date = try await notionService.fetchPageDateProperty(pageId: metaId, name: "Last Sync Time")
                        if let d = date { cacheQueue.async { self.lastSyncCache[id] = d } }
                        return date
                    }
                }
                return nil
            }
        } catch {
            logger.debug("getLastSyncTime failed: \(error.localizedDescription)")
            return nil
        }
    }

    func setLastSyncTime(for id: String, source: String, to date: Date) async throws {
        let iso = ISO8601DateFormatter().string(from: date)
        let isPerBook = (source == "appleBooks") && ((config.syncMode ?? "single") == "perBook")
        if !isPerBook {
            guard let parentPageId = config.notionPageId else { return }
            let title = (source == "appleBooks") ? "SyncNos-AppleBooks" : "SyncNos-GoodLinks"
            let dbId = try await notionService.ensureDatabaseIdForSource(title: title, parentPageId: parentPageId, sourceKey: source)
            try await ensureLastSyncProperty(databaseId: dbId)
            let properties: [String: Any] = ["Last Sync Time": ["date": ["start": iso]]]
            if let pageId = try await notionService.findPageIdByAssetId(databaseId: dbId, assetId: id) {
                try await notionService.updatePageProperties(pageId: pageId, properties: properties)
            } else {
                logger.debug("setLastSyncTime: page not found for id=\(id), source=\(source); skip creating")
            }
        } else {
            if let dbId = config.databaseIdForBook(assetId: id) {
                try await ensureLastSyncProperty(databaseId: dbId)
                let properties: [String: Any] = [
                    "UUID": ["rich_text": [["text": ["content": "SYNC_META"]]]],
                    "Text": ["title": [["text": ["content": "Meta"]]]],
                    "Last Sync Time": ["date": ["start": iso]]
                ]
                if let metaId = try await notionService.findHighlightItemPageIdByUUID(databaseId: dbId, uuid: "SYNC_META") {
                    try await notionService.updatePageProperties(pageId: metaId, properties: ["Last Sync Time": ["date": ["start": iso]]])
                } else {
                    // 创建一条 Meta 高亮项用于保存时间戳
                    let h = HighlightRow(assetId: id, uuid: "SYNC_META", text: "Meta", note: nil, style: nil, dateAdded: nil, modified: nil, location: nil)
                    _ = try await notionService.createHighlightItem(inDatabaseId: dbId, bookId: id, bookTitle: "", author: "", highlight: h)
                    if let metaId = try await notionService.findHighlightItemPageIdByUUID(databaseId: dbId, uuid: "SYNC_META") {
                        try await notionService.updatePageProperties(pageId: metaId, properties: ["Last Sync Time": ["date": ["start": iso]]])
                    }
                }
            }
        }
        cacheQueue.async { self.lastSyncCache[id] = date }
    }

    // MARK: - Helpers
    private func ensureLastSyncProperty(databaseId: String) async throws {
        let defs: [String: Any] = ["Last Sync Time": ["date": [:]]]
        try await notionService.ensureDatabaseProperties(databaseId: databaseId, definitions: defs)
    }
}


