import Foundation
import Combine

// MARK: - 显示模型

/// 得到高亮显示模型
struct DedaoHighlightDisplay: Identifiable {
    let id: String
    let text: String
    let note: String?
    let createdAt: Date?
    let updatedAt: Date?
    let chapterTitle: String?
    
    init(from note: DedaoEbookNote) {
        self.id = note.effectiveId
        self.text = note.effectiveNoteLine
        self.note = note.note
        self.createdAt = note.effectiveCreateTime > 0
            ? Date(timeIntervalSince1970: TimeInterval(note.effectiveCreateTime))
            : nil
        self.updatedAt = note.effectiveUpdateTime > 0 && note.effectiveUpdateTime != note.effectiveCreateTime
            ? Date(timeIntervalSince1970: TimeInterval(note.effectiveUpdateTime))
            : nil
        self.chapterTitle = note.extra?.title
    }
    
    init(from cached: CachedDedaoHighlight) {
        self.id = cached.highlightId
        self.text = cached.text
        self.note = cached.note
        self.createdAt = cached.createdAt
        self.updatedAt = cached.updatedAt
        self.chapterTitle = cached.chapterTitle
    }
}

// MARK: - ViewModel

@MainActor
final class DedaoDetailViewModel: ObservableObject {
    // MARK: - Published Properties
    
    /// 当前显示的高亮（分页后的可见数据）
    @Published var visibleHighlights: [DedaoHighlightDisplay] = []
    
    /// 是否正在加载首页
    @Published var isLoading: Bool = false
    
    /// 是否正在加载更多
    @Published var isLoadingMore: Bool = false
    
    /// 后台同步状态
    @Published var isBackgroundSyncing: Bool = false
    
    // 高亮筛选与排序
    @Published var noteFilter: NoteFilter = false
    @Published var selectedStyles: Set<Int> = []  // 得到不支持颜色，但保留接口一致性
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
    
    private let apiService: DedaoAPIServiceProtocol
    private let cacheService: DedaoCacheServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let logger: LoggerServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol
    
    private var currentBookId: String?
    
    /// 所有原始数据（未筛选）
    private var allNotes: [DedaoEbookNote] = []
    
    /// 筛选和排序后的数据
    private var filteredHighlights: [DedaoHighlightDisplay] = []
    
    private var cancellables = Set<AnyCancellable>()
    
    /// 当前加载任务，用于在切换书籍时取消
    private var currentLoadTask: Task<Void, Never>?
    
    // MARK: - Initialization
    
