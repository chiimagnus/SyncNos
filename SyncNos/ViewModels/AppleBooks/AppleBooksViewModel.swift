import Foundation
import Combine

// MARK: - AppleBooksViewModel

// Centralized notification names to avoid typos and allow self-decoupling filters
private enum ABVMNotifications {
    static let appleBooksFilterChanged = Notification.Name("AppleBooksFilterChanged")
    static let syncBookStatusChanged = Notification.Name("SyncBookStatusChanged")
    static let syncProgressUpdated = Notification.Name("SyncProgressUpdated")
}

@MainActor
final class AppleBooksViewModel: ObservableObject {
    // Centralized UserDefaults keys
    private enum Keys {
        static let sortKey = "bookList_sort_key"
        static let sortAscending = "bookList_sort_ascending"
        static let showWithTitleOnly = "bookList_showWithTitleOnly"
    }
    @Published var books: [BookListItem] = []
    // 后台计算产物：用于列表渲染的派生结果
    @Published var displayBooks: [BookListItem] = []
    @Published var isLoading = false
    // 列表派生计算状态：用于切换瞬间显示"加载中"并避免主线程渲染巨大 List
    @Published var isComputingList: Bool = false
    @Published var errorMessage: String?
    // UI Sync State
    @Published var syncingBookIds: Set<String> = []
    @Published var syncedBookIds: Set<String> = []

    /// 当前用于列表渲染的子集（支持分页/增量加载）
    @Published var visibleBooks: [BookListItem] = []
    /// 分页参数与当前已暴露长度
    private let pageSize: Int = 80
    private var currentPageSize: Int = 0

    // Sorting and filtering state - Reactive properties with UserDefaults persistence
    @Published var sortKey: BookListSortKey = .title

    @Published var sortAscending: Bool = true

    @Published var showWithTitleOnly: Bool = false
    private let databaseService: DatabaseServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let bookmarkStore: BookmarkStoreProtocol
    private let logger = DIContainer.shared.loggerService
    private let syncTimestampStore: SyncTimestampStoreProtocol
    private let notionConfig: NotionConfigStoreProtocol
    private var dbRootOverride: String?
    private var annotationDBPath: String?
    private var booksDBPath: String?
    private var cancellables: Set<AnyCancellable> = []
    private let computeQueue = DispatchQueue(label: "AppleBooksViewModel.compute", qos: .userInitiated)
    private let recomputeTrigger = PassthroughSubject<Void, Never>()

    // Public readonly accessors
    var annotationDatabasePath: String? { annotationDBPath }
    var booksDatabasePath: String? { booksDBPath }

