import Foundation

/// GoodLinks 自动同步提供者，实现基于本地数据库的智能增量同步逻辑
/// 通过比较「文章修改时间」与「上次同步时间」判断是否需要同步
final class GoodLinksAutoSyncProvider: AutoSyncSourceProvider {
    let id: ContentSource = .goodLinks
    let autoSyncUserDefaultsKey: String = "autoSync.goodLinks"

    private let logger: LoggerServiceProtocol
    private let goodLinksDatabaseService: GoodLinksDatabaseServiceExposed
    private let syncEngine: NotionSyncEngine
    private let syncTimestampStore: SyncTimestampStoreProtocol

    private var isSyncing: Bool = false

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        goodLinksDatabaseService: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.logger = logger
        self.goodLinksDatabaseService = goodLinksDatabaseService
        self.syncEngine = syncEngine
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
            logger.warning("[SmartSync] GoodLinks skipped: DB not found at \(dbPath)")
            return
        }

        isSyncing = true
        logger.info("[SmartSync] GoodLinks: starting check for all links")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("[SmartSync] GoodLinks: finished")
            }
            do {
                try await self.syncAllGoodLinksSmart(dbPath: dbPath)
            } catch {
                self.logger.error("[SmartSync] GoodLinks error: \(error.localizedDescription)")
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

        // 智能增量过滤：只同步有变更的文章
        var eligibleIds: [String] = []
        for id in linkIds {
            let lastSyncTime = syncTimestampStore.getLastSyncTime(for: id)
            let linkInfo = linkMeta[id]
            let articleLabel = formatArticleLabel(title: linkInfo?.title, author: linkInfo?.author, fallbackId: id)
            
            // 情况 1：从未同步过 → 需要同步（首次）
            if lastSyncTime == nil {
                logger.info("[SmartSync] GoodLinks: \(articleLabel) - first sync (never synced)")
                eligibleIds.append(id)
                continue
            }
            
            // 情况 2：文章有变更（modifiedAt > 上次同步时间）→ 需要同步
            if let modifiedAt = linkInfo?.modifiedAt, modifiedAt > 0 {
                let modifiedDate = Date(timeIntervalSince1970: modifiedAt)
                if modifiedDate > lastSyncTime! {
                    logger.info("[SmartSync] GoodLinks: \(articleLabel) - changes detected")
                    eligibleIds.append(id)
                    continue
                }
            }
            
            // 情况 3：文章无变更 → 跳过
            logger.debug("[SmartSync] GoodLinks: \(articleLabel) - skipped (no changes)")
            NotificationCenter.default.post(
                name: .syncBookStatusChanged,
                object: nil,
                userInfo: ["bookId": id, "status": "skipped"]
            )
        }
        if eligibleIds.isEmpty {
            logger.info("[SmartSync] GoodLinks: all links up to date, nothing to sync")
            return
        }

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
            logger.info("[SmartSync] GoodLinks: no tasks accepted (all in cooldown)")
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
                            name: .syncBookStatusChanged,
                            object: nil,
                            userInfo: ["bookId": id, "status": "started"]
                        )
                        do {
                            // 创建适配器并使用统一同步引擎
                            let adapter = try GoodLinksNotionAdapter.create(
                                link: row,
                                dbPath: dbPath,
                                databaseService: self.goodLinksDatabaseService
                            )
                            try await self.syncEngine.syncSmart(source: adapter) { progress in
                                NotificationCenter.default.post(
                                    name: .syncProgressUpdated,
                                    object: nil,
                                    userInfo: ["bookId": id, "progress": progress]
                                )
                            }
                            NotificationCenter.default.post(
                                name: .syncBookStatusChanged,
                                object: nil,
                                userInfo: ["bookId": id, "status": "succeeded"]
                            )
                        } catch {
                            let articleLabel = self.formatArticleLabel(title: title, author: author, fallbackId: id)
                            self.logger.error("[SmartSync] GoodLinks: \(articleLabel) - failed: \(error.localizedDescription)")
                            let errorInfo = SyncErrorInfo.from(error)
                            NotificationCenter.default.post(
                                name: .syncBookStatusChanged,
                                object: nil,
                                userInfo: ["bookId": id, "status": "failed", "errorInfo": errorInfo]
                            )
                        }
                    }
                }
            }

            for _ in 0..<min(maxConcurrentLinks, acceptedIdList.count) { addTaskIfPossible() }
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
    
    /// 格式化文章标签用于日志显示
    private func formatArticleLabel(title: String?, author: String?, fallbackId: String) -> String {
        let displayTitle = (title?.isEmpty == false) ? title! : fallbackId
        if let author = author, !author.isEmpty {
            return "「\(displayTitle)」(\(author))"
        } else {
            return "「\(displayTitle)」"
        }
    }
}
