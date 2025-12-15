import Foundation

/// Apple Books 自动同步提供者，实现基于数据库的智能增量同步逻辑
/// 通过比较「高亮修改时间」与「上次同步时间」判断是否需要同步
final class AppleBooksAutoSyncProvider: AutoSyncSourceProvider {
    let id: SyncSource = .appleBooks
    let autoSyncUserDefaultsKey: String = "autoSync.appleBooks"

    private let logger: LoggerServiceProtocol
    private let databaseService: DatabaseServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let bookmarkStore: BookmarkStoreProtocol

    private var isSyncing: Bool = false

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        bookmarkStore: BookmarkStoreProtocol = DIContainer.shared.bookmarkStore
    ) {
        self.logger = logger
        self.databaseService = databaseService
        self.syncEngine = syncEngine
        self.notionConfig = notionConfig
        self.syncTimestampStore = syncTimestampStore
        self.bookmarkStore = bookmarkStore
    }

    // MARK: - Public

    func triggerScheduledSyncIfEnabled() {
        runIfNeeded()
    }

    func triggerManualSyncNow() {
        runIfNeeded()
    }

    // MARK: - Private

    /// 从 bookmark 中恢复 Apple Books 根目录
    private var booksRootPath: String? {
        if let url = bookmarkStore.restore() {
            let selectedPath = url.path
            return DatabasePathHelper.determineDatabaseRoot(from: selectedPath)
        }
        return nil
    }

    private func runIfNeeded() {
        guard !isSyncing else { return }

        let enabled = UserDefaults.standard.bool(forKey: autoSyncUserDefaultsKey)
        guard enabled else { return }

        guard let root = booksRootPath else {
            logger.warning("[SmartSync] AppleBooks skipped: root not selected")
            return
        }

        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")

        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            logger.warning("[SmartSync] AppleBooks skipped: annotation DB not found")
            return
        }
        let booksDB = latestSQLiteFile(in: booksDir)

        isSyncing = true
        logger.info("[SmartSync] AppleBooks: starting check for all books")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("[SmartSync] AppleBooks: finished")
            }
            do {
                try await self.syncAllBooksSmart(annotationDBPath: annotationDB, booksDBPath: booksDB)
            } catch {
                self.logger.error("[SmartSync] AppleBooks error: \(error.localizedDescription)")
            }
        }
    }

    private func latestSQLiteFile(in dir: String) -> String? {
        let url = URL(fileURLWithPath: dir)
        guard let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
        let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
        guard !sqliteFiles.isEmpty else { return nil }
        let sorted = sqliteFiles.sorted { a, b in
            (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast >
            (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast
        }
        return sorted.first?.path
    }

    private func syncAllBooksSmart(annotationDBPath: String, booksDBPath: String?) async throws {
        let handle = try databaseService.openReadOnlyDatabase(dbPath: annotationDBPath)
        defer { databaseService.close(handle) }

        // 获取每本书的高亮统计信息（包含 maxModifiedDate）
        let stats = try databaseService.fetchHighlightStatsByAsset(db: handle)
        let statsDict = Dictionary(uniqueKeysWithValues: stats.map { ($0.assetId, $0) })
        let assetIds = stats.map { $0.assetId }.sorted()
        if assetIds.isEmpty { return }

        // 构造资产到书名/作者映射
        var bookMeta: [String: BookRow] = [:]
        if let booksDBPath,
           let booksSession = try? databaseService.makeReadOnlySession(dbPath: booksDBPath) {
            defer { booksSession.close() }
            if let rows = try? booksSession.fetchBooks(assetIds: assetIds) {
                for r in rows { bookMeta[r.assetId] = r }
            }
        }

        // 并发上限（书本级并行数）
        let maxConcurrentBooks = NotionSyncConfig.batchConcurrency

        // 智能增量过滤：只同步有变更的书籍
        var eligibleIds: [String] = []
        for id in assetIds {
            let lastSyncTime = syncTimestampStore.getLastSyncTime(for: id)
            let bookStats = statsDict[id]
            let meta = bookMeta[id]
            let bookLabel = formatBookLabel(title: meta?.title, author: meta?.author, fallbackId: id)
            
            // 情况 1：从未同步过 → 需要同步（首次）
            if lastSyncTime == nil {
                logger.info("[SmartSync] AppleBooks: \(bookLabel) - first sync (never synced)")
                eligibleIds.append(id)
                continue
            }
            
            // 情况 2：书籍有变更（最新修改时间 > 上次同步时间）→ 需要同步
            if let maxModified = bookStats?.maxModifiedDate, maxModified > lastSyncTime! {
                logger.info("[SmartSync] AppleBooks: \(bookLabel) - changes detected")
                eligibleIds.append(id)
                continue
            }
            
            // 情况 3：书籍无变更 → 跳过
            logger.debug("[SmartSync] AppleBooks: \(bookLabel) - skipped (no changes)")
            NotificationCenter.default.post(
                name: Notification.Name("SyncBookStatusChanged"),
                object: nil,
                userInfo: ["bookId": id, "status": "skipped"]
            )
        }
        if eligibleIds.isEmpty {
            logger.info("[SmartSync] AppleBooks: all books up to date, nothing to sync")
            return
        }

        // 通过 SyncQueueStore 入队，自动处理去重和冷却检查
        let enqueueItems = eligibleIds.map { id -> SyncEnqueueItem in
            let meta = bookMeta[id]
            let title = (meta?.title.isEmpty == false) ? meta!.title : id
            let subtitle = meta?.author ?? ""
            return SyncEnqueueItem(id: id, title: title, subtitle: subtitle)
        }
        
        let acceptedIds = await MainActor.run {
            DIContainer.shared.syncQueueStore.enqueue(source: .appleBooks, items: enqueueItems)
        }
        
        guard !acceptedIds.isEmpty else {
            logger.info("[SmartSync] AppleBooks: no tasks accepted (all in cooldown)")
            return
        }
        
        // 过滤出被接受的书籍 ID
        let acceptedIdList = eligibleIds.filter { acceptedIds.contains($0) }

        // 局部引用，避免在并发闭包中强捕获 self 成员
        let logger = self.logger
        let syncEngine = self.syncEngine
        let notionConfig = self.notionConfig
        let dbPathLocal = annotationDBPath

        // 有界并发：最多同时处理 maxConcurrentBooks 本书
        var nextIndex = 0
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < acceptedIdList.count else { return }
                let id = acceptedIdList[nextIndex]; nextIndex += 1
                let meta = bookMeta[id]
                let title = meta?.title ?? id
                let author = meta?.author ?? ""
                let book = BookListItem(
                    bookId: id,
                    authorName: author,
                    bookTitle: title,
                    ibooksURL: "ibooks://assetid/\(id)",
                    highlightCount: 0
                )

                group.addTask {
                    // 与手动批量共享全局并发限制器，确保全局并发不超过 NotionSyncConfig.batchConcurrency
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStarted"),
                            object: id
                        )
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStatusChanged"),
                            object: nil,
                            userInfo: ["bookId": id, "status": "started"]
                        )
                        do {
                            let adapter = AppleBooksNotionAdapter.create(book: book, dbPath: dbPathLocal, notionConfig: notionConfig)
                            try await syncEngine.syncSmart(source: adapter) { progressMessage in
                                NotificationCenter.default.post(
                                    name: Notification.Name("SyncProgressUpdated"),
                                    object: nil,
                                    userInfo: ["bookId": id, "progress": progressMessage]
                                )
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": id, "status": "succeeded"]
                            )
                        } catch {
                            let bookLabel = self.formatBookLabel(title: title, author: author, fallbackId: id)
                            logger.error("[SmartSync] AppleBooks: \(bookLabel) - failed: \(error.localizedDescription)")
                            let errorInfo = SyncErrorInfo.from(error)
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": id, "status": "failed", "errorInfo": errorInfo]
                            )
                        }
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookFinished"),
                            object: id
                        )
                    }
                }
            }

            // 初始填充任务
            for _ in 0..<min(maxConcurrentBooks, acceptedIdList.count) { addTaskIfPossible() }
            // 滑动补位，始终保持最多 maxConcurrentBooks 在执行
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
    
    /// 格式化书籍标签用于日志显示
    private func formatBookLabel(title: String?, author: String?, fallbackId: String) -> String {
        let displayTitle = (title?.isEmpty == false) ? title! : fallbackId
        if let author = author, !author.isEmpty {
            return "《\(displayTitle)》(\(author))"
        } else {
            return "《\(displayTitle)》"
        }
    }
}