    // MARK: - Initialization
    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService,
         bookmarkStore: BookmarkStoreProtocol = DIContainer.shared.bookmarkStore,
         syncTimestampStore: SyncTimestampStoreProtocol = DIContainer.shared.syncTimestampStore,
         syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
         notionConfig: NotionConfigStoreProtocol = DIContainer.shared.notionConfigStore) {
        self.databaseService = databaseService
        self.bookmarkStore = bookmarkStore
        self.syncTimestampStore = syncTimestampStore
        self.syncEngine = syncEngine
        self.notionConfig = notionConfig

        // Load initial values from UserDefaults
        if let savedSortKey = UserDefaults.standard.string(forKey: Keys.sortKey),
           let sortKey = BookListSortKey(rawValue: savedSortKey) {
            self.sortKey = sortKey
        }
        self.sortAscending = UserDefaults.standard.bool(forKey: Keys.sortAscending)
        self.showWithTitleOnly = UserDefaults.standard.bool(forKey: Keys.showWithTitleOnly)
        
        // 订阅来自 AppCommands 的过滤/排序变更通知
        NotificationCenter.default.publisher(for: ABVMNotifications.appleBooksFilterChanged)
            .compactMap { $0.userInfo as? [String: Any] }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] userInfo in
                guard let self else { return }
                if let keyRaw = userInfo["sortKey"] as? String, let k = BookListSortKey(rawValue: keyRaw) {
                    self.sortKey = k
                }
                if let asc = userInfo["sortAscending"] as? Bool {
                    self.sortAscending = asc
                }
                if let showTitleOnly = userInfo["showWithTitleOnly"] as? Bool {
                    self.showWithTitleOnly = showTitleOnly
                }
            }
            .store(in: &cancellables)

        subscribeSyncStatusNotifications()
        
        // Combine 管道：在后台队列计算派生的 displayBooks，主线程发布结果
        Publishers.CombineLatest4($books, $sortKey, $sortAscending, $showWithTitleOnly)
            .combineLatest(recomputeTrigger)
            // 主线程置计算标记为 true，确保第一帧显示"加载中"
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { [weak self] _ in self?.isComputingList = true })
            // 在后台队列进行 filter/sort 等重计算
            .receive(on: computeQueue)
            .map { tuple -> [BookListItem] in
                let (combined, _) = tuple
                let (books, sortKey, sortAscending, showWithTitleOnly) = combined
                return Self.buildDisplayBooks(
                    books: books,
                    sortKey: sortKey,
                    sortAscending: sortAscending,
                    showWithTitleOnly: showWithTitleOnly,
                    syncTimestampStore: syncTimestampStore
                )
            }
            // 回到主线程发布结果，驱动 UI
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newDisplay in
                guard let self else { return }
                self.isComputingList = false
                self.displayBooks = newDisplay
                // 重置可见列表为第一页
                self.currentPageSize = min(self.pageSize, self.displayBooks.count)
                if self.currentPageSize == 0 {
                    self.visibleBooks = []
                } else {
                    self.visibleBooks = Array(self.displayBooks.prefix(self.currentPageSize))
                }
            }
            .store(in: &cancellables)

        // Debounced persistence of list preferences to reduce UserDefaults I/O
        $sortKey
            .removeDuplicates()
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue.rawValue, forKey: Keys.sortKey)
            }
            .store(in: &cancellables)

        $sortAscending
            .removeDuplicates()
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.sortAscending)
            }
            .store(in: &cancellables)

        $showWithTitleOnly
            .removeDuplicates()
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { newValue in
                UserDefaults.standard.set(newValue, forKey: Keys.showWithTitleOnly)
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Path Utility Methods
    
    /// 根据选择的路径确定数据库根目录
    /// - Parameter selectedPath: 用户选择的路径
    /// - Returns: 数据库根目录路径
    func determineDatabaseRoot(from selectedPath: String) -> String {
        DatabasePathHelper.determineDatabaseRoot(from: selectedPath)
    }
    
    // MARK: - Public Methods
    
    /// 主动触发一次派生重算（供视图 onAppear/切换场景调用）
    func triggerRecompute() {
        recomputeTrigger.send(())
    }
    
    func setDbRootOverride(_ path: String?) {
        dbRootOverride = path
    }
    
    /// 恢复已保存的书签并申请访问权限，同时计算并设置数据库根目录
    /// - Returns: 是否成功开始访问安全作用域
    @discardableResult
    func restoreBookmarkAndConfigureRoot() -> Bool {
        guard let url = bookmarkStore.restore() else { return false }
        let started = bookmarkStore.startAccessing(url: url)
        logger.debug("Using restored bookmark on appear, startAccess=\(started)")
        let selectedPath = url.path
        let rootCandidate = determineDatabaseRoot(from: selectedPath)
        setDbRootOverride(rootCandidate)
        return started
    }
    
    /// 结束对当前安全作用域目录的访问
    func stopAccessingIfNeeded() {
        bookmarkStore.stopAccessingIfNeeded()
    }
    
    /// 供视图查询上次同步时间，避免视图直接依赖存储实现
    func lastSync(for bookId: String) -> Date? {
        syncTimestampStore.getLastSyncTime(for: bookId)
    }
    
    func loadBooks() async {
        isLoading = true
        errorMessage = nil

        // 将同步 SQLite 读取与文件系统扫描移到后台，避免阻塞主线程
        // 先在主线程上捕获依赖与路径，避免跨 actor 访问
        let dbService = self.databaseService
        let logger = self.logger
        let root = self.dbRootOverride

        do {
            let result = try await Task.detached(priority: .userInitiated) { () throws -> (books: [BookListItem], annotationDB: String, booksDB: String) in
                try computeBooksFromDatabase(root: root, databaseService: dbService, logger: logger)
            }.value
            await MainActor.run {
                self.books = result.books
                self.annotationDBPath = result.annotationDB
                self.booksDBPath = result.booksDB
                logger.info("Successfully loaded \(result.books.count) books")
                self.isLoading = false
            }
        } catch {
            let errorDesc = error.localizedDescription
            await MainActor.run {
                logger.error("Error loading books: \(errorDesc)")
                self.errorMessage = errorDesc
                self.isLoading = false
            }
        }
    }
        
    // MARK: - Private Methods
    private func subscribeSyncStatusNotifications() {
        NotificationCenter.default.publisher(for: ABVMNotifications.syncBookStatusChanged)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                // Ignore notifications emitted by AutoSyncService (object == nil)
                if notification.object == nil { return }
                if let sender = notification.object as? AppleBooksViewModel, sender === self {
                    // Ignore self-emitted events to prevent duplicate state updates
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
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }

    /// 在行即将出现在视图中时调用，判断是否需要向后追加一页数据
    func loadMoreIfNeeded(currentItem: BookListItem) {
        guard let index = visibleBooks.firstIndex(where: { $0.bookId == currentItem.bookId }) else { return }
        let threshold = max(visibleBooks.count - 10, 0)
        guard index >= threshold else { return }
        let newSize = min(currentPageSize + pageSize, displayBooks.count)
        guard newSize > currentPageSize else { return }
        currentPageSize = newSize
        visibleBooks = Array(displayBooks.prefix(currentPageSize))
    }
}

// MARK: - Nonisolated heavy computation helpers
/// 将 Apple Books 的磁盘扫描 + SQLite 聚合封装为无隔离纯函数，便于在后台线程执行
private func computeBooksFromDatabase(root: String?, databaseService: DatabaseServiceProtocol, logger: LoggerServiceProtocol) throws -> (books: [BookListItem], annotationDB: String, booksDB: String) {
    guard let root = root else {
        logger.warning("Books data root not selected; skipping load until user picks a folder")
        return ([], "", "")
    }
    logger.info("Books data root: \(root)")

    let annotationDir = (root as NSString).appendingPathComponent("AEAnnotation")
    let booksDir = (root as NSString).appendingPathComponent("BKLibrary")

    logger.debug("Looking for annotation DB in: \(annotationDir)")
    logger.debug("Looking for books DB in: \(booksDir)")

    guard let annotationDB = latestSQLiteFileStandalone(in: annotationDir, logger: logger) else {
        let error = "Annotation DB not found under \(annotationDir)"
        logger.error("Error: \(error)")
        throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
    }
    logger.info("Found annotation DB: \(annotationDB)")

    guard let booksDB = latestSQLiteFileStandalone(in: booksDir, logger: logger) else {
        let error = "Books DB not found under \(booksDir)"
        logger.error("Error: \(error)")
        throw NSError(domain: "SyncBookNotes", code: 10, userInfo: [NSLocalizedDescriptionKey: error])
    }
    logger.info("Found books DB: \(booksDB)")

    // 使用只读会话封装连接生命周期
    let annotationSession = try databaseService.makeReadOnlySession(dbPath: annotationDB)
    defer { annotationSession.close(); logger.debug("Closed annotation DB session") }
    let booksSession = try databaseService.makeReadOnlySession(dbPath: booksDB)
    defer { booksSession.close(); logger.debug("Closed books DB session") }

    // 获取每本书的高亮统计信息（包括计数、创建时间、修改时间）
    let stats = try annotationSession.fetchHighlightStatsByAsset()
    let assetIds = stats.map { $0.assetId }.sorted()
    logger.info("Found \(assetIds.count) assets with highlights")

    // 获取书籍信息（标题/作者）
    let books = try booksSession.fetchBooks(assetIds: assetIds)
    logger.debug("Fetched \(books.count) books from library DB")

    // 创建书籍ID到书籍信息的映射
    var bookInfoMap: [String: BookRow] = [:]
    for book in books { bookInfoMap[book.assetId] = book }

    // 创建书籍列表
    var result: [BookListItem] = []
    result.reserveCapacity(stats.count)
    for stat in stats {
        let bookInfo = bookInfoMap[stat.assetId]
        let hasTitle = bookInfo != nil && !(bookInfo?.title ?? "").isEmpty
        let bookTitle = bookInfo?.title ?? ""
        let authorName = bookInfo?.author ?? ""
        result.append(BookListItem(
            bookId: stat.assetId,
            authorName: authorName,
            bookTitle: bookTitle,
            ibooksURL: "ibooks://assetid/\(stat.assetId)",
            highlightCount: stat.count,
            createdAt: stat.minCreationDate,
            modifiedAt: stat.maxModifiedDate,
            hasTitle: hasTitle
        ))
    }

    let sorted = result.sorted { $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle) == .orderedAscending }
    logger.info("Built list with \(sorted.count) books (with stats and metadata)")
    return (sorted, annotationDB, booksDB)
}

