import Foundation
import Combine

final class GoodLinksSyncProvider: SyncSourceProvider {
    var source: ContentSource { .goodLinks }
    
    private let goodLinksDatabaseService = DIContainer.shared.goodLinksService
    private let goodLinksSyncService = GoodLinksSyncService() // Using default DIContainer inside
    private let logger = DIContainer.shared.loggerService
    
    var isAutoSyncEnabled: Bool {
        UserDefaults.standard.bool(forKey: "autoSync.goodLinks")
    }
    
    func triggerAutoSync() async throws {
        guard isAutoSyncEnabled else { return }
        
        // 1. Resolve DB Path
        let dbPath = goodLinksDatabaseService.resolveDatabasePath()
        guard FileManager.default.fileExists(atPath: dbPath) else {
            logger.warning("AutoSync[GoodLinks] skipped: DB not found at \(dbPath)")
            return
        }
        
        logger.info("AutoSync[GoodLinks]: checking for updates...")
        
        // 2. Open Read-only session
        let session = try goodLinksDatabaseService.makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }
        
        // 3. Fetch all links
        let allLinks = try session.fetchRecentLinks(limit: 0)
        let linkIds = allLinks.map { $0.id }.sorted()
        if linkIds.isEmpty { return }
        
        // 4. Filter eligible links (incremental sync)
        var linkMeta: [String: GoodLinksLinkRow] = [:]
        for link in allLinks { linkMeta[link.id] = link }
        
        let now = Date()
        let intervalSeconds: TimeInterval = 24 * 60 * 60
        var eligibleIds: [String] = []
        
        for id in linkIds {
            if let last = SyncTimestampStore.shared.getLastSyncTime(for: id),
               now.timeIntervalSince(last) < intervalSeconds {
                logger.info("AutoSync[GoodLinks] skipped for \(id): recent sync")
                NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "skipped"])
                continue
            }
            eligibleIds.append(id)
        }
        
        if eligibleIds.isEmpty {
            logger.info("AutoSync[GoodLinks]: No new items to sync")
            return
        }
        
        logger.info("AutoSync[GoodLinks]: Found \(eligibleIds.count) items to sync")
        
        // 5. Enqueue tasks
        var items: [[String: Any]] = []
        items.reserveCapacity(eligibleIds.count)
        for id in eligibleIds {
            let meta = linkMeta[id]
            let title = (meta?.title?.isEmpty == false) ? meta!.title! : (meta?.url ?? id)
            let subtitle = meta?.author ?? ""
            items.append(["id": id, "title": title, "subtitle": subtitle])
        }
        if !items.isEmpty {
            NotificationCenter.default.post(name: Notification.Name("SyncTasksEnqueued"), object: nil, userInfo: ["source": ContentSource.goodLinks.rawValue, "items": items])
        }
        
        // 6. Execute Sync
        let maxConcurrent = NotionSyncConfig.batchConcurrency
        var nextIndex = 0
        
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleIds.count else { return }
                let id = eligibleIds[nextIndex]
                nextIndex += 1
                
                let meta = linkMeta[id]
                let title = (meta?.title?.isEmpty == false) ? meta!.title! : (meta?.url ?? id)
                let author = meta?.author ?? ""
                
                let row = GoodLinksLinkRow(
                    id: id,
                    url: meta?.url ?? id,
                    originalURL: meta?.originalURL,
                    title: title,
                    summary: meta?.summary,
                    author: author,
                    tags: meta?.tags,
                    starred: meta?.starred ?? false,
                    readAt: meta?.readAt ?? 0,
                    addedAt: meta?.addedAt ?? 0,
                    modifiedAt: meta?.modifiedAt ?? 0,
                    highlightTotal: meta?.highlightTotal
                )
                
                group.addTask {
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
                        NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "started"])
                        do {
                            try await self.goodLinksSyncService.syncHighlights(for: row, dbPath: dbPath, pageSize: NotionSyncConfig.goodLinksPageSize) { progress in
                                NotificationCenter.default.post(name: Notification.Name("SyncProgressUpdated"), object: nil, userInfo: ["bookId": id, "progress": progress])
                            }
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "succeeded"])
                        } catch {
                            self.logger.error("AutoSync[GoodLinks] failed for \(id): \(error.localizedDescription)")
                            NotificationCenter.default.post(name: Notification.Name("SyncBookStatusChanged"), object: nil, userInfo: ["bookId": id, "status": "failed"])
                        }
                    }
                }
            }
            
            for _ in 0..<min(maxConcurrent, eligibleIds.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
}

