import Foundation
import Combine

// MARK: - WeReadViewModel

@MainActor
final class WeReadViewModel: ObservableObject {
    // 列表数据
    @Published var books: [WeReadBookListItem] = []
    @Published var displayBooks: [WeReadBookListItem] = []
    @Published var visibleBooks: [WeReadBookListItem] = []

    // 状态
    @Published var isLoading: Bool = false
    @Published var isComputingList: Bool = false
    @Published var errorMessage: String?

    // 同步状态（列表）
    @Published var syncingBookIds: Set<String> = []
    @Published var syncedBookIds: Set<String> = []
    @Published var showNotionConfigAlert: Bool = false
    
    // Cookie 刷新失败 Alert
    @Published var showRefreshFailedAlert: Bool = false
    @Published var refreshFailureReason: String = ""

    // 排序
    @Published var sortKey: BookListSortKey = .title
    @Published var sortAscending: Bool = true

    /// 当前用于列表渲染的子集（支持分页/增量加载）
    private let pageSize: Int = 80
    private var currentPageSize: Int = 0

    // 依赖
    private let apiService: WeReadAPIServiceProtocol
    private let syncService: WeReadSyncServiceProtocol
    private let logger: LoggerServiceProtocol
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let notionConfig: NotionConfigStoreProtocol

    private var cancellables: Set<AnyCancellable> = []
    private let computeQueue = DispatchQueue(label: "WeReadViewModel.compute", qos: .userInitiated)
    private let recomputeTrigger = PassthroughSubject<Void, Never>()

    init(
        apiService: WeReadAPIServiceProtocol = DIContainer.shared.weReadAPIService,
        syncService: WeReadSyncServiceProtocol = WeReadSyncService(),
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService,
        syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
        notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore
    ) {
        self.apiService = apiService
        self.syncService = syncService
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
            .map { combined, _ -> [WeReadBookListItem] in
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
    }

    // MARK: - Public API

    func triggerRecompute() {
        recomputeTrigger.send(())
    }

    func loadBooks() async {
        isLoading = true
        errorMessage = nil
        do {
            // 从 WeRead 远端拉取 Notebook 列表
            let notebooks = try await apiService.fetchNotebooks()
            
            // 并发获取每本书的高亮数量
            let booksWithCounts = try await withThrowingTaskGroup(
                of: (WeReadNotebook, Int).self,
                returning: [(WeReadNotebook, Int)].self
            ) { group in
                for notebook in notebooks {
                    group.addTask { [weak self] in
                        guard let self else { return (notebook, 0) }
                        let count = await self.fetchHighlightCount(bookId: notebook.bookId)
                        return (notebook, count)
                    }
                }
                
                var results: [(WeReadNotebook, Int)] = []
                for try await result in group {
                    results.append(result)
                }
                return results
            }
            
            // 转换为 UI 模型
            books = booksWithCounts.map { notebook, count in
                WeReadBookListItem(from: notebook, highlightCount: count)
            }
            
            logger.info("[WeRead] fetched notebooks: \(notebooks.count)")
            isLoading = false
        } catch let error as WeReadAPIError {
            if case .sessionExpiredWithRefreshFailure(let reason) = error {
                // Cookie 刷新失败，显示 Alert 提示用户需要手动登录
                refreshFailureReason = reason
                showRefreshFailedAlert = true
            } else {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        } catch {
            let desc = error.localizedDescription
            logger.error("[WeRead] loadBooks error: \(desc)")
            errorMessage = desc
            isLoading = false
        }
    }
    
    /// 获取书籍的高亮数量
    /// - Parameter bookId: 书籍 ID
    /// - Returns: 高亮数量
    private func fetchHighlightCount(bookId: String) async -> Int {
        do {
            let bookmarks = try await apiService.fetchBookmarks(bookId: bookId)
            return bookmarks.count
        } catch {
            logger.warning("[WeRead] Failed to fetch highlight count for bookId=\(bookId): \(error.localizedDescription)")
            return 0
        }
    }
    
    /// 导航到 WeRead 登录页面
    func navigateToWeReadLogin() {
        NotificationCenter.default.post(
            name: Notification.Name("NavigateToWeReadSettings"),
            object: nil
        )
    }

    func loadMoreIfNeeded(currentItem: WeReadBookListItem) {
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

    // 批量同步 WeRead 书籍到 Notion
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
                userInfo: ["source": "weRead", "items": items]
            )
        }

        let ids = Array(bookIds)
        let itemsById = Dictionary(uniqueKeysWithValues: books.map { ($0.bookId, $0) })
        let limiter = DIContainer.shared.syncConcurrencyLimiter
        let syncService = self.syncService

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
                                try await syncService.syncHighlights(for: book) { progressText in
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
                                    self.logger.error("[WeRead] batchSync error for id=\(id): \(error.localizedDescription)")
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
                if let sender = notification.object as? WeReadViewModel, sender === self {
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
                    self.triggerRecompute()
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
        books: [WeReadBookListItem],
        sortKey: BookListSortKey,
        sortAscending: Bool,
        syncTimestampStore: SyncTimestampStoreProtocol
    ) -> [WeReadBookListItem] {
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
            case .created:
                let t1 = a.createdAt ?? Date.distantPast
                let t2 = b.createdAt ?? Date.distantPast
                if t1 == t2 { return false }
                return sortAscending ? (t1 < t2) : (t1 > t2)
            case .lastEdited:
                let t1 = a.updatedAt ?? Date.distantPast
                let t2 = b.updatedAt ?? Date.distantPast
                if t1 == t2 { return false }
                return sortAscending ? (t1 < t2) : (t1 > t2)
            case .lastSync:
                let t1 = lastSyncCache[a.bookId] ?? nil
                let t2 = lastSyncCache[b.bookId] ?? nil
                if t1 == nil && t2 == nil { return false }
                if t1 == nil { return sortAscending }
                if t2 == nil { return !sortAscending }
                if t1! == t2! { return false }
                return sortAscending ? (t1! < t2!) : (t1! > t2!)
            }
        }

        return result
    }
}
