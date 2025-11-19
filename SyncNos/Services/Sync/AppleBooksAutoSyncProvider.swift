import Foundation

/// Apple Books 自动同步提供者，实现基于数据库的批量增量同步逻辑
final class AppleBooksAutoSyncProvider: AutoSyncSourceProvider {
    let id: SyncSource = .appleBooks
    let autoSyncUserDefaultsKey: String = "autoSync.appleBooks"
    let intervalSeconds: TimeInterval

    private let logger: LoggerServiceProtocol
    private let databaseService: DatabaseServiceProtocol
    private let appleBooksSyncService: AppleBooksSyncServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let bookmarkStore: BookmarkStoreProtocol

    private var isSyncing: Bool = false

    init(
        intervalSeconds: TimeInterval = 24 * 60 * 60,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
        appleBooksSyncService: AppleBooksSyncServiceProtocol = DIContainer.shared.appleBooksSyncService,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        bookmarkStore: BookmarkStoreProtocol = DIContainer.shared.bookmarkStore
    ) {
        self.intervalSeconds = intervalSeconds
        self.logger = logger
        self.databaseService = databaseService
        self.appleBooksSyncService = appleBooksSyncService
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
            logger.warning("AutoSync skipped: Apple Books root not selected")
            return
        }

        let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
        let booksDir = (root as NSString).appendingPathComponent("BKLibrary")

        guard let annotationDB = latestSQLiteFile(in: annotationDir) else {
            logger.warning("AutoSync skipped: annotation DB not found")
            return
        }
        let booksDB = latestSQLiteFile(in: booksDir)

        isSyncing = true
        logger.info("AutoSync[AppleBooks]: start syncSmart for all books")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("AutoSync[AppleBooks]: finished")
            }
            do {
                try await self.syncAllBooksSmart(annotationDBPath: annotationDB, booksDBPath: booksDB)
            } catch {
                self.logger.error("AutoSync[AppleBooks] error: \(error.localizedDescription)")
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

        // 取出有高亮的所有书籍 assetId（稳定排序，避免边界项被跳过）
        let counts = try databaseService.fetchHighlightCountsByAsset(db: handle)
        let assetIds = counts.map { $0.assetId }.sorted()
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

        // 预过滤近 intervalSeconds 内已同步过的书籍，并即时发送跳过通知
        let now = Date()
        var eligibleIds: [String] = []
        for id in assetIds {
            if let last = syncTimestampStore.getLastSyncTime(for: id),
               now.timeIntervalSince(last) < intervalSeconds {
                logger.info("AutoSync skipped for \(id): recent sync")
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

        // 在队列中入队（queued），以便 SyncQueueView 正确展示 AutoSync 任务
        do {
            var items: [[String: Any]] = []
            items.reserveCapacity(eligibleIds.count)
            for id in eligibleIds {
                let meta = bookMeta[id]
                let title = (meta?.title.isEmpty == false) ? meta!.title : id
                let subtitle = meta?.author ?? ""
                items.append(["id": id, "title": title, "subtitle": subtitle])
            }
            if !items.isEmpty {
                NotificationCenter.default.post(
                    name: Notification.Name("SyncTasksEnqueued"),
                    object: nil,
                    userInfo: ["source": "appleBooks", "items": items]
                )
            }
        }

        // 局部引用，避免在并发闭包中强捕获 self 成员
        let logger = self.logger
        let syncService = self.appleBooksSyncService
        let dbPathLocal = annotationDBPath

        // 有界并发：最多同时处理 maxConcurrentBooks 本书
        var nextIndex = 0
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleIds.count else { return }
                let id = eligibleIds[nextIndex]; nextIndex += 1
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
                            try await syncService.syncSmart(book: book, dbPath: dbPathLocal) { progress in
                                logger.debug("AutoSync progress[\(id)]: \(progress)")
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": id, "status": "succeeded"]
                            )
                        } catch {
                            logger.error("AutoSync failed for \(id): \(error.localizedDescription)")
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": id, "status": "failed"]
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
            for _ in 0..<min(maxConcurrentBooks, eligibleIds.count) { addTaskIfPossible() }
            // 滑动补位，始终保持最多 maxConcurrentBooks 在执行
            while await group.next() != nil { addTaskIfPossible() }
        }
    }
}


