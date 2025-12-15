import Foundation

/// Dedao 自动同步提供者，实现基于本地缓存的智能增量同步逻辑
/// 通过比较「高亮修改时间」与「上次同步时间」判断是否需要同步
final class DedaoAutoSyncProvider: AutoSyncSourceProvider {
    let id: SyncSource = .dedao
    let autoSyncUserDefaultsKey: String = "autoSync.dedao"
    
    private let logger: LoggerServiceProtocol
    private let apiService: DedaoAPIServiceProtocol
    private let authService: DedaoAuthServiceProtocol
    private let cacheService: DedaoCacheServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    
    private var isSyncing: Bool = false
    
    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        apiService: DedaoAPIServiceProtocol = DIContainer.shared.dedaoAPIService,
        authService: DedaoAuthServiceProtocol = DIContainer.shared.dedaoAuthService,
        cacheService: DedaoCacheServiceProtocol = DIContainer.shared.dedaoCacheService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
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
            logger.warning("[SmartSync] Dedao skipped: not logged in")
            return
        }
        
        isSyncing = true
        logger.info("[SmartSync] Dedao: starting check for all books")
        
        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("[SmartSync] Dedao: finished")
            }
            do {
                try await self.syncAllBooksSmart()
            } catch {
                self.logger.error("[SmartSync] Dedao error: \(error.localizedDescription)")
            }
        }
    }
    
    private func syncAllBooksSmart() async throws {
        // 1. 从本地缓存获取所有书籍（不调用 API，使用缓存判断变更）
        let books = try await cacheService.getAllBooks()
        
        if books.isEmpty {
            logger.info("[SmartSync] Dedao: no books in local cache")
            return
        }
        
        // 2. 获取所有书籍的最新高亮修改时间（批量查询，高效）
        let maxUpdatedAtMap = try await cacheService.getAllBooksMaxHighlightUpdatedAt()
        
        // 3. 智能增量过滤：只同步有变更的书籍
        var eligibleBooks: [DedaoBookListItem] = []
        for book in books {
            let lastSyncTime = syncTimestampStore.getLastSyncTime(for: book.bookId)
            let maxHighlightUpdatedAt = maxUpdatedAtMap[book.bookId]
            let bookLabel = formatBookLabel(title: book.title, author: book.author)
            
            // 情况 1：从未同步过 → 需要同步（首次）
            if lastSyncTime == nil {
                logger.info("[SmartSync] Dedao: \(bookLabel) - first sync (never synced)")
                eligibleBooks.append(book)
                continue
            }
            
            // 情况 2：书籍有变更（最新高亮修改时间 > 上次同步时间）→ 需要同步
            if let maxUpdated = maxHighlightUpdatedAt, maxUpdated > lastSyncTime! {
                logger.info("[SmartSync] Dedao: \(bookLabel) - changes detected")
                eligibleBooks.append(book)
                continue
            }
            
            // 情况 3：书籍无变更 → 跳过
            logger.debug("[SmartSync] Dedao: \(bookLabel) - skipped (no changes)")
            NotificationCenter.default.post(
                name: Notification.Name("SyncBookStatusChanged"),
                object: nil,
                userInfo: ["bookId": book.bookId, "status": "skipped"]
            )
        }
        
        if eligibleBooks.isEmpty {
            logger.info("[SmartSync] Dedao: all books up to date, nothing to sync")
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
            logger.info("[SmartSync] Dedao: no tasks accepted (all in cooldown)")
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
                            try await syncEngine.syncSmart(source: adapter) { progressMessage in
                                NotificationCenter.default.post(
                                    name: Notification.Name("SyncProgressUpdated"),
                                    object: nil,
                                    userInfo: ["bookId": book.bookId, "progress": progressMessage]
                                )
                            }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "succeeded"]
                            )
                        } catch {
                            let bookLabel = self.formatBookLabel(title: book.title, author: book.author)
                            logger.error("[SmartSync] Dedao: \(bookLabel) - failed: \(error.localizedDescription)")
                            let errorInfo = SyncErrorInfo.from(error)
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: nil,
                                userInfo: ["bookId": book.bookId, "status": "failed", "errorInfo": errorInfo]
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
    
    /// 格式化书籍标签用于日志显示
    private func formatBookLabel(title: String, author: String) -> String {
        if author.isEmpty {
            return "《\(title)》"
        } else {
            return "《\(title)》(\(author))"
        }
    }
}

