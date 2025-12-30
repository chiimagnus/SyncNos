import Foundation
import Combine

// MARK: - GoodLinksDetailViewModel

/// GoodLinks 详情页 ViewModel
/// 管理单个 link 的高亮数据、筛选、排序、同步
@MainActor
final class GoodLinksDetailViewModel: ObservableObject {
    // MARK: - Notification Names
    
    private enum Notifications {
        static let highlightSortChanged = Notification.Name("HighlightSortChanged")
        static let highlightFilterChanged = Notification.Name("HighlightFilterChanged")
        static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
        static let syncProgressUpdated = Notification.Name("SyncProgressUpdated")
    }
    
    // MARK: - UserDefaults Keys
    
    private enum Keys {
        static let hlNoteFilter = "goodlinks_highlight_note_filter"
        static let hlSelectedStyles = "goodlinks_highlight_selected_styles"
        static let hlSortField = "goodlinks_highlight_sort_field"
        static let hlSortAscending = "goodlinks_highlight_sort_ascending"
        
        // Global highlight menu keys
        static let globalHasNotes = "highlight_has_notes"
        static let globalSelectedStyles = "highlight_selected_styles"
        static let globalSelectedMask = "highlight_selected_mask"
        static let globalSortField = "highlight_sort_field"
        static let globalSortAscending = "highlight_sort_ascending"
    }
    
    // MARK: - Published Properties
    
    /// 当前 link 的所有高亮（原始数据）
    @Published var highlights: [GoodLinksHighlightRow] = []
    
    /// 当前 link 的全文内容
    @Published var content: GoodLinksContentRow?
    
    /// 分页后的可见高亮
    @Published var visibleHighlights: [GoodLinksHighlightRow] = []
    
    /// 是否正在加载高亮
    @Published var isLoading: Bool = false
    
    /// 是否正在加载更多
    @Published var isLoadingMore: Bool = false
    
    /// 错误信息
    @Published var errorMessage: String?
    
    // MARK: - Filter & Sort Properties
    
    @Published var noteFilter: NoteFilter = false
    @Published var selectedStyles: Set<Int> = []
    @Published var sortField: HighlightSortField = .created
    @Published var isAscending: Bool = false
    
    // MARK: - Sync Properties
    
    @Published var isSyncing: Bool = false
    @Published var syncProgressText: String?
    @Published var syncMessage: String?
    
    // MARK: - Pagination Properties
    
    private let pageSize: Int = 50
    private var currentPage: Int = 0
    private var allFilteredHighlights: [GoodLinksHighlightRow] = []
    
    /// 总高亮数量（筛选后）
    var totalFilteredCount: Int {
        allFilteredHighlights.count
    }
    
    /// 是否还有更多高亮可加载
    var canLoadMore: Bool {
        visibleHighlights.count < allFilteredHighlights.count
    }
    
    // MARK: - Dependencies
    
    private let service: GoodLinksDatabaseServiceExposed
    private let syncEngine: NotionSyncEngine
    private let logger: LoggerServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let notionConfig: NotionConfigStoreProtocol
    
    private var cancellables = Set<AnyCancellable>()
    private var currentLinkId: String?
    
    /// 当前高亮加载任务（用于切换 link / Detail 退场时取消）
    private var highlightsFetchTask: Task<[GoodLinksHighlightRow], Error>?
    /// 当前全文加载任务（用于切换 link / Detail 退场时取消）
    private var contentFetchTask: Task<GoodLinksContentRow?, Error>?
    
    // MARK: - Initialization
    
    init(
        service: GoodLinksDatabaseServiceExposed = DIContainer.shared.goodLinksService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.service = service
        self.syncEngine = syncEngine
        self.logger = logger
        self.syncTimestampStore = syncTimestampStore
        self.notionConfig = notionConfig
        
        loadUserDefaults()
        setupNotificationSubscriptions()
        setupPersistenceSubscriptions()
    }
    
    // MARK: - Setup
    
