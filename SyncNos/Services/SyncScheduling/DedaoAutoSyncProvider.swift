import Foundation

/// Dedao 自动同步提供者，实现基于 API 的批量增量同步逻辑
final class DedaoAutoSyncProvider: AutoSyncSourceProvider {
    let id: SyncSource = .dedao
    let autoSyncUserDefaultsKey: String = "autoSync.dedao"
    let intervalSeconds: TimeInterval
    
    private let logger: LoggerServiceProtocol
    private let apiService: DedaoAPIServiceProtocol
    private let authService: DedaoAuthServiceProtocol
    private let cacheService: DedaoCacheServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    
    private var isSyncing: Bool = false
    
    init(
        intervalSeconds: TimeInterval = 24 * 60 * 60,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        apiService: DedaoAPIServiceProtocol = DIContainer.shared.dedaoAPIService,
        authService: DedaoAuthServiceProtocol = DIContainer.shared.dedaoAuthService,
        cacheService: DedaoCacheServiceProtocol = DIContainer.shared.dedaoCacheService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.intervalSeconds = intervalSeconds
        self.logger = logger
        self.apiService = apiService
        self.authService = authService
        self.cacheService = cacheService
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
        
        // 检查 Dedao 是否已登录
        guard authService.isLoggedIn else {
            logger.warning("AutoSync[Dedao] skipped: not logged in")
            return
        }
        
        isSyncing = true
        logger.info("AutoSync[Dedao]: start syncSmart for all books")
        
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("AutoSync[Dedao]: finished")
            }
            do {
                try await self.syncAllBooksSmart()
            } catch {
                self.logger.error("AutoSync[Dedao] error: \(error.localizedDescription)")
            }
        }
    }
    
    private func syncAllBooksSmart() async throws {
        // 1. 获取所有电子书
        let ebooks = try await apiService.fetchAllEbooks()
        
        if ebooks.isEmpty {
            logger.info("AutoSync[Dedao]: no ebooks found")
            return
        }
        
        // 2. 转换为 DedaoBookListItem
        let books: [DedaoBookListItem] = ebooks.map { ebook in
            DedaoBookListItem(from: ebook)
        }
        
        if books.isEmpty {
            logger.info("AutoSync[Dedao]: no books found")
            return
        }
        
        // 3. 预过滤近 intervalSeconds 内已同步过的书籍
        let now = Date()
        var eligibleBooks: [DedaoBookListItem] = []
        for book in books {
            if let last = syncTimestampStore.getLastSyncTime(for: book.bookId),
               now.timeIntervalSince(last) < intervalSeconds {
                logger.info("AutoSync[Dedao] skipped for \(book.bookId): recent sync")
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
            logger.info("AutoSync[Dedao]: all books recently synced")
            return
        }
        
        // 4. 通过 SyncQueueStore 入队，自动处理去重和冷却检查
        let enqueueItems = eligibleBooks.map { book in
            SyncEnqueueItem(id: book.bookId, title: book.title, subtitle: book.author)
        }
        
        let acceptedIds = await MainActor.run {
            DIContainer.shared.syncQueueStore.enqueue(source: .dedao, items: enqueueItems)
        }
        
        guard !acceptedIds.isEmpty else {
            logger.info("AutoSync[Dedao]: no tasks accepted by SyncQueueStore")
            return
        }
        
        // 过滤出被接受的书籍
        let acceptedBooks = eligibleBooks.filter { acceptedIds.contains($0.bookId) }
        
        // 5. 并发同步
        let maxConcurrentBooks = NotionSyncConfig.batchConcurrency
        let logger = self.logger
        let syncEngine = self.syncEngine
        let apiService = self.apiService
        let cacheService = self.cacheService
        
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
                            let adapter = DedaoNotionAdapter(
                                book: book,
                                apiService: apiService,
                                cacheService: cacheService
                            )
                            try await syncEngine.syncSmart(source: adapter) { progress in
                                logger.debug("AutoSync[Dedao] progress[\(book.bookId)]: \(progress)")
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "succeeded"]
                            )
                        } catch {
                            logger.error("AutoSync[Dedao] failed for \(book.bookId): \(error.localizedDescription)")
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

