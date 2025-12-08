import Foundation

/// WeRead 自动同步提供者，实现基于 API 的智能增量同步逻辑
/// 通过比较「书籍更新时间」与「上次同步时间」判断是否需要同步
final class WeReadAutoSyncProvider: AutoSyncSourceProvider {
    let id: SyncSource = .weRead
    let autoSyncUserDefaultsKey: String = "autoSync.weRead"

    private let logger: LoggerServiceProtocol
    private let apiService: WeReadAPIServiceProtocol
    private let authService: WeReadAuthServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol

    private var isSyncing: Bool = false

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
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
            logger.warning("[SmartSync] WeRead skipped: not logged in")
            return
        }

        isSyncing = true
        logger.info("[SmartSync] WeRead: starting check for all books")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("[SmartSync] WeRead: finished")
            }
            do {
                try await self.syncAllBooksSmart()
            } catch {
                self.logger.error("[SmartSync] WeRead error: \(error.localizedDescription)")
            }
        }
    }

    private func syncAllBooksSmart() async throws {
        // 1. 获取所有有笔记的书籍
        let notebooks = try await apiService.fetchNotebooks()
        
        if notebooks.isEmpty {
            logger.info("[SmartSync] WeRead: no notebooks found")
            return
        }

        // 2. 转换为 WeReadBookListItem
        let books: [WeReadBookListItem] = notebooks.map { notebook in
            WeReadBookListItem(from: notebook)
        }

        if books.isEmpty {
            logger.info("[SmartSync] WeRead: no books with notes found")
            return
        }

        // 3. 智能增量过滤：只同步有变更的书籍
        var eligibleBooks: [WeReadBookListItem] = []
        for book in books {
            let lastSyncTime = syncTimestampStore.getLastSyncTime(for: book.bookId)
            
            // 情况 1：从未同步过 → 需要同步（首次）
            if lastSyncTime == nil {
                logger.info("[SmartSync] WeRead[\(book.bookId)]: first sync (never synced)")
                eligibleBooks.append(book)
                continue
            }
            
            // 情况 2：书籍有变更（updatedAt > 上次同步时间）→ 需要同步
            if let updatedAt = book.updatedAt, updatedAt > lastSyncTime! {
                logger.info("[SmartSync] WeRead[\(book.bookId)]: changes detected (updated: \(updatedAt), lastSync: \(lastSyncTime!))")
                eligibleBooks.append(book)
                continue
            }
            
            // 情况 3：书籍无变更 → 跳过
            logger.debug("[SmartSync] WeRead[\(book.bookId)]: skipped (no changes)")
            NotificationCenter.default.post(
                name: Notification.Name("SyncBookStatusChanged"),
                object: nil,
                userInfo: ["bookId": book.bookId, "status": "skipped"]
            )
        }

        if eligibleBooks.isEmpty {
            logger.info("[SmartSync] WeRead: all books up to date, nothing to sync")
            return
        }

        // 4. 通过 SyncQueueStore 入队，自动处理去重和冷却检查
        let enqueueItems = eligibleBooks.map { book in
            SyncEnqueueItem(id: book.bookId, title: book.title, subtitle: book.author)
        }
        
        let acceptedIds = await MainActor.run {
            DIContainer.shared.syncQueueStore.enqueue(source: .weRead, items: enqueueItems)
        }
        
        guard !acceptedIds.isEmpty else {
            logger.info("[SmartSync] WeRead: no tasks accepted (all in cooldown)")
            return
        }
        
        // 过滤出被接受的书籍
        let acceptedBooks = eligibleBooks.filter { acceptedIds.contains($0.bookId) }

        // 5. 并发同步
        let maxConcurrentBooks = NotionSyncConfig.batchConcurrency
        let logger = self.logger
        let syncEngine = self.syncEngine
        let apiService = self.apiService

        var nextIndex = 0
        await withTaskGroup(of: Void.self) { group in
            func addTaskIfPossible() {
                guard nextIndex < acceptedBooks.count else { return }
                let book = acceptedBooks[nextIndex]
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
                                logger.debug("[SmartSync] WeRead[\(book.bookId)] progress: \(progress)")
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "succeeded"]
                            )
                        } catch {
                            logger.error("[SmartSync] WeRead[\(book.bookId)] failed: \(error.localizedDescription)")
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
            for _ in 0..<min(maxConcurrentBooks, acceptedBooks.count) {
                addTaskIfPossible()
            }
            // 滑动补位
            while await group.next() != nil {
                addTaskIfPossible()
            }
        }
    }
}

