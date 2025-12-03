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
    
    init(from cached: CachedWeReadHighlight) {
        self.id = cached.highlightId
        self.text = cached.text
        self.note = cached.note
        self.reviewContents = cached.reviewContents
        self.colorIndex = cached.colorIndex
        self.createdAt = cached.createdAt
        self.chapterTitle = cached.chapterTitle
    }
}

@MainActor
final class WeReadDetailViewModel: ObservableObject {
    // MARK: - Published Properties
    
    /// 当前显示的高亮（分页后的可见数据）
    @Published var visibleHighlights: [WeReadHighlightDisplay] = []
    
    /// 是否正在加载首页
    @Published var isLoading: Bool = false
    
    /// 是否正在加载更多
    @Published var isLoadingMore: Bool = false
    
    /// 后台同步状态
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
    // MARK: - Pagination Properties
    
    /// 每页大小
    private let pageSize: Int = 50
    
    /// 当前已加载的页数
    private var currentPageCount: Int = 0
    
    /// 是否还有更多数据可加载
    var canLoadMore: Bool {
        currentPageCount * pageSize < filteredHighlights.count
    }
    
    /// 总高亮数量（筛选后）
    var totalFilteredCount: Int {
        filteredHighlights.count
    }

    // MARK: - Private Properties
    
    private let apiService: WeReadAPIServiceProtocol
    private let cacheService: WeReadCacheServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let logger: LoggerServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    
    // 增量同步服务
    private let incrementalSyncService: WeReadIncrementalSyncService

    private var currentBookId: String?
    
    /// 所有原始数据（未筛选）
    private var allBookmarks: [WeReadBookmark] = []
    
    /// 筛选和排序后的数据
    private var filteredHighlights: [WeReadHighlightDisplay] = []

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization
    
    init(
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        cacheService: WeReadCacheServiceProtocol = DIContainer.shared.weReadCacheService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.apiService = apiService
        self.cacheService = cacheService
        self.syncEngine = syncEngine
        self.logger = logger
        self.notionConfig = notionConfig
        
        // 创建增量同步服务
        self.incrementalSyncService = WeReadIncrementalSyncService(
            apiService: apiService,
            cacheService: cacheService,
            logger: logger
        )
        
        setupNotificationSubscriptions()
        setupFilterSortSubscriptions()
    }
    