    init(
        apiService: DedaoAPIServiceProtocol = DIContainer.shared.dedaoAPIService,
        cacheService: DedaoCacheServiceProtocol = DIContainer.shared.dedaoCacheService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.apiService = apiService
        self.cacheService = cacheService
        self.syncEngine = syncEngine
        self.logger = logger
        self.notionConfig = notionConfig
        
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
    func loadMoreIfNeeded(currentItem: DedaoHighlightDisplay) {
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
        
        logger.debug("[DedaoDetail] Loaded page \(currentPageCount), showing \(visibleHighlights.count)/\(filteredHighlights.count) highlights")
        
        isLoadingMore = false
    }
    
    // MARK: - Memory Management
    
    /// 清理所有数据，释放内存（在切换书籍或视图销毁时调用）
    func clear() {
        // 取消正在进行的任务（Task.isCancelled 会在后台方法中检查）
        currentLoadTask?.cancel()
        currentLoadTask = nil
        
        // 清理数据
        currentBookId = nil
        allNotes = []
        filteredHighlights = []
        visibleHighlights = []
        currentPageCount = 0
        
        // 清理状态
        isLoading = false
        isLoadingMore = false
        isBackgroundSyncing = false
        isSyncing = false
        syncProgressText = nil
        syncMessage = nil
    }
    
    // MARK: - Data Loading
    
    /// 加载高亮（优先缓存，后台同步）
    func loadHighlights(for bookId: String) async {
        // 如果是同一本书且数据不为空，不重复加载
        if currentBookId == bookId && !allNotes.isEmpty {
            return
        }
        
        // 取消之前的加载任务
        currentLoadTask?.cancel()
        
        // 创建新的加载任务
        let loadTask = Task { [weak self] in
            guard let self else { return }
            await self.performLoadHighlights(for: bookId)
        }
        currentLoadTask = loadTask
        
        // 等待任务完成
        await loadTask.value
    }
    
    /// 实际执行加载的内部方法
    private func performLoadHighlights(for bookId: String) async {
        let isNewBook = currentBookId != bookId
        currentBookId = bookId
        
        // 1. 先尝试从缓存加载（不清空现有数据，避免闪烁）
        do {
            // 检查任务是否被取消
            guard !Task.isCancelled else { return }
            
            // cacheService.getHighlights 现在直接返回 [DedaoEbookNote]
            let cached = try await cacheService.getHighlights(bookId: bookId)
            
            // 再次检查任务是否被取消
            guard !Task.isCancelled else { return }
            
            if !cached.isEmpty {
                // 有缓存：立即显示，不显示 Loading
                allNotes = cached
                applyFiltersAndSort()
                resetPagination()
                isLoading = false
                logger.info("[DedaoDetail] Loaded \(cached.count) highlights from cache for bookId=\(bookId)")
                
                // 后台异步同步（不阻塞 - 在独立 Task 中运行）
                Task { [weak self] in
                    await self?.performBackgroundSync(bookId: bookId)
                }
                return
            }
        } catch {
            guard !Task.isCancelled else { return }
            logger.warning("[DedaoDetail] Cache load failed: \(error.localizedDescription)")
        }
        
        // 2. 没有缓存：显示 Loading，从 API 加载
        if isNewBook {
            allNotes = []
            filteredHighlights = []
            visibleHighlights = []
            currentPageCount = 0
        }
        isLoading = true
        await performBackgroundSync(bookId: bookId)
    }
    
    /// 执行后台同步
    private func performBackgroundSync(bookId: String) async {
        // 检查任务是否已被取消
        guard !Task.isCancelled else { return }
        
        isBackgroundSyncing = true
        
        do {
            // 从 API 获取最新数据
            let apiNotes = try await apiService.fetchEbookNotes(ebookEnid: bookId, bookTitle: nil)
            
            // 检查任务是否已被取消
            guard !Task.isCancelled else {
                isBackgroundSyncing = false
                return
            }
            
            // 保存到缓存
            try await cacheService.saveHighlights(apiNotes, bookId: bookId)
            
            // 检查任务是否已被取消
            guard !Task.isCancelled else {
                isBackgroundSyncing = false
                return
            }
            
            // 如果数据有变化，更新显示
            if apiNotes.count != allNotes.count || allNotes.isEmpty {
                allNotes = apiNotes
                applyFiltersAndSort()
                resetPagination()
                logger.info("[DedaoDetail] Synced \(apiNotes.count) highlights from API for bookId=\(bookId)")
            } else {
                logger.debug("[DedaoDetail] No changes for bookId=\(bookId)")
            }
        } catch {
            // 检查任务是否已被取消
            guard !Task.isCancelled else {
                isBackgroundSyncing = false
                return
            }
            
            // 如果缓存为空，需要显示错误
            if allNotes.isEmpty {
                logger.error("[DedaoDetail] Failed to load highlights: \(error.localizedDescription)")
            } else {
                logger.warning("[DedaoDetail] Background sync failed: \(error.localizedDescription)")
            }
        }
        
        isBackgroundSyncing = false
        isLoading = false
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
        
        // 清空当前数据
        allNotes = []
        filteredHighlights = []
        visibleHighlights = []
        currentPageCount = 0
        
        // 重新加载
        await performBackgroundSync(bookId: bookId)
    }
    
    // MARK: - Filtering and Sorting
    
    private func applyFiltersAndSort() {
        var result: [DedaoHighlightDisplay] = []
        
        for note in allNotes {
            // 应用筛选
            // "仅笔记"过滤
            if noteFilter {
                let hasNote = (note.note != nil && !note.note!.isEmpty)
                if !hasNote {
                    continue
                }
            }
            
            result.append(DedaoHighlightDisplay(from: note))
        }
        
        // 排序
        result.sort { a, b in
            switch sortField {
            case .created:
                let t1 = a.createdAt
                let t2 = b.createdAt
                if t1 == nil && t2 == nil { return false }
                if t1 == nil { return !isAscending }
                if t2 == nil { return isAscending }
                return isAscending ? (t1! < t2!) : (t1! > t2!)
            case .modified:
                let t1 = a.updatedAt ?? a.createdAt
                let t2 = b.updatedAt ?? b.createdAt
                if t1 == nil && t2 == nil { return false }
                if t1 == nil { return !isAscending }
                if t2 == nil { return isAscending }
                return isAscending ? (t1! < t2!) : (t1! > t2!)
            }
        }
        
        filteredHighlights = result
    }
    
    // MARK: - Notion Sync
    
    func syncSmart(book: DedaoBookListItem) {
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
                    let adapter = DedaoNotionAdapter.create(book: book, preferCache: false)
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
                    let errorInfo = SyncErrorInfo.from(error)
                    await MainActor.run {
                        self.logger.error("[DedaoDetail] syncSmart error: \(desc)")
                        self.isSyncing = false
                        self.syncMessage = desc
                        self.syncProgressText = nil
                        NotificationCenter.default.post(
                            name: Notification.Name("SyncBookStatusChanged"),
                            object: self,
                            userInfo: ["bookId": book.bookId, "status": "failed", "errorInfo": errorInfo]
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
    
    /// 将缓存的高亮转换为 API 模型
    private func cachedToNote(_ cached: CachedDedaoHighlight) -> DedaoEbookNote {
        return DedaoEbookNote(
            noteId: nil,
            noteIdStr: cached.highlightId,
            noteIdHazy: nil,
            uid: nil,
            isFromMe: 1,
            notesOwner: nil,
            noteType: nil,
            sourceType: nil,
            note: cached.note,
            noteTitle: nil,
            noteLine: cached.text,
            noteLineStyle: nil,
            createTime: cached.createdAt.map { Int64($0.timeIntervalSince1970) },
            updateTime: cached.updatedAt.map { Int64($0.timeIntervalSince1970) },
            tips: nil,
            shareUrl: nil,
            extra: DedaoNoteExtra(
                title: cached.chapterTitle,
                sourceType: nil,
                sourceTypeName: nil,
                bookId: nil,
                bookName: nil,
                bookSection: cached.bookSection,
                bookStartPos: nil,
                bookOffset: nil,
                bookAuthor: nil
            ),
            notesCount: nil,
            canEdit: nil,
            isPermission: nil,
            originNoteIdHazy: nil,
            rootNoteId: nil,
            rootNoteIdHazy: nil,
            originContentType: nil,
            contentType: nil,
            noteClass: nil,
            highlights: nil,
            rootHighlights: nil,
            state: nil,
            auditState: nil,
            lesson: nil,
            ddurl: nil,
            video: nil,
            notesLikeCount: nil
        )
    }
}