    private func loadUserDefaults() {
        // Load highlight filter/sort settings
        self.noteFilter = UserDefaults.standard.bool(forKey: Keys.hlNoteFilter)
        if let savedStyles = UserDefaults.standard.array(forKey: Keys.hlSelectedStyles) as? [Int] {
            self.selectedStyles = Set(savedStyles)
        }
        if let savedSortFieldRaw = UserDefaults.standard.string(forKey: Keys.hlSortField),
           let sortField = HighlightSortField(rawValue: savedSortFieldRaw) {
            self.sortField = sortField
        }
        self.isAscending = UserDefaults.standard.object(forKey: Keys.hlSortAscending) as? Bool ?? false
        
        // Overlay with global highlight menu state
        if let globalSortRaw = UserDefaults.standard.string(forKey: Keys.globalSortField),
           let globalSortField = HighlightSortField(rawValue: globalSortRaw) {
            self.sortField = globalSortField
        }
        self.isAscending = UserDefaults.standard.object(forKey: Keys.globalSortAscending) as? Bool ?? self.isAscending
        self.noteFilter = UserDefaults.standard.object(forKey: Keys.globalHasNotes) as? Bool ?? self.noteFilter
        if let globalStyles = UserDefaults.standard.array(forKey: Keys.globalSelectedStyles) as? [Int] {
            self.selectedStyles = Set(globalStyles)
        }
    }
    
    private func setupNotificationSubscriptions() {
        // Subscribe to global highlight sort changes from AppCommands
        NotificationCenter.default.publisher(for: Notifications.highlightSortChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let keyRaw = userInfo["sortKey"] as? String, let k = HighlightSortField(rawValue: keyRaw) {
                    self.sortField = k
                }
                if let asc = userInfo["sortAscending"] as? Bool {
                    self.isAscending = asc
                }
                self.reapplyFilters()
            }
            .store(in: &cancellables)
        
        // Subscribe to global highlight filter changes from AppCommands
        NotificationCenter.default.publisher(for: Notifications.highlightFilterChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let hasNotes = userInfo["hasNotes"] as? Bool {
                    self.noteFilter = hasNotes
                }
                if let styles = userInfo["selectedStyles"] as? [Int] {
                    self.selectedStyles = Set(styles)
                }
                self.reapplyFilters()
            }
            .store(in: &cancellables)
    }
    