/// 独立的 SQLite 文件扫描，便于在后台线程使用
private func latestSQLiteFileStandalone(in dir: String, logger: LoggerServiceProtocol) -> String? {
    let url = URL(fileURLWithPath: dir)
    var isDir: ObjCBool = false
    if !FileManager.default.fileExists(atPath: dir, isDirectory: &isDir) { return nil }
    if !isDir.boolValue { return nil }
    guard let files = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
    let sqliteFiles = files.filter { $0.pathExtension == "sqlite" }
    guard !sqliteFiles.isEmpty else { return nil }
    let sorted = sqliteFiles.sorted { a, b in
        (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast >
        (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? .distantPast) ?? .distantPast
    }
    return sorted.first?.path
}

/// 将排序和过滤逻辑封装为纯函数，便于在后台线程执行
private extension AppleBooksViewModel {
    static func buildDisplayBooks(
        books: [BookListItem],
        sortKey: BookListSortKey,
        sortAscending: Bool,
        showWithTitleOnly: Bool,
        syncTimestampStore: SyncTimestampStoreProtocol
    ) -> [BookListItem] {
        var result = books
        
        // Apply title filter
        if showWithTitleOnly {
            result = result.filter { $0.hasTitle }
        }
        
        // 预取 lastSync 映射，避免比较器中频繁读取
        var lastSyncCache: [String: Date?] = [:]
        if sortKey == .lastSync {
            lastSyncCache = Dictionary(uniqueKeysWithValues: result.map { ($0.bookId, syncTimestampStore.getLastSyncTime(for: $0.bookId)) })
        }
        
        // Apply sorting
        result.sort { book1, book2 in
            switch sortKey {
            case .title:
                let cmp = book1.bookTitle.localizedCaseInsensitiveCompare(book2.bookTitle)
                return sortAscending ? (cmp == .orderedAscending) : (cmp == .orderedDescending)
            case .highlightCount:
                if book1.highlightCount == book2.highlightCount { return false }
                return sortAscending ? (book1.highlightCount < book2.highlightCount) : (book1.highlightCount > book2.highlightCount)
            case .lastSync:
                let time1 = lastSyncCache[book1.bookId] ?? nil
                let time2 = lastSyncCache[book2.bookId] ?? nil
                if time1 == nil && time2 == nil { return false }
                if time1 == nil { return sortAscending }
                if time2 == nil { return !sortAscending }
                if time1! == time2! { return false }
                return sortAscending ? (time1! < time2!) : (time1! > time2!)
            case .lastEdited:
                let time1 = book1.modifiedAt ?? Date.distantPast
                let time2 = book2.modifiedAt ?? Date.distantPast
                if time1 == time2 { return false }
                return sortAscending ? (time1 < time2) : (time1 > time2)
            case .created:
                let time1 = book1.createdAt ?? Date.distantPast
                let time2 = book2.createdAt ?? Date.distantPast
                if time1 == time2 { return false }
                return sortAscending ? (time1 < time2) : (time1 > time2)
            }
        }
        
        return result
    }
}

// MARK: - Batch Sync (Apple Books)
extension AppleBooksViewModel {
    /// 批量同步所选书籍到 Notion，使用并发限流（默认 10 并发）
    func batchSync(bookIds: Set<String>, concurrency: Int = NotionSyncConfig.batchConcurrency) {
        guard !bookIds.isEmpty else { return }
        guard checkNotionConfig() else {
            NotificationCenter.default.post(name: Notification.Name("ShowNotionConfigAlert"), object: nil)
            return
        }
        guard let dbPath = self.annotationDatabasePath else {
            logger.warning("[AppleBooks] annotationDatabasePath is nil; skip batchSync")
            return
        }
        
        // 通过 SyncQueueStore 入队，自动处理去重和冷却检查
        let syncQueueStore = DIContainer.shared.syncQueueStore
        let enqueueItems = bookIds.compactMap { id -> SyncEnqueueItem? in
            guard let b = displayBooks.first(where: { $0.bookId == id }) else { return nil }
            return SyncEnqueueItem(id: id, title: b.bookTitle, subtitle: b.authorName)
        }
        
        let acceptedIds = syncQueueStore.enqueue(source: .appleBooks, items: enqueueItems)
        guard !acceptedIds.isEmpty else {
            logger.debug("[AppleBooks] No tasks accepted by SyncQueueStore, skip")
            return
        }
        
        // 更新本地 UI 状态
        for id in acceptedIds {
            syncingBookIds.insert(id)
        }

        let ids = Array(acceptedIds)
        let itemsById = Dictionary(uniqueKeysWithValues: books.map { ($0.bookId, $0) })
        let limiter = DIContainer.shared.syncConcurrencyLimiter
        let syncEngine = self.syncEngine
        let notionConfig = self.notionConfig

        Task {
            await withTaskGroup(of: Void.self) { group in
                for id in ids {
                    guard let book = itemsById[id] else { continue }
                    group.addTask { [weak self] in
                        guard let self else { return }
                        await limiter.withPermit {
                            // 真正获得并发许可后再发布 started，以保证 UI running 数只反映实际并发
                            await MainActor.run {
                                NotificationCenter.default.post(name: ABVMNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "started"])
                            }
                            do {
                                let adapter = AppleBooksNotionAdapter.create(book: book, dbPath: dbPath, notionConfig: notionConfig)
                                try await syncEngine.syncSmart(source: adapter) { progress in
                                    // 广播该书的同步进度，供详情页监听并显示
                                    Task { @MainActor in
                                        NotificationCenter.default.post(name: ABVMNotifications.syncProgressUpdated, object: self, userInfo: ["bookId": id, "progress": progress])
                                    }
                                }
                                await MainActor.run {
                                    self.syncingBookIds.remove(id)
                                    self.syncedBookIds.insert(id)
                                    NotificationCenter.default.post(name: ABVMNotifications.syncBookStatusChanged, object: self, userInfo: ["bookId": id, "status": "succeeded"])
                                }
                            } catch {
                                let errorInfo = SyncErrorInfo.from(error)
                                await MainActor.run {
                                    self.logger.error("[AppleBooks] batchSync error for id=\(id): \(error.localizedDescription)")
                                    self.syncingBookIds.remove(id)
                                    NotificationCenter.default.post(
                                        name: ABVMNotifications.syncBookStatusChanged,
                                        object: self,
                                        userInfo: ["bookId": id, "status": "failed", "errorInfo": errorInfo]
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
    
    // MARK: - Configuration Validation
    private func checkNotionConfig() -> Bool {
        return notionConfig.isConfigured
    }
}

// MARK: - Memory Purge

extension AppleBooksViewModel: MemoryPurgeable {
    /// 主动释放 Apple Books 列表相关的内存占用（切换到其它数据源时调用）。
    func purgeMemory() {
        // 结束安全作用域访问（避免长期持有文件句柄/权限）
        stopAccessingIfNeeded()
        
        // 释放大数组
        books = []
        displayBooks = []
        visibleBooks = []
        currentPageSize = 0
        
        // 释放路径与错误状态（下次进入会重新解析/加载）
        annotationDBPath = nil
        booksDBPath = nil
        errorMessage = nil
        
        // 重置加载状态，避免 UI 残留“Loading…”
        isLoading = false
        isComputingList = false
    }
}