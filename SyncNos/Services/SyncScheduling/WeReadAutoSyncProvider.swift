import Foundation

/// WeRead 自动同步提供者，实现基于 API 的批量增量同步逻辑
final class WeReadAutoSyncProvider: AutoSyncSourceProvider {
    let id: SyncSource = .weRead
    let autoSyncUserDefaultsKey: String = "autoSync.weRead"
    let intervalSeconds: TimeInterval

    private let logger: LoggerServiceProtocol
    private let apiService: WeReadAPIServiceProtocol
    private let authService: WeReadAuthServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol

    private var isSyncing: Bool = false

    init(
        intervalSeconds: TimeInterval = 24 * 60 * 60,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.intervalSeconds = intervalSeconds
        self.logger = logger
        self.apiService = apiService
        self.authService = authService
        self.syncEngine = syncEngine
        self.notionConfig = notionConfig
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

        // 检查 WeRead 是否已登录
        guard authService.isLoggedIn else {
            logger.warning("AutoSync[WeRead] skipped: not logged in")
            return
        }

        isSyncing = true
        logger.info("AutoSync[WeRead]: start syncSmart for all books")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("AutoSync[WeRead]: finished")
            }
            do {
                try await self.syncAllBooksSmart()
            } catch {
                self.logger.error("AutoSync[WeRead] error: \(error.localizedDescription)")
            }
        }
    }

    private func syncAllBooksSmart() async throws {
        // 1. 获取所有有笔记的书籍
        let notebooks = try await apiService.fetchNotebooks()
        
        if notebooks.isEmpty {
            logger.info("AutoSync[WeRead]: no notebooks found")
            return
        }

        // 2. 转换为 WeReadBookListItem
        let books: [WeReadBookListItem] = notebooks.map { notebook in
            WeReadBookListItem(from: notebook)
        }

        if books.isEmpty {
            logger.info("AutoSync[WeRead]: no books with notes found")
            return
        }

        // 3. 预过滤近 intervalSeconds 内已同步过的书籍
        let now = Date()
        var eligibleBooks: [WeReadBookListItem] = []
        for book in books {
            if let last = syncTimestampStore.getLastSyncTime(for: book.bookId),
               now.timeIntervalSince(last) < intervalSeconds {
                logger.info("AutoSync[WeRead] skipped for \(book.bookId): recent sync")
                NotificationCenter.default.post(
                    name: Notification.Name("SyncBookStatusChanged"),
                    object: nil,
                    userInfo: ["bookId": book.bookId, "status": "skipped"]
                )
                continue
            }
            eligibleBooks.append(book)
        }

        if eligibleBooks.isEmpty {
            logger.info("AutoSync[WeRead]: all books recently synced")
            return
        }

        // 4. 入队通知（供 SyncQueueView 显示）
        do {
            var items: [[String: Any]] = []
            items.reserveCapacity(eligibleBooks.count)
            for book in eligibleBooks {
                items.append([
                    "id": book.bookId,
                    "title": book.title,
                    "subtitle": book.author
                ])
            }
            if !items.isEmpty {
                NotificationCenter.default.post(
                    name: Notification.Name("SyncTasksEnqueued"),
                    object: nil,
                    userInfo: ["source": "weRead", "items": items]
                )
            }
        }

        // 5. 并发同步
        let maxConcurrentBooks = NotionSyncConfig.batchConcurrency
        let logger = self.logger
        let syncEngine = self.syncEngine
        let apiService = self.apiService

        var nextIndex = 0
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < eligibleBooks.count else { return }
                let book = eligibleBooks[nextIndex]
                nextIndex += 1

                group.addTask {
                    let limiter = DIContainer.shared.syncConcurrencyLimiter
                    await limiter.withPermit {
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStarted"),
                            object: book.bookId
                        )
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStatusChanged"),
                            object: nil,
                            userInfo: ["bookId": book.bookId, "status": "started"]
                        )
                        do {
                            let adapter = WeReadNotionAdapter(
                                book: book,
                                apiService: apiService
                            )
                            try await syncEngine.syncSmart(source: adapter) { progress in
                                logger.debug("AutoSync[WeRead] progress[\(book.bookId)]: \(progress)")
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "succeeded"]
                            )
                        } catch {
                            logger.error("AutoSync[WeRead] failed for \(book.bookId): \(error.localizedDescription)")
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "failed"]
                            )
                        }
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookFinished"),
                            object: book.bookId
                        )
                    }
                }
            }

            // 初始填充任务
            for _ in 0..<min(maxConcurrentBooks, eligibleBooks.count) {
                addTaskIfPossible()
            }
            // 滑动补位
            while await group.next() != nil {
                addTaskIfPossible()
            }
        }
    }
}

