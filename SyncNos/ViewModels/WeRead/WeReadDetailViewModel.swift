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

    private var currentBookId: String?
    private var allBookmarks: [WeReadBookmark] = []

    private var cancellables = Set<AnyCancellable>()

    init(
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        syncService: WeReadSyncServiceProtocol = WeReadSyncService(),
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.apiService = apiService
        self.syncService = syncService
        self.logger = logger
        self.notionConfig = notionConfig
        
        setupNotificationSubscriptions()
        setupFilterSortSubscriptions()
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

    func loadHighlights(for bookId: String) async {
        currentBookId = bookId
        isLoading = true
        do {
            // 使用新的合并 API 获取高亮（已包含关联的想法）
            let mergedBookmarks = try await apiService.fetchMergedHighlights(bookId: bookId)
            
            // 保存合并后的数据用于筛选和排序
            allBookmarks = mergedBookmarks
            
            // 应用筛选和排序
            applyFiltersAndSort()
            isLoading = false
        } catch {
            let desc = error.localizedDescription
            logger.error("[WeReadDetail] loadHighlights error: \(desc)")
            isLoading = false
        }
    }

    func reloadCurrent() async {
        // 重新应用筛选和排序
        applyFiltersAndSort()
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
