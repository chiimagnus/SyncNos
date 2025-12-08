import Foundation
import Combine

// MARK: - DedaoViewModel

@MainActor
final class DedaoViewModel: ObservableObject {
    // 列表数据
    @Published var books: [DedaoBookListItem] = []
    @Published var displayBooks: [DedaoBookListItem] = []
    @Published var visibleBooks: [DedaoBookListItem] = []
    
    // 状态
    @Published var isLoading: Bool = false
    @Published var isComputingList: Bool = false
    @Published var errorMessage: String?
    
    // 后台同步状态
    @Published var isSyncing: Bool = false
    @Published var lastSyncAt: Date?
    
    // 同步状态（列表）
    @Published var syncingBookIds: Set<String> = []
    @Published var syncedBookIds: Set<String> = []
    // 注：showNotionConfigAlert 和会话过期弹窗已移至 MainListView 统一处理
    
    // 登录状态相关
    @Published var showLoginSheet: Bool = false
    
    // 排序
    @Published var sortKey: BookListSortKey = .title
    @Published var sortAscending: Bool = true
    
    /// 当前用于列表渲染的子集（支持分页/增量加载）
    private let pageSize: Int = 80
    private var currentPageSize: Int = 0
    
    // 依赖
    private let authService: DedaoAuthServiceProtocol
    private let apiService: DedaoAPIServiceProtocol
    private let cacheService: DedaoCacheServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let logger: LoggerServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let notionConfig: NotionConfigStoreProtocol
    
    private var cancellables: Set<AnyCancellable> = []
    private let computeQueue = DispatchQueue(label: "DedaoViewModel.compute", qos: .userInitiated)
    private let recomputeTrigger = PassthroughSubject<Void, Never>()
    
    init(
        authService: DedaoAuthServiceProtocol,
        apiService: DedaoAPIServiceProtocol,
        cacheService: DedaoCacheServiceProtocol,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.authService = authService
        self.apiService = apiService
        self.cacheService = cacheService
        self.syncEngine = syncEngine
        self.logger = logger
        self.syncTimestampStore = syncTimestampStore
        self.notionConfig = notionConfig
        
        setupPipelines()
        subscribeSyncStatusNotifications()
    }
    
    // MARK: - Pipelines
    
