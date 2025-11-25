import Foundation
import Combine

// 临时结构体用于存储高亮数据
struct WeReadHighlightDisplay: Identifiable {
    let id: String
    let text: String
    let note: String?
    let reviewContents: [String]  // 关联的多条想法内容
    let colorIndex: Int?
    let createdAt: Date?
    let chapterTitle: String?
    
    init(from bookmark: WeReadBookmark) {
        self.id = bookmark.highlightId
        self.text = bookmark.text
        self.note = bookmark.note
        self.reviewContents = bookmark.reviewContents
        self.colorIndex = bookmark.colorIndex
        self.createdAt = bookmark.timestamp.map { Date(timeIntervalSince1970: $0) }
        self.chapterTitle = bookmark.chapterTitle
    }
    
    init(from review: WeReadReview) {
        self.id = "review-\(review.reviewId)"
        self.text = review.content
        self.note = review.content
        self.reviewContents = []
        self.colorIndex = nil
        self.createdAt = review.timestamp.map { Date(timeIntervalSince1970: $0) }
        self.chapterTitle = nil
    }
}

@MainActor
final class WeReadDetailViewModel: ObservableObject {
    @Published var highlights: [WeReadHighlightDisplay] = []
    @Published var isLoading: Bool = false
    
    // 后台同步状态
    @Published var isBackgroundSyncing: Bool = false

    // 高亮筛选与排序
    @Published var noteFilter: NoteFilter = false
    @Published var selectedStyles: Set<Int> = []
    @Published var sortField: HighlightSortField = .created
    @Published var isAscending: Bool = false

    // 同步状态
    @Published var isSyncing: Bool = false
    @Published var syncProgressText: String?
    @Published var syncMessage: String?
    @Published var showNotionConfigAlert: Bool = false

    private let apiService: WeReadAPIServiceProtocol
    private let syncService: WeReadSyncServiceProtocol
    private let logger: LoggerServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    
    // 缓存服务（可选）
    private var cacheService: WeReadCacheServiceProtocol?
    private var incrementalSyncService: WeReadIncrementalSyncService?

    private var currentBookId: String?
    private var allBookmarks: [WeReadBookmark] = []

    private var cancellables = Set<AnyCancellable>()

    init(
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        syncService: WeReadSyncServiceProtocol = WeReadSyncService(),
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore,
        cacheService: WeReadCacheServiceProtocol? = nil
    ) {
        self.apiService = apiService
        self.syncService = syncService
        self.logger = logger
        self.notionConfig = notionConfig
        self.cacheService = cacheService
        
        // 如果有缓存服务，创建增量同步服务
        if let cache = cacheService {
            self.incrementalSyncService = WeReadIncrementalSyncService(
                apiService: apiService,
                cacheService: cache,
                logger: logger
            )
        }
        
        setupNotificationSubscriptions()
        setupFilterSortSubscriptions()
    }
    
    /// 设置缓存服务（用于延迟注入）
    func setCacheService(_ service: WeReadCacheServiceProtocol) {
        self.cacheService = service
        self.incrementalSyncService = WeReadIncrementalSyncService(
            apiService: apiService,
            cacheService: service,
            logger: logger
        )
    }
    
