import Foundation

@MainActor
final class WeReadDetailViewModel: ObservableObject {
    @Published var highlights: [WeReadHighlight] = []
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

    private let dataService: WeReadDataServiceProtocol
    private let syncService: WeReadSyncServiceProtocol
    private let logger: LoggerServiceProtocol
    private let notionConfig: NotionConfigStoreProtocol

    private var currentBookId: String?

    init(
        dataService: WeReadDataServiceProtocol = DIContainer.shared.weReadDataService,
        syncService: WeReadSyncServiceProtocol = WeReadSyncService(),
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.dataService = dataService
        self.syncService = syncService
        self.logger = logger
        self.notionConfig = notionConfig
    }

    func loadHighlights(for bookId: String) async {
        currentBookId = bookId
        isLoading = true
        do {
            let rows = try dataService.fetchHighlights(
                for: bookId,
                sortField: sortField,
                ascending: isAscending,
                noteFilter: noteFilter,
                selectedStyles: Array(selectedStyles)
            )
            highlights = rows
            isLoading = false
        } catch {
            let desc = error.localizedDescription
            logger.error("[WeReadDetail] loadHighlights error: \(desc)")
            isLoading = false
        }
    }

    func reloadCurrent() async {
        guard let id = currentBookId else { return }
        await loadHighlights(for: id)
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


