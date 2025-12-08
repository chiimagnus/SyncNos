import Foundation

/// GoodLinks 自动同步提供者，实现基于本地数据库的批量增量同步逻辑
final class GoodLinksAutoSyncProvider: AutoSyncSourceProvider {
    let id: SyncSource = .goodLinks
    let autoSyncUserDefaultsKey: String = "autoSync.goodLinks"
    let intervalSeconds: TimeInterval

    private let logger: LoggerServiceProtocol
    private let goodLinksDatabaseService: GoodLinksDatabaseServiceExposed
    private let goodLinksSyncService: GoodLinksSyncServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol

    private var isSyncing: Bool = false

    init(
        intervalSeconds: TimeInterval = 24 * 60 * 60,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        goodLinksDatabaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        goodLinksSyncService: GoodLinksSyncServiceProtocol = DIContainer.shared.goodLinksSyncService,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.intervalSeconds = intervalSeconds
        self.logger = logger
        self.goodLinksDatabaseService = goodLinksDatabaseService
        self.goodLinksSyncService = goodLinksSyncService
        self.syncTimestampStore = syncTimestampStore
    }

    // MARK: - Public

    func triggerScheduledSyncIfEnabled() {
        runIfNeeded()
    }

    func triggerManualSyncNow() {
        runIfNeeded()
    }

    // MARK: - Private

    private func runIfNeeded() {
        guard !isSyncing else { return }

        let enabled = UserDefaults.standard.bool(forKey: autoSyncUserDefaultsKey)
        guard enabled else { return }

        // 解析 GoodLinks DB 路径（会自动处理安全范围访问）
        let dbPath = goodLinksDatabaseService.resolveDatabasePath()
        guard FileManager.default.fileExists(atPath: dbPath) else {
            logger.warning("AutoSync skipped: GoodLinks DB not found at \(dbPath)")
            return
        }

        isSyncing = true
        logger.info("AutoSync[GoodLinks]: start sync for eligible links")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                GoodLinksBookmarkStore.shared.stopAccessingIfNeeded()
                self.logger.info("AutoSync[GoodLinks]: finished")
            }
            do {
                try await self.syncAllGoodLinksSmart(dbPath: dbPath)
            } catch {
                self.logger.error("AutoSync[GoodLinks] error: \(error.localizedDescription)")
            }
        }
    }

    private func syncAllGoodLinksSmart(dbPath: String) async throws {
        // 打开只读会话
        let session = try goodLinksDatabaseService.makeReadOnlySession(dbPath: dbPath)
        defer { session.close() }

        // 读取所有链接（包含高亮数为 0 的链接），确保不对链接进行预过滤
        let allLinks = try session.fetchRecentLinks(limit: 0)
        let linkIds = allLinks.map { $0.id }.sorted()
        if linkIds.isEmpty { return }

        // 构造 id -> 元数据映射
        var linkMeta: [String: GoodLinksLinkRow] = [:]
        for link in allLinks { linkMeta[link.id] = link }

        // 并发上限（链接级并行数）
        let maxConcurrentLinks = NotionSyncConfig.batchConcurrency

        // intervalSeconds 时间内已同步过则跳过
        let now = Date()
        var eligibleIds: [String] = []
        for id in linkIds {
            if let last = syncTimestampStore.getLastSyncTime(for: id),
               now.timeIntervalSince(last) < intervalSeconds {
                logger.info("AutoSync skipped for GoodLinks[\(id)]: recent sync")
                NotificationCenter.default.post(
                    name: Notification.Name("SyncBookStatusChanged"),
                    object: nil,
                    userInfo: ["bookId": id, "status": "skipped"]
                )
                continue
            }
            eligibleIds.append(id)
        }
        if eligibleIds.isEmpty { return }

        // 通过 SyncQueueStore 入队，自动处理去重和冷却检查
        let enqueueItems = eligibleIds.map { id -> SyncEnqueueItem in
            let meta = linkMeta[id]
            let title = (meta?.title?.isEmpty == false) ? meta!.title! : (meta?.url ?? id)
            let subtitle = meta?.author ?? ""
            return SyncEnqueueItem(id: id, title: title, subtitle: subtitle)
        }
        
        let acceptedIds = await MainActor.run {
            DIContainer.shared.syncQueueStore.enqueue(source: .goodLinks, items: enqueueItems)
        }
        
        guard !acceptedIds.isEmpty else {
            logger.info("AutoSync[GoodLinks]: no tasks accepted by SyncQueueStore")
            return
        }
        
        // 过滤出被接受的链接 ID
        let acceptedIdList = eligibleIds.filter { acceptedIds.contains($0) }

        // 控制并发同步
        var nextIndex = 0
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < acceptedIdList.count else { return }
                let id = acceptedIdList[nextIndex]; nextIndex += 1
                let meta = linkMeta[id]
                let title = (meta?.title?.isEmpty == false) ? meta!.title! : (meta?.url ?? id)
                let author = meta?.author ?? ""
                // 构造行数据以传入同步服务
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
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStatusChanged"),
                            object: nil,
                            userInfo: ["bookId": id, "status": "started"]
                        )
                        do {
                            try await self.goodLinksSyncService.syncHighlights(
                                for: row,
                                dbPath: dbPath,
                                pageSize: NotionSyncConfig.goodLinksPageSize
                            ) { progress in
                                NotificationCenter.default.post(
                                    name: Notification.Name("SyncProgressUpdated"),
                                    object: nil,
                                    userInfo: ["bookId": id, "progress": progress]
                                )
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": id, "status": "succeeded"]
                            )
                        } catch {
                            self.logger.error("AutoSync[GoodLinks] failed for \(id): \(error.localizedDescription)")
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": id, "status": "failed"]
                            )
                        }
                    }
                }
            }

            for _ in 0..<min(maxConcurrentLinks, acceptedIdList.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
}
