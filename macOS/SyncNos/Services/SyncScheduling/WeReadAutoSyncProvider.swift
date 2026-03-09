import Foundation

/// WeRead 自动同步提供者，实现基于 API 的智能增量同步逻辑
/// 通过比较「书籍更新时间」与「上次同步时间」判断是否需要同步
final class WeReadAutoSyncProvider: AutoSyncSourceProvider {
    let id: ContentSource = .weRead
    let autoSyncUserDefaultsKey: String = "autoSync.weRead"

    private let logger: LoggerServiceProtocol
    private let apiService: WeReadAPIServiceProtocol
    private let siteLoginsStore: SiteLoginsStoreProtocol
    private let syncEngine: NotionSyncEngine
    private let notionConfig: NotionConfigStoreProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol

    private var isSyncing: Bool = false

    init(
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        siteLoginsStore: SiteLoginsStoreProtocol = DIContainer.shared.siteLoginsStore,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore
    ) {
        self.logger = logger
        self.apiService = apiService
        self.siteLoginsStore = siteLoginsStore
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

        isSyncing = true
        logger.info("[SmartSync] WeRead: starting check for all books")

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            defer {
                self.isSyncing = false
                self.logger.info("[SmartSync] WeRead: finished")
            }
            do {
                // 检查 WeRead 是否已登录
                let cookie = await self.siteLoginsStore.getCookieHeader(for: "https://weread.qq.com/")
                guard let cookie, !cookie.isEmpty else {
                    self.logger.warning("[SmartSync] WeRead skipped: not logged in")
                    return
                }

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

        let sortKey: BookListSortKey = {
            guard let raw = UserDefaults.standard.string(forKey: ListSortPreferenceKeys.WeRead.sortKey),
                  let k = BookListSortKey(rawValue: raw) else {
                return .title
            }
            return k
        }()
        let sortAscending = UserDefaults.standard.object(forKey: ListSortPreferenceKeys.WeRead.sortAscending) as? Bool ?? true

        // 全量列表排序（不受筛选/搜索影响），用于确定启动顺序
        var orderedBooks = books
        var lastSyncCache: [String: Date?] = [:]
        if sortKey == .lastSync {
            lastSyncCache = Dictionary(uniqueKeysWithValues: orderedBooks.map { ($0.bookId, syncTimestampStore.getLastSyncTime(for: $0.bookId)) })
        }
        orderedBooks.sort { a, b in
            switch sortKey {
            case .title:
                let cmp = a.title.localizedCaseInsensitiveCompare(b.title)
                return sortAscending ? (cmp == .orderedAscending) : (cmp == .orderedDescending)
            case .highlightCount:
                if a.highlightCount == b.highlightCount { return false }
                return sortAscending ? (a.highlightCount < b.highlightCount) : (a.highlightCount > b.highlightCount)
            case .lastSync:
                let t1 = lastSyncCache[a.bookId] ?? nil
                let t2 = lastSyncCache[b.bookId] ?? nil
                if t1 == nil && t2 == nil { return false }
                if t1 == nil { return sortAscending }
                if t2 == nil { return !sortAscending }
                if t1! == t2! { return false }
                return sortAscending ? (t1! < t2!) : (t1! > t2!)
            case .created:
                if a.createdAt == b.createdAt { return false }
                let t1 = a.createdAt ?? Date.distantPast
                let t2 = b.createdAt ?? Date.distantPast
                return sortAscending ? (t1 < t2) : (t1 > t2)
            case .lastEdited:
                if a.updatedAt == b.updatedAt { return false }
                let t1 = a.updatedAt ?? Date.distantPast
                let t2 = b.updatedAt ?? Date.distantPast
                return sortAscending ? (t1 < t2) : (t1 > t2)
            }
        }

        // 3. 智能增量过滤：只同步有变更的书籍
        var eligibleBooks: [WeReadBookListItem] = []
        for book in orderedBooks {
            let lastSyncTime = syncTimestampStore.getLastSyncTime(for: book.bookId)
            let bookLabel = formatBookLabel(title: book.title, author: book.author)
            
            // 情况 1：从未同步过 → 需要同步（首次）
            if lastSyncTime == nil {
                logger.info("[SmartSync] WeRead: \(bookLabel) - first sync (never synced)")
                eligibleBooks.append(book)
                continue
            }
            
            // 情况 2：书籍有变更（updatedAt > 上次同步时间）→ 需要同步
            if let updatedAt = book.updatedAt, updatedAt > lastSyncTime! {
                logger.info("[SmartSync] WeRead: \(bookLabel) - changes detected")
                eligibleBooks.append(book)
                continue
            }
            
            // 情况 3：书籍无变更 → 跳过
            logger.debug("[SmartSync] WeRead: \(bookLabel) - skipped (no changes)")
            NotificationCenter.default.post(
                name: .syncBookStatusChanged,
                object: nil,
                userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "status": "skipped"]
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

        let maxConcurrentBooks = NotionSyncConfig.batchConcurrency
        let logger = self.logger
        let syncEngine = self.syncEngine
        let apiService = self.apiService
        let bookById = Dictionary(uniqueKeysWithValues: eligibleBooks.map { ($0.bookId, $0) })

        // 5. 并发同步（滑动窗口并发，启动顺序跟随 ListView 排序）
        await OrderedTaskRunner.runOrdered(ids: acceptedIds, concurrency: maxConcurrentBooks) { [logger] id in
            guard let book = bookById[id] else { return }
            
            let limiter = DIContainer.shared.syncConcurrencyLimiter
            let runningTaskStore = DIContainer.shared.syncRunningTaskStore
            let taskId = "\(ContentSource.weRead.rawValue):\(book.bookId)"
            
            let task = Task { [logger] in
                let syncQueueStore = DIContainer.shared.syncQueueStore
                guard syncQueueStore.isTaskActive(source: .weRead, rawId: book.bookId) else { return }
                do {
                    try await limiter.withPermit {
                        NotificationCenter.default.post(
                            name: .syncBookStarted,
                            object: book.bookId
                        )
                        NotificationCenter.default.post(
                            name: .syncBookStatusChanged,
                            object: nil,
                            userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "status": "started"]
                        )
                        do {
                            let adapter = WeReadNotionAdapter(
                                book: book,
                                apiService: apiService
                            )
                            try await syncEngine.syncSmart(source: adapter) { progressMessage in
                                NotificationCenter.default.post(
                                    name: .syncProgressUpdated,
                                    object: nil,
                                    userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "progress": progressMessage]
                                )
                            }
                            NotificationCenter.default.post(
                                name: .syncBookStatusChanged,
                                object: nil,
                                userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "status": "succeeded"]
                            )
                        } catch is CancellationError {
                            NotificationCenter.default.post(
                                name: .syncBookStatusChanged,
                                object: nil,
                                userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "status": "cancelled"]
                            )
                        } catch {
                            let bookLabel = self.formatBookLabel(title: book.title, author: book.author)
                            logger.error("[SmartSync] WeRead: \(bookLabel) - failed: \(error.localizedDescription)")
                            let errorInfo = SyncErrorInfo.from(error)
                            NotificationCenter.default.post(
                                name: .syncBookStatusChanged,
                                object: nil,
                                userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "status": "failed", "errorInfo": errorInfo]
                            )
                        }
                        NotificationCenter.default.post(
                            name: .syncBookFinished,
                            object: book.bookId
                        )
                    }
                } catch is CancellationError {
                    NotificationCenter.default.post(
                        name: .syncBookStatusChanged,
                        object: nil,
                        userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "status": "cancelled"]
                    )
                    NotificationCenter.default.post(
                        name: .syncBookFinished,
                        object: book.bookId
                    )
                } catch {
                    let bookLabel = self.formatBookLabel(title: book.title, author: book.author)
                    logger.error("[SmartSync] WeRead: \(bookLabel) - failed: \(error.localizedDescription)")
                    let errorInfo = SyncErrorInfo.from(error)
                    NotificationCenter.default.post(
                        name: .syncBookStatusChanged,
                        object: nil,
                        userInfo: ["bookId": book.bookId, "source": ContentSource.weRead.rawValue, "status": "failed", "errorInfo": errorInfo]
                    )
                    NotificationCenter.default.post(
                        name: .syncBookFinished,
                        object: book.bookId
                    )
                }
            }
            
            await runningTaskStore.register(taskId: taskId, task: task)
            await task.value
            await runningTaskStore.unregister(taskId: taskId)
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