    private func setupPersistenceSubscriptions() {
        $noteFilter
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.hlNoteFilter)
                UserDefaults.standard.set(newValue, forKey: Keys.globalHasNotes)
            }
            .store(in: &cancellables)
        
        $selectedStyles
            .map { Array($0).sorted() }
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { arr in
                UserDefaults.standard.set(arr, forKey: Keys.hlSelectedStyles)
                UserDefaults.standard.set(arr, forKey: Keys.globalSelectedStyles)
                // Maintain a compact mask for App menu binding
                if arr.isEmpty {
                    UserDefaults.standard.set(0, forKey: Keys.globalSelectedMask)
                } else {
                    var mask = 0
                    for i in arr { mask |= (1 << i) }
                    UserDefaults.standard.set(mask, forKey: Keys.globalSelectedMask)
                }
            }
            .store(in: &cancellables)
        
        $sortField
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue.rawValue, forKey: Keys.hlSortField)
                UserDefaults.standard.set(newValue.rawValue, forKey: Keys.globalSortField)
            }
            .store(in: &cancellables)
        
        $isAscending
            .removeDuplicates()
            .debounce(for: .milliseconds(200), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.hlSortAscending)
                UserDefaults.standard.set(newValue, forKey: Keys.globalSortAscending)
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Data Loading
    
    /// 加载高亮数据
    func loadHighlights(for linkId: String) async {
        // 如果是同一个 link 且数据不为空，不重复加载
        if currentLinkId == linkId && !highlights.isEmpty {
            return
        }
        
        currentLinkId = linkId
        isLoading = true
        errorMessage = nil
        
        let serviceForTask = service
        let loggerForTask = logger
        
        // 取消上一次高亮加载
        highlightsFetchTask?.cancel()
        highlightsFetchTask = nil
        
        do {
            let task = Task.detached(priority: .userInitiated) { () throws -> [GoodLinksHighlightRow] in
                guard !Task.isCancelled else { return [] }
                loggerForTask.info("[GoodLinksDetail] 开始加载高亮，linkId=\(linkId)")
                let dbPath = serviceForTask.resolveDatabasePath()
                let rows = try serviceForTask.fetchHighlightsForLink(dbPath: dbPath, linkId: linkId, limit: 500, offset: 0)
                guard !Task.isCancelled else { return [] }
                return rows
            }
            highlightsFetchTask = task
            
            let rows = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                task.cancel()
            }
            
            // 任务取消或 link 已切换：丢弃结果，避免旧结果回写导致内存残留/内容串台
            guard !Task.isCancelled, currentLinkId == linkId else { return }
            
            highlights = rows
            loggerForTask.info("[GoodLinksDetail] 加载到 \(rows.count) 条高亮，linkId=\(linkId)")
            
            // 初始化分页
            initializePagination()
            isLoading = false
            highlightsFetchTask = nil
        } catch {
            let desc = error.localizedDescription
            loggerForTask.error("[GoodLinksDetail] loadHighlights error: \(desc)")
            // 如果已经切换 link 或任务被取消，不提示错误
            guard !Task.isCancelled, currentLinkId == linkId else { return }
            errorMessage = desc
            isLoading = false
            highlightsFetchTask = nil
        }
    }
    
    /// 加载全文内容
    func loadContent(for linkId: String) async {
        let serviceForTask = service
        let loggerForTask = logger
        
        // 取消上一次全文加载
        contentFetchTask?.cancel()
        contentFetchTask = nil
        
        do {
            let task = Task.detached(priority: .userInitiated) { () throws -> GoodLinksContentRow? in
                guard !Task.isCancelled else { return nil }
                loggerForTask.info("[GoodLinksDetail] 开始加载全文内容，linkId=\(linkId)")
                let dbPath = serviceForTask.resolveDatabasePath()
                let row = try serviceForTask.fetchContent(dbPath: dbPath, linkId: linkId)
                guard !Task.isCancelled else { return nil }
                return row
            }
            contentFetchTask = task
            
            let contentRow = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                task.cancel()
            }
            
            // 任务取消或 link 已切换：丢弃结果
            guard !Task.isCancelled, currentLinkId == linkId else { return }
            
            content = contentRow
            if let c = contentRow {
                loggerForTask.info("[GoodLinksDetail] 加载到全文内容，linkId=\(linkId), wordCount=\(c.wordCount)")
            } else {
                loggerForTask.info("[GoodLinksDetail] 该链接无全文内容，linkId=\(linkId)")
            }
            contentFetchTask = nil
        } catch {
            let desc = error.localizedDescription
            loggerForTask.error("[GoodLinksDetail] loadContent error: \(desc)")
            // 如果已经切换 link 或任务被取消，不提示错误
            guard !Task.isCancelled, currentLinkId == linkId else { return }
            errorMessage = desc
            contentFetchTask = nil
        }
    }
    
    /// 清空当前数据（切换 link 时调用）
    func clear() {
        highlightsFetchTask?.cancel()
        highlightsFetchTask = nil
        contentFetchTask?.cancel()
        contentFetchTask = nil
        currentLinkId = nil
        highlights.removeAll(keepingCapacity: false)
        content = nil
        visibleHighlights.removeAll(keepingCapacity: false)
        allFilteredHighlights.removeAll(keepingCapacity: false)
        currentPage = 0
        
        // 清空同步状态（当 View 消失时，UI 应显示无同步状态）
        syncProgressText = nil
        syncMessage = nil
        isSyncing = false
    }
    
    // MARK: - Filter & Sort
    
    /// 获取筛选和排序后的高亮
    private func getFilteredHighlights() -> [GoodLinksHighlightRow] {
        var filtered = highlights
        
        // Apply note filter
        if noteFilter {
            filtered = filtered.filter { $0.note != nil && !$0.note!.isEmpty }
        }
        
        // Apply color filter
        if !selectedStyles.isEmpty {
            filtered = filtered.filter { highlight in
                guard let color = highlight.color else { return false }
                return selectedStyles.contains(color)
            }
        }
        
        // Apply sorting (GoodLinks only has 'time' field)
        filtered = filtered.sorted { lhs, rhs in
            switch sortField {
            case .created, .modified:
                if isAscending {
                    return lhs.time < rhs.time
                } else {
                    return lhs.time > rhs.time
                }
            }
        }
        
        return filtered
    }
    
    /// 重新应用筛选和排序
    func reapplyFilters() {
        allFilteredHighlights = getFilteredHighlights()
        currentPage = 1
        let endIndex = min(pageSize, allFilteredHighlights.count)
        visibleHighlights = Array(allFilteredHighlights.prefix(endIndex))
    }
    
    /// 重置筛选条件
    func resetFilters() {
        noteFilter = false
        selectedStyles = []
        reapplyFilters()
    }
    
    // MARK: - Pagination
    
    /// 初始化分页
    private func initializePagination() {
        allFilteredHighlights = getFilteredHighlights()
        currentPage = 1
        let endIndex = min(pageSize, allFilteredHighlights.count)
        visibleHighlights = Array(allFilteredHighlights.prefix(endIndex))
    }
    
    /// 加载更多高亮（滚动触发）
    func loadMoreIfNeeded(currentItem: GoodLinksHighlightRow) {
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
        
        let startIndex = currentPage * pageSize
        let endIndex = min(startIndex + pageSize, allFilteredHighlights.count)
        
        guard startIndex < endIndex else {
            isLoadingMore = false
            return
        }
        
        let nextPage = Array(allFilteredHighlights[startIndex..<endIndex])
        visibleHighlights.append(contentsOf: nextPage)
        currentPage += 1
        
        isLoadingMore = false
    }
    
    // MARK: - Notion Sync
    
    /// 同步当前 link 的高亮到 Notion
    func syncSmart(link: GoodLinksLinkRow, pageSize: Int = NotionSyncConfig.goodLinksPageSize) {
        guard !isSyncing else { return }
        guard checkNotionConfig() else {
            NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
            return
        }
        
        isSyncing = true
        syncMessage = nil
        syncProgressText = nil
        
        Task {
            defer { Task { @MainActor in self.isSyncing = false } }
            
            let limiter = DIContainer.shared.syncConcurrencyLimiter
            await limiter.withPermit {
                // 发布开始通知
                NotificationCenter.default.post(
                    name: Notifications.syncBookStatusChanged,
                    object: self,
                    userInfo: ["bookId": link.id, "status": "started"]
                )
                
                do {
                    let dbPath = self.service.resolveDatabasePath()
                    let adapter = try GoodLinksNotionAdapter.create(
                        link: link,
                        dbPath: dbPath,
                        databaseService: self.service
                    )
                    try await syncEngine.syncSmart(source: adapter) { [weak self] progressText in
                        Task { @MainActor in self?.syncProgressText = progressText }
                    }
                    
                    await MainActor.run {
                        self.syncMessage = String(localized: "Sync completed")
                        self.syncProgressText = nil
                        NotificationCenter.default.post(
                            name: Notifications.syncBookStatusChanged,
                            object: self,
                            userInfo: ["bookId": link.id, "status": "succeeded"]
                        )
                    }
                } catch {
                    let desc = error.localizedDescription
                    logger.error("[GoodLinksDetail] syncSmart error: \(desc)")
                    let errorInfo = SyncErrorInfo.from(error)
                    await MainActor.run {
                        self.errorMessage = desc
                        self.syncProgressText = nil
                        NotificationCenter.default.post(
                            name: Notifications.syncBookStatusChanged,
                            object: self,
                            userInfo: ["bookId": link.id, "status": "failed", "errorInfo": errorInfo]
                        )
                    }
                }
            }
        }
    }
    
    // MARK: - Helpers
    
    func lastSync(for linkId: String) -> Date? {
        syncTimestampStore.getLastSyncTime(for: linkId)
    }
    
    private func checkNotionConfig() -> Bool {
        notionConfig.isConfigured
    }
}

