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
    @Published var showNotionConfigAlert: Bool = false
    
    // 登录状态相关
    @Published var showLoginSheet: Bool = false
    @Published var showLoginFailedAlert: Bool = false
    @Published var loginFailureReason: String = ""
    
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
        do {
            let cachedBooks = try await cacheService.getAllBooks()
            if !cachedBooks.isEmpty {
                books = cachedBooks.map { DedaoBookListItem(from: $0) }
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
    
    /// 执行后台同步
    private func performBackgroundSync() async {
        isSyncing = true
        
        do {
            // 从 API 获取书籍列表
            let ebooks = try await apiService.fetchAllEbooks()
            
            // 保存到本地存储
            try await cacheService.saveBooks(ebooks)
            
            // 转换为 UI 模型
            let newBooks = ebooks.map { DedaoBookListItem(from: $0) }
            
            // 更新每本书的高亮数量（并发获取）
            var booksWithCounts: [DedaoBookListItem] = []
            for var book in newBooks {
                do {
                    let notes = try await apiService.fetchEbookNotes(ebookEnid: book.bookId)
                    book.highlightCount = notes.count
                    
                    // 更新本地存储中的高亮数量
                    try await cacheService.updateBookHighlightCount(bookId: book.bookId, count: notes.count)
                } catch {
                    logger.warning("[Dedao] Failed to fetch notes for bookId=\(book.bookId): \(error.localizedDescription)")
                }
                booksWithCounts.append(book)
            }
            
            books = booksWithCounts
            
            // 更新同步状态
            try await cacheService.updateSyncState(lastFullSyncAt: nil, lastIncrementalSyncAt: Date())
            lastSyncAt = Date()
            
            logger.info("[Dedao] Synced \(ebooks.count) books from API")
        } catch let error as DedaoAPIError {
            switch error {
            case .sessionExpired, .notLoggedIn:
                loginFailureReason = error.localizedDescription
                showLoginFailedAlert = true
            case .needVerification:
                loginFailureReason = String(localized: "dedao.error.needVerification")
                showLoginFailedAlert = true
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
            showNotionConfigAlert = true
            return
        }
        
        // 入队任务
        let items: [[String: Any]] = bookIds.compactMap { id in
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
        
        let ids = Array(bookIds)
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
                            await MainActor.run { _ = self.syncingBookIds.insert(id) }
                            NotificationCenter.default.post(
                                name: Notification.Name("SyncBookStatusChanged"),
                                object: self,
                                userInfo: ["bookId": id, "status": "started"]
                            )
                            do {
                                let adapter = DedaoNotionAdapter(
                                    book: book,
                                    apiService: apiService,
                                    cacheService: cacheService
                                )
                                try await syncEngine.syncSmart(source: adapter) { progressText in
                                    NotificationCenter.default.post(
                                        name: Notification.Name("SyncProgressUpdated"),
                                        object: self,
                                        userInfo: ["bookId": id, "progress": progressText]
                                    )
                                }
                                NotificationCenter.default.post(
                                    name: Notification.Name("SyncBookStatusChanged"),
                                    object: self,
                                    userInfo: ["bookId": id, "status": "succeeded"]
                                )
                                await MainActor.run {
                                    _ = self.syncingBookIds.remove(id)
                                    _ = self.syncedBookIds.insert(id)
                                }
                            } catch {
                                await MainActor.run {
                                    self.logger.error("[Dedao] batchSync error for id=\(id): \(error.localizedDescription)")
                                }
                                NotificationCenter.default.post(
                                    name: Notification.Name("SyncBookStatusChanged"),
                                    object: self,
                                    userInfo: ["bookId": id, "status": "failed"]
                                )
                                await MainActor.run {
                                    _ = self.syncingBookIds.remove(id)
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