    // MARK: - Setup
    
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
            self?.resetPagination()
        }
        .store(in: &cancellables)
    }
    
    // MARK: - Pagination Methods
    
    /// 重置分页状态
    private func resetPagination() {
        currentPageCount = 1
        let endIndex = min(pageSize, filteredHighlights.count)
        visibleHighlights = Array(filteredHighlights.prefix(endIndex))
    }
    
    /// 加载更多数据
    func loadMoreIfNeeded(currentItem: WeReadHighlightDisplay) {
        // 检查是否需要加载更多
        guard let index = visibleHighlights.firstIndex(where: { $0.id == currentItem.id }) else { return }
        
        // 当滚动到倒数第 10 项时，加载更多
        let threshold = max(visibleHighlights.count - 10, 0)
        guard index >= threshold else { return }
        
        loadNextPage()
    }
    
    /// 加载下一页
    func loadNextPage() {
        guard canLoadMore, !isLoadingMore else { return }
        
        isLoadingMore = true
        
        // 计算下一页的范围
        let startIndex = currentPageCount * pageSize
        let endIndex = min(startIndex + pageSize, filteredHighlights.count)
        
        guard startIndex < endIndex else {
            isLoadingMore = false
            return
        }
        
        // 添加下一页数据
        let nextPage = Array(filteredHighlights[startIndex..<endIndex])
        visibleHighlights.append(contentsOf: nextPage)
        currentPageCount += 1
        
        logger.debug("[WeReadDetail] Loaded page \(currentPageCount), showing \(visibleHighlights.count)/\(filteredHighlights.count) highlights")
        
        isLoadingMore = false
    }

    // MARK: - Data Loading
    
    /// 加载高亮（优先缓存，后台增量同步）
    func loadHighlights(for bookId: String) async {
        // 如果是同一本书，不重复加载
        if currentBookId == bookId && !allBookmarks.isEmpty {
            return
        }
        
        currentBookId = bookId
        isLoading = true
        
        // 重置数据
        allBookmarks = []
        filteredHighlights = []
        visibleHighlights = []
        currentPageCount = 0
        
        // 1. 先从缓存加载
        do {
            let cached = try await cacheService.getHighlights(bookId: bookId)
            if !cached.isEmpty {
                allBookmarks = cached.map { WeReadBookmark(from: $0) }
                applyFiltersAndSort()
                resetPagination()
                isLoading = false
                logger.info("[WeReadDetail] Loaded \(cached.count) highlights from cache for bookId=\(bookId)")
            }
        } catch {
            logger.warning("[WeReadDetail] Cache load failed: \(error.localizedDescription)")
        }
        
        // 2. 后台增量同步
        await performBackgroundSync(bookId: bookId)
    }
    
    /// 执行后台同步
    private func performBackgroundSync(bookId: String) async {
        isBackgroundSyncing = true
        do {
            let result = try await incrementalSyncService.syncHighlights(bookId: bookId)
            
            switch result {
            case .noChanges:
                logger.info("[WeReadDetail] No changes for bookId=\(bookId)")
            case .updated(let added, let removed):
                logger.info("[WeReadDetail] Synced: +\(added) -\(removed) highlights for bookId=\(bookId)")
                // 重新从缓存加载
                let updated = try await cacheService.getHighlights(bookId: bookId)
                allBookmarks = updated.map { WeReadBookmark(from: $0) }
                applyFiltersAndSort()
                resetPagination()
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
        isLoading = false
    }
    
    /// 全量从 API 拉取
    private func fullFetchFromAPI(bookId: String) async {
        do {
            // 使用合并 API 获取高亮（已包含关联的想法）
            let mergedBookmarks = try await apiService.fetchMergedHighlights(bookId: bookId)
            
            // 保存合并后的数据
            allBookmarks = mergedBookmarks
            
            // 保存到缓存
            try await cacheService.saveHighlights(mergedBookmarks, bookId: bookId)
            
            // 应用筛选和排序
            applyFiltersAndSort()
            resetPagination()
            
            logger.info("[WeReadDetail] Fetched \(mergedBookmarks.count) highlights from API for bookId=\(bookId)")
        } catch {
            let desc = error.localizedDescription
            logger.error("[WeReadDetail] loadHighlights error: \(desc)")
        }
    }

    func reloadCurrent() async {
        // 重新应用筛选和排序
        applyFiltersAndSort()
        resetPagination()
    }
    
    /// 强制刷新（清除缓存后重新加载）
    func forceRefresh() async {
        guard let bookId = currentBookId else { return }
        
        isLoading = true
        
        // 清除该书的缓存高亮
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
        
        // 清空当前数据
        allBookmarks = []
        filteredHighlights = []
        visibleHighlights = []
        currentPageCount = 0
        
        // 重新加载
        await performBackgroundSync(bookId: bookId)
    }
    
    // MARK: - Filtering and Sorting
    
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
        
        filteredHighlights = result
    }

    // MARK: - Notion Sync
    
    func syncSmart(book: WeReadBookListItem) {
        guard checkNotionConfig() else {
            NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
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
                    let adapter = WeReadNotionAdapter.create(book: book, apiService: self.apiService)
                    try await syncEngine.syncSmart(source: adapter) { [weak self] progressText in
                        Task { @MainActor in
                            self?.syncProgressText = progressText
                        }
                    }
                    await MainActor.run {
                        self.isSyncing = false
                        self.syncMessage = String(localized: "Sync completed")
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

// MARK: - Legacy Compatibility

extension WeReadDetailViewModel {
    /// 兼容旧代码：返回所有高亮（不推荐使用，应使用 visibleHighlights）
    var highlights: [WeReadHighlightDisplay] {
        visibleHighlights
    }
}