    private func setupPipelines() {
        // 在后台计算 displayBooks，主线程发布结果
        Publishers.CombineLatest3($books, $sortKey, $sortAscending)
            .combineLatest(recomputeTrigger)
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { [weak self] _ in
                self?.isComputingList = true
            })
            .receive(on: computeQueue)
            .map { combined, _ -> [DedaoBookListItem] in
                let (books, sortKey, sortAscending) = combined
                return Self.buildDisplayBooks(
                    books: books,
                    sortKey: sortKey,
                    sortAscending: sortAscending,
                    syncTimestampStore: self.syncTimestampStore
                )
            }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newDisplay in
                guard let self else { return }
                self.isComputingList = false
                self.displayBooks = newDisplay
                self.currentPageSize = min(self.pageSize, self.displayBooks.count)
                if self.currentPageSize == 0 {
                    self.visibleBooks = []
                } else {
                    self.visibleBooks = Array(self.displayBooks.prefix(self.currentPageSize))
                }
            }
            .store(in: &cancellables)
        
        // 订阅来自 ViewCommands 的 Dedao 排序/筛选通知
        NotificationCenter.default.publisher(for: Notification.Name("DedaoFilterChanged"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                guard let info = notification.userInfo else { return }
                
                if let sortKeyRaw = info["sortKey"] as? String,
                   let newKey = BookListSortKey(rawValue: sortKeyRaw) {
                    self.sortKey = newKey
                }
                
                if let ascending = info["sortAscending"] as? Bool {
                    self.sortAscending = ascending
                }
                
                self.triggerRecompute()
            }
            .store(in: &cancellables)
        
        // 订阅登录状态变化通知（退出登录时触发 UI 更新）
        NotificationCenter.default.publisher(for: Notification.Name("DedaoLoginStatusChanged"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self else { return }
                // 清空书籍列表，触发 UI 更新显示未登录状态
                self.books = []
                self.displayBooks = []
                self.visibleBooks = []
                self.objectWillChange.send()
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Public API
    
    var isLoggedIn: Bool {
        authService.isLoggedIn
    }
    
    func triggerRecompute() {
        recomputeTrigger.send(())
    }
    
    /// 加载书籍（优先从本地存储，后台同步）
    func loadBooks() async {
        guard authService.isLoggedIn else {
            logger.info("[Dedao] Not logged in, skip loading books")
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        // 1. 先尝试从本地存储加载（快速显示）
        // 注意：cacheService 是 actor，调用其方法需要 await
        do {
            let cachedBooks = try await cacheService.getAllBooks()
            if !cachedBooks.isEmpty {
                books = cachedBooks  // 已经是 [DedaoBookListItem]
                isLoading = false
                logger.info("[Dedao] Loaded \(cachedBooks.count) books from local storage")
                
                // 获取上次同步时间
                let state = try await cacheService.getSyncState()
                lastSyncAt = state.lastIncrementalSyncAt ?? state.lastFullSyncAt
            }
        } catch {
            logger.warning("[Dedao] Local storage load failed: \(error.localizedDescription)")
        }
        
        // 2. 后台同步
        await performBackgroundSync()
    }
    
    /// 执行后台同步（分批加载，先显示书籍列表，再逐步获取笔记数量）
    private func performBackgroundSync() async {
        isSyncing = true
        
        do {
            // 第 1 阶段：获取书籍列表并立即显示
            let ebooks = try await apiService.fetchAllEbooks()
            
            // 保存到本地存储
            try await cacheService.saveBooks(ebooks)
            
            // 立即转换并显示书籍列表（笔记数量暂时为 0 或使用缓存值）
            var newBooks = ebooks.map { DedaoBookListItem(from: $0) }
            
            // 从缓存中恢复之前的笔记数量（避免显示为 0）
            for i in 0..<newBooks.count {
                if let cached = try? await cacheService.getBook(bookId: newBooks[i].bookId) {
                    newBooks[i].highlightCount = cached.highlightCount
                }
            }
            
            // 立即更新 UI，用户可以马上看到书籍列表
            books = newBooks
            isLoading = false  // 结束加载状态，让用户可以交互
            
            logger.info("[Dedao] Displayed \(ebooks.count) books (fetching note counts in background)")
            
            // 第 2 阶段：分批获取每本书的笔记数量
            let batchSize = 5  // 每批处理 5 本书
            let totalBatches = (newBooks.count + batchSize - 1) / batchSize
            
            for batchIndex in 0..<totalBatches {
                let start = batchIndex * batchSize
                let end = min(start + batchSize, newBooks.count)
                
                // 并发获取当前批次的笔记数量
                await withTaskGroup(of: (Int, Int).self) { group in
                    for i in start..<end {
                        let bookId = newBooks[i].bookId
                        let bookTitle = newBooks[i].title
                        group.addTask { [weak self] in
                            guard let self else { return (i, 0) }
                            do {
                                let notes = try await self.apiService.fetchEbookNotes(ebookEnid: bookId, bookTitle: bookTitle)
                                
                                // 保存笔记到本地缓存
                                try await self.cacheService.saveHighlights(notes, bookId: bookId)
                                try await self.cacheService.updateBookHighlightCount(bookId: bookId, count: notes.count)
                                
                                return (i, notes.count)
                            } catch {
                                self.logger.warning("[Dedao] Failed to fetch notes for \"\(bookTitle)\": \(error.localizedDescription)")
                                return (i, newBooks[i].highlightCount)  // 保持原值
                            }
                        }
                    }
                    
                    // 收集结果（不立即更新 UI）
                    for await (index, count) in group {
                        if index < newBooks.count {
                            newBooks[index].highlightCount = count
                        }
                    }
                }
                
                logger.debug("[Dedao] Fetched batch \(batchIndex + 1)/\(totalBatches)")
            }
            
            // 所有批次完成后一次性更新 UI（避免重复刷新）
            books = newBooks
            
            // 更新同步状态
            try await cacheService.updateSyncState(lastFullSyncAt: nil, lastIncrementalSyncAt: Date())
            lastSyncAt = Date()
            
            logger.info("[Dedao] Synced all \(ebooks.count) books with note counts")
        } catch let error as DedaoAPIError {
            switch error {
            case .sessionExpired, .notLoggedIn:
                // 发送会话过期通知到 MainListView
                NotificationCenter.default.post(
                    name: Notification.Name("ShowSessionExpiredAlert"),
                    object: nil,
                    userInfo: ["source": ContentSource.dedao.rawValue, "reason": error.localizedDescription]
                )
            case .needVerification:
                // 发送需要验证的通知到 MainListView
                NotificationCenter.default.post(
                    name: Notification.Name("ShowSessionExpiredAlert"),
                    object: nil,
                    userInfo: ["source": ContentSource.dedao.rawValue, "reason": String(localized: "Verification required. Please open the Dedao app to complete verification.")]
                )
            default:
                if books.isEmpty {
                    errorMessage = error.localizedDescription
                }
            }
        } catch {
            let desc = error.localizedDescription
            logger.error("[Dedao] Background sync error: \(desc)")
            if books.isEmpty {
                errorMessage = desc
            }
        }
        
        isSyncing = false
        isLoading = false
    }
    
    /// 强制全量刷新（清除本地存储后重新同步）
    func forceRefresh() async {
        isLoading = true
        errorMessage = nil
        
        // 清除本地存储
        do {
            try await cacheService.clearAllData()
            logger.info("[Dedao] Local storage cleared for force refresh")
        } catch {
            logger.warning("[Dedao] Failed to clear local storage: \(error.localizedDescription)")
        }
        
        // 重新加载
        books = []
        await performBackgroundSync()
    }
    
    /// 导航到 Dedao 登录页面
    func navigateToDedaoLogin() {
        showLoginSheet = true
    }
    
    /// 登录成功后调用，触发 UI 更新并加载书籍
    func onLoginSuccess() {
        // 触发 SwiftUI 重新检查 isLoggedIn
        objectWillChange.send()
        Task {
            await loadBooks()
        }
    }
    
    func loadMoreIfNeeded(currentItem: DedaoBookListItem) {
        guard let index = visibleBooks.firstIndex(where: { $0.bookId == currentItem.bookId }) else { return }
        let threshold = max(visibleBooks.count - 10, 0)
        guard index >= threshold else { return }
        let newSize = min(currentPageSize + pageSize, displayBooks.count)
        guard newSize > currentPageSize else { return }
        currentPageSize = newSize
        visibleBooks = Array(displayBooks.prefix(currentPageSize))
    }
    
    func lastSync(for bookId: String) -> Date? {
        syncTimestampStore.getLastSyncTime(for: bookId)
    }
    
    // MARK: - Notion Sync
    
    /// 批量同步 Dedao 书籍到 Notion
    func batchSync(bookIds: Set<String>, concurrency: Int = NotionSyncConfig.batchConcurrency) {
        guard !bookIds.isEmpty else { return }
        guard checkNotionConfig() else {
            NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
            return
        }
        
        // 过滤掉已经在同步中的任务，防止重复触发
        let idsToSync = bookIds.subtracting(syncingBookIds)
        guard !idsToSync.isEmpty else {
            logger.debug("[Dedao] All selected books are already syncing, skip")
            return
        }
        
        // 立即将任务标记为同步中，防止快捷键连续触发时重复入队
        // 注意：这必须在 Task 启动之前同步执行
        for id in idsToSync {
            syncingBookIds.insert(id)
        }
        
        // 入队任务（只入队未在同步中的）
        let items: [[String: Any]] = idsToSync.compactMap { id in
            guard let b = displayBooks.first(where: { $0.bookId == id }) else { return nil }
            return ["id": id, "title": b.title, "subtitle": b.author]
        }
        if !items.isEmpty {
            NotificationCenter.default.post(
                name: Notification.Name("SyncTasksEnqueued"),
                object: nil,
                userInfo: ["source": "dedao", "items": items]
            )
        }
        
        let ids = Array(idsToSync)
        let itemsById = Dictionary(uniqueKeysWithValues: books.map { ($0.bookId, $0) })
        let limiter = DIContainer.shared.syncConcurrencyLimiter
        let syncEngine = self.syncEngine
        let apiService = self.apiService
        let cacheService = self.cacheService
        
        Task {
            await withTaskGroup(of: Void.self) { group in
                for id in ids {
                    guard let book = itemsById[id] else { continue }
                    group.addTask { [weak self] in
                        guard let self else { return }
                        await limiter.withPermit {
                            // 发送开始通知（syncingBookIds 已在外部同步设置）
                            await MainActor.run {
                                NotificationCenter.default.post(
                                    name: Notification.Name("SyncBookStatusChanged"),
                                    object: self,
                                    userInfo: ["bookId": id, "status": "started"]
                                )
                            }
                            do {
                                let adapter = DedaoNotionAdapter(
                                    book: book,
                                    apiService: apiService,
                                    cacheService: cacheService
                                )
                                try await syncEngine.syncSmart(source: adapter) { progressText in
                                    Task { @MainActor in
                                        NotificationCenter.default.post(
                                            name: Notification.Name("SyncProgressUpdated"),
                                            object: self,
                                            userInfo: ["bookId": id, "progress": progressText]
                                        )
                                    }
                                }
                                await MainActor.run {
                                    _ = self.syncingBookIds.remove(id)
                                    _ = self.syncedBookIds.insert(id)
                                    NotificationCenter.default.post(
                                        name: Notification.Name("SyncBookStatusChanged"),
                                        object: self,
                                        userInfo: ["bookId": id, "status": "succeeded"]
                                    )
                                }
                            } catch {
                                await MainActor.run {
                                    self.logger.error("[Dedao] batchSync error for id=\(id): \(error.localizedDescription)")
                                    _ = self.syncingBookIds.remove(id)
                                }
                                // 确保在主线程发送通知，避免时序问题
                                await MainActor.run {
                                    NotificationCenter.default.post(
                                        name: Notification.Name("SyncBookStatusChanged"),
                                        object: self,
                                        userInfo: ["bookId": id, "status": "failed"]
                                    )
                                }
                            }
                        }
                    }
                }
                await group.waitForAll()
            }
        }
    }
    
    // MARK: - Sync status subscription
    
    private func subscribeSyncStatusNotifications() {
        NotificationCenter.default.publisher(for: Notification.Name("SyncBookStatusChanged"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                // AutoSyncService 发出的 object 为 nil，不在这里处理
                if notification.object == nil { return }
                if let sender = notification.object as? DedaoViewModel, sender === self {
                    // 自己发出的状态在本地已处理，直接忽略
                    return
                }
                guard let info = notification.userInfo as? [String: Any],
                      let bookId = info["bookId"] as? String,
                      let status = info["status"] as? String else { return }
                switch status {
                case "started":
                    self.syncingBookIds.insert(bookId)
                case "succeeded":
                    self.syncingBookIds.remove(bookId)
                    self.syncedBookIds.insert(bookId)
                case "failed":
                    self.syncingBookIds.remove(bookId)
                case "skipped":
                    break
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Helpers
    
    private func checkNotionConfig() -> Bool {
        notionConfig.isConfigured
    }
    
    // 纯函数：构建排序后的展示列表
    private static func buildDisplayBooks(
        books: [DedaoBookListItem],
        sortKey: BookListSortKey,
        sortAscending: Bool,
        syncTimestampStore: SyncTimestampStoreProtocol
    ) -> [DedaoBookListItem] {
        var result = books
        
        // 预取 lastSync 映射，避免比较器中频繁读取
        var lastSyncCache: [String: Date?] = [:]
        if sortKey == .lastSync {
            lastSyncCache = Dictionary(uniqueKeysWithValues: result.map { ($0.bookId, syncTimestampStore.getLastSyncTime(for: $0.bookId)) })
        }
        
        result.sort { a, b in
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
            case .created, .lastEdited:
                // DedaoBookListItem 没有这些字段，按标题排序
                let cmp = a.title.localizedCaseInsensitiveCompare(b.title)
                return sortAscending ? (cmp == .orderedAscending) : (cmp == .orderedDescending)
            }
        }
        
        return result
    }
}

