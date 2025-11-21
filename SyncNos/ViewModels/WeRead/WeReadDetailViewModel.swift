import Foundation

// 临时结构体用于存储高亮数据
struct WeReadHighlightDisplay: Identifiable {
    let id: String
    let text: String
    let note: String?
    let colorIndex: Int?
    let createdAt: Date?
    let modifiedAt: Date?
    let chapterTitle: String?
    
    init(from bookmark: WeReadBookmark) {
        self.id = bookmark.highlightId
        self.text = bookmark.text
        self.note = bookmark.note
        self.colorIndex = bookmark.colorIndex
        self.createdAt = bookmark.timestamp.map { Date(timeIntervalSince1970: $0) }
        self.modifiedAt = nil
        self.chapterTitle = bookmark.chapterTitle
    }
    
    init(from review: WeReadReview) {
        self.id = "review-\(review.reviewId)"
        self.text = review.content
        self.note = review.content
        self.colorIndex = nil
        self.createdAt = review.timestamp.map { Date(timeIntervalSince1970: $0) }
        self.modifiedAt = nil
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
    private var allReviews: [WeReadReview] = []

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
    }

    func loadHighlights(for bookId: String) async {
        currentBookId = bookId
        isLoading = true
        do {
            // 从远端拉取最新高亮与想法
            let bookmarks = try await apiService.fetchBookmarks(bookId: bookId)
            let reviews = try await apiService.fetchReviews(bookId: bookId)
            
            // 保存原始数据用于筛选和排序
            allBookmarks = bookmarks
            allReviews = reviews
            
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
        
        // 转换 bookmarks
        for bm in allBookmarks {
            // 应用筛选
            if noteFilter && (bm.note?.isEmpty ?? true) {
                continue
            }
            if !selectedStyles.isEmpty, let style = bm.colorIndex, !selectedStyles.contains(style) {
                continue
            }
            result.append(WeReadHighlightDisplay(from: bm))
        }
        
        // 转换 reviews
        for rv in allReviews {
            result.append(WeReadHighlightDisplay(from: rv))
        }
        
        // 排序
        result.sort { a, b in
            let t1 = sortField == .created ? a.createdAt : a.modifiedAt
            let t2 = sortField == .created ? b.createdAt : b.modifiedAt
            
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