    private func setupNotificationSubscriptions() {
        // 订阅来自 ViewCommands 的高亮排序/筛选通知
        NotificationCenter.default.publisher(for: Notification.Name("HighlightSortChanged"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                guard let info = notification.userInfo else { return }
                
                if let sortKeyRaw = info["sortKey"] as? String,
                   let newField = HighlightSortField(rawValue: sortKeyRaw) {
                    self.sortField = newField
                }
                
                if let ascending = info["sortAscending"] as? Bool {
                    self.isAscending = ascending
                }
                
                Task { await self.reloadCurrent() }
            }
            .store(in: &cancellables)
        
        NotificationCenter.default.publisher(for: Notification.Name("HighlightFilterChanged"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                guard let info = notification.userInfo else { return }
                
                if let hasNotes = info["hasNotes"] as? Bool {
                    self.noteFilter = hasNotes
                }
                
                if let selectedArray = info["selectedStyles"] as? [Int] {
                    self.selectedStyles = Set(selectedArray)
                }
                
                Task { await self.reloadCurrent() }
            }
            .store(in: &cancellables)
    }
    
    private func setupFilterSortSubscriptions() {
        // 监听筛选和排序属性的变化，自动重新应用
        Publishers.CombineLatest4(
            $noteFilter,
            $selectedStyles,
            $sortField,
            $isAscending
        )
        .dropFirst() // 跳过初始值
        .debounce(for: .milliseconds(100), scheduler: DispatchQueue.main)
        .sink { [weak self] _, _, _, _ in
            self?.applyFiltersAndSort()
        }
        .store(in: &cancellables)
    }

    /// 加载高亮（优先缓存，后台增量同步）
    func loadHighlights(for bookId: String) async {
        currentBookId = bookId
        isLoading = true
        
        // 1. 先尝试从缓存加载
        if let cacheService {
            do {
                let cached = try await cacheService.getHighlights(bookId: bookId)
                if !cached.isEmpty {
                    allBookmarks = cached.map { WeReadBookmark(from: $0) }
                    applyFiltersAndSort()
                    isLoading = false
                    logger.info("[WeReadDetail] Loaded \(cached.count) highlights from cache for bookId=\(bookId)")
                }
            } catch {
                logger.warning("[WeReadDetail] Cache load failed: \(error.localizedDescription)")
            }
        }
        
        // 2. 后台增量同步
        await performBackgroundSync(bookId: bookId)
    }
    
    /// 执行后台同步
    private func performBackgroundSync(bookId: String) async {
        // 如果有增量同步服务，使用增量同步
        if let incrementalSyncService {
            isBackgroundSyncing = true
            do {
                let result = try await incrementalSyncService.syncHighlights(bookId: bookId)
                
                switch result {
                case .noChanges:
                    logger.info("[WeReadDetail] No changes for bookId=\(bookId)")
                case .updated(let added, let removed):
                    logger.info("[WeReadDetail] Synced: +\(added) -\(removed) highlights for bookId=\(bookId)")
                    // 重新从缓存加载
                    if let cacheService {
                        let updated = try await cacheService.getHighlights(bookId: bookId)
                        allBookmarks = updated.map { WeReadBookmark(from: $0) }
                        applyFiltersAndSort()
                    }
                case .fullSyncRequired:
                    // 全量拉取
                    await fullFetchFromAPI(bookId: bookId)
                }
            } catch {
                // 如果缓存为空，需要全量拉取
                if allBookmarks.isEmpty {
                    await fullFetchFromAPI(bookId: bookId)
                } else {
                    logger.error("[WeReadDetail] Incremental sync failed: \(error.localizedDescription)")
                }
            }
            isBackgroundSyncing = false
        } else {
            // 没有缓存服务，直接从 API 拉取
            await fullFetchFromAPI(bookId: bookId)
        }
        
        isLoading = false
    }
    
    /// 全量从 API 拉取
    private func fullFetchFromAPI(bookId: String) async {
        do {
            // 使用合并 API 获取高亮（已包含关联的想法）
            let mergedBookmarks = try await apiService.fetchMergedHighlights(bookId: bookId)
            
            // 保存合并后的数据
            allBookmarks = mergedBookmarks
            
            // 如果有缓存服务，保存到缓存
            if let cacheService {
                try await cacheService.saveHighlights(mergedBookmarks, bookId: bookId)
            }
            
            // 应用筛选和排序
            applyFiltersAndSort()
            
            logger.info("[WeReadDetail] Fetched \(mergedBookmarks.count) highlights from API for bookId=\(bookId)")
        } catch {
            let desc = error.localizedDescription
            logger.error("[WeReadDetail] loadHighlights error: \(desc)")
        }
    }

    func reloadCurrent() async {
        // 重新应用筛选和排序
        applyFiltersAndSort()
    }
    
    /// 强制刷新（清除缓存后重新加载）
    func forceRefresh() async {
        guard let bookId = currentBookId else { return }
        
        isLoading = true
        
        // 清除该书的缓存高亮
        if let cacheService {
            do {
                let highlights = try await cacheService.getHighlights(bookId: bookId)
                let ids = highlights.map { $0.highlightId }
                if !ids.isEmpty {
                    try await cacheService.deleteHighlights(ids: ids)
                }
                // 重置 synckey
                try await cacheService.updateBookSyncKey(bookId: bookId, syncKey: 0)
            } catch {
                logger.warning("[WeReadDetail] Failed to clear cache: \(error.localizedDescription)")
            }
        }
        
        // 清空当前数据
        allBookmarks = []
        highlights = []
        
        // 重新加载
        await performBackgroundSync(bookId: bookId)
    }
    
    private func applyFiltersAndSort() {
        var result: [WeReadHighlightDisplay] = []
        
        // 转换合并后的 bookmarks（已包含 reviewContents）
        for bm in allBookmarks {
            // 应用筛选
            // "仅笔记"过滤：检查是否有 note 或 reviewContents（关联的想法）
            if noteFilter {
                let hasNote = (bm.note != nil && !bm.note!.isEmpty)
                let hasReviews = !bm.reviewContents.isEmpty
                if !hasNote && !hasReviews {
                    continue
                }
            }
            
            // 颜色筛选
            if !selectedStyles.isEmpty, let style = bm.colorIndex, !selectedStyles.contains(style) {
                continue
            }
            
            result.append(WeReadHighlightDisplay(from: bm))
        }
        
        // 排序（WeRead 只有 createdAt）
        result.sort { a, b in
            let t1 = a.createdAt
            let t2 = b.createdAt
            
            if t1 == nil && t2 == nil { return false }
            if t1 == nil { return !isAscending }
            if t2 == nil { return isAscending }
            
            return isAscending ? (t1! < t2!) : (t1! > t2!)
        }
        
        highlights = result
    }

    func syncSmart(book: WeReadBookListItem) {
        guard checkNotionConfig() else {
            showNotionConfigAlert = true
            return
        }
        if isSyncing { return }

        isSyncing = true
        syncMessage = nil
        syncProgressText = nil

        let limiter = DIContainer.shared.syncConcurrencyLimiter

        Task {
            await limiter.withPermit {
                NotificationCenter.default.post(
                    name: Notification.Name("SyncBookStatusChanged"),
                    object: self,
                    userInfo: ["bookId": book.bookId, "status": "started"]
                )
                do {
                    try await syncService.syncHighlights(for: book) { [weak self] progressText in
                        Task { @MainActor in
                            self?.syncProgressText = progressText
                        }
                    }
                    await MainActor.run {
                        self.isSyncing = false
                        self.syncMessage = NSLocalizedString("同步完成", comment: "")
                        self.syncProgressText = nil
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStatusChanged"),
                            object: self,
                            userInfo: ["bookId": book.bookId, "status": "succeeded"]
                        )
                    }
                } catch {
                    let desc = error.localizedDescription
                    await MainActor.run {
                        self.logger.error("[WeReadDetail] syncSmart error: \(desc)")
                        self.isSyncing = false
                        self.syncMessage = desc
                        self.syncProgressText = nil
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStatusChanged"),
                            object: self,
                            userInfo: ["bookId": book.bookId, "status": "failed"]
                        )
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func checkNotionConfig() -> Bool {
        notionConfig.isConfigured
    }
}
